import {deriveDarkColor, deriveLightColor, parseIconColor, readIconColor, resolveIconColor,
  setIconColor, setIconColorLinked} from '../../src/sync/icon-color.js';

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
assert(deriveLightColor('#204050') === '#66ccff', 'dark colors must derive a bright counterpart while preserving hue');
assert(deriveLightColor('#000000') === '#ffffff', 'black must have a visible light counterpart');
assert(resolveIconColor({light: '#ffffff'}, true) === '#ffffff', 'dark theme must use the light color');
assert(resolveIconColor({light: '#ffffff'}, false) === '#606060', 'light theme must use computed dark color');
assert(resolveIconColor({light: '#ffffff', dark: '#238f4d'}, false) === '#238f4d',
  'independent dark colors must override the computed result');
const values = new Map([
  ['device-icon-color-light', '#2190a4'],
  ['device-icon-color-dark', ''],
  ['device-icon-color-linked', true],
]);
const settings = {
  get_string: key => values.get(key),
  set_string: (key, value) => values.set(key, value),
  get_boolean: key => values.get(key),
  set_boolean: (key, value) => values.set(key, value),
};
assert(JSON.stringify(readIconColor(settings)) === JSON.stringify({light: '#2190a4'}),
  'linked settings must omit dark in the wire profile');
setIconColor(settings, 'dark', '#204050');
assert(settings.get_boolean('device-icon-color-linked') && readIconColor(settings).light === '#66ccff'
    && readIconColor(settings).dark === '#204050',
  'choosing dark while linked must retain it and derive light without unlocking');
setIconColorLinked(settings, false);
assert(readIconColor(settings).dark === '#204050' && !settings.get_boolean('device-icon-color-linked'),
  'unlocking after a dark edit must retain the chosen pair');
setIconColor(settings, 'light', '#d56199');
assert(readIconColor(settings).light === '#d56199' && readIconColor(settings).dark === '#204050',
  'unlinked light edits must not change dark');
setIconColor(settings, 'dark', '#305070');
assert(readIconColor(settings).light === '#d56199' && readIconColor(settings).dark === '#305070',
  'unlinked dark edits must not change light');
setIconColorLinked(settings, true);
assert(settings.get_boolean('device-icon-color-linked') && !Object.hasOwn(readIconColor(settings), 'dark'),
  'relinking must choose the current light color as the source');
setIconColor(settings, 'light', '#ffffff');
assert(readIconColor(settings).light === '#ffffff' && resolveIconColor(readIconColor(settings), false) === '#606060',
  'choosing light while linked must update the derived dark color');
setIconColorLinked(settings, false);
assert(readIconColor(settings).dark === '#606060', 'unlocking must retain the computed dark value for editing');
for (const [kind, value] of [['light', 'red'], ['dark', '#fffff'], ['other', '#123456']]) {
  try {
    setIconColor(settings, kind, value);
    throw new Error('Invalid setting accepted');
  } catch (error) {
    assert(error.message === 'Device icon color selection is invalid', 'invalid color edits must be rejected');
  }
}
for (const value of [null, '#ffffff', {}, {dark: '#111111'}, {light: '#FFFFFF'},
  {light: '#12345g'}, {light: '#ffffff', dark: ''}])
  rejects(value);
