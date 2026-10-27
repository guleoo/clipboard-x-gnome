import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, pause, rect, until} from '../helpers/desktop.js';
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

async function dictionaryFailure(preferences) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const {windows} = await preferences.inspect();
    for (const window of windows) {
      const widgets = new Map(window.widgets.map(widget => [widget.id, widget]));
      for (const dialog of window.widgets.filter(widget => widget.type === 'AdwAlertDialog' && widget.mapped)) {
        const labels = window.widgets.filter(widget => {
          if (widget.type !== 'GtkLabel' || !widget.mapped) return false;
          for (let parent = widgets.get(widget.parent); parent; parent = widgets.get(parent.parent))
            if (parent.id === dialog.id) return true;
          return false;
        }).map(widget => widget.label);
        if (labels.includes('词库操作失败')) return labels;
      }
    }
    await pause(20);
  }
  throw new Error('The actual dictionary failure dialog must appear with its translated Chinese heading');
}

export const cases = {
  async 'LANG-07-dictionary'(desktop) {
    assert(GLib.getenv('LANGUAGE').startsWith('zh'), 'Dictionary error localization requires the installed Chinese catalog');
    const preferences = await Preferences.open(desktop);
    try {
      await preferences.page('clipboard');
      await preferences.click({type: 'GtkButton', label: 'Add network location'});
      await preferences.input('HTTP(S) URL', 'ftp://example.invalid/dictionary');
      await preferences.click({type: 'GtkButton', label: 'Add'});
      const labels = await dictionaryFailure(preferences);
      assert(labels.includes('词库操作失败'), 'The actual error dialog heading must be translated');
      print('[simulation] LANG-07-dictionary Chinese error heading PASS');
      const body = labels.find(label => label?.includes('HTTP') && label.includes('HTTPS'));
      assert(typeof body === 'string' && body.trim().length > 0, 'The actual validation failure must explain the invalid URL');
      print(`[simulation] LANG-07-dictionary actual error body: ${body}`);
      assert(body === '网络词库地址必须使用 HTTP 或 HTTPS'
        && !labels.some(label => label.includes('Network dictionary location must use HTTP or HTTPS')),
      `The actual dictionary URL error must be Chinese, not a raw English diagnostic (actual=${JSON.stringify(body)})`);
    } finally { await preferences.close(); }
  },

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

  async 'LANG-03'(desktop) {
    const language = GLib.getenv('LANGUAGE').split('_')[0];
    const rtl = language === 'ar';
    const search = rtl ? 'ابحث في سجل الحافظة…' : 'Text eingeben, um zu suchen…';
    assert(desktop.history.searchEntry.hint_text === search,
      'Layout acceptance must use the actual Arabic or German catalog, not untranslated fallback');
    desktop.settings.set_int('panel-width', 300);
    desktop.settings.set_int('panel-height', 240);
    desktop.settings.set_int('panel-visible-item-limit', 20);
    const target = await Target.open(desktop);
    let preferences;
    try {
      const items = [];
      const texts = Array.from({length: 12}, (_, index) =>
        `Layout ${index}: ` + 'العربية 日本語 한국어 中文 🙂🚀 — langer Text '.repeat(8));
      for (const text of texts) items.push(await capture(desktop, target, text));
      await desktop.open();
      assert(desktop.history.actor.get_text_direction() === (rtl ? Clutter.TextDirection.RTL : Clutter.TextDirection.LTR),
        `The actual Shell panel must adopt the selected locale direction (panel=${desktop.history.actor.get_text_direction()}; shell=${Main.panel.get_text_direction()}; locale=${GLib.getenv('LC_ALL')})`);
      const latest = items.at(-1);
      const row = desktop.history._itemRows.get(latest.id);
      const panel = rect(desktop.history.actor);
      for (const actor of row.focusActors.filter(actor => actor.visible)) {
        const bounds = rect(actor);
        assert(actor.mapped && bounds.width > 0 && bounds.height > 0
          && bounds.x >= panel.x - 1 && bounds.x + bounds.width <= panel.x + panel.width + 1,
        'Long mixed-script text must leave its content and action controls allocated inside the narrow panel');
      }
      await desktop.click(row.focusActors.find(actor => actor._clipboardXGnomeEntryAction === 'pin'));
      await until(() => latest.favorite, 'visible row action remains clickable with long localized content');
      await desktop.settle();
      await desktop.click(desktop.history._itemRows.get(latest.id).focusActors[0]);
      assert((await target.clipboard()).text === texts.at(-1),
        'Clicking truncated mixed-script content must copy the complete original in its original order');
      await desktop.open();
      const last = desktop.history._itemRows.get(items[0].id).focusActors[0];
      for (let step = 0; desktop.focus !== last && step < items.length + 3; step++)
        await desktop.key(Clutter.KEY_Down);
      assert(desktop.focus === last && desktop.history.scroll.get_vadjustment().value > 0,
        'Native vertical navigation must reach and scroll to the final long-text row in either direction');
      await desktop.settle();
      const viewport = rect(desktop.history.scroll);
      const bounds = rect(last);
      assert(bounds.y + bounds.height / 2 >= viewport.y
        && bounds.y + bounds.height / 2 <= viewport.y + viewport.height,
      'The final row must actually be within the scroll viewport before clicking');
      await desktop.click(last);
      assert((await target.clipboard()).text === texts[0],
        'Scrolling must preserve complete CJK, emoji and RTL text when copying the last row');
      await desktop.close();

      preferences = await Preferences.open(desktop);
      await preferences.page('general');
      const snapshot = await preferences.inspect();
      assert(snapshot.windows[0].widgets[0].direction === (rtl ? 'rtl' : 'ltr'),
        'Independent GTK preferences must adopt the actual locale direction');
      const description = 'Reopen the previous view instead of always returning to clipboard history';
      const {label: translated} = await preferences.translate({label: description});
      const control = {type: 'AdwSwitchRow', row: 'Preserve panel state'};
      await preferences.scrollTo(control);
      const visible = await preferences.find(control);
      assert(translated !== description && visible?.widget.subtitle === translated,
        'The translated long-description control must be reachable, not hidden beyond the settings viewport');
      const previous = desktop.settings.get_boolean('preserve-panel-state');
      await preferences.click(control);
      await until(() => desktop.settings.get_boolean('preserve-panel-state') === !previous,
        'A reachable long-description setting must remain operable in the selected locale');
    } finally { await preferences?.close(); await target.close(); }
  },
};
