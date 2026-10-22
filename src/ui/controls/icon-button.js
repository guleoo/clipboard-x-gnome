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
    tooltip = null,
    showTooltip = true,
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
    this._clipboardXGnomeControlType = 'icon-button';
    this._iconSize = iconSize;
    this._tooltip = showTooltip ? tooltip : null;
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

  get hint() {
    return this.accessible_name;
  }

  set selected(value) {
    this.checked = Boolean(value);
  }

  setIcon(icon) {
    this.set_child(new St.Icon({
      ...(typeof icon === 'string' ? {icon_name: icon} : {gicon: icon}),
      icon_size: this._iconSize,
    }));
  }

  setHint(text) {
    this.accessible_name = text;
    this._tooltip?.attach(this, text);
  }
});
