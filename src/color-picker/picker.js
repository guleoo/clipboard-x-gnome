import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {formatColor, moveSample, sampleRegion} from './color.js';
import {diagnosticCode} from '../common/errors.js';

const LENS_RADIUS = 5;
const LENS_CELL_SIZE = 10;

const ColorLens = GObject.registerClass(
class ColorLens extends St.DrawingArea {
  _init() {
    const cells = LENS_RADIUS * 2 + 1;
    super._init({
      width: cells * LENS_CELL_SIZE + 2,
      height: cells * LENS_CELL_SIZE + 2,
      style_class: 'cbx-color-lens',
    });
    this._sample = null;
  }

  update(sample) {
    this._sample = sample;
    this.queue_repaint();
  }

  vfunc_repaint() {
    const context = this.get_context();
    const [surfaceWidth, surfaceHeight] = this.get_surface_size();
    context.setSourceRGBA(0.05, 0.05, 0.05, 0.96);
    context.rectangle(0, 0, surfaceWidth, surfaceHeight);
    context.fill();

    if (!this._sample) {
      context.$dispose();
      return;
    }

    const {pixels, width, height, rowstride, channels, centerX, centerY} = this._sample;
    const offsetX = (surfaceWidth - width * LENS_CELL_SIZE) / 2;
    const offsetY = (surfaceHeight - height * LENS_CELL_SIZE) / 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * rowstride + x * channels;
        context.setSourceRGB(pixels[offset] / 255, pixels[offset + 1] / 255, pixels[offset + 2] / 255);
        context.rectangle(
          offsetX + x * LENS_CELL_SIZE,
          offsetY + y * LENS_CELL_SIZE,
          LENS_CELL_SIZE,
          LENS_CELL_SIZE,
        );
        context.fill();
      }
    }

    context.setLineWidth(1);
    context.setSourceRGBA(0, 0, 0, 0.38);
    for (let x = 0; x <= width; x++) {
      context.moveTo(offsetX + x * LENS_CELL_SIZE, offsetY);
      context.lineTo(offsetX + x * LENS_CELL_SIZE, offsetY + height * LENS_CELL_SIZE);
    }
    for (let y = 0; y <= height; y++) {
      context.moveTo(offsetX, offsetY + y * LENS_CELL_SIZE);
      context.lineTo(offsetX + width * LENS_CELL_SIZE, offsetY + y * LENS_CELL_SIZE);
    }
    context.stroke();

    const selectedX = offsetX + centerX * LENS_CELL_SIZE;
    const selectedY = offsetY + centerY * LENS_CELL_SIZE;
    context.setLineWidth(3);
    context.setSourceRGB(1, 1, 1);
    context.rectangle(selectedX + 1.5, selectedY + 1.5, LENS_CELL_SIZE - 3, LENS_CELL_SIZE - 3);
    context.strokePreserve();
    context.setLineWidth(1);
    context.setSourceRGB(0, 0, 0);
    context.stroke();
    context.$dispose();
  }
});

export const ColorPicker = GObject.registerClass(
class ColorPicker extends St.Widget {
  _init(onPicked, previewFormat = 'hex') {
    super._init({
      reactive: true,
      can_focus: true,
      style_class: 'cbx-color-overlay',
    });
    this._onPicked = onPicked;
    this._previewFormat = previewFormat;
    this._closed = false;
    this._sampling = false;
    this._pendingCoords = null;
    this._coords = [0, 0];
    this._texture = null;
    this._scale = 1;

    this.add_constraint(new Clutter.BindConstraint({
      source: global.stage,
      coordinate: Clutter.BindCoordinate.ALL,
    }));

    this._preview = new St.BoxLayout({
      vertical: true,
      style_class: 'cbx-color-preview',
    });
    this._lens = new ColorLens();
    this._label = new St.Label({text: '…', x_align: Clutter.ActorAlign.CENTER});
    this._preview.add_child(this._lens);
    this._preview.add_child(this._label);
    this.add_child(this._preview);

    Main.layoutManager.addTopChrome(this);
    this._grab = Main.pushModal(this, {actionMode: Shell.ActionMode.POPUP});
    if (!this._grab) {
      Main.layoutManager.removeChrome(this);
      this.destroy();
      throw new Error('Unable to acquire the color picker modal grab');
    }
    this.grab_key_focus();
    this._initialize().catch(error => {
      console.error(`Clipboard X color picker failed (${diagnosticCode(error)})`);
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
    if (!this._texture || this._closed)
      return;
    this._pendingCoords = moveSample(
      x, y, 0, 0, this._scale,
      this._texture.get_width(), this._texture.get_height(),
    );
    if (this._sampling)
      return;

    this._sampling = true;
    try {
      while (this._pendingCoords && !this._closed) {
        const coords = this._pendingCoords;
        this._pendingCoords = null;
        await this._captureSample(...coords);
      }
    } finally {
      this._sampling = false;
    }
  }

  async _captureSample(x, y) {
    this._coords = [x, y];
    const region = sampleRegion(
      x,
      y,
      this._scale,
      this._texture.get_width(),
      this._texture.get_height(),
      LENS_RADIUS,
    );
    const stream = Gio.MemoryOutputStream.new_resizable();
    try {
      const pixbuf = await Shell.Screenshot.composite_to_stream(
        this._texture,
        region.x,
        region.y,
        region.width,
        region.height,
        this._scale,
        null,
        0,
        0,
        1,
        stream,
      );
      if (this._closed)
        return;
      const pixels = pixbuf.get_pixels();
      const rowstride = pixbuf.get_rowstride();
      const channels = pixbuf.get_n_channels();
      const centerOffset = region.centerY * rowstride + region.centerX * channels;
      this._rgb = [pixels[centerOffset], pixels[centerOffset + 1], pixels[centerOffset + 2]];
      this._lens.update({
        pixels,
        width: pixbuf.get_width(),
        height: pixbuf.get_height(),
        rowstride,
        channels,
        centerX: region.centerX,
        centerY: region.centerY,
      });
      this._label.set_text(formatColor(this._rgb, this._previewFormat));
      this._positionPreview(x, y);
    } finally {
      stream.close(null);
    }
  }

  _positionPreview(x, y) {
    const previewWidth = Math.max(this._preview.width, 132);
    const previewHeight = Math.max(this._preview.height, 150);
    const preferredX = x + 20;
    const preferredY = y + 20;
    this._preview.set_position(
      preferredX + previewWidth <= global.stage.width ? preferredX : Math.max(0, x - previewWidth - 20),
      preferredY + previewHeight <= global.stage.height ? preferredY : Math.max(0, y - previewHeight - 20),
    );
  }

  vfunc_motion_event(event) {
    const [x, y] = event.get_coords();
    this._sample(x, y).catch(error => console.error(`Clipboard X color sample failed (${diagnosticCode(error)})`));
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
      [Clutter.KEY_a, [-1, 0]],
      [Clutter.KEY_h, [-1, 0]],
      [Clutter.KEY_Right, [1, 0]],
      [Clutter.KEY_d, [1, 0]],
      [Clutter.KEY_l, [1, 0]],
      [Clutter.KEY_Up, [0, -1]],
      [Clutter.KEY_w, [0, -1]],
      [Clutter.KEY_k, [0, -1]],
      [Clutter.KEY_Down, [0, 1]],
      [Clutter.KEY_s, [0, 1]],
      [Clutter.KEY_j, [0, 1]],
    ]);
    if (directions.has(key)) {
      if (!this._texture)
        return Clutter.EVENT_STOP;
      const [dx, dy] = directions.get(key);
      const multiplier = event.get_state() & Clutter.ModifierType.CONTROL_MASK ? 8 : 1;
      const [x, y] = this._pendingCoords ?? this._coords;
      const coords = moveSample(
        x, y, dx * multiplier, dy * multiplier, this._scale,
        this._texture.get_width(), this._texture.get_height(),
      );
      this._sample(...coords)
        .catch(error => console.error(`Clipboard X color sample failed (${diagnosticCode(error)})`));
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
    this._pendingCoords = null;
    if (this._grab)
      Main.popModal(this._grab);
    this._grab = null;
    Main.layoutManager.removeChrome(this);
    this.destroy();
  }
});
