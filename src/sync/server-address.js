import GLib from 'gi://GLib';

import {SyncError} from './errors.js';

export function normalize(value) {
  let address = String(value ?? '').trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(address))
    address = `http://${address}`;
  let uri;
  try {
    uri = GLib.Uri.parse(address, GLib.UriFlags.NONE);
  } catch (_error) {
    throw new SyncError('invalid_server_address', 'Synchronization server address is invalid');
  }
  if (!['http', 'https'].includes(uri.get_scheme()) || !uri.get_host()
      || uri.get_userinfo() || uri.get_fragment() || uri.get_query())
    throw new SyncError('invalid_server_address', 'Synchronization server address is invalid');
  return address.replace(/\/+$/u, '');
}
