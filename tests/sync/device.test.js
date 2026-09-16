import {isUuid} from '../../src/common/uuid.js';
import {ensureDeviceIdentity} from '../../src/sync/device.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const values = new Map([
  ['device-id', 'not-a-uuid'],
  ['device-tag', ' 工作电脑 '],
  ['device-icon-kind', 'laptop'],
  ['device-icon-color-light', '#ffffff'],
  ['device-icon-color-dark', ''],
]);
const settings = {
  get_string: key => values.get(key),
  set_string: (key, value) => values.set(key, value),
};
const first = ensureDeviceIdentity(settings);
const second = ensureDeviceIdentity(settings);
assert(isUuid(first.deviceId), 'invalid persisted DeviceId must be replaced with UUID v4');
assertEqual(second.deviceId, first.deviceId, 'DeviceId must remain stable after generation');
assertEqual(first.deviceTag, '工作电脑', 'Device Tag should be trimmed for registration');
assertEqual(first.deviceIconKind, 'laptop', 'portable device icon kind should be preserved');
assertEqual(first.deviceIconColor, {light: '#ffffff'}, 'the default icon color must be white and linked');
settings.set_string('device-icon-color-light', '#2190a4');
settings.set_string('device-icon-color-dark', '#145066');
assertEqual(ensureDeviceIdentity(settings).deviceIconColor, {light: '#2190a4', dark: '#145066'},
  'independent light and dark colors must be returned in the device profile');
