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
  ['Sensitive content', '敏感内容'],
  ['The original image has not been downloaded. Enable synchronization first.',
    '原图尚未下载，请先开启同步。'],
]);
const translate = value => translations.get(value) ?? value;

assertEqual(
  message(new SyncError('original_image_requires_sync', 'diagnostic only'), translate),
  '原图尚未下载，请先开启同步。',
  'editing an undownloaded original while sync is disabled must explain how to proceed',
);

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
  message(new SyncError('sensitive_content', 'diagnostic only'), translate),
  '敏感内容',
  'sensitive content must expose a localized refusal instead of a diagnostic',
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
  message({code: 'http_error', message: 'Bad Gateway'}, translate),
  '同步请求失败',
  'an HTTP gateway failure must not display its untranslated diagnostic',
);
assertEqual(
  message(new Error('internal diagnostic'), translate),
  '',
  'an unknown internal error must not expose its diagnostic message to the UI',
);
