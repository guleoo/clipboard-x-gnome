import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {buildEditorArgv} from '../screenshot/editor-launcher.js';
import {SYNC_API_VERSION, SYNC_INTERFACE} from '../sync/constants.js';
import {ensureDeviceIdentity} from '../sync/device.js';
import {effectiveCapabilities} from '../sync/policy.js';

const THEME_COLORS = Object.freeze([
  ['blue', '#3584e4'],
  ['teal', '#2190a4'],
  ['green', '#3a944a'],
  ['orange', '#ed5b00'],
  ['pink', '#d56199'],
  ['slate', '#6f8396'],
]);
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export default class ClipboardXPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    const {deviceId} = ensureDeviceIdentity(settings);
    window.set_title('Clipboard X');
    window.set_default_size(900, 700);

    const pages = [
      ['general', 'preferences-desktop-appearance-symbolic', this._generalPage(settings)],
      ['clipboard', 'edit-paste-symbolic', this._clipboardPage(settings)],
      ['sync', 'folder-remote-symbolic', this._syncPage(settings, deviceId)],
      ['color-picker', 'color-select-symbolic', this._colorPage(settings)],
      ['screenshot', 'camera-photo-symbolic', this._screenshotPage(settings)],
      ['shortcuts', 'input-keyboard-symbolic', this._shortcutsPage(settings)],
    ];
    const stack = new Gtk.Stack({
      hexpand: true,
      vexpand: true,
      transition_type: Gtk.StackTransitionType.NONE,
    });
    const navigation = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.SINGLE,
      css_classes: ['navigation-sidebar'],
      width_request: 190,
      vexpand: true,
    });
    for (const [name, iconName, page] of pages) {
      stack.add_named(page, name);
      const row = new Gtk.ListBoxRow({activatable: true});
      const content = new Gtk.Box({
        spacing: 10,
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 12,
        margin_end: 12,
      });
      content.append(new Gtk.Image({icon_name: iconName, pixel_size: 16}));
      content.append(new Gtk.Label({label: page.title, xalign: 0, hexpand: true}));
      row.set_child(content);
      row._clipboardXPageName = name;
      navigation.append(row);
    }
    const sidebar = new Gtk.ScrolledWindow({
      child: navigation,
      vexpand: true,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
    });
    const sidebarView = new Adw.ToolbarView({content: sidebar});
    sidebarView.add_top_bar(new Adw.HeaderBar());
    const sidebarPage = new Adw.NavigationPage({
      title: 'Clipboard X',
      child: sidebarView,
    });
    const contentView = new Adw.ToolbarView({content: stack});
    contentView.add_top_bar(new Adw.HeaderBar());
    const contentPage = new Adw.NavigationPage({
      title: pages[0][2].title,
      child: contentView,
    });
    const splitView = new Adw.NavigationSplitView({
      sidebar: sidebarPage,
      content: contentPage,
    });
    navigation.connect('row-selected', (_list, row) => {
      if (!row)
        return;
      stack.visible_child_name = row._clipboardXPageName;
      contentPage.title = stack.visible_child.title;
      splitView.show_content = true;
    });
    window.set_content(splitView);
    navigation.select_row(navigation.get_row_at_index(0));
  }

  _generalPage(settings) {
    const page = new Adw.PreferencesPage({
      title: _('General'),
      icon_name: 'preferences-desktop-appearance-symbolic',
    });
    const appearance = new Adw.PreferencesGroup({title: _('Appearance')});
    page.add(appearance);
    appearance.add(this._themeColorRow(settings));

    const panel = new Adw.PreferencesGroup({title: _('Panel')});
    page.add(panel);
    panel.add(this._switch(settings, 'show-indicator', _('Show panel indicator')));
    panel.add(this._spin(settings, 'panel-width', _('Panel width'), 300, 800, 10, _('px')));
    panel.add(this._spin(settings, 'panel-height', _('Panel height'), 160, 800, 10, _('px')));
    panel.add(this._spin(settings, 'panel-visible-item-limit', _('Maximum entries shown in panel'), 1, 200, 1));
    panel.add(this._switch(
      settings,
      'preserve-panel-state',
      _('Preserve panel state'),
      _('Reopen the previous view instead of always returning to clipboard history'),
    ));
    panel.add(this._switch(
      settings,
      'panel-confine-focus',
      _('Keep keyboard focus in panel'),
      _('At the edge, arrow keys do not move focus outside the extension panel'),
    ));
    return page;
  }

  _themeColorRow(settings) {
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
      const swatch = new Gtk.DrawingArea({
        content_width: 28,
        content_height: 28,
      });
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
        const rgba = value === 'system'
          ? styleManager.get_accent_color_rgba()
          : parseColor(color);
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
      const labels = [
        _('Blue'), _('Teal'), _('Green'), _('Orange'), _('Pink'), _('Slate'),
      ];
      THEME_COLORS.forEach(([value, color], index) => addSwatch(value, color, labels[index]));
      const selected = settings.get_string('theme-color');
      const customColors = uniqueColors([
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
          ? parseColor(settings.get_string('theme-color'))
          : styleManager.get_accent_color_rgba();
        dialog.choose_rgba(windowFor(addButton), initial, null, (_source, result) => {
          try {
            const color = rgbaToHex(dialog.choose_rgba_finish(result));
            settings.set_strv('custom-theme-colors', uniqueColors([
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
    let wasRooted = false;
    let disconnected = false;
    row.connect('notify::root', () => {
      if (row.get_root()) {
        wasRooted = true;
        return;
      }
      if (!wasRooted || disconnected)
        return;
      disconnected = true;
      settings.disconnect(themeColorSignal);
      settings.disconnect(customColorsSignal);
      styleManager.disconnect(systemAccentSignal);
      Gtk.StyleContext.remove_provider_for_display(display, styleProvider);
    });
    render();
    return row;
  }

  _clipboardPage(settings) {
    const page = new Adw.PreferencesPage({title: _('Clipboard'), icon_name: 'edit-paste-symbolic'});
    const history = new Adw.PreferencesGroup({title: _('History')});
    page.add(history);
    history.add(this._spin(settings, 'history-size', _('History entries'), 1, 10000, 1));
    history.add(this._spin(settings, 'cache-size-mib', _('Cache size'), 16, 16384, 16, _('MB')));
    history.add(this._spin(settings, 'history-retention-days', _('Automatic cleanup'), 0, 3650, 1, _('days; 0 disables')));
    history.add(this._spin(settings, 'capture-size-limit-mib', _('Maximum item size'), 1, 256, 1, _('MB')));

    const tokenizer = new Adw.PreferencesGroup({title: _('Tokenizer')});
    page.add(tokenizer);
    tokenizer.add(this._switch(settings, 'tokenizer-show-source-preview', _('Show source text preview')));

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
    policy.add(this._sizeSpin(settings, 'text-full-threshold', _('Small text sent in full'), 1, 16384, 1, 1024, _('KB')));
    policy.add(this._sizeSpin(settings, 'text-preview-limit', _('Large text preview'), 0.25, 64, 0.25, 1024, _('KB'), 2));
    policy.add(this._sizeSpin(settings, 'image-full-threshold', _('Small images sent in full'), 0.25, 128, 0.25, 1024 * 1024, _('MB'), 2));
    policy.add(this._spin(settings, 'thumbnail-size', _('Thumbnail dimension'), 64, 1024, 16, _('px')));
    policy.add(this._sizeSpin(settings, 'thumbnail-byte-limit', _('Thumbnail size limit'), 16, 4096, 16, 1024, _('KB')));
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
    const screenshot = new Adw.PreferencesGroup({title: _('Screenshot')});
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

    const editor = new Adw.PreferencesGroup({title: _('Image editing')});
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
      icon_name: 'input-keyboard-symbolic',
    });
    const clipboard = new Adw.PreferencesGroup({
      title: _('Global'),
      description: _('Click a shortcut, then press the new key combination. Backspace disables it.'),
    });
    page.add(clipboard);
    for (const [key, title] of [
      ['panel-shortcut', _('Open clipboard panel')],
      ['history-search-shortcut', _('Focus clipboard search')],
      ['private-mode-shortcut', _('Pause or resume clipboard recording')],
      ['clear-history-shortcut', _('Clear unpinned history')],
    ])
      clipboard.add(this._shortcut(settings, key, title));

    const history = new Adw.PreferencesGroup({
      title: _('Clipboard'),
      description: _('Active while a clipboard history entry has keyboard focus.'),
    });
    page.add(history);
    for (const [key, title] of [
      ['history-paste-shortcut', _('Paste entry')],
      ['history-pin-shortcut', _('Pin or unpin entry')],
      ['history-delete-shortcut', _('Delete entry')],
      ['history-type-shortcut', _('Type entry directly')],
      ['history-type-activation-shortcut', _('Type entry instead of copying')],
    ])
      history.add(this._shortcut(settings, key, title, true));

    const tokenizer = new Adw.PreferencesGroup({
      title: _('Tokenizer'),
      description: _('Active while a token has keyboard focus.'),
    });
    page.add(tokenizer);
    for (const [key, title] of [
      ['tokenizer-copy-shortcut', _('Copy selected tokens')],
      ['tokenizer-paste-shortcut', _('Paste selected tokens')],
      ['tokenizer-type-shortcut', _('Type selected tokens')],
      ['tokenizer-select-previous-shortcut', _('Extend selection left')],
      ['tokenizer-select-next-shortcut', _('Extend selection right')],
      ['tokenizer-select-above-shortcut', _('Extend selection upward')],
      ['tokenizer-select-below-shortcut', _('Extend selection downward')],
    ])
      tokenizer.add(this._shortcut(settings, key, title, true));

    const colorPicker = new Adw.PreferencesGroup({title: _('Color picker')});
    page.add(colorPicker);
    colorPicker.add(this._shortcut(settings, 'color-picker-shortcut', _('Pick color')));

    const screenshot = new Adw.PreferencesGroup({title: _('Screenshot')});
    page.add(screenshot);
    screenshot.add(this._shortcut(settings, 'screenshot-shortcut', _('Take screenshot')));
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

  _shortcut(settings, key, title, contextual = false) {
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
          || (contextual && modifiers === 0 && keyval !== 0)
          || (keyval === Gdk.KEY_Tab && modifiers !== 0);
        if (!valid) {
          button.add_css_class('error');
          return Gdk.EVENT_STOP;
        }
        const accelerator = contextual
          ? Gtk.accelerator_name(keyval, modifiers)
          : Gtk.accelerator_name_with_keycode(null, keyval, keycode, modifiers);
        settings.set_strv(key, [accelerator]);
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

function parseColor(value) {
  const color = new Gdk.RGBA();
  if (!color.parse(value))
    color.parse('#3584e4');
  return color;
}

function setCairoColor(context, color) {
  context.setSourceRGBA(color.red, color.green, color.blue, color.alpha);
}

function rgbaToHex(color) {
  const channel = value => Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16).padStart(2, '0');
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
}

function uniqueColors(colors) {
  return [...new Set(colors
    .map(color => color.toLowerCase())
    .filter(color => HEX_COLOR_PATTERN.test(color)))];
}

function formatBytes(bytes) {
  if (bytes < 1024)
    return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
