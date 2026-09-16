import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as AnimationUtils from 'resource:///org/gnome/shell/misc/animationUtils.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {PanelFooter} from '../../controls/panel-footer.js';
import {SearchEntry} from '../../controls/search-entry.js';
import {normalize as normalizeActions, normalizeHidden} from '../../layouts/panel-actions.js';
import {FocusGrid} from '../../navigation/focus-grid.js';
import {matches as matchesShortcut} from '../../shortcut.js';
import {resolveIconColor} from '../../../sync/icon-color.js';
import {create as createItem} from './item.js';
import {SyncAction} from './sync-action.js';

const ICON_SIZE = 16;
const DEVICE_ICON_NAMES = Object.freeze({
  desktop: 'video-display-symbolic',
  laptop: 'computer-symbolic',
  phone: 'phone-symbolic',
  tablet: 'input-tablet-symbolic',
  server: 'network-server-symbolic',
  other: 'avatar-default-symbolic',
});

export class HistoryPanel {
  constructor({
    settings,
    controller,
    actions,
    tooltip,
    createIconButton,
    handlePanelKey,
    closeMenu,
    openTokenizer,
    openPhrases,
    requestRefresh,
    isActive,
    isMenuOpen,
  }) {
    this._settings = settings;
    this._controller = controller;
    this._actions = actions;
    this._tooltip = tooltip;
    this._createIconButton = createIconButton;
    this._handlePanelKey = handlePanelKey;
    this._closeMenu = closeMenu;
    this._openTokenizer = openTokenizer;
    this._openPhrases = openPhrases;
    this._requestRefresh = requestRefresh;
    this._isActive = isActive;
    this._isMenuOpen = isMenuOpen;
    this._query = '';
    this._accentColor = null;
    this._focusIdleId = 0;
    this._pendingViewState = null;
    this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    this._themeSignal = this._interfaceSettings.connect('changed::color-scheme', () => this._requestRefresh());

    this.item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    this.item.add_style_class_name('cbx-panel-host');
    this.actor = new St.BoxLayout({
      vertical: true,
      style_class: 'cbx-history-panel',
      x_expand: true,
    });

    this.searchItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    const searchToolbar = new St.BoxLayout({
      style_class: 'cbx-search-toolbar',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this.searchEntry = new SearchEntry({
      placeholder: _('Search clipboard history…'),
      onChanged: () => {
        this._query = this.searchEntry.get_text();
        if (this._isActive())
          this._requestRefresh();
      },
      onFocusChanged: () => this._updateSearchStyle(),
      onKeyPress: event => matchesShortcut(
        this._settings,
        'history-search-shortcut',
        event,
      ) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE,
    });
    searchToolbar.add_child(this.searchEntry);
    this.toolbar = new St.BoxLayout({
      style_class: 'cbx-toolbar',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this.screenshotButton = createIconButton(
      'camera-photo-symbolic',
      _('Screenshot'),
      () => this._runAndClose(() => actions.screenshot()),
      {iconSize: 14},
    );
    this.colorButton = createIconButton(
      'color-select-symbolic',
      _('Pick color'),
      () => this._runAndClose(() => actions.pickColor()),
      {iconSize: 14},
    );
    this.privateButton = createIconButton(
      'security-high-symbolic',
      _('Privacy mode'),
      () => settings.set_boolean('private-mode', !settings.get_boolean('private-mode')),
      {iconSize: 14, stateful: true},
    );
    this.phrasesButton = createIconButton(
      'starred-symbolic',
      _('Quick phrases'),
      openPhrases,
      {iconSize: 14},
    );
    searchToolbar.add_child(this.toolbar);
    this.searchItem.add_child(searchToolbar);

    this._section = new PopupMenu.PopupMenuSection();
    this.scroll = new St.ScrollView({
      overlay_scrollbars: true,
      style_class: 'cbx-history',
      x_expand: true,
      y_expand: true,
    });
    this.scroll.add_child(this._section.actor);
    this.scrollItem = new PopupMenu.PopupMenuSection();
    this.scrollItem.actor.x_expand = true;
    this.scrollItem.actor.y_expand = true;
    this.scrollItem.actor.add_child(this.scroll);

    this.footerItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    this.footerSpacer = new St.Widget({x_expand: true});
    this.footer = new PanelFooter({
      content: [this.footerSpacer],
    });
    this._sync = new SyncAction({
      settings,
      actions,
      tooltip,
      createIconButton,
      closeMenu,
    });
    this.syncButton = this._sync.statusButton;
    this.clearButton = createIconButton(
      'user-trash-symbolic',
      _('Clear unpinned history'),
      () => controller.clear(),
    );
    this.preferencesButton = createIconButton(
      'emblem-system-symbolic',
      _('Preferences'),
      () => this._runAndClose(() => actions.openPreferences()),
    );
    this._actionButtons = new Map([
      ['screenshot', this.screenshotButton],
      ['color-picker', this.colorButton],
      ['quick-phrases', this.phrasesButton],
      ['private-mode', this.privateButton],
      ['sync', this.syncButton],
      ['clear-history', this.clearButton],
      ['preferences', this.preferencesButton],
    ]);
    this._updateActions();
    this.footerItem.add_child(this.footer);
    this._updatePrivateButton();

    this.actor.add_child(this.searchItem);
    this.actor.add_child(this.scrollItem.actor);
    this.actor.add_child(this.footerItem);
    this.item.add_child(this.actor);

    this.focusGrid = new FocusGrid({
      ensureVisible: actor => {
        const row = actor._clipboardXHistoryRow;
        if (row?.mapped)
          AnimationUtils.ensureActorVisibleInScrollView(this.scroll, row);
      },
    });
    this._controllerSignal = controller.connect('changed', () => this._requestRefresh());
    this._settingsSignals = [
      settings.connect('changed::private-mode', () => this._updatePrivateButton()),
      settings.connect('changed::panel-visible-item-limit', () => this._requestRefresh()),
      settings.connect('changed::sync-enabled', () => this._requestRefresh()),
      settings.connect('changed::device-tag', () => this._requestRefresh()),
      settings.connect('changed::device-icon-kind', () => this._requestRefresh()),
      settings.connect('changed::device-icon-color-light', () => this._requestRefresh()),
      settings.connect('changed::device-icon-color-dark', () => this._requestRefresh()),
      settings.connect('changed::panel-toolbar-actions', () => this._updateActions()),
      settings.connect('changed::panel-footer-actions', () => this._updateActions()),
      settings.connect('changed::panel-hidden-actions', () => this._updateActions()),
    ];
  }

  set visible(value) {
    this.item.visible = value;
  }

  render() {
    this._section.removeAll();
    this._sync.clearButtons();
    const focusRows = [];
    if (this._controller.loading) {
      this._addState(_('Loading clipboard history…'), 'content-loading-symbolic');
      this._setFocusRows(focusRows);
      return;
    }
    if (this._controller.error && this._controller.items.length === 0) {
      this._addState(_('Clipboard history could not be loaded'), 'dialog-error-symbolic');
      this._setFocusRows(focusRows);
      return;
    }
    const limit = this._settings.get_int('panel-visible-item-limit');
    const items = this._controller.search(this._query, limit + 1);
    const currentDeviceId = this._actions.ensureIdentity().deviceId;
    this._multipleDevices = new Set(this._controller.items.map(item =>
      item.originDeviceId || currentDeviceId)).size > 1;
    if (items.length === 0) {
      const empty = new PopupMenu.PopupBaseMenuItem({reactive: false});
      empty.add_child(new St.Label({
        text: this._query ? _('No matching entries') : _('Clipboard history is empty'),
        style_class: 'cbx-empty',
      }));
      this._section.addMenuItem(empty);
      this._setFocusRows(focusRows);
      return;
    }
    for (const item of items.slice(0, limit)) {
      const row = this.entry(item);
      this._section.addMenuItem(row);
      focusRows.push(row._clipboardXFocusRow);
    }
    this._setFocusRows(focusRows);
  }

  entry(item) {
    const identity = this._multipleDevices ? this._displayIdentity(item) : null;
    return createItem({
      item,
      leading: identity ? this._deviceIcon(identity.iconKind, identity.tag, identity.iconColor) : null,
      accentColor: this._accentColor,
      syncButton: this._settings.get_boolean('sync-enabled') ? this._sync.button(item) : null,
      createIconButton: (...args) => this._createIconButton(...args),
      actions: {
        activate: () => this._activate(item),
        type: () => this._type(item),
        tokenize: () => this._openTokenizer(item),
        edit: () => this._runAndClose(() => this._actions.editItem(item)),
        togglePin: () => this._controller.toggleFavorite(item.id),
        remove: () => this._controller.remove(item.id),
        handleKey: event => this.handleEntryKey(item, event),
        handlePanelKey: event => this._handlePanelKey(event),
      },
    });
  }

  handleEntryKey(item, event) {
    if (matchesShortcut(this._settings, 'history-type-activation-shortcut', event)) {
      this._type(item);
      return Clutter.EVENT_STOP;
    }
    if (matchesShortcut(this._settings, 'history-paste-shortcut', event)) {
      this._paste(item);
    } else if (matchesShortcut(this._settings, 'history-pin-shortcut', event)) {
      this._controller.toggleFavorite(item.id);
    } else if (matchesShortcut(this._settings, 'history-delete-shortcut', event)) {
      this._controller.remove(item.id);
    } else if (matchesShortcut(this._settings, 'history-type-shortcut', event)) {
      this._type(item);
    } else {
      return Clutter.EVENT_PROPAGATE;
    }
    return Clutter.EVENT_STOP;
  }

  captureView() {
    if (this._pendingViewState)
      return this._pendingViewState;
    return {
      focusLocation: this.focusGrid.location(global.stage.get_key_focus()),
      scrollValue: this.scroll.get_vadjustment().value,
    };
  }

  restoreView(viewState) {
    if (!viewState)
      return;
    this._cancelFocus();
    this._pendingViewState = viewState;
    this._focusIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._focusIdleId = 0;
      this._pendingViewState = null;
      if (!this._isMenuOpen() || !this._isActive())
        return GLib.SOURCE_REMOVE;
      this.focusGrid.focusAt(viewState.focusLocation);
      const adjustment = this.scroll.get_vadjustment();
      adjustment.value = Math.max(
        adjustment.lower,
        Math.min(viewState.scrollValue, adjustment.upper - adjustment.page_size),
      );
      return GLib.SOURCE_REMOVE;
    });
  }

  focusSearch({immediate = false, reset = false} = {}) {
    this._cancelFocus();
    if (reset)
      this.resetSearch();
    if (immediate) {
      global.stage.set_key_focus(this.searchEntry.clutter_text);
      return;
    }
    this._focusIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._focusIdleId = 0;
      if (this._isMenuOpen() && this._isActive())
        global.stage.set_key_focus(this.searchEntry.clutter_text);
      return GLib.SOURCE_REMOVE;
    });
  }

  resetSearch() {
    this.searchEntry.set_text('');
  }

  leave() {
    this._cancelFocus();
    this._sync.clearButtons();
  }

  setGeometry({width, height}) {
    this._panelWidth = width;
    this._updateSearchWidth();
    this.actor.set_style(`height: ${height}px; max-height: ${height}px;`);
  }

  setAccent(color) {
    this._accentColor = color;
    this._updateSearchStyle();
    this._updatePrivateButton();
  }

  setSyncStatus(status, capabilities = null) {
    this._sync.setStatus(status, capabilities);
  }

  setTransfer(transfer) {
    this._sync.setTransfer(transfer);
  }

  destroy() {
    this.leave();
    this._interfaceSettings.disconnect(this._themeSignal);
    if (this._controllerSignal)
      this._controller.disconnect(this._controllerSignal);
    this._controllerSignal = 0;
    for (const signal of this._settingsSignals) {
      if (signal)
        this._settings.disconnect(signal);
    }
    this._settingsSignals = [];
    this.focusGrid.clear();
    this._sync.destroy();
  }

  _updateActions() {
    const layout = normalizeActions(
      this._settings.get_strv('panel-toolbar-actions'),
      this._settings.get_strv('panel-footer-actions'),
    );
    const hidden = new Set(normalizeHidden(this._settings.get_strv('panel-hidden-actions')));
    for (const button of this._actionButtons.values()) {
      const parent = button.get_parent();
      if (parent)
        parent.remove_child(button);
    }
    for (const action of layout.toolbar) {
      if (!hidden.has(action))
        this.toolbar.add_child(this._actionButtons.get(action));
    }
    for (const action of layout.footer) {
      if (!hidden.has(action))
        this.footer.addContent(this._actionButtons.get(action));
    }
    this._updateSearchWidth();
    if (this.focusGrid && this._isActive())
      this._requestRefresh();
  }

  _updateSearchWidth() {
    if (!this._panelWidth)
      return;
    const toolbarWidth = this.toolbar.get_children().length * 36;
    this._searchWidth = Math.max(140, this._panelWidth - 32 - toolbarWidth);
    this._updateSearchStyle();
  }

  _setFocusRows(rows) {
    this.focusGrid.setRows([
      [this.searchEntry.clutter_text, ...this.toolbar.get_children()],
      ...rows,
      this.footer.contentActors.filter(actor => actor !== this.footerSpacer),
    ]);
  }

  _updateSearchStyle() {
    if (!this._searchWidth)
      return;
    const styles = [
      `width: ${this._searchWidth}px`,
      'min-width: 0',
      `max-width: ${this._searchWidth}px`,
    ];
    if (this._accentColor && this.searchEntry.clutter_text.has_key_focus())
      styles.push(`border-color: ${this._accentColor}`);
    this.searchEntry.set_style(`${styles.join('; ')};`);
  }

  _updatePrivateButton() {
    const paused = this._settings.get_boolean('private-mode');
    this._setButtonIcon(this.privateButton, 'security-high-symbolic');
    this._setHint(this.privateButton, _('Privacy mode'));
    this.privateButton.selected = paused;
    this.privateButton.remove_style_class_name(
      paused ? 'cbx-private-inactive' : 'cbx-private-active',
    );
    this.privateButton.add_style_class_name(
      paused ? 'cbx-private-active' : 'cbx-private-inactive',
    );
    this.privateButton.set_style(paused && this._accentColor
      ? `color: ${this._accentColor};`
      : '');
  }

  _displayIdentity(item) {
    const current = this._actions.ensureIdentity();
    if (!item.originDeviceId || item.originDeviceId === current.deviceId) {
      return {tag: current.deviceTag, iconKind: current.deviceIconKind, iconColor: current.deviceIconColor};
    }
    return {
      tag: item.originDeviceTag || _('Unknown device'),
      iconKind: item.originDeviceIconKind || 'other',
      iconColor: item.originDeviceIconColor,
    };
  }

  _deviceIcon(iconKind, tag, iconColor) {
    const darkTheme = this._interfaceSettings.get_string('color-scheme') === 'prefer-dark';
    const icon = new St.Icon({
      icon_name: DEVICE_ICON_NAMES[iconKind] ?? DEVICE_ICON_NAMES.other,
      icon_size: 14,
      style_class: 'cbx-device-icon',
      track_hover: true,
    });
    icon.set_style(`color: ${resolveIconColor(iconColor, darkTheme)};`);
    this._tooltip.attach(icon, tag, {scope: 'panel'});
    return icon;
  }

  _setButtonIcon(button, iconName) {
    if (button.setIcon) {
      button.setIcon(iconName);
      return;
    }
    button.set_child(new St.Icon({
      icon_name: iconName,
      icon_size: button._clipboardXIconSize ?? ICON_SIZE,
    }));
  }

  _setHint(actor, text) {
    if (actor.setHint)
      actor.setHint(text);
    else {
      actor.accessible_name = text;
      actor._hintText = text;
    }
    if (actor._clipboardXShowTooltip)
      this._tooltip.attach(actor, text, {scope: actor._clipboardXTooltipScope});
  }

  _activate(item) {
    this._closeMenu();
    this._actions.activateItem(item).catch(error => this._actions.reportError(error));
  }

  _paste(item) {
    this._closeMenu();
    this._actions.pasteItem(item).catch(error => this._actions.reportError(error));
  }

  _type(item) {
    if (!item.isText) {
      this._activate(item);
      return;
    }
    this._closeMenu();
    this._actions.typeItem(item).catch(error => this._actions.reportError(error));
  }

  _runAndClose(callback) {
    this._closeMenu();
    return callback();
  }

  _addState(text, iconName) {
    const state = new PopupMenu.PopupBaseMenuItem({reactive: false});
    state.add_child(new St.Icon({icon_name: iconName, icon_size: ICON_SIZE}));
    state.add_child(new St.Label({text, style_class: 'cbx-empty'}));
    this._section.addMenuItem(state);
  }

  _cancelFocus() {
    if (this._focusIdleId)
      GLib.Source.remove(this._focusIdleId);
    this._focusIdleId = 0;
    this._pendingViewState = null;
  }
}
