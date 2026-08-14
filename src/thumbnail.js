import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export async function createThumbnail(bytes, maximumDimension = 320, maximumBytes = 262144, cancellable = null) {
  if (maximumDimension < 1 || maximumBytes < 1)
    throw new Error('Thumbnail limits must be positive');

  const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
  let output;
  try {
    output = await new Promise((resolve, reject) => {
      GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
        stream,
        maximumDimension,
        maximumDimension,
        true,
        cancellable,
        (_source, result) => {
          try {
            resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result));
          } catch (error) {
            reject(error);
          }
        },
      );
    });
  } finally {
    stream.close(null);
  }
  if (!output)
    throw new Error('Unable to decode clipboard image');

  let data;
  while (true) {
    const [ok, encoded] = output.save_to_bufferv('png', [], []);
    if (!ok)
      throw new Error('Unable to encode image thumbnail');
    data = encoded;
    if (data.length <= maximumBytes)
      break;
    if (output.get_width() <= 32 && output.get_height() <= 32)
      throw new Error(`Generated thumbnail exceeds ${maximumBytes} bytes`);
    output = output.scale_simple(
      Math.max(1, Math.floor(output.get_width() * 0.8)),
      Math.max(1, Math.floor(output.get_height() * 0.8)),
      GdkPixbuf.InterpType.BILINEAR,
    );
  }

  return {
    bytes: new GLib.Bytes(data),
    mimeType: 'image/png',
    width: output.get_width(),
    height: output.get_height(),
  };
}
