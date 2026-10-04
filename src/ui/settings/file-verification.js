import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {check} from '../../sync/http/file-verifier.js';
import {message} from '../../sync/errors.js';
import {disconnectWhenUnrooted} from './lifecycle.js';

const KEY = 'sync-use-sha256sum';

export function create(settings, _) {
  const row = new Adw.SwitchRow({
    title: _('Use sha256sum for file verification'),
    subtitle: _('Reduces memory use for large downloads; requires sha256sum and reads each downloaded file again.'),
  });
  const disconnect = bind(settings, row, {onError: error => {
    const dialog = new Adw.AlertDialog({heading: row.title, body: message(error, _)});
    dialog.add_response('close', _('Close'));
    dialog.set_default_response('close');
    dialog.set_close_response('close');
    dialog.present(row.get_root());
  }});
  disconnectWhenUnrooted(row, disconnect);
  return row;
}

// Do not bind active bidirectionally: enabling must pass the dependency check first.
export function bind(settings, row, {checkDependency = check, onError = () => {}} = {}) {
  let updating = false;
  let disposed = false;
  let operation = null;
  const render = () => {
    updating = true;
    row.active = settings.get_boolean(KEY);
    updating = false;
  };
  render();
  const settingsSignal = settings.connect(`changed::${KEY}`, () => {
    operation?.cancel();
    operation = null;
    render();
    row.sensitive = true;
  });
  const rowSignal = row.connect('notify::active', async () => {
    if (updating || disposed)
      return;
    if (!row.active) {
      operation?.cancel();
      operation = null;
      settings.set_boolean(KEY, false);
      row.sensitive = true;
      return;
    }
    const cancellable = new Gio.Cancellable();
    operation = cancellable;
    row.sensitive = false;
    try {
      await checkDependency(cancellable);
      if (disposed || operation !== cancellable || cancellable.is_cancelled())
        return;
      operation = null;
      settings.set_boolean(KEY, true);
    } catch (error) {
      if (!disposed && operation === cancellable && !cancellable.is_cancelled())
        onError(error);
    } finally {
      if (!disposed && (operation === cancellable || operation === null)) {
        operation = null;
        render();
        row.sensitive = true;
      }
    }
  });
  return () => {
    disposed = true;
    operation?.cancel();
    settings.disconnect(settingsSignal);
    row.disconnect(rowSignal);
  };
}
