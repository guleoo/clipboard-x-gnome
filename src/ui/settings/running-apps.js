import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {BUS_NAME, INTERFACE, OBJECT_PATH} from '../../common/running-apps.js';

export function create(settings) {
  const row = new Adw.ComboRow({
    title: _('Running application'),
    model: Gtk.StringList.new([_('Loading…')]),
  });
  const add = new Gtk.Button({
    icon_name: 'list-add-symbolic',
    valign: Gtk.Align.CENTER,
    css_classes: ['flat'],
    tooltip_text: _('Exclude selected application'),
    sensitive: false,
  });
  const refresh = new Gtk.Button({
    icon_name: 'view-refresh-symbolic',
    valign: Gtk.Align.CENTER,
    css_classes: ['flat'],
    tooltip_text: _('Refresh running applications'),
  });
  row.add_suffix(add);
  row.add_suffix(refresh);
  let applications = [];
  const load = () => {
    refresh.sensitive = false;
    Gio.DBus.session.call(
      BUS_NAME, OBJECT_PATH, INTERFACE, 'ListRunningApplications', null,
      new GLib.VariantType('(a(ss))'), Gio.DBusCallFlags.NONE, 3000, null,
      (connection, result) => {
        refresh.sensitive = true;
        try {
          [applications] = connection.call_finish(result).deepUnpack();
          row.model = Gtk.StringList.new(applications.length
            ? applications.map(([name, wmClass]) => `${name} (${wmClass})`)
            : [_('No running applications found')]);
          add.sensitive = applications.length > 0;
        } catch (_error) {
          applications = [];
          row.model = Gtk.StringList.new([_('Enable the extension to choose running applications')]);
          add.sensitive = false;
        }
      },
    );
  };
  refresh.connect('clicked', load);
  add.connect('clicked', () => {
    const wmClass = applications[row.selected]?.[1];
    if (!wmClass)
      return;
    const current = settings.get_strv('excluded-apps');
    if (!current.some(value => value.toLocaleLowerCase() === wmClass.toLocaleLowerCase()))
      settings.set_strv('excluded-apps', [...current, wmClass]);
  });
  load();
  return row;
}
