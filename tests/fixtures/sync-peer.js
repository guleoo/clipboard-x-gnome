// An independent production SyncClient source, not a second GNOME desktop.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const [extensionUri, directory, encoded] = ARGV;
const configuration = JSON.parse(encoded);
const {SyncClient} = await import(`${extensionUri}/sync/client.js`);
const {SyncConfigurationStore} = await import(`${extensionUri}/sync/configuration-store.js`);
const {HistoryStore} = await import(`${extensionUri}/clipboard/history/store.js`);
const {ClipboardItem} = await import(`${extensionUri}/clipboard/item.js`);
const {createThumbnail} = await import(`${extensionUri}/clipboard/thumbnail.js`);
const {writeFile} = await import(`${extensionUri}/common/files.js`);
const {sha256} = await import(`${extensionUri}/common/bytes.js`);
const schema = Gio.SettingsSchemaSource.new_from_directory(
  Gio.File.new_for_uri(extensionUri).get_child('schemas').get_path(), Gio.SettingsSchemaSource.get_default(), false)
  .lookup('org.gnome.shell.extensions.clipboard-x-gnome', false);
const settings = new Gio.Settings({settings_schema: schema});
settings.set_string('device-id', configuration.identity.id);
settings.set_string('device-tag', 'Independent source fixture');
settings.set_boolean('sync-enabled', true);
settings.set_string('sync-receive-mode', 'disabled');
settings.set_uint('sync-poll-interval-seconds', 2);
settings.set_uint('text-full-threshold', 32);
settings.set_uint('image-full-threshold', 32);
const store = new HistoryStore({rootPath: `${directory}/history`, deviceId: configuration.identity.id, items: () => items});
const connection = new SyncConfigurationStore();
await connection.saveConnection({serverAddress: configuration.address, apiKey: configuration.identity.key,
  activeChannelId: configuration.channelId});
let items = [];
const state = {ready: false, command: 0, events: [], error: null};
const stateFile = Gio.File.new_for_path(`${directory}/state.json`);
const commandFile = Gio.File.new_for_path(`${directory}/command.json`);
const save = () => stateFile.replace_contents(new TextEncoder().encode(JSON.stringify(state)), null, false,
  Gio.FileCreateFlags.REPLACE_DESTINATION, null);
const client = new SyncClient(settings, {
  configurationStore: connection,
  sourceItem: id => items.find(item => item.id === id) ?? null,
  stageFile: (content, write, cancellable) => store.stage(content, write, cancellable),
  discardContent: values => store.discard(values),
  useContent: (item, read) => store.use(item, read),
});
client.connect('transfer-changed', (_client, transfer) => {
  state.events.push({transferId: transfer.transferId, itemId: transfer.itemId, kind: transfer.kind,
    state: transfer.state, completedBytes: transfer.completedBytes, totalBytes: transfer.totalBytes});
  if (state.events.length > 10000) state.events.shift();
});
client.connect('error', (_client, error) => { state.lastError = {code: error.code, message: error.message}; });
let busy = false;
const loop = new GLib.MainLoop(null, false);
const parent = Gio.File.new_for_path(`/proc/${configuration.parentPid}`);
const watchdog = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
  if (!parent.query_exists(null)) loop.quit();
  return GLib.SOURCE_CONTINUE;
});
let source = 0;
async function start() {
  items = await store.load();
  await client.start();
  if (!client.ready) throw new Error('Independent source did not connect');
  state.ready = true;
  source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
    save();
    if (busy || !commandFile.query_exists(null)) return GLib.SOURCE_CONTINUE;
    const [, bytes] = commandFile.load_contents(null);
    const command = JSON.parse(new TextDecoder().decode(bytes));
    if (command.id === state.command) return GLib.SOURCE_CONTINUE;
    busy = true;
    (async () => {
      try {
        state.error = null;
        state.result = null;
        if (command.action === 'publish') {
          settings.set_boolean('sync-html', Boolean(command.types?.['text/html']));
          settings.set_uint('text-full-threshold', command.threshold ?? 32);
          settings.set_uint('image-full-threshold', command.threshold ?? 32);
          const values = command.types
            ? Object.entries(command.types).map(([mimeType, data]) => ({mimeType, bytes: new GLib.Bytes(GLib.base64_decode(data))}))
            : [{mimeType: 'text/plain;charset=utf-8', bytes: new GLib.Bytes(new TextEncoder().encode(command.text))}];
          const item = ClipboardItem.fromRepresentations(values, {originDeviceId: configuration.identity.id, textPreviewLimit: 128});
          if (item.isImage) {
            const image = await createThumbnail(item.primary.bytes, 160, 65536);
            const preview = {mimeType: image.mimeType, size: image.bytes.get_size(), width: image.width, height: image.height,
              sha256: sha256(image.bytes), truncated: true, derivedFrom: item.primary.id};
            await store.stage(preview, path => writeFile(Gio.File.new_for_path(path), image.bytes));
            item.preview = preview;
          }
          items.unshift(item);
          await store.save(items);
          await client.publish(item);
          await store.save(items);
          state.result = {id: item.id, primary: {id: item.primary.id, size: item.primary.size, sha256: item.primary.sha256}};
        } else if (command.action === 'remove') {
          const removed = items.filter(item => item.id === command.itemId);
          items = items.filter(item => item.id !== command.itemId);
          await store.discard(removed);
          await store.save(items);
        } else if (command.action === 'quit') {
          loop.quit();
        } else throw new Error(`Unknown peer action: ${command.action}`);
      } catch (error) { state.error = {code: error.code, message: error.message}; }
      finally { state.command = command.id; busy = false; save(); }
    })();
    return GLib.SOURCE_CONTINUE;
  });
}
start().catch(error => { state.error = {message: error.message}; save(); loop.quit(); });
await loop.runAsync();
if (source) GLib.Source.remove(source);
GLib.Source.remove(watchdog);
client.destroy();
await store.close();
