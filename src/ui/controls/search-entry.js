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
    onActivate = null,
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
    this._clipboardXGnomeControlType = 'search-entry';
    const hint = this.get_hint_actor();
    hint._clipboardXGnomeTextBaselineOffset = placeholderOffset;
    // Shell themes may add their own margin to StEntry's hint label.
    hint.set_style(`margin-left: ${placeholderMargin}px;`);

    if (onChanged)
      this.clutter_text.connect('text-changed', () => onChanged(this));
    if (onActivate)
      this.clutter_text.connect('activate', () => onActivate(this));
    if (onFocusChanged) {
      this.clutter_text.connect('key-focus-in', () => onFocusChanged(this, true));
      this.clutter_text.connect('key-focus-out', () => onFocusChanged(this, false));
    }
    // Run entry navigation before the native text bindings consume arrow keys.
    if (onKeyPress)
      this.connect('captured-event', (_actor, event) => event.type() === Clutter.EventType.KEY_PRESS
        ? onKeyPress(event) : Clutter.EVENT_PROPAGATE);
  }

  get atEnd() {
    const text = this.clutter_text;
    // Clutter uses character offsets (not UTF-16 units), with -1 meaning the end.
    return !text.get_selection()
      && (text.get_cursor_position() === -1
        || text.get_cursor_position() === [...this.get_text()].length);
  }
});
