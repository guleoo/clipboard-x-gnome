import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {ensureDeviceIdentity} from './core.js';
import {buildEditorArgv} from './editor-launcher.js';
import {SYNC_API_VERSION, SYNC_INTERFACE} from './constants.js';
import {effectiveCapabilities} from './sync-policy.js';

export default class ClipboardXPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    const {deviceId} = ensureDeviceIdentity(settings);
    window.set_default_size(720, 700);

    window.add(this._clipboardPage(settings));
    window.add(this._syncPage(settings, deviceId));
    window.add(this._colorPage(settings));
    window.add(this._screenshotPage(settings));
    window.add(this._shortcutsPage(settings));
  }

  _clipboardPage(settings) {
    const page = new Adw.PreferencesPage({title: _('Clipboard'), icon_name: 'edit-paste-symbolic'});
    const appearance = new Adw.PreferencesGroup({title: _('Panel and history')});
    page.add(appearance);
    appearance.add(this._switch(settings, 'show-indicator', _('Show panel indicator')));
    appearance.add(this._spin(settings, 'panel-visible-item-limit', _('Maximum entries shown in panel'), 1, 200, 1));
    appearance.add(this._spin(settings, 'history-size', _('History entries'), 1, 10000, 1));
    appearance.add(this._spin(settings, 'cache-size-mib', _('Cache size'), 16, 16384, 16, _('MiB')));
    appearance.add(this._spin(settings, 'history-retention-days', _('Automatic cleanup'), 0, 3650, 1, _('days; 0 disables')));
    appearance.add(this._spin(settings, 'capture-size-limit-mib', _('Maximum item size'), 1, 256, 1, _('MiB')));

    const privacy = new Adw.PreferencesGroup({title: _('Privacy')});
    page.add(privacy);
    privacy.add(this._switch(settings, 'private-mode', _('Pause clipboard recording')));
    privacy.add(this._combo(settings, 'sensitive-content-mode', _('Sensitive content'), [
      ['discard', _('Do not record')],
      ['memory', _('Keep until extension stops')],
      ['store', _('Store like other history')],
    ]));
    privacy.add(this._stringListEntry(
      settings,
      'excluded-apps',
      _('Excluded applications'),
      _('Comma-separated window classes'),
    ));
    return page;
  }

  _syncPage(settings, deviceId) {
    const page = new Adw.PreferencesPage({title: _('Synchronization'), icon_name: 'folder-remote-symbolic'});
    const identity = new Adw.PreferencesGroup({title: _('Device')});
    page.add(identity);
    const idRow = new Adw.ActionRow({title: _('Device ID'), subtitle: deviceId});
    const copy = new Gtk.Button({icon_name: 'edit-copy-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat']});
    copy.connect('clicked', () => GdkClipboard(windowFor(copy)).set(deviceId));
    idRow.add_suffix(copy);
    identity.add(idRow);
    identity.add(this._entry(settings, 'device-tag', _('Device tag'), _('Friendly name shown during device discovery')));
    identity.add(this._iconCombo(settings, 'device-icon-kind', _('Device icon'), [
      ['desktop', _('Desktop'), 'video-display-symbolic'],
      ['laptop', _('Laptop'), 'computer-symbolic'],
      ['phone', _('Phone'), 'phone-symbolic'],
      ['tablet', _('Tablet'), 'input-tablet-symbolic'],
      ['server', _('Server'), 'network-server-symbolic'],
      ['other', _('Other'), 'avatar-default-symbolic'],
    ]));

    const service = new Adw.PreferencesGroup({title: _('Service connection')});
    page.add(service);
    service.add(this._switch(settings, 'sync-enabled', _('Enable synchronization integration')));
    service.add(this._entry(
      settings,
      'service-bus-name',
      _('D-Bus name'),
      '',
      value => Gio.dbus_is_name(value),
    ));
    service.add(this._entry(
      settings,
      'service-object-path',
      _('Object path'),
      '',
      value => GLib.Variant.is_object_path(value),
    ));
    const statusRow = new Adw.ActionRow({title: _('Service status'), subtitle: _('Not tested')});
    const testButton = new Gtk.Button({label: _('Test connection'), valign: Gtk.Align.CENTER});
    testButton.connect('clicked', async () => {
      testButton.sensitive = false;
      statusRow.subtitle = _('Connecting…');
      try {
        const capabilities = await inspectSyncService(settings);
        if (Number(capabilities.ApiVersion) !== SYNC_API_VERSION)
          throw new Error(`Sync${capabilities.ApiVersion} is not compatible with Sync${SYNC_API_VERSION}`);
        const effective = effectiveCapabilities(settings, capabilities);
        statusRow.subtitle = [
          capabilities.ImplementationName,
          capabilities.ImplementationVersion,
          capabilities.Status,
          `${effective.mimeTypes.length} MIME`,
          `${formatBytes(effective.itemBytes)} ${_('item limit')}`,
          `${formatBytes(effective.previewBytes)} ${_('preview limit')}`,
        ].filter(Boolean).join(' · ');
      } catch (error) {
        statusRow.subtitle = error.message;
      } finally {
        testButton.sensitive = true;
      }
    });
    statusRow.add_suffix(testButton);
    service.add(statusRow);

    const servicePrefs = new Adw.ActionRow({
      title: _('Service preferences'),
      subtitle: _('Provided by the external synchronization Service'),
    });
    const servicePrefsButton = new Gtk.Button({label: _('Open'), valign: Gtk.Align.CENTER});
    servicePrefsButton.connect('clicked', async () => {
      try {
        await callSyncService(settings, 'OpenPreferences', null, null);
      } catch (error) {
        statusRow.subtitle = error.message;
      }
    });
    servicePrefs.add_suffix(servicePrefsButton);
    service.add(servicePrefs);

    const policy = new Adw.PreferencesGroup({title: _('Transfer policy')});
    page.add(policy);
    policy.add(this._combo(settings, 'sync-send-mode', _('Send mode'), [
      ['disabled', _('Disabled')],
      ['manual', _('Manual')],
      ['automatic', _('Automatic')],
    ]));
    policy.add(this._combo(settings, 'sync-receive-mode', _('Receive mode'), [
      ['disabled', _('Disabled')],
      ['history', _('History only')],
      ['activate', _('Activate clipboard')],
    ]));
    policy.add(this._switch(settings, 'sync-text', _('Text')));
    policy.add(this._switch(settings, 'sync-html', _('HTML')));
    policy.add(this._switch(settings, 'sync-images', _('Images')));
    policy.add(this._switch(settings, 'sync-sensitive', _('Sensitive content'), _('Disabled by default')));
    policy.add(this._switch(
      settings,
      'sync-favorites-only',
      _('Favorites only'),
      _('Only applies to automatic sending'),
    ));
    policy.add(this._sizeSpin(settings, 'text-full-threshold', _('Small text sent in full'), 1, 16384, 1, 1024, _('KiB')));
    policy.add(this._sizeSpin(settings, 'text-preview-limit', _('Large text preview'), 0.25, 64, 0.25, 1024, _('KiB'), 2));
    policy.add(this._sizeSpin(settings, 'image-full-threshold', _('Small images sent in full'), 0.25, 128, 0.25, 1024 * 1024, _('MiB'), 2));
    policy.add(this._spin(settings, 'thumbnail-size', _('Thumbnail dimension'), 64, 1024, 16, _('px')));
    policy.add(this._sizeSpin(settings, 'thumbnail-byte-limit', _('Thumbnail size limit'), 16, 4096, 16, 1024, _('KiB')));
    policy.add(this._spin(settings, 'sync-transfer-timeout-seconds', _('On-demand timeout'), 5, 3600, 5, _('seconds')));
    return page;
  }

  _colorPage(settings) {
    const page = new Adw.PreferencesPage({title: _('Color picker'), icon_name: 'color-select-symbolic'});
    const color = new Adw.PreferencesGroup({title: _('Color format')});
    page.add(color);
    color.add(this._combo(settings, 'color-format', _('Default format'), [
      ['hex', 'HEX'],
      ['rgb', 'RGB'],
      ['hsl', 'HSL'],
      ['oklch', 'OKLCH'],
    ]));
    return page;
  }

  _screenshotPage(settings) {
    const page = new Adw.PreferencesPage({title: _('Screenshot'), icon_name: 'camera-photo-symbolic'});
    const screenshot = new Adw.PreferencesGroup({title: _('Screenshot Portal')});
    page.add(screenshot);
    screenshot.add(this._combo(settings, 'screenshot-target', _('Default target'), [
      ['interactive', _('Interactive')],
      ['screen', _('Full screen')],
      ['window', _('Window')],
      ['area', _('Area')],
      ['active-window', _('Active window')],
    ]));
    screenshot.add(this._switch(settings, 'screenshot-add-history', _('Add to history')));
    screenshot.add(this._switch(settings, 'screenshot-write-clipboard', _('Copy screenshot')));
    screenshot.add(this._switch(settings, 'screenshot-open-editor', _('Open image editor')));

    const editor = new Adw.PreferencesGroup({title: _('Image editor')});
    page.add(editor);
    editor.add(this._editorAppCombo(settings));
    editor.add(this._entry(
      settings,
      'editor-command',
      _('Advanced command'),
      _('%u is the URI, %f is a local path and %% is a percent sign'),
      value => {
        try {
          buildEditorArgv(value, 'file:///tmp/clipboard-x.png', '/tmp/clipboard-x.png');
          return true;
        } catch (_error) {
          return false;
        }
      },
    ));

    return page;
  }

  _shortcutsPage(settings) {
    const page = new Adw.PreferencesPage({
      title: _('Shortcuts'),
      icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
    });
    const group = new Adw.PreferencesGroup({
      title: _('Keyboard shortcuts'),
      description: _('Click a shortcut, then press the new key combination. Backspace disables it.'),
    });
    page.add(group);
    for (const [key, title] of [
      ['panel-shortcut', _('Open clipboard panel')],
      ['screenshot-shortcut', _('Take screenshot')],
      ['color-picker-shortcut', _('Pick color')],
      ['private-mode-shortcut', _('Pause or resume clipboard recording')],
      ['clear-history-shortcut', _('Clear unpinned history')],
    ])
      group.add(this._shortcut(settings, key, title));
    return page;
  }

  _switch(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
  }

  _entry(settings, key, title, subtitle = '', validate = null) {
    const row = new Adw.EntryRow({title, text: settings.get_string(key)});
    if (subtitle)
      row.set_tooltip_text(subtitle);
    row.connect('changed', () => {
      const value = row.get_text().trim();
      const valid = !validate || validate(value);
      row[valid ? 'remove_css_class' : 'add_css_class']('error');
      if (valid)
        settings.set_string(key, value);
    });
    return row;
  }

  _spin(settings, key, title, lower, upper, step, suffix = '') {
    const row = new Adw.SpinRow({
      title,
      subtitle: suffix,
      adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 10}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
  }

  _sizeSpin(settings, key, title, lower, upper, step, factor, unit, digits = 0) {
    const row = new Adw.SpinRow({
      title,
      subtitle: unit,
      digits,
      adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 10}),
      value: settings.get_uint(key) / factor,
    });
    row.connect('notify::value', () => settings.set_uint(key, Math.round(row.value * factor)));
    return row;
  }

  _combo(settings, key, title, choices) {
    const values = choices.map(([value]) => value);
    const row = new Adw.ComboRow({
      title,
      model: Gtk.StringList.new(choices.map(([, label]) => label)),
      selected: Math.max(0, values.indexOf(settings.get_string(key))),
    });
    row.connect('notify::selected', () => settings.set_string(key, values[row.selected]));
    return row;
  }

  _iconCombo(settings, key, title, choices) {
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
      selected: Math.max(0, values.indexOf(settings.get_string(key))),
      factory: createFactory(),
      list_factory: createFactory(),
    });
    row.connect('notify::selected', () => settings.set_string(key, values[row.selected]));
    return row;
  }

  _shortcut(settings, key, title) {
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
      shortcut.accelerator = settings.get_strv(key)[0] ?? '';
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
        const modifiers = state & Gtk.accelerator_get_default_mod_mask() & ~Gdk.ModifierType.LOCK_MASK;
        if (modifiers === 0 && keyval === Gdk.KEY_Escape) {
          stop();
          return Gdk.EVENT_STOP;
        }
        if (modifiers === 0 && keyval === Gdk.KEY_BackSpace) {
          settings.set_strv(key, []);
          stop();
          return Gdk.EVENT_STOP;
        }
        const valid = Gtk.accelerator_valid(keyval, modifiers)
          || (keyval === Gdk.KEY_Tab && modifiers !== 0);
        if (!valid) {
          button.add_css_class('error');
          return Gdk.EVENT_STOP;
        }
        settings.set_strv(key, [Gtk.accelerator_name_with_keycode(null, keyval, keycode, modifiers)]);
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

  _stringListEntry(settings, key, title, subtitle = '') {
    const row = new Adw.EntryRow({title, text: settings.get_strv(key).join(', ')});
    if (subtitle)
      row.set_tooltip_text(subtitle);
    row.connect('changed', () => {
      const values = row.get_text().split(',').map(value => value.trim()).filter(Boolean);
      settings.set_strv(key, [...new Set(values)]);
    });
    return row;
  }

  _editorAppCombo(settings) {
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
    return this._combo(settings, 'editor-app-id', _('Application'), choices);
  }
}

function windowFor(widget) {
  return widget.get_root();
}

function GdkClipboard(window) {
  return {
    set(text) {
      window.get_clipboard().set(text);
    },
  };
}

async function inspectSyncService(settings) {
  const reply = await callSyncService(
    settings,
    'GetAll',
    new GLib.Variant('(s)', [SYNC_INTERFACE]),
    new GLib.VariantType('(a{sv})'),
    'org.freedesktop.DBus.Properties',
  );
  return unpackVariants(reply.deepUnpack()[0]);
}

function callSyncService(settings, method, parameters, replyType, interfaceName = SYNC_INTERFACE) {
  return new Promise((resolve, reject) => {
    Gio.DBus.session.call(
      settings.get_string('service-bus-name'),
      settings.get_string('service-object-path'),
      interfaceName,
      method,
      parameters,
      replyType,
      Gio.DBusCallFlags.NONE,
      5000,
      null,
      (connection, result) => {
        try {
          resolve(connection.call_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

function unpackVariants(value) {
  if (value instanceof GLib.Variant)
    return unpackVariants(value.deepUnpack());
  if (Array.isArray(value))
    return value.map(unpackVariants);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpackVariants(item)]));
  return value;
}

function formatBytes(bytes) {
  if (bytes < 1024)
    return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
