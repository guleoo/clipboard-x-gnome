import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, block, pause, until} from '../helpers/desktop.js';
import {Preferences} from '../helpers/preferences.js';
import {Target} from '../helpers/target.js';
import {capture} from '../clipboard/native.js';
import {screenshot} from '../helpers/diagnostics.js';
import {restart} from '../helpers/restart.js';

const first = '青铜机械海豚';
const second = '紫色量子汤圆';
function write(path, text) {
  Gio.File.new_for_path(path).replace_contents(new TextEncoder().encode(text), null, false,
    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}
function dictionary(name, word, locale = 'zh_CN') { return `# locale: ${locale}\n# name: ${name}\n${word} 1000000\n`; }
async function focus(preferences) {
  Main.activateWindow(preferences.window('Clipboard X Gnome'));
  await pause(50);
}
async function words(desktop, target, text) {
  const item = await capture(desktop, target, text);
  await desktop.open();
  await desktop.click(desktop.history._itemRows.get(item.id).focusActors
    .find(actor => actor._clipboardXGnomeEntryAction === 'tokenize'));
  await until(() => desktop.manager.is('tokenizer') && desktop.words.state?.source === text, 'actual dictionary-backed word panel');
  const values = desktop.words.state.tokens.map(token => token.text);
  await desktop.close();
  desktop.manager.reset();
  return values;
}
async function importFile(desktop, preferences, path, name) {
  await focus(preferences);
  await preferences.scrollTo({type: 'GtkButton', label: 'Import…'});
  await preferences.click({type: 'GtkButton', label: 'Import…'});
  await until(() => global.display.focus_window && global.display.focus_window !== preferences.window('Clipboard X Gnome'),
    'real file chooser focused', 10000);
  await desktop.key(Clutter.KEY_l, [Clutter.KEY_Control_L]);
  await desktop.key(Clutter.KEY_a, [Clutter.KEY_Control_L]);
  await desktop.type(path);
  await desktop.key(Clutter.KEY_Return);
  // The Nautilus portal can navigate to the parent without selecting the file.
  // Each import folder contains only its fixture, so End selects that file once
  // the async listing arrives. GTK's chooser may have accepted it already.
  for (let attempt = 0; attempt < 20
    && global.display.focus_window !== preferences.window('Clipboard X Gnome'); attempt++) {
    await pause(100);
    await desktop.key(Clutter.KEY_End);
    await desktop.key(Clutter.KEY_Return);
  }
  try {
    await until(() => global.display.focus_window === preferences.window('Clipboard X Gnome'),
      `file picker accepts private dictionary (focus=${global.display.focus_window?.get_title()})`, 10000);
  } catch (error) { await screenshot('DICT-picker'); throw error; }
  await preferences.scrollTo({type: 'GtkSwitch', row: name});
}
async function fixture(desktop, run) {
  assert(GLib.get_language_names().some(name => /^zh/i.test(name)), 'Dictionary UI cases require a real Chinese process locale');
  const preferences = await Preferences.open(desktop);
  let target;
  const {DictionaryStore} = await import(`${desktop.app.dir.get_uri()}/clipboard/tokenizer/dictionary/store.js`);
  const store = new DictionaryStore();
  const original = new Set((await store.list()).map(value => value.fileName));
  try {
    await preferences.page('clipboard');
    target = await Target.open(desktop);
    await run({preferences, target, store});
  } finally {
    await target?.close();
    await preferences.close();
    for (const file of await store.list())
      if (!original.has(file.fileName)) await store.remove(file.fileName);
  }
}

class Endpoint {
  static async open({tls = false} = {}) {
    const endpoint = new Endpoint();
    endpoint.set(dictionary('Network Native', first));
    if (tls) {
      const certificate = Gio.Subprocess.new(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', `${endpoint.directory}/key.pem`, '-out', `${endpoint.directory}/cert.pem`, '-days', '1',
        '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
      Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
      await new Promise((resolve, reject) => certificate.wait_check_async(null, (source, result) => {
        try { source.wait_check_finish(result); resolve(); } catch (error) { reject(error); }
      }));
    }
    const file = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
      .get_child('fixtures').get_child('dictionary-http.py');
    endpoint.process = Gio.Subprocess.new(['python3', file.get_path(), endpoint.directory, ...(tls ? ['--tls'] : [])], Gio.SubprocessFlags.NONE);
    try {
      await until(() => endpoint.state.port, 'owned dictionary endpoint');
      endpoint.address = `${tls ? 'https' : 'http'}://127.0.0.1:${endpoint.state.port}/native.dict`;
      return endpoint;
    } catch (error) { await endpoint.close(); throw error; }
  }
  constructor() { this.directory = GLib.dir_make_tmp('cbx-dictionary-http-XXXXXX'); }
  get state() {
    try {
      const [, bytes] = Gio.File.new_for_path(`${this.directory}/state.json`).load_contents(null);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch { return {requests: 0}; }
  }
  set(text, status = 200) { write(`${this.directory}/response.json`, JSON.stringify({text, status})); }
  async close() {
    if (!this.process) return;
    this.process.force_exit();
    await new Promise(resolve => this.process.wait_async(null, (object, result) => { object.wait_finish(result); resolve(); }));
    this.process = null;
  }
}

export const cases = {
  'DICT-08': desktop => fixture(desktop, async ({preferences, target, store}) => {
    const existing = new Set(global.get_window_actors().map(actor => actor.meta_window));
    const directory = `${GLib.getenv('CBX_SIMULATION_RUNTIME')}/dictionary-editor-input`;
    GLib.mkdir_with_parents(directory, 0o700);
    const path = `${directory}/source.txt`;
    write(path, dictionary('Native Editor', first));
    try {
      await importFile(desktop, preferences, path, 'Native Editor');
      const entry = (await store.list()).find(value => value.name === 'Native Editor');
      const file = store.getFile(entry.fileName);
      const contentType = file.query_info('standard::content-type', Gio.FileQueryInfoFlags.NONE, null).get_content_type();
      assert(Gio.DesktopAppInfo.new('org.gnome.TextEditor.desktop')?.set_as_default_for_type(contentType),
        'Private XDG MIME association must select the real installed text editor');
      await preferences.click({type: 'GtkButton', row: 'Native Editor', tooltip: 'Edit dictionary'});
      let editor;
      // The writable OpenURI portal may still ask to confirm its default app.
      // Our private MIME association makes the real Text Editor the selection.
      for (let attempt = 0; attempt < 5; attempt++) {
        if (global.get_window_actors().some(actor => /texteditor|text-editor/i.test(actor.meta_window.get_wm_class() ?? ''))) break;
        await pause(200);
        await desktop.key(Clutter.KEY_o, [Clutter.KEY_Alt_L]);
      }
      await until(() => {
        editor = global.get_window_actors().map(actor => actor.meta_window).find(window => !existing.has(window)
          && /texteditor|text-editor/i.test(window.get_wm_class() ?? ''));
        return Boolean(editor);
      }, 'actual default text editor opened the dictionary', 15000);
      await target.offer(dictionary('Native Editor', second));
      Main.activateWindow(editor);
      await until(() => global.display.focus_window === editor && !Main.overview.visible,
        'actual editor focused outside overview before native replacement');
      const frame = editor.get_frame_rect();
      await desktop.pointClick(frame.x + frame.width / 2, frame.y + frame.height / 2);
      await desktop.key(Clutter.KEY_a, [Clutter.KEY_Control_L]);
      await desktop.key(Clutter.KEY_v, [Clutter.KEY_Control_L]);
      await desktop.key(Clutter.KEY_s, [Clutter.KEY_Control_L]);
      await until(() => {
        const [, bytes] = file.load_contents(null);
        return new TextDecoder().decode(bytes).includes(second);
      }, 'native editor saved the actual managed dictionary');
      assert((await words(desktop, target, second)).includes(second), 'Directory monitoring must reload a real editor save without a manual revision bump');
      await focus(preferences);
      await preferences.click({type: 'GtkButton', row: 'Native Editor', tooltip: 'Open containing folder'});
      await until(() => global.get_window_actors().some(actor => !existing.has(actor.meta_window)
        && /nautilus/i.test(actor.meta_window.get_wm_class() ?? '')
        && actor.meta_window.get_title()?.includes('dictionaries')), 'actual file manager opened the managed directory', 15000);
      await focus(preferences);
      await preferences.click({type: 'GtkButton', row: 'Native Editor', tooltip: 'Remove dictionary'});
      await until(() => !file.query_exists(null), 'native dictionary removal deletes its file');
      assert(!(await words(desktop, target, second)).includes(second), 'Removing the dictionary must invalidate its actual segmentation source');
    } catch (error) {
      await screenshot('DICT-editor');
      throw error;
    } finally {
      for (const actor of global.get_window_actors()) {
        const window = actor.meta_window;
        if (!existing.has(window) && /texteditor|text-editor|nautilus/i.test(window.get_wm_class() ?? '')) window.delete(global.get_current_time());
      }
    }
  }),

  'DICT-02': desktop => fixture(desktop, async ({preferences, target, store}) => {
    for (const [name, word] of [['Native A', first], ['Native B', second]]) {
      const directory = `${GLib.getenv('CBX_SIMULATION_RUNTIME')}/dictionary-inputs/${name.replaceAll(' ', '-')}`;
      GLib.mkdir_with_parents(directory, 0o700);
      const path = `${directory}/source.txt`;
      write(path, dictionary(name, word));
      await importFile(desktop, preferences, path, name);
    }
    const japanese = `${GLib.getenv('CBX_SIMULATION_RUNTIME')}/dictionary-inputs/japanese`;
    GLib.mkdir_with_parents(japanese, 0o700);
    write(`${japanese}/source.txt`, dictionary('Native Japanese', '青空機械海豚', 'ja'));
    // Import language belongs to the declared file, not the language currently
    // displayed in the list. The actual chooser is still used for this import.
    await focus(preferences);
    await preferences.scrollTo({type: 'AdwComboRow', row: 'Dictionary language'});
    const selector = await preferences.translate({row: 'Dictionary language'});
    const originalLocale = (await preferences.inspect()).windows[0].widgets
      .find(widget => widget.type === 'AdwComboRow' && widget.row === selector.row).selected;
    await preferences.choice('Dictionary language', originalLocale === 0 ? 1 : 0);
    await importFile(desktop, preferences, `${japanese}/source.txt`, 'Native Japanese');
    let rows = (await preferences.inspect()).windows[0].widgets;
    assert(rows.some(widget => widget.row === 'Native Japanese') && !rows.some(widget => widget.row === 'Native A'),
      'Switching the real language dropdown must show only its corresponding imported files');
    await preferences.choice('Dictionary language', originalLocale);
    await preferences.scrollTo({type: 'GtkSwitch', row: 'Native A'});
    rows = (await preferences.inspect()).windows[0].widgets;
    assert(!rows.some(widget => widget.row === 'Native Japanese'), 'Returning to the display language must remove the other language rows');
    await preferences.scrollTo({type: 'GtkSwitch', row: 'System word segmenter'});
    await preferences.click({type: 'GtkSwitch', row: 'System word segmenter'});
    let result = await words(desktop, target, first + second);
    assert(result.includes(first) && result.includes(second), 'Both enabled imported dictionaries must affect the actual panel');
    await focus(preferences);
    await preferences.scrollTo({type: 'GtkSwitch', row: 'Native A'});
    await preferences.click({type: 'GtkSwitch', row: 'Native A'});
    result = await words(desktop, target, first + second);
    assert(!result.includes(first) && result.includes(second), 'Disabling one dictionary must retain the other actual word source');
    await focus(preferences);
    await preferences.scrollTo({type: 'GtkSwitch', row: 'Native B'});
    await preferences.click({type: 'GtkSwitch', row: 'Native B'});
    assert((await preferences.find({type: 'GtkSwitch', row: 'Native B'})).widget.active,
      'Native UI must not disable the final available word source');
    assert((await store.list()).length === 3, 'Switching sources or list languages must not remove imported files');
  }),

  'DICT-06': desktop => fixture(desktop, async ({preferences, target, store}) => {
    const endpoint = await Endpoint.open();
    try {
      const supported = await new Promise((resolve, reject) => Gio.File.new_for_uri(endpoint.address).query_info_async(
        'standard::size', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (source, result) => {
          try { source.query_info_finish(result); resolve(true); } catch (error) {
            if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_SUPPORTED)) resolve(false); else reject(error);
          }
        }));
      if (!supported) block('The isolated desktop has no GVfs HTTP backend for dictionary downloads');
      const baseline = endpoint.state.requests;
      await words(desktop, target, '词库网络不会自动访问');
      await focus(preferences);
      await preferences.scrollTo({type: 'GtkButton', label: 'Add network location'});
      assert(endpoint.state.requests === baseline, 'Opening preferences and word selection must not fetch an unrequested dictionary');
      await preferences.click({type: 'GtkButton', label: 'Add network location'});
      await preferences.input('HTTP(S) URL', endpoint.address);
      await preferences.click({type: 'GtkButton', label: 'Add'});
      await preferences.scrollTo({type: 'GtkButton', row: 'Network Native', tooltip: 'Refresh dictionary'});
      assert(endpoint.state.requests > baseline, 'Actual network Add must fetch through the production downloader');
      assert((await words(desktop, target, first)).includes(first), 'Downloaded word must be used in the actual panel');
      await focus(preferences);
      endpoint.set(dictionary('Network Native', second));
      await preferences.scrollTo({type: 'GtkButton', row: 'Network Native', tooltip: 'Refresh dictionary'});
      const revision = desktop.settings.get_uint('tokenizer-dictionary-revision');
      await preferences.click({type: 'GtkButton', row: 'Network Native', tooltip: 'Refresh dictionary'});
      await until(() => desktop.settings.get_uint('tokenizer-dictionary-revision') > revision,
        'real refresh completes and invalidates tokenizer revision');
      assert((await words(desktop, target, second)).includes(second), 'Explicit native refresh must invalidate the actual tokenizer cache');
      const entry = (await store.list()).find(value => value.name === 'Network Native');
      const [, previous] = store.getFile(entry.fileName).load_contents(null);
      endpoint.set('invalid file without language declaration');
      await focus(preferences);
      await preferences.click({type: 'GtkButton', row: 'Network Native', tooltip: 'Refresh dictionary'});
      await preferences.scrollTo({type: 'GtkButton', label: 'Close'});
      await preferences.click({type: 'GtkButton', label: 'Close'});
      const [, current] = store.getFile(entry.fileName).load_contents(null);
      assert(GLib.base64_encode(previous) === GLib.base64_encode(current), 'Invalid refresh must preserve the previous actual dictionary file');
      endpoint.set('temporary endpoint failure', 503);
      await preferences.click({type: 'GtkButton', row: 'Network Native', tooltip: 'Refresh dictionary'});
      await preferences.scrollTo({type: 'GtkButton', label: 'Close'});
      await preferences.click({type: 'GtkButton', label: 'Close'});
      assert(GLib.base64_encode(previous) === GLib.base64_encode(store.getFile(entry.fileName).load_contents(null)[1]),
        'A real HTTP failure must preserve the last downloaded dictionary bytes');
      endpoint.set(dictionary('Network Native Japanese', '青空機械海豚', 'ja'));
      await preferences.click({type: 'GtkButton', row: 'Network Native', tooltip: 'Refresh dictionary'});
      let changed;
      for (let attempt = 0; attempt < 200; attempt++) {
        changed = (await store.list()).find(value => value.source === endpoint.address && value.locale === 'ja');
        if (changed) break;
        await pause(25);
      }
      assert(changed && !store.getFile(entry.fileName).query_exists(null),
        'A real refresh changing declared language must replace, rather than duplicate, its managed file');
      const selector = await preferences.translate({row: 'Dictionary language'});
      const originalLocale = (await preferences.inspect()).windows[0].widgets
        .find(widget => widget.type === 'AdwComboRow' && widget.row === selector.row).selected;
      await preferences.choice('Dictionary language', originalLocale === 0 ? 1 : 0);
      await preferences.scrollTo({type: 'GtkButton', row: 'Network Native Japanese', tooltip: 'Refresh dictionary'});
      endpoint.set(dictionary('Network Native', second));
      await preferences.click({type: 'GtkButton', row: 'Network Native Japanese', tooltip: 'Refresh dictionary'});
      for (let attempt = 0; attempt < 200; attempt++) {
        changed = (await store.list()).find(value => value.source === endpoint.address && value.locale === 'zh_cn');
        if (changed) break;
        await pause(25);
      }
      assert(changed, 'Refreshing from another list language must restore the declared Chinese dictionary');
      await preferences.choice('Dictionary language', originalLocale);
      await preferences.scrollTo({type: 'GtkButton', row: 'Network Native', tooltip: 'Refresh dictionary'});
      const count = endpoint.state.requests;
      assert((await words(desktop, target, second)).includes(second), 'Previous dictionary remains usable after failed refresh');
      await focus(preferences);
      await preferences.page('general');
      await preferences.page('clipboard');
      await pause(150);
      assert(endpoint.state.requests === count, 'Reopening pages and word selection must not silently refresh network dictionaries');
      await preferences.close();
      await restart(desktop);
      const reopened = await Preferences.open(desktop);
      try {
        await reopened.page('clipboard');
        await reopened.scrollTo({type: 'GtkSwitch', row: 'Network Native'});
        assert((await words(desktop, target, second)).includes(second), 'Saved network dictionary must work after a real extension restart');
        assert(endpoint.state.requests === count,
          'Reopening the full preferences process and re-enabling the real extension must not fetch an existing network dictionary');
        await focus(reopened);
        await reopened.scrollTo({type: 'GtkButton', row: 'Network Native', tooltip: 'Remove dictionary'});
        await reopened.click({type: 'GtkButton', row: 'Network Native', tooltip: 'Remove dictionary'});
        for (let attempt = 0; attempt < 100 && store.getFile(changed.fileName).query_exists(null); attempt++) await pause(20);
        assert(!store.getFile(changed.fileName).query_exists(null), 'Native removal must delete the actual imported network file');
      } finally { await reopened.close(); }
    } finally { await endpoint.close(); }
  }),

  'DICT-06-https': desktop => fixture(desktop, async ({preferences, store}) => {
    const endpoint = await Endpoint.open({tls: true});
    const before = (await store.list()).map(entry => entry.fileName).sort().join();
    try {
      const failure = await new Promise(resolve => Gio.File.new_for_uri(endpoint.address).query_info_async(
        'standard::size', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (source, result) => {
          try { source.query_info_finish(result); resolve(null); } catch (error) { resolve(error); }
        }));
      if (failure?.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_SUPPORTED))
        block('The isolated desktop has no GVfs HTTPS backend');
      assert(failure && (/TLS|SSL|certificate|证书|証明書|인증서/iu.test(failure.message)
        || failure.matches?.(Gio.TlsError, Gio.TlsError.BAD_CERTIFICATE)),
      `The actual HTTPS backend must reject the untrusted certificate, not fail for an unrelated reason (${failure?.message})`);
      await preferences.scrollTo({type: 'GtkButton', label: 'Add network location'});
      await preferences.click({type: 'GtkButton', label: 'Add network location'});
      await preferences.input('HTTP(S) URL', endpoint.address);
      await preferences.click({type: 'GtkButton', label: 'Add'});
      await preferences.scrollTo({type: 'GtkButton', label: 'Close'});
      await preferences.click({type: 'GtkButton', label: 'Close'});
      assert((await store.list()).map(entry => entry.fileName).sort().join() === before,
        'Untrusted HTTPS must report its actual TLS failure without creating a dictionary or silently falling back to HTTP');
      assert(endpoint.state.requests === 0, 'An untrusted TLS peer must not receive a plaintext dictionary request');
    } finally { await endpoint.close(); }
  }),

  'DICT-09': desktop => fixture(desktop, async ({preferences, target, store}) => {
    const directory = `${GLib.getenv('CBX_SIMULATION_RUNTIME')}/large-dictionary-input`;
    GLib.mkdir_with_parents(directory, 0o700);
    const text = '# locale: zh_CN\n# name: Large Native Dictionary\n'
      + Array.from({length: 120000}, (_, index) => `性能词${String.fromCodePoint(0x4e00 + index % 2000)}${String.fromCodePoint(0x4e00 + Math.floor(index / 2000))} 10\n`).join('')
      + `${first} 1000000\n${second} 1000000\n`;
    write(`${directory}/large.txt`, text);
    let last = GLib.get_monotonic_time();
    let maximumGap = 0;
    let samples = 0;
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
      const now = GLib.get_monotonic_time();
      maximumGap = Math.max(maximumGap, (now - last) / 1000);
      last = now;
      samples++;
      return GLib.SOURCE_CONTINUE;
    });
    try {
      const started = GLib.get_monotonic_time();
      await importFile(desktop, preferences, `${directory}/large.txt`, 'Large Native Dictionary');
      assert((await store.list()).find(value => value.name === 'Large Native Dictionary')?.entryCount === 120002,
        'The actual native import must retain all large-dictionary entries');
      const importedAt = GLib.get_monotonic_time();
      const cold = await words(desktop, target, first + second);
      assert(cold.includes(first) && cold.includes(second), 'Actual first word-panel activation must use the large imported index');
      const coldAt = GLib.get_monotonic_time();
      const warm = await words(desktop, target, first + second);
      assert(warm.join('|') === cold.join('|'), 'Repeated actual activation must retain correct cached segmentation');
      await pause(30);
      print(`[simulation] DICT-09 entries=120002 importMs=${Math.round((importedAt - started) / 1000)} coldMs=${Math.round((coldAt - importedAt) / 1000)} warmMs=${Math.round((GLib.get_monotonic_time() - coldAt) / 1000)} maximumLoopGapMs=${Math.round(maximumGap)} samples=${samples}`);
      assert(samples > 10 && maximumGap < 1000, `Large dictionary import/indexing must keep the actual Shell responsive (maximum gap ${Math.round(maximumGap)} ms)`);
    } finally { GLib.Source.remove(timer); }
  }),
};
