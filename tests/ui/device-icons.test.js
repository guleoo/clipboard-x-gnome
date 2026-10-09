import Gio from 'gi://Gio';

import {DEVICE_ICONS, deviceIcon} from '../../src/ui/icons/device.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

for (const name of DEVICE_ICONS) {
  const icon = deviceIcon(name);
  assert(icon instanceof Gio.FileIcon && icon.file.query_exists(null),
    `${name} must resolve to a packaged SVG file`);
}
assert(deviceIcon('unknown-platform').file.equal(deviceIcon('computer').file),
  'other clients may send unrecognized icon identifiers');
assert(deviceIcon('__proto__').file.equal(deviceIcon('computer').file),
  'untrusted icon identifiers must never be used as filesystem paths');
