const DEFAULT_LENS_RADIUS = 5;

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

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
