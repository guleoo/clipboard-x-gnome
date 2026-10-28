import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import {assert, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {Server} from '../helpers/server.js';
import {restart} from '../helpers/restart.js';
import {capture} from '../clipboard/native.js';
import {openPhrases} from '../phrases/native.js';
import {withCleanup} from '../helpers/resources.js';

async function fixture(desktop, run) {
  let server;
  let target;
  return withCleanup(async () => {
    server = await Server.open(desktop);
    target = await Target.open(desktop);
    await server.enable();
    desktop.settings.set_string('sync-send-mode', 'automatic');
    await run({server, target});
  }, () => [target, server]);
}
async function polls(desktop) {
  const sync = desktop.app._sync;
  let count = 0;
  const signal = sync.connect('poll-completed', () => count++);
  try { await until(() => count >= 2, 'two real server poll cycles', 15000); }
  finally { sync.disconnect(signal); }
}

export const cases = {
  'PHRASE-08': desktop => fixture(desktop, async ({target, server}) => {
    const phrase = 'Saved locally without publishing the phrase store';
    await openPhrases(desktop);
    await desktop.click(desktop.phrases.addButton);
    await desktop.type(phrase);
    await desktop.key(Clutter.KEY_Return);
    await until(() => desktop.phrases.phrases.includes(phrase), 'native phrase stored');
    const item = await capture(desktop, target, 'normal automatic synchronization proves active connection');
    await until(() => desktop.app._sync.getTransferForItem(item.id)?.state === 'completed', 'ordinary history really uploaded', 20000);
    await desktop.open();
    await desktop.click(desktop.history.clearButton);
    await until(() => !desktop.app._controller.items.length, 'native clear-history action');
    assert(desktop.phrases.phrases.includes(phrase), 'Clearing history must not clear separately stored phrases');
    await restart(desktop);
    await until(() => desktop.app._sync.ready, 'restart with active server', 15000);
    await polls(desktop);
    assert(desktop.phrases.phrases.includes(phrase), 'Actual extension restart preserves local phrases');
    assert(!(await server.items()).items.some(value => JSON.stringify(value).includes(phrase)),
      'Storing and restoring a quick phrase must not publish it as clipboard history');
  }),

  'PRIV-08': desktop => fixture(desktop, async ({target, server}) => {
    const publicItem = await capture(desktop, target, 'Public control creates an actual durable outbox');
    await until(() => desktop.app._sync.getTransferForItem(publicItem.id)?.state === 'completed', 'public control really synchronized', 20000);
    const secret = 'SYNTHETIC-NATIVE-PRIVATE-DO-NOT-PERSIST';
    desktop.settings.set_string('sensitive-content-mode', 'memory');
    await target.offer(secret, {'application/x-keepass2': new TextEncoder().encode('1')});
    await until(() => desktop.app._controller.items.some(value => value.text === secret && value.sensitive), 'real sensitive source in memory');
    await polls(desktop);
    assert(!(await server.items()).items.some(value => JSON.stringify(value).includes(secret)), 'Automatic sync must not send memory-only sensitive content');
    for (const queue of desktop.app._uploadQueue._queues.values()) {
      const [, bytes] = Gio.File.new_for_path(queue.path).load_contents(null);
      const document = new TextDecoder().decode(bytes);
      assert(!document.includes(secret) && !document.includes(server.identity.key), 'Durable upload metadata must contain neither sensitive body nor API key');
    }
    const restored = await desktop.app._controller._store.load();
    assert(!restored.some(value => value.text === secret || value.sensitive), 'Memory-only sensitive capture must remain absent from durable history');
  }),
};
