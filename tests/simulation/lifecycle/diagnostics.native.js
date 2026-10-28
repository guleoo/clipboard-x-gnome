import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, pause, until} from '../helpers/desktop.js';

function notifications() {
  return Main.messageTray.getSources().flatMap(source => source.notifications)
    .filter(notification => notification.title === 'Clipboard X Gnome');
}

export const cases = {
  async 'LANG-07-errors'(desktop) {
    const {SyncError} = await import(`${desktop.app.dir.get_uri()}/sync/errors.js`);
    const secret = 'SYNTHETIC-CLIPBOARD-CONTENT-AND-API-KEY';
    const created = [];
    const inputs = [
      [new SyncError('invalid_key', secret), 'Synchronization authentication failed'],
      [new Error(secret, {cause: new Error(secret)}), 'Operation failed'],
    ];
    const file = Gio.File.new_for_path(`${GLib.getenv('CBX_SIMULATION_RUNTIME')}/missing-native-error-file`);
    let native;
    try { file.load_contents(null); } catch (error) { native = error; }
    assert(native instanceof GLib.Error, 'The notification path must include an exception actually thrown by Gio');
    inputs.push([native, 'Operation failed']);
    try {
      for (const [error, key] of inputs) {
        const before = new Set(notifications());
        desktop.app._reportError(error);
        await until(() => notifications().some(value => !before.has(value)), 'actual GNOME error notification');
        const added = notifications().filter(value => !before.has(value));
        created.push(...added);
        assert(added.length === 1 && added[0].body === desktop.app.gettext(key),
          'Each failure must emit one safe, localized notification through the real Shell outlet');
        assert(!`${added[0].title} ${added[0].body}`.includes(secret),
          'Clipboard content, API keys and server diagnostics must never be shown to users');
        added[0].destroy();
      }
      const cancellable = new Gio.Cancellable();
      cancellable.cancel();
      let cancelled;
      try { file.load_contents(cancellable); } catch (error) { cancelled = error; }
      assert(cancelled?.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED),
        'Cancellation must come from the actual Gio API, not a fake matcher');
      const before = new Set(notifications());
      desktop.app._reportError(cancelled);
      await pause(100);
      assert(notifications().every(value => before.has(value)), 'User cancellation must emit no error notification');
    } finally {
      for (const notification of created)
        if (notifications().includes(notification)) notification.destroy();
    }
  },
};
