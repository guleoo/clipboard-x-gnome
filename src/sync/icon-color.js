export const DEFAULT_ICON_COLOR = '#ffffff';

const HEX_COLOR = /^#[0-9a-f]{6}$/u;

export function parseIconColor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.light !== 'string' || !HEX_COLOR.test(value.light)
      || (value.dark !== undefined && (typeof value.dark !== 'string' || !HEX_COLOR.test(value.dark))))
    throw new Error('Synchronization device icon color is invalid');
  return {light: value.light, ...(value.dark === undefined ? {} : {dark: value.dark})};
}

export function readIconColor(settings) {
  const light = settings.get_string('device-icon-color-light');
  const dark = settings.get_string('device-icon-color-dark');
  return {
    light: HEX_COLOR.test(light) ? light : DEFAULT_ICON_COLOR,
    ...(HEX_COLOR.test(dark) ? {dark} : {}),
  };
}

export function setIconColorLinked(settings, linked) {
  const colors = readIconColor(settings);
  settings.set_boolean('device-icon-color-linked', linked);
  settings.set_string('device-icon-color-dark', linked ? '' : colors.dark ?? deriveDarkColor(colors.light));
}

export function setIconColor(settings, kind, color) {
  if (!HEX_COLOR.test(color) || !['light', 'dark'].includes(kind))
    throw new Error('Device icon color selection is invalid');
  if (kind === 'light') {
    if (settings.get_boolean('device-icon-color-linked'))
      settings.set_string('device-icon-color-dark', '');
    settings.set_string('device-icon-color-light', color);
  } else {
    if (settings.get_boolean('device-icon-color-linked'))
      settings.set_string('device-icon-color-light', deriveLightColor(color));
    settings.set_string('device-icon-color-dark', color);
  }
}

export function deriveDarkColor(light) {
  const channels = [1, 3, 5].map(index => Number.parseInt(light.slice(index, index + 2), 16));
  const highest = Math.max(...channels);
  const scale = highest > 96 ? 96 / highest : 1;
  return `#${channels.map(value => Math.round(value * scale).toString(16).padStart(2, '0')).join('')}`;
}

export function deriveLightColor(dark) {
  const channels = [1, 3, 5].map(index => Number.parseInt(dark.slice(index, index + 2), 16));
  const highest = Math.max(...channels);
  if (highest === 0)
    return DEFAULT_ICON_COLOR;
  return `#${channels.map(value => Math.round(value * 255 / highest).toString(16).padStart(2, '0')).join('')}`;
}

export function resolveIconColor(value, darkTheme) {
  const color = parseIconColor(value);
  return darkTheme ? color.light : color.dark ?? deriveDarkColor(color.light);
}
