import Gio from 'gi://Gio';

const root = Gio.File.new_for_uri(import.meta.url)
  .get_parent()
  .get_parent()
  .get_parent();
const serverProtocol = 'https://github.com/Guleo/clipboard-x-server/blob/master/docs/protocol.md';
const serverProtocolChinese = 'https://github.com/Guleo/clipboard-x-server/blob/master/docs/zh-CN/protocol.md';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function read(relativePath) {
  const [ok, contents] = root.resolve_relative_path(relativePath).load_contents(null);
  assert(ok, `${relativePath} could not be read`);
  return new TextDecoder().decode(contents);
}

assert(!root.resolve_relative_path('docs/sync-protocol.md').query_exists(null),
  'the client repository must not carry a second authoritative protocol copy');
assert(!root.resolve_relative_path('docs/zh-CN/sync-protocol.md').query_exists(null),
  'the client repository must not carry a translated protocol copy');
assert(read('README.md').includes(serverProtocol),
  'the English client documentation must follow the Server-owned protocol');
assert(read('README.zh-CN.md').includes(serverProtocolChinese),
  'the Chinese client documentation must follow the Server-owned protocol');
assert(read('CONTRIBUTING.md').includes('Clipboard X Server owns the synchronization protocol'),
  'contributors must change the Server contract before adapting this client');
