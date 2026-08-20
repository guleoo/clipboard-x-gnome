import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
  DICTIONARY_LOCALES,
  localeCandidates,
  normalizeLocale,
  selectLocale,
  SYSTEM_DICTIONARY_ID,
} from '../../clipboard/tokenizer/dictionary/locale.js';

function bumpRevision(settings) {
  settings.set_uint(
    'tokenizer-dictionary-revision',
    (settings.get_uint('tokenizer-dictionary-revision') + 1) >>> 0,
  );
}

function showError(window, error, heading = _('Dictionary operation failed')) {
  const dialog = new Adw.AlertDialog({
    heading,
    body: error.message,
  });
  dialog.add_response('close', _('Close'));
  dialog.present(window);
}

function languageChoices(languageNames) {
  const displayLocale = normalizeLocale(languageNames[0]) || 'en';
  const names = new Intl.DisplayNames([displayLocale.replaceAll('_', '-')], {type: 'language'});
  return DICTIONARY_LOCALES.map(locale => {
    const languageTag = locale.replaceAll('_', '-');
    return {
      locale,
      label: names.of(languageTag) ?? locale,
    };
  }).sort((left, right) => left.label.localeCompare(right.label));
}

function editDictionary(window, file, onLaunched) {
  const launcher = new Gtk.FileLauncher({file, writable: true});
  launcher.launch(window, null, (source, result) => {
    try {
      source.launch_finish(result);
      onLaunched();
    } catch (error) {
      showError(window, error);
    }
  });
}

function showDictionary(window, file) {
  const launcher = new Gtk.FileLauncher({file});
  launcher.open_containing_folder(window, null, (source, result) => {
    try {
      source.open_containing_folder_finish(result);
    } catch (error) {
      showError(window, error);
    }
  });
}

export function create({settings, store, window}) {
  const group = new Adw.PreferencesGroup({
    title: _('Dictionaries'),
    description: _('Dictionaries matching the current display language are loaded automatically.'),
  });
  const languageNames = GLib.get_language_names();
  const languages = languageChoices(languageNames);
  const currentLocale = selectLocale(languageNames);
  const localeRow = new Adw.ComboRow({
    title: _('Language for import'),
    model: Gtk.StringList.new(languages.map(language => language.label)),
    selected: Math.max(0, languages.findIndex(language => language.locale === currentLocale)),
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
  let refreshing = false;
  const selectedLocale = () => languages[localeRow.selected]?.locale ?? currentLocale;
  const matchingDictionaries = () => {
    const locales = new Set(localeCandidates([selectedLocale()]));
    return store.list().filter(dictionary => locales.has(dictionary.locale));
  };
  const enabledDictionaries = dictionaries => {
    const configured = new Set(settings.get_strv('tokenizer-dictionary-files'));
    if (configured.size === 0)
      return new Set([
        SYSTEM_DICTIONARY_ID,
        ...dictionaries.map(dictionary => dictionary.fileName),
      ]);
    const matching = dictionaries.filter(dictionary => configured.has(dictionary.fileName));
    return new Set([
      ...(configured.has(SYSTEM_DICTIONARY_ID) ? [SYSTEM_DICTIONARY_ID] : []),
      ...matching.map(dictionary => dictionary.fileName),
    ]);
  };
  const setEnabledDictionaries = (dictionaries, enabled) => {
    const allEnabled = enabled.has(SYSTEM_DICTIONARY_ID)
      && dictionaries.every(dictionary => enabled.has(dictionary.fileName));
    const next = allEnabled
      ? []
      : [...enabled].sort((left, right) => left.localeCompare(right));
    if (JSON.stringify(settings.get_strv('tokenizer-dictionary-files')) === JSON.stringify(next))
      return;
    settings.set_strv('tokenizer-dictionary-files', next);
    bumpRevision(settings);
  };
  const refresh = () => {
    refreshing = true;
    for (const row of dictionaryRows)
      group.remove(row);
    const dictionaries = matchingDictionaries();
    const enabled = enabledDictionaries(dictionaries);
    const entries = [
      {
        fileName: SYSTEM_DICTIONARY_ID,
        name: _('System tokenizer only'),
        subtitle: '',
        system: true,
      },
      ...dictionaries.map(dictionary => ({...dictionary, system: false})),
    ];
    dictionaryRows = entries.map(dictionary => {
      const row = new Adw.ActionRow({
        title: dictionary.name,
        subtitle: dictionary.system
          ? ''
          : `${dictionary.locale} · ${dictionary.entryCount} ${_('entries')}`,
      });
      const checkButton = new Gtk.CheckButton({
        active: enabled.has(dictionary.fileName),
        valign: Gtk.Align.CENTER,
      });
      checkButton.connect('notify::active', () => {
        if (refreshing)
          return;
        const next = enabledDictionaries(dictionaries);
        if (!checkButton.active && next.size === 1) {
          refreshing = true;
          checkButton.active = true;
          refreshing = false;
          return;
        }
        if (checkButton.active)
          next.add(dictionary.fileName);
        else
          next.delete(dictionary.fileName);
        setEnabledDictionaries(dictionaries, next);
      });
      row.add_prefix(checkButton);
      row.activatable_widget = checkButton;
      if (!dictionary.system) {
        const file = store.getFile(dictionary.fileName);
        const edit = new Gtk.Button({
          icon_name: 'document-edit-symbolic',
          tooltip_text: _('Edit dictionary'),
          valign: Gtk.Align.CENTER,
          css_classes: ['flat'],
        });
        edit.connect('clicked', () => editDictionary(window, file, () => bumpRevision(settings)));
        row.add_suffix(edit);
        const show = new Gtk.Button({
          icon_name: 'folder-open-symbolic',
          tooltip_text: _('Open containing folder'),
          valign: Gtk.Align.CENTER,
          css_classes: ['flat'],
        });
        show.connect('clicked', () => showDictionary(window, file));
        row.add_suffix(show);
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
      }
      group.add(row);
      return row;
    });
    refreshing = false;
  };

  localeRow.connect('notify::selected', refresh);

  importButton.connect('clicked', () => {
    const locale = languages[localeRow.selected]?.locale ?? currentLocale;
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
        .catch(error => showError(window, error, _('Dictionary import failed')))
        .finally(() => importButton.sensitive = true);
    });
  });

  refresh();
  return group;
}
