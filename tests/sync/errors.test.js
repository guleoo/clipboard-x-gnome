import {message, SyncError} from '../../src/sync/errors.js';

function assertEqual(actual, expected, description) {
  if (actual !== expected)
    throw new Error(`${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const translations = new Map([
  ['No active synchronization channel is configured', '尚未配置同步 Channel'],
  ['Synchronization server is unavailable', '同步服务器不可用'],
  ['Synchronization authentication failed', '同步认证失败'],
  ['Synchronization request failed', '同步请求失败'],
]);
const translate = value => translations.get(value) ?? value;

assertEqual(
  message(new SyncError('channel_required', 'diagnostic only'), translate),
  '尚未配置同步 Channel',
  'a client-side channel error must be translated by its stable code',
);
assertEqual(
  message(new SyncError('server_unavailable', 'diagnostic only'), translate),
  '同步服务器不可用',
  'an unavailable server must have a localized user-facing message',
);
assertEqual(
  message({code: 'invalid_key', message: 'server-controlled English'}, translate),
  '同步认证失败',
  'a server error must use its code instead of its untrusted message',
);
assertEqual(
  message({code: 'request_failed', message: 'diagnostic only'}, translate),
  '同步请求失败',
  'a request failure must have a localized user-facing message',
);
assertEqual(
  message(new Error('internal diagnostic'), translate),
  '',
  'an unknown internal error must not expose its diagnostic message to the UI',
);
