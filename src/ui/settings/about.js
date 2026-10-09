import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export function create(metadata) {
  const page = new Adw.PreferencesPage({
    title: _('About'),
    icon_name: 'help-about-symbolic',
  });
  const group = new Adw.PreferencesGroup({title: metadata.name});
  page.add(group);
  group.add(new Adw.ActionRow({
    title: _('Version'),
    subtitle: metadata['version-name'],
  }));
  const website = metadata.url.replace(/\/$/u, '');
  for (const [title, subtitle, uri] of [
    [_('Project website'), website, website],
    [_('Report an issue'), `${website}/issues`, `${website}/issues`],
    [_('License'), 'GPL-3.0-or-later', 'https://www.gnu.org/licenses/gpl-3.0.html'],
  ]) {
    const row = new Adw.ActionRow({title, subtitle});
    const link = new Gtk.LinkButton({uri, label: _('Open'), valign: Gtk.Align.CENTER});
    row.add_suffix(link);
    row.activatable_widget = link;
    group.add(row);
  }
  return page;
}
