import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {assert, until} from '../helpers/desktop.js';

export const cases = {
  async 'CONN-07'(desktop) {
    const {ClipboardItem} = await import(`${desktop.app.dir.get_uri()}/clipboard/item.js`);
    const {deviceIcon} = await import(`${desktop.app.dir.get_uri()}/ui/icons/device.js`);
    const controller = desktop.app._controller;
    const current = desktop.settings.get_string('device-id');
    const local = ClipboardItem.fromText('Device marker: current UUID', {originDeviceId: current});
    const implicit = ClipboardItem.fromText('Device marker: unspecified local UUID');
    const remote = (name, icon) => ClipboardItem.fromText(`Device marker: ${name}`, {
      originDeviceId: GLib.uuid_string_random(), originDeviceTag: name, originDeviceIconKind: icon, remote: true,
    });
    const laptop = remote('Laptop source', 'laptop');
    const android = remote('Android source', 'android');
    const unknown = remote('Other client source', 'client-owned-icon-name');
    const items = [local, implicit, laptop, android, unknown];
    const marker = item => {
      const row = desktop.history._itemRows.get(item.id);
      assert(row, 'Every seeded controller item must render in the real history');
      return row.focusActors[0].get_child().get_children().filter(actor =>
        actor.has_style_class_name?.('cbx-device-icon'));
    };
    const check = () => {
      for (const item of [local, implicit])
        assert(marker(item).length === 0, 'Current-device and unspecified local origins must omit a device marker');
      for (const [item, name] of [[laptop, laptop.originDeviceIconKind], [android, android.originDeviceIconKind], [unknown, 'computer']]) {
        const icons = marker(item);
        assert(icons.length === 1 && icons[0] instanceof St.Icon
          && icons[0].gicon instanceof Gio.FileIcon && icons[0].gicon.file.equal(deviceIcon(name).file),
        `${item.originDeviceTag} must render its own packaged device icon, with unknown strings falling back to computer`);
      }
    };
    try {
      for (const item of items) controller.add(item);
      await desktop.open();
      await until(() => items.every(item => desktop.history._itemRows.has(item.id)), 'mixed-device history rows');
      check();
      // Persistence normalizes empty local UUIDs. Exercise the empty-origin
      // presentation branch synchronously before the next asynchronous save.
      implicit.originDeviceId = '';
      desktop.history.render();
      assert(implicit.originDeviceId === '', 'Empty-origin fixture must reach the renderer unchanged');
      check();
      const previous = desktop.history._itemRows.get(laptop.id);
      laptop.originDeviceIconKind = 'android';
      android.originDeviceIconKind = 'laptop';
      controller.update(laptop);
      await until(() => desktop.history._itemRows.get(laptop.id) !== previous, 'controller update rebuilds source markers');
      check();
      await desktop.close();
      await desktop.open();
      check();
    } finally {
      await desktop.close();
      for (const item of items) controller.remove(item.id);
    }
  },

  async 'XFER-01'(desktop) {
    const base = desktop.app.dir.get_uri();
    const {ClipboardItem} = await import(`${base}/clipboard/item.js`);
    const {SyncAction} = await import(`${base}/ui/panels/history/sync-action.js`);
    const {ProgressRing} = await import(`${base}/ui/panels/history/progress-ring.js`);
    const {IconButton} = await import(`${base}/ui/controls/icon-button.js`);
    const translate = text => desktop.app.gettext(text);
    // A real, private GSettings backend drives the control without enabling
    // production networking or substituting a test for the server integration.
    const settings = new Gio.Settings({settings_schema: desktop.settings.settings_schema,
      backend: Gio.memory_settings_backend_new()});
    settings.set_boolean('sync-enabled', true);
    const transfers = new Map();
    const calls = [];
    const activationErrors = [];
    const failures = [];
    const actions = {
      transferForItem: id => transfers.get(id),
      publish: async item => { calls.push(`publish:${item.id}`); },
      materializeItem: async item => { calls.push(`original:${item.id}`); },
      cancelTransfer: async id => { calls.push(`cancel:${id}`); },
      openPreferences: () => { calls.push('preferences'); },
    };
    const sync = new SyncAction({settings, actions,
      closeMenu: () => { calls.push('close'); },
      createIconButton: (iconName, label, onActivate, options = {}) => new IconButton({
        iconName, label, onActivate, selectable: options.stateful,
        onError: error => activationErrors.push(error.message),
      }),
    });
    const host = new St.BoxLayout({x: 200, y: 180, style: 'spacing: 16px; padding: 12px;'});
    host.add_child(sync.statusButton);
    const local = ClipboardItem.fromText('Local presentation fixture');
    const snapshot = ClipboardItem.fromText('Published snapshot fixture');
    snapshot.primary.delivery = 'on-demand';
    const original = ClipboardItem.fromText('Remote original fixture', {remote: true});
    const missing = ClipboardItem.fromText('Remote preview fixture', {remote: true, availability: 'preview'});
    missing.primary.bytes = null;
    const transfer = (state, options = {}) => ({transferId: GLib.uuid_string_random(),
      direction: 'download', kind: 'content', state, completedBytes: 0, totalBytes: 0, ...options});
    const icon = (button, expected) => assert(button.get_child() instanceof St.Icon
      && button.get_child().icon_name === expected,
    `Expected ${expected}, got ${button.get_child()} (${button.hint})`);
    const hint = (button, text) => assert(button.hint === translate(text), `Unexpected action hint: ${button.hint}`);
    const ready = async button => {
      await Scripting.waitLeisure();
      await until(() => button.mapped && button.has_allocation()
        && button.get_transformed_position().every(Number.isFinite)
        && button.get_transformed_size().every(value => Number.isFinite(value) && value > 0),
      'transfer control allocated on the actual stage');
    };
    const click = async button => {
      // Progress refresh replaces the child actor, invalidating its layout.
      await ready(button);
      let observed = false;
      const signal = button.connect('clicked', () => { observed = true; });
      try {
        await desktop.click(button);
        await until(() => observed, 'real pointer click reaches the transfer control');
        await Scripting.waitLeisure();
      } finally { button.disconnect(signal); }
    };
    const run = async (name, item, state, verify, expected) => {
      let button;
      calls.length = 0;
      activationErrors.length = 0;
      transfers.clear();
      if (state) transfers.set(item.id, state);
      try {
        button = sync.button(item);
        host.add_child(button);
        await ready(button);
        // Collect presentation and action evidence independently: a wrong icon
        // must not prevent the native click for this state or later states.
        try {
          await verify(button);
          print(`[simulation] XFER-01 ${name} presentation PASS`);
        } catch (error) {
          failures.push(`${name} presentation: ${error.message}`);
          printerr(`[simulation] XFER-01 ${name} presentation FAIL: ${error.message}`);
        }
        await click(button);
        assert(calls.join('|') === expected.join('|'), `${name} action must be ${expected}, got ${calls}`);
        assert(activationErrors.length === 0, `${name} activation errors: ${activationErrors}`);
        print(`[simulation] XFER-01 ${name} action PASS`);
      } catch (error) { failures.push(`${name}: ${error.message}`); }
      finally { button?.destroy(); }
    };
    Main.layoutManager.addTopChrome(host);
    try {
      await ready(sync.statusButton);
      await run('unsent', local, null, button => {
        icon(button, 'network-transmit-receive-symbolic'); hint(button, 'Send to synchronization server');
      }, [`publish:${local.id}`]);
      for (const direction of ['upload', 'download']) {
        const state = transfer('transferring', {direction, completedBytes: 25, totalBytes: 100});
        await run(`active-${direction}`, local, state, button => {
          assert(button.get_child() instanceof ProgressRing && button.get_child()._progress === 0.25,
            'Known actual byte counts must render the precise native progress ring');
          assert(button.hint === `${translate(direction === 'upload' ? 'Uploading' : 'Downloading')} · 25%`,
            'Progress hint must identify direction and actual percentage');
          state.completedBytes = 75;
          sync.refresh(local.id);
          assert(button.get_child() instanceof ProgressRing && button.get_child()._progress === 0.75
            && button.hint.endsWith('75%'), 'Refreshing actual transfer state must update progress without replacing the button');
        }, [`cancel:${state.transferId}`]);
      }
      for (const totalBytes of [0, 100]) {
        const state = transfer('waiting-for-peer', {totalBytes});
        await run(`waiting-total-${totalBytes}`, missing, state, button => {
          icon(button, 'content-loading-symbolic'); hint(button, 'Waiting for peer device');
          assert(!(button.get_child() instanceof ProgressRing) && !button.hint.includes('%'),
            'Waiting for the source must not invent a download percentage even when its size is known');
        }, [`cancel:${state.transferId}`]);
      }
      const queued = transfer('queued');
      await run('preparing', missing, queued, button => {
        icon(button, 'content-loading-symbolic'); hint(button, 'Preparing transfer');
      }, [`cancel:${queued.transferId}`]);
      const verifying = transfer('verifying', {completedBytes: 100, totalBytes: 100});
      await run('verifying', missing, verifying, button => {
        assert(button.get_child() instanceof ProgressRing && button.get_child()._progress === 1,
          'Fully received bytes may show 100% while verification is still active, not a completion check');
      }, [`cancel:${verifying.transferId}`]);
      await run('snapshot-published', snapshot, transfer('completed', {direction: 'upload', kind: 'publish'}), button => {
        const child = button.get_child();
        const expected = desktop.app.dir.resolve_relative_path('ui/icons/sync/preview-synced-symbolic.svg');
        assert(child instanceof St.Icon && child.gicon instanceof Gio.FileIcon && child.gicon.file.equal(expected),
          'A published lazy snapshot must render the packaged preview-complete icon');
        hint(button, 'Upload completed');
      }, [`publish:${snapshot.id}`]);
      await run('local-full-published', local, transfer('completed', {direction: 'upload', kind: 'publish'}), button => {
        icon(button, 'object-select-symbolic'); hint(button, 'Upload completed');
      }, [`publish:${local.id}`]);
      await run('remote-original-local', original, null, button => {
        icon(button, 'object-select-symbolic'); hint(button, 'Original is available locally');
      }, []);
      await run('remote-preview', missing, null, button => {
        icon(button, 'folder-download-symbolic'); hint(button, 'Download original');
      }, [`original:${missing.id}`]);
      for (const state of ['failed', 'expired'])
        await run(state, missing, transfer(state, {errorCode: 'download_failed'}), button => {
          icon(button, 'view-refresh-symbolic'); hint(button, 'Synchronization download failed');
        }, [`original:${missing.id}`]);
      await run('cancelled', missing, transfer('cancelled'), button => {
        icon(button, 'folder-download-symbolic'); hint(button, 'Download original');
      }, [`original:${missing.id}`]);
      settings.set_boolean('sync-enabled', false);
      await run('sync-disabled', local, null, button => {
        icon(button, 'network-offline-symbolic'); hint(button, 'Synchronization is disabled');
      }, ['close', 'preferences']);
      for (const failure of failures) printerr(`[simulation] XFER-01 FAIL ${failure}`);
      assert(failures.length === 0, `Transfer presentation/action failures (${failures.length}): ${failures.join('; ')}`);
    } finally {
      sync.destroy();
      Main.layoutManager.removeChrome(host);
      host.destroy();
    }
  },
};
