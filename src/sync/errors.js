export class SyncError extends Error {
  constructor(code, diagnosticMessage, options = {}) {
    super(diagnosticMessage, options);
    this.name = 'SyncError';
    this.code = code;
  }
}

export function message(error, _) {
  switch (error?.code) {
  case 'disabled':
    return _('Synchronization is disabled');
  case 'sensitive_content':
    return _('Sensitive content');
  case 'server_unavailable':
    return _('Synchronization server is unavailable');
  case 'channel_required':
    return _('No active synchronization channel is configured');
  case 'invalid_server_address':
    return _('Synchronization server address is invalid');
  case 'invalid_key':
  case 'not_authorized':
    return _('Synchronization authentication failed');
  case 'device_disabled':
    return _('This device is disabled on the synchronization server');
  case 'device_mismatch':
    return _('The API key does not belong to this device');
  case 'channel_forbidden':
    return _('This device does not have access to the synchronization channel');
  case 'item_conflict':
    return _('The clipboard item conflicts with an item on the synchronization server');
  case 'content_not_ready':
    return _('The clipboard content is not ready on the source device');
  case 'source_content_missing':
    return _('The source device no longer has this clipboard content');
  case 'too_large':
  case 'invalid_content_size':
    return _('The clipboard content exceeds the synchronization size limit');
  case 'hash_mismatch':
  case 'size_mismatch':
    return _('The synchronized content failed integrity verification');
  case 'transfer_expired':
    return _('The synchronization transfer expired');
  case 'rate_limited':
    return _('The synchronization server is busy. Try again later.');
  case 'invalid_response':
  case 'response_too_large':
    return _('The synchronization server returned an invalid response');
  case 'upload_failed':
  case 'source_upload_failed':
    return _('Synchronization upload failed');
  case 'download_failed':
  case 'write_failed':
    return _('Synchronization download failed');
  case 'network_error':
  case 'http_error':
  case 'request_failed':
    return _('Synchronization request failed');
  default:
    return '';
  }
}
