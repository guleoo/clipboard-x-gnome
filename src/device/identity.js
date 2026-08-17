import GLib from 'gi://GLib';

import {DEVICE_ICON_KINDS} from './constants.js';

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
  if (!DEVICE_ICON_KINDS.includes(deviceIconKind)) {
    deviceIconKind = 'desktop';
    settings.set_string('device-icon-kind', deviceIconKind);
  }

  return {deviceId, deviceTag, deviceIconKind};
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
