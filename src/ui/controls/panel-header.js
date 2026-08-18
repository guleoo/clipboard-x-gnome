import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

export const PanelHeader = GObject.registerClass(
class PanelHeader extends St.BoxLayout {
  _init({
    title = '',
    backButton = null,
    actions = [],
    styleClass = '',
    titleStyleClass = '',
    titleOffset = 0,
  } = {}) {
    const styleClasses = [
      'clipboard-x-panel-header',
      styleClass,
    ].filter(Boolean).join(' ');
    super._init({
      style_class: styleClasses,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._clipboardXControlType = 'panel-header';
    this.backButton = backButton;
    if (backButton)
      this.add_child(backButton);
    this.titleLabel = new St.Label({
      text: title,
      style_class: titleStyleClass,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this.titleLabel._clipboardXTextBaselineOffset = titleOffset;
    this.add_child(this.titleLabel);
    for (const actor of actions)
      this.addAction(actor);
  }

  addAction(actor) {
    this.add_child(actor);
    return actor;
  }
});
