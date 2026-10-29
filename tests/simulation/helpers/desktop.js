import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import {screenshot} from './diagnostics.js';

export const UUID = 'clipboard-x-gnome@guleoo.github.io';
export const pause = milliseconds => Scripting.sleep(milliseconds);
let startupWatchdog = 0;
export function init() {
  requireIsolation();
  print('[simulation] initializing isolated Shell automation');
  startupWatchdog = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30000, () => {
    startupWatchdog = 0;
    printerr(`[simulation] FAIL startup: startingUp=${Main.layoutManager._startingUp}; monitors=${Main.layoutManager.monitors.length}`);
    Meta.exit(Meta.ExitCode.ERROR);
    return GLib.SOURCE_REMOVE;
  });
}
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
export function block(message) {
  const error = new Error(message);
  error.name = 'SimulationBlocked';
  throw error;
}
export async function until(predicate, message, timeout = 5000) {
  const deadline = GLib.get_monotonic_time() + timeout * 1000;
  while (!predicate() && GLib.get_monotonic_time() < deadline) await pause(20);
  assert(predicate(), `Timeout: ${message}`);
}
export function rect(actor) {
  const [x, y] = actor.get_transformed_position();
  const [width, height] = actor.get_transformed_size();
  return {x, y, width, height};
}
export function inside(actor, root) {
  for (let current = actor; current; current = current.get_parent())
    if (current === root) return true;
  return false;
}

// Only the local runner may seed fixtures; refuse a host or Devkit session.
export function requireIsolation() {
  const runtime = GLib.getenv('CBX_SIMULATION_RUNTIME');
  assert(runtime?.startsWith('/tmp/clipboard-x-simulation-'), 'Use an isolated simulation runner, not a host Shell');
  for (const path of [GLib.get_user_data_dir(), GLib.get_user_config_dir(), GLib.get_user_cache_dir()])
    assert(path.startsWith(`${runtime}/`), 'Test XDG paths must belong to the private runtime');
}

export class Desktop {
  get tag() { return 'simulation'; }

  static async create() {
    requireIsolation();
    if (startupWatchdog) GLib.Source.remove(startupWatchdog);
    startupWatchdog = 0;
    await until(() => Main.panel.statusArea['clipboard-x-gnome'], 'extension enabled', 15000);
    const app = Main.extensionManager.lookup(UUID).stateObj;
    await app._startup;
    const session = new this(app);
    // Move a new virtual pointer off the hot corner before hiding Overview.
    await until(() => !Main.layoutManager._startingUp, 'Shell startup', 15000);
    session.pointer.notify_absolute_motion(GLib.get_monotonic_time(), global.stage.width / 2, global.stage.height / 2);
    await pause(30);
    print(`[${session.tag}] pointer initialized: ${global.get_pointer().slice(0, 2).join(',')}`);
    await session.move(global.stage.width / 2, global.stage.height - 100);
    Main.overview.hide();
    await until(() => !Main.overview.visible && !Main.overview.animationInProgress, 'Overview closed');
    await session.phrases.ready;
    session.defaults = new Map(session.settings.list_keys().map(key => [key, session.settings.get_value(key)]));
    return session;
  }

  constructor(app) {
    this.app = app;
    this.indicator = app._indicator;
    this.history = this.indicator._historyPanel;
    this.words = this.indicator._tokenizer;
    this.phrases = this.indicator._quickPhrases;
    this.settings = this.indicator._settings;
    this.manager = this.indicator._panelManager;
    const seat = global.stage.context.get_backend().get_default_seat();
    this.keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    this.pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    this.fixture = [];
  }

  get focus() { return global.stage.get_key_focus(); }

  async seed() {
    for (const item of [...this.app._controller.items]) this.app._controller.remove(item.id);
    await this.phrases.replace([]);
    await this.app._controller.persist();
  }

  async reset() {
    await this.close();
    for (const [key, value] of this.defaults) this.settings.set_value(key, value);
    this.settings.set_strv('panel-shortcut', ['<Control><Shift>F8']);
    this.settings.set_boolean('sync-enabled', false);
    this.settings.set_boolean('preserve-panel-state', false);
    this.manager.reset();
    this.history.resetSearch();
    this.phrases.hideForm();
    await this.seed();
    await this.move(global.stage.width / 2, global.stage.height - 50);
    await Scripting.waitLeisure();
  }

  async key(symbol, modifiers = []) {
    for (const modifier of modifiers)
      this.keyboard.notify_keyval(GLib.get_monotonic_time(), modifier, Clutter.KeyState.PRESSED);
    if (modifiers.length) await pause(25);
    this.keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.PRESSED);
    // Let the main loop observe the held key/modifiers before releasing them.
    // A zero-duration queued click reports a released global pointer mask even
    // while its earlier press handler is running on some Mutter versions.
    await pause(25);
    this.keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.RELEASED);
    if (modifiers.length) await pause(25);
    for (const modifier of [...modifiers].reverse())
      this.keyboard.notify_keyval(GLib.get_monotonic_time(), modifier, Clutter.KeyState.RELEASED);
    // Event spacing only. Completion assertions use until()/settle().
    await pause(25);
  }

  async type(text) {
    for (const character of text) await this.key(Clutter.unicode_to_keysym(character.codePointAt(0)));
  }

  async search(text) {
    await this.key(Clutter.KEY_f, [Clutter.KEY_Control_L]);
    await this.key(Clutter.KEY_a, [Clutter.KEY_Control_L]);
    await this.key(Clutter.KEY_BackSpace);
    await this.type(text);
    await until(() => this.history._query === text, 'native search input');
  }

  async move(x, y) {
    this.pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
    try {
      await until(() => {
        const [actualX, actualY] = global.get_pointer();
        return Math.abs(actualX - x) <= 1 && Math.abs(actualY - y) <= 1;
      }, `pointer motion delivered to ${x},${y}`);
    } catch (error) {
      throw new Error(`${error.message}; actual=${global.get_pointer().slice(0, 2)}; stage=${global.stage.width}x${global.stage.height}`);
    }
    await pause(25);
  }

  async pointClick(x, y) {
    await this.move(x, y);
    this.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    await pause(25);
    this.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    await pause(25);
  }

  async click(actor) {
    await until(() => actor.mapped && actor.width > 0 && actor.height > 0, 'click target allocated');
    const box = rect(actor);
    await this.pointClick(box.x + box.width / 2, box.y + box.height / 2);
  }

  shortcut() { return this.key(Clutter.KEY_F8, [Clutter.KEY_Control_L, Clutter.KEY_Shift_L]); }

  async open() {
    await this.close();
    await this.shortcut();
    await until(() => this.indicator.menu.isOpen && this.indicator.menu.actor.mapped, 'shortcut opens popup');
    await this.settle();
  }

  async close() {
    this.indicator.menu.close();
    await until(() => !this.indicator.menu.actor.visible, 'popup hidden');
  }

  async settle() {
    const panel = this.manager.is('history') ? this.history : this.manager.is('phrases') ? this.phrases : this.words;
    await until(() => !panel._focusIdleId && !panel.focusAnchor?._focusIdleId
      && !panel.scroll.get_vadjustment().get_transition('value')
      && ['opacity', 'scale-x', 'scale-y'].every(name => !this.indicator.menu.actor.get_transition(name)),
    'panel focus, scroll and popup transitions settled');
    await Scripting.waitLeisure();
  }

  async openWords() {
    await this.key(Clutter.KEY_f, [Clutter.KEY_Control_L]);
    await this.key(Clutter.KEY_Down);
    await this.key(Clutter.KEY_Right);
    await this.key(Clutter.KEY_Return);
    await until(() => this.manager.is('tokenizer') && !this.words.state?.loading, 'word action finishes loading');
    await this.settle();
  }

  async show(name) {
    this.manager.show(name, name === 'tokenizer'
      ? await this.words.createState(null, 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda') : null);
    await this.settle();
  }

  async check(id, run) {
    print(`[${this.tag}] START ${id}`);
    let keepAlive = null;
    let keepAliveError = null;
    const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
      if (!keepAlive) keepAlive = Scripting.waitTestWindows()
        .catch(error => { keepAliveError = error; })
        .finally(() => { keepAlive = null; });
      return GLib.SOURCE_CONTINUE;
    });
    try {
      // The native helper otherwise exits after 30 seconds without a D-Bus call.
      await Scripting.waitTestWindows();
      await this.reset();
      await run(this);
      await keepAlive;
      assert(!keepAliveError, `Native helper keepalive failed: ${keepAliveError?.message}`);
      print(`[${this.tag}] PASS ${id}`);
    } catch (error) {
      if (error.name === 'SimulationBlocked') {
        print(`[${this.tag}] BLOCKED ${id}: ${error.message}`);
        return;
      }
      const active = Main.panel.statusArea['clipboard-x-gnome'] === this.indicator;
      const box = active ? rect(this.indicator.menu.actor) : {};
      printerr(`[${this.tag}] FAIL ${id}: ${error.message}; panel=${active ? this.manager.currentName : 'disabled'}; focus=${this.focus?.accessible_name ?? this.focus}; popup=${box.x},${box.y},${box.width},${box.height}; actionMode=${Main.actionMode}; overview=${Main.overview.visible}`);
      try { await screenshot(id); } catch (diagnostic) { printerr(`[${this.tag}] Screenshot unavailable: ${diagnostic.message}`); }
      throw error;
    } finally {
      GLib.Source.remove(source);
    }
  }

  async destroy() {
    if (Main.extensionManager.lookup(UUID).state === ExtensionState.INACTIVE) {
      await this.app._shutdown;
      return;
    }
    const input = this.indicator._inputMode;
    const tooltip = this.indicator._tooltip;
    Main.extensionManager.disableExtension(UUID);
    await until(() => Main.extensionManager.lookup(UUID).state === ExtensionState.INACTIVE
      && !Main.panel.statusArea['clipboard-x-gnome'], 'extension fully disabled', 10000);
    await this.app._shutdown;
    assert(input._filterId === 0 && tooltip._timeoutId === 0, 'Disable must remove input and tooltip sources');
  }
}
