import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {assert, fixture, json, until, SyncProgressStore} from './backend.js';

const encoder = new TextEncoder();
const digest = bytes => GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes);
function image(seed) {
  const value = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 48, 24);
  value.fill(((0x334400 + seed * 101) << 8) | 0xff);
  return value.save_to_bufferv('png', [], [])[1];
}
async function received(endpoint, id) {
  await until(() => endpoint.items.some(item => item.id === id && item.remote), 'production Content imports remote snapshot', 30000);
  return endpoint.items.find(item => item.id === id);
}
async function original(item) {
  await until(() => Boolean(item.primary.path), 'verified original adopted', 30000);
  const [, bytes] = Gio.File.new_for_path(item.primary.path).load_contents(null);
  assert(bytes.length === item.primary.size && digest(bytes) === item.primary.sha256, 'Adopted original matches exact size and digest');
}
async function polls(endpoint, count = 2) {
  let completed = 0;
  const signal = endpoint.client.connect('poll-completed', () => completed++);
  try { await until(() => completed >= count, 'real production automatic polls', 20000); }
  finally { endpoint.client.disconnect(signal); }
}
function entries(endpoint, id) {
  return [...endpoint.outbox._queues.values()].flatMap(queue => [...queue.entries.values()]).filter(entry => entry.itemId === id);
}
function cursor(path) { return decodeURIComponent(/[?&]cursor=([^&]*)/.exec(path)?.[1] ?? ''); }

export const cases = {
  'SEND-02': () => fixture(async ({backend, endpoint}) => {
    const source = await endpoint();
    for (const [plain, html] of [[true, false], [false, true], [true, true]]) {
      source.settings.set_boolean('sync-text', plain);
      source.settings.set_boolean('sync-html', html);
      const text = `rich text publication ${plain}-${html}`;
      const item = await source.publish({types: {'text/plain;charset=utf-8': encoder.encode(text),
        'text/html': encoder.encode(`<strong>${text}</strong>`)}});
      assert(item.representations.length === 2, 'Publication policy never removes local rich-text representations');
      const remote = await backend.item(item.id);
      assert(remote.contents.some(value => value.mimeType.startsWith('text/plain')) === plain
        && remote.contents.some(value => value.mimeType === 'text/html') === html, 'Independent plain/rich-text publication switches reach actual backend');
    }
    for (const enabled of [false, true]) {
      source.settings.set_boolean('sync-images', enabled);
      const item = await source.create({types: {'image/png': image(enabled ? 1 : 2)}});
      let error;
      try { await source.client.publish(item); } catch (caught) { error = caught; }
      assert(Boolean(error) === !enabled && item.primary.path, 'Image policy affects publication, not stored original');
      assert((await backend.items()).items.some(value => value.id === item.id) === enabled, 'Image sending preference is enforced by the actual HTTP publication');
    }
  }),

  'SEND-03': () => fixture(async ({backend, endpoint}) => {
    const source = await endpoint();
    source.settings.set_uint('text-full-threshold', 32);
    for (const length of [31, 32, 33]) {
      const item = await source.publish({text: `${length}`.padEnd(length, 'x')});
      const value = (await backend.item(item.id)).contents[0];
      assert(value.delivery === (length <= 32 ? 'eager' : 'on-demand')
        && value.availability === (length <= 32 ? 'available' : 'source-required'), 'Text byte threshold includes equality and real original availability');
    }
  }),

  'SEND-03-image': () => fixture(async ({backend, endpoint}) => {
    const source = await endpoint();
    for (const [seed, delta] of [[1, -1], [2, 0], [3, 1]]) {
      const bytes = image(seed);
      source.settings.set_uint('image-full-threshold', bytes.length + delta);
      const item = await source.publish({types: {'image/png': bytes}});
      const value = (await backend.item(item.id)).contents[0];
      assert(value.size === bytes.length && value.delivery === (delta >= 0 ? 'eager' : 'on-demand')
        && value.availability === (delta >= 0 ? 'available' : 'source-required'), 'Encoded PNG threshold includes equality and actual lazy cache state');
    }
  }),

  'RECV-03-boundaries': () => fixture(async ({endpoint, gate}) => {
    const source = await endpoint();
    source.settings.set_string('sync-receive-mode', 'disabled');
    const proxy = await gate();
    const receiver = await endpoint({address: proxy.address});
    let sequence = 0;
    for (const mime of ['text/plain;charset=utf-8', 'image/png']) {
      for (const eager of [false, true]) {
        for (const delta of [-1, 0, 1]) {
          const bytes = mime === 'image/png' ? image(++sequence + 10) : encoder.encode(`UTF-8 中文 equality ${++sequence}`);
          const key = mime === 'image/png' ? 'image-full-threshold' : 'text-full-threshold';
          receiver.settings.set_uint(key, bytes.length + delta);
          source.settings.set_uint(key, eager ? bytes.length : 1);
          const remote = await source.publish({types: {[mime]: bytes}});
          const item = await received(receiver, remote.id);
          if (delta >= 0) await original(item);
          else {
            await polls(receiver);
            assert(!item.primary.path && !item.primary.bytes, 'Receiver retains above-threshold snapshots regardless of source delivery');
            assert(!proxy.state.requests.some(request => request.path.includes(`/items/${item.id}/contents/`)),
              'An above-threshold snapshot must neither request the source original nor download it from the actual server');
          }
          assert(receiver.errors.length === 0, 'Normal threshold policy must not hide a failed download or verification as a lazy snapshot');
          assert(item.primary.size === bytes.length && item.primary.sha256 === digest(bytes), 'Original metadata is not replaced by preview metadata');
        }
      }
    }
  }),

  'RECV-02-pages': () => fixture(async ({backend, endpoint, gate}) => {
    const source = await endpoint();
    source.settings.set_string('sync-receive-mode', 'disabled');
    source.settings.set_uint('text-full-threshold', 1);
    const proxy = await gate();
    const receiver = await endpoint({start: false, address: proxy.address});
    receiver.settings.set_uint('text-full-threshold', 1);
    const ids = [];
    for (let index = 0; index < 205; index++) ids.push((await source.publish({text: `before cold HTTP receiver joins ${index}`})).id);
    assert(receiver.items.length === 0, 'New receiver has not fetched any source history');
    await receiver.client.start();
    assert(ids.every(id => receiver.items.filter(item => item.id === id).length === 1), 'Every retained item crosses actual production pages exactly once');
    const requests = proxy.state.requests.filter(value => /\/changes\?/.test(value.path));
    assert(requests.length >= 2 && cursor(requests[0].path) === '' && requests.some(value => cursor(value.path)), 'Production page size 200 requires an advanced cursor');
    const accepted = receiver.client._progress.cursors[backend.channel.id];
    const stored = await new SyncProgressStore({directory: `${receiver.directory}/progress`}).load({serverAddress: proxy.address, deviceId: receiver.identity.id});
    assert(stored.cursors[backend.channel.id] === accepted && accepted, 'A fresh store reads actual accepted progress from disk');
    const before = proxy.state.requests.length;
    await receiver.restart();
    const resumed = proxy.state.requests.slice(before).find(value => /\/changes\?/.test(value.path));
    assert(resumed && cursor(resumed.path) === accepted && ids.every(id => receiver.items.filter(item => item.id === id).length === 1),
      'A new client/store instance resumes the persisted cursor and retains exact history identities');
  }),

  'SEND-05-destinations': () => fixture(async ({backend, endpoint, gate}) => {
    const first = await gate();
    const second = await gate();
    const other = await backend.channelCreate();
    const source = await endpoint({start: false, address: first.address});
    await backend.request('PUT', `/channels/${other.id}/members/${source.identity.id}`, {});
    const item = await source.create({text: 'pending A must never enter the alternate address and Channel'});
    await source.outbox.enqueue(item);
    const originalQueue = [...source.outbox._queues.values()][0];
    const frozen = json(originalQueue.path).entries[0];
    assert(frozen.itemId === item.id && frozen.channelId === backend.channel.id && frozen.deviceId === source.identity.id
      && frozen.serverAddress === first.address, 'Pending intent durably records exact destination identity');
    await source.connection.saveConnection({serverAddress: second.address, apiKey: source.identity.key, activeChannelId: other.id});
    await source.client.start();
    await source.outbox.flush();
    const b = await source.create({text: 'actual B publication positive control'});
    await source.outbox.enqueue(b);
    await source.outbox.flush();
    const atB = (await backend.items(other.id)).items;
    assert(atB.some(value => value.id === b.id) && !atB.some(value => value.id === item.id)
      && json(originalQueue.path).entries.some(value => value.itemId === item.id), 'Dormant A queue cannot publish to B');
    const alternate = [...source.outbox._queues.values()].find(queue => queue.path !== originalQueue.path);
    assert(alternate && Gio.File.new_for_path(alternate.path).query_exists(null), 'Different server addresses own different durable files');
    await source.restart();
    assert(source.client.configuration.activeChannelId === other.id, 'Client restarts at B while A remains only on disk');
    await source.configure({address: first.address, channel: backend.channel.id});
    await source.outbox.flush();
    await until(() => entries(source, item.id).length === 0 && !json(originalQueue.path).entries.some(value => value.itemId === item.id), 'Restored A task is durably acknowledged');
    assert((await backend.items()).items.some(value => value.id === item.id)
      && !(await backend.items()).items.some(value => value.id === b.id), 'A resumes after reload without mixing B data');
  }),

  'SEND-07': () => fixture(async ({backend, endpoint, gate}) => {
    const proxy = await gate();
    const source = await endpoint({address: proxy.address});
    const item = await source.create({text: 'server committed completion with a lost actual HTTP response'});
    proxy.set({path: '/uploads/[^/]+/complete$', dropOnce: GLib.uuid_string_random()});
    await source.outbox.enqueue(item);
    const sending = source.outbox.flush();
    await until(() => proxy.state.requests.some(value => value.stage === 'response-dropped'), 'real completion ACK dropped', 20000);
    await sending;
    assert((await backend.item(item.id)).id === item.id, 'Backend committed before losing the response');
    proxy.set({});
    await until(() => source.client.getTransferForItem(item.id)?.state === 'completed' && !entries(source, item.id).length,
      'production polling and outbox retry confirm the committed item', 30000);
    const queue = [...source.outbox._queues.values()][0];
    await until(() => !json(queue.path).entries.some(value => value.itemId === item.id), 'confirmation removes actual durable intent');
    assert(proxy.state.requests.filter(value => value.method === 'PUT' && value.path.includes('/contents/')).length === 1
      && (await backend.items()).items.filter(value => value.id === item.id).length === 1, 'Lost ACK never uploads the original or creates the item twice');
  }),

  'CONN-09-device': () => fixture(async ({backend, endpoint}) => {
    const receiver = await endpoint();
    const errors = [];
    const signal = receiver.client.connect('status-changed', (_client, state, details) => { if (state === 'error') errors.push(details?.errorCode); });
    try {
      await backend.request('PATCH', `/devices/${receiver.identity.id}`, {disabled: true});
      await until(() => errors.some(code => ['device_disabled', 'invalid_key', 'not_authorized'].includes(code)), 'live revoked-device rejection', 20000);
      await backend.request('PATCH', `/devices/${receiver.identity.id}`, {disabled: false});
      const {key} = await backend.request('POST', `/devices/${receiver.identity.id}/keys`, {});
      receiver.identity.key = key;
      await receiver.configure({key});
      assert(receiver.client.ready && receiver.client._state !== 'error', 'New actual key restores the production client');
    } finally { receiver.client.disconnect(signal); }
  }),

  'CONN-09-offline': () => fixture(async ({endpoint}) => {
    const receiver = await endpoint({start: false});
    const socket = Gio.Socket.new(Gio.SocketFamily.IPV4, Gio.SocketType.STREAM, Gio.SocketProtocol.TCP);
    try {
      socket.bind(Gio.InetSocketAddress.new_from_string('127.0.0.1', 0), true);
      const previous = await receiver.connection.load();
      await receiver.connection.saveConnection({...previous, serverAddress: `http://127.0.0.1:${socket.get_local_address().get_port()}`});
      let error;
      try { await receiver.client.start(); } catch (caught) { error = caught; }
      assert(error && receiver.client._state === 'error' && !receiver.client.ready && receiver.settings.get_boolean('sync-enabled'),
        'Connection refusal reports failure without changing the user enable preference');
      await receiver.configure({address: previous.serverAddress});
      assert(receiver.client.ready, 'Actual configured backend restores operation after refusal');
    } finally { socket.close(); }
  }),

  'XFER-09-glib': () => verify(false),
  'XFER-09-sha256sum': () => verify(true),
};

async function verify(external) {
  return fixture(async ({endpoint}) => {
    const source = await endpoint();
    source.settings.set_string('sync-receive-mode', 'disabled');
    source.settings.set_uint('text-full-threshold', 1024 * 1024);
    const receiver = await endpoint();
    receiver.settings.set_boolean('sync-use-sha256sum', external);
    receiver.settings.set_uint('text-full-threshold', 1024 * 1024);
    const text = `real verifier ${external} `.repeat(10000);
    const remote = await source.publish({text});
    const item = await received(receiver, remote.id);
    await original(item);
    const downloads = receiver.downloads.filter(trace => trace.itemId === item.id && trace.contentId === item.primary.id);
    assert(downloads.length > 0 && downloads.every(trace => trace.stages.includes('request') && trace.stages.includes('response')),
      'Verifier evidence must come from the actual original HTTP download');
    assert(downloads.some(trace => trace.stages.includes('start-verifier')) === external,
      'The enabled option must actually execute sha256sum; the disabled option must stay on the GLib path');
    if (external)
      assert(downloads.some(trace => trace.stages.includes('start-verifier') && trace.stages.includes('wait-verifier')
        && trace.stages.includes('close-verifier') && trace.stages.includes('replace-target')),
      'External verification must finish and adopt its verified result, not only attempt to start a child');
    assert(receiver.errors.length === 0, 'Both successful verifier paths must finish without hidden receive errors');
    assert(item.primary.sha256 === remote.primary.sha256 && item.primary.size === encoder.encode(text).length,
      'Configured verifier must accept exact original bytes using actual backend response framing');
  });
}

const selected = ARGV[0];
assert(Object.hasOwn(cases, selected), 'Choose a registered headless HTTP case');
print(`[sync-http] START ${selected}`);
try {
  await cases[selected]();
  print(`[sync-http] PASS ${selected}`);
} catch (error) {
  printerr(`[sync-http] FAIL ${selected}: ${error.message}`);
  throw error;
}
