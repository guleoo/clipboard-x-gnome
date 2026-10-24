import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as AnimationUtils from 'resource:///org/gnome/shell/misc/animationUtils.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {MAX_PHRASE_LENGTH, PhraseStore} from '../../../clipboard/phrases/store.js';
import {ContentItem} from '../../controls/content-item.js';
import {FocusAnchor} from '../../controls/focus-anchor.js';
import {PanelHeader} from '../../controls/panel-header.js';
import {SearchEntry} from '../../controls/search-entry.js';
import {FocusGrid} from '../../navigation/focus-grid.js';
import {matches as matchesShortcut} from '../../shortcut.js';

const OPTICAL_BASELINE_OFFSET = -1;

export class QuickPhrasesPanel {
  constructor({settings, createIconButton, handleKey, onBack, onCopy, onPaste, onType, refresh, isActive, reportError}) {
    this._settings = settings;
    this._store = new PhraseStore(settings);
    this._createIconButton = createIconButton;
    this._handleKey = handleKey;
    this._onCopy = onCopy;
    this._onPaste = onPaste;
    this._onType = onType;
    this._destroyed = false;
    this._isActive = isActive;
    this._refresh = () => {
      if (!this._destroyed)
        refresh();
    };
    this._reportError = error => {
      if (!this._destroyed)
        reportError(error);
    };
    this._formVisible = false;
    this._formRevision = 0;
    this._saveRequest = 0;
    this._buttons = [];
    this._rows = [];
    this._focusIdleId = 0;
    this._pendingViewState = null;

    this.item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    this.item.add_style_class_name('cbx-panel-host');
    this.actor = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'cbx-phrase-panel',
      x_expand: true,
    });
    this.focusAnchor = new FocusAnchor({
      onNavigate: () => this._focusFirstPhrase(),
      onKeyPress: event => this._handleKey(event),
    });
    this.actor.add_child(this.focusAnchor);
    this.backButton = createIconButton(
      'go-previous-symbolic',
      _('Back to clipboard history'),
      onBack,
      {showTooltip: false},
    );
    this.addButton = createIconButton(
      'list-add-symbolic',
      _('Add custom phrase'),
      () => this.toggleForm(),
    );
    this.header = new PanelHeader({
      title: _('Quick phrases'),
      backButton: this.backButton,
      actions: [this.addButton],
    });
    this.actor.add_child(this.header);

    this.form = new St.BoxLayout({
      style_class: 'cbx-phrase-form',
      x_expand: true,
      visible: false,
    });
    this.entry = new SearchEntry({
      styleClass: 'cbx-phrase-entry',
      placeholder: _('Enter a custom phrase…'),
      iconName: null,
      placeholderOffset: OPTICAL_BASELINE_OFFSET,
      placeholderMargin: 0,
      onChanged: () => this._formRevision++,
      onActivate: () => this.save().catch(error => this._reportError(error)),
      onKeyPress: event => {
        const key = event.get_key_symbol();
        // Adding a form action must not steal arrows used to edit the draft.
        if ([Clutter.KEY_Left, Clutter.KEY_KP_Left].includes(key)
            || ([Clutter.KEY_Right, Clutter.KEY_KP_Right].includes(key) && !this.entry.atEnd))
          return Clutter.EVENT_PROPAGATE;
        return this._handleKey(event);
      },
    });
    this.entry.clutter_text.set_max_length(MAX_PHRASE_LENGTH);
    this.form.add_child(this.entry);
    this.saveButton = createIconButton(
      'object-select-symbolic',
      _('Add custom phrase'),
      () => this.save(),
      {showTooltip: false},
    );
    this.form.add_child(this.saveButton);
    this.actor.add_child(this.form);

    this._section = new PopupMenu.PopupMenuSection();
    this.scroll = new St.ScrollView({
      overlay_scrollbars: true,
      style_class: 'cbx-phrase-scroll',
      x_expand: true,
      y_expand: true,
    });
    this.scroll.connect('scroll-event', () => {
      this._cancelFocus();
      return Clutter.EVENT_PROPAGATE;
    });
    this.scroll.add_child(this._section.actor);
    this.actor.add_child(this.scroll);
    this.item.add_child(this.actor);

    this.focusGrid = new FocusGrid({
      ensureVisible: actor => {
        const row = actor._clipboardXGnomePhraseRow;
        if (row?.mapped)
          AnimationUtils.ensureActorVisibleInScrollView(this.scroll, row);
      },
    });
    this.ready = this._store.ready
      .then(() => this._refresh())
      .catch(error => this._reportError(error));
  }

  get phrases() {
    return this._store.all;
  }

  get buttons() {
    return this._buttons;
  }

  get rows() {
    return this._rows;
  }

  get formVisible() {
    return this._formVisible;
  }

  render() {
    this._section.removeAll();
    this._buttons = [];
    this._rows = [];
    this.form.visible = this._formVisible;
    const focusRows = [];
    for (const phrase of this._store.all) {
      const row = new ContentItem();
      row._clipboardXGnomePhrase = phrase;
      const content = new St.Button({
        can_focus: true,
        track_hover: true,
      });
      const label = new St.Label({
        text: phrase,
        style_class: 'cbx-entry-preview',
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.CENTER,
      });
      label.clutter_text.single_line_mode = true;
      label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
      content.set_child(label);
      content.accessible_name = _('Copy quick phrase');
      content.connect('key-press-event', (_actor, event) => this._handleKey(event));
      content.connect('clicked', () => this._onCopy(phrase));
      row.setContent(content);
      const remove = this._createIconButton(
        'user-trash-symbolic',
        _('Delete quick phrase'),
        () => this.remove(phrase).catch(error => this._reportError(error)),
        {showTooltip: false},
      );
      row.addAction(remove);
      for (const actor of row.focusActors)
        actor._clipboardXGnomePhraseRow = row;
      this._buttons.push(content);
      this._rows.push(row);
      focusRows.push([content, remove]);
      this._section.addMenuItem(row);
    }
    if (this._store.all.length === 0) {
      const empty = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
      empty.add_child(new St.Label({
        text: _('No quick phrases'),
        style_class: 'cbx-empty',
      }));
      this._section.addMenuItem(empty);
    }
    this.focusGrid.setRows([
      [this.backButton, this.addButton],
      ...(this._formVisible ? [[this.entry.clutter_text, this.saveButton]] : []),
      ...focusRows,
    ]);
  }

  focus() {
    this._cancelFocus();
    if (this._destroyed || !this._isActive())
      return;
    const target = this._formVisible ? this.entry.clutter_text : this.addButton;
    target.grab_key_focus();
  }

  handleKey(event) {
    const row = global.stage.get_key_focus()?._clipboardXGnomePhraseRow;
    if (!row || !this._rows.includes(row))
      return Clutter.EVENT_PROPAGATE;
    const phrase = row._clipboardXGnomePhrase;
    let action;
    if (matchesShortcut(this._settings, 'history-paste-shortcut', event))
      action = () => this._onPaste(phrase);
    else if (matchesShortcut(this._settings, 'history-delete-shortcut', event))
      action = () => this.remove(phrase);
    else if (matchesShortcut(this._settings, 'history-type-shortcut', event))
      action = () => this._onType(phrase);
    else
      return Clutter.EVENT_PROPAGATE;
    try {
      Promise.resolve(action()).catch(error => this._reportError(error));
    } catch (error) {
      this._reportError(error);
    }
    return Clutter.EVENT_STOP;
  }

  focusStart() {
    this._cancelFocus();
    this.focusAnchor.focus();
  }

  leave() {
    this._cancelFocus();
    this.focusAnchor.cancel();
  }

  captureView() {
    const focus = global.stage.get_key_focus();
    if (this._pendingViewState
        && (!this.focusGrid.contains(focus) || focus === this._pendingViewState.focusActor))
      return this._pendingViewState;
    const row = focus?._clipboardXGnomePhraseRow;
    return {
      phrase: row?._clipboardXGnomePhrase ?? null,
      action: row?.focusActors.indexOf(focus) ?? 0,
      focusActor: !row && (focus === this.focusAnchor || this.focusGrid.contains(focus)) ? focus : null,
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
      if (this._destroyed || !this._isActive() || !this.actor.mapped)
        return GLib.SOURCE_REMOVE;
      // Only repair focus lost during rendering; a current control reflects newer input.
      const focus = global.stage.get_key_focus();
      if (this.focusGrid.contains(focus) && focus !== viewState.focusActor)
        return GLib.SOURCE_REMOVE;
      const row = this._rows.find(value => value._clipboardXGnomePhrase === viewState.phrase);
      const target = viewState.phrase === null ? viewState.focusActor
        : row?.focusActors[viewState.action] ?? this.addButton;
      if (target === this.focusAnchor)
        target.grab_key_focus();
      else
        this.focusGrid.focusAt(this.focusGrid.location(target));
      const adjustment = this.scroll.get_vadjustment();
      adjustment.remove_transition('value');
      adjustment.value = Math.max(adjustment.lower,
        Math.min(viewState.scrollValue, adjustment.upper - adjustment.page_size));
      return GLib.SOURCE_REMOVE;
    });
  }

  _cancelFocus() {
    if (this._focusIdleId)
      GLib.Source.remove(this._focusIdleId);
    this._focusIdleId = 0;
    this._pendingViewState = null;
  }

  destroy() {
    this._destroyed = true;
    this.leave();
    this.focusGrid.clear();
    this._buttons = [];
    this._rows = [];
  }

  _focusFirstPhrase() {
    for (const target of [...this._buttons, this.addButton]) {
      const focused = this.focusGrid.focusAt(this.focusGrid.location(target));
      if (focused)
        return focused;
    }
    return null;
  }

  setGeometry({height}) {
    this.actor.set_style(`height: ${height}px; max-height: ${height}px;`);
  }

  showForm() {
    this._setFormVisible(true);
    this._refresh();
    this.focus();
  }

  hideForm() {
    this._setFormVisible(false);
    this._refresh();
    this.focus();
  }

  toggleForm() {
    if (this._formVisible)
      this.hideForm();
    else
      this.showForm();
  }

  async save() {
    const text = this.entry.get_text();
    if (!text.trim())
      return false;
    const revision = this._formRevision;
    const request = ++this._saveRequest;
    await this._store.add(text);
    if (this._destroyed)
      return true;
    const current = this._formVisible && revision === this._formRevision && request === this._saveRequest;
    if (current)
      this._setFormVisible(false);
    this._refresh();
    if (current)
      this.focus();
    return true;
  }

  async remove(phrase) {
    if (!await this._store.remove(phrase))
      return false;
    this._refresh();
    this.focus();
    return true;
  }

  async trim() {
    const changed = await this._store.trim();
    if (changed)
      this._refresh();
    return changed;
  }

  async replace(phrases) {
    const changed = await this._store.replace(phrases);
    if (changed)
      this._refresh();
    return changed;
  }

  _setFormVisible(visible) {
    this._formRevision++;
    this._formVisible = visible;
    this.entry.set_text('');
  }
}
