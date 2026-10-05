import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Keep only bounded diagnostic metadata, never messages, arguments or response bodies.
const failures = new WeakMap();
const session = GLib.uuid_string_random();
const sourceRoot = import.meta.url.slice(0, -'common/logger.js'.length);
// A server can supply arbitrary error codes. Only known codes may reach diagnostics.
const codes = new Set([
  'disabled', 'sensitive_content', 'server_unavailable', 'channel_required',
  'file_verifier_unavailable', 'file_verification_failed', 'invalid_server_address',
  'invalid_key', 'not_authorized', 'device_disabled', 'device_mismatch',
  'channel_forbidden', 'item_conflict', 'content_not_ready', 'source_content_missing',
  'too_large', 'invalid_content_size', 'hash_mismatch', 'size_mismatch',
  'transfer_expired', 'rate_limited', 'invalid_response', 'response_too_large',
  'upload_failed', 'source_upload_failed', 'download_failed', 'write_failed',
  'network_error', 'http_error', 'request_failed',
]);
const types = new Set(['Error', 'SyncError', 'HttpError', 'TypeError', 'RangeError',
  'SyntaxError', 'ReferenceError', 'GError', 'Gio_IOErrorEnum']);
const token = (value, fallback) => typeof value === 'string'
  && /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/u.test(value) ? value : fallback;

function read(object, key) {
  try {
    return object?.[key];
  } catch (_) {
    return undefined;
  }
}

function frames(error) {
  const stack = read(error, 'stack');
  return (typeof stack === 'string' ? stack.slice(0, 8192) : '').split('\n').flatMap(line => {
    const location = line.slice(line.lastIndexOf('@') + 1);
    if (location.startsWith(sourceRoot)) {
      const relative = location.slice(sourceRoot.length);
      if (/^(?:common|sync|entry|ui|clipboard|color-picker|screenshot)\/[a-zA-Z0-9_/-]+\.js:\d+(?::\d+)?$/u.test(relative))
        return [`/${relative}`.slice(-240)];
    }
    if (/^resource:\/\/\/org\/gnome\/[a-zA-Z0-9_./-]+\.js:\d+(?::\d+)?$/u.test(location))
      return [location.slice(-240)];
    return [];
  }).slice(0, 12);
}

function diagnostic(error) {
  const type = read(read(error, 'constructor'), 'name');
  const code = read(error, 'code');
  return {
    type: types.has(type) ? type : 'Error',
    code: Number.isInteger(code) ? code : codes.has(code) ? code : 'unknown',
    frames: frames(error),
  };
}

function causes(error) {
  const result = [];
  const seen = new Set([error]);
  for (let cause = read(error, 'cause'); cause && !seen.has(cause) && result.length < 3; cause = read(cause, 'cause')) {
    seen.add(cause);
    result.push(diagnostic(cause));
  }
  return result;
}

function cancelled(error) {
  try {
    return Boolean(error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED));
  } catch (_) {
    return false;
  }
}

function defaultSink(record) {
  const line = `Clipboard X ${JSON.stringify(record)}`;
  if (record.level === 'error')
    console.error(line);
  else if (record.level === 'warn')
    console.warn(line);
  else
    console.log(line);
}

export function createLogger(module, {
  sink = defaultSink,
  now = () => new Date().toISOString(),
  monotonic = () => GLib.get_monotonic_time() / 1000,
  identifier = () => GLib.uuid_string_random(),
} = {}) {
  const write = (level, operation, fields = {}) => {
    // Diagnostics must not replace the application's error or abort its cleanup.
    try {
      sink({time: now(), level, session, module: token(module, 'unknown'),
        operation: token(operation, 'unknown'), ...fields});
    } catch (_) {
      // A broken console/log sink is deliberately non-fatal.
    }
  };
  const report = (level, operation, error) => {
    const context = error && typeof error === 'object' ? failures.get(error) : null;
    if (context?.reported)
      return;
    const isCancelled = cancelled(error);
    write(isCancelled ? 'info' : level, operation, {
      outcome: isCancelled ? 'cancelled' : 'failed',
      ...(context ? {id: context.id, phase: context.phase, durationMs: context.durationMs} : {id: identifier()}),
      error: diagnostic(error),
      causes: causes(error),
    });
    if (context)
      context.reported = true;
  };
  return {
    info: operation => write('info', operation),
    warn: (operation, error) => report('warn', operation, error),
    error: (operation, error) => report('error', operation, error),
    async run(operation, callback, {quiet = false} = {}) {
      const id = identifier();
      const started = monotonic();
      let phase = 'begin';
      if (!quiet)
        write('info', operation, {id, phase, outcome: 'started'});
      const scope = {
        step(name, action) {
          phase = token(name, 'unknown');
          if (!quiet)
            write('info', operation, {id, phase, outcome: 'started'});
          return action();
        },
      };
      try {
        const result = await callback(scope);
        if (!quiet)
          write('info', operation, {id, phase, outcome: 'completed',
            durationMs: Math.max(0, Math.round(monotonic() - started))});
        return result;
      } catch (error) {
        if (error && typeof error === 'object')
          failures.set(error, {id, phase, reported: false,
            durationMs: Math.max(0, Math.round(monotonic() - started))});
        report('error', operation, error);
        throw error;
      }
    },
  };
}
