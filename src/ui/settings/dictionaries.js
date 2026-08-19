import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {localeCandidates, normalizeLocale} from '../../clipboard/tokenizer/dictionary/locale.js';

function bumpRevision(settings) {
  settings.set_uint(
    'tokenizer-dictionary-revision',
    (settings.get_uint('tokenizer-dictionary-revision') + 1) >>> 0,
  );
}

function showError(window, error) {
  const dialog = new Adw.AlertDialog({
    heading: _('Dictionary import failed'),
    body: error.message,
  });
  dialog.add_response('close', _('Close'));
  dialog.present(window);
}

export function create({settings, store, window}) {
  const group = new Adw.PreferencesGroup({
    title: _('Dictionaries'),
    description: _('Dictionaries matching the current display language are loaded automatically.'),
  });
  const currentLocale = localeCandidates(GLib.get_language_names())[0] ?? 'und';
  const localeRow = new Adw.EntryRow({
    title: _('Language code for import'),
    text: currentLocale,
  });
  localeRow.set_tooltip_text(_('Used when the dictionary does not declare “# locale: language-code”.'));
  group.add(localeRow);

  const importRow = new Adw.ActionRow({
    title: _('Import dictionary'),
    subtitle: _('UTF-8 text; one word and optional frequency per line'),
  });
  const importButton = new Gtk.Button({
    label: _('Import…'),
    valign: Gtk.Align.CENTER,
  });
  importRow.add_suffix(importButton);
  importRow.activatable_widget = importButton;
  group.add(importRow);

  let dictionaryRows = [];
  const refresh = () => {
    for (const row of dictionaryRows)
      group.remove(row);
    dictionaryRows = store.list().map(dictionary => {
      const row = new Adw.ActionRow({
        title: dictionary.name,
        subtitle: `${dictionary.locale} · ${dictionary.entryCount} ${_('entries')}`,
      });
      const remove = new Gtk.Button({
        icon_name: 'user-trash-symbolic',
        tooltip_text: _('Remove dictionary'),
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
      });
      remove.connect('clicked', () => {
        try {
          store.remove(dictionary.fileName);
          bumpRevision(settings);
          refresh();
        } catch (error) {
          showError(window, error);
        }
      });
      row.add_suffix(remove);
      group.add(row);
      return row;
    });
  };

  importButton.connect('clicked', () => {
    const locale = normalizeLocale(localeRow.get_text());
    if (!locale) {
      showError(window, new Error(_('Enter a valid language code, such as zh, en, or pt_BR.')));
      return;
    }
    const dialog = new Gtk.FileDialog({
      title: _('Import dictionary'),
    });
    dialog.open(window, null, (source, result) => {
      let file;
      try {
        file = source.open_finish(result);
      } catch (error) {
        if (!error.matches(Gtk.DialogError.quark(), Gtk.DialogError.DISMISSED))
          showError(window, error);
        return;
      }
      importButton.sensitive = false;
      store.importFile(file, locale)
        .then(() => {
          bumpRevision(settings);
          refresh();
        })
        .catch(error => showError(window, error))
        .finally(() => importButton.sensitive = true);
    });
  });

  refresh();
  return group;
}
