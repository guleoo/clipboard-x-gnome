import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as AnimationUtils from 'resource:///org/gnome/shell/misc/animationUtils.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {composeTokens} from '../../../clipboard/tokenizer/processors.js';
import {FocusAnchor} from '../../controls/focus-anchor.js';
import {PanelFooter} from '../../controls/panel-footer.js';
import {PanelHeader} from '../../controls/panel-header.js';
import {FocusGrid} from '../../navigation/focus-grid.js';
import {matches as matchesShortcut} from '../../shortcut.js';

const OPTICAL_BASELINE_OFFSET = -1;
const SELECTION_SHORTCUTS = Object.freeze([
  ['tokenizer-select-previous-shortcut', Clutter.KEY_Left],
  ['tokenizer-select-next-shortcut', Clutter.KEY_Right],
  ['tokenizer-select-above-shortcut', Clutter.KEY_Up],
  ['tokenizer-select-below-shortcut', Clutter.KEY_Down],
]);

export class TokenizerPanel {
  constructor({settings, createIconButton, handlePanelKey, onBack, runAction, tokenize}) {
    this._settings = settings;
    this._handlePanelKey = handlePanelKey;
    this._run = runAction;
    this._tokenize = tokenize;
    this._buttons = [];
    this._state = null;
    this._contentWidth = 260;
    this._accentColor = null;
    this._selectionDrag = null;
    this._dragSourceId = 0;

    this.item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    this.item.add_style_class_name('cbx-panel-host');
    this.actor = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'cbx-token-panel',
      x_expand: true,
    });
    this.actor.connect('notify::mapped', () => {
      if (!this.actor.mapped)
        this.endSelectionDrag();
    });
    this.focusAnchor = new FocusAnchor({
      onNavigate: () => this._focusFirstToken(),
      onKeyPress: event => this._handlePanelKey(event),
    });
    this.actor.add_child(this.focusAnchor);
    this.backButton = createIconButton(
      'go-previous-symbolic',
      _('Back to clipboard history'),
      onBack,
      {showTooltip: false},
    );
    this.header = new PanelHeader({
      title: _('Word Selection'),
      backButton: this.backButton,
      titleOffset: OPTICAL_BASELINE_OFFSET,
    });
    this.titleLabel = this.header.titleLabel;
    this.actor.add_child(this.header);

    this.sourceLabel = new St.Label({
      style_class: 'cbx-token-source',
      x_expand: true,
      visible: settings.get_boolean('tokenizer-show-source-preview'),
    });
    this.sourceLabel.clutter_text.single_line_mode = true;
    this.actor.add_child(this.sourceLabel);

    this._section = new PopupMenu.PopupMenuSection();
    this.scroll = new St.ScrollView({
      overlay_scrollbars: true,
      style_class: 'cbx-token-scroll',
      x_expand: true,
      y_expand: true,
    });
    this.scroll.add_child(this._section.actor);
    this.actor.add_child(this.scroll);

    this.footer = new PanelFooter();
    this.resultLabel = new St.Label({
      text: _('Select one or more words'),
      style_class: 'cbx-token-result',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this.resultLabel.clutter_text.single_line_mode = true;
    this.footer.addContent(this.resultLabel);
    this.copyButton = createIconButton(
      'edit-copy-symbolic',
      _('Copy selected words'),
      () => this.run('copyText'),
      {tooltipScope: 'panel'},
    );
    this.copyButton.reactive = false;
    this.copyButton.opacity = 128;
    this.footer.addContent(this.copyButton);
    this.actor.add_child(this.footer);
    this.item.add_child(this.actor);

    this.focusGrid = new FocusGrid({
      ensureVisible: actor => {
        if (actor._clipboardXGnomeToken)
          AnimationUtils.ensureActorVisibleInScrollView(this.scroll, actor);
      },
    });
    this._sourcePreviewSignal = settings.connect(
      'changed::tokenizer-show-source-preview',
      () => this.updateSourceVisibility(),
    );
  }

  get state() {
    return this._state;
  }

  get buttons() {
    return this._buttons;
  }

  async createState(item, source) {
    return {
      item,
      source,
      tokens: await this._tokenize(source),
      selected: new Set(),
      keyboardSelection: null,
    };
  }

  render(state) {
    this.endSelectionDrag();
    this._state = state;
    this._buttons = [];
    this._section.removeAll();
    this.sourceLabel.text = state.source.slice(0, 500);

    const tokenItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    this.tokenBox = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'cbx-token-box',
      style: `width: ${this._contentWidth}px; max-width: ${this._contentWidth}px;`,
      x_expand: true,
    });
    tokenItem.add_child(this.tokenBox);
    this._section.addMenuItem(tokenItem);
    const maximumRowWidth = this._contentWidth - 2;
    const spacing = 6;
    let tokenRow = null;
    let tokenFocusRow = null;
    const tokenFocusRows = [];
    let rowWidth = 0;
    const startRow = () => {
      tokenRow = new St.BoxLayout({
        style_class: 'cbx-token-row',
        x_align: Clutter.ActorAlign.START,
      });
      this.tokenBox.add_child(tokenRow);
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
        style_class: `button cbx-token cbx-token-${token.type}`,
      });
      button._clipboardXGnomeMaximumWidth = maximumRowWidth;
      button._clipboardXGnomeToken = token;
      button._clipboardXGnomeTokenState = state;
      this._buttons.push(button);
      button.connect('key-press-event', (_actor, event) => {
        const result = this.handleKey(button, event);
        return result === Clutter.EVENT_PROPAGATE ? this._handlePanelKey(event) : result;
      });
      button.connect('key-focus-in', () =>
        AnimationUtils.ensureActorVisibleInScrollView(this.scroll, button));
      button.connect('notify::pressed', () => {
        const [, , modifiers] = global.get_pointer();
        if (button.pressed && !this._selectionDrag
            && (modifiers & Clutter.ModifierType.BUTTON1_MASK))
          this.beginSelectionDrag(button);
      });
      button.connect('clicked', () => {
        // Pointer presses already changed selection. Do not toggle it again
        // on release, even if the held-selection timer ended first.
        if (Clutter.get_current_event()?.type() === Clutter.EventType.BUTTON_RELEASE) {
          const [x, y] = global.get_pointer();
          this.applySelectionAt(x, y);
          this.endSelectionDrag();
          return;
        }
        state.keyboardSelection = null;
        this.setSelected(button, !state.selected.has(token.index));
      });
      this._updateButtonStyle(button);
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
    if (state.tokens.length === 0) {
      this.tokenBox.add_child(new St.Label({
        text: _('No words found'),
        style_class: 'cbx-empty',
      }));
    }
    this.focusGrid.setRows([
      [this.backButton],
      ...tokenFocusRows,
      [this.copyButton],
    ]);
    this.updateResult();
  }

  leave() {
    this.focusAnchor.cancel();
    this.endSelectionDrag();
  }

  focusStart() {
    this.focusAnchor.focus();
  }

  _focusFirstToken() {
    for (const button of this._buttons) {
      const focused = this.focusGrid.focusAt(this.focusGrid.location(button));
      if (focused)
        return focused;
    }
    return null;
  }

  setGeometry({width, height}) {
    this._contentWidth = Math.max(260, width - 40);
    this.actor.set_style(`height: ${height}px; max-height: ${height}px;`);
    this.sourceLabel.set_style(`max-width: ${this._contentWidth}px;`);
    this.resultLabel.set_style(`max-width: ${Math.max(200, this._contentWidth - 32)}px;`);
  }

  setAccent(color) {
    this._accentColor = color;
    for (const button of this._buttons)
      this._updateButtonStyle(button);
  }

  updateSourceVisibility() {
    this.sourceLabel.visible = this._settings.get_boolean('tokenizer-show-source-preview');
  }

  handleKey(button, event) {
    const token = button._clipboardXGnomeToken;
    const state = button._clipboardXGnomeTokenState;
    for (const [setting, direction] of SELECTION_SHORTCUTS) {
      if (matchesShortcut(this._settings, setting, event)) {
        this._extendSelection(button, state, direction);
        return Clutter.EVENT_STOP;
      }
    }
    if (matchesShortcut(this._settings, 'tokenizer-copy-shortcut', event)) {
      this.run('copyText', token);
      return Clutter.EVENT_STOP;
    }
    if (matchesShortcut(this._settings, 'tokenizer-paste-shortcut', event)) {
      this.run('pasteText', token);
      return Clutter.EVENT_STOP;
    }
    if (matchesShortcut(this._settings, 'tokenizer-type-shortcut', event)) {
      this.run('typeText', token);
      return Clutter.EVENT_STOP;
    }
    state.keyboardSelection = null;
    return Clutter.EVENT_PROPAGATE;
  }

  setSelected(button, selected, updateResult = true) {
    const token = button._clipboardXGnomeToken;
    const state = button._clipboardXGnomeTokenState;
    if (selected)
      state.selected.add(token.index);
    else
      state.selected.delete(token.index);
    button.checked = selected;
    this._updateButtonStyle(button);
    if (updateResult)
      this.updateResult();
  }

  beginSelectionDrag(button) {
    this.endSelectionDrag();
    const token = button._clipboardXGnomeToken;
    const state = button._clipboardXGnomeTokenState;
    state.keyboardSelection = null;
    this._selectionDrag = {
      state,
      selected: !state.selected.has(token.index),
      anchorIndex: token.index,
      currentIndex: null,
      baseSelected: new Set(state.selected),
    };
    this._applySelectionDrag(button);
    let lastX = null;
    let lastY = null;
    // St.Button's click gesture can consume release/motion events before actor
    // signals. Sample only during a held selection, including releases outside
    // the panel; hovering alone must never extend a selection.
    this._dragSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
      const [x, y, modifiers] = global.get_pointer();
      if (!(modifiers & Clutter.ModifierType.BUTTON1_MASK)) {
        this.applySelectionAt(x, y);
        this._dragSourceId = 0;
        this.endSelectionDrag();
        return GLib.SOURCE_REMOVE;
      }
      if (x !== lastX || y !== lastY) {
        this.applySelectionAt(x, y);
        lastX = x;
        lastY = y;
      }
      return GLib.SOURCE_CONTINUE;
    });
  }

  applySelectionAt(x, y) {
    if (!this._selectionDrag)
      return;
    for (const button of this._buttons) {
      if (!button.mapped)
        continue;
      const [buttonX, buttonY] = button.get_transformed_position();
      const [buttonWidth, buttonHeight] = button.get_transformed_size();
      if (x >= buttonX && x <= buttonX + buttonWidth
          && y >= buttonY && y <= buttonY + buttonHeight) {
        this._applySelectionDrag(button);
        return;
      }
    }
  }

  endSelectionDrag() {
    if (this._dragSourceId) {
      GLib.Source.remove(this._dragSourceId);
      this._dragSourceId = 0;
    }
    this._selectionDrag = null;
  }

  updateResult() {
    if (!this._state)
      return;
    const result = composeTokens(
      this._state.source,
      this._state.tokens,
      this._state.selected,
    );
    this.resultLabel.text = result || _('Select one or more words');
    this.copyButton.reactive = Boolean(result);
    this.copyButton.opacity = result ? 255 : 128;
  }

  run(action, fallbackToken = null) {
    if (!this._state)
      return;
    const result = composeTokens(
      this._state.source,
      this._state.tokens,
      this._state.selected,
    ) || fallbackToken?.text || '';
    if (result)
      this._run(action, result);
  }

  destroy() {
    this.leave();
    if (this._sourcePreviewSignal)
      this._settings.disconnect(this._sourcePreviewSignal);
    this._sourcePreviewSignal = 0;
    this.focusGrid.clear();
    this._state = null;
    this._buttons = [];
  }

  _extendSelection(button, state, key) {
    const position = this._buttons.indexOf(button);
    const target = this._target(button, key);
    const targetPosition = this._buttons.indexOf(target);
    if (position < 0 || targetPosition < 0)
      return;
    if (!state.keyboardSelection) {
      state.keyboardSelection = {
        anchorPosition: position,
        baseSelected: new Set(state.selected),
        targetSelected: !state.selected.has(button._clipboardXGnomeToken.index),
      };
    }
    const {anchorPosition, baseSelected, targetSelected} = state.keyboardSelection;
    state.selected.clear();
    for (const index of baseSelected)
      state.selected.add(index);
    const start = Math.min(anchorPosition, targetPosition);
    const end = Math.max(anchorPosition, targetPosition);
    for (let index = start; index <= end; index++) {
      const tokenIndex = this._buttons[index]._clipboardXGnomeToken.index;
      if (targetSelected)
        state.selected.add(tokenIndex);
      else
        state.selected.delete(tokenIndex);
    }
    for (const candidate of this._buttons) {
      const candidateToken = candidate._clipboardXGnomeToken;
      candidate.checked = state.selected.has(candidateToken.index);
      this._updateButtonStyle(candidate);
    }
    target.grab_key_focus();
    this.updateResult();
  }

  _target(button, key) {
    const position = this._buttons.indexOf(button);
    if (key === Clutter.KEY_Left)
      return this._buttons[position - 1] ?? null;
    if (key === Clutter.KEY_Right)
      return this._buttons[position + 1] ?? null;

    const row = button.get_parent();
    const rows = this.tokenBox.get_children();
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

  _applySelectionDrag(button) {
    const drag = this._selectionDrag;
    const token = button?._clipboardXGnomeToken;
    if (!drag || !token || button._clipboardXGnomeTokenState !== drag.state)
      return;
    if (drag.currentIndex === token.index)
      return;
    drag.currentIndex = token.index;
    const start = Math.min(drag.anchorIndex, token.index);
    const end = Math.max(drag.anchorIndex, token.index);
    let changed = false;
    for (const candidate of this._buttons) {
      const candidateToken = candidate._clipboardXGnomeToken;
      if (candidate._clipboardXGnomeTokenState !== drag.state)
        continue;
      const selected = candidateToken.index >= start && candidateToken.index <= end
        ? drag.selected : drag.baseSelected.has(candidateToken.index);
      if (drag.state.selected.has(candidateToken.index) === selected)
        continue;
      this.setSelected(candidate, selected, false);
      changed = true;
    }
    if (changed)
      this.updateResult();
  }

  _updateButtonStyle(button) {
    const token = button._clipboardXGnomeToken;
    const styles = [`max-width: ${button._clipboardXGnomeMaximumWidth}px`];
    if (button.checked) {
      if (this._accentColor)
        styles.push(`background-color: ${this._accentColor}`, 'color: white');
    } else if (token.type === 'url' && this._accentColor) {
      styles.push(`color: ${this._accentColor}`);
    }
    button.set_style(`${styles.join('; ')};`);
  }
}
