import GObject from 'gi://GObject';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export const ContentItem = GObject.registerClass(
class ContentItem extends PopupMenu.PopupBaseMenuItem {
  _init({leading = [], content = null, actions = []} = {}) {
    super._init({reactive: false, can_focus: false});
    this._clipboardXControlType = 'content-item';
    this.add_style_class_name('clipboard-x-entry');
    this.track_hover = true;
    for (const actor of leading)
      this.addLeading(actor);
    if (content)
      this.setContent(content);
    for (const actor of actions)
      this.addAction(actor);
  }

  get focusActors() {
    return this.get_children().filter(actor => actor.can_focus);
  }

  addLeading(actor) {
    const contentPosition = this._content ? this.get_children().indexOf(this._content) : -1;
    if (contentPosition >= 0)
      this.insert_child_at_index(actor, contentPosition);
    else
      this.add_child(actor);
    return actor;
  }

  setContent(actor) {
    if (this._content)
      this.remove_child(this._content);
    this._content = actor;
    actor.x_expand = true;
    const actions = this._actions ?? [];
    const firstActionPosition = actions.length > 0
      ? this.get_children().indexOf(actions[0])
      : -1;
    if (firstActionPosition >= 0)
      this.insert_child_at_index(actor, firstActionPosition);
    else
      this.add_child(actor);
    return actor;
  }

  addAction(actor) {
    this._actions ??= [];
    this._actions.push(actor);
    this.add_child(actor);
    return actor;
  }
});
