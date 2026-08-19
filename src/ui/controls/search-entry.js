import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

export const SearchEntry = GObject.registerClass(
class SearchEntry extends St.Entry {
  _init({
    placeholder = '',
    iconName = 'edit-find-symbolic',
    iconSize = 14,
    placeholderOffset = 0,
    placeholderMargin = 2,
    styleClass = '',
    onChanged = null,
    onFocusChanged = null,
    onKeyPress = null,
  } = {}) {
    const styleClasses = ['cbx-search', styleClass].filter(Boolean).join(' ');
    super._init({
      style_class: styleClasses,
      hint_text: placeholder,
      can_focus: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      primary_icon: iconName
        ? new St.Icon({icon_name: iconName, icon_size: iconSize})
        : null,
    });
    this._clipboardXControlType = 'search-entry';
    const hint = this.get_hint_actor();
    hint._clipboardXTextBaselineOffset = placeholderOffset;
    hint.margin_left = placeholderMargin;

    if (onChanged)
      this.clutter_text.connect('text-changed', () => onChanged(this));
    if (onFocusChanged) {
      this.clutter_text.connect('key-focus-in', () => onFocusChanged(this, true));
      this.clutter_text.connect('key-focus-out', () => onFocusChanged(this, false));
    }
    if (onKeyPress)
      this.clutter_text.connect('key-press-event', (_actor, event) => onKeyPress(event));
  }
});
