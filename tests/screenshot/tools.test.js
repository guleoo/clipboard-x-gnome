import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {buildEditorArgv, launchEditor} from '../../src/screenshot/editor-launcher.js';
import {ScreenshotPortal} from '../../src/screenshot/portal.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const buildDirectory = GLib.getenv('CBX_TEST_BUILD_DIR');
assert(buildDirectory, 'Screenshot tests must run through Meson');
const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
  buildDirectory,
  Gio.SettingsSchemaSource.get_default(),
  false,
);
const schema = schemaSource.lookup('org.gnome.shell.extensions.clipboard-x-gnome', false);
assert(schema.get_key('editor-command').get_default_value().deepUnpack() === '',
  'Image editor command must be unconfigured by default');

async function assertRejects(promise, pattern, message) {
  try {
    await promise;
  } catch (error) {
    assert(pattern.test(error.message), `${message}: ${error.message}`);
    return;
  }
  throw new Error(`${message}: promise resolved unexpectedly`);
}

assertEqual(buildEditorArgv('gradia %u', 'file:///tmp/a b.png', '/tmp/a b.png'),
  ['gradia', 'file:///tmp/a b.png'], 'URI placeholder');
assertEqual(buildEditorArgv('gradia %f', 'file:///tmp/a b.png', '/tmp/a b.png'),
  ['gradia', '/tmp/a b.png'], 'Gradia local-file placeholder');
assertEqual(buildEditorArgv('gradia %i', 'file:///tmp/a b.png', '/tmp/a b.png'),
  ['gradia'], 'standard-input placeholder');
assertEqual(buildEditorArgv('gimp %f', 'file:///tmp/a.png', '/tmp/a.png'),
  ['gimp', '/tmp/a.png'], 'file placeholder');
assertEqual(buildEditorArgv('editor --label=100%%', 'file:///tmp/a.png', '/tmp/a.png'),
  ['editor', '--label=100%', 'file:///tmp/a.png'], 'literal percent and implicit URI');
assertEqual(buildEditorArgv("editor '$(not-a-shell)' %f", 'file:///tmp/a b.png', '/tmp/a b.png'),
  ['editor', '$(not-a-shell)', '/tmp/a b.png'], 'command arguments must never be evaluated by a shell');
assertEqual(buildEditorArgv('flatpak run be.alexandervanhee.gradia %u',
  'file:///tmp/截图%20“quoted”.png', '/tmp/截图 “quoted”.png'),
['flatpak', 'run', 'be.alexandervanhee.gradia', 'file:///tmp/截图%20“quoted”.png'],
'Flatpak editor command must preserve a Unicode URI as one argument');
let rejected = false;
try {
  buildEditorArgv('editor %x', 'file:///tmp/a.png', '/tmp/a.png');
} catch (_error) {
  rejected = true;
}
assert(rejected, 'unknown editor placeholders must be rejected');
rejected = false;
try {
  buildEditorArgv('editor %f', 'https://example.test/remote.png', null);
} catch (_error) {
  rejected = true;
}
assert(rejected, 'local-path placeholder must reject a non-local URI');
rejected = false;
try {
  buildEditorArgv('editor --input=%i', 'file:///tmp/a.png', '/tmp/a.png');
} catch (_error) {
  rejected = true;
}
assert(rejected, 'standard-input placeholder must be a separate argument');

class FakePortalConnection {
  constructor({mode = 'success', version = 3, targets = 15} = {}) {
    this.mode = mode;
    this.version = version;
    this.targets = targets;
    this.closeCount = 0;
    this.lastOptions = null;
    this._subscriptions = new Map();
    this._nextSubscription = 1;
  }

  get_unique_name() {
    return ':1.42';
  }

  signal_subscribe(_sender, _interface, _signal, path, _arg, _flags, callback) {
    const id = this._nextSubscription++;
    this._subscriptions.set(id, {path, callback});
    return id;
  }

  signal_unsubscribe(id) {
    this._subscriptions.delete(id);
  }

  call(_bus, path, interfaceName, method, parameters, _replyType, _flags, _timeout, _cancellable, callback) {
    if (method === 'Close') {
      this.closeCount++;
      return;
    }

    setTimeout(() => {
      if (method === 'GetAll') {
        callback(this, {reply: new GLib.Variant('(a{sv})', [{
          version: new GLib.Variant('u', this.version),
          AvailableTargets: new GLib.Variant('u', this.targets),
        }])});
        return;
      }

      if (interfaceName === 'org.freedesktop.portal.Screenshot' && method === 'Screenshot') {
        const [, options] = parameters.deepUnpack();
        this.lastOptions = unpack(options);
        const requestPath = [...this._subscriptions.values()][0]?.path;
        callback(this, {reply: new GLib.Variant('(o)', [requestPath])});
        if (this.mode !== 'pending') {
          setTimeout(() => this._respond(path), 0);
        }
      }
    }, 0);
  }

  call_finish(result) {
    if (result.error)
      throw result.error;
    return result.reply;
  }

  _respond(_portalPath) {
    const response = ['success', 'no-uri'].includes(this.mode) ? 0 : this.mode === 'cancelled' ? 1 : 2;
    const results = response === 0 && this.mode !== 'no-uri'
      ? {uri: new GLib.Variant('s', 'file:///tmp/screenshot%20测试.png')}
      : {};
    for (const {path, callback} of this._subscriptions.values()) {
      callback(
        this,
        'org.freedesktop.portal.Desktop',
        path,
        'org.freedesktop.portal.Request',
        'Response',
        new GLib.Variant('(ua{sv})', [response, results]),
      );
    }
  }
}

function unpack(value) {
  if (value instanceof GLib.Variant)
    return unpack(value.deepUnpack());
  if (Array.isArray(value))
    return value.map(unpack);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item)]));
  return value;
}

const successConnection = new FakePortalConnection();
const successPortal = new ScreenshotPortal({connection: successConnection, timeoutMilliseconds: 100});
const uri = await successPortal.capture('area');
assert(uri === 'file:///tmp/screenshot%20测试.png', 'Screenshot Portal must return the response URI');
assert(successConnection.lastOptions.target === 4, 'Portal v3 target must be forwarded');
assert(successConnection.lastOptions.interactive === false, 'fixed target must not be interactive');

const deniedPortal = new ScreenshotPortal({
  connection: new FakePortalConnection({mode: 'denied'}),
  timeoutMilliseconds: 100,
});
await assertRejects(deniedPortal.capture('screen'), /denied/u, 'denied screenshot');

const userCancelConnection = new FakePortalConnection({mode: 'cancelled'});
const userCancelPortal = new ScreenshotPortal({connection: userCancelConnection, timeoutMilliseconds: 100});
assert(await userCancelPortal.capture('interactive') === null,
  'User cancellation must resolve without a screenshot or an error');
assert(userCancelConnection._subscriptions.size === 0 && userCancelPortal._request === null,
  'User cancellation must release the request and signal subscription');
userCancelConnection.mode = 'success';
assert(await userCancelPortal.capture('interactive') === uri,
  'A new screenshot must be allowed after user cancellation');

const cancelConnection = new FakePortalConnection({mode: 'pending'});
const cancelPortal = new ScreenshotPortal({connection: cancelConnection, timeoutMilliseconds: 100});
const cancelled = cancelPortal.capture('interactive');
setTimeout(() => cancelPortal.cancel(), 10);
assert(await cancelled === null, 'Explicit cancellation must finish without an error');
assert(cancelConnection.closeCount === 1, 'cancellation must close the Portal request');
assert(cancelConnection._subscriptions.size === 0 && cancelPortal._request === null,
  'Explicit cancellation must clean up request resources');

const earlyCancelConnection = new FakePortalConnection({mode: 'pending'});
const earlyCancelPortal = new ScreenshotPortal({connection: earlyCancelConnection, timeoutMilliseconds: 100});
const earlyCancelled = earlyCancelPortal.capture('interactive');
earlyCancelPortal.cancel();
assert(await earlyCancelled === null && earlyCancelConnection.lastOptions === null,
  'Cancellation during capability discovery must not start a screenshot');
assert(earlyCancelConnection._subscriptions.size === 0 && earlyCancelPortal._request === null,
  'Early cancellation must leave no request resources');

const timeoutConnection = new FakePortalConnection({mode: 'pending'});
const timeoutPortal = new ScreenshotPortal({connection: timeoutConnection, timeoutMilliseconds: 10});
await assertRejects(timeoutPortal.capture('interactive'), /timed out/u, 'screenshot timeout');
assert(timeoutConnection.closeCount === 1, 'timeout must close the Portal request');

const missingUriPortal = new ScreenshotPortal({
  connection: new FakePortalConnection({mode: 'no-uri'}),
  timeoutMilliseconds: 100,
});
await assertRejects(missingUriPortal.capture('screen'), /no URI/u, 'missing screenshot URI');

const concurrentConnection = new FakePortalConnection({mode: 'pending'});
const concurrentPortal = new ScreenshotPortal({connection: concurrentConnection, timeoutMilliseconds: 100});
const pendingCapture = concurrentPortal.capture('interactive');
await assertRejects(concurrentPortal.capture('screen'), /already active/u, 'concurrent screenshot request');
await new Promise(resolve => setTimeout(resolve, 10));
concurrentPortal.cancel();
assert(await pendingCapture === null, 'Concurrent request cleanup must finish without an error');

const oldPortal = new ScreenshotPortal({
  connection: new FakePortalConnection({version: 2, targets: 0}),
  timeoutMilliseconds: 100,
});
await assertRejects(oldPortal.capture('window'), /does not support/u, 'Portal v2 target negotiation');

const editorProcess = await launchEditor({
  command: "/usr/bin/test %f = '/tmp/截图 editor test.png'",
  uri: 'file:///tmp/%E6%88%AA%E5%9B%BE%20editor%20test.png',
});
await new Promise((resolve, reject) => {
  editorProcess.wait_check_async(null, (process, result) => {
    try {
      process.wait_check_finish(result);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
});

const standardInputBytes = new GLib.Bytes(new TextEncoder().encode('editor standard input'));
const [standardInputFile, standardInputStream] = Gio.File.new_tmp('cbx-editor-stdin-XXXXXX');
standardInputStream.get_output_stream().write_all(standardInputBytes.get_data(), null);
standardInputStream.close(null);
const standardInputProcess = await launchEditor({
  command: `/usr/bin/cmp - %i '${standardInputFile.get_path()}'`,
  uri: standardInputFile.get_uri(),
  bytes: standardInputBytes,
});
await new Promise((resolve, reject) => {
  standardInputProcess.wait_check_async(null, (process, result) => {
    try {
      process.wait_check_finish(result);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
});
standardInputFile.delete(null);

await assertRejects(
  launchEditor({
    command: 'gradia %i',
    uri: 'file:///tmp/image.png',
  }),
  /requires image data/u,
  'standard-input command without image bytes',
);

let missingEditorRejected = false;
try {
  await launchEditor({
    command: '/definitely/missing/clipboard-x-gnome-editor %u',
    uri: 'file:///tmp/image.png',
  });
} catch (error) {
  missingEditorRejected = /No such file|not found|Failed to execute/iu.test(error.message);
}
assert(missingEditorRejected, 'missing custom editor executable must be reported');
