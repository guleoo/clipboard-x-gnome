import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
  DICTIONARY_LOCALES,
  localeCandidates,
  normalizeLocale,
  requiresDictionary,
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

function requestNetworkLocation(window) {
  return new Promise(resolve => {
    const entry = new Adw.EntryRow({
      title: _('HTTP(S) URL'),
      text: 'https://',
    });
    const dialog = new Adw.AlertDialog({
      heading: _('Add network dictionary location'),
      body: _('Enter an HTTP or HTTPS URL that serves a UTF-8 dictionary file.'),
      extra_child: entry,
    });
    dialog.add_response('cancel', _('Cancel'));
    dialog.add_response('add', _('Add'));
    dialog.default_response = 'add';
    dialog.set_response_appearance('add', Adw.ResponseAppearance.SUGGESTED);
    dialog.choose(window, null, (source, result) => {
      try {
        const response = source.choose_finish(result);
        resolve(response === 'add' ? entry.text.trim() : '');
      } catch (error) {
        resolve('');
      }
    });
  });
}

export function create({settings, store, window}) {
  const languageNames = GLib.get_language_names();
  if (!requiresDictionary(languageNames))
    return null;
  const group = new Adw.PreferencesGroup({
    title: _('Dictionaries'),
    description: _('Dictionaries matching the current display language are loaded automatically.'),
  });
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
  const addNetworkButton = new Gtk.Button({
    label: _('Add network location'),
    valign: Gtk.Align.CENTER,
  });
  importRow.add_suffix(addNetworkButton);
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
  const enableDictionaryFile = fileName => {
    const configured = settings.get_strv('tokenizer-dictionary-files');
    if (configured.length > 0 && !configured.includes(fileName))
      settings.set_strv('tokenizer-dictionary-files', [...configured, fileName]);
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
        name: _('System tokenizer'),
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
      const toggle = new Gtk.Switch({
        active: enabled.has(dictionary.fileName),
        valign: Gtk.Align.CENTER,
      });
      toggle.connect('notify::active', () => {
        if (refreshing)
          return;
        const next = enabledDictionaries(dictionaries);
        if (!toggle.active && next.size === 1) {
          refreshing = true;
          toggle.active = true;
          refreshing = false;
          return;
        }
        if (toggle.active)
          next.add(dictionary.fileName);
        else
          next.delete(dictionary.fileName);
        setEnabledDictionaries(dictionaries, next);
      });
      row.add_suffix(toggle);
      row.activatable_widget = toggle;
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
        if (dictionary.source) {
          const refreshButton = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            tooltip_text: _('Refresh dictionary'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
          });
          refreshButton.connect('clicked', () => {
            refreshButton.sensitive = false;
            store.refreshSource(dictionary.source, dictionary.locale)
              .then(dictionary => {
                enableDictionaryFile(dictionary.fileName);
                bumpRevision(settings);
                refresh();
              })
              .catch(error => showError(window, error))
              .finally(() => refreshButton.sensitive = true);
          });
          row.add_suffix(refreshButton);
        }
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

  addNetworkButton.connect('clicked', async () => {
    const source = await requestNetworkLocation(window);
    if (!source)
      return;
    addNetworkButton.sensitive = false;
    try {
      const dictionary = await store.refreshSource(source, selectedLocale());
      enableDictionaryFile(dictionary.fileName);
      bumpRevision(settings);
      refresh();
    } catch (error) {
      showError(window, error);
    } finally {
      addNetworkButton.sensitive = true;
    }
  });

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
