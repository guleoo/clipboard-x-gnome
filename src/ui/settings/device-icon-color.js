import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {gettext} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {deriveDarkColor, readIconColor, setIconColorLinked} from '../../sync/icon-color.js';
import {disconnectWhenUnrooted} from './lifecycle.js';

function swatch(label) {
  const area = new Gtk.DrawingArea({content_width: 22, content_height: 22});
  const button = new Gtk.Button({
    child: area,
    css_classes: ['flat'],
    tooltip_text: label,
    valign: Gtk.Align.CENTER,
  });
  let color = '#ffffff';
  area.set_draw_func((_area, context, width, height) => {
    const rgba = new Gdk.RGBA();
    rgba.parse(color);
    context.setSourceRGBA(rgba.red, rgba.green, rgba.blue, 1);
    context.arc(width / 2, height / 2, Math.min(width, height) / 2 - 1, 0, Math.PI * 2);
    context.fill();
    context.setSourceRGBA(0, 0, 0, 0.3);
    context.setLineWidth(1);
    context.arc(width / 2, height / 2, Math.min(width, height) / 2 - 1, 0, Math.PI * 2);
    context.stroke();
  });
  return {button, setColor: value => { color = value; area.queue_draw(); }};
}

function chooseColor(button, initial, title, onPicked) {
  const dialog = new Gtk.ColorDialog({title, modal: true, with_alpha: false});
  const rgba = new Gdk.RGBA();
  rgba.parse(initial);
  dialog.choose_rgba(button.get_root(), rgba, null, (_source, result) => {
    try {
      const chosen = dialog.choose_rgba_finish(result);
      const channel = value => Math.round(Math.max(0, Math.min(1, value)) * 255)
        .toString(16).padStart(2, '0');
      onPicked(`#${channel(chosen.red)}${channel(chosen.green)}${channel(chosen.blue)}`);
    } catch (_error) {
      // Dismissing the chooser keeps the current color.
    }
  });
}

export function create(settings, _ = gettext) {
  const row = new Adw.ActionRow({
    title: _('Icon color'),
    subtitle: _('Light on dark themes, dark on light themes. Linked by default.'),
  });
  const controls = new Gtk.Box({spacing: 6, valign: Gtk.Align.CENTER});
  const light = swatch(_('Light color'));
  const dark = swatch(_('Dark color'));
  const link = new Gtk.ToggleButton({
    icon_name: 'insert-link-symbolic',
    css_classes: ['flat'],
    valign: Gtk.Align.CENTER,
  });
  controls.append(light.button);
  controls.append(link);
  controls.append(dark.button);
  row.add_suffix(controls);

  let updating = false;
  const update = () => {
    const colors = readIconColor(settings);
    const linked = !colors.dark;
    updating = true;
    link.active = linked;
    updating = false;
    link.tooltip_text = linked ? _('Unlink colors') : _('Link colors');
    light.setColor(colors.light);
    dark.setColor(colors.dark ?? deriveDarkColor(colors.light));
    dark.button.sensitive = !linked;
  };
  link.connect('toggled', () => {
    if (updating)
      return;
    setIconColorLinked(settings, link.active);
  });
  light.button.connect('clicked', () => chooseColor(light.button, readIconColor(settings).light,
    _('Light color'), color => settings.set_string('device-icon-color-light', color)));
  dark.button.connect('clicked', () => chooseColor(dark.button,
    readIconColor(settings).dark ?? deriveDarkColor(readIconColor(settings).light),
    _('Dark color'), color => settings.set_string('device-icon-color-dark', color)));
  const signals = [
    settings.connect('changed::device-icon-color-light', update),
    settings.connect('changed::device-icon-color-dark', update),
  ];
  disconnectWhenUnrooted(row, () => signals.forEach(signal => settings.disconnect(signal)));
  update();
  return row;
}
