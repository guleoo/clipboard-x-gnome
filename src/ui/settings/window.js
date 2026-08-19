// Clipboard X settings window composition.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {buildEditorArgv} from '../../screenshot/editor-launcher.js';
import {SYNC_API_VERSION, SYNC_INTERFACE} from '../../sync/constants.js';
import {ensureDeviceIdentity} from '../../sync/device.js';
import {effectiveCapabilities} from '../../sync/policy.js';
import {create as createPanelActionsRow} from './panel-actions.js';
import {PreferenceRows} from './rows.js';
import {create as createThemeColorRow} from './theme-color.js';

export default class ClipboardXPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    this._rows = new PreferenceRows(settings);
    const {deviceId} = ensureDeviceIdentity(settings);
    window.set_title('Clipboard X');
    window.set_default_size(900, 700);
    // GNOME's preferences host requires at least one registered page even when
    // the extension supplies its own split-view navigation as the window content.
    window.add(new Adw.PreferencesPage({title: 'Clipboard X'}));

    const pages = [
      ['general', 'preferences-desktop-appearance-symbolic', this._generalPage(settings)],
      ['clipboard', 'edit-paste-symbolic', this._clipboardPage(settings)],
      ['quick-phrases', 'starred-symbolic', this._phrasesPage(settings)],
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
    appearance.add(createThemeColorRow(settings));

    const panel = new Adw.PreferencesGroup({title: _('Panel')});
    page.add(panel);
    panel.add(this._rows.switch('show-indicator', _('Show panel indicator')));
    panel.add(this._rows.spin('panel-width', _('Panel width'), 300, 800, 10, _('px')));
    panel.add(this._rows.spin('panel-height', _('Panel height'), 160, 800, 10, _('px')));
    panel.add(this._rows.spin(
      'panel-text-vertical-offset',
      _('Text vertical offset'),
      -4,
      4,
      1,
      _('px; negative moves up, positive moves down'),
    ));
    panel.add(this._rows.spin('panel-visible-item-limit', _('Maximum entries shown in panel'), 1, 200, 1));
    panel.add(this._rows.switch(
      'preserve-panel-state',
      _('Preserve panel state'),
      _('Reopen the previous view instead of always returning to clipboard history'),
    ));
    panel.add(this._rows.switch(
      'panel-confine-focus',
      _('Keep keyboard focus in panel'),
      _('At the edge, arrow keys do not move focus outside the extension panel'),
    ));

    const actions = new Adw.PreferencesGroup({
      title: _('Panel actions'),
      description: _('Drag actions to change their placement and order.'),
    });
    page.add(actions);
    actions.add(createPanelActionsRow(settings));
    return page;
  }

  _clipboardPage(settings) {
    const page = new Adw.PreferencesPage({title: _('Clipboard'), icon_name: 'edit-paste-symbolic'});
    const history = new Adw.PreferencesGroup({title: _('History')});
    page.add(history);
    history.add(this._rows.spin('history-size', _('History entries'), 1, 10000, 1));
    history.add(this._rows.spin('cache-size-mib', _('Cache size'), 16, 16384, 16, _('MB')));
    history.add(this._rows.spin('history-retention-days', _('Automatic cleanup'), 0, 3650, 1, _('days; 0 disables')));
    history.add(this._rows.spin('capture-size-limit-mib', _('Maximum item size'), 1, 256, 1, _('MB')));
    history.add(this._rows.switch(
      'trim-whitespace',
      _('Trim surrounding whitespace'),
      _('Remove leading and trailing whitespace from newly captured text'),
    ));

    const tokenizer = new Adw.PreferencesGroup({title: _('Tokenizer')});
    page.add(tokenizer);
    tokenizer.add(this._rows.switch('tokenizer-show-source-preview', _('Show source text preview')));

    const privacy = new Adw.PreferencesGroup({title: _('Privacy')});
    page.add(privacy);
    privacy.add(this._rows.switch('private-mode', _('Pause clipboard recording')));
    privacy.add(this._rows.combo('sensitive-content-mode', _('Sensitive content'), [
      ['discard', _('Do not record')],
      ['memory', _('Keep until extension stops')],
      ['store', _('Store like other history')],
    ]));
    privacy.add(this._rows.stringList(
      'excluded-apps',
      _('Excluded applications'),
      _('Comma-separated window classes'),
    ));
    return page;
  }

  _phrasesPage(settings) {
    const page = new Adw.PreferencesPage({
      title: _('Quick phrases'),
      icon_name: 'starred-symbolic',
    });
    const behavior = new Adw.PreferencesGroup({
      title: _('Behavior'),
      description: _('Quick phrases are stored only on this device.'),
    });
    page.add(behavior);
    behavior.add(this._rows.spin('saved-phrase-limit', _('Maximum quick phrases'), 1, 1000, 1));
    behavior.add(this._rows.switch(
      'saved-phrase-newest-first',
      _('Place new phrases first'),
      _('When disabled, new phrases are added at the end'),
    ));
    behavior.add(this._rows.switch(
      'phrase-close-after-copy',
      _('Close panel after copying'),
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
    identity.add(this._rows.entry('device-tag', _('Device tag'), _('Friendly name shown during device discovery')));
    identity.add(this._rows.iconCombo('device-icon-kind', _('Device icon'), [
      ['desktop', _('Desktop'), 'video-display-symbolic'],
      ['laptop', _('Laptop'), 'computer-symbolic'],
      ['phone', _('Phone'), 'phone-symbolic'],
      ['tablet', _('Tablet'), 'input-tablet-symbolic'],
      ['server', _('Server'), 'network-server-symbolic'],
      ['other', _('Other'), 'avatar-default-symbolic'],
    ]));

    const service = new Adw.PreferencesGroup({title: _('Service connection')});
    page.add(service);
    service.add(this._rows.switch('sync-enabled', _('Enable synchronization integration')));
    service.add(this._rows.entry(
      'service-bus-name',
      _('D-Bus name'),
      '',
      value => Gio.dbus_is_name(value),
    ));
    service.add(this._rows.entry(
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
    policy.add(this._rows.combo('sync-send-mode', _('Send mode'), [
      ['disabled', _('Disabled')],
      ['manual', _('Manual')],
      ['automatic', _('Automatic')],
    ]));
    policy.add(this._rows.combo('sync-receive-mode', _('Receive mode'), [
      ['disabled', _('Disabled')],
      ['history', _('History only')],
      ['activate', _('Activate clipboard')],
    ]));
    policy.add(this._rows.switch('sync-text', _('Text')));
    policy.add(this._rows.switch('sync-html', _('HTML')));
    policy.add(this._rows.switch('sync-images', _('Images')));
    policy.add(this._rows.switch('sync-sensitive', _('Sensitive content'), _('Disabled by default')));
    policy.add(this._rows.switch(
      'sync-favorites-only',
      _('Favorites only'),
      _('Only applies to automatic sending'),
    ));
    policy.add(this._rows.sizeSpin('text-full-threshold', _('Small text sent in full'), 1, 16384, 1, 1024, _('KB')));
    policy.add(this._rows.sizeSpin('text-preview-limit', _('Large text preview'), 0.25, 64, 0.25, 1024, _('KB'), 2));
    policy.add(this._rows.sizeSpin('image-full-threshold', _('Small images sent in full'), 0.25, 128, 0.25, 1024 * 1024, _('MB'), 2));
    policy.add(this._rows.spin('thumbnail-size', _('Thumbnail dimension'), 64, 1024, 16, _('px')));
    policy.add(this._rows.sizeSpin('thumbnail-byte-limit', _('Thumbnail size limit'), 16, 4096, 16, 1024, _('KB')));
    policy.add(this._rows.spin('sync-transfer-timeout-seconds', _('On-demand timeout'), 5, 3600, 5, _('seconds')));
    return page;
  }

  _colorPage(settings) {
    const page = new Adw.PreferencesPage({title: _('Color picker'), icon_name: 'color-select-symbolic'});
    const color = new Adw.PreferencesGroup({title: _('Color format')});
    page.add(color);
    color.add(this._rows.combo('color-format', _('Default format'), [
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
    screenshot.add(this._rows.combo('screenshot-target', _('Default target'), [
      ['interactive', _('Interactive')],
      ['screen', _('Full screen')],
      ['window', _('Window')],
      ['area', _('Area')],
      ['active-window', _('Active window')],
    ]));
    screenshot.add(this._rows.switch('screenshot-add-history', _('Add to history')));
    screenshot.add(this._rows.switch('screenshot-write-clipboard', _('Copy screenshot')));
    screenshot.add(this._rows.switch('screenshot-open-editor', _('Open image editor')));

    const editor = new Adw.PreferencesGroup({title: _('Image editing')});
    page.add(editor);
    editor.add(this._rows.editorApp());
    editor.add(this._rows.entry(
      'editor-command',
      _('Advanced command'),
      _('%u is the URI, %f is a local path, %i is standard input and %% is a percent sign'),
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
      clipboard.add(this._rows.shortcut(key, title));

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
      history.add(this._rows.shortcut(key, title, true));

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
      tokenizer.add(this._rows.shortcut(key, title, true));

    const colorPicker = new Adw.PreferencesGroup({title: _('Color picker')});
    page.add(colorPicker);
    colorPicker.add(this._rows.shortcut('color-picker-shortcut', _('Pick color')));

    const screenshot = new Adw.PreferencesGroup({title: _('Screenshot')});
    page.add(screenshot);
    screenshot.add(this._rows.shortcut('screenshot-shortcut', _('Take screenshot')));
    return page;
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
    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
