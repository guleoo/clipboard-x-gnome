import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PORTAL_NAME = 'org.freedesktop.portal.Desktop';
const PORTAL_PATH = '/org/freedesktop/portal/desktop';
const SCREENSHOT_INTERFACE = 'org.freedesktop.portal.Screenshot';
const REQUEST_INTERFACE = 'org.freedesktop.portal.Request';

const Target = Object.freeze({
  screen: 1,
  window: 2,
  area: 4,
  'active-window': 8,
});

export class ScreenshotPortal {
  constructor() {
    this._connection = Gio.DBus.session;
    this._subscriptionId = 0;
    this._requestPath = null;
    this._cancellable = null;
  }

  async capture(target = 'interactive') {
    if (this._cancellable)
      throw new Error('A screenshot request is already active');

    this._cancellable = new Gio.Cancellable();
    const token = `clipboard_x_${GLib.uuid_string_random().replaceAll('-', '_')}`;
    const sender = this._connection.get_unique_name().slice(1).replaceAll('.', '_');
    this._requestPath = `/org/freedesktop/portal/desktop/request/${sender}/${token}`;

    const options = {
      handle_token: new GLib.Variant('s', token),
      modal: new GLib.Variant('b', true),
      interactive: new GLib.Variant('b', target === 'interactive'),
    };
    if (target !== 'interactive')
      options.target = new GLib.Variant('u', Target[target] ?? Target.screen);

    try {
      const responsePromise = this._waitForResponse();
      await this._call(
        PORTAL_NAME,
        PORTAL_PATH,
        SCREENSHOT_INTERFACE,
        'Screenshot',
        new GLib.Variant('(sa{sv})', ['', options]),
        new GLib.VariantType('(o)'),
      );
      return await responsePromise;
    } finally {
      this._cleanup();
    }
  }

  cancel() {
    if (!this._cancellable)
      return;
    this._cancellable.cancel();
    if (this._requestPath) {
      this._connection.call(
        PORTAL_NAME,
        this._requestPath,
        REQUEST_INTERFACE,
        'Close',
        null,
        null,
        Gio.DBusCallFlags.NONE,
        1000,
        null,
        null,
      );
    }
    this._cleanup();
  }

  _waitForResponse() {
    return new Promise((resolve, reject) => {
      this._subscriptionId = this._connection.signal_subscribe(
        PORTAL_NAME,
        REQUEST_INTERFACE,
        'Response',
        this._requestPath,
        null,
        Gio.DBusSignalFlags.NONE,
        (_connection, _sender, _path, _interface, _signal, parameters) => {
          const [response, results] = parameters.deepUnpack();
          if (response !== 0) {
            reject(new Error(response === 1 ? 'Screenshot request was cancelled' : 'Screenshot request failed'));
            return;
          }

          const uri = results.uri instanceof GLib.Variant
            ? results.uri.get_string()[0]
            : results.uri;
          if (!uri) {
            reject(new Error('Screenshot portal returned no URI'));
            return;
          }
          resolve(uri);
        },
      );
    });
  }

  _call(busName, objectPath, interfaceName, methodName, parameters, replyType) {
    return new Promise((resolve, reject) => {
      this._connection.call(
        busName,
        objectPath,
        interfaceName,
        methodName,
        parameters,
        replyType,
        Gio.DBusCallFlags.NONE,
        -1,
        this._cancellable,
        (connection, result) => {
          try {
            resolve(connection.call_finish(result));
          } catch (error) {
            reject(error);
          }
        },
      );
    });
  }

  _cleanup() {
    if (this._subscriptionId) {
      this._connection.signal_unsubscribe(this._subscriptionId);
      this._subscriptionId = 0;
    }
    this._requestPath = null;
    this._cancellable = null;
  }
}
