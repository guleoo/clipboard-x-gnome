import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';

export function createThumbnail(bytes, maximumDimension = 320, maximumBytes = 262144) {
  const loader = new GdkPixbuf.PixbufLoader();
  loader.write(bytes.get_data());
  loader.close();

  const source = loader.get_pixbuf();
  if (!source)
    throw new Error('Unable to decode clipboard image');

  const width = source.get_width();
  const height = source.get_height();
  const scale = Math.min(1, maximumDimension / Math.max(width, height));
  const output = scale < 1
    ? source.scale_simple(
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
      GdkPixbuf.InterpType.BILINEAR,
    )
    : source;

  const [ok, data] = output.save_to_bufferv('png', [], []);
  if (!ok)
    throw new Error('Unable to encode image thumbnail');
  if (data.length > maximumBytes)
    throw new Error(`Generated thumbnail exceeds ${maximumBytes} bytes`);

  return {
    bytes: new GLib.Bytes(data),
    mimeType: 'image/png',
    width: output.get_width(),
    height: output.get_height(),
    originalWidth: width,
    originalHeight: height,
  };
}
