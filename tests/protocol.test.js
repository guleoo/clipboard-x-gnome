import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const testPath = GLib.filename_from_uri(import.meta.url)[0];
const protocolPath = GLib.build_filenamev([
  GLib.path_get_dirname(testPath),
  '..',
  'protocol',
  'io.github.guleo.ClipboardX.Sync1.xml',
]);
const protocolFile = Gio.File.new_for_path(protocolPath);
const [ok, bytes] = protocolFile.load_contents(null);
assert(ok, 'protocol XML must be readable');
const xml = new TextDecoder().decode(bytes);

for (const name of [
  'GetStatus',
  'RegisterDevice',
  'ListDevices',
  'Publish',
  'GetChanges',
  'GetItem',
  'RequestContent',
  'OpenContent',
  'CancelTransfer',
  'Acknowledge',
  'GetTransfer',
  'ListTransfers',
]) {
  assert(xml.includes(`<method name="${name}">`), `protocol must define ${name}`);
  const method = xml.match(new RegExp(`<method name="${name}">([\\s\\S]*?)<\\/method>`, 'u'))?.[1] ?? '';
  assert(method.includes('<arg name="deviceId" type="s" direction="in"/>'),
    `${name} must carry DeviceId`);
}

assert(xml.includes('interface name="io.github.guleo.ClipboardX.Sync1"'), 'versioned interface name');
assert(xml.includes('type="h"'), 'protocol must use UNIX FD payloads');
const preferences = xml.match(/<method name="OpenPreferences"([\s\S]*?)\/>/u)?.[0] ?? '';
assert(!preferences.includes('deviceId'), 'OpenPreferences is not a synchronization data operation');

for (const name of [
  'StatusChanged',
  'DeviceChanged',
  'DeviceRemoved',
  'ChangesAvailable',
  'TransferChanged',
])
  assert(xml.includes(`<signal name="${name}">`), `protocol must define ${name}`);

const publish = xml.match(/<method name="Publish">([\s\S]*?)<\/method>/u)?.[1] ?? '';
assert(publish.includes('<arg name="transferId" type="s" direction="out"/>'),
  'Publish must return a transfer ID for exact upload progress');
const transferSignal = xml.match(/<signal name="TransferChanged">([\s\S]*?)<\/signal>/u)?.[1] ?? '';
assert(transferSignal.includes('<arg name="transfer" type="a{sv}"/>'),
  'TransferChanged must carry the recoverable transfer record');
