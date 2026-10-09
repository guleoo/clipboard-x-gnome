import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {disconnectWhenUnrooted} from './lifecycle.js';

export function create(metadata) {
  const page = new Adw.PreferencesPage({
    title: _('About'),
    icon_name: 'help-about-symbolic',
  });
  const group = new Adw.PreferencesGroup();
  page.add(group);
  const version = new Adw.ActionRow({title: _('Version')});
  version.add_suffix(new Gtk.Label({
    label: metadata['version-name'],
    css_classes: ['heading'],
    valign: Gtk.Align.CENTER,
  }));
  group.add(version);
  const website = metadata.url.replace(/\/$/u, '');
  for (const [title, subtitle, uri] of [
    [_('Project website'), website, website],
    [_('Report an issue'), `${website}/issues`, `${website}/issues`],
    [_('License'), 'GPL-3.0-or-later', 'https://www.gnu.org/licenses/gpl-3.0.html'],
  ]) {
    const row = new Adw.ActionRow({title, subtitle, activatable: true});
    const cancellable = new Gio.Cancellable();
    disconnectWhenUnrooted(row, () => cancellable.cancel());
    row.connect('activated', () => {
      const window = row.get_root();
      const launcher = new Gtk.UriLauncher({uri});
      launcher.launch(window, cancellable, (source, result) => {
        try {
          source.launch_finish(result);
        } catch (error) {
          if (cancellable.is_cancelled() || error.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
            return;
          const dialog = new Adw.AlertDialog({heading: _('Operation failed'), body: error.message});
          dialog.add_response('close', _('Close'));
          dialog.present(window);
        }
      });
    });
    group.add(row);
  }
  return page;
}
