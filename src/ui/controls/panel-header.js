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
      vertical: true,
    });
    this._clipboardXControlType = 'panel-header';
    this.row = new St.BoxLayout({
      style_class: 'clipboard-x-panel-header-row',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this.add_child(this.row);
    this.backButton = backButton;
    if (backButton)
      this.row.add_child(backButton);
    const titleStyleClasses = [
      'clipboard-x-panel-header-title',
      titleStyleClass,
    ].filter(Boolean).join(' ');
    this.titleLabel = new St.Label({
      text: title,
      style_class: titleStyleClasses,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this.titleLabel._clipboardXTextBaselineOffset = titleOffset;
    this.row.add_child(this.titleLabel);
    for (const actor of actions)
      this.addAction(actor);
    this.divider = new St.Widget({
      style_class: 'clipboard-x-panel-divider',
      x_expand: true,
    });
    this.add_child(this.divider);
  }

  addAction(actor) {
    this.row.add_child(actor);
    return actor;
  }
});
