import GLib from 'gi://GLib';

import {isUuid} from '../common/uuid.js';

export function ensureDeviceIdentity(settings) {
  let deviceId = settings.get_string('device-id').trim();
  if (!isUuid(deviceId)) {
    deviceId = GLib.uuid_string_random();
    settings.set_string('device-id', deviceId);
  }

  let deviceTag = settings.get_string('device-tag').trim();
  if (!deviceTag) {
    deviceTag = GLib.get_host_name() || 'GNOME';
    settings.set_string('device-tag', deviceTag);
  }

  let deviceIconKind = String(settings.get_string('device-icon-kind') ?? '').trim();
  if (!deviceIconKind || deviceIconKind.length > 128 || /[\r\n\0]/u.test(deviceIconKind)) {
    deviceIconKind = 'computer';
    settings.set_string('device-icon-kind', deviceIconKind);
  }

  return {deviceId, deviceTag, deviceIconKind};
}
