import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {typingSample} from './samples.js';

const UUID = 'clipboard-x-gnome@guleoo.github.io';
const STATUS_AREA_NAME = 'clipboard-x-gnome';
const TEST_DIRECTORY = Gio.File.new_for_uri(import.meta.url).get_parent().get_path();
const TARGET_TITLE = 'Clipboard X Gnome Typing Target';

export const METRICS = {};

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

async function waitUntil(predicate, timeoutMilliseconds = 3000) {
  const deadline = GLib.get_monotonic_time() + timeoutMilliseconds * 1000;
  while (!predicate() && GLib.get_monotonic_time() < deadline)
    await Scripting.sleep(50);
  return predicate();
}

function targetWindow() {
  return global.get_window_actors()
    .map(actor => actor.meta_window)
    .find(window => window?.get_title() === TARGET_TITLE);
}

export async function run() {
  await Scripting.sleep(500);
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;

  const extension = Main.extensionManager.lookup(UUID);
  assert(extension?.enabled, `Clipboard X Gnome was not enabled (${extension?.error ?? 'unknown error'})`);
  await waitUntil(() => Boolean(Main.panel.statusArea[STATUS_AREA_NAME]));
  const terminalInput = extension.stateObj._terminalInput;
  assert(terminalInput, 'Clipboard X Gnome terminal input is unavailable');
  const settings = extension.stateObj._settings;
  const originalMode = settings.get_string('simulated-input-mode');
  settings.set_string('simulated-input-mode', 'keys');
  const originalModifierState = terminalInput._modifierState.bind(terminalInput);

  const [output, outputStream] = Gio.File.new_tmp('clipboard-x-gnome-typing-XXXXXX');
  outputStream.close(null);
  const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
  launcher.setenv('GDK_BACKEND', 'wayland', true);
  launcher.setenv('GTK_A11Y', 'none', true);
  launcher.setenv('NO_AT_BRIDGE', '1', true);
  const process = launcher.spawnv([
    '/usr/bin/gjs',
    '-m',
    GLib.build_filenamev([TEST_DIRECTORY, '..', '..', 'fixtures', 'typing-target.js']),
    output.get_path(),
  ]);

  try {
    assert(await waitUntil(() => Boolean(targetWindow())), 'Typing target window did not open');
    Main.overview.hide();
    Main.activateWindow(targetWindow());
    assert(await waitUntil(() => global.display.focus_window === targetWindow()),
      'Typing target window did not receive keyboard focus');
    await Scripting.sleep(200);

    const source = typingSample;
    await terminalInput.type(source);
    await Scripting.sleep(200);
    const [, contents] = output.load_contents(null);
    const actual = new TextDecoder().decode(contents);
    assert(actual === source,
      `Mixed-language simulated input changed character order (${actual.length}/${source.length})`);

    const pendingSuffix = 'x'.repeat(200);
    let manualModifiers = 0;
    terminalInput._modifierState = () => manualModifiers;
    const interrupted = terminalInput.type(pendingSuffix);
    const rejected = terminalInput.type('THIS_BUSY_INPUT_MUST_NOT_APPEAR').then(() => null, error => error);
    assert((await rejected)?.code === 'busy', 'Repeated input must be rejected instead of being queued');
    await Scripting.sleep(30);
    manualModifiers = Clutter.ModifierType.CONTROL_MASK;
    await interrupted;
    manualModifiers = 0;
    await Scripting.sleep(50);
    const [, interruptedContents] = output.load_contents(null);
    const interruptedText = new TextDecoder().decode(interruptedContents);
    assert(interruptedText.startsWith(source)
        && interruptedText.length < source.length + pendingSuffix.length
        && !interruptedText.includes('THIS_BUSY_INPUT_MUST_NOT_APPEAR'),
    'Physical keyboard input did not cancel the remaining simulated input');
    await Scripting.sleep(100);
    const [, settledContents] = output.load_contents(null);
    assert(new TextDecoder().decode(settledContents) === interruptedText,
      'Simulated input continued after cancellation');
  } finally {
    settings.set_string('simulated-input-mode', originalMode);
    terminalInput._modifierState = originalModifierState;
    targetWindow()?.delete(global.get_current_time());
    process.force_exit();
    output.delete(null);
  }
}
