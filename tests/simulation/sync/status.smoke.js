import GLib from 'gi://GLib';
import St from 'gi://St';
import {assert} from '../helpers/checks.js';
import {runChecks} from '../helpers/run.js';

export async function status(indicator, extensionObject) {
  const {ClipboardItem} = await import(`${extensionObject.dir.get_uri()}/clipboard/item.js`);
  const item = indicator._controller.add(ClipboardItem.fromText('Transfer status fixture'));
  const history = indicator._historyPanel;
  const deviceId = indicator._settings.get_string('device-id');
  try {
    indicator._settings.set_boolean('sync-enabled', true);
    indicator._settings.set_string('sync-send-mode', 'manual');
    const transferId = GLib.uuid_string_random();
    const transfer = {
      transferId,
      itemId: item.id,
      deviceId,
      kind: 'content',
      direction: 'download',
      state: 'transferring',
      completedBytes: 50,
      totalBytes: 100,
      peerDeviceIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      errorCode: '',
      errorMessage: '',
    };
    const progressButton = history._sync.button(item);
    extensionObject._sync._transfers.receive(transfer);
    assert(progressButton.get_child() instanceof St.DrawingArea && progressButton.hint.includes('50%'),
      'Exact per-item transfer progress was not rendered as a ring');
    progressButton.destroy();
    indicator._settings.set_boolean('sync-enabled', false);
    assert(!extensionObject._sync.getTransferForItem(item.id),
      'Restarted synchronization must clear authoritative transfer state');
    indicator._settings.set_boolean('sync-enabled', true);
    const retryButton = history._sync.button(item);
    assert(!(retryButton.get_child() instanceof St.DrawingArea),
      'A newly rendered button must not inherit progress from the previous transfer session');
    retryButton.destroy();
  } finally {
    indicator._controller.remove(item.id);
    indicator.menu.close();
  }
}

export function run() {
  return runChecks([['status', status]]);
}
