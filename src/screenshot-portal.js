import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PORTAL_NAME = 'org.freedesktop.portal.Desktop';
const PORTAL_PATH = '/org/freedesktop/portal/desktop';
const SCREENSHOT_INTERFACE = 'org.freedesktop.portal.Screenshot';
const REQUEST_INTERFACE = 'org.freedesktop.portal.Request';
const PROPERTIES_INTERFACE = 'org.freedesktop.DBus.Properties';

const Target = Object.freeze({
  screen: 1,
  window: 2,
  area: 4,
  'active-window': 8,
});

export class ScreenshotPortal {
  constructor({connection = Gio.DBus.session, timeoutMilliseconds = 120_000} = {}) {
    this._connection = connection;
    this._timeoutMilliseconds = timeoutMilliseconds;
    this._request = null;
    this._capabilities = null;
  }

  async capture(target = 'interactive') {
    if (this._request)
      throw new Error('A screenshot request is already active');
    if (target !== 'interactive' && !Object.hasOwn(Target, target))
      throw new Error(`Unsupported screenshot target: ${target}`);

    const request = this._newRequest();
    this._request = request;
    try {
      const capabilities = await this._getCapabilities(request.cancellable);
      const options = this._buildOptions(request.token, target, capabilities);
      const responsePromise = this._waitForResponse(request);
      const callPromise = this._call(
        PORTAL_NAME,
        PORTAL_PATH,
        SCREENSHOT_INTERFACE,
        'Screenshot',
        new GLib.Variant('(sa{sv})', ['', options]),
        new GLib.VariantType('(o)'),
        request.cancellable,
      );
      const [, uri] = await Promise.all([callPromise, responsePromise]);
      return uri;
    } finally {
      this._cleanup(request);
    }
  }

  cancel() {
    const request = this._request;
    if (!request)
      return;

    request.cancellable.cancel();
    this._closeRequest(request.path);
    request.rejectResponse?.(new Error('Screenshot request was cancelled'));
    this._cleanup(request);
  }

  _newRequest() {
    const token = `clipboard_x_${GLib.uuid_string_random().replaceAll('-', '_')}`;
    const sender = this._connection.get_unique_name().slice(1).replaceAll('.', '_');
    return {
      token,
      path: `/org/freedesktop/portal/desktop/request/${sender}/${token}`,
      cancellable: new Gio.Cancellable(),
      subscriptionId: 0,
      timeoutId: 0,
      rejectResponse: null,
    };
  }

  async _getCapabilities(cancellable) {
    if (this._capabilities)
      return this._capabilities;
    try {
      const reply = await this._call(
        PORTAL_NAME,
        PORTAL_PATH,
        PROPERTIES_INTERFACE,
        'GetAll',
        new GLib.Variant('(s)', [SCREENSHOT_INTERFACE]),
        new GLib.VariantType('(a{sv})'),
        cancellable,
        5000,
      );
      const [raw] = reply.deepUnpack();
      this._capabilities = {
        version: Number(unpackVariant(raw.version) ?? 0),
        availableTargets: Number(unpackVariant(raw.AvailableTargets) ?? 0),
      };
    } catch (error) {
      if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        throw error;
      this._capabilities = {version: 2, availableTargets: Target.screen};
    }
    return this._capabilities;
  }

  _buildOptions(token, target, capabilities) {
    const options = {
      handle_token: new GLib.Variant('s', token),
      modal: new GLib.Variant('b', true),
      interactive: new GLib.Variant('b', target === 'interactive'),
    };
    if (target === 'interactive')
      return options;

    const targetValue = Target[target];
    if (capabilities.version < 3) {
      if (target !== 'screen')
        throw new Error(`The installed Screenshot Portal does not support the “${target}” target`);
      return options;
    }
    if ((capabilities.availableTargets & targetValue) === 0)
      throw new Error(`The Screenshot Portal does not advertise the “${target}” target`);
    options.target = new GLib.Variant('u', targetValue);
    return options;
  }

  _waitForResponse(request) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled)
          return;
        settled = true;
        callback(value);
      };
      request.rejectResponse = error => finish(reject, error);
      request.subscriptionId = this._connection.signal_subscribe(
        PORTAL_NAME,
        REQUEST_INTERFACE,
        'Response',
        request.path,
        null,
        Gio.DBusSignalFlags.NONE,
        (_connection, _sender, _path, _interface, _signal, parameters) => {
          const [response, rawResults] = parameters.deepUnpack();
          if (response !== 0) {
            finish(reject, new Error(
              response === 1 ? 'Screenshot request was cancelled' : 'Screenshot request was denied',
            ));
            return;
          }

          const uri = unpackVariant(rawResults.uri);
          if (!uri) {
            finish(reject, new Error('Screenshot Portal returned no URI'));
            return;
          }
          finish(resolve, uri);
        },
      );
      request.timeoutId = setTimeout(() => {
        request.cancellable.cancel();
        this._closeRequest(request.path);
        finish(reject, new Error('Screenshot request timed out'));
      }, this._timeoutMilliseconds);
    });
  }

  _closeRequest(path) {
    this._connection.call(
      PORTAL_NAME,
      path,
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

  _call(busName, objectPath, interfaceName, methodName, parameters, replyType, cancellable, timeout = -1) {
    return new Promise((resolve, reject) => {
      this._connection.call(
        busName,
        objectPath,
        interfaceName,
        methodName,
        parameters,
        replyType,
        Gio.DBusCallFlags.NONE,
        timeout,
        cancellable,
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

  _cleanup(request) {
    if (request.subscriptionId)
      this._connection.signal_unsubscribe(request.subscriptionId);
    if (request.timeoutId)
      clearTimeout(request.timeoutId);
    request.subscriptionId = 0;
    request.timeoutId = 0;
    request.rejectResponse = null;
    if (this._request === request)
      this._request = null;
  }
}

function unpackVariant(value) {
  return value instanceof GLib.Variant ? unpackVariant(value.deepUnpack()) : value;
}
