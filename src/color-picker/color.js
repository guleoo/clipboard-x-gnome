const DEFAULT_LENS_RADIUS = 5;

export function parse(value) {
  if (typeof value !== 'string')
    return null;
  const source = value.trim();
  if (!source)
    return null;
  return parseHex(source)
    ?? parseRgb(source)
    ?? parseHsl(source)
    ?? parseOklch(source);
}

export function sampleRegion(x, y, scale, textureWidth, textureHeight, radius = DEFAULT_LENS_RADIUS) {
  const pixelX = clamp(Math.round(x * scale), 0, textureWidth - 1);
  const pixelY = clamp(Math.round(y * scale), 0, textureHeight - 1);
  const left = Math.max(0, pixelX - radius);
  const top = Math.max(0, pixelY - radius);
  const right = Math.min(textureWidth - 1, pixelX + radius);
  const bottom = Math.min(textureHeight - 1, pixelY + radius);
  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
    centerX: pixelX - left,
    centerY: pixelY - top,
  };
}

// Coordinates are logical stage positions; movement is in screenshot pixel cells.
export function moveSample(x, y, dx, dy, scale, textureWidth, textureHeight) {
  return [
    clamp(Math.round(x * scale) + dx, 0, textureWidth - 1) / scale,
    clamp(Math.round(y * scale) + dy, 0, textureHeight - 1) / scale,
  ];
}

export function formatColor(rgb, format = 'hex') {
  const normalized = rgb.map(value => clamp(Math.round(value), 0, 255));
  if (format === 'rgb')
    return `rgb(${normalized.join(', ')})`;
  if (format === 'hsl') {
    const [hue, saturation, lightness] = rgbToHsl(normalized);
    return `hsl(${Math.round(hue)} ${Math.round(saturation)}% ${Math.round(lightness)}%)`;
  }
  if (format === 'oklch') {
    const [lightness, chroma, hue] = rgbToOklch(normalized);
    return `oklch(${(lightness * 100).toFixed(2)}% ${chroma.toFixed(4)} ${hue.toFixed(2)})`;
  }
  return rgbToHex(normalized);
}

function rgbToHex(rgb) {
  return `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function rgbToHsl([red, green, blue]) {
  const [r, g, b] = [red, green, blue].map(value => value / 255);
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const lightness = (maximum + minimum) / 2;
  if (maximum === minimum)
    return [0, 0, lightness * 100];

  const delta = maximum - minimum;
  const saturation = lightness > 0.5
    ? delta / (2 - maximum - minimum)
    : delta / (maximum + minimum);
  let hue;
  if (maximum === r)
    hue = (g - b) / delta + (g < b ? 6 : 0);
  else if (maximum === g)
    hue = (b - r) / delta + 2;
  else
    hue = (r - g) / delta + 4;
  return [hue * 60, saturation * 100, lightness * 100];
}

function rgbToOklch([red, green, blue]) {
  const [r, g, b] = [red, green, blue]
    .map(value => value / 255)
    .map(value => value > 0.04045 ? ((value + 0.055) / 1.055) ** 2.4 : value / 12.92);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, bAxis);
  const hue = chroma < 1e-7 ? 0 : (Math.atan2(bAxis, a) * 180 / Math.PI + 360) % 360;
  return [lightness, chroma, hue];
}

function parseHex(source) {
  const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/iu.exec(source);
  if (!match)
    return null;
  const expanded = match[1].length <= 4
    ? [...match[1]].map(value => value.repeat(2)).join('')
    : match[1];
  return color(
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
    expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
  );
}

function parseRgb(source) {
  const body = functionBody(source, ['rgb', 'rgba']);
  if (body === null)
    return null;
  const values = functionValues(body);
  if (!values)
    return null;
  const channels = values.components.map(parseRgbChannel);
  const alpha = parseAlpha(values.alpha);
  if (channels.some(value => value === null) || alpha === null)
    return null;
  return color(...channels, alpha);
}

function parseHsl(source) {
  const body = functionBody(source, ['hsl', 'hsla']);
  if (body === null)
    return null;
  const values = functionValues(body);
  if (!values)
    return null;
  const hue = parseHue(values.components[0]);
  const saturation = parsePercentage(values.components[1]);
  const lightness = parsePercentage(values.components[2]);
  const alpha = parseAlpha(values.alpha);
  if ([hue, saturation, lightness, alpha].some(value => value === null))
    return null;
  return color(...hslToRgb(hue, saturation, lightness), alpha);
}

function parseOklch(source) {
  const body = functionBody(source, ['oklch']);
  if (body === null || body.includes(','))
    return null;
  const values = functionValues(body);
  if (!values)
    return null;
  const lightness = parseUnitInterval(values.components[0]);
  const chroma = parseNumber(values.components[1], 0);
  const hue = parseHue(values.components[2]);
  const alpha = parseAlpha(values.alpha);
  if ([lightness, chroma, hue, alpha].some(value => value === null))
    return null;
  return color(...oklchToRgb(lightness, chroma, hue), alpha);
}

function functionBody(source, names) {
  const match = new RegExp(`^(?:${names.join('|')})\\((.*)\\)$`, 'iu').exec(source);
  return match?.[1]?.trim() ?? null;
}

function functionValues(body) {
  if (body.includes(',')) {
    if (body.includes('/'))
      return null;
    const components = body.split(',').map(value => value.trim());
    if (![3, 4].includes(components.length) || components.some(value => !value))
      return null;
    return {components: components.slice(0, 3), alpha: components[3] ?? null};
  }
  const alphaParts = body.split('/').map(value => value.trim());
  if (alphaParts.length > 2 || alphaParts.some(value => !value))
    return null;
  const components = alphaParts[0].split(/\s+/u);
  if (components.length !== 3)
    return null;
  return {components, alpha: alphaParts[1] ?? null};
}

function parseRgbChannel(source) {
  if (source.endsWith('%')) {
    const percentage = parseNumber(source.slice(0, -1), 0, 100);
    return percentage === null ? null : percentage * 255 / 100;
  }
  return parseNumber(source, 0, 255);
}

function parseAlpha(source) {
  if (source === null)
    return 1;
  if (source.endsWith('%')) {
    const percentage = parseNumber(source.slice(0, -1), 0, 100);
    return percentage === null ? null : percentage / 100;
  }
  return parseNumber(source, 0, 1);
}

function parsePercentage(source) {
  if (!source.endsWith('%'))
    return null;
  const percentage = parseNumber(source.slice(0, -1), 0, 100);
  return percentage === null ? null : percentage / 100;
}

function parseUnitInterval(source) {
  if (source.endsWith('%'))
    return parsePercentage(source);
  return parseNumber(source, 0, 1);
}

function parseHue(source) {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:deg)?$/iu.exec(source);
  if (!match)
    return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? ((value % 360) + 360) % 360 : null;
}

function parseNumber(source, minimum = -Infinity, maximum = Infinity) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(source))
    return null;
  const value = Number(source);
  return Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function hslToRgb(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const secondary = chroma * (1 - Math.abs(segment % 2 - 1));
  const [red, green, blue] = segment < 1 ? [chroma, secondary, 0]
    : segment < 2 ? [secondary, chroma, 0]
      : segment < 3 ? [0, chroma, secondary]
        : segment < 4 ? [0, secondary, chroma]
          : segment < 5 ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  const match = lightness - chroma / 2;
  return [red, green, blue].map(value => (value + match) * 255);
}

function oklchToRgb(lightness, chroma, hue) {
  const angle = hue * Math.PI / 180;
  const a = chroma * Math.cos(angle);
  const b = chroma * Math.sin(angle);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(linear => {
    const value = linear <= 0.0031308
      ? 12.92 * linear
      : 1.055 * linear ** (1 / 2.4) - 0.055;
    return clamp(value, 0, 1) * 255;
  });
}

function color(red, green, blue, alpha = 1) {
  return {
    red: Math.round(clamp(red, 0, 255)),
    green: Math.round(clamp(green, 0, 255)),
    blue: Math.round(clamp(blue, 0, 255)),
    alpha: clamp(alpha, 0, 1),
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
