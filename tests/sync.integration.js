import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';

const BUS_NAME = 'io.github.guleo.ClipboardX.MockService';
const OBJECT_PATH = '/io/github/guleo/ClipboardX/Sync';
const INTERFACE = 'io.github.guleo.ClipboardX.Sync1';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function call(proxy, method, parameters) {
  return proxy.call_sync(method, parameters, Gio.DBusCallFlags.NONE, 5000, null);
}

function readFd(fdList, index) {
  const stream = new GioUnix.InputStream({fd: fdList.get(index), close_fd: true});
  const bytes = stream.read_bytes(1024 * 1024, null);
  stream.close(null);
  return new TextDecoder().decode(bytes.get_data());
}

const proxy = Gio.DBusProxy.new_for_bus_sync(
  Gio.BusType.SESSION,
  Gio.DBusProxyFlags.NONE,
  null,
  BUS_NAME,
  OBJECT_PATH,
  INTERFACE,
  null,
);

const deviceId = GLib.uuid_string_random();
call(proxy, 'RegisterDevice', new GLib.Variant('(ss)', [deviceId, 'Integration Test']));

const [file, ioStream] = Gio.File.new_tmp('clipboard-x-integration-XXXXXX');
ioStream.get_output_stream().write_all(new TextEncoder().encode('full clipboard content'), null);
ioStream.close(null);
const input = file.read(null);
const fdList = new Gio.UnixFDList();
const fdIndex = fdList.append(input.get_fd());
const contentId = GLib.uuid_string_random();
const itemId = GLib.uuid_string_random();
const item = {
  id: new GLib.Variant('s', itemId),
  'created-at': new GLib.Variant('t', Date.now()),
  'origin-device-id': new GLib.Variant('s', deviceId),
};
const contentMetadata = {
  'content-id': new GLib.Variant('s', contentId),
  size: new GLib.Variant('t', 22),
  sha256: new GLib.Variant('s', 'test'),
  delivery: new GLib.Variant('s', 'on-demand'),
};
const [publishReply] = proxy.call_with_unix_fd_list_sync(
  'Publish',
  new GLib.Variant('(sa{sv}a(sa{sv}h)a(sa{sv}h))', [
    deviceId,
    item,
    [],
    [['text/plain;charset=utf-8', contentMetadata, fdIndex]],
  ]),
  Gio.DBusCallFlags.NONE,
  5000,
  fdList,
  null,
);
assert(publishReply.deepUnpack()[0] === itemId, 'Publish must preserve item ID');
input.close(null);
file.delete(null);

const pending = call(proxy, 'ListPending', new GLib.Variant('(s)', [deviceId])).deepUnpack()[0];
assert(pending.includes(itemId), 'Published item must be pending');

const [openReply, openFds] = proxy.call_with_unix_fd_list_sync(
  'OpenContent',
  new GLib.Variant('(sss)', [deviceId, itemId, contentId]),
  Gio.DBusCallFlags.NONE,
  5000,
  null,
  null,
);
const [_metadata, openIndex] = openReply.deepUnpack();
assert(readFd(openFds, openIndex) === 'full clipboard content', 'OpenContent must return original bytes');
