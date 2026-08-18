// Theme color settings control.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {disconnectWhenUnrooted} from './lifecycle.js';

const COLORS = Object.freeze([
  ['blue', '#3584e4'],
  ['teal', '#2190a4'],
  ['green', '#3a944a'],
  ['orange', '#ed5b00'],
  ['pink', '#d56199'],
  ['slate', '#6f8396'],
]);
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function create(settings) {
  const row = new Adw.PreferencesRow({activatable: false});
  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 8,
    margin_top: 12,
    margin_bottom: 12,
    margin_start: 12,
    margin_end: 12,
  });
  content.append(new Gtk.Label({
    label: _('Theme color'),
    xalign: 0,
    css_classes: ['heading'],
  }));
  const palette = new Gtk.FlowBox({
    css_classes: ['clipboard-x-theme-color-palette'],
    selection_mode: Gtk.SelectionMode.NONE,
    homogeneous: false,
    min_children_per_line: 1,
    max_children_per_line: 32,
    column_spacing: 0,
    row_spacing: 0,
    hexpand: true,
  });
  content.append(palette);
  row.set_child(content);

  const styleManager = Adw.StyleManager.get_default();
  const display = row.get_display();
  const styleProvider = new Gtk.CssProvider();
  styleProvider.load_from_string(`
    .clipboard-x-theme-color-button,
    .clipboard-x-theme-color-button:hover,
    .clipboard-x-theme-color-button:active,
    .clipboard-x-theme-color-button:checked {
      background-color: transparent;
      background-image: none;
      box-shadow: none;
      border-radius: 999px;
      padding: 0;
    }
    .clipboard-x-theme-color-palette > flowboxchild,
    .clipboard-x-theme-color-palette > flowboxchild:hover,
    .clipboard-x-theme-color-palette > flowboxchild:active,
    .clipboard-x-theme-color-palette > flowboxchild:selected {
      background-color: transparent;
      background-image: none;
      box-shadow: none;
      padding: 0;
    }
  `);
  Gtk.StyleContext.add_provider_for_display(
    display,
    styleProvider,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
  );
  let buttons = [];
  const updateSelection = () => {
    const selected = settings.get_string('theme-color');
    for (const [value, button] of buttons) {
      button.active = value === selected;
      button.get_child().queue_draw();
    }
  };
  const addSwatch = (value, color, label) => {
    const swatch = new Gtk.DrawingArea({content_width: 28, content_height: 28});
    const button = new Gtk.ToggleButton({
      child: swatch,
      has_frame: false,
      css_classes: ['flat', 'clipboard-x-theme-color-button'],
      tooltip_text: label,
      width_request: 26,
      height_request: 26,
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
      hexpand: false,
      vexpand: false,
    });
    button.connect('toggled', () => {
      if (button.active && settings.get_string('theme-color') !== value)
        settings.set_string('theme-color', value);
      else if (!button.active && settings.get_string('theme-color') === value)
        button.active = true;
    });
    swatch.set_draw_func((_area, context, width, height) => {
      const rgba = value === 'system' ? styleManager.get_accent_color_rgba() : parse(color);
      const centerX = width / 2;
      const centerY = height / 2;
      if (button.active) {
        setCairoColor(context, rgba);
        context.setLineWidth(2.5);
        context.arc(centerX, centerY, 12, 0, Math.PI * 2);
        context.stroke();
      }
      setCairoColor(context, rgba);
      context.arc(centerX, centerY, button.active ? 8.5 : 10, 0, Math.PI * 2);
      context.fill();
    });
    palette.append(button);
    buttons.push([value, button]);
  };
  const render = () => {
    while (palette.get_first_child())
      palette.remove(palette.get_first_child());
    buttons = [];
    addSwatch('system', null, _('Follow system'));
    const labels = [_('Blue'), _('Teal'), _('Green'), _('Orange'), _('Pink'), _('Slate')];
    COLORS.forEach(([value, color], index) => addSwatch(value, color, labels[index]));
    const selected = settings.get_string('theme-color');
    const customColors = unique([
      ...settings.get_strv('custom-theme-colors'),
      ...(HEX_COLOR_PATTERN.test(selected) ? [selected] : []),
    ]);
    for (const color of customColors)
      addSwatch(color, color, color.toUpperCase());

    const addButton = new Gtk.Button({
      icon_name: 'list-add-symbolic',
      has_frame: false,
      css_classes: ['flat', 'clipboard-x-theme-color-button'],
      tooltip_text: _('Add custom color'),
      width_request: 26,
      height_request: 26,
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
      hexpand: false,
      vexpand: false,
    });
    addButton.connect('clicked', () => {
      const dialog = new Gtk.ColorDialog({
        title: _('Choose custom theme color'),
        modal: true,
        with_alpha: false,
      });
      const initial = HEX_COLOR_PATTERN.test(settings.get_string('theme-color'))
        ? parse(settings.get_string('theme-color'))
        : styleManager.get_accent_color_rgba();
      dialog.choose_rgba(addButton.get_root(), initial, null, (_source, result) => {
        try {
          const color = toHex(dialog.choose_rgba_finish(result));
          settings.set_strv('custom-theme-colors', unique([
            ...settings.get_strv('custom-theme-colors'),
            color,
          ]));
          settings.set_string('theme-color', color);
        } catch (_error) {
          // Closing the color chooser is not an error for the preferences UI.
        }
      });
    });
    palette.append(addButton);
    updateSelection();
  };

  const themeColorSignal = settings.connect('changed::theme-color', updateSelection);
  const customColorsSignal = settings.connect('changed::custom-theme-colors', render);
  const systemAccentSignal = styleManager.connect('notify::accent-color-rgba', () => {
    buttons[0]?.[1].get_child().queue_draw();
  });
  disconnectWhenUnrooted(row, () => {
    settings.disconnect(themeColorSignal);
    settings.disconnect(customColorsSignal);
    styleManager.disconnect(systemAccentSignal);
    Gtk.StyleContext.remove_provider_for_display(display, styleProvider);
  });
  render();
  return row;
}

function parse(value) {
  const color = new Gdk.RGBA();
  if (!color.parse(value))
    color.parse('#3584e4');
  return color;
}

function setCairoColor(context, color) {
  context.setSourceRGBA(color.red, color.green, color.blue, color.alpha);
}

function toHex(color) {
  const channel = value => Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16).padStart(2, '0');
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
}

function unique(colors) {
  return [...new Set(colors
    .map(color => color.toLowerCase())
    .filter(color => HEX_COLOR_PATTERN.test(color)))];
}
