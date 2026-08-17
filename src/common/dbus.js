import GLib from 'gi://GLib';

export function variantDictionary(values) {
  const result = {};
  for (const [key, value] of Object.entries(values)) {
    if (value instanceof GLib.Variant) {
      result[key] = value;
    } else if (typeof value === 'string') {
      result[key] = new GLib.Variant('s', value);
    } else if (typeof value === 'boolean') {
      result[key] = new GLib.Variant('b', value);
    } else if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      result[key] = new GLib.Variant('t', value);
    } else {
      throw new TypeError(`Unsupported D-Bus metadata value for ${key}`);
    }
  }
  return result;
}
