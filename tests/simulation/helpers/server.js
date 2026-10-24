import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {assert, until} from './desktop.js';

export class Server {
  static async open(desktop) {
    const server = new Server(desktop);
    try {
    await server.request('POST', '/session', {username: GLib.getenv('CBX_SIMULATION_ADMIN'),
      password: GLib.getenv('CBX_SIMULATION_PASSWORD')});
    server.identity = await server.device(desktop.settings.get_string('device-id'));
    server.channel = await server.request('POST', '/channels', {name: `Native ${GLib.uuid_string_random()}`});
    await server.join(server.channel.id, server.identity.id);
    await server.configure();
    return server;
    } catch (error) { await server.close(); throw error; }
  }

  constructor(desktop) {
    this.desktop = desktop;
    this.address = GLib.getenv('CBX_SIMULATION_SERVER');
    assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(this.address ?? ''), 'Use tools/test-sync-server.py with its owned local server');
    this.session = new Soup.Session({timeout: 15});
    this.session.add_feature(new Soup.CookieJar());
    this.createdDevices = [];
  }

  async request(method, path, value) {
    const message = Soup.Message.new(method, `${this.address}/admin/api/v1${path}`);
    message.request_headers.replace('Origin', this.address);
    if (value !== undefined) message.set_request_body_from_bytes('application/json',
      new GLib.Bytes(new TextEncoder().encode(JSON.stringify(value))));
    const bytes = await new Promise((resolve, reject) => this.session.send_and_read_async(
      message, GLib.PRIORITY_DEFAULT, null, (object, result) => {
        try { resolve(object.send_and_read_finish(result)); } catch (error) { reject(error); }
      }));
    if (message.status_code < 200 || message.status_code >= 300) {
      const error = new Error(`Isolated admin API ${method} ${path}: HTTP ${message.status_code}`);
      error.status = message.status_code;
      throw error;
    }
    const text = new TextDecoder().decode(bytes.get_data());
    return text ? JSON.parse(text) : null;
  }

  async device(id = GLib.uuid_string_random()) {
    await this.request('POST', '/devices', {id});
    this.createdDevices.push(id);
    const {key} = await this.request('POST', `/devices/${id}/keys`, {});
    return {id, key};
  }

  join(channelId, deviceId) { return this.request('PUT', `/channels/${channelId}/members/${deviceId}`, {}); }

  async configure(channelId = this.channel.id, key = this.identity.key, address = this.address) {
    const {SyncConfigurationStore} = await import(`${this.desktop.app.dir.get_uri()}/sync/configuration-store.js`);
    await new SyncConfigurationStore().saveConnection({serverAddress: address, apiKey: key, activeChannelId: channelId});
    this.desktop.settings.set_string('sync-send-mode', 'manual');
    this.desktop.settings.set_string('sync-receive-mode', 'history');
    this.desktop.settings.set_uint('sync-poll-interval-seconds', 2);
    this.desktop.settings.set_uint('sync-configuration-revision', this.desktop.settings.get_uint('sync-configuration-revision') + 1);
  }

  async enable() {
    assert(!this.desktop.settings.get_boolean('sync-enabled'), 'Enable starts from disabled');
    await this.desktop.open();
    await this.desktop.click(this.desktop.history.syncButton);
    await until(() => this.desktop.app._sync.ready, 'actual server session online', 20000);
  }

  async disable() {
    await this.desktop.open();
    await this.desktop.click(this.desktop.history.syncButton);
    await until(() => !this.desktop.settings.get_boolean('sync-enabled') && !this.desktop.app._sync.ready, 'native sync off');
  }

  item(id) { return this.request('GET', `/items/${id}`); }
  items() { return this.request('GET', `/items?channelId=${this.channel.id}&limit=200`); }
  async close() {
    try {
      this.desktop.settings.set_boolean('sync-enabled', false);
      await until(() => !this.desktop.app._sync.ready, 'fixture session stopped before server cleanup');
      if (this.channel) await this.request('DELETE', `/channels/${this.channel.id}`);
      for (const id of this.createdDevices) await this.request('DELETE', `/devices/${id}`);
    } finally { this.session.abort(); }
  }
}
