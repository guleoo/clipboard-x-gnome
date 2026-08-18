import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {move, normalize} from '../layouts/panel-actions.js';
import {disconnectWhenUnrooted} from './lifecycle.js';

export function create(settings) {
  const row = new Adw.PreferencesRow({activatable: false});
  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 12,
    margin_top: 12,
    margin_bottom: 12,
    margin_start: 12,
    margin_end: 12,
  });
  const sections = new Map();
  for (const [region, title] of [
    ['toolbar', _('Top toolbar')],
    ['footer', _('Footer')],
  ]) {
    const section = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
    section.append(new Gtk.Label({label: title, xalign: 0, css_classes: ['heading']}));
    const list = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.NONE,
      css_classes: ['boxed-list'],
    });
    section.append(list);
    content.append(section);
    sections.set(region, list);
  }
  row.set_child(content);

  let updating = false;
  const current = () => normalize(
    settings.get_strv('panel-toolbar-actions'),
    settings.get_strv('panel-footer-actions'),
  );
  const save = layout => {
    updating = true;
    settings.set_strv('panel-toolbar-actions', layout.toolbar);
    settings.set_strv('panel-footer-actions', layout.footer);
    updating = false;
    render();
  };
  const place = (action, region, index) => save(move(current(), action, region, index));
  const render = () => {
    const layout = current();
    for (const [region, list] of sections) {
      while (list.get_first_child())
        list.remove(list.get_first_child());
      layout[region].forEach((action, index) => {
        const descriptor = describe(action);
        const item = new Gtk.ListBoxRow({activatable: false});
        const box = new Gtk.Box({spacing: 8, margin_start: 8, margin_end: 4});
        box.append(new Gtk.Image({icon_name: 'list-drag-handle-symbolic', pixel_size: 16}));
        box.append(new Gtk.Image({icon_name: descriptor.icon, pixel_size: 16}));
        box.append(new Gtk.Label({label: descriptor.title, xalign: 0, hexpand: true}));
        const up = new Gtk.Button({
          icon_name: 'go-up-symbolic',
          css_classes: ['flat'],
          tooltip_text: _('Move up'),
          sensitive: index > 0,
        });
        up.connect('clicked', () => place(action, region, index - 1));
        box.append(up);
        const down = new Gtk.Button({
          icon_name: 'go-down-symbolic',
          css_classes: ['flat'],
          tooltip_text: _('Move down'),
          sensitive: index < layout[region].length - 1,
        });
        down.connect('clicked', () => place(action, region, index + 2));
        box.append(down);
        const otherRegion = region === 'toolbar' ? 'footer' : 'toolbar';
        const transfer = new Gtk.Button({
          icon_name: region === 'toolbar' ? 'go-down-symbolic' : 'go-up-symbolic',
          css_classes: ['flat'],
          tooltip_text: region === 'toolbar' ? _('Move to footer') : _('Move to top toolbar'),
        });
        transfer.connect('clicked', () =>
          place(action, otherRegion, layout[otherRegion].length));
        box.append(transfer);
        item.set_child(box);

        const drag = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
        drag.connect('prepare', () => {
          const value = new GObject.Value();
          value.init(GObject.TYPE_STRING);
          value.set_string(action);
          return Gdk.ContentProvider.new_for_value(value);
        });
        item.add_controller(drag);
        list.append(item);
      });
    }
  };
  for (const [region, list] of sections) {
    const drop = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
    drop.connect('drop', (_target, action, _x, y) => {
      if (!action)
        return false;
      const target = list.get_row_at_y(Math.floor(y));
      let index = target?.get_index() ?? current()[region].length;
      if (target && y > target.get_allocated_height() / 2 + target.get_allocation().y)
        index++;
      place(action, region, index);
      return true;
    });
    list.add_controller(drop);
  }
  const toolbarSignal = settings.connect('changed::panel-toolbar-actions', () => {
    if (!updating)
      render();
  });
  const footerSignal = settings.connect('changed::panel-footer-actions', () => {
    if (!updating)
      render();
  });
  disconnectWhenUnrooted(row, () => {
    settings.disconnect(toolbarSignal);
    settings.disconnect(footerSignal);
  });
  render();
  return row;
}

function describe(action) {
  return {
    screenshot: {title: _('Screenshot'), icon: 'camera-photo-symbolic'},
    'color-picker': {title: _('Color picker'), icon: 'color-select-symbolic'},
    'quick-phrases': {title: _('Quick phrases'), icon: 'starred-symbolic'},
    'private-mode': {title: _('Privacy mode'), icon: 'security-high-symbolic'},
    sync: {title: _('Synchronization'), icon: 'folder-remote-symbolic'},
    'clear-history': {title: _('Clear history'), icon: 'user-trash-symbolic'},
    preferences: {title: _('Preferences'), icon: 'emblem-system-symbolic'},
  }[action];
}
