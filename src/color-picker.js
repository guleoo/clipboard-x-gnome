import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const ColorPicker = GObject.registerClass(
class ColorPicker extends St.Widget {
  _init(onPicked) {
    super._init({
      reactive: true,
      can_focus: true,
      style_class: 'clipboard-x-color-overlay',
    });
    this._onPicked = onPicked;
    this._closed = false;
    this._sampling = false;
    this._coords = [0, 0];
    this._texture = null;
    this._scale = 1;

    this.add_constraint(new Clutter.BindConstraint({
      source: global.stage,
      coordinate: Clutter.BindCoordinate.ALL,
    }));

    this._label = new St.Label({
      text: '…',
      style_class: 'clipboard-x-color-preview',
    });
    this.add_child(this._label);

    Main.layoutManager.addTopChrome(this);
    this._grab = Main.pushModal(this, {actionMode: Shell.ActionMode.POPUP});
    this.grab_key_focus();
    this._initialize().catch(error => {
      console.error(`Clipboard X color picker: ${error.message}`);
      this.close();
    });
  }

  async _initialize() {
    const [content, scale] = await new Shell.Screenshot().screenshot_stage_to_content();
    if (this._closed)
      return;
    this.set_content(content);
    this._texture = content.get_texture();
    this._scale = scale;
    const [x, y] = global.get_pointer();
    await this._sample(x, y);
  }

  async _sample(x, y) {
    if (!this._texture || this._sampling || this._closed)
      return;
    this._sampling = true;
    this._coords = [x, y];
    const stream = Gio.MemoryOutputStream.new_resizable();
    try {
      const pixelX = Math.clamp(Math.round(x * this._scale), 0, this._texture.get_width() - 1);
      const pixelY = Math.clamp(Math.round(y * this._scale), 0, this._texture.get_height() - 1);
      const pixbuf = await Shell.Screenshot.composite_to_stream(
        this._texture,
        pixelX,
        pixelY,
        1,
        1,
        this._scale,
        null,
        0,
        0,
        1,
        stream,
      );
      const pixels = pixbuf.get_pixels();
      this._rgb = [pixels[0], pixels[1], pixels[2]];
      const hex = rgbToHex(this._rgb);
      this._label.set_text(hex);
      this._label.set_position(
        Math.min(x + 18, global.stage.width - 110),
        Math.min(y + 18, global.stage.height - 48),
      );
    } finally {
      stream.close(null);
      this._sampling = false;
    }
  }

  vfunc_motion_event(event) {
    const [x, y] = event.get_coords();
    this._sample(x, y).catch(error => console.error(`Clipboard X color sample: ${error.message}`));
    return Clutter.EVENT_STOP;
  }

  vfunc_button_press_event(event) {
    if (event.get_button() === Clutter.BUTTON_PRIMARY && this._rgb) {
      this._onPicked?.(this._rgb);
      this.close();
    } else if (event.get_button() !== Clutter.BUTTON_PRIMARY) {
      this.close();
    }
    return Clutter.EVENT_STOP;
  }

  vfunc_key_press_event(event) {
    const key = event.get_key_symbol();
    if (key === Clutter.KEY_Escape) {
      this.close();
      return Clutter.EVENT_STOP;
    }

    const directions = new Map([
      [Clutter.KEY_Left, [-1, 0]],
      [Clutter.KEY_h, [-1, 0]],
      [Clutter.KEY_Right, [1, 0]],
      [Clutter.KEY_l, [1, 0]],
      [Clutter.KEY_Up, [0, -1]],
      [Clutter.KEY_k, [0, -1]],
      [Clutter.KEY_Down, [0, 1]],
      [Clutter.KEY_j, [0, 1]],
    ]);
    if (directions.has(key)) {
      const [dx, dy] = directions.get(key);
      const [x, y] = this._coords;
      this._sample(x + dx, y + dy)
        .catch(error => console.error(`Clipboard X color sample: ${error.message}`));
      return Clutter.EVENT_STOP;
    }

    if ((key === Clutter.KEY_Return || key === Clutter.KEY_space) && this._rgb) {
      this._onPicked?.(this._rgb);
      this.close();
      return Clutter.EVENT_STOP;
    }
    return Clutter.EVENT_PROPAGATE;
  }

  close() {
    if (this._closed)
      return;
    this._closed = true;
    if (this._grab)
      Main.popModal(this._grab);
    this._grab = null;
    Main.layoutManager.removeChrome(this);
    this.destroy();
  }
});

export function formatColor(rgb, format = 'hex') {
  if (format === 'rgb')
    return `rgb(${rgb.join(', ')})`;
  if (format === 'hsl') {
    const [h, s, l] = rgbToHsl(rgb);
    return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
  }
  return rgbToHex(rgb);
}
function rgbToHex(rgb) {
  return `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function rgbToHsl([red, green, blue]) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
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
