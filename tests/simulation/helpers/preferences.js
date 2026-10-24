import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, pause, until} from './desktop.js';

export class Preferences {
  static async open(desktop) {
    const prefs = new Preferences(desktop);
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    // GNOME's own preferences host exports the private Shew typelib/library.
    const libraries = ['/usr/lib/gnome-shell', '/usr/lib64/gnome-shell']
      .filter(path => GLib.file_test(path, GLib.FileTest.IS_DIR));
    launcher.setenv('GI_TYPELIB_PATH', [GLib.getenv('GI_TYPELIB_PATH'), ...libraries,
      ...libraries.map(path => `${path}/girepository-1.0`)].filter(Boolean).join(':'), true);
    launcher.setenv('LD_LIBRARY_PATH', [GLib.getenv('LD_LIBRARY_PATH'), ...libraries].filter(Boolean).join(':'), true);
    const script = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
      .get_child('fixtures').get_child('settings-app.js');
    prefs.process = launcher.spawnv(['gjs', '-m', script.get_path(), desktop.app.dir.get_uri(), prefs.directory]);
    try {
      await until(() => prefs.state.ready || prefs.state.error, 'full native preferences process', 15000);
      assert(prefs.state.ready, `Preferences bootstrap: ${prefs.state.error}`);
      await until(() => prefs.window('Clipboard X Gnome'), 'native preferences window');
      Main.activateWindow(prefs.window('Clipboard X Gnome'));
      await pause(100);
      return prefs;
    } catch (error) { await prefs.close(); throw error; }
  }

  constructor(desktop) {
    this.desktop = desktop;
    this.directory = GLib.dir_make_tmp('cbx-preferences-XXXXXX');
    this.command = 0;
    this.translations = new Map();
  }
  get state() {
    try {
      const [, bytes] = Gio.File.new_for_path(`${this.directory}/state.json`).load_contents(null);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch { return {}; }
  }
  window(title) { return global.get_window_actors().map(actor => actor.meta_window).find(window => window.get_title() === title); }
  async observe(action, parameters = {}) {
    const id = ++this.command;
    Gio.File.new_for_path(`${this.directory}/command.json`).replace_contents(
      new TextEncoder().encode(JSON.stringify({id, action, ...parameters})), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    await until(() => this.state.command === id, 'preferences observer snapshot');
    assert(!this.state.error, `Preferences observer: ${this.state.error}`);
    return this.state.result;
  }
  inspect() { return this.observe('inspect'); }
  async translate(selector) {
    const strings = ['row', 'label', 'tooltip'].filter(key => selector[key]).map(key => selector[key]);
    const missing = strings.filter(text => !this.translations.has(text));
    if (missing.length) {
      const values = await this.observe('translate', {strings: missing});
      missing.forEach((text, index) => this.translations.set(text, values[index]));
    }
    return Object.fromEntries(Object.entries(selector).map(([key, value]) =>
      [key, ['row', 'label', 'tooltip'].includes(key) ? this.translations.get(value) ?? value : value]));
  }
  async find(selector, {windowTitle = 'Clipboard X Gnome'} = {}) {
    selector = await this.translate(selector);
    const snapshot = await this.inspect();
    const window = snapshot.windows.find(value => value.title === windowTitle);
    assert(window, `Preferences observer window ${windowTitle}`);
    const widget = window.widgets.find(widget => widget.mapped && widget.sensitive && widget.bounds && widget.hit
      && Object.entries(selector).every(([key, value]) => widget[key] === value)
      && widget.bounds.y > 0 && widget.bounds.y + widget.bounds.height < Math.min(window.height, global.stage.height - 32));
    return widget ? {widget, snapshot: window} : null;
  }
  async click(selector, options = {}) {
    let result = await this.find(selector, options);
    if (!result) {
      await this.scrollTo(selector);
      result = await this.find(selector, options);
    }
    assert(result, `Native GTK target not visible: ${JSON.stringify(selector)}`);
    const window = this.window(options.windowTitle ?? 'Clipboard X Gnome');
    const frame = window.get_frame_rect();
    const buffer = window.get_buffer_rect();
    // compute_bounds(GtkWindow) uses widget coordinates, excluding the CSD
    // shadow that GdkSurface/get_buffer_rect may include.
    const origin = Math.abs(buffer.width - result.snapshot.width) < Math.abs(frame.width - result.snapshot.width) ? buffer : frame;
    const bounds = result.widget.bounds;
    await this.desktop.pointClick(origin.x + bounds.x + bounds.width / 2, origin.y + bounds.y + bounds.height / 2);
  }
  async page(name) {
    await this.click({page: name});
    for (let attempt = 0; attempt < 100; attempt++) {
      const snapshot = await this.inspect();
      if (snapshot.windows[0].widgets.some(widget => widget.type === 'GtkStack' && widget.visibleChild === name)) return;
      await pause(20);
    }
    throw new Error(`Native navigation must show ${name}`);
  }
  async scrollTo(selector) {
    selector = await this.translate(selector);
    for (let attempt = 0; attempt < 25; attempt++) {
      if (await this.find(selector)) return;
      const snapshot = await this.inspect();
      const target = snapshot.windows.find(window => window.title === 'Clipboard X Gnome')?.widgets
        .find(widget => widget.mapped && widget.bounds && Object.entries(selector).every(([key, value]) => widget[key] === value));
      const frame = this.window('Clipboard X Gnome').get_frame_rect();
      await this.desktop.move(frame.x + frame.width - 150, frame.y + frame.height / 2);
      this.desktop.pointer.notify_discrete_scroll(GLib.get_monotonic_time(), target?.bounds.y < 0
        ? Clutter.ScrollDirection.UP : Clutter.ScrollDirection.DOWN, Clutter.ScrollSource.WHEEL);
      await pause(40);
    }
    const snapshot = await this.inspect();
    const candidates = snapshot.windows[0]?.widgets.filter(widget => widget.type === selector.type
      && Object.entries(selector).some(([key, value]) => key !== 'type' && widget[key] === value))
      .map(({row, label, mapped, sensitive, bounds}) => ({row, label, mapped, sensitive, bounds}));
    throw new Error(`GTK row not reachable by scrolling: ${JSON.stringify(selector)}; candidates=${JSON.stringify(candidates)}`);
  }
  async input(row, text) {
    await this.scrollTo({type: 'GtkText', row});
    await this.click({type: 'GtkText', row});
    await this.desktop.key(Clutter.KEY_a, [Clutter.KEY_Control_L]);
    if (text) await this.desktop.type(text);
    else await this.desktop.key(Clutter.KEY_BackSpace);
    const selector = await this.translate({row});
    const snapshot = await this.inspect();
    const actual = snapshot.windows[0].widgets.find(widget => widget.type === 'GtkText' && widget.row === selector.row)?.text;
    assert(actual === text, `Native entry ${row} must contain its typed input (actual=${JSON.stringify(actual)})`);
  }
  async close() {
    if (!this.process) return;
    this.window('Clipboard X Gnome')?.delete(global.get_current_time());
    await pause(100);
    this.process.force_exit();
    await new Promise(resolve => this.process.wait_async(null, (object, result) => { object.wait_finish(result); resolve(); }));
    this.process = null;
  }
}
