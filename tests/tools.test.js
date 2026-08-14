import GLib from 'gi://GLib';

import {launchEditor} from '../src/editor-launcher.js';
import {ScreenshotPortal} from '../src/screenshot-portal.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

async function assertRejects(promise, pattern, message) {
  try {
    await promise;
  } catch (error) {
    assert(pattern.test(error.message), `${message}: ${error.message}`);
    return;
  }
  throw new Error(`${message}: promise resolved unexpectedly`);
}

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
    const response = this.mode === 'success' ? 0 : this.mode === 'cancelled' ? 1 : 2;
    const results = response === 0
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

const cancelConnection = new FakePortalConnection({mode: 'pending'});
const cancelPortal = new ScreenshotPortal({connection: cancelConnection, timeoutMilliseconds: 100});
const cancelled = cancelPortal.capture('interactive');
setTimeout(() => cancelPortal.cancel(), 10);
await assertRejects(cancelled, /cancelled/u, 'explicit cancellation');
assert(cancelConnection.closeCount === 1, 'cancellation must close the Portal request');

const timeoutConnection = new FakePortalConnection({mode: 'pending'});
const timeoutPortal = new ScreenshotPortal({connection: timeoutConnection, timeoutMilliseconds: 10});
await assertRejects(timeoutPortal.capture('interactive'), /timed out/u, 'screenshot timeout');
assert(timeoutConnection.closeCount === 1, 'timeout must close the Portal request');

const oldPortal = new ScreenshotPortal({
  connection: new FakePortalConnection({version: 2, targets: 0}),
  timeoutMilliseconds: 100,
});
await assertRejects(oldPortal.capture('window'), /does not support/u, 'Portal v2 target negotiation');

const editorProcess = launchEditor({
  appId: '',
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
