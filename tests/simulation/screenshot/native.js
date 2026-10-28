import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Gio from 'gi://Gio';
import {assert, block, pause, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';

export async function capture(desktop, {shortcut = false, cancel = false} = {}) {
  const app = desktop.app;
  const original = app._takeScreenshot;
  let started = false;
  let done = false;
  let failed = null;
  // Observe the complete production pipeline, without substituting a URI or callback result.
  app._takeScreenshot = async function (...args) {
    started = true;
    try { return await original.apply(this, args); }
    catch (error) { failed = error; throw error; }
    finally { done = true; }
  };
  try {
    if (shortcut) {
      desktop.settings.set_strv('screenshot-shortcut', ['<Control><Shift>F10']);
      await desktop.key(Clutter.KEY_F10, [Clutter.KEY_Control_L, Clutter.KEY_Shift_L]);
    } else {
      await desktop.open();
      await desktop.click(desktop.history.screenshotButton);
    }
    await until(() => started, 'native screenshot entry starts production pipeline');
    if (cancel) {
      await until(() => Main.screenshotUI.visible, 'real interactive ScreenshotUI', 15000);
      await pause(100);
      await desktop.key(Clutter.KEY_Escape);
    } else {
      // Some portal backends still present confirmation for a screen request.
      let confirmed = false;
      for (let attempt = 0; !done && attempt < 300; attempt++) {
        const focus = global.stage.get_key_focus();
        if (focus?.has_style_class_name?.('modal-dialog-button')) {
          const allow = focus.get_parent()?.get_children().find(button =>
            ['Allow', 'Share'].includes(button.get_child?.()?.text ?? button.label));
          if (allow) {
            await desktop.key(Clutter.KEY_Tab);
            await until(() => global.stage.get_key_focus() === allow, 'permission confirmation keyboard focus');
            await desktop.key(Clutter.KEY_Return);
          }
        }
        if (Main.screenshotUI.visible && !confirmed) {
          await pause(100);
          await desktop.key(Clutter.KEY_Return);
          confirmed = true;
        }
        await pause(50);
      }
    }
    await until(() => done, 'full screenshot pipeline completed', 15000);
    if (failed) throw failed;
    assert(!app._portal._request, 'Completed capture must release portal request');
  } finally {
    if (!done) app._portal.cancel();
    app._takeScreenshot = original;
  }
}

async function baseline(desktop, target, text) {
  const controller = desktop.app._controller;
  const revision = controller.selectionRevision;
  await target.offer(text);
  await until(() => controller.selectionRevision > revision && !controller._captureInProgress
    && !controller._captureQueued, 'real screenshot sentinel owner settled');
}

export const cases = {
  async 'SHOT-05-unsupported'(desktop) {
    const reply = await new Promise((resolve, reject) => Gio.DBus.session.call(
      'org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop',
      'org.freedesktop.DBus.Properties', 'GetAll',
      new GLib.Variant('(s)', ['org.freedesktop.portal.Screenshot']), new GLib.VariantType('(a{sv})'),
      Gio.DBusCallFlags.NONE, 10000, null, (bus, result) => {
        try { resolve(bus.call_finish(result).deepUnpack()[0]); } catch (error) { reject(error); }
      }));
    const version = reply.version?.deepUnpack() ?? 0;
    const targets = reply.AvailableTargets?.deepUnpack() ?? 0;
    const unsupported = [['window', 2], ['area', 4], ['active-window', 8]]
      .find(([_name, flag]) => version < 3 || !(targets & flag));
    if (!unsupported) block('The real portal supports every configured target; unsupported-target path is not applicable');
    const target = await Target.open(desktop);
    const report = desktop.app._reportError;
    const errors = [];
    desktop.app._reportError = function (...args) { errors.push(args[0]); return report.apply(this, args); };
    try {
      await baseline(desktop, target, 'unsupported portal target preserves clipboard');
      const ids = desktop.app._controller.items.map(item => item.id).join();
      desktop.settings.set_string('screenshot-target', unsupported[0]);
      desktop.settings.set_boolean('screenshot-open-editor', false);
      let failure = null;
      try { await capture(desktop); } catch (error) { failure = error; }
      await until(() => errors.length === 1, 'one actual unsupported-target error reaches the normal notification path');
      assert(failure && errors[0] === failure && failure.message.includes(unsupported[0]),
        'The observed failure must identify the selected unsupported target, not an unrelated transient error');
      assert(!desktop.app._portal._request && !Main.screenshotUI.visible,
        'Unsupported real backend capability must fail without leaking a request or shared screenshot UI');
      assert(desktop.app._controller.items.map(item => item.id).join() === ids
        && (await target.clipboard()).text === 'unsupported portal target preserves clipboard',
      'Unsupported target must not create an item or replace the real clipboard');
      desktop.settings.set_string('screenshot-target', 'screen');
      desktop.settings.set_boolean('screenshot-add-history', true);
      desktop.settings.set_boolean('screenshot-write-clipboard', true);
      await capture(desktop);
      const image = desktop.app._controller.items.find(item => item.isImage);
      assert(image && (await target.clipboard('image/png')).sha256 === image.primary.sha256 && errors.length === 1,
        'A supported retry must produce the actual original without repeating the prior error');
    } finally { desktop.app._reportError = report; await target.close(); }
  },

  async 'SHOT-03-editor'(desktop) {
    const target = await Target.open(desktop);
    const processes = [];
    const launch = desktop.app._launchEditor;
    desktop.app._launchEditor = async function (...args) {
      const process = await launch.apply(this, args);
      if (process) processes.push(process);
      return process;
    };
    const script = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
      .get_child('fixtures').get_child('editor-receiver.py').get_path();
    desktop.settings.set_string('screenshot-target', 'screen');
    desktop.settings.set_boolean('screenshot-open-editor', true);
    try {
      // The complete policy matrix runs without a desktop in pipeline.test.js.
      const output = `${GLib.get_tmp_dir()}/screenshot-editor-${GLib.uuid_string_random()}.json`;
      desktop.settings.set_string('editor-command', ['python3', script, output, 'file']
        .map(value => GLib.shell_quote(value)).join(' ') + ' %f');
      for (const item of [...desktop.app._controller.items]) desktop.app._controller.remove(item.id);
      await baseline(desktop, target, 'clipboard before screenshot editor');
      desktop.settings.set_boolean('screenshot-add-history', false);
      desktop.settings.set_boolean('screenshot-write-clipboard', true);
      const revision = desktop.app._controller.selectionRevision;
      await capture(desktop);
      await until(() => Gio.File.new_for_path(output).query_exists(null), 'real custom screenshot editor read original');
      assert(processes.length === 1, 'One screenshot must launch exactly one real editor process');
      const [, data] = Gio.File.new_for_path(output).load_contents(null);
      const received = JSON.parse(new TextDecoder().decode(data));
      const actual = await target.clipboard('image/png');
      await until(() => desktop.app._controller.selectionRevision > revision
        && !desktop.app._controller._captureInProgress && !desktop.app._controller._captureQueued,
      'editor screenshot clipboard capture settled');
      assert(!desktop.app._controller.items.some(item => item.isImage),
        'Opening an editor without history must not recapture its screenshot');
      const image = GdkPixbuf.Pixbuf.new_from_file(received.source);
      assert(image.width === global.stage.width && image.height === global.stage.height && received.size > 100,
        'The editor must receive the complete real screenshot, not a thumbnail');
      assert(actual.sha256 === received.sha256, 'Editor and actual clipboard must receive the same original');
    } finally {
      desktop.app._launchEditor = launch;
      for (const process of processes) {
        process.force_exit();
        await new Promise(resolve => process.wait_async(null, (object, result) => { object.wait_finish(result); resolve(); }));
      }
      await target.close();
    }
  },

  async 'SHOT-07'(desktop) {
    const target = await Target.open(desktop);
    desktop.settings.set_string('screenshot-target', 'interactive');
    try {
      await baseline(desktop, target, 'cancel and immediately retry');
      await capture(desktop, {cancel: true});
      assert(!Main.screenshotUI.visible && !desktop.app._portal._request, 'Actual cancel must fully release before retry');
      desktop.settings.set_string('screenshot-target', 'screen');
      desktop.settings.set_boolean('screenshot-add-history', true);
      desktop.settings.set_boolean('screenshot-write-clipboard', true);
      desktop.settings.set_boolean('screenshot-open-editor', false);
      await capture(desktop, {shortcut: true});
      const images = desktop.app._controller.items.filter(item => item.isImage);
      assert(images.length === 1 && (await target.clipboard('image/png')).sha256 === images[0].primary.sha256,
        'Immediate retry must produce a complete new screenshot and actual clipboard bytes');
    } finally { await target.close(); }
  },

  async 'SHOT-03'(desktop) {
    const directory = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);
    assert(directory?.startsWith(`${GLib.getenv('CBX_SIMULATION_RUNTIME')}/`),
      'Successful screenshots require the runner-owned Pictures directory');
    const target = await Target.open(desktop);
    desktop.settings.set_string('screenshot-target', 'screen');
    desktop.settings.set_boolean('screenshot-open-editor', false);
    try {
      for (const [history, clipboard] of [[true, true], [false, false]]) {
        for (const item of desktop.app._controller.items) desktop.app._controller.remove(item.id);
        await baseline(desktop, target, `screenshot clipboard sentinel ${history}-${clipboard}`);
        desktop.settings.set_boolean('screenshot-add-history', history);
        desktop.settings.set_boolean('screenshot-write-clipboard', clipboard);
        const revision = desktop.app._controller.selectionRevision;
        await capture(desktop, {shortcut: !history});
        const copied = await target.clipboard(clipboard ? 'image/png' : 'text/plain;charset=utf-8');
        await until(() => (!clipboard || desktop.app._controller.selectionRevision > revision)
          && !desktop.app._controller._captureInProgress && !desktop.app._controller._captureQueued,
        'screenshot clipboard owner and capture suppression settled');
        const images = desktop.app._controller.items.filter(item => item.isImage);
        assert(history ? images.length === 1 : images.length === 0, 'Actual screenshot history option must control image recording');
        if (history) {
          await until(() => images[0].primary.path && images[0].preview?.path, 'scheduled screenshot persistence completed');
          const pixbuf = GdkPixbuf.Pixbuf.new_from_file(images[0].primary.path);
          assert(pixbuf.width === global.stage.width && pixbuf.height === global.stage.height,
            'Full-screen portal capture must contain the actual virtual desktop');
          assert(images[0].preview?.path, 'Screenshot history must also create its thumbnail');
        }
        assert(clipboard ? copied.size > 100 : copied.text === `screenshot clipboard sentinel ${history}-${clipboard}`,
          'Actual screenshot clipboard option must copy an image or preserve existing text');
      }
    } finally { await target.close(); }
  },

  async 'SHOT-04'(desktop) {
    const target = await Target.open(desktop);
    desktop.settings.set_string('screenshot-target', 'interactive');
    const report = desktop.app._reportError;
    const errors = [];
    desktop.app._reportError = error => { errors.push(error); report.call(desktop.app, error); };
    try {
      for (const shortcut of [false, true]) {
        await baseline(desktop, target, 'cancelled screenshot preserves this');
        const ids = desktop.app._controller.items.map(item => item.id).join();
        await capture(desktop, {shortcut, cancel: true});
        assert(!errors.length && desktop.app._controller.items.map(item => item.id).join() === ids,
          'User cancellation through either native entry must not report failure or add history');
        assert((await target.clipboard()).text === 'cancelled screenshot preserves this', 'Cancel must not replace actual clipboard');
      }
    } finally { desktop.app._reportError = report; await target.close(); }
  },
};
