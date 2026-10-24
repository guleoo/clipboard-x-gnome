import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, until} from '../helpers/desktop.js';
import {Preferences} from '../helpers/preferences.js';
import {Target} from '../helpers/target.js';
import {capture} from '../clipboard/native.js';
import {cases as editor} from '../screenshot/editor.native.js';

const expected = {
  en: ['Search clipboard history…', 'Word Selection', 'General', 'Image editing'],
  zh: ['搜索剪切板历史…', '分词', '常规', '图片编辑'],
  ja: ['クリップボードの履歴を検索…', '単語分割', '全般', '画像編集'],
  ko: ['클립보드 기록 검색…', '단어 분리', '일반', '이미지 편집'],
};

export const cases = {
  async 'LANG-02'(desktop) {
    const language = GLib.getenv('LANGUAGE').split('_')[0];
    const [search, title, general, notification] = expected[language];
    assert(desktop.history.searchEntry.hint_text === search, 'Installed menu catalog must load in the actual Shell language');
    const target = await Target.open(desktop);
    let preferences;
    try {
      const item = await capture(desktop, target, 'Language smoke example');
      await desktop.open();
      await desktop.click(desktop.history._itemRows.get(item.id).focusActors
        .find(actor => actor._clipboardXGnomeEntryAction === 'tokenize'));
      await until(() => desktop.manager.is('tokenizer'), 'word panel in selected language');
      assert(desktop.words.titleLabel.text === title, 'Actual word panel must display the selected translation');
      await desktop.close();
      preferences = await Preferences.open(desktop);
      const snapshot = await preferences.inspect();
      assert(snapshot.windows[0].widgets.some(widget => widget.type === 'GtkLabel' && widget.label === general),
        'Independent GTK preferences must load the same installed catalog');
      await preferences.close();
      await editor['EDIT-01'](desktop);
      assert(Main.messageTray.getSources().flatMap(source => source.notifications)
        .some(value => value.title === notification), 'Actual missing-editor action must produce a localized GNOME notification');
    } finally { await preferences?.close(); await target.close(); }
  },
};
