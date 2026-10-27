import {message, SyncError} from '../../../src/sync/errors.js';

function assert(value, description) {
  if (!value) throw new Error(description);
}

// Stable codes, not server diagnostics, select translatable user-facing text.
const groups = [
  [['disabled'], 'Synchronization is disabled'],
  [['original_image_requires_sync'], 'The original image has not been downloaded. Enable synchronization first.'],
  [['sensitive_content'], 'Sensitive content'],
  [['server_unavailable'], 'Synchronization server is unavailable'],
  [['file_verifier_unavailable'], 'Install sha256sum (usually provided by coreutils) to enable external file verification.'],
  [['file_verification_failed'], 'File verification with sha256sum failed'],
  [['channel_required'], 'No active synchronization channel is configured'],
  [['invalid_server_address'], 'Synchronization server address is invalid'],
  [['invalid_key', 'not_authorized'], 'Synchronization authentication failed'],
  [['device_disabled'], 'This device is disabled on the synchronization server'],
  [['device_mismatch'], 'The API key does not belong to this device'],
  [['channel_forbidden'], 'This device does not have access to the synchronization channel'],
  [['item_conflict'], 'The clipboard item conflicts with an item on the synchronization server'],
  [['content_not_ready'], 'The clipboard content is not ready on the source device'],
  [['source_content_missing'], 'The source device no longer has this clipboard content'],
  [['too_large', 'invalid_content_size'], 'The clipboard content exceeds the synchronization size limit'],
  [['hash_mismatch', 'size_mismatch'], 'The synchronized content failed integrity verification'],
  [['transfer_expired'], 'The synchronization transfer expired'],
  [['rate_limited'], 'The synchronization server is busy. Try again later.'],
  [['invalid_response', 'response_too_large'], 'The synchronization server returned an invalid response'],
  [['upload_failed', 'source_upload_failed'], 'Synchronization upload failed'],
  [['download_failed', 'write_failed'], 'Synchronization download failed'],
  [['network_error', 'http_error', 'request_failed'], 'Synchronization request failed'],
];
const secret = 'clipboard-body-and-api-key-MUST-NOT-APPEAR';
for (const [codes, expected] of groups) {
  for (const code of codes) {
    const calls = [];
    const error = new SyncError(code, secret, {cause: new Error(secret)});
    error.apiKey = secret;
    error.content = secret;
    const actual = message(error, text => { calls.push(text); return `translated:${text}`; });
    assert(actual === `translated:${expected}` && calls.length === 1 && calls[0] === expected,
      `${code}: the stable message must pass through gettext exactly once`);
    assert(!actual.includes(secret), `${code}: diagnostic, content and credentials must not enter UI text`);
  }
}
for (const error of [new Error(secret), new SyncError('unrecognized', secret),
  {code: 'unrecognized', message: secret}, null]) {
  let translated = false;
  assert(message(error, () => { translated = true; return secret; }) === '' && !translated,
    'Unknown errors must request a safe caller fallback, not translate arbitrary diagnostics');
}
assert(message({code: 'invalid_key', message: secret}, text => text)
  === 'Synchronization authentication failed', 'Plain protocol error objects use the same safe mapping');
