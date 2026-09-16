import {deriveDarkColor, parseIconColor, readIconColor, resolveIconColor,
  setIconColorLinked} from '../../src/sync/icon-color.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function rejects(value) {
  try {
    parseIconColor(value);
  } catch (_error) {
    return;
  }
  throw new Error(`Invalid icon color accepted: ${JSON.stringify(value)}`);
}

assert(deriveDarkColor('#ffffff') === '#606060', 'white must derive a contrasting dark gray');
assert(deriveDarkColor('#2190a4') === '#135460', 'color calculation must preserve hue while reducing brightness');
assert(resolveIconColor({light: '#ffffff'}, true) === '#ffffff', 'dark theme must use the light color');
assert(resolveIconColor({light: '#ffffff'}, false) === '#606060', 'light theme must use computed dark color');
assert(resolveIconColor({light: '#ffffff', dark: '#238f4d'}, false) === '#238f4d',
  'independent dark colors must override the computed result');
const values = new Map([['device-icon-color-light', '#2190a4'], ['device-icon-color-dark', '']]);
const settings = {get_string: key => values.get(key), set_string: (key, value) => values.set(key, value)};
assert(JSON.stringify(readIconColor(settings)) === JSON.stringify({light: '#2190a4'}),
  'linked settings must omit dark in the wire profile');
setIconColorLinked(settings, false);
assert(readIconColor(settings).dark === '#135460', 'unlocking must retain the computed dark value for editing');
values.set('device-icon-color-dark', '#204050');
setIconColorLinked(settings, true);
assert(!Object.hasOwn(readIconColor(settings), 'dark'), 'relinking must discard the custom dark value');
for (const value of [null, '#ffffff', {}, {dark: '#111111'}, {light: '#FFFFFF'},
  {light: '#12345g'}, {light: '#ffffff', dark: ''}])
  rejects(value);
