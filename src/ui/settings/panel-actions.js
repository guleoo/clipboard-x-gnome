// Button-based panel action ordering editor used by the settings window.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {move, normalize, normalizeHidden} from '../layouts/panel-actions.js';
import {
  move as moveEntry,
  normalize as normalizeEntries,
  normalizeHidden as normalizeHiddenEntries,
} from '../layouts/entry-actions.js';
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
    ['entries', _('History')],
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
  const current = () => ({
    ...normalize(
      settings.get_strv('panel-toolbar-actions'),
      settings.get_strv('panel-footer-actions'),
    ),
    entries: normalizeEntries(settings.get_strv('entry-actions')),
  });
  const hidden = region => new Set(region === 'entries'
    ? normalizeHiddenEntries(settings.get_strv('entry-hidden-actions'))
    : normalizeHidden(settings.get_strv('panel-hidden-actions')));
  const save = layout => {
    updating = true;
    settings.set_strv('panel-toolbar-actions', layout.toolbar);
    settings.set_strv('panel-footer-actions', layout.footer);
    settings.set_strv('entry-actions', layout.entries);
    updating = false;
    render();
  };
  const place = (action, region, index) => {
    const layout = current();
    save(region === 'entries'
      ? {...layout, entries: moveEntry(layout.entries, action, index)}
      : {...layout, ...move(layout, action, region, index)});
  };
  const setVisible = (action, region, visible) => {
    const values = hidden(region);
    if (visible)
      values.delete(action);
    else
      values.add(action);
    updating = true;
    settings.set_strv(region === 'entries' ? 'entry-hidden-actions' : 'panel-hidden-actions', [...values]);
    updating = false;
    render();
  };
  const render = () => {
    const layout = current();
    for (const [region, list] of sections) {
      const hiddenActions = hidden(region);
      while (list.get_first_child())
        list.remove(list.get_first_child());
      layout[region].forEach((action, index) => {
        const descriptor = region === 'entries' ? describeEntry(action) : describe(action);
        const item = new Gtk.ListBoxRow({activatable: false});
        const box = new Gtk.Box({spacing: 8, margin_start: 8, margin_end: 4});
        box.append(new Gtk.Image({icon_name: descriptor.icon, pixel_size: 16}));
        box.append(new Gtk.Label({label: descriptor.title, xalign: 0, hexpand: true}));
        const visibility = new Gtk.Switch({
          active: !hiddenActions.has(action),
          valign: Gtk.Align.CENTER,
          tooltip_text: _('Show icon'),
        });
        visibility.connect('notify::active', () => setVisible(action, region, visibility.active));
        box.append(visibility);
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
        if (region !== 'entries') {
          const otherRegion = region === 'toolbar' ? 'footer' : 'toolbar';
          const transfer = new Gtk.Button({
            icon_name: region === 'toolbar' ? 'go-down-symbolic' : 'go-up-symbolic',
            css_classes: ['flat'],
            tooltip_text: region === 'toolbar' ? _('Move to footer') : _('Move to top toolbar'),
          });
          transfer.connect('clicked', () =>
            place(action, otherRegion, layout[otherRegion].length));
          box.append(transfer);
        }
        item.set_child(box);
        list.append(item);
      });
    }
  };
  const signals = [
    'panel-toolbar-actions', 'panel-footer-actions', 'panel-hidden-actions',
    'entry-actions', 'entry-hidden-actions',
  ].map(key => settings.connect(`changed::${key}`, () => {
    if (!updating)
      render();
  }));
  disconnectWhenUnrooted(row, () => {
    for (const signal of signals)
      settings.disconnect(signal);
  });
  render();
  return row;
}

function describeEntry(action) {
  return {
    tokenize: {title: _('Segment text'), icon: 'format-text-plaintext-symbolic'},
    edit: {title: _('Edit image'), icon: 'document-edit-symbolic'},
    pin: {title: _('Pin'), icon: 'view-pin-symbolic'},
    sync: {title: _('Synchronization'), icon: 'network-transmit-receive-symbolic'},
    delete: {title: _('Delete from local history'), icon: 'user-trash-symbolic'},
  }[action];
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
