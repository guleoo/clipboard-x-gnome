import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {PanelManager} from './panel-manager.js';
import {composeTokens, tokenizeText} from './text-processors.js';

const TEXT_PROCESSING_LIMIT_BYTES = 1024 * 1024;
const ICON_SIZE = 16;
const THEME_COLOR_CLASSES = Object.freeze([
  'blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'slate',
].map(color => `clipboard-x-accent-${color}`));
const DEVICE_ICON_NAMES = Object.freeze({
  desktop: 'video-display-symbolic',
  laptop: 'computer-symbolic',
  phone: 'phone-symbolic',
  tablet: 'input-tablet-symbolic',
  server: 'network-server-symbolic',
  other: 'avatar-default-symbolic',
});
const TERMINAL_TRANSFER_STATES = new Set(['completed', 'failed', 'cancelled', 'expired']);

const ProgressRing = GObject.registerClass(
class ProgressRing extends St.DrawingArea {
  _init(progress = 0) {
    super._init({
      style_class: 'clipboard-x-progress-ring',
      width: 18,
      height: 18,
    });
    this._progress = progress;
    this.connect('repaint', area => this._repaint(area));
  }

  set progress(value) {
    this._progress = Math.max(0, Math.min(1, Number(value) || 0));
    this.queue_repaint();
  }

  _repaint(area) {
    const context = area.get_context();
    const [width, height] = area.get_surface_size();
    const color = area.get_theme_node().get_foreground_color();
    const red = color.red / 255;
    const green = color.green / 255;
    const blue = color.blue / 255;
    const radius = Math.max(1, Math.min(width, height) / 2 - 2);
    const centerX = width / 2;
    const centerY = height / 2;
    context.setLineWidth(2);
    context.setLineCap(Cairo.LineCap.ROUND);
    context.setSourceRGBA(red, green, blue, 0.22);
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.stroke();
    context.setSourceRGBA(red, green, blue, 1);
    context.arc(
      centerX,
      centerY,
      radius,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * this._progress,
    );
    context.stroke();
    context.$dispose();
  }
});

export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
  _init(settings, controller, actions) {
    super._init(0.0, 'Clipboard X');
    this._settings = settings;
    this._controller = controller;
    this._actions = actions;
    this._query = '';
    this._transfers = new Map();
    this._syncButtons = new Map();
    this._syncStatusText = _('Sync disabled');
    this._focusIdleId = 0;
    this._tooltipTimeoutId = 0;
    this._tooltipSource = null;
    this._hintConnections = new Map();
    this._tooltip = new St.Label({
      style_class: 'clipboard-x-tooltip',
      visible: false,
      reactive: false,
    });
    Main.uiGroup.add_child(this._tooltip);

    this.add_child(new St.Icon({
      icon_name: 'edit-paste-symbolic',
      style_class: 'system-status-icon',
    }));
    this.menu.actor.add_style_class_name('clipboard-x-menu');
    this._buildMenu();
    this._panelManager = new PanelManager({
      defaultPanel: 'history',
      clearPanelTooltips: () => this._clearHints('panel'),
      hideTooltip: () => this._hideTooltip(),
    });
    this._panelManager.register('history', {
      enter: () => this._searchItem.visible = true,
      render: () => this._renderHistory(),
    });
    this._panelManager.register('tokenizer', {
      enter: () => this._searchItem.visible = false,
      render: state => this._renderTokenizer(state),
    });
    this._updatePanelGeometry();
    this._updateThemeColor();

    this._changedSignal = controller.connect('changed', () => this._refresh());
    this._privateSignal = settings.connect('changed::private-mode', () => this._updatePrivateButton());
    this._themeColorSignal = settings.connect('changed::theme-color', () => this._updateThemeColor());
    this._panelWidthSignal = settings.connect('changed::panel-width', () => this._updatePanelGeometry());
    this._panelHeightSignal = settings.connect('changed::panel-height', () => this._updatePanelGeometry());
    this._visibleItemLimitSignal = settings.connect('changed::panel-visible-item-limit', () => this._refresh());
    this._preservePanelStateSignal = settings.connect(
      'changed::preserve-panel-state',
      () => this._updatePanelStateRetention(),
    );
    this._syncEnabledSignal = settings.connect('changed::sync-enabled', () => this._refresh());
    this._deviceTagSignal = settings.connect('changed::device-tag', () => this._refresh());
    this._deviceIconSignal = settings.connect('changed::device-icon-kind', () => this._refresh());
    this._menuVisibilitySignal = this.menu.actor.connect('notify::visible', () => {
      if (!this.menu.actor.visible)
        this._panelManager.hidden();
    });
    this.menu.connect('open-state-changed', (_menu, open) => {
      if (open) {
        this._panelManager.open();
        this._actions.ensureIdentity();
        if (this._panelManager.is('history')) {
          this._search.set_text('');
          this._focusSearch();
        }
      } else {
        this._cancelFocusSearch();
        this._hideTooltip();
        this._panelManager.close({
          preserve: this._settings.get_boolean('preserve-panel-state'),
        });
        if (!this.menu.actor.visible)
          this._panelManager.hidden();
      }
    });
    this._panelManager.show('history');
  }

  _buildMenu() {
    const searchItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    this._searchItem = searchItem;
    const searchToolbar = new St.BoxLayout({
      style_class: 'clipboard-x-search-toolbar',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._search = new St.Entry({
      style_class: 'clipboard-x-search',
      hint_text: _('Search clipboard history…'),
      can_focus: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      primary_icon: new St.Icon({icon_name: 'edit-find-symbolic', icon_size: 14}),
    });
    this._search.clutter_text.connect('text-changed', () => {
      this._query = this._search.get_text();
      if (this._panelManager?.is('history'))
        this._refresh();
    });
    searchToolbar.add_child(this._search);
    const toolbar = new St.BoxLayout({
      style_class: 'clipboard-x-toolbar',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._toolbar = toolbar;
    toolbar.add_child(this._iconButton(
      'camera-photo-symbolic',
      _('Screenshot'),
      () => this._runAndClose(() => this._actions.screenshot()),
      {iconSize: 14},
    ));
    toolbar.add_child(this._iconButton(
      'color-select-symbolic',
      _('Pick color'),
      () => this._runAndClose(() => this._actions.pickColor()),
      {iconSize: 14},
    ));
    this._syncToolButton = this._iconButton(
      'network-offline-symbolic',
      _('Synchronization settings'),
      () => this._runAndClose(() => this._actions.openPreferences()),
      {iconSize: 14},
    );
    toolbar.add_child(this._syncToolButton);
    searchToolbar.add_child(toolbar);
    searchItem.add_child(searchToolbar);
    this.menu.addMenuItem(searchItem);

    this._history = new PopupMenu.PopupMenuSection();
    this._scroll = new St.ScrollView({
      overlay_scrollbars: true,
      style_class: 'clipboard-x-history',
    });
    this._scroll.add_child(this._history.actor);
    const scrollItem = new PopupMenu.PopupMenuSection();
    scrollItem.actor.add_child(this._scroll);
    this.menu.addMenuItem(scrollItem);
    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const footerItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    const footer = new St.BoxLayout({style_class: 'clipboard-x-footer', x_expand: true});
    this._footer = footer;
    footer.add_child(new St.Widget({x_expand: true}));
    this._privateButton = this._iconButton(
      'security-high-symbolic',
      _('Pause clipboard recording'),
      () => {
        this._settings.set_boolean('private-mode', !this._settings.get_boolean('private-mode'));
      },
    );
    footer.add_child(this._privateButton);
    footer.add_child(this._iconButton('user-trash-symbolic', _('Clear unpinned history'), () => this._controller.clear()));
    footer.add_child(this._iconButton(
      'emblem-system-symbolic', _('Preferences'), () => this._runAndClose(() => this._actions.openPreferences())));
    footerItem.add_child(footer);
    this.menu.addMenuItem(footerItem);
    this._updatePrivateButton();
  }

  setSyncStatus(status, capabilities = null) {
    let iconName;
    if (!this._settings.get_boolean('sync-enabled')) {
      iconName = 'network-offline-symbolic';
      this._syncStatusText = _('Sync disabled');
    } else if (status === 'offline') {
      iconName = 'network-offline-symbolic';
      this._syncStatusText = _('Sync Service offline');
    } else if (status === 'error') {
      iconName = 'dialog-error-symbolic';
      this._syncStatusText = capabilities?.error ?? _('Sync protocol error');
    } else {
      iconName = 'network-transmit-receive-symbolic';
      const implementation = capabilities?.implementationName;
      this._syncStatusText = implementation
        ? `${implementation} · ${status}`
        : _('Sync Service online');
    }
    this._setButtonIcon(this._syncToolButton, iconName);
    this._setHint(this._syncToolButton, this._syncStatusText);
  }

  setTransfer(transfer) {
    this._transfers.set(transfer.itemId, {...transfer});
    const button = this._syncButtons.get(transfer.itemId);
    if (button)
      this._updateSyncButton(button._clipboardItem, button);
  }

  _refresh() {
    this._panelManager?.refresh();
  }

  _renderHistory() {
    this._history.removeAll();
    this._syncButtons.clear();
    if (this._controller.loading) {
      this._addState(_('Loading clipboard history…'), 'content-loading-symbolic');
      return;
    }
    if (this._controller.error && this._controller.items.length === 0) {
      this._addState(_('Clipboard history could not be loaded'), 'dialog-error-symbolic');
      return;
    }
    const visibleItemLimit = this._settings.get_int('panel-visible-item-limit');
    const items = this._controller.search(this._query, visibleItemLimit + 1);
    const currentDeviceId = this._actions.ensureIdentity().deviceId;
    this._multipleDevices = new Set(this._controller.items.map(item => item.originDeviceId || currentDeviceId)).size > 1;
    if (items.length === 0) {
      const empty = new PopupMenu.PopupBaseMenuItem({reactive: false});
      empty.add_child(new St.Label({
        text: this._query ? _('No matching entries') : _('Clipboard history is empty'),
        style_class: 'clipboard-x-empty',
      }));
      this._history.addMenuItem(empty);
      return;
    }

    for (const item of items.slice(0, visibleItemLimit))
      this._history.addMenuItem(this._entry(item));
    if (items.length > visibleItemLimit) {
      this._history.addMenuItem(new PopupMenu.PopupMenuItem(
        _('More entries are available; refine the search to see others'),
        {reactive: false},
      ));
    }
  }

  _entry(item) {
    const row = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    row.add_style_class_name('clipboard-x-entry');
    row.track_hover = true;
    if (this._multipleDevices) {
      const identity = this._displayIdentity(item);
      row.add_child(this._deviceIcon(identity.iconKind, identity.tag));
    }

    const content = new St.Button({
      can_focus: true,
      track_hover: true,
      style_class: 'clipboard-x-entry-content',
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
    });
    if (item.isText) {
      const title = item.preview?.text?.replaceAll('\n', ' ') || _('Text');
      content.set_child(new St.Label({
        text: title.slice(0, 240),
        style_class: 'clipboard-x-entry-preview',
        style: `max-width: ${this._entryPreviewWidth}px;`,
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
      }));
    } else {
      const box = new St.BoxLayout({
        style_class: 'clipboard-x-image-content',
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      box.add_child(item.preview?.path
        ? new St.Icon({gicon: Gio.icon_new_for_string(item.preview.path), icon_size: 32})
        : new St.Icon({icon_name: 'image-x-generic-symbolic', icon_size: 24}));
      box.add_child(new St.Label({
        text: [item.primary?.mimeType ?? _('Image'), formatBytes(item.primary?.size ?? 0)].join(' · '),
        y_align: Clutter.ActorAlign.CENTER,
      }));
      content.set_child(box);
    }
    content.connect('clicked', () => this._activate(item));
    content.accessible_name = item.remote && item.availability !== 'ready'
      ? _('Download original and copy')
      : _('Copy original');
    row.add_child(content);

    if (item.isText) {
      row.add_child(this._iconButton(
        'format-text-plaintext-symbolic', _('Segment text'), () => this._openTokenizer(item), {showTooltip: false}));
    } else {
      row.add_child(this._iconButton(
        'document-edit-symbolic', _('Edit image'), () => this._actions.editItem(item), {showTooltip: false}));
    }
    const pinButton = this._iconButton(
      'view-pin-symbolic',
      item.favorite ? _('Unpin') : _('Pin'),
      () => this._controller.toggleFavorite(item.id),
      {showTooltip: false},
    );
    pinButton.toggle_mode = true;
    pinButton.checked = item.favorite;
    if (item.favorite)
      pinButton.add_style_class_name('clipboard-x-pinned');
    row.add_child(pinButton);
    if (this._settings.get_boolean('sync-enabled'))
      row.add_child(this._syncButton(item));
    row.add_child(this._iconButton(
      'edit-delete-symbolic', _('Delete from local history'), () => this._controller.remove(item.id), {showTooltip: false}));
    return row;
  }

  _syncButton(item) {
    const button = this._iconButton(
      'folder-remote-symbolic',
      _('Synchronize'),
      () => this._activateSync(item),
      {showTooltip: false},
    );
    button._clipboardItem = item;
    this._syncButtons.set(item.id, button);
    this._updateSyncButton(item, button);
    return button;
  }

  _updateSyncButton(item, button) {
    const transfer = this._transfers.get(item.id);
    if (transfer && !TERMINAL_TRANSFER_STATES.has(transfer.state)) {
      if (transfer.totalBytes > 0) {
        button.set_child(new ProgressRing(transfer.completedBytes / transfer.totalBytes));
        this._setHint(button, `${transfer.direction === 'upload' ? _('Uploading') : _('Downloading')} · ${Math.round(transfer.completedBytes / transfer.totalBytes * 100)}%`);
      } else {
        this._setButtonIcon(button, 'content-loading-symbolic');
        this._setHint(button, transfer.state === 'waiting-for-peer' ? _('Waiting for peer device') : _('Preparing transfer'));
      }
      return;
    }
    if (transfer?.state === 'failed' || transfer?.state === 'expired') {
      this._setButtonIcon(button, 'view-refresh-symbolic');
      this._setHint(button, transfer.errorMessage || _('Transfer failed; activate to retry'));
      return;
    }
    if (transfer?.state === 'completed') {
      this._setButtonIcon(button, 'emblem-ok-symbolic');
      this._setHint(button, transfer.direction === 'upload' ? _('Upload completed') : _('Original downloaded'));
      return;
    }
    if (!this._settings.get_boolean('sync-enabled')) {
      this._setButtonIcon(button, 'network-offline-symbolic');
      this._setHint(button, _('Synchronization is disabled'));
      return;
    }
    if (item.remote && item.availability !== 'ready') {
      const failed = item.availability === 'failed';
      this._setButtonIcon(button, failed ? 'view-refresh-symbolic' : 'folder-download-symbolic');
      this._setHint(button, failed ? _('Retry original download') : _('Download original'));
      return;
    }
    this._setButtonIcon(button, 'folder-remote-symbolic');
    this._setHint(button, item.remote ? _('Original is available locally') : _('Send to synchronization Service'));
  }

  async _activateSync(item) {
    const transfer = this._transfers.get(item.id);
    if (transfer && !TERMINAL_TRANSFER_STATES.has(transfer.state)) {
      await this._actions.cancelTransfer(transfer.transferId);
      return;
    }
    if (!this._settings.get_boolean('sync-enabled')) {
      this._runAndClose(() => this._actions.openPreferences());
      return;
    }
    if (item.remote && item.availability !== 'ready')
      await this._actions.materializeItem(item);
    else if (!item.remote)
      await this._actions.publish(item);
  }

  async _openTokenizer(item) {
    try {
      if ((item.primary?.size ?? 0) > TEXT_PROCESSING_LIMIT_BYTES)
        throw new Error(_('This text is too large for interactive processing'));
      await this._actions.materializeItem(item);
      const source = item.text;
      this._panelManager.show('tokenizer', {
        item,
        source,
        tokens: tokenizeText(source),
        selected: new Set(),
      });
    } catch (error) {
      this._actions.reportError(error);
    }
  }

  _renderTokenizer(state) {
    this._history.removeAll();
    this._syncButtons.clear();
    const header = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    header.add_child(this._iconButton(
      'go-previous-symbolic',
      _('Back to clipboard history'),
      () => this._closeTokenizer(),
      {showTooltip: false},
    ));
    header.add_child(new St.Label({
      text: _('Segment text'),
      style_class: 'clipboard-x-token-title',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    }));
    this._history.addMenuItem(header);

    const preview = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    preview.add_child(new St.Label({
      text: state.source.slice(0, 500),
      style_class: 'clipboard-x-token-source',
      style: `max-width: ${this._tokenContentWidth}px;`,
      x_expand: true,
    }));
    this._history.addMenuItem(preview);

    const tokenItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    const flow = new Clutter.FlowLayout({
      orientation: Clutter.Orientation.HORIZONTAL,
      column_spacing: 6,
      row_spacing: 6,
    });
    const tokenBox = new St.Widget({
      layout_manager: flow,
      style_class: 'clipboard-x-token-box',
      style: `width: ${this._tokenContentWidth}px; max-width: ${this._tokenContentWidth}px;`,
      x_expand: true,
    });
    for (const token of state.tokens) {
      const button = new St.Button({
        label: token.text,
        can_focus: true,
        toggle_mode: true,
        checked: state.selected.has(token.index),
        style_class: `button clipboard-x-token clipboard-x-token-${token.type}`,
      });
      button.connect('clicked', () => {
        if (button.checked)
          state.selected.add(token.index);
        else
          state.selected.delete(token.index);
        this._updateTokenResult();
      });
      this._attachHint(button, token.type === 'url'
        ? _('URL')
        : token.type === 'number'
          ? _('Number')
          : token.type === 'email' ? _('Email address') : _('Word'), {scope: 'panel'});
      tokenBox.add_child(button);
    }
    tokenItem.add_child(tokenBox);
    this._history.addMenuItem(tokenItem);

    const resultItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    this._tokenResult = new St.Label({
      text: _('Select one or more words'),
      style_class: 'clipboard-x-token-result',
      style: `max-width: ${this._tokenContentWidth}px;`,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    resultItem.add_child(this._tokenResult);
    this._tokenCopy = this._iconButton(
      'edit-copy-symbolic',
      _('Copy selected words'),
      () => this._copyTokens(),
      {tooltipScope: 'panel'},
    );
    this._tokenCopy.reactive = false;
    this._tokenCopy.opacity = 128;
    resultItem.add_child(this._tokenCopy);
    this._history.addMenuItem(resultItem);
    this._updateTokenResult();
  }

  _updateTokenResult() {
    const state = this._panelManager.state;
    if (!this._panelManager.is('tokenizer') || !state)
      return;
    const result = composeTokens(state.source, state.tokens, state.selected);
    this._tokenResult.text = result || _('Select one or more words');
    this._tokenCopy.reactive = Boolean(result);
    this._tokenCopy.opacity = result ? 255 : 128;
  }

  _copyTokens() {
    const state = this._panelManager.state;
    if (!this._panelManager.is('tokenizer') || !state)
      return;
    const result = composeTokens(state.source, state.tokens, state.selected);
    if (!result)
      return;
    this._actions.copyText(result);
    this.menu.close();
  }

  _updatePanelGeometry() {
    const panelWidth = this._settings.get_int('panel-width');
    const panelHeight = this._settings.get_int('panel-height');
    const searchWidth = Math.max(140, panelWidth - 140);
    this._entryPreviewWidth = Math.max(125, panelWidth - 175);
    this._tokenContentWidth = Math.max(260, panelWidth - 40);
    this.menu.actor.set_style(`width: ${panelWidth}px; max-width: ${panelWidth}px;`);
    this._search.set_style(`width: ${searchWidth}px; min-width: 0; max-width: ${searchWidth}px;`);
    this._scroll.set_style(`height: ${panelHeight}px; max-height: ${panelHeight}px;`);
    if (this._panelManager)
      this._refresh();
  }

  _updateThemeColor() {
    for (const styleClass of THEME_COLOR_CLASSES)
      this.menu.actor.remove_style_class_name(styleClass);
    const configured = `clipboard-x-accent-${this._settings.get_string('theme-color')}`;
    if (THEME_COLOR_CLASSES.includes(configured))
      this.menu.actor.add_style_class_name(configured);
  }

  _updatePanelStateRetention() {
    if (this._settings.get_boolean('preserve-panel-state')) {
      this._panelManager.preservePendingState();
      return;
    }
    if (!this.menu.isOpen && !this._panelManager.is('history')) {
      this._panelManager.close({preserve: false});
      if (!this.menu.actor.visible)
        this._panelManager.hidden();
    }
  }

  _closeTokenizer() {
    this._panelManager.show('history');
    this._focusSearch();
  }

  _focusSearch() {
    this._cancelFocusSearch();
    this._focusIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._focusIdleId = 0;
      if (this.menu.isOpen && this._panelManager.is('history'))
        global.stage.set_key_focus(this._search.clutter_text);
      return GLib.SOURCE_REMOVE;
    });
  }

  _cancelFocusSearch() {
    if (!this._focusIdleId)
      return;
    GLib.Source.remove(this._focusIdleId);
    this._focusIdleId = 0;
  }

  _displayIdentity(item) {
    const current = this._actions.ensureIdentity();
    if (!item.originDeviceId || item.originDeviceId === current.deviceId) {
      return {
        tag: current.deviceTag,
        iconKind: current.deviceIconKind,
      };
    }
    return {
      tag: item.originDeviceTag || _('Unknown device'),
      iconKind: item.originDeviceIconKind || 'other',
    };
  }

  _deviceIcon(iconKind, tag) {
    const icon = new St.Icon({
      icon_name: DEVICE_ICON_NAMES[iconKind] ?? DEVICE_ICON_NAMES.other,
      icon_size: 14,
      style_class: 'clipboard-x-device-icon',
      track_hover: true,
    });
    this._attachHint(icon, tag, {scope: 'panel'});
    return icon;
  }

  _iconButton(iconName, hintText, callback, options = {}) {
    const {showTooltip = true, iconSize = ICON_SIZE, tooltipScope = 'global'} = options;
    const button = new St.Button({
      can_focus: true,
      track_hover: true,
      style_class: 'clipboard-x-icon-button',
      accessible_name: hintText,
    });
    button._clipboardXIconSize = iconSize;
    this._setButtonIcon(button, iconName);
    button._clipboardXShowTooltip = showTooltip;
    button._clipboardXTooltipScope = tooltipScope;
    this._setHint(button, hintText);
    button.connect('clicked', () => Promise.resolve(callback()).catch(error => this._actions.reportError(error)));
    return button;
  }

  _setButtonIcon(button, iconName) {
    button.set_child(new St.Icon({
      icon_name: iconName,
      icon_size: button._clipboardXIconSize ?? ICON_SIZE,
    }));
  }

  _setHint(actor, text) {
    actor.accessible_name = text;
    if (actor._clipboardXShowTooltip)
      this._attachHint(actor, text, {scope: actor._clipboardXTooltipScope});
  }

  _attachHint(actor, text, {scope = 'global'} = {}) {
    actor._hintText = text;
    if (!actor._clipboardXHintConnected) {
      actor._clipboardXHintConnected = true;
      const signals = [];
      signals.push(actor.connect('notify::hover', () => {
        if (actor.hover)
          this._showTooltip(actor, false);
        else if (!actor.has_key_focus?.())
          this._hideTooltip(actor);
      }));
      signals.push(actor.connect('key-focus-in', () => this._showTooltip(actor, true)));
      signals.push(actor.connect('key-focus-out', () => {
        if (!actor.hover)
          this._hideTooltip(actor);
      }));
      this._hintConnections.set(actor, {scope, signals});
    }
    actor.accessible_name = text;
    if (this._tooltipSource === actor && this._tooltip.visible)
      this._tooltip.text = text;
  }

  _clearHints(scope = null) {
    this._hideTooltip();
    for (const [actor, connection] of this._hintConnections) {
      if (scope && connection.scope !== scope)
        continue;
      for (const signal of connection.signals) {
        try {
          actor.disconnect(signal);
        } catch (_error) {
          // The actor may already have been destroyed by a panel refresh.
        }
      }
      actor._clipboardXHintConnected = false;
      this._hintConnections.delete(actor);
    }
  }

  _showTooltip(actor, immediate) {
    this._cancelTooltipTimeout();
    const show = () => {
      this._tooltipTimeoutId = 0;
      if (!actor.mapped || (!actor.hover && !actor.has_key_focus?.()))
        return GLib.SOURCE_REMOVE;
      this._tooltipSource = actor;
      this._tooltip.text = actor._hintText;
      this._tooltip.show();
      Main.uiGroup.set_child_above_sibling(this._tooltip, null);
      const [actorX, actorY] = actor.get_transformed_position();
      const [actorWidth, actorHeight] = actor.get_transformed_size();
      const [, tooltipWidth] = this._tooltip.get_preferred_width(-1);
      const [, tooltipHeight] = this._tooltip.get_preferred_height(tooltipWidth);
      const x = Math.max(8, Math.min(
        global.stage.width - tooltipWidth - 8,
        actorX + (actorWidth - tooltipWidth) / 2,
      ));
      const below = actorY + actorHeight + 8;
      const y = below + tooltipHeight <= global.stage.height - 8
        ? below
        : Math.max(8, actorY - tooltipHeight - 8);
      this._tooltip.set_position(Math.round(x), Math.round(y));
      return GLib.SOURCE_REMOVE;
    };
    if (immediate) {
      show();
      return;
    }
    this._tooltipTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, show);
  }

  _hideTooltip(actor = null) {
    if (actor && this._tooltipSource && actor !== this._tooltipSource)
      return;
    this._cancelTooltipTimeout();
    this._tooltipSource = null;
    this._tooltip.hide();
  }

  _cancelTooltipTimeout() {
    if (!this._tooltipTimeoutId)
      return;
    GLib.Source.remove(this._tooltipTimeoutId);
    this._tooltipTimeoutId = 0;
  }

  _updatePrivateButton() {
    const paused = this._settings.get_boolean('private-mode');
    const text = paused ? _('Resume clipboard recording') : _('Pause clipboard recording');
    this._setButtonIcon(this._privateButton, 'security-high-symbolic');
    this._setHint(this._privateButton, text);
    this._privateButton.checked = paused;
    this._privateButton.remove_style_class_name(
      paused ? 'clipboard-x-private-inactive' : 'clipboard-x-private-active',
    );
    this._privateButton.add_style_class_name(
      paused ? 'clipboard-x-private-active' : 'clipboard-x-private-inactive',
    );
  }

  _runAndClose(callback) {
    this.menu.close();
    return callback();
  }

  _addState(text, iconName) {
    const state = new PopupMenu.PopupBaseMenuItem({reactive: false});
    state.add_child(new St.Icon({icon_name: iconName, icon_size: ICON_SIZE}));
    state.add_child(new St.Label({text, style_class: 'clipboard-x-empty'}));
    this._history.addMenuItem(state);
  }

  _activate(item) {
    this.menu.close();
    this._actions.activateItem(item).catch(error => this._actions.reportError(error));
  }

  destroy() {
    this._cancelFocusSearch();
    this._panelManager?.destroy();
    this._clearHints();
    if (this._changedSignal)
      this._controller.disconnect(this._changedSignal);
    for (const signal of [
      this._privateSignal,
      this._themeColorSignal,
      this._panelWidthSignal,
      this._panelHeightSignal,
      this._visibleItemLimitSignal,
      this._preservePanelStateSignal,
      this._syncEnabledSignal,
      this._deviceTagSignal,
      this._deviceIconSignal,
    ]) {
      if (signal)
        this._settings.disconnect(signal);
    }
    this._changedSignal = 0;
    this._privateSignal = 0;
    this._themeColorSignal = 0;
    this._panelWidthSignal = 0;
    this._panelHeightSignal = 0;
    this._visibleItemLimitSignal = 0;
    this._preservePanelStateSignal = 0;
    this._syncEnabledSignal = 0;
    this._deviceTagSignal = 0;
    this._deviceIconSignal = 0;
    if (this._menuVisibilitySignal)
      this.menu.actor.disconnect(this._menuVisibilitySignal);
    this._menuVisibilitySignal = 0;
    this._tooltip.destroy();
    super.destroy();
  }
});

function formatBytes(bytes) {
  if (bytes < 1024)
    return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
