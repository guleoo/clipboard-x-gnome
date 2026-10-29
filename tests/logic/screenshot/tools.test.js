import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {buildEditorArgv, launchEditor} from '../../../src/screenshot/editor-launcher.js';
import {ScreenshotPortal} from '../../../src/screenshot/portal.js';

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
    // GLib errors carry translated messages, so callers may match the error code instead.
    const matched = typeof pattern === 'function' ? pattern(error) : pattern.test(error.message);
    assert(matched, `${message}: ${error.message}`);
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
  constructor({mode = 'success', version = 3, targets = 15, failures = {}} = {}) {
    this.mode = mode;
    this.version = version;
    this.targets = targets;
    this.closeCount = 0;
    this.calls = [];
    this.failures = failures;
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
    this.calls.push(method);
    if (method === 'Close') {
      this.closeCount++;
      return;
    }

    setTimeout(() => {
      if (this.failures[method]) {
        callback(this, {error: this.failures[method]});
        return;
      }
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

for (const [target, flag] of Object.entries({screen: 1, window: 2, area: 4, 'active-window': 8})) {
  const connection = new FakePortalConnection({targets: flag});
  const portal = new ScreenshotPortal({connection, timeoutMilliseconds: 100});
  assert(await portal.capture(target) === uri, `${target}: its advertised capability must allow capture`);
  assert(connection.lastOptions.target === flag && connection.lastOptions.interactive === false,
    `${target}: forward exactly the selected target bit without enabling interactive selection`);

  const unsupportedConnection = new FakePortalConnection({targets: 15 ^ flag});
  const unsupportedPortal = new ScreenshotPortal({connection: unsupportedConnection, timeoutMilliseconds: 100});
  await assertRejects(unsupportedPortal.capture(target), /does not advertise/u, `${target}: absent target capability`);
  assert(unsupportedConnection.calls.join() === 'GetAll'
    && unsupportedConnection._subscriptions.size === 0 && !unsupportedPortal._request,
  `${target}: rejection must not issue a screenshot request or retain resources`);
}

for (const version of [2, 3]) {
  for (const target of ['interactive', 'screen', 'window', 'area', 'active-window']) {
    // Interactive selection is independent of advertised fixed targets. Older
    // portals support only screen without a target option, not v3 target flags.
    if (version === 3 && target !== 'interactive') continue;
    const connection = new FakePortalConnection({version, targets: 0});
    const portal = new ScreenshotPortal({connection, timeoutMilliseconds: 100});
    if (target === 'interactive' || target === 'screen') {
      assert(await portal.capture(target) === uri, `Portal v${version}: ${target} must remain supported`);
      assert(!Object.hasOwn(connection.lastOptions, 'target')
        && connection.lastOptions.interactive === (target === 'interactive'),
      `Portal v${version}: ${target} must preserve the protocol's interaction and target options`);
    } else {
      await assertRejects(portal.capture(target), /does not support/u, `Portal v2: reject ${target}`);
      assert(connection.calls.join() === 'GetAll' && !portal._request && !connection._subscriptions.size,
        `Portal v2: unsupported ${target} must fail before subscribing or capturing`);
    }
  }
}

for (const unavailable of [false, true]) {
  const failure = new GLib.Error(Gio.dbus_error_quark(),
    unavailable ? Gio.DBusError.SERVICE_UNKNOWN : Gio.DBusError.NO_REPLY,
    unavailable ? 'Screenshot portal is unavailable' : 'Screenshot D-Bus call did not reply');
  const connection = new FakePortalConnection({failures: {
    ...(unavailable ? {GetAll: failure} : {}), Screenshot: failure,
  }});
  let observers = 0;
  const portal = new ScreenshotPortal({connection, timeoutMilliseconds: 100,
    observeCancellation: () => { observers++; return () => { observers--; }; },
  });
  const capture = portal.capture('interactive');
  const request = portal._request;
  let observed;
  try { await capture; } catch (error) { observed = error; }
  assert(observed === failure, 'D-Bus capture failure must preserve the original native exception');
  assert(!portal._request && !connection._subscriptions.size && observers === 0
    && request.subscriptionId === 0 && request.timeoutId === 0 && request.stopObserving === null,
  'D-Bus capture failure must release the active request, response subscription, timeout and cancellation observer');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert(connection.closeCount === 0, 'A failed D-Bus call must not leave a timeout that later closes a stale request');
  connection.failures = {};
  assert(await portal.capture('interactive') === uri && !portal._request
    && !connection._subscriptions.size && observers === 0,
  'The same portal must accept a successful retry after a D-Bus failure without retaining resources');
}

const deniedPortal = new ScreenshotPortal({
  connection: new FakePortalConnection({mode: 'denied'}),
  timeoutMilliseconds: 100,
});
await assertRejects(deniedPortal.capture('screen'), /denied/u, 'denied screenshot');

let userDismissed;
let activeObservers = 0;
const observedConnection = new FakePortalConnection({mode: 'pending'});
const observedPortal = new ScreenshotPortal({
  connection: observedConnection,
  timeoutMilliseconds: 100,
  observeCancellation: cancelled => {
    userDismissed = cancelled;
    activeObservers++;
    return () => { activeObservers--; };
  },
});
const observedCapture = observedPortal.capture('interactive');
await new Promise(resolve => setTimeout(resolve, 10));
userDismissed();
observedConnection.mode = 'denied';
observedConnection._respond();
assert(await observedCapture === null && activeObservers === 0,
  'GNOME response 2 after confirmed user dismissal must cancel and disconnect the observer');
assert(observedConnection._subscriptions.size === 0 && observedPortal._request === null,
  'GNOME user cancellation must release its Portal resources');

await assertRejects(observedPortal.capture('interactive'), /denied/u,
  'A later response 2 without user dismissal must remain a failure');
assert(activeObservers === 0, 'A screenshot failure must disconnect the cancellation observer');
observedConnection.mode = 'success';
assert(await observedPortal.capture('interactive') === uri && activeObservers === 0,
  'A successful screenshot must disconnect the cancellation observer');
observedConnection.mode = 'pending';
const observedCancel = observedPortal.capture('interactive');
await new Promise(resolve => setTimeout(resolve, 10));
observedPortal.cancel();
assert(await observedCancel === null && activeObservers === 0,
  'Disabling during a screenshot must disconnect the cancellation observer');
await assertRejects(observedPortal.capture('interactive'), /timed out/u,
  'An unresponsive Portal must still time out');
assert(activeObservers === 0, 'A screenshot timeout must disconnect the cancellation observer');

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

// More than a pipe buffer: the reader waits for a callback after launch returns.
// Startup must not wait for the editor to consume stdin or block the main loop.
const delayedInput = new GLib.Bytes(Uint8Array.from(
  {length: 1024 * 1024}, (_, index) => index % 251,
));
const [delayedFile, delayedStream] = Gio.File.new_tmp('cbx-editor-delayed-XXXXXX');
const releaseFile = Gio.File.new_for_path(`${delayedFile.get_path()}.release`);
const fixture = Gio.File.new_for_uri(import.meta.url).get_parent()
  .get_child('fixtures').get_child('editor-stdin.py').get_path();
let releaseSource = 0;
let delayedProcess = null;
try {
  delayedStream.get_output_stream().write_all(delayedInput.get_data(), null);
  delayedStream.close(null);
  const argv = [GLib.getenv('CBX_TEST_PYTHON'), fixture, delayedFile.get_path(), releaseFile.get_path()];
  assert(argv[0], 'Screenshot tests require a configured Python executable');
  delayedProcess = await launchEditor({
    command: `${argv.map(value => GLib.shell_quote(value)).join(' ')} %i`,
    uri: delayedFile.get_uri(),
  });
  releaseSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
    releaseSource = 0;
    releaseFile.replace_contents('ready', null, false, Gio.FileCreateFlags.PRIVATE, null);
    return GLib.SOURCE_REMOVE;
  });
  await new Promise((resolve, reject) => {
    delayedProcess.wait_check_async(null, (process, result) => {
      try {
        process.wait_check_finish(result);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
  assert(releaseFile.query_exists(null), 'Editor startup must keep the parent main loop responsive');
} finally {
  if (releaseSource)
    GLib.Source.remove(releaseSource);
  if (delayedProcess)
    delayedProcess.force_exit();
  if (!delayedStream.is_closed())
    delayedStream.close(null);
  delayedFile.delete(null);
  if (releaseFile.query_exists(null))
    releaseFile.delete(null);
}

await assertRejects(
  launchEditor({
    command: 'gradia %i',
    uri: 'https://example.test/image.png',
  }),
  /requires a local file/u,
  'standard-input command requires a local file',
);

await assertRejects(
  launchEditor({command: '/usr/bin/true %i', uri: standardInputFile.get_uri()}),
  error => error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND),
  'Missing standard-input image must be reported before starting the editor',
);

let missingEditorRejected = false;
try {
  await launchEditor({
    command: '/definitely/missing/clipboard-x-gnome-editor %u',
    uri: 'file:///tmp/image.png',
  });
} catch (error) {
  missingEditorRejected = error.matches?.(GLib.SpawnError, GLib.SpawnError.NOENT) ?? false;
}
assert(missingEditorRejected, 'missing custom editor executable must be reported');
