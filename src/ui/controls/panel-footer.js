import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

export const PanelFooter = GObject.registerClass(
class PanelFooter extends St.BoxLayout {
  _init({content = [], styleClass = ''} = {}) {
    const styleClasses = [
      'clipboard-x-panel-footer',
      styleClass,
    ].filter(Boolean).join(' ');
    super._init({
      style_class: styleClasses,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._clipboardXControlType = 'panel-footer';
    for (const actor of content)
      this.addContent(actor);
  }

  addContent(actor) {
    this.add_child(actor);
    return actor;
  }

  clear() {
    for (const actor of this.get_children())
      this.remove_child(actor);
  }
});
