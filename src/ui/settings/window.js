// Clipboard X Gnome settings window composition.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {buildEditorArgv} from '../../screenshot/editor-launcher.js';
import {DictionaryStore} from '../../clipboard/tokenizer/dictionary/store.js';
import {ensureDeviceIdentity} from '../../sync/device.js';
import {create as createPanelActionsRow} from './panel-actions.js';
import {create as createRunningAppsRow} from './running-apps.js';
import {restore as restoreDefaults} from './defaults.js';
import {deviceIcon} from '../icons/device.js';
import {create as createSyncGroup} from './sync.js';
import {create as createFileVerificationRow} from './file-verification.js';
import {create as createDictionariesGroup} from './dictionaries.js';
import {PreferenceRows} from './rows.js';
import {create as createThemeColorRow} from './theme-color.js';
import {create as createAboutPage} from './about.js';

export default class ClipboardXPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    this._rows = new PreferenceRows(settings);
    this._dictionaryStore = new DictionaryStore();
    const {deviceId} = ensureDeviceIdentity(settings);
    window.set_title('Clipboard X Gnome');
    window.set_default_size(900, 700);
    // GNOME's preferences host requires at least one registered page even when
    // the extension supplies its own split-view navigation as the window content.
    window.add(new Adw.PreferencesPage({title: 'Clipboard X Gnome'}));

    const pages = [
      ['general', 'preferences-desktop-appearance-symbolic', this._generalPage(settings, window)],
      ['clipboard', 'edit-paste-symbolic', this._clipboardPage(settings, window)],
      ['quick-phrases', 'starred-symbolic', this._phrasesPage(settings)],
      ['sync', 'network-transmit-receive-symbolic', this._syncPage(settings, deviceId)],
      ['color-picker', 'color-select-symbolic', this._colorPage(settings)],
      ['screenshot', 'camera-photo-symbolic', this._screenshotPage(settings)],
      ['shortcuts', 'input-keyboard-symbolic', this._shortcutsPage(settings)],
      ['about', 'help-about-symbolic', createAboutPage(this.metadata)],
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
      title: 'Clipboard X Gnome',
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

  _generalPage(settings, window) {
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
    panel.add(this._rows.combo('panel-anchor', _('Panel position when indicator is hidden'), [
      ['top-left', _('Top left')],
      ['top-center', _('Top center')],
      ['top-right', _('Top right')],
      ['center-left', _('Center left')],
      ['center', _('Center')],
      ['center-right', _('Center right')],
      ['bottom-left', _('Bottom left')],
      ['bottom-center', _('Bottom center')],
      ['bottom-right', _('Bottom right')],
    ]));
    panel.add(this._rows.spin(
      'panel-offset-x',
      _('Horizontal panel offset'),
      -4096,
      4096,
      1,
      _('px; positive moves right'),
    ));
    panel.add(this._rows.spin(
      'panel-offset-y',
      _('Vertical panel offset'),
      -4096,
      4096,
      1,
      _('px; positive moves down'),
    ));
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
      title: _('Icon layout'),
      description: _('Use the buttons to change action placement and order.'),
    });
    page.add(actions);
    actions.add(createPanelActionsRow(settings));

    const description = _('Reset all preferences without deleting clipboard history, quick phrases, dictionaries, server connection, or device identity.');
    const defaults = new Adw.PreferencesGroup();
    const row = new Adw.ActionRow({
      title: _('Restore default settings'),
      subtitle: description,
    });
    const button = new Gtk.Button({
      label: _('Restore'),
      valign: Gtk.Align.CENTER,
    });
    button.connect('clicked', () => {
      const dialog = new Adw.AlertDialog({
        heading: _('Restore default settings?'),
        body: description,
      });
      dialog.add_response('cancel', _('Cancel'));
      dialog.add_response('restore', _('Restore'));
      dialog.default_response = 'cancel';
      dialog.close_response = 'cancel';
      dialog.set_response_appearance('restore', Adw.ResponseAppearance.DESTRUCTIVE);
      dialog.choose(window, null, (source, result) => {
        let response;
        try {
          response = source.choose_finish(result);
        } catch (_error) {
          return;
        }
        if (response === 'restore')
          restoreDefaults(settings);
      });
    });
    row.add_suffix(button);
    row.activatable_widget = button;
    defaults.add(row);
    page.add(defaults);

    return page;
  }

  _clipboardPage(settings, window) {
    const page = new Adw.PreferencesPage({title: _('Clipboard'), icon_name: 'edit-paste-symbolic'});
    const history = new Adw.PreferencesGroup({
      title: _('History'),
      description: _('Pinned entries are kept when history or storage limits are reached.'),
    });
    page.add(history);
    history.add(this._rows.spin('history-size', _('History entries'), 1, 10000, 1));
    history.add(this._rows.spin('cache-size-mib', _('Storage size'), 16, 16384, 16, _('MB')));
    history.add(this._rows.spin('history-retention-days', _('History retention'), 0, 3650, 1, _('days; 0 disables')));
    history.add(this._rows.spin('capture-size-limit-mib', _('Maximum item size'), 1, 256, 1, _('MB')));
    history.add(this._rows.switch('trim-whitespace', _('Trim surrounding whitespace')));

    const simulatedInput = new Adw.PreferencesGroup({
      title: _('Simulated input'),
      description: _('Use slow input if a target application misses simulated keystrokes.'),
    });
    page.add(simulatedInput);
    simulatedInput.add(this._rows.combo('simulated-input-speed', _('Typing speed'), [
      ['standard', _('Standard')],
      ['slow', _('Slow')],
    ]));

    const tokenizer = new Adw.PreferencesGroup({title: _('Tokenizer')});
    page.add(tokenizer);
    tokenizer.add(this._rows.switch('tokenizer-show-source-preview', _('Show source text preview')));

    const privacy = new Adw.PreferencesGroup({
      title: _('Privacy'),
      description: _('Select a running application or enter its window class manually to exclude it.'),
    });
    page.add(privacy);
    privacy.add(this._rows.switch('private-mode', _('Pause clipboard recording')));
    privacy.add(this._rows.combo('sensitive-content-mode', _('Sensitive content'), [
      ['discard', _('Do not record')],
      ['memory', _('Keep until extension stops')],
    ]));
    privacy.add(this._rows.stringList(
      'excluded-apps',
      _('Excluded applications'),
      _('Comma-separated window classes'),
    ));
    privacy.add(createRunningAppsRow(settings));
    const dictionaries = createDictionariesGroup({
      settings,
      store: this._dictionaryStore,
      window,
    });
    if (dictionaries)
      page.add(dictionaries);
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
    ));
    behavior.add(this._rows.switch(
      'phrase-close-after-copy',
      _('Close panel after copying'),
    ));
    return page;
  }

  _syncPage(settings, deviceId) {
    const page = new Adw.PreferencesPage({title: _('Synchronization'), icon_name: 'network-transmit-receive-symbolic'});
    const identity = new Adw.PreferencesGroup({title: _('Device')});
    page.add(identity);
    const idRow = new Adw.ActionRow({title: _('Device ID'), subtitle: deviceId});
    const copy = new Gtk.Button({icon_name: 'edit-copy-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat']});
    copy.connect('clicked', () => GdkClipboard(windowFor(copy)).set(deviceId));
    idRow.add_suffix(copy);
    identity.add(idRow);
    identity.add(this._rows.entry('device-tag', _('Device tag'), _('Friendly name shown during device discovery')));
    identity.add(this._rows.iconCombo('device-icon-kind', _('Device icon'), [
      ['computer', _('Desktop'), deviceIcon('computer')],
      ['laptop', _('Laptop'), deviceIcon('laptop')],
      ['tablet', _('Tablet'), deviceIcon('tablet')],
      ['server', _('Server'), deviceIcon('server')],
      ['android', 'Android', deviceIcon('android')],
      ['apple', 'Apple', deviceIcon('apple')],
      ['windows', 'Windows', deviceIcon('windows')],
      ['linux', 'Linux', deviceIcon('linux')],
      ['debian', 'Debian', deviceIcon('debian')],
      ['archlinux', 'Arch Linux', deviceIcon('archlinux')],
    ]));

    page.add(createSyncGroup(settings, deviceId, this._rows));

    const policy = new Adw.PreferencesGroup({
      title: _('Transfer policy'),
      description: _('Previews reduce initial transfer size; originals are fetched when needed.'),
    });
    page.add(policy);
    const sendMode = this._rows.combo('sync-send-mode', _('Send mode'), [
      ['disabled', _('Disabled')],
      ['manual', _('Manual')],
      ['automatic', _('Automatic')],
    ]);
    sendMode.subtitle = _('Automatic sending uploads matching new entries to the configured server.');
    policy.add(sendMode);
    const receiveMode = this._rows.combo('sync-receive-mode', _('Receive mode'), [
      ['disabled', _('Disabled')],
      ['history', _('History only')],
      ['activate', _('Activate clipboard')],
    ]);
    receiveMode.subtitle = _('Activate clipboard replaces the current clipboard with incoming content.');
    policy.add(receiveMode);
    policy.add(this._rows.switch('sync-text', _('Text')));
    policy.add(this._rows.switch('sync-html', _('HTML')));
    policy.add(this._rows.switch('sync-images', _('Images')));
    policy.add(this._rows.switch(
      'sync-favorites-only',
      _('Pinned entries only'),
      _('Only applies to automatic sending'),
    ));
    const textThreshold = this._rows.sizeSpin('text-full-threshold', _('Text full-transfer threshold'), 1, 16384, 1, 1024, _('KB'));
    textThreshold.subtitle = _('Applies to sending and receiving. Larger content is downloaded only when needed.');
    policy.add(textThreshold);
    policy.add(this._rows.sizeSpin('text-preview-limit', _('Large text preview'), 0.25, 64, 0.25, 1024, _('KB'), 2));
    const imageThreshold = this._rows.sizeSpin('image-full-threshold', _('Image full-transfer threshold'), 0.25, 128, 0.25, 1024 * 1024, _('MB'), 2);
    imageThreshold.subtitle = _('Applies to sending and receiving. Larger content is downloaded only when needed.');
    policy.add(imageThreshold);
    policy.add(this._rows.spin('thumbnail-size', _('Thumbnail dimension'), 64, 1024, 16, _('px')));
    policy.add(this._rows.sizeSpin('thumbnail-byte-limit', _('Thumbnail size limit'), 16, 4096, 16, 1024, _('KB')));
    policy.add(this._rows.spin('sync-transfer-timeout-seconds', _('On-demand timeout'), 5, 3600, 5, _('seconds')));
    const pollInterval = this._rows.spin('sync-poll-interval-seconds', _('Polling interval'), 2, 60, 1, _('seconds'));
    pollInterval.subtitle = _('Seconds between checks; longer intervals reduce requests but delay updates.');
    policy.add(pollInterval);
    policy.add(createFileVerificationRow(settings, _));
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
    const screenshotTarget = this._rows.combo('screenshot-target', _('Default target'), [
      ['interactive', _('Interactive')],
      ['screen', _('Full screen')],
      ['window', _('Window')],
      ['area', _('Area')],
      ['active-window', _('Active window')],
    ]);
    screenshotTarget.subtitle = _('Available targets depend on the system screenshot portal.');
    screenshot.add(screenshotTarget);
    screenshot.add(this._rows.switch('screenshot-add-history', _('Add to history')));
    screenshot.add(this._rows.switch('screenshot-write-clipboard', _('Copy screenshot')));
    screenshot.add(this._rows.switch('screenshot-open-editor', _('Open image editor'),
      _('Requires an image editor command below.')));

    const editor = new Adw.PreferencesGroup({
      title: _('Image editing'),
      description: _('Enter a command to enable editing. %u is an image URI, %f a local path, %i image bytes on standard input, and %% a percent sign.'),
    });
    page.add(editor);
    editor.add(this._rows.entry(
      'editor-command',
      _('Command'),
      '',
      value => {
        if (!value)
          return true;
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
      ['history-search-shortcut', _('Focus clipboard search')],
      ['history-paste-shortcut', _('Paste entry')],
      ['history-pin-shortcut', _('Pin or unpin entry')],
      ['history-delete-shortcut', _('Delete entry')],
      ['history-type-shortcut', _('Type entry directly')],
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
