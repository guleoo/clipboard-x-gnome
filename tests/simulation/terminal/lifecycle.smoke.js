import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};
const UUID = 'clipboard-x-gnome@guleoo.github.io';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

async function waitUntil(predicate, message) {
  const deadline = GLib.get_monotonic_time() + 2_000_000;
  while (!predicate() && GLib.get_monotonic_time() < deadline)
    await Scripting.sleep(1);
  assert(predicate(), message);
}

async function drains(promise, message) {
  let source = 0;
  try {
    return await Promise.race([promise, new Promise((_resolve, reject) => {
      source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        source = 0;
        reject(new Error(typeof message === 'function' ? message() : message));
        return GLib.SOURCE_REMOVE;
      });
    })]);
  } finally {
    if (source)
      GLib.Source.remove(source);
  }
}

function destroyAndCheck(input) {
  const sources = [...input._sources.keys()];
  assert(sources.length > 0, 'The operation completed before its cancellation boundary');
  input.destroy();
  assert(input._sources.size === 0 && input._eventFilterId === 0 && input._device === null,
    'Destroy must synchronously release timers, event filter and virtual keyboard');
  assert(sources.every(source => !GLib.MainContext.default().find_source_by_id(source)),
    'Destroy must remove actual GLib sources, not only forget their IDs');
  input.destroy();
}

function isolatedInput(TerminalInput, options = {}) {
  const input = new TerminalInput(options);
  const target = {window: {}, focus: {}};
  input._currentTarget = () => target;
  return input;
}

export async function verify(TerminalInput) {
  for (const phase of ['settle', 'character-delay', 'modifiers', 'notification']) {
    let characters = 0;
    let notifications = 0;
    let modifierReads = 0;
    let cancelled = false;
    let reached = false;
    let charactersAtDestroy = 0;
    let readsAtDestroy = 0;
    const input = isolatedInput(TerminalInput, {
      speed: () => 'slow',
      onCancelled: () => { notifications++; },
    });
    input._modifierState = () => {
      modifierReads++;
      return phase === 'modifiers' ? Clutter.ModifierType.CONTROL_MASK : 0;
    };
    // Exercise real GLib sources and the real virtual-device lifecycle without
    // sending test keystrokes into the desktop or conflating target IM issues.
    input._typeCharacter = () => { characters++; };
    const cancel = input._cancelTyping.bind(input);
    input._cancelTyping = () => {
      const result = cancel();
      cancelled ||= result;
      return result;
    };
    const describe = () => `${phase}: characters=${characters}; modifierReads=${modifierReads}; `
      + `sources=${input._sources.size}; cancelled=${cancelled}; `
      + `preedit=${Main.inputMethod.hasPreedit()}; destroyed=${input._destroyed}`;
    const wait = input._wait.bind(input);
    input._wait = delay => {
      const pending = wait(delay);
      if (!reached && (phase !== 'character-delay' || characters === 1)) {
        // Observe registration synchronously, while the real source is still
        // alive. Do not race a polling timer against the character delay.
        assert(input._typing && input._sources.size > 0, `Missing input wait; ${describe()}`);
        if (phase === 'notification') {
          assert(input._cancelTypingWithNotification(), 'Cancellation must schedule its notification');
          assert(input._sources.size === 2, 'Both pending wait and notification must be registered');
        }
        charactersAtDestroy = characters;
        readsAtDestroy = modifierReads;
        destroyAndCheck(input);
        reached = true;
      }
      return pending;
    };
    try {
      // Attach both handlers immediately: an early rejection must not become
      // an unhandled rejection or be hidden behind a generic polling timeout.
      const active = input.type('中文').then(() => ({error: null}), error => ({error}));
      const duplicate = input.type('DUPLICATE').then(() => false, error => error.code === 'busy');
      const paste = input.paste().then(() => false, error => error.code === 'busy');
      assert(await duplicate && await paste, 'An active input operation must reject duplicate typing and paste');
      const outcome = await drains(active, () => `Input task did not settle; ${describe()}`);
      if (outcome.error)
        throw new Error(`Input failed (${outcome.error.code ?? outcome.error.name}): `
          + `${outcome.error.message}; ${describe()}`, {cause: outcome.error});
      assert(reached, `Input ${cancelled ? 'was cancelled' : 'completed'} before its cancellation boundary; ${describe()}`);
      assert(input._sources.size === 0 && !input._typing && !input._monitoring,
        `${phase}: active work created a source after destruction`);
      assert(characters === charactersAtDestroy && modifierReads === readsAtDestroy && notifications === 0,
        `${phase}: destroyed work emitted input, polled modifiers or delivered a cancellation notification`);
      input._speed = () => { throw new Error('Destroyed input must not read disposed settings'); };
      await drains(Promise.all([input.type('AFTER_DESTROY'), input.paste(), input._queue]),
        'Calls after destruction must settle without creating new work');
      print(`Clipboard X Gnome [terminal-lifecycle] ${phase}: released sources and drained active input`);
    } finally {
      input.destroy();
    }
  }

  for (const changed of ['window', 'focus']) {
    const input = isolatedInput(TerminalInput);
    const original = input._currentTarget();
    let target = original;
    const characters = [];
    input._currentTarget = () => target;
    input._modifierState = () => 0;
    input._prepare = async () => true;
    input._typeCharacter = character => {
      characters.push(character);
      target = {...original, [changed]: {}};
    };
    try {
      const error = await input.type('AB').then(() => null, failure => failure);
      assert(error?.code === 'focus_changed' && characters.join('') === 'A',
        `Keystrokes must stop before entering another ${changed}`);
      target = original;
      await input.type('C');
      assert(characters.join('') === 'AC', 'An aborted input must release the busy gate for a new explicit request');
    } finally {
      input.destroy();
    }
  }

  const disconnected = isolatedInput(TerminalInput);
  const charactersWithoutFocus = [];
  disconnected._currentTarget = () => ({window: disconnected._targetWindow, focus: null});
  disconnected._targetWindow = {};
  disconnected._modifierState = () => 0;
  disconnected._prepare = async () => true;
  disconnected._typeCharacter = character => charactersWithoutFocus.push(character);
  try {
    await disconnected.type('A中');
    assert(charactersWithoutFocus.join('') === 'A中',
      'Keystrokes must work without a GNOME text-input connection');
  } finally {
    disconnected.destroy();
  }

  let prepared;
  let chords = 0;
  const paste = new TerminalInput();
  paste._prepare = () => new Promise(resolve => { prepared = resolve; });
  paste._chord = () => { chords++; };
  try {
    const pending = paste.paste();
    await waitUntil(() => Boolean(prepared), 'Paste did not begin preparing');
    // A successful prepare result can already be queued when disable runs.
    prepared(true);
    paste.destroy();
    await drains(pending, 'Destroy after paste preparation stranded its Promise');
    assert(chords === 0, 'A paste continuation must not emit a chord after destruction');
  } finally {
    paste.destroy();
  }

  let held = true;
  let releaseModifierReads = 0;
  const characters = [];
  const released = isolatedInput(TerminalInput);
  released._modifierState = () => {
    releaseModifierReads++;
    return held ? Clutter.ModifierType.CONTROL_MASK : 0;
  };
  released._typeCharacter = character => characters.push(character);
  try {
    const active = released.type('A中');
    await waitUntil(() => released._sources.size > 0 && releaseModifierReads >= 2,
      'Held modifiers must keep input polling before release');
    assert(characters.length === 0, 'Held trigger modifiers must prevent character output');
    held = false;
    await drains(active, 'Released modifiers must allow normal typing to finish');
    assert(characters.join('') === 'A中' && released._sources.size === 0,
      'Normal modifier release must preserve character order and release all wait sources');
  } finally {
    released.destroy();
  }

  let notifications = 0;
  const input = isolatedInput(TerminalInput, {onCancelled: () => {
    notifications++;
    // The idle must have forgotten its own ID before reentrant destruction.
    input.destroy();
  }});
  input._modifierState = () => 0;
  input._typeCharacter = () => {};
  try {
    const active = input.type('x');
    await waitUntil(() => Boolean(input._typing) && input._sources.size > 0, 'Input did not start');
    assert(input._cancelTypingWithNotification() && !input._cancelTypingWithNotification(),
      'Only the first cancellation must schedule a notification');
    await drains(active, 'Normal cancellation did not settle');
    assert(notifications === 1 && input._sources.size === 0,
      'A live cancellation notification must run once and release its source');
  } finally {
    input.destroy();
  }
  print('Clipboard X Gnome [terminal-lifecycle] passed');
}

export async function run() {
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;
  const extension = Main.extensionManager.lookup(UUID).stateObj;
  await extension._startup;
  try {
    const {TerminalInput} = await import(`${extension.dir.get_uri()}/clipboard/terminal/input.js`);
    await verify(TerminalInput);
  } finally {
    Main.extensionManager.disableExtension(UUID);
    await extension._shutdown;
  }
}
