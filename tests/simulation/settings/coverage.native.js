import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {assert, pause, until} from '../helpers/desktop.js';
import {Preferences} from '../helpers/preferences.js';
import {Target} from '../helpers/target.js';
import {restart} from '../helpers/restart.js';
import {capture} from '../clipboard/native.js';

async function withPreferences(desktop, run) {
  const preferences = await Preferences.open(desktop);
  try { await run(preferences); } finally { await preferences.close(); }
}

async function spin(desktop, preferences, row, value, key, expected = value) {
  await preferences.input(row, String(value));
  await desktop.key(Clutter.KEY_Return);
  await until(() => desktop.settings.get_value(key).deepUnpack() === expected,
    `native ${row} commits its configured value`);
}

function frame(desktop, preferences) {
  Main.activateWindow(preferences.window('Clipboard X Gnome'));
}

export const cases = {
  async 'SET-06-global-actions'(desktop) {
    const {ClipboardItem} = await import(`${desktop.app.dir.get_uri()}/clipboard/item.js`);
    const controller = desktop.app._controller;
    const settings = desktop.settings;
    const owned = [];
    const add = (text, favorite = false) => {
      const item = controller.add(ClipboardItem.fromText(text, {favorite}));
      owned.push(item);
      return item;
    };
    const press = async symbol => {
      assert(!desktop.indicator.menu.isOpen, 'Global shortcut must be exercised with the panel closed');
      await desktop.key(symbol, [Clutter.KEY_Control_L, Clutter.KEY_Shift_L]);
      await Scripting.waitLeisure();
    };
    const bind = async (privacy, clear) => {
      settings.set_strv('private-mode-shortcut', privacy);
      settings.set_strv('clear-history-shortcut', clear);
      await until(() => desktop.app._boundShortcuts.includes('private-mode-shortcut') === Boolean(privacy.length)
        && desktop.app._boundShortcuts.includes('clear-history-shortcut') === Boolean(clear.length),
      'Both requested global WM bindings become active or are removed');
    };
    try {
      await desktop.close();
      settings.set_boolean('private-mode', false);
      const pinned = add('Global shortcut keeps the pinned original', true);
      add('Global shortcut removes the ordinary original');
      await bind(['<Control><Shift>F6'], ['<Control><Shift>F7']);
      await press(Clutter.KEY_F6);
      await until(() => settings.get_boolean('private-mode'), 'Actual global shortcut enables privacy mode');
      await press(Clutter.KEY_F6);
      await until(() => !settings.get_boolean('private-mode'), 'The same global shortcut resumes capture');
      await press(Clutter.KEY_F7);
      await until(() => controller.items.length === 1 && controller.items[0] === pinned,
        'Actual global clear removes ordinary history and retains the pin');

      await bind([], []);
      const ordinary = add('Unbound old shortcut must leave this ordinary original alone');
      await press(Clutter.KEY_F6);
      await press(Clutter.KEY_F7);
      assert(!settings.get_boolean('private-mode') && controller.items.includes(ordinary),
        'Clearing the configured global shortcuts must disable both old key combinations');

      await bind(['<Control><Shift>F4'], ['<Control><Shift>F5']);
      await press(Clutter.KEY_F6);
      await press(Clutter.KEY_F7);
      assert(!settings.get_boolean('private-mode') && controller.items.includes(ordinary),
        'Rebinding global actions must not reactivate their old combinations');
      await press(Clutter.KEY_F4);
      await until(() => settings.get_boolean('private-mode'), 'Rebound global privacy shortcut takes effect');
      await press(Clutter.KEY_F4);
      await until(() => !settings.get_boolean('private-mode'), 'Rebound privacy shortcut toggles off again');
      await press(Clutter.KEY_F5);
      await until(() => controller.items.length === 1 && controller.items[0] === pinned,
        'Rebound global clear acts on the live history without removing pinned content');
      assert(!desktop.indicator.menu.isOpen, 'Global privacy and clear actions must not open the panel');
    } finally {
      settings.set_strv('private-mode-shortcut', []);
      settings.set_strv('clear-history-shortcut', []);
      settings.set_boolean('private-mode', false);
      for (const item of owned) controller.remove(item.id);
    }
  },

  // Representative native write paths, not another copy of the schema's full
  // range matrix: bool, enum, integer, scaled size, validated string and reopen.
  'SET-02': desktop => withPreferences(desktop, async preferences => {
    await preferences.page('clipboard');
    await preferences.click({type: 'AdwSwitchRow', row: 'Trim surrounding whitespace'});
    await until(() => desktop.settings.get_boolean('trim-whitespace'), 'native whitespace switch is live');
    await preferences.choice('Typing speed', 1);
    await until(() => desktop.settings.get_string('simulated-input-speed') === 'slow', 'native enum writes its value');
    await spin(desktop, preferences, 'History entries', 17, 'history-size');
    await preferences.page('sync');
    await spin(desktop, preferences, 'Text full-transfer threshold', 3, 'text-full-threshold', 3072);
    await spin(desktop, preferences, 'Large text preview', 0.25, 'text-preview-limit', 256);
    await spin(desktop, preferences, 'Image full-transfer threshold', 0.25, 'image-full-threshold', 262144);
    await preferences.page('screenshot');
    await preferences.input('Command', 'python3 -c "print(1)" %f');
    await until(() => desktop.settings.get_string('editor-command') === 'python3 -c "print(1)" %f',
      'native editor command writes a valid template');
    const target = await Target.open(desktop);
    try {
      await target.offer('  native setting actually trims this text  ');
      await until(() => desktop.app._controller.items.some(item => item.text === 'native setting actually trims this text'),
        'native trim setting applies to external clipboard content');
      const item = desktop.app._controller.items.find(value => value.text === 'native setting actually trims this text');
      assert(item.text === 'native setting actually trims this text', 'The native setting must change actual external capture');
    } finally { await target.close(); }
    await preferences.close();
    const reopened = await Preferences.open(desktop);
    try {
      await reopened.page('clipboard');
      await reopened.scrollTo({type: 'AdwSpinRow', row: 'History entries'});
      assert((await reopened.find({type: 'AdwSpinRow', row: 'History entries'})).widget.value === 17,
        'A separate preferences process must read the saved native edit');
      await reopened.page('sync');
      for (const row of ['Large text preview', 'Image full-transfer threshold']) {
        await reopened.scrollTo({type: 'AdwSpinRow', row});
        assert((await reopened.find({type: 'AdwSpinRow', row})).widget.value === 0.25,
          `${row} must restore the saved fractional display unit in a new preferences process`);
      }
      const previewRow = (await reopened.translate({row: 'Large text preview'})).row;
      const imageRow = (await reopened.translate({row: 'Image full-transfer threshold'})).row;
      const observed = async (row, value) => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const snapshot = await reopened.inspect();
          if (snapshot.windows[0].widgets.some(widget => widget.type === 'AdwSpinRow'
            && widget.row === row && widget.value === value)) return snapshot;
          await pause(20);
        }
        throw new Error(`External settings update must refresh the native ${row} value to ${value}`);
      };
      desktop.settings.set_uint('text-preview-limit', 768);
      let snapshot = await observed(previewRow, 0.75);
      assert(snapshot.settings['text-preview-limit'] === 768
        && snapshot.settings['image-full-threshold'] === 262144
        && desktop.settings.get_uint('image-full-threshold') === 262144,
      'External KB refresh must preserve the exact bytes and leave the MB setting unchanged');
      // Preserve a valid non-rounded byte count rather than silently replacing
      // it with the two-decimal display value during the external refresh.
      const imageBytes = 524289;
      desktop.settings.set_uint('image-full-threshold', imageBytes);
      snapshot = await observed(imageRow, imageBytes / (1024 * 1024));
      assert(snapshot.settings['image-full-threshold'] === imageBytes
        && desktop.settings.get_uint('image-full-threshold') === imageBytes
        && snapshot.settings['text-preview-limit'] === 768
        && desktop.settings.get_uint('text-preview-limit') === 768
        && snapshot.settings['text-full-threshold'] === 3072,
      'External MB refresh must not round and write back its byte count or overwrite another size setting');
      await spin(desktop, reopened, 'Image full-transfer threshold', 0.75, 'image-full-threshold', 786432);
      assert(desktop.settings.get_uint('text-preview-limit') === 768,
        'The refreshed size control must remain editable without changing the other setting');
    } finally { await reopened.close(); }
  }),

  'SET-04': desktop => withPreferences(desktop, async preferences => {
    await spin(desktop, preferences, 'Panel width', 470, 'panel-width');
    await spin(desktop, preferences, 'Panel height', 520, 'panel-height');
    await spin(desktop, preferences, 'Maximum entries shown in panel', 2, 'panel-visible-item-limit');
    const target = await Target.open(desktop);
    try {
      for (const text of ['native limit one', 'native limit two', 'native limit three']) await capture(desktop, target, text);
      await desktop.open();
      await until(() => desktop.history._itemRows.size === 2, 'actual rendered entry limit updates from the settings UI');
      assert(desktop.history.actor.width <= 470 && desktop.history.actor.height <= 520,
        'Actual panel must remain within the native width and height settings');
      await desktop.close();
      frame(desktop, preferences);
      await spin(desktop, preferences, 'Maximum entries shown in panel', 3, 'panel-visible-item-limit');
      await desktop.open();
      await until(() => desktop.history._itemRows.size === 3, 'increasing the native limit reveals the retained third item');
    } finally { await target.close(); }
  }),

  'SET-05': desktop => withPreferences(desktop, async preferences => {
    await preferences.scrollTo({type: 'GtkSwitch', row: 'Screenshot'});
    await preferences.click({type: 'GtkSwitch', row: 'Screenshot'});
    await until(() => desktop.settings.get_strv('panel-hidden-actions').includes('screenshot')
      && !desktop.history.screenshotButton.get_parent(), 'native layout hides the screenshot action');
    await preferences.scrollTo({type: 'GtkButton', row: 'Quick phrases', tooltip: 'Move to footer'});
    await preferences.click({type: 'GtkButton', row: 'Quick phrases', tooltip: 'Move to footer'});
    await until(() => desktop.settings.get_strv('panel-footer-actions').includes('quick-phrases')
      && !desktop.settings.get_strv('panel-toolbar-actions').includes('quick-phrases'), 'native layout moves an action between regions');
    await preferences.scrollTo({type: 'GtkButton', row: 'Quick phrases', tooltip: 'Move up'});
    const previous = desktop.settings.get_strv('panel-footer-actions').indexOf('quick-phrases');
    await preferences.click({type: 'GtkButton', row: 'Quick phrases', tooltip: 'Move up'});
    await until(() => desktop.settings.get_strv('panel-footer-actions').indexOf('quick-phrases') === previous - 1,
      'native layout reorders the actual action configuration');
    await preferences.scrollTo({type: 'GtkSwitch', row: 'Pin'});
    await preferences.click({type: 'GtkSwitch', row: 'Pin'});
    await until(() => desktop.settings.get_strv('entry-hidden-actions').includes('pin'), 'native entry icon visibility is saved');
    const target = await Target.open(desktop);
    try {
      const item = await capture(desktop, target, 'Hidden pin button keeps its keyboard action');
      await desktop.open();
      const row = desktop.history._itemRows.get(item.id);
      assert(!row.focusActors.some(actor => actor._clipboardXGnomeEntryAction === 'pin'), 'The native entry layout must hide the actual pin icon');
      await desktop.key(Clutter.KEY_Down);
      await desktop.key(Clutter.KEY_p);
      await until(() => item.favorite, 'hidden pin icon does not disable its contextual keyboard command');
      const action = desktop.history._actionButtons.get('quick-phrases');
      assert(desktop.history.footer.contentActors.includes(action), 'Moved action must actually render in the footer');
      await desktop.click(action);
      await until(() => desktop.manager.is('phrases'), 'moved footer action remains usable');
    } finally { await target.close(); }
  }),

  'SET-07': desktop => withPreferences(desktop, async preferences => {
    const target = await Target.open(desktop);
    try {
      await preferences.page('clipboard');
      frame(desktop, preferences);
      await preferences.input('Excluded applications', `Unrelated.Class, ${target.window.get_wm_class()}`);
      await until(() => desktop.settings.get_strv('excluded-apps').includes(target.window.get_wm_class()),
        'manual window class entry is saved');
      const revision = desktop.app._controller.selectionRevision;
      await target.offer('excluded by the native preferences input');
      await until(() => desktop.app._controller.selectionRevision > revision
        && !desktop.app._controller._captureInProgress && !desktop.app._controller._captureQueued,
      'excluded source owner change finishes');
      assert(!desktop.app._controller.items.some(item => item.text === 'excluded by the native preferences input'),
        'Manual native exclusion must affect real focused-application clipboard capture');
      frame(desktop, preferences);
      await preferences.input('Excluded applications', '');
      await capture(desktop, target, 'capture resumes after the native exclusion is removed');
      frame(desktop, preferences);
      await preferences.scrollTo({type: 'GtkButton', tooltip: 'Refresh running applications'});
      await preferences.click({type: 'GtkButton', tooltip: 'Refresh running applications'});
      const translated = await preferences.translate({row: 'Running application'});
      let choices;
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = await preferences.inspect();
        choices = state.windows[0].widgets.find(widget => widget.type === 'AdwComboRow' && widget.row === translated.row)?.choices ?? [];
        if (choices.some(value => value.includes(target.window.get_wm_class()))) break;
        await pause(30);
      }
      const index = choices.findIndex(value => value.includes(target.window.get_wm_class()));
      assert(index >= 0, 'Refreshing the native chooser must discover the actual independent target window');
      await preferences.choice('Running application', index);
      await preferences.click({type: 'GtkButton', tooltip: 'Exclude selected application'});
      await until(() => desktop.settings.get_strv('excluded-apps').includes(target.window.get_wm_class()),
        'choosing an actual running application adds the same effective exclusion');
      await restart(desktop, async () => {
        frame(desktop, preferences);
        await preferences.click({type: 'GtkButton', tooltip: 'Refresh running applications'});
        const unavailable = (await preferences.translate({label: 'Enable the extension to choose running applications'})).label;
        let disabled = false;
        for (let attempt = 0; attempt < 150; attempt++) {
          const state = await preferences.inspect();
          const row = state.windows[0].widgets.find(widget => widget.type === 'AdwComboRow' && widget.row === translated.row);
          disabled = row?.choices.includes(unavailable)
            && state.windows[0].widgets.some(widget => widget.tooltip === (preferences.translations.get('Exclude selected application')) && !widget.sensitive);
          if (disabled) break;
          await pause(30);
        }
        assert(disabled, 'A real unavailable Shell bridge must leave manual entry usable and disable only application selection');
        await preferences.input('Excluded applications', 'Offline.Manual');
      });
      assert(desktop.settings.get_strv('excluded-apps').includes('Offline.Manual'), 'Manual exclusions remain editable without the extension bridge');
    } finally { await target.close(); }
  }),

  'SET-09': desktop => withPreferences(desktop, async preferences => {
    const output = `${GLib.getenv('CBX_SIMULATION_RUNTIME')}/about-uris.json`;
    const receiver = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
      .get_child('fixtures').get_child('uri-receiver.py').get_path();
    const command = ['python3', receiver, output].map(value => GLib.shell_quote(value)).join(' ');
    const handler = Gio.AppInfo.create_from_commandline(command, 'Clipboard X Private Link Receiver', Gio.AppInfoCreateFlags.SUPPORTS_URIS);
    for (const scheme of ['http', 'https']) {
      assert(handler.set_as_default_for_type(`x-scheme-handler/${scheme}`), 'Private URI handler must register successfully');
      assert(Gio.AppInfo.get_default_for_uri_scheme(scheme)?.get_id() === handler.get_id(),
        'Refuse to open external URLs unless the isolated handler is the actual default');
    }
    const read = () => {
      if (!GLib.file_test(output, GLib.FileTest.EXISTS)) return [];
      return JSON.parse(new TextDecoder().decode(GLib.file_get_contents(output)[1]));
    };
    await preferences.page('about');
    const website = desktop.app.metadata.url.replace(/\/$/u, '');
    for (const [title, uri] of [['Project website', website], ['Report an issue', `${website}/issues`],
      ['License', 'https://www.gnu.org/licenses/gpl-3.0.html']]) {
      await preferences.click({type: 'AdwActionRow', row: title});
      for (let attempt = 0; attempt < 5 && !read().includes(uri); attempt++) {
        await pause(200);
        // Some OpenURI portal versions confirm the selected private default.
        // Never choose an installed host browser as a fallback.
        if (global.display.focus_window !== preferences.window('Clipboard X Gnome'))
          await desktop.key(Clutter.KEY_o, [Clutter.KEY_Alt_L]);
      }
      await until(() => read().includes(uri), `actual native About row launches ${title} through the private default handler`, 10000);
    }
    assert(read().length === 3, 'Every About link must launch exactly one external URI without contacting its network destination');
  }),
};
