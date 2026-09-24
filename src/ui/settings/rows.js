// Reusable GTK settings rows.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {disconnectWhenUnrooted} from './lifecycle.js';
import {capture} from './shortcut-capture.js';
import {bindStringChoice} from './string-choice.js';

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
    let editing = false;
    row.connect('changed', () => {
      const value = row.get_text().trim();
      const valid = !validate || validate(value);
      row[valid ? 'remove_css_class' : 'add_css_class']('error');
      if (valid && value !== this._settings.get_string(key)) {
        editing = true;
        try {
          this._settings.set_string(key, value);
        } finally {
          editing = false;
        }
      }
    });
    const signal = this._settings.connect(`changed::${key}`, () => {
      if (!editing && row.get_text() !== this._settings.get_string(key))
        row.set_text(this._settings.get_string(key));
    });
    disconnectWhenUnrooted(row, () => this._settings.disconnect(signal));
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
    let updating = false;
    row.connect('notify::value', () => {
      if (!updating)
        this._settings.set_uint(key, Math.round(row.value * factor));
    });
    const signal = this._settings.connect(`changed::${key}`, () => {
      const value = this._settings.get_uint(key) / factor;
      if (row.value === value)
        return;
      updating = true;
      row.value = value;
      updating = false;
    });
    disconnectWhenUnrooted(row, () => this._settings.disconnect(signal));
    return row;
  }

  combo(key, title, choices) {
    const values = choices.map(([value]) => value);
    const row = new Adw.ComboRow({
      title,
      model: Gtk.StringList.new(choices.map(([, label]) => label)),
      selected: Math.max(0, values.indexOf(this._settings.get_string(key))),
    });
    const disconnect = bindStringChoice(this._settings, row, key, values);
    disconnectWhenUnrooted(row, disconnect);
    return row;
  }

  iconCombo(key, title, choices) {
    const values = choices.map(([value]) => value);
    const model = Gtk.StringList.new(choices.map(([, label]) => label));
    const choicesByItem = new Map(choices.map((choice, index) => [model.get_item(index), choice]));
    const createFactory = () => {
      const factory = new Gtk.SignalListItemFactory();
      factory.connect('setup', (_factory, listItem) => {
        const box = new Gtk.Box({spacing: 8, valign: Gtk.Align.CENTER});
        box._icon = new Gtk.Image({pixel_size: 16});
        box._label = new Gtk.Label({xalign: 0});
        box.append(box._icon);
        box.append(box._label);
        listItem.set_child(box);
      });
      factory.connect('bind', (_factory, listItem) => {
        // The selected-item preview has one row, regardless of its original position.
        const choice = choicesByItem.get(listItem.get_item());
        if (!choice)
          return;
        const box = listItem.get_child();
        if (typeof choice[2] === 'string')
          box._icon.icon_name = choice[2];
        else
          box._icon.gicon = choice[2];
        box._label.label = choice[1];
      });
      return factory;
    };
    const row = new Adw.ComboRow({
      title,
      model,
      selected: Math.max(0, values.indexOf(this._settings.get_string(key))),
      factory: createFactory(),
      list_factory: createFactory(),
    });
    const disconnect = bindStringChoice(this._settings, row, key, values);
    disconnectWhenUnrooted(row, disconnect);
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
    const update = () => {
      shortcut.accelerator = this._settings.get_strv(key)[0] ?? '';
      shortcut.disabled_text = _('Disabled');
      button.remove_css_class('error');
    };
    button.connect('clicked', () => {
      // A separate native window avoids the preferences window's shortcuts
      // consuming combinations before the recorder can see them.
      const dialog = new Adw.Window({
        title,
        transient_for: button.get_root(),
        modal: true,
        default_width: 380,
        default_height: 180,
        destroy_with_parent: true,
      });
      const prompt = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        hexpand: true,
        vexpand: true,
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
      });
      const promptIcon = new Gtk.Image({
        icon_name: 'input-keyboard-symbolic',
        pixel_size: 28,
      });
      const promptLabel = new Gtk.Label({
        label: _('Press shortcut…'),
        wrap: true,
        max_width_chars: 28,
        justify: Gtk.Justification.CENTER,
      });
      prompt.append(promptIcon);
      prompt.append(promptLabel);
      const view = new Adw.ToolbarView({
        content: prompt,
      });
      view.add_top_bar(new Adw.HeaderBar());
      dialog.set_content(view);
      const controller = new Gtk.EventControllerKey({
        propagation_phase: Gtk.PropagationPhase.CAPTURE,
      });
      controller.connect('key-pressed', (_controller, keyval, keycode, state) => {
        const result = capture(keyval, keycode, state, contextual);
        if (result.action === 'wait')
          return true;
        if (result.action === 'invalid') {
          promptIcon.icon_name = 'dialog-warning-symbolic';
          promptLabel.add_css_class('error');
          return true;
        }
        if (result.action === 'save')
          this._settings.set_strv(key, [result.accelerator]);
        else if (result.action === 'clear')
          this._settings.set_strv(key, []);
        dialog.close();
        return true;
      });
      dialog.add_controller(controller);
      dialog.connect('close-request', () => {
        update();
        return false;
      });
      dialog.present();
    });
    update();
    row.add_suffix(button);
    row.activatable_widget = button;
    const signal = this._settings.connect(`changed::${key}`, update);
    disconnectWhenUnrooted(row, () => this._settings.disconnect(signal));
    return row;
  }

  stringList(key, title, subtitle = '') {
    const row = new Adw.EntryRow({title, text: this._settings.get_strv(key).join(', ')});
    if (subtitle)
      row.set_tooltip_text(subtitle);
    const update = () => {
      const value = this._settings.get_strv(key).join(', ');
      if (row.get_text() !== value)
        row.set_text(value);
    };
    row.connect('changed', () => {
      const values = row.get_text().split(',').map(value => value.trim()).filter(Boolean);
      if (JSON.stringify(values) !== JSON.stringify(this._settings.get_strv(key)))
        this._settings.set_strv(key, [...new Set(values)]);
    });
    const signal = this._settings.connect(`changed::${key}`, update);
    disconnectWhenUnrooted(row, () => this._settings.disconnect(signal));
    return row;
  }

}
