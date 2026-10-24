import GLib from 'gi://GLib';
import St from 'gi://St';
import {assert, waitUntil} from '../helpers/checks.js';
import {runChecks} from '../helpers/run.js';

export async function receiving(indicator, extensionObject) {
  const {ClipboardItem} = await import(`${extensionObject.dir.get_uri()}/clipboard/item.js`);
  const history = indicator._controller;
  const sync = extensionObject._sync;
  const getItem = sync.getItem;
  const materialize = sync.materialize;
  const item = ClipboardItem.fromText('received content reaches the real history panel', {
    originDeviceId: GLib.uuid_string_random(), remote: true, availability: 'preview',
  });
  item.primary.bytes = null;
  try {
    indicator._settings.set_string('sync-receive-mode', 'history');
    sync.getItem = async () => item;
    sync.materialize = async value => {
      value.primary.bytes = new GLib.Bytes(new TextEncoder().encode(value.preview.text));
      value.availability = 'ready';
    };
    await extensionObject._sync._applyChanges(
      [{kind: 'upsert', itemId: item.id}], {isCurrent: () => true},
    );
    assert(await waitUntil(() => item.availability === 'ready' && history.items.includes(item)),
      'The synchronization receiver was not wired to the real history');
    assert(history.search(item.text).some(value => value === item),
      'Received content must be exposed through the same searchable history as local content');
    indicator.menu.open();
    indicator._historyPanel.searchEntry.set_text(item.text);
    const displays = actor => actor instanceof St.Label && actor.text === item.text
      || actor.get_children().some(displays);
    assert(await waitUntil(() => displays(indicator._historyPanel._section.actor)),
      'The history panel did not display received content');

    // Only this narrow check needs the actual Controller. The async receiver
    // and storage cases live in the isolated content integration test.
    indicator._settings.set_int('cache-size-mib', 16);
    const oversized = ClipboardItem.fromText('lazy original exceeds local capacity', {
      originDeviceId: GLib.uuid_string_random(), remote: true, availability: 'preview',
    });
    oversized.primary.bytes = null;
    oversized.primary.size = 17 * 1024 * 1024;
    history.add(oversized, 'remote');
    assert(history.items.includes(oversized), 'A lightweight snapshot should fit before download');
    oversized.primary.bytes = new GLib.Bytes(new Uint8Array([1]));
    oversized.availability = 'ready';
    assert(!history.commitContent(oversized) && !history.items.includes(oversized),
      'Committing downloaded originals must immediately reapply the storage budget');
  } finally {
    sync.getItem = getItem;
    sync.materialize = materialize;
    history.remove(item.id);
    indicator._historyPanel.searchEntry.set_text('');
    indicator.menu.close();
  }
}

export function run() {
  return runChecks([['receiving', receiving]]);
}
