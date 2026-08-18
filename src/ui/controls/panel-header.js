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
    backIconOffset = 1,
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
    this._actions = [];
    this._balanceActors = [];
    this.row = new St.BoxLayout({
      style_class: 'clipboard-x-panel-header-row',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this.add_child(this.row);
    this.leading = new St.BoxLayout({style_class: 'clipboard-x-panel-header-side'});
    this.trailing = new St.BoxLayout({style_class: 'clipboard-x-panel-header-side'});
    this.row.add_child(this.leading);
    this.backButton = backButton;
    if (backButton) {
      this.leading.add_child(backButton);
      const icon = backButton.get_child?.();
      if (icon)
        icon.translation_x = backIconOffset;
    }
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
    this.row.add_child(this.trailing);
    for (const actor of actions)
      this.addAction(actor);
    this._updateBalance();
    this.divider = new St.Widget({
      style_class: 'clipboard-x-panel-divider',
      x_expand: true,
    });
    this.add_child(this.divider);
  }

  addAction(actor) {
    this._actions.push(actor);
    this.trailing.add_child(actor);
    this._updateBalance();
    return actor;
  }

  _updateBalance() {
    for (const actor of this._balanceActors)
      actor.get_parent()?.remove_child(actor);
    this._balanceActors = [];
    const leadingCount = this.backButton ? 1 : 0;
    const trailingCount = this._actions.length;
    const container = leadingCount < trailingCount ? this.leading : this.trailing;
    for (let index = 0; index < Math.abs(leadingCount - trailingCount); index++) {
      const actor = new St.Widget({style_class: 'clipboard-x-panel-header-balance'});
      container.add_child(actor);
      this._balanceActors.push(actor);
    }
  }
});
