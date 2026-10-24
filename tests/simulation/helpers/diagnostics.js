import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

// The runner supplies a fresh report directory. This never captures a host desktop.
export async function screenshot(id) {
  const directory = GLib.getenv('CBX_SIMULATION_ARTIFACTS');
  if (!directory) return;
  const [content, scale] = await new Shell.Screenshot().screenshot_stage_to_content();
  const texture = content.get_texture();
  if (texture.get_width() <= 0 || texture.get_height() <= 0) return;
  const stream = Gio.MemoryOutputStream.new_resizable();
  try {
    const image = await Shell.Screenshot.composite_to_stream(texture, 0, 0,
      texture.get_width(), texture.get_height(), scale, null, 0, 0, 1, stream);
    const path = `${directory}/${id}.png`;
    image.savev(path, 'png', [], []);
    print(`[simulation] Failure screenshot: ${path}`);
  } finally { stream.close(null); }
}
