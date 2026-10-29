import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {onClosed} from './lifecycle.js';

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function create(settings) {
  const row = new Adw.ActionRow({title: _('Text and icon color')});
  const swatch = new Gtk.DrawingArea({content_width: 22, content_height: 22});
  const chooser = new Gtk.Button({
    child: swatch,
    tooltip_text: _('Text and icon color'),
    valign: Gtk.Align.CENTER,
  });
  const dialog = new Gtk.ColorDialog({title: _('Text and icon color'), with_alpha: false, modal: true});
  const reset = new Gtk.Button({
    icon_name: 'edit-undo-symbolic',
    tooltip_text: _('Follow system'),
    valign: Gtk.Align.CENTER,
    css_classes: ['flat'],
  });
  row.add_suffix(chooser);
  row.add_suffix(reset);
  const styleManager = Adw.StyleManager.get_default();
  let color = new Gdk.RGBA();
  let pending = null;
  swatch.set_draw_func((_area, context, width, height) => {
    context.setSourceRGBA(color.red, color.green, color.blue, 1);
    context.arc(width / 2, height / 2, Math.min(width, height) / 2 - 1, 0, Math.PI * 2);
    context.fillPreserve();
    context.setSourceRGBA(0, 0, 0, 0.3);
    context.setLineWidth(1);
    context.stroke();
  });
  const update = () => {
    const value = settings.get_string('foreground-color');
    const custom = HEX_COLOR_PATTERN.test(value);
    color = new Gdk.RGBA();
    color.parse(custom ? value : styleManager.dark ? '#ffffff' : '#2e3436');
    swatch.queue_draw();
    row.subtitle = custom ? value.toUpperCase() : _('Follow system');
    reset.sensitive = custom;
  };
  chooser.connect('clicked', () => {
    if (pending)
      return;
    const cancellable = new Gio.Cancellable();
    pending = cancellable;
    dialog.choose_rgba(chooser.get_root(), color, cancellable, (_source, result) => {
      try {
        const chosen = dialog.choose_rgba_finish(result);
        if (cancellable.is_cancelled())
          return;
        const channel = value => Math.round(Math.max(0, Math.min(1, value)) * 255)
          .toString(16).padStart(2, '0');
        // Explicitly accepting the same system color still enables a custom color.
        settings.set_string('foreground-color', `#${channel(chosen.red)}${channel(chosen.green)}${channel(chosen.blue)}`);
      } catch (_error) {
        // Dismissing the chooser keeps the current setting.
      } finally {
        pending = null;
      }
    });
  });
  reset.connect('clicked', () => settings.reset('foreground-color'));
  const colorSignal = settings.connect('changed::foreground-color', update);
  const themeSignal = styleManager.connect('notify::dark', update);
  onClosed(row, () => {
    pending?.cancel();
    settings.disconnect(colorSignal);
    styleManager.disconnect(themeSignal);
  });
  update();
  return row;
}
