import GObject from 'gi://GObject';
import St from 'gi://St';
import {createLogger} from '../../common/logger.js';

const DEFAULT_ICON_SIZE = 16;
const logger = createLogger('ui');

export const IconButton = GObject.registerClass(
class IconButton extends St.Button {
  _init({
    iconName,
    label = '',
    iconSize = DEFAULT_ICON_SIZE,
    selectable = false,
    onActivate = null,
    onKeyPress = null,
    onError = error => logger.error('icon-activate', error),
  } = {}) {
    super._init({
      can_focus: true,
      track_hover: true,
      style_class: 'cbx-icon-button',
      accessible_name: label,
    });
    this._clipboardXControlType = 'icon-button';
    this._clipboardXIconSize = iconSize;
    this._selectable = selectable;
    if (selectable)
      this.add_style_class_name('cbx-state-icon');
    this.setIcon(iconName);
    this.setHint(label);

    if (onKeyPress)
      this.connect('key-press-event', (_actor, event) => onKeyPress(event));
    if (onActivate) {
      this.connect('clicked', () => {
        let result;
        try {
          result = onActivate();
        } catch (error) {
          onError(error);
          return;
        }
        Promise.resolve(result).catch(onError);
      });
    }
  }

  get selected() {
    return this.checked;
  }

  set selected(value) {
    this.checked = Boolean(value);
  }

  setIcon(iconName) {
    this.set_child(new St.Icon({
      icon_name: iconName,
      icon_size: this._clipboardXIconSize,
    }));
  }

  setHint(text) {
    this.accessible_name = text;
    this._hintText = text;
  }
});
