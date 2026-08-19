import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

export const PanelFooter = GObject.registerClass(
class PanelFooter extends St.BoxLayout {
  _init({content = [], styleClass = ''} = {}) {
    const styleClasses = [
      'cbx-panel-footer',
      styleClass,
    ].filter(Boolean).join(' ');
    super._init({
      style_class: styleClasses,
      x_expand: true,
      vertical: true,
    });
    this._clipboardXControlType = 'panel-footer';
    this.divider = new St.Widget({
      style_class: 'cbx-panel-divider cbx-panel-footer-divider',
      x_expand: true,
    });
    this.add_child(this.divider);
    this.row = new St.BoxLayout({
      style_class: 'cbx-panel-footer-row',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this.add_child(this.row);
    for (const actor of content)
      this.addContent(actor);
  }

  get contentActors() {
    return this.row.get_children();
  }

  addContent(actor) {
    this.row.add_child(actor);
    return actor;
  }

  clear() {
    for (const actor of this.contentActors)
      this.row.remove_child(actor);
  }
});
