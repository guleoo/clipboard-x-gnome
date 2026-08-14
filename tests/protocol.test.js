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
  'RegisterDevice',
  'Publish',
  'GetItem',
  'RequestContent',
  'OpenContent',
  'CancelTransfer',
  'Acknowledge',
  'ListPending',
]) {
  assert(xml.includes(`<method name="${name}">`), `protocol must define ${name}`);
}

assert(xml.includes('interface name="io.github.guleo.ClipboardX.Sync1"'), 'versioned interface name');
assert(xml.includes('type="h"'), 'protocol must use UNIX FD payloads');
assert(xml.includes('<arg name="deviceId" type="s" direction="in"/>'),
  'synchronization calls must carry DeviceId');

const tagOccurrences = xml.match(/deviceTag/g)?.length ?? 0;
assert(tagOccurrences === 1, 'Device Tag must only be registered, not carried by every operation');
