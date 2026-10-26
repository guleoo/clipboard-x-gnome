import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import System from 'system';
import {DictionaryStore} from '../../../../src/clipboard/tokenizer/dictionary/store.js';
import {assert, removeTree} from '../controller-fixture.js';

// Real Gio/GVfs byte acquisition and a real loopback HTTP(S) endpoint. Unlike the
// format/store unit matrices, no URI is replaced with a local file.
const tls = ARGV.includes('--tls');
const rootPath = GLib.dir_make_tmp('cbx-dictionary-network-logic-XXXXXX');
const root = Gio.File.new_for_path(rootPath);
const store = new DictionaryStore({rootPath: rootPath + '/store'});
const server = new Soup.Server();
let body = '# locale: zh_CN\n# name: Network logic\n注销密钥 90\n';
let status = 200;
let requests = 0;
let skipped = false;
const bytes = file => GLib.base64_encode(file.load_contents(null)[1]);
const document = (locale, word) => '# locale: ' + locale + '\n# name: Network logic\n' + word + ' 90\n';
server.add_handler(null, (_server, message) => {
  requests++;
  message.set_status(status, null);
  message.get_response_headers().replace('Cache-Control', 'no-store');
  message.set_response('text/plain; charset=utf-8', Soup.MemoryUse.COPY, body);
});

async function failure(operation) {
  try { await operation; } catch (error) { return error; }
  throw new Error('The invalid network refresh unexpectedly succeeded');
}
async function certificate() {
  const openssl = GLib.find_program_in_path('openssl');
  if (!openssl) { print('SKIP dictionary TLS: openssl is unavailable'); skipped = true; return; }
  const process = Gio.Subprocess.new([openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', rootPath + '/key.pem', '-out', rootPath + '/cert.pem', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
  Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
  await new Promise((resolve, reject) => process.wait_check_async(null, (child, result) => {
    try { child.wait_check_finish(result); resolve(); } catch (error) { reject(error); }
  }));
  server.set_tls_certificate(Gio.TlsCertificate.new_from_files(rootPath + '/cert.pem', rootPath + '/key.pem'));
}

try {
  if (tls) await certificate();
  if (!skipped) {
    server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY | (tls ? Soup.ServerListenOptions.HTTPS : 0));
    const uri = server.get_uris()[0].to_string() + 'dictionary.txt';
    let initial;
    try { initial = await store.refreshSource(uri); } catch (error) {
      if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_SUPPORTED)) {
        print('SKIP dictionary network: Gio/GVfs ' + (tls ? 'HTTPS' : 'HTTP') + ' backend unavailable');
        skipped = true;
      } else if (!tls) throw error;
      else {
        assert(/TLS|SSL|certificate/i.test(error.message)
          || error.matches?.(Gio.TlsError, Gio.TlsError.BAD_CERTIFICATE),
        'Untrusted HTTPS must fail for TLS validation, not an unrelated transport error: ' + error.message);
        assert(requests === 0 && (await store.list()).length === 0,
          'Untrusted TLS must not deliver an accepted dictionary request or create a local entry');
      }
    }
    if (!skipped && tls) {
      assert(!initial, 'The default trust store must not accept the test self-signed certificate');
      print('PASS dictionary real HTTPS certificate rejection and unchanged local store');
    } else if (!skipped) {
      assert(initial.locale === 'zh_cn' && initial.source === uri && requests > 0,
        'A real HTTP download must preserve the declared locale and exact network source');
      const file = store.getFile(initial.fileName);
      const original = bytes(file);
      const baseline = requests;
      await store.list();
      await store.load(['zh_CN']);
      assert(requests === baseline, 'Listing and loading a saved network dictionary must not download it again');
      for (const invalid of ['missing language declaration', '# locale: invalid-language-code!\n注销 1\n']) {
        body = invalid;
        const error = await failure(store.refreshSource(uri));
        assert(error.code === 'invalid_dictionary_locale' && bytes(file) === original
          && (await store.list()).length === 1,
        'Invalid downloaded declarations must preserve the existing file and metadata');
      }
      body = 'temporary remote failure';
      for (const code of [404, 503]) {
        status = code;
        await failure(store.refreshSource(uri));
        assert(bytes(file) === original && (await store.list()).length === 1,
          'Real HTTP ' + code + ' failure must preserve the last valid local dictionary');
      }
      status = 200;
      body = document('ja', '秘密鍵');
      const replacement = store.getFile(initial.fileName.replace(/^zh_cn--/, 'ja--'));
      replacement.make_directory(null);
      const error = await failure(store.refreshSource(uri));
      assert(error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.IS_DIRECTORY) && bytes(file) === original,
        'Actual replacement-write failure must preserve the old-language file');
      replacement.delete(null);
      const updated = await store.refreshSource(uri);
      assert(updated.locale === 'ja' && updated.source === uri && !file.query_exists(null)
        && (await store.list()).filter(entry => entry.source === uri).length === 1,
      'A successful remote language change must replace the old file, not duplicate its source');
      assert((await store.load(['ja'], [updated.fileName])).lexicon.segment('秘密鍵').join() === '秘密鍵',
        'The refreshed language dictionary must actually load its downloaded words');
      print('PASS dictionary real HTTP refresh, error preservation, language replacement and retry');
    }
  }
} finally { server.disconnect(); removeTree(root); }
if (skipped) System.exit(77);
