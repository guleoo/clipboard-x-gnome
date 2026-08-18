import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as AnimationUtils from 'resource:///org/gnome/shell/misc/animationUtils.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {MAX_PHRASE_LENGTH, PhraseStore} from '../../../clipboard/phrases/store.js';
import {ContentItem} from '../../controls/content-item.js';
import {PanelHeader} from '../../controls/panel-header.js';
import {FocusGrid} from '../../navigation/focus-grid.js';

const OPTICAL_BASELINE_OFFSET = -1;

export class QuickPhrasesPanel {
  constructor({settings, createIconButton, handleKey, onBack, onCopy, refresh}) {
    this._store = new PhraseStore(settings);
    this._createIconButton = createIconButton;
    this._handleKey = handleKey;
    this._onCopy = onCopy;
    this._refresh = refresh;
    this._formVisible = false;
    this._buttons = [];
    this._rows = [];

    this.item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    this.item.add_style_class_name('clipboard-x-panel-host');
    this.actor = new St.BoxLayout({
      vertical: true,
      style_class: 'clipboard-x-phrase-panel',
      x_expand: true,
    });
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
      {tooltipScope: 'panel'},
    );
    this.header = new PanelHeader({
      title: _('Quick phrases'),
      backButton: this.backButton,
      actions: [this.addButton],
    });
    this.actor.add_child(this.header);

    this.form = new St.BoxLayout({
      style_class: 'clipboard-x-phrase-form',
      x_expand: true,
      visible: false,
    });
    this.entry = new St.Entry({
      style_class: 'clipboard-x-search clipboard-x-phrase-entry',
      hint_text: _('Enter a custom phrase…'),
      can_focus: true,
      x_expand: true,
    });
    this.entry.clutter_text.set_max_length(MAX_PHRASE_LENGTH);
    this.entry.get_hint_actor()._clipboardXTextBaselineOffset = OPTICAL_BASELINE_OFFSET;
    this.entry.clutter_text.connect('key-press-event', (_actor, event) => {
      const key = event.get_key_symbol();
      if ([Clutter.KEY_Return, Clutter.KEY_KP_Enter, Clutter.KEY_ISO_Enter].includes(key)) {
        this.save();
        return Clutter.EVENT_STOP;
      }
      if (key === Clutter.KEY_Escape) {
        this.hideForm();
        return Clutter.EVENT_STOP;
      }
      return this._handleKey(event);
    });
    this.form.add_child(this.entry);
    this.actor.add_child(this.form);

    this._section = new PopupMenu.PopupMenuSection();
    this.scroll = new St.ScrollView({
      overlay_scrollbars: true,
      style_class: 'clipboard-x-phrase-scroll',
      x_expand: true,
      y_expand: true,
    });
    this.scroll.add_child(this._section.actor);
    this.actor.add_child(this.scroll);
    this.item.add_child(this.actor);

    this.focusGrid = new FocusGrid({
      ensureVisible: actor => {
        const row = actor._clipboardXPhraseRow;
        if (row?.mapped)
          AnimationUtils.ensureActorVisibleInScrollView(this.scroll, row);
      },
    });
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
      const content = new St.Button({
        can_focus: true,
        track_hover: true,
      });
      const label = new St.Label({
        text: phrase,
        style_class: 'clipboard-x-entry-preview',
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
        () => this.remove(phrase),
        {showTooltip: false},
      );
      row.addAction(remove);
      for (const actor of row.focusActors)
        actor._clipboardXPhraseRow = row;
      this._buttons.push(content);
      this._rows.push(row);
      focusRows.push([content, remove]);
      this._section.addMenuItem(row);
    }
    if (this._store.all.length === 0) {
      const empty = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
      empty.add_child(new St.Label({
        text: _('No quick phrases'),
        style_class: 'clipboard-x-empty',
      }));
      this._section.addMenuItem(empty);
    }
    this.focusGrid.setRows([
      [this.backButton, this.addButton],
      ...(this._formVisible ? [[this.entry.clutter_text]] : []),
      ...focusRows,
    ]);
  }

  focus() {
    const target = this._formVisible ? this.entry.clutter_text : this.addButton;
    target.grab_key_focus();
  }

  focusInitial() {
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

  save() {
    if (!this.entry.get_text().trim())
      return false;
    this._store.add(this.entry.get_text());
    this._setFormVisible(false);
    this._refresh();
    this.focus();
    return true;
  }

  remove(phrase) {
    if (!this._store.remove(phrase))
      return false;
    this._refresh();
    this.focus();
    return true;
  }

  trim() {
    return this._store.trim();
  }

  _setFormVisible(visible) {
    this._formVisible = visible;
    this.entry.set_text('');
  }
}
