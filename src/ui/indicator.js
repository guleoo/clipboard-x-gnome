import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as AnimationUtils from 'resource:///org/gnome/shell/misc/animationUtils.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {PanelManager} from './panel-manager.js';
import {FocusGrid} from './focus-grid.js';
import {ContentItem} from './controls/content-item.js';
import {IconButton} from './controls/icon-button.js';
import {PanelFooter} from './controls/panel-footer.js';
import {PanelHeader} from './controls/panel-header.js';
import {SearchEntry} from './controls/search-entry.js';
import {Tooltip} from './controls/tooltip.js';
import {normalize as normalizePanelActions} from './panel-actions.js';
import {QuickPhrasesPanel} from './panels/quick-phrases.js';
import {matches as matchesShortcut} from './shortcut.js';
import {composeTokens, tokenizeText} from '../clipboard/tokenizer/processors.js';

const TEXT_PROCESSING_LIMIT_BYTES = 1024 * 1024;
const ICON_SIZE = 16;
const OPTICAL_BASELINE_OFFSET = -1;
const THEME_COLOR_CLASSES = Object.freeze([
  'blue', 'teal', 'green', 'orange', 'pink', 'slate',
].map(color => `clipboard-x-accent-${color}`));
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const DEVICE_ICON_NAMES = Object.freeze({
  desktop: 'video-display-symbolic',
  laptop: 'computer-symbolic',
  phone: 'phone-symbolic',
  tablet: 'input-tablet-symbolic',
  server: 'network-server-symbolic',
  other: 'avatar-default-symbolic',
});
const TERMINAL_TRANSFER_STATES = new Set(['completed', 'failed', 'cancelled', 'expired']);
const TOKEN_SELECTION_SHORTCUTS = Object.freeze([
  ['tokenizer-select-previous-shortcut', Clutter.KEY_Left],
  ['tokenizer-select-next-shortcut', Clutter.KEY_Right],
  ['tokenizer-select-above-shortcut', Clutter.KEY_Up],
  ['tokenizer-select-below-shortcut', Clutter.KEY_Down],
]);
const NAVIGATION_KEYS = new Map([
  [Clutter.KEY_Left, 'left'],
  [Clutter.KEY_Right, 'right'],
  [Clutter.KEY_Up, 'up'],
  [Clutter.KEY_Down, 'down'],
  [Clutter.KEY_KP_Left, 'left'],
  [Clutter.KEY_KP_Right, 'right'],
  [Clutter.KEY_KP_Up, 'up'],
  [Clutter.KEY_KP_Down, 'down'],
]);
const NAVIGATION_MODIFIER_MASK = Clutter.ModifierType.SHIFT_MASK
  | Clutter.ModifierType.CONTROL_MASK
  | Clutter.ModifierType.MOD1_MASK
  | Clutter.ModifierType.MOD4_MASK
  | Clutter.ModifierType.SUPER_MASK
  | Clutter.ModifierType.HYPER_MASK
  | Clutter.ModifierType.META_MASK;

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
    this.add_style_class_name('clipboard-x-panel-button');
    this._settings = settings;
    this._controller = controller;
    this._actions = actions;
    this._query = '';
    this._transfers = new Map();
    this._syncButtons = new Map();
    this._syncStatusText = _('Sync disabled');
    this._focusIdleId = 0;
    this._pendingHistoryViewState = null;
    this._tokenSelectionDrag = null;
    this._tokenDragCaptureId = 0;
    this._tokenButtons = [];
    this._stateHoverTransfer = false;
    this._tooltip = new Tooltip();

    this.add_child(new St.Icon({
      icon_name: 'edit-paste-symbolic',
      style_class: 'system-status-icon',
    }));
    this.menu.actor.add_style_class_name('clipboard-x-menu');
    this._buildMenu();
    this._applyTextVerticalOffset();
    this._historyFocusGrid = new FocusGrid({
      ensureVisible: actor => {
        const row = actor._clipboardXHistoryRow;
        if (row?.mapped)
          AnimationUtils.ensureActorVisibleInScrollView(this._scroll, row);
      },
    });
    this._tokenizerFocusGrid = new FocusGrid({
      ensureVisible: actor => {
        if (actor._clipboardXToken)
          AnimationUtils.ensureActorVisibleInScrollView(this._tokenScroll, actor);
      },
    });
    this._panelManager = new PanelManager({
      defaultPanel: 'history',
      clearPanelTooltips: () => this._tooltip.clear('panel'),
      hideTooltip: () => this._tooltip.hide(),
    });
    this._panelManager.register('history', {
      focusGrid: this._historyFocusGrid,
      captureView: () => this._captureHistoryView(),
      restoreView: viewState => this._restoreHistoryView(viewState),
      enter: () => this._showPanelChrome('history'),
      render: () => {
        this._renderHistory();
        this._applyTextVerticalOffset();
      },
    });
    this._panelManager.register('tokenizer', {
      focusGrid: this._tokenizerFocusGrid,
      enter: () => this._showPanelChrome('tokenizer'),
      leave: () => this._endTokenSelectionDrag(),
      render: state => {
        this._renderTokenizer(state);
        this._applyTextVerticalOffset();
      },
    });
    this._panelManager.register('phrases', {
      focusGrid: this._quickPhrases.focusGrid,
      enter: () => this._showPanelChrome('phrases'),
      render: () => {
        this._quickPhrases.render();
        this._applyTextVerticalOffset();
      },
    });
    this._updatePanelGeometry();
    this._updateThemeColor();

    this._changedSignal = controller.connect('changed', () => this._refresh());
    this._privateSignal = settings.connect('changed::private-mode', () => this._updatePrivateButton());
    this._themeColorSignal = settings.connect('changed::theme-color', () => this._updateThemeColor());
    this._panelWidthSignal = settings.connect('changed::panel-width', () => this._updatePanelGeometry());
    this._panelHeightSignal = settings.connect('changed::panel-height', () => this._updatePanelGeometry());
    this._textVerticalOffsetSignal = settings.connect(
      'changed::panel-text-vertical-offset',
      () => this._applyTextVerticalOffset(),
    );
    this._visibleItemLimitSignal = settings.connect('changed::panel-visible-item-limit', () => this._refresh());
    this._preservePanelStateSignal = settings.connect(
      'changed::preserve-panel-state',
      () => this._updatePanelStateRetention(),
    );
    this._tokenSourcePreviewSignal = settings.connect(
      'changed::tokenizer-show-source-preview',
      () => this._updateTokenSourceVisibility(),
    );
    this._syncEnabledSignal = settings.connect('changed::sync-enabled', () => this._refresh());
    this._deviceTagSignal = settings.connect('changed::device-tag', () => this._refresh());
    this._deviceIconSignal = settings.connect('changed::device-icon-kind', () => this._refresh());
    this._toolbarActionsSignal = settings.connect(
      'changed::panel-toolbar-actions',
      () => this._updatePanelActions(),
    );
    this._footerActionsSignal = settings.connect(
      'changed::panel-footer-actions',
      () => this._updatePanelActions(),
    );
    this._savedPhrasesSignal = settings.connect('changed::saved-phrases', () => {
      if (this._panelManager.is('phrases'))
        this._panelManager.refresh();
    });
    this._phraseLimitSignal = settings.connect('changed::saved-phrase-limit', () => {
      this._quickPhrases.trim();
    });
    this._menuVisibilitySignal = this.menu.actor.connect('notify::visible', () => {
      if (!this.menu.actor.visible)
        this._panelManager.hidden();
    });
    this._menuKeyPressSignal = this.menu.actor.connect('key-press-event', (_actor, event) =>
      this._handleMenuKey(event));
    this.menu.connect('open-state-changed', (_menu, open) => {
      if (open) {
        this._actions.rememberInputTarget();
        this._panelManager.open();
        this._actions.ensureIdentity();
        if (this._panelManager.is('history')) {
          this._search.set_text('');
          this._focusSearch();
        } else if (this._panelManager.is('tokenizer'))
          this._focusFirstToken();
        else if (this._panelManager.is('phrases'))
          this._focusPhrasePanel();
      } else {
        this._cancelPendingFocus();
        this._tooltip.hide();
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
    this._search = new SearchEntry({
      placeholder: _('Search clipboard history…'),
      placeholderOffset: OPTICAL_BASELINE_OFFSET,
      onChanged: () => {
        this._query = this._search.get_text();
        if (this._panelManager?.is('history'))
          this._refresh();
      },
      onFocusChanged: () => this._updateSearchStyle(),
      onKeyPress: event => {
        if (matchesShortcut(this._settings, 'history-search-shortcut', event))
          return Clutter.EVENT_STOP;
        return Clutter.EVENT_PROPAGATE;
      },
    });
    searchToolbar.add_child(this._search);
    const toolbar = new St.BoxLayout({
      style_class: 'clipboard-x-toolbar',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._toolbar = toolbar;
    this._screenshotButton = this._iconButton(
      'camera-photo-symbolic',
      _('Screenshot'),
      () => this._runAndClose(() => this._actions.screenshot()),
      {iconSize: 14},
    );
    toolbar.add_child(this._screenshotButton);
    this._colorButton = this._iconButton(
      'color-select-symbolic',
      _('Pick color'),
      () => this._runAndClose(() => this._actions.pickColor()),
      {iconSize: 14},
    );
    toolbar.add_child(this._colorButton);
    this._privateButton = this._iconButton(
      'security-high-symbolic',
      _('Privacy mode'),
      () => {
        this._settings.set_boolean('private-mode', !this._settings.get_boolean('private-mode'));
      },
      {iconSize: 14, stateful: true},
    );
    this._phrasesToolButton = this._iconButton(
      'starred-symbolic',
      _('Quick phrases'),
      () => this._openPhrases(),
      {iconSize: 14},
    );
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
    this._historyScrollItem = scrollItem;
    scrollItem.actor.add_child(this._scroll);
    this.menu.addMenuItem(scrollItem);

    const tokenPanelItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    this._tokenPanelItem = tokenPanelItem;
    const tokenPanel = new St.BoxLayout({
      vertical: true,
      style_class: 'clipboard-x-token-panel',
      x_expand: true,
    });
    this._tokenPanel = tokenPanel;
    this._tokenBack = this._iconButton(
      'go-previous-symbolic',
      _('Back to clipboard history'),
      () => this._closeTokenizer(),
      {showTooltip: false},
    );
    this._tokenHeader = new PanelHeader({
      title: _('Segment text'),
      backButton: this._tokenBack,
      styleClass: 'clipboard-x-token-header',
      titleStyleClass: 'clipboard-x-token-title',
      titleOffset: OPTICAL_BASELINE_OFFSET,
    });
    this._tokenTitle = this._tokenHeader.titleLabel;
    tokenPanel.add_child(this._tokenHeader);
    this._tokenSource = new St.Label({
      style_class: 'clipboard-x-token-source',
      x_expand: true,
      visible: this._settings.get_boolean('tokenizer-show-source-preview'),
    });
    this._tokenSource.clutter_text.single_line_mode = true;
    tokenPanel.add_child(this._tokenSource);

    this._tokenSection = new PopupMenu.PopupMenuSection();
    this._tokenScroll = new St.ScrollView({
      overlay_scrollbars: true,
      style_class: 'clipboard-x-token-scroll',
      x_expand: true,
      y_expand: true,
    });
    this._tokenScroll.add_child(this._tokenSection.actor);
    tokenPanel.add_child(this._tokenScroll);

    this._tokenFooter = new PanelFooter();
    this._tokenResult = new St.Label({
      text: _('Select one or more words'),
      style_class: 'clipboard-x-token-result',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._tokenResult.clutter_text.single_line_mode = true;
    this._tokenFooter.addContent(this._tokenResult);
    this._tokenCopy = this._iconButton(
      'edit-copy-symbolic',
      _('Copy selected words'),
      () => this._copyTokens(),
      {tooltipScope: 'panel'},
    );
    this._tokenCopy.reactive = false;
    this._tokenCopy.opacity = 128;
    this._tokenFooter.addContent(this._tokenCopy);
    tokenPanel.add_child(this._tokenFooter);
    tokenPanelItem.add_child(tokenPanel);
    this.menu.addMenuItem(tokenPanelItem);

    this._quickPhrases = new QuickPhrasesPanel({
      settings: this._settings,
      createIconButton: (...args) => this._iconButton(...args),
      handleKey: event => this._handleMenuKey(event),
      onBack: () => this._closePhrases(),
      onCopy: phrase => this._copyPhrase(phrase),
      refresh: () => this._panelManager.refresh(),
    });
    this.menu.addMenuItem(this._quickPhrases.item);

    this._footerSeparator = new PopupMenu.PopupSeparatorMenuItem();
    this.menu.addMenuItem(this._footerSeparator);

    const footerItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    this._footerItem = footerItem;
    const footer = new St.BoxLayout({style_class: 'clipboard-x-footer', x_expand: true});
    this._footer = footer;
    this._footerSpacer = new St.Widget({x_expand: true});
    footer.add_child(this._footerSpacer);
    this._syncToolButton = this._iconButton(
      'network-offline-symbolic',
      _('Synchronization settings'),
      () => this._runAndClose(() => this._actions.openPreferences()),
    );
    this._clearButton = this._iconButton(
      'user-trash-symbolic', _('Clear unpinned history'), () => this._controller.clear());
    this._preferencesButton = this._iconButton(
      'emblem-system-symbolic', _('Preferences'), () => this._runAndClose(() => this._actions.openPreferences()));
    this._panelActionButtons = new Map([
      ['screenshot', this._screenshotButton],
      ['color-picker', this._colorButton],
      ['quick-phrases', this._phrasesToolButton],
      ['private-mode', this._privateButton],
      ['sync', this._syncToolButton],
      ['clear-history', this._clearButton],
      ['preferences', this._preferencesButton],
    ]);
    this._updatePanelActions();
    footerItem.add_child(footer);
    this.menu.addMenuItem(footerItem);
    this._updatePrivateButton();
  }

  _showPanelChrome(panel) {
    const history = panel === 'history';
    this._searchItem.visible = history;
    this._historyScrollItem.actor.visible = history;
    this._footerSeparator.visible = history;
    this._footerItem.visible = history;
    this._tokenPanelItem.visible = panel === 'tokenizer';
    this._quickPhrases.item.visible = panel === 'phrases';
  }

  _updatePanelActions() {
    if (!this._panelActionButtons)
      return;
    const layout = normalizePanelActions(
      this._settings.get_strv('panel-toolbar-actions'),
      this._settings.get_strv('panel-footer-actions'),
    );
    for (const button of this._panelActionButtons.values()) {
      const parent = button.get_parent();
      if (parent)
        parent.remove_child(button);
    }
    for (const action of layout.toolbar)
      this._toolbar.add_child(this._panelActionButtons.get(action));
    for (const action of layout.footer)
      this._footer.add_child(this._panelActionButtons.get(action));
    if (this._panelManager?.is('history'))
      this._panelManager.refresh();
  }

  _applyTextVerticalOffset() {
    const offset = this._settings.get_int('panel-text-vertical-offset');
    const apply = actor => {
      const actorOffset = actor._clipboardXTextBaselineOffset ?? 0;
      if (actor instanceof St.Entry)
        actor.clutter_text.translation_y = offset;
      else if (actor instanceof St.Label)
        actor.translation_y = offset + actorOffset;
      for (const child of actor.get_children?.() ?? [])
        apply(child);
    };
    apply(this.menu.actor);
    apply(this._tooltip.actor);
  }

  _captureHistoryView() {
    if (this._pendingHistoryViewState)
      return this._pendingHistoryViewState;
    return {
      focusLocation: this._historyFocusGrid.location(global.stage.get_key_focus()),
      scrollValue: this._scroll.get_vadjustment().value,
    };
  }

  _restoreHistoryView(viewState) {
    if (!viewState)
      return;
    this._cancelPendingFocus();
    this._pendingHistoryViewState = viewState;
    this._focusIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._focusIdleId = 0;
      this._pendingHistoryViewState = null;
      if (!this.menu.isOpen || !this._panelManager.is('history'))
        return GLib.SOURCE_REMOVE;
      this._historyFocusGrid.focusAt(viewState.focusLocation);
      const adjustment = this._scroll.get_vadjustment();
      adjustment.value = Math.max(
        adjustment.lower,
        Math.min(viewState.scrollValue, adjustment.upper - adjustment.page_size),
      );
      return GLib.SOURCE_REMOVE;
    });
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
    const focusRows = [];
    if (this._controller.loading) {
      this._addState(_('Loading clipboard history…'), 'content-loading-symbolic');
      this._setHistoryFocusRows(focusRows);
      return;
    }
    if (this._controller.error && this._controller.items.length === 0) {
      this._addState(_('Clipboard history could not be loaded'), 'dialog-error-symbolic');
      this._setHistoryFocusRows(focusRows);
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
      this._setHistoryFocusRows(focusRows);
      return;
    }

    for (const item of items.slice(0, visibleItemLimit)) {
      const row = this._entry(item);
      this._history.addMenuItem(row);
      focusRows.push(row._clipboardXFocusRow);
    }
    if (items.length > visibleItemLimit) {
      this._history.addMenuItem(new PopupMenu.PopupMenuItem(
        _('More entries are available; refine the search to see others'),
        {reactive: false},
      ));
    }
    this._setHistoryFocusRows(focusRows);
  }

  _setHistoryFocusRows(rows) {
    this._historyFocusGrid.setRows([
      [this._search.clutter_text, ...this._toolbar.get_children()],
      ...rows,
      this._footer.get_children().filter(actor => actor !== this._footerSpacer),
    ]);
  }

  _entry(item) {
    const row = new ContentItem();
    if (this._multipleDevices) {
      const identity = this._displayIdentity(item);
      row.addLeading(this._deviceIcon(identity.iconKind, identity.tag));
    }

    const content = new St.Button({
      can_focus: true,
      track_hover: true,
      clip_to_allocation: true,
      style_class: 'clipboard-x-entry-content',
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
    });
    if (item.isText) {
      const title = item.preview?.text?.replaceAll('\n', ' ') || _('Text');
      const preview = new St.Label({
        text: title.slice(0, 240),
        style_class: 'clipboard-x-entry-preview',
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.CENTER,
      });
      preview.clutter_text.single_line_mode = true;
      preview.clutter_text.ellipsize = Pango.EllipsizeMode.END;
      content.set_child(preview);
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
    content._clipboardXTypeOnClick = false;
    content.connect('button-press-event', (_button, event) => {
      content._clipboardXTypeOnClick = event.get_button() === Clutter.BUTTON_PRIMARY
        && Boolean(event.get_state() & Clutter.ModifierType.CONTROL_MASK);
      return Clutter.EVENT_PROPAGATE;
    });
    content.connect('key-press-event', (_button, event) => {
      content._clipboardXTypeOnClick = false;
      const result = this._handleEntryKey(item, event);
      return result === Clutter.EVENT_PROPAGATE ? this._handleMenuKey(event) : result;
    });
    content.connect('clicked', () => {
      const type = content._clipboardXTypeOnClick;
      content._clipboardXTypeOnClick = false;
      if (type)
        this._type(item);
      else
        this._activate(item);
    });
    content.accessible_name = item.remote && item.availability !== 'ready'
      ? _('Download original and copy')
      : _('Copy original');
    row.setContent(content);

    if (item.isText) {
      row.addAction(this._iconButton(
        'format-text-plaintext-symbolic', _('Segment text'), () => this._openTokenizer(item), {showTooltip: false}));
    } else {
      row.addAction(this._iconButton(
        'document-edit-symbolic', _('Edit image'), () => this._actions.editItem(item), {showTooltip: false}));
    }
    const pinButton = this._iconButton(
      'view-pin-symbolic',
      item.favorite ? _('Unpin') : _('Pin'),
      () => this._controller.toggleFavorite(item.id),
      {showTooltip: false, stateful: true},
    );
    pinButton.toggle_mode = true;
    pinButton.selected = item.favorite;
    if (item.favorite)
      pinButton.add_style_class_name('clipboard-x-pinned');
    if (item.favorite && this._customAccentColor) {
      pinButton.set_style(`color: ${this._customAccentColor};`);
    }
    row.addAction(pinButton);
    if (this._settings.get_boolean('sync-enabled'))
      row.addAction(this._syncButton(item));
    row.addAction(this._iconButton(
      'user-trash-symbolic', _('Delete from local history'), () => this._controller.remove(item.id), {showTooltip: false}));
    row._clipboardXFocusRow = row.focusActors;
    for (const actor of row._clipboardXFocusRow)
      actor._clipboardXHistoryRow = row;
    row.connect('key-press-event', (_row, event) => this._handleEntryKey(item, event));
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
        keyboardSelection: null,
      });
      this._focusFirstToken();
    } catch (error) {
      this._actions.reportError(error);
    }
  }

  _renderTokenizer(state) {
    this._endTokenSelectionDrag();
    this._tokenButtons = [];
    this._tokenSection.removeAll();
    this._syncButtons.clear();
    this._tokenSource.text = state.source.slice(0, 500);

    const tokenItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    const tokenBox = new St.BoxLayout({
      vertical: true,
      style_class: 'clipboard-x-token-box',
      style: `width: ${this._tokenContentWidth}px; max-width: ${this._tokenContentWidth}px;`,
      x_expand: true,
    });
    this._tokenBox = tokenBox;
    tokenItem.add_child(tokenBox);
    this._tokenSection.addMenuItem(tokenItem);
    const maximumRowWidth = this._tokenContentWidth - 2;
    const spacing = 6;
    let tokenRow = null;
    let tokenFocusRow = null;
    const tokenFocusRows = [];
    let rowWidth = 0;
    const startRow = () => {
      tokenRow = new St.BoxLayout({
        style_class: 'clipboard-x-token-row',
        x_align: Clutter.ActorAlign.START,
      });
      tokenBox.add_child(tokenRow);
      tokenFocusRow = [];
      tokenFocusRows.push(tokenFocusRow);
      rowWidth = 0;
    };
    for (const token of state.tokens) {
      const button = new St.Button({
        label: token.text,
        can_focus: true,
        track_hover: true,
        checked: state.selected.has(token.index),
        style_class: `button clipboard-x-token clipboard-x-token-${token.type}`,
      });
      button._clipboardXMaximumWidth = maximumRowWidth;
      button._clipboardXToken = token;
      button._clipboardXTokenState = state;
      this._tokenButtons.push(button);
      button.connect('key-press-event', (_actor, event) => {
        const result = this._handleTokenKey(button, token, state, event);
        return result === Clutter.EVENT_PROPAGATE ? this._handleMenuKey(event) : result;
      });
      button.connect('key-focus-in', () =>
        AnimationUtils.ensureActorVisibleInScrollView(this._tokenScroll, button));
      button.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === Clutter.BUTTON_PRIMARY)
          this._beginTokenSelectionDrag(button, token, state);
        return Clutter.EVENT_PROPAGATE;
      });
      button.connect('motion-event', (_actor, event) => {
        const [x, y] = event.get_coords();
        this._applyTokenSelectionAt(x, y);
        return Clutter.EVENT_PROPAGATE;
      });
      button.connect('button-release-event', (_actor, event) => {
        if (event.get_button() === Clutter.BUTTON_PRIMARY)
          this._endTokenSelectionDrag(true);
        return Clutter.EVENT_PROPAGATE;
      });
      button.connect('notify::hover', () => {
        if (button.hover)
          this._applyTokenSelectionDrag(button);
      });
      button.connect('clicked', () => {
        if (button._clipboardXSuppressClick) {
          button._clipboardXSuppressClick = false;
          return;
        }
        state.keyboardSelection = null;
        this._setTokenSelected(button, token, state, !state.selected.has(token.index));
      });
      this._updateTokenButtonStyle(button, token);
      if (!tokenRow)
        startRow();
      tokenRow.add_child(button);
      const [, naturalWidth] = button.get_preferred_width(-1);
      const buttonWidth = Math.min(naturalWidth, maximumRowWidth);
      if (rowWidth > 0 && rowWidth + spacing + buttonWidth > maximumRowWidth) {
        tokenRow.remove_child(button);
        startRow();
        tokenRow.add_child(button);
      }
      tokenFocusRow.push(button);
      rowWidth += (rowWidth > 0 ? spacing : 0) + buttonWidth;
    }
    if (state.tokens.length === 0)
      tokenBox.add_child(new St.Label({text: _('No words found'), style_class: 'clipboard-x-empty'}));
    this._tokenizerFocusGrid.setRows([
      [this._tokenBack],
      ...tokenFocusRows,
      [this._tokenCopy],
    ]);
    this._updateTokenResult();
  }

  _openPhrases() {
    this._panelManager.show('phrases');
    this._focusPhrasePanel();
  }

  _closePhrases() {
    this._panelManager.show('history');
  }

  _copyPhrase(phrase) {
    if (this._settings.get_boolean('phrase-close-after-copy'))
      return this._runAndClose(() => this._actions.copyText(phrase));
    return Promise.resolve(this._actions.copyText(phrase))
      .catch(error => this._actions.reportError(error));
  }

  _handleTokenKey(button, token, state, event) {
    for (const [setting, direction] of TOKEN_SELECTION_SHORTCUTS) {
      if (matchesShortcut(this._settings, setting, event)) {
        this._extendTokenSelection(button, state, direction);
        return Clutter.EVENT_STOP;
      }
    }
    if (matchesShortcut(this._settings, 'tokenizer-copy-shortcut', event)) {
      this._runTokenAction('copyText', token);
      return Clutter.EVENT_STOP;
    }
    if (matchesShortcut(this._settings, 'tokenizer-paste-shortcut', event)) {
      this._runTokenAction('pasteText', token);
      return Clutter.EVENT_STOP;
    }
    if (matchesShortcut(this._settings, 'tokenizer-type-shortcut', event)) {
      this._runTokenAction('typeText', token);
      return Clutter.EVENT_STOP;
    }
    state.keyboardSelection = null;
    return Clutter.EVENT_PROPAGATE;
  }

  _extendTokenSelection(button, state, key) {
    const position = this._tokenButtons.indexOf(button);
    const target = this._tokenTarget(button, key);
    const targetPosition = this._tokenButtons.indexOf(target);
    if (position < 0 || targetPosition < 0)
      return;
    if (!state.keyboardSelection) {
      state.keyboardSelection = {
        anchorPosition: position,
        baseSelected: new Set(state.selected),
        targetSelected: !state.selected.has(button._clipboardXToken.index),
      };
    }
    const {anchorPosition, baseSelected, targetSelected} = state.keyboardSelection;
    state.selected.clear();
    for (const index of baseSelected)
      state.selected.add(index);
    const start = Math.min(anchorPosition, targetPosition);
    const end = Math.max(anchorPosition, targetPosition);
    for (let index = start; index <= end; index++) {
      const tokenIndex = this._tokenButtons[index]._clipboardXToken.index;
      if (targetSelected)
        state.selected.add(tokenIndex);
      else
        state.selected.delete(tokenIndex);
    }
    for (const candidate of this._tokenButtons) {
      const candidateToken = candidate._clipboardXToken;
      candidate.checked = state.selected.has(candidateToken.index);
      this._updateTokenButtonStyle(candidate, candidateToken);
    }
    target.grab_key_focus();
    this._updateTokenResult();
  }

  _tokenTarget(button, key) {
    const position = this._tokenButtons.indexOf(button);
    if (key === Clutter.KEY_Left)
      return this._tokenButtons[position - 1] ?? null;
    if (key === Clutter.KEY_Right)
      return this._tokenButtons[position + 1] ?? null;

    const row = button.get_parent();
    const rows = this._tokenBox.get_children();
    const rowPosition = rows.indexOf(row);
    const targetRow = rows[rowPosition + (key === Clutter.KEY_Up ? -1 : 1)];
    if (!targetRow)
      return null;
    const candidates = targetRow.get_children();
    if (candidates.length === 0)
      return null;
    const [buttonX] = button.get_transformed_position();
    const [buttonWidth] = button.get_transformed_size();
    const center = buttonX + buttonWidth / 2;
    return candidates.reduce((closest, candidate) => {
      const [candidateX] = candidate.get_transformed_position();
      const [candidateWidth] = candidate.get_transformed_size();
      const distance = Math.abs(candidateX + candidateWidth / 2 - center);
      return distance < closest.distance ? {button: candidate, distance} : closest;
    }, {button: candidates[0], distance: Infinity}).button;
  }

  _beginTokenSelectionDrag(button, token, state) {
    this._endTokenSelectionDrag();
    state.keyboardSelection = null;
    const selected = !state.selected.has(token.index);
    button._clipboardXSuppressClick = true;
    this._tokenSelectionDrag = {
      state,
      selected,
      initialButton: button,
      lastIndex: token.index,
      visited: new Set(),
    };
    this._applyTokenSelectionDrag(button);
    this._tokenDragCaptureId = global.stage.connect('captured-event', (_stage, event) => {
      const type = event.type();
      if (type === Clutter.EventType.MOTION) {
        const [x, y] = event.get_coords();
        this._applyTokenSelectionAt(x, y);
      } else if (type === Clutter.EventType.BUTTON_RELEASE
          && event.get_button() === Clutter.BUTTON_PRIMARY) {
        this._endTokenSelectionDrag(true);
      }
      return Clutter.EVENT_PROPAGATE;
    });
  }

  _applyTokenSelectionDrag(button) {
    const drag = this._tokenSelectionDrag;
    const token = button?._clipboardXToken;
    if (!drag || !token || button._clipboardXTokenState !== drag.state)
      return;
    const start = Math.min(drag.lastIndex, token.index);
    const end = Math.max(drag.lastIndex, token.index);
    let changed = false;
    for (const candidate of this._tokenButtons) {
      const candidateToken = candidate._clipboardXToken;
      if (candidate._clipboardXTokenState !== drag.state
          || candidateToken.index < start || candidateToken.index > end
          || drag.visited.has(candidateToken.index))
        continue;
      drag.visited.add(candidateToken.index);
      this._setTokenSelected(candidate, candidateToken, drag.state, drag.selected, false);
      changed = true;
    }
    drag.lastIndex = token.index;
    if (changed)
      this._updateTokenResult();
  }

  _applyTokenSelectionAt(x, y) {
    if (!this._tokenSelectionDrag)
      return;
    for (const button of this._tokenButtons) {
      if (!button.mapped)
        continue;
      const [buttonX, buttonY] = button.get_transformed_position();
      const [buttonWidth, buttonHeight] = button.get_transformed_size();
      if (x >= buttonX && x <= buttonX + buttonWidth
          && y >= buttonY && y <= buttonY + buttonHeight) {
        this._applyTokenSelectionDrag(button);
        return;
      }
    }
  }

  _setTokenSelected(button, token, state, selected, updateResult = true) {
    if (selected)
      state.selected.add(token.index);
    else
      state.selected.delete(token.index);
    button.checked = selected;
    this._updateTokenButtonStyle(button, token);
    if (updateResult)
      this._updateTokenResult();
  }

  _endTokenSelectionDrag(deferClickReset = false) {
    if (this._tokenDragCaptureId) {
      global.stage.disconnect(this._tokenDragCaptureId);
      this._tokenDragCaptureId = 0;
    }
    const button = this._tokenSelectionDrag?.initialButton;
    this._tokenSelectionDrag = null;
    if (!button)
      return;
    if (!deferClickReset) {
      button._clipboardXSuppressClick = false;
      return;
    }
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      button._clipboardXSuppressClick = false;
      return GLib.SOURCE_REMOVE;
    });
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
    this._runTokenAction('copyText');
  }

  _runTokenAction(action, fallbackToken = null) {
    const state = this._panelManager.state;
    if (!this._panelManager.is('tokenizer') || !state)
      return;
    const result = composeTokens(state.source, state.tokens, state.selected)
      || fallbackToken?.text
      || '';
    if (!result)
      return;
    this.menu.close();
    Promise.resolve(this._actions[action](result))
      .catch(error => this._actions.reportError(error));
  }

  _updatePanelGeometry() {
    const panelWidth = this._settings.get_int('panel-width');
    const panelHeight = this._settings.get_int('panel-height');
    const searchWidth = Math.max(140, panelWidth - 140);
    this._searchWidth = searchWidth;
    this._tokenContentWidth = Math.max(260, panelWidth - 40);
    this.menu.actor.set_width(panelWidth);
    this.menu.actor.set_style(`width: ${panelWidth}px; max-width: ${panelWidth}px;`);
    this._updateSearchStyle();
    this._scroll.set_style(`height: ${panelHeight}px; max-height: ${panelHeight}px;`);
    this._tokenPanel.set_style(`height: ${panelHeight}px; max-height: ${panelHeight}px;`);
    this._quickPhrases.setHeight(panelHeight);
    this._tokenSource.set_style(`max-width: ${this._tokenContentWidth}px;`);
    this._tokenResult.set_style(`max-width: ${Math.max(200, this._tokenContentWidth - 32)}px;`);
    if (this._panelManager)
      this._refresh();
  }

  _updateThemeColor() {
    for (const styleClass of THEME_COLOR_CLASSES)
      this.menu.actor.remove_style_class_name(styleClass);
    const configured = `clipboard-x-accent-${this._settings.get_string('theme-color')}`;
    if (THEME_COLOR_CLASSES.includes(configured))
      this.menu.actor.add_style_class_name(configured);
    const selected = this._settings.get_string('theme-color');
    this._customAccentColor = HEX_COLOR_PATTERN.test(selected) ? selected.toLowerCase() : null;
    this._updateSearchStyle();
    this._updatePrivateButton();
    this._refresh();
  }

  _updateSearchStyle() {
    if (!this._search || !this._searchWidth)
      return;
    const styles = [
      `width: ${this._searchWidth}px`,
      'min-width: 0',
      `max-width: ${this._searchWidth}px`,
    ];
    if (this._customAccentColor && this._search.clutter_text.has_key_focus())
      styles.push(`border-color: ${this._customAccentColor}`);
    this._search.set_style(`${styles.join('; ')};`);
  }

  _updateTokenButtonStyle(button, token) {
    const styles = [`max-width: ${button._clipboardXMaximumWidth}px`];
    if (button.checked) {
      if (this._customAccentColor)
        styles.push(`background-color: ${this._customAccentColor}`, 'color: white');
    } else if (token.type === 'url' && this._customAccentColor) {
      styles.push(`color: ${this._customAccentColor}`);
    }
    button.set_style(`${styles.join('; ')};`);
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
  }

  _focusSearch() {
    this._cancelPendingFocus();
    this._focusIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._focusIdleId = 0;
      if (this.menu.isOpen && this._panelManager.is('history'))
        global.stage.set_key_focus(this._search.clutter_text);
      return GLib.SOURCE_REMOVE;
    });
  }

  _focusFirstToken() {
    this._cancelPendingFocus();
    this._focusIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._focusIdleId = 0;
      if (!this.menu.isOpen || !this._panelManager.is('tokenizer'))
        return GLib.SOURCE_REMOVE;
      const first = this._tokenButtons[0];
      if (first) {
        first.grab_key_focus();
        AnimationUtils.ensureActorVisibleInScrollView(this._tokenScroll, first);
      }
      return GLib.SOURCE_REMOVE;
    });
  }

  _focusPhrasePanel() {
    this._cancelPendingFocus();
    this._focusIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._focusIdleId = 0;
      if (!this.menu.isOpen || !this._panelManager.is('phrases'))
        return GLib.SOURCE_REMOVE;
      this._quickPhrases.focus();
      return GLib.SOURCE_REMOVE;
    });
  }

  _updateTokenSourceVisibility() {
    if (this._tokenSource)
      this._tokenSource.visible = this._settings.get_boolean('tokenizer-show-source-preview');
  }

  _cancelPendingFocus() {
    if (this._focusIdleId)
      GLib.Source.remove(this._focusIdleId);
    this._focusIdleId = 0;
    this._pendingHistoryViewState = null;
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
    this._tooltip.attach(icon, tag, {scope: 'panel'});
    return icon;
  }

  _iconButton(iconName, hintText, callback, options = {}) {
    const {
      showTooltip = true,
      iconSize = ICON_SIZE,
      tooltipScope = 'global',
      stateful = false,
    } = options;
    const button = new IconButton({
      iconName,
      label: hintText,
      iconSize,
      selectable: stateful,
      onKeyPress: event => this._handleMenuKey(event),
      onError: error => this._actions.reportError(error),
      onActivate: () => {
        if (stateful)
          this._stateHoverTransfer = true;
        try {
          return callback();
        } finally {
          this._stateHoverTransfer = false;
        }
      },
    });
    if (stateful && this._stateHoverTransfer)
      this._skipStateHoverTransition(button);
    button._clipboardXShowTooltip = showTooltip;
    button._clipboardXTooltipScope = tooltipScope;
    this._setHint(button, hintText);
    return button;
  }

  _skipStateHoverTransition(button) {
    button.add_style_class_name('clipboard-x-state-hover-immediate');
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      try {
        button.remove_style_class_name('clipboard-x-state-hover-immediate');
      } catch (_error) {
        // A history refresh may have destroyed this button in the same frame.
      }
      return GLib.SOURCE_REMOVE;
    });
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

  _handleMenuKey(event) {
    if (!this.menu.isOpen)
      return Clutter.EVENT_PROPAGATE;
    if (this._panelManager.is('history')
        && matchesShortcut(this._settings, 'history-search-shortcut', event)) {
      this._cancelPendingFocus();
      global.stage.set_key_focus(this._search.clutter_text);
      return Clutter.EVENT_STOP;
    }
    const direction = NAVIGATION_KEYS.get(event.get_key_symbol());
    const modifiers = event.get_state() & NAVIGATION_MODIFIER_MASK;
    if (!direction || modifiers !== 0)
      return Clutter.EVENT_PROPAGATE;
    const focus = global.stage.get_key_focus();
    const focusGrid = this._panelManager.focusGrid;
    if (!focusGrid?.contains(focus))
      return Clutter.EVENT_PROPAGATE;
    if (focusGrid.move(focus, direction))
      return Clutter.EVENT_STOP;
    return this._settings.get_boolean('panel-confine-focus')
      ? Clutter.EVENT_STOP
      : Clutter.EVENT_PROPAGATE;
  }

  _updatePrivateButton() {
    const paused = this._settings.get_boolean('private-mode');
    const text = _('Privacy mode');
    this._setButtonIcon(this._privateButton, 'security-high-symbolic');
    this._setHint(this._privateButton, text);
    this._privateButton.selected = paused;
    this._privateButton.remove_style_class_name(
      paused ? 'clipboard-x-private-inactive' : 'clipboard-x-private-active',
    );
    this._privateButton.add_style_class_name(
      paused ? 'clipboard-x-private-active' : 'clipboard-x-private-inactive',
    );
    this._privateButton.set_style(paused && this._customAccentColor
      ? `color: ${this._customAccentColor};`
      : '');
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

  _paste(item) {
    this.menu.close();
    this._actions.pasteItem(item).catch(error => this._actions.reportError(error));
  }

  _type(item) {
    if (!item.isText) {
      this._activate(item);
      return;
    }
    this.menu.close();
    this._actions.typeItem(item).catch(error => this._actions.reportError(error));
  }

  _handleEntryKey(item, event) {
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

  destroy() {
    this._cancelPendingFocus();
    this._endTokenSelectionDrag();
    this._panelManager?.destroy();
    this._tooltip.clear();
    if (this._changedSignal)
      this._controller.disconnect(this._changedSignal);
    for (const signal of [
      this._privateSignal,
      this._themeColorSignal,
      this._panelWidthSignal,
      this._panelHeightSignal,
      this._textVerticalOffsetSignal,
      this._visibleItemLimitSignal,
      this._preservePanelStateSignal,
      this._tokenSourcePreviewSignal,
      this._syncEnabledSignal,
      this._deviceTagSignal,
      this._deviceIconSignal,
      this._toolbarActionsSignal,
      this._footerActionsSignal,
      this._savedPhrasesSignal,
      this._phraseLimitSignal,
    ]) {
      if (signal)
        this._settings.disconnect(signal);
    }
    this._changedSignal = 0;
    this._privateSignal = 0;
    this._themeColorSignal = 0;
    this._panelWidthSignal = 0;
    this._panelHeightSignal = 0;
    this._textVerticalOffsetSignal = 0;
    this._visibleItemLimitSignal = 0;
    this._preservePanelStateSignal = 0;
    this._tokenSourcePreviewSignal = 0;
    this._syncEnabledSignal = 0;
    this._deviceTagSignal = 0;
    this._deviceIconSignal = 0;
    this._toolbarActionsSignal = 0;
    this._footerActionsSignal = 0;
    this._savedPhrasesSignal = 0;
    this._phraseLimitSignal = 0;
    if (this._menuVisibilitySignal)
      this.menu.actor.disconnect(this._menuVisibilitySignal);
    this._menuVisibilitySignal = 0;
    if (this._menuKeyPressSignal)
      this.menu.actor.disconnect(this._menuKeyPressSignal);
    this._menuKeyPressSignal = 0;
    this._tooltip.destroy();
    super.destroy();
  }
});

function formatBytes(bytes) {
  if (bytes < 1024)
    return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
