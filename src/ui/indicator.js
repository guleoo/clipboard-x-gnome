import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {PanelManager} from './panel-manager.js';
import {IconButton} from './controls/icon-button.js';
import {Tooltip} from './controls/tooltip.js';
import {HistoryPanel} from './panels/history/panel.js';
import {QuickPhrasesPanel} from './panels/quick-phrases/panel.js';
import {TokenizerPanel} from './panels/tokenizer/panel.js';
import {matches as matchesShortcut} from './shortcut.js';

const TEXT_PROCESSING_LIMIT_BYTES = 1024 * 1024;
const ICON_SIZE = 16;
const THEME_COLOR_CLASSES = Object.freeze([
  'blue', 'teal', 'green', 'orange', 'pink', 'slate',
].map(color => `clipboard-x-accent-${color}`));
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
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

export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
  _init(settings, controller, actions) {
    super._init(0.0, 'Clipboard X');
    this.add_style_class_name('clipboard-x-panel-button');
    this._settings = settings;
    this._controller = controller;
    this._actions = actions;
    this._stateHoverTransfer = false;
    this._tooltip = new Tooltip();

    this.add_child(new St.Icon({
      icon_name: 'edit-paste-symbolic',
      style_class: 'system-status-icon',
    }));
    this.menu.actor.add_style_class_name('clipboard-x-menu');
    this._buildMenu();
    this._applyTextVerticalOffset();
    this._panelManager = new PanelManager({
      defaultPanel: 'history',
      clearPanelTooltips: () => this._tooltip.clear('panel'),
      hideTooltip: () => this._tooltip.hide(),
      onGeometry: geometry => this._setMenuGeometry(geometry),
    });
    this._panelManager.register('history', {
      focusGrid: this._historyPanel.focusGrid,
      captureView: () => this._historyPanel.captureView(),
      restoreView: viewState => this._historyPanel.restoreView(viewState),
      enter: () => this._showPanelChrome('history'),
      leave: () => this._historyPanel.leave(),
      setGeometry: geometry => this._historyPanel.setGeometry(geometry),
      render: () => {
        this._historyPanel.render();
        this._applyTextVerticalOffset();
      },
    });
    this._panelManager.register('tokenizer', {
      focusGrid: this._tokenizer.focusGrid,
      enter: () => {
        this._showPanelChrome('tokenizer');
      },
      leave: () => this._tokenizer.leave(),
      setGeometry: geometry => this._tokenizer.setGeometry(geometry),
      render: state => {
        this._tokenizer.render(state);
        this._applyTextVerticalOffset();
      },
    });
    this._panelManager.register('phrases', {
      focusGrid: this._quickPhrases.focusGrid,
      enter: () => this._showPanelChrome('phrases'),
      leave: () => this._quickPhrases.leave(),
      setGeometry: geometry => this._quickPhrases.setGeometry(geometry),
      render: () => {
        this._quickPhrases.render();
        this._applyTextVerticalOffset();
      },
    });
    this._updatePanelGeometry();
    this._updateThemeColor();

    this._themeColorSignal = settings.connect('changed::theme-color', () => this._updateThemeColor());
    this._panelWidthSignal = settings.connect('changed::panel-width', () => this._updatePanelGeometry());
    this._panelHeightSignal = settings.connect('changed::panel-height', () => this._updatePanelGeometry());
    this._textVerticalOffsetSignal = settings.connect(
      'changed::panel-text-vertical-offset',
      () => this._applyTextVerticalOffset(),
    );
    this._preservePanelStateSignal = settings.connect(
      'changed::preserve-panel-state',
      () => this._updatePanelStateRetention(),
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
        if (this._panelManager.is('history'))
          this._historyPanel.focusSearch({reset: true});
        else if (this._panelManager.is('tokenizer'))
          this._tokenizer.focusStart();
        else if (this._panelManager.is('phrases'))
          this._quickPhrases.focusStart();
      } else {
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
    this._historyPanel = new HistoryPanel({
      settings: this._settings,
      controller: this._controller,
      actions: this._actions,
      tooltip: this._tooltip,
      createIconButton: (...args) => this._iconButton(...args),
      handlePanelKey: event => this._handleMenuKey(event),
      closeMenu: () => this.menu.close(),
      openTokenizer: item => this._openTokenizer(item),
      openPhrases: () => this._openPhrases(),
      requestRefresh: () => this._refresh(),
      isActive: () => this._panelManager?.is('history') ?? false,
      isMenuOpen: () => this.menu.isOpen,
    });
    this.menu.addMenuItem(this._historyPanel.item);

    this._tokenizer = new TokenizerPanel({
      settings: this._settings,
      createIconButton: (...args) => this._iconButton(...args),
      handlePanelKey: event => this._handleMenuKey(event),
      onBack: () => this._closeTokenizer(),
      runAction: (action, text) => {
        this.menu.close();
        Promise.resolve(this._actions[action](text))
          .catch(error => this._actions.reportError(error));
      },
    });
    this.menu.addMenuItem(this._tokenizer.item);

    this._quickPhrases = new QuickPhrasesPanel({
      settings: this._settings,
      createIconButton: (...args) => this._iconButton(...args),
      handleKey: event => this._handleMenuKey(event),
      onBack: () => this._closePhrases(),
      onCopy: phrase => this._copyPhrase(phrase),
      refresh: () => this._panelManager.refresh(),
    });
    this.menu.addMenuItem(this._quickPhrases.item);
  }

  _showPanelChrome(panel) {
    const history = panel === 'history';
    this._historyPanel.visible = history;
    this._tokenizer.item.visible = panel === 'tokenizer';
    this._quickPhrases.item.visible = panel === 'phrases';
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

  setSyncStatus(status, capabilities = null) {
    this._historyPanel.setSyncStatus(status, capabilities);
  }

  setTransfer(transfer) {
    this._historyPanel.setTransfer(transfer);
  }

  _refresh() {
    this._panelManager?.refresh();
  }

  async _openTokenizer(item) {
    try {
      if ((item.primary?.size ?? 0) > TEXT_PROCESSING_LIMIT_BYTES)
        throw new Error(_('This text is too large for interactive processing'));
      await this._actions.materializeItem(item);
      const source = item.text;
      this._panelManager.show('tokenizer', this._tokenizer.createState(item, source));
      this._tokenizer.focusStart();
    } catch (error) {
      this._actions.reportError(error);
    }
  }

  _openPhrases() {
    this._panelManager.show('phrases');
    this._quickPhrases.focusStart();
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

  _updatePanelGeometry() {
    const panelWidth = this._settings.get_int('panel-width');
    const panelHeight = this._settings.get_int('panel-height');
    this._panelManager.setGeometry({width: panelWidth, height: panelHeight});
    if (this._panelManager)
      this._refresh();
  }

  _setMenuGeometry({width}) {
    this.menu.actor.set_width(width);
    this.menu.actor.set_style(`width: ${width}px; max-width: ${width}px;`);
  }

  _updateThemeColor() {
    for (const styleClass of THEME_COLOR_CLASSES)
      this.menu.actor.remove_style_class_name(styleClass);
    const configured = `clipboard-x-accent-${this._settings.get_string('theme-color')}`;
    if (THEME_COLOR_CLASSES.includes(configured))
      this.menu.actor.add_style_class_name(configured);
    const selected = this._settings.get_string('theme-color');
    this._customAccentColor = HEX_COLOR_PATTERN.test(selected) ? selected.toLowerCase() : null;
    this._historyPanel.setAccent(this._customAccentColor);
    this._tokenizer.setAccent(this._customAccentColor);
    this._refresh();
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
      this._historyPanel.focusSearch({immediate: true});
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

  _runAndClose(callback) {
    this.menu.close();
    return callback();
  }

  destroy() {
    this._panelManager?.destroy();
    this._historyPanel.destroy();
    this._tokenizer.destroy();
    this._tooltip.clear();
    for (const signal of [
      this._themeColorSignal,
      this._panelWidthSignal,
      this._panelHeightSignal,
      this._textVerticalOffsetSignal,
      this._preservePanelStateSignal,
      this._savedPhrasesSignal,
      this._phraseLimitSignal,
    ]) {
      if (signal)
        this._settings.disconnect(signal);
    }
    this._themeColorSignal = 0;
    this._panelWidthSignal = 0;
    this._panelHeightSignal = 0;
    this._textVerticalOffsetSignal = 0;
    this._preservePanelStateSignal = 0;
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
