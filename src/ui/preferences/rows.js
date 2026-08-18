import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export class PreferenceRows {
  constructor(settings) {
    this._settings = settings;
  }

  switch(key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    this._settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
  }

  entry(key, title, subtitle = '', validate = null) {
    const row = new Adw.EntryRow({title, text: this._settings.get_string(key)});
    if (subtitle)
      row.set_tooltip_text(subtitle);
    row.connect('changed', () => {
      const value = row.get_text().trim();
      const valid = !validate || validate(value);
      row[valid ? 'remove_css_class' : 'add_css_class']('error');
      if (valid)
        this._settings.set_string(key, value);
    });
    return row;
  }

  spin(key, title, lower, upper, step, suffix = '') {
    const row = new Adw.SpinRow({
      title,
      subtitle: suffix,
      adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 10}),
    });
    this._settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
  }

  sizeSpin(key, title, lower, upper, step, factor, unit, digits = 0) {
    const row = new Adw.SpinRow({
      title,
      subtitle: unit,
      digits,
      adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 10}),
      value: this._settings.get_uint(key) / factor,
    });
    row.connect('notify::value', () =>
      this._settings.set_uint(key, Math.round(row.value * factor)));
    return row;
  }

  combo(key, title, choices) {
    const values = choices.map(([value]) => value);
    const row = new Adw.ComboRow({
      title,
      model: Gtk.StringList.new(choices.map(([, label]) => label)),
      selected: Math.max(0, values.indexOf(this._settings.get_string(key))),
    });
    row.connect('notify::selected', () => this._settings.set_string(key, values[row.selected]));
    return row;
  }

  iconCombo(key, title, choices) {
    const values = choices.map(([value]) => value);
    const createFactory = () => {
      const factory = new Gtk.SignalListItemFactory();
      factory.connect('setup', (_factory, listItem) => {
        const box = new Gtk.Box({spacing: 10, valign: Gtk.Align.CENTER});
        box._icon = new Gtk.Image({pixel_size: 20});
        box._label = new Gtk.Label({xalign: 0});
        box.append(box._icon);
        box.append(box._label);
        listItem.set_child(box);
      });
      factory.connect('bind', (_factory, listItem) => {
        const choice = choices[listItem.get_position()] ?? choices[0];
        const box = listItem.get_child();
        box._icon.icon_name = choice[2];
        box._label.label = choice[1];
      });
      return factory;
    };
    const row = new Adw.ComboRow({
      title,
      model: Gtk.StringList.new(choices.map(([, label]) => label)),
      selected: Math.max(0, values.indexOf(this._settings.get_string(key))),
      factory: createFactory(),
      list_factory: createFactory(),
    });
    row.connect('notify::selected', () => this._settings.set_string(key, values[row.selected]));
    return row;
  }

  shortcut(key, title, contextual = false) {
    const row = new Adw.ActionRow({title});
    const shortcut = new Adw.ShortcutLabel({disabled_text: _('Disabled')});
    const button = new Gtk.Button({
      child: shortcut,
      has_frame: false,
      valign: Gtk.Align.CENTER,
      tooltip_text: _('Click to set a shortcut'),
    });
    let controller = null;
    const update = () => {
      shortcut.accelerator = this._settings.get_strv(key)[0] ?? '';
      shortcut.disabled_text = _('Disabled');
      button.remove_css_class('error');
    };
    const stop = () => {
      if (controller) {
        button.remove_controller(controller);
        controller = null;
      }
      update();
    };
    button.connect('clicked', () => {
      if (controller) {
        stop();
        return;
      }
      shortcut.accelerator = '';
      shortcut.disabled_text = _('Press shortcut…');
      controller = new Gtk.EventControllerKey();
      controller.connect('key-pressed', (_controller, keyval, keycode, state) => {
        const modifiers = state & Gtk.accelerator_get_default_mod_mask()
          & ~Gdk.ModifierType.LOCK_MASK;
        if (modifiers === 0 && keyval === Gdk.KEY_Escape) {
          stop();
          return Gdk.EVENT_STOP;
        }
        if (modifiers === 0 && keyval === Gdk.KEY_BackSpace) {
          this._settings.set_strv(key, []);
          stop();
          return Gdk.EVENT_STOP;
        }
        const valid = Gtk.accelerator_valid(keyval, modifiers)
          || (contextual && modifiers === 0 && keyval !== 0)
          || (keyval === Gdk.KEY_Tab && modifiers !== 0);
        if (!valid) {
          button.add_css_class('error');
          return Gdk.EVENT_STOP;
        }
        const accelerator = contextual
          ? Gtk.accelerator_name(keyval, modifiers)
          : Gtk.accelerator_name_with_keycode(null, keyval, keycode, modifiers);
        this._settings.set_strv(key, [accelerator]);
        stop();
        return Gdk.EVENT_STOP;
      });
      button.add_controller(controller);
      button.grab_focus();
    });
    update();
    row.add_suffix(button);
    row.activatable_widget = button;
    return row;
  }

  stringList(key, title, subtitle = '') {
    const row = new Adw.EntryRow({title, text: this._settings.get_strv(key).join(', ')});
    if (subtitle)
      row.set_tooltip_text(subtitle);
    row.connect('changed', () => {
      const values = row.get_text().split(',').map(value => value.trim()).filter(Boolean);
      this._settings.set_strv(key, [...new Set(values)]);
    });
    return row;
  }

  editorApp() {
    const applications = new Map();
    for (const mimeType of ['image/png', 'image/jpeg', 'image/webp']) {
      for (const app of Gio.AppInfo.get_all_for_type(mimeType)) {
        if (app.get_id())
          applications.set(app.get_id(), app);
      }
    }
    const choices = [['', _('Custom command')], ...[...applications]
      .sort((left, right) => left[1].get_display_name().localeCompare(right[1].get_display_name()))
      .map(([id, app]) => [id, app.get_display_name()])];
    return this.combo('editor-app-id', _('Application'), choices);
  }
}
