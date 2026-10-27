// Real HTTP integration adapters. No Shell, GTK, Meta, display or session bus.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

export function assert(value, message) { if (!value) throw new Error(message); }
export const delay = milliseconds => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds,
  () => { resolve(); return GLib.SOURCE_REMOVE; }));
export async function until(predicate, message, timeout = 10000) {
  const end = GLib.get_monotonic_time() + timeout * 1000;
  while (!predicate() && GLib.get_monotonic_time() < end) await delay(20);
  assert(predicate(), `Timeout: ${message}`);
}
export function json(path) {
  const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
  return JSON.parse(new TextDecoder().decode(bytes));
}
const uri = GLib.getenv('CBX_SYNC_EXTENSION_URI');
const runtime = GLib.getenv('CBX_SYNC_HTTP_RUNTIME');
assert(uri && runtime?.startsWith('/tmp/cbx-sync-http-'), 'Run tools/test-sync-http.py against its owned backend');
for (const value of [GLib.get_user_data_dir(), GLib.get_user_config_dir(), GLib.get_user_cache_dir()])
  assert(value.startsWith(`${runtime}/`), 'Headless integration must use private XDG storage');
const {SyncClient} = await import(`${uri}/sync/client.js`);
const {HttpTransport} = await import(`${uri}/sync/http/transport.js`);
const {HttpClient} = await import(`${uri}/sync/http/client.js`);
const {SyncConfigurationStore} = await import(`${uri}/sync/configuration-store.js`);
export const {SyncProgressStore} = await import(`${uri}/sync/progress-store.js`);
const {UploadQueue} = await import(`${uri}/sync/upload-queue.js`);
const {HistoryStore} = await import(`${uri}/clipboard/history/store.js`);
const {ClipboardItem} = await import(`${uri}/clipboard/item.js`);
const {Content} = await import(`${uri}/clipboard/content.js`);
const {createThumbnail} = await import(`${uri}/clipboard/thumbnail.js`);
const {writeFile} = await import(`${uri}/common/files.js`);
const {sha256} = await import(`${uri}/common/bytes.js`);
const schema = Gio.SettingsSchemaSource.new_from_directory(Gio.File.new_for_uri(uri).get_child('schemas').get_path(),
  Gio.SettingsSchemaSource.get_default(), false).lookup('org.gnome.shell.extensions.clipboard-x-gnome', false);

// Each client needs independent values. Memory Gio.Settings instances with the
// same fixed schema path would accidentally share device identity in one GJS.
class Settings {
  constructor() {
    this.values = new Map(schema.list_keys().map(key => [key, schema.get_key(key).get_default_value().deepUnpack()]));
    this.signals = new Map();
    this.next = 0;
  }
  get_boolean(key) { return Boolean(this.values.get(key)); }
  get_string(key) { return String(this.values.get(key) ?? ''); }
  get_uint(key) { return Number(this.values.get(key)); }
  set_boolean(key, value) { this.set(key, value); }
  set_string(key, value) { this.set(key, value); }
  set_uint(key, value) { this.set(key, value); }
  set(key, value) {
    if (this.values.get(key) === value) return;
    this.values.set(key, value);
    for (const signal of this.signals.values()) if (signal.name === `changed::${key}`) signal.callback(this, key);
  }
  connect(name, callback) { const id = ++this.next; this.signals.set(id, {name, callback}); return id; }
  disconnect(id) { this.signals.delete(id); }
}

export class Backend {
  static async open() {
    const value = new Backend();
    try {
      await value.request('POST', '/session', {username: GLib.getenv('CBX_SIMULATION_ADMIN'), password: GLib.getenv('CBX_SIMULATION_PASSWORD')});
      value.channel = await value.channelCreate();
      return value;
    } catch (error) { await value.close(); throw error; }
  }
  constructor() {
    this.address = GLib.getenv('CBX_SIMULATION_SERVER');
    assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(this.address ?? ''), 'Only the owned loopback server is allowed');
    this.session = new Soup.Session({timeout: 20});
    this.session.add_feature(new Soup.CookieJar());
    this.devices = [];
    this.channels = [];
  }
  async request(method, path, data) {
    const message = Soup.Message.new(method, `${this.address}/admin/api/v1${path}`);
    message.request_headers.replace('Origin', this.address);
    if (data !== undefined) message.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(JSON.stringify(data))));
    const bytes = await new Promise((resolve, reject) => this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null,
      (session, result) => { try { resolve(session.send_and_read_finish(result)); } catch (error) { reject(error); } }));
    assert(message.status_code >= 200 && message.status_code < 300, `Owned admin API ${method} ${path}: HTTP ${message.status_code}`);
    const text = new TextDecoder().decode(bytes.get_data());
    return text ? JSON.parse(text) : null;
  }
  async device(channelId = this.channel.id) {
    const id = GLib.uuid_string_random();
    await this.request('POST', '/devices', {id});
    this.devices.push(id);
    const {key} = await this.request('POST', `/devices/${id}/keys`, {});
    await this.request('PUT', `/channels/${channelId}/members/${id}`, {});
    return {id, key};
  }
  async channelCreate() {
    const channel = await this.request('POST', '/channels', {name: `Headless ${GLib.uuid_string_random()}`});
    this.channels.push(channel.id);
    return channel;
  }
  item(id) { return this.request('GET', `/items/${id}`); }
  items(channel = this.channel.id) { return this.request('GET', `/items?channelId=${channel}&limit=200`); }
  async close() {
    const errors = [];
    for (const path of [...this.channels.map(id => `/channels/${id}`), ...this.devices.map(id => `/devices/${id}`)]) {
      try { await this.request('DELETE', path); } catch (error) { errors.push(error); }
    }
    this.session.abort();
    if (errors.length) throw new AggregateError(errors, 'Owned backend cleanup failed');
  }
}

export class Endpoint {
  static async open(backend, {address = backend.address, channel = backend.channel.id, start = true, createSession = null} = {}) {
    const endpoint = new Endpoint(await backend.device(channel));
    endpoint.createSession = createSession;
    try {
      await endpoint.connection.saveConnection({serverAddress: address, apiKey: endpoint.identity.key, activeChannelId: channel});
      await endpoint.initialize(start);
      return endpoint;
    } catch (error) { await endpoint.close(); throw error; }
  }
  constructor(identity) {
    this.identity = identity;
    this.directory = `${runtime}/endpoint-${identity.id}`;
    this.settings = new Settings();
    this.settings.set_string('device-id', identity.id);
    this.settings.set_string('device-tag', 'Headless production client');
    this.settings.set_boolean('sync-enabled', true);
    this.settings.set_string('sync-receive-mode', 'history');
    this.settings.set_string('sync-send-mode', 'automatic');
    this.settings.set_uint('sync-poll-interval-seconds', 2);
    this.items = [];
    this.errors = [];
    this.downloads = [];
    this.connection = new SyncConfigurationStore({path: `${this.directory}/sync.json`});
    this.progress = new SyncProgressStore({directory: `${this.directory}/progress`});
    this.store = new HistoryStore({rootPath: `${this.directory}/history`, deviceId: identity.id, items: () => this.items});
  }
  async initialize(start = true) {
    this.items = await this.store.load();
    this.client = new SyncClient(this.settings, {configurationStore: this.connection, progressStore: this.progress,
      transportFactory: (configuration, options) => {
        const client = this.createSession ? new HttpClient({...configuration, ...options, session: this.createSession()}) : null;
        const transport = new HttpTransport(configuration, {...options, client});
        const download = transport.downloadContent;
        const endpoint = this;
        transport.downloadContent = function (channelId, itemId, contentId, path, options) {
          const trace = {itemId, contentId, stages: []};
          endpoint.downloads.push(trace);
          // Add only the production best-effort observer. Keep the actual
          // downloader, verifier selection, errors and resulting bytes intact.
          return download.call(this, channelId, itemId, contentId, path,
            {...options, diagnostics: {stage: name => trace.stages.push(name)}});
        };
        return transport;
      },
      sourceItem: id => this.items.find(item => item.id === id) ?? null,
      applyChanges: (changes, scope) => this.content.receive(changes, scope),
      stageFile: (value, write, cancellable) => this.store.stage(value, write, cancellable),
      discardContent: values => this.store.discard(values), useContent: (item, load) => this.store.use(item, load)});
    // Content's storage contract only: Controller retention, owner events,
    // rendering and auto-save wiring remain covered by native smoke tests.
    const history = {
      get items() { return this.endpoint.items; }, endpoint: this, selectionRevision: 0,
      add: item => {
        const previous = this.items.find(value => value.id === item.id);
        if (previous) return previous;
        this.items.push(item);
        return item;
      },
      remove: id => { this.items = this.items.filter(item => item.id !== id); },
      persist: () => this.store.save(this.items), commitContent: item => this.items.includes(item),
      discardContent: values => this.store.discard(values),
      activate: async () => { throw new Error('Headless history mode must never request a desktop clipboard activation'); },
    };
    this.content = new Content({history, remote: this.client, receiveMode: () => this.settings.get_string('sync-receive-mode'),
      deviceId: () => this.identity.id, onError: error => this.errors.push(error)});
    this.outbox = new UploadQueue(this.settings, {directory: `${this.directory}/queues`,
      configuration: () => this.connection.load(), current: () => this.client.configuration, ready: () => this.client.ready,
      source: id => this.items.find(item => item.id === id), sourceReady: () => true, prepare: () => this.store.save(this.items),
      publish: async (item, options) => { const result = await this.client.publish(item, options); await this.store.save(this.items); return result; },
      onError: error => this.errors.push(error)});
    this.client.connect('poll-completed', () => this.outbox.flush().catch(error => this.errors.push(error)));
    if (start) await this.client.start();
  }
  async configure({address, channel, key = this.identity.key}) {
    const previous = await this.connection.load();
    await this.connection.saveConnection({serverAddress: address ?? previous.serverAddress, apiKey: key,
      activeChannelId: channel ?? previous.activeChannelId});
    await this.client.restart();
  }
  async create({text, types}) {
    const representations = types ? Object.entries(types).map(([mimeType, bytes]) => ({mimeType, bytes: new GLib.Bytes(bytes)}))
      : [{mimeType: 'text/plain;charset=utf-8', bytes: new GLib.Bytes(new TextEncoder().encode(text))}];
    const item = ClipboardItem.fromRepresentations(representations, {originDeviceId: this.identity.id, textPreviewLimit: 128});
    if (item.isImage) {
      const image = await createThumbnail(item.primary.bytes, 160, 65536);
      item.preview = {mimeType: image.mimeType, size: image.bytes.get_size(), width: image.width, height: image.height,
        sha256: sha256(image.bytes), truncated: true, derivedFrom: item.primary.id};
      await this.store.stage(item.preview, path => writeFile(Gio.File.new_for_path(path), image.bytes));
    }
    this.items.unshift(item);
    await this.store.save(this.items);
    return item;
  }
  async publish(value) { const item = await this.create(value); await this.client.publish(item); await this.store.save(this.items); return item; }
  async restart() {
    await this.outbox.destroy();
    this.content.destroy();
    this.client.destroy();
    await this.store.save(this.items);
    await this.store.close();
    this.store = new HistoryStore({rootPath: `${this.directory}/history`, deviceId: this.identity.id, items: () => this.items});
    this.progress = new SyncProgressStore({directory: `${this.directory}/progress`});
    await this.initialize();
  }
  async close() {
    await this.outbox?.destroy();
    this.content?.destroy();
    this.client?.destroy();
    await this.store.close();
  }
}

export class Gate {
  static async open(address, {tls = false, prefix = ''} = {}) {
    const gate = new Gate();
    gate.directory = `${runtime}/gate-${GLib.uuid_string_random()}`;
    GLib.mkdir_with_parents(gate.directory, 0o700);
    if (tls) {
      gate.caFile = `${gate.directory}/ca.pem`;
      await gate.certificate();
    }
    const fixture = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent().get_parent()
      .get_child('fixtures/http-gate.py').get_path();
    gate.process = Gio.Subprocess.new(['python3', fixture, gate.directory, address,
      ...(tls ? ['--tls'] : []), ...(prefix ? ['--prefix', prefix] : [])], Gio.SubprocessFlags.NONE);
    try { await until(() => gate.state.port, 'owned streaming gate ready'); }
    catch (error) { await gate.close(); throw error; }
    gate.address = `${tls ? 'https' : 'http'}://127.0.0.1:${gate.state.port}${prefix}`;
    return gate;
  }
  async certificate() {
    assert(GLib.find_program_in_path('openssl'), 'The trusted TLS fixture requires openssl');
    const root = this.directory;
    GLib.file_set_contents(`${root}/leaf.cnf`, 'subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\n'
      + 'keyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
    for (const args of [
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=CBX private test CA',
        '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
        '-keyout', `${root}/ca-key.pem`, '-out', this.caFile],
      ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=127.0.0.1',
        '-keyout', `${root}/key.pem`, '-out', `${root}/leaf.csr`],
      ['x509', '-req', '-in', `${root}/leaf.csr`, '-CA', this.caFile, '-CAkey', `${root}/ca-key.pem`,
        '-CAcreateserial', '-days', '1', '-extfile', `${root}/leaf.cnf`, '-out', `${root}/cert.pem`],
    ]) {
      const process = Gio.Subprocess.new(['openssl', ...args], Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
      await new Promise((resolve, reject) => process.wait_check_async(null, (child, result) => {
        try { child.wait_check_finish(result); resolve(); } catch (error) { reject(error); }
      }));
    }
  }
  get state() { try { return json(`${this.directory}/state.json`); } catch { return {requests: []}; } }
  set(policy) { Gio.File.new_for_path(`${this.directory}/policy.json`).replace_contents(new TextEncoder().encode(JSON.stringify(policy)),
    null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null); }
  async close() {
    if (!this.process) return;
    this.process.force_exit();
    await new Promise(resolve => this.process.wait_async(null, (process, result) => { process.wait_finish(result); resolve(); }));
    this.process = null;
  }
}

export async function fixture(run) {
  let backend;
  const endpoints = [];
  const gates = [];
  let failure;
  try {
    backend = await Backend.open();
    await run({backend, endpoint: async options => {
      const value = await Endpoint.open(backend, options); endpoints.push(value); return value;
    }, gate: async options => { const value = await Gate.open(backend.address, options); gates.push(value); return value; }});
  } catch (error) { failure = error; }
  for (const resource of [...endpoints.reverse(), backend, ...gates].filter(Boolean)) {
    try { await resource.close(); } catch (error) { if (!failure) failure = error; else printerr(`Cleanup: ${error.message}`); }
  }
  if (failure) throw failure;
}
