import Gio from 'gi://Gio';

import {DEVICE_ICONS, deviceIcon} from '../../src/ui/icons/device.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

assert(DEVICE_ICONS.length === 10, 'all supplied device icons must be selectable');
for (const name of DEVICE_ICONS) {
  const icon = deviceIcon(name);
  assert(icon instanceof Gio.FileIcon && icon.file.query_exists(null),
    `${name} must resolve to a packaged SVG file`);
  assert(icon.file.get_basename().endsWith('-symbolic.svg'),
    `${name} must use a symbolic icon that adapts to the current theme`);
}
assert(deviceIcon('unknown-platform').file.equal(deviceIcon('computer').file),
  'other clients may send unrecognized icon identifiers');
assert(deviceIcon('__proto__').file.equal(deviceIcon('computer').file),
  'untrusted icon identifiers must never be used as filesystem paths');
