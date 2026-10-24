import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {assert, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {Server} from '../helpers/server.js';
import {Gate} from '../helpers/gate.js';
import {restart} from '../helpers/restart.js';
import {capture} from '../clipboard/native.js';
import {withCleanup} from '../helpers/resources.js';

async function fixture(desktop, run) {
  let server;
  let gate;
  let target;
  return withCleanup(async () => {
    server = await Server.open(desktop);
    gate = await Gate.open(server.address);
    await server.configure(server.channel.id, server.identity.key, gate.address);
    target = await Target.open(desktop);
    await server.enable();
    await run({server, gate, target});
  }, () => [target, server, gate]);
}
async function submit(desktop, item) {
  await desktop.open();
  await desktop.click(desktop.history._itemRows.get(item.id).focusActors
    .find(actor => actor._clipboardXGnomeEntryAction === 'sync'));
}
function documents(desktop) {
  return [...desktop.app._uploadQueue._queues.values()].map(queue => {
    const [, bytes] = Gio.File.new_for_path(queue.path).load_contents(null);
    return JSON.parse(new TextDecoder().decode(bytes));
  });
}
async function confirmed(desktop, id) {
  await until(() => desktop.app._sync.getTransferForItem(id)?.state === 'completed'
    && !documents(desktop).some(document => document.entries.some(entry => entry.itemId === id)),
  'actual server confirmation removes durable pending intent', 30000);
}

export const cases = {
  'SEND-04': desktop => fixture(desktop, async ({server, gate, target}) => {
    desktop.settings.set_uint('text-full-threshold', 4096);
    const item = await capture(desktop, target, 'Frozen manifest survives interruption and threshold edits');
    gate.set({path: '/channels/[^/]+/items$', hold: true});
    await submit(desktop, item);
    await until(() => gate.state.requests.some(value => value.method === 'POST' && value.stage === 'held'),
      'first real publication request held before server accepts it');
    const frozen = documents(desktop).flatMap(document => document.publications).find(value => value.itemId === item.id);
    const path = [...desktop.app._uploadQueue._queues.values()].find(queue =>
      [...queue.entries.values()].some(value => value.itemId === item.id)).path;
    assert(frozen?.manifest.contents.every(value => value.delivery === 'eager'),
      'A durable frozen manifest must already exist before the first network publication');
    await server.disable();
    desktop.settings.set_uint('text-full-threshold', 1);
    await restart(desktop);
    const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
    const durable = JSON.parse(new TextDecoder().decode(bytes)).publications.find(value => value.itemId === item.id);
    assert(JSON.stringify(durable?.manifest) === JSON.stringify(frozen.manifest), 'Actual restart must retain the exact frozen request');
    gate.set({});
    await server.enable();
    await confirmed(desktop, item.id);
    assert((await server.item(item.id)).contents.every(value => value.delivery === 'eager' && value.availability === 'available'),
      'Retry must honor the original eager manifest even after the configured threshold changes');
  }),

  'SEND-07': desktop => fixture(desktop, async ({server, gate, target}) => {
    const item = await capture(desktop, target, 'Committed publication with a deliberately lost HTTP response');
    gate.set({path: '/uploads/[^/]+/complete$', dropOnce: GLib.uuid_string_random()});
    await submit(desktop, item);
    await until(() => gate.state.requests.some(value => value.stage === 'response-dropped'), 'real server completion response deliberately dropped', 15000);
    assert((await server.item(item.id)).id === item.id, 'Server really committed before the response was lost');
    gate.set({});
    await confirmed(desktop, item.id);
    const uploads = gate.state.requests.filter(value => value.method === 'PUT' && value.path.includes('/contents/'));
    assert(uploads.length === 1 && (await server.items()).items.filter(value => value.id === item.id).length === 1,
      'Lost response recovery must confirm the existing item without re-uploading original bytes');
  }),

  'SEND-08': desktop => fixture(desktop, async ({server, gate, target}) => {
    const item = await capture(desktop, target, 'Deleted local item cannot finish its queued publication');
    gate.set({path: '/channels/[^/]+/items$', hold: true});
    await submit(desktop, item);
    await until(() => gate.state.requests.some(value => value.stage === 'held'), 'pending real publication held');
    await desktop.open();
    await desktop.click(desktop.history._itemRows.get(item.id).focusActors
      .find(actor => actor._clipboardXGnomeEntryAction === 'delete'));
    await until(() => !desktop.app._controller.items.some(value => value.id === item.id)
      && !documents(desktop).some(document => document.entries.some(entry => entry.itemId === item.id)),
    'native deletion prunes durable pending work');
    gate.set({});
    await until(() => !gate.state.requests.some(value => value.stage === 'held' || value.stage === 'started' || value.stage === 'response'),
      'released publication request reached a network terminal state', 10000);
    let polls = 0;
    const sync = desktop.app._sync;
    const signal = sync.connect('poll-completed', () => polls++);
    try { await until(() => polls >= 2 && !desktop.app._uploadQueue._worker, 'two production polls without a retry', 15000); }
    finally { sync.disconnect(signal); }
    assert(!(await server.items()).items.some(value => value.id === item.id), 'Deleted source cannot upload a complete remote item');
  }),
};
