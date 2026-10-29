import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import IBus from 'gi://IBus';
import {getIBusManager} from 'resource:///org/gnome/shell/misc/ibusManager.js';
import {getInputSourceManager} from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import {assert, pause, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {trigger} from './native.js';

function inputMode(source) {
  const properties = source?.properties;
  if (!properties) return null;
  for (let index = 0; properties.get(index); index++) {
    const property = properties.get(index);
    if (property.get_key() === 'InputMode') return property;
  }
  return null;
}

function modeValue(source) {
  const property = inputMode(source);
  return property ? JSON.stringify([property.get_state(), property.get_icon(),
    property.get_label()?.get_text(), property.get_symbol()?.get_text()]) : null;
}

async function clear(desktop, target) {
  await target.focus();
  await desktop.key(Clutter.KEY_Escape);
  await until(() => target.state.preedit === '', 'previous IME composition cancelled');
  await target.call('clear');
}

export const cases = {
  async 'TYPE-08-ime'(desktop) {
    desktop.settings.set_string('simulated-input-mode', 'keys');
    const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.input-sources'});
    const sources = settings.get_value('sources');
    const manager = getInputSourceManager();
    const ibus = getIBusManager();
    const original = manager.currentSource && {type: manager.currentSource.type, id: manager.currentSource.id};
    const target = await Target.open(desktop);
    try {
      await until(() => ibus.getEngineDesc('libpinyin'), 'installed real libpinyin engine registered with Shell', 15000);
      settings.set_value('sources', new GLib.Variant('a(ss)', [['xkb', 'us'], ['ibus', 'libpinyin']]));
      await until(() => Object.values(manager.inputSources).some(source => source.type === 'ibus' && source.id === 'libpinyin'),
        'real private libpinyin input source');
      Object.values(manager.inputSources).find(source => source.type === 'ibus' && source.id === 'libpinyin').activate(true);
      await until(() => manager.currentSource?.type === 'ibus' && manager.currentSource.id === 'libpinyin'
        && inputMode(manager.currentSource), 'libpinyin activated with its actual mode properties', 15000);
      const verified = new Set();
      for (let trial = 0; trial < 2; trial++) {
        desktop.settings.set_string('simulated-input-mode', 'keys');
        await clear(desktop, target);
        const mode = modeValue(manager.currentSource);
        const updates = target.state.preeditUpdates;
        await desktop.type('nihao');
        await until(() => target.state.preedit.length > 0 || target.state.text === 'nihao',
          'normal virtual keyboard reaches the real IME or ASCII target');
        const chinese = target.state.preedit.length > 0;
        const name = chinese ? 'Chinese composition' : 'ASCII';
        assert(!verified.has(name), 'Switching the real InputMode property must exercise both Chinese and ASCII modes');
        if (chinese) assert(target.state.preeditUpdates > updates && target.state.text === '',
          'Chinese-mode positive control must show real Gtk preedit before any text is committed');
        else assert(target.state.preeditUpdates === updates,
          'ASCII-mode positive control must not silently exercise Chinese composition');
        await desktop.key(Clutter.KEY_space);
        await until(() => target.state.preedit === '' && (chinese
          ? /\p{Script=Han}/u.test(target.state.text) : target.state.text === 'nihao '),
        'normal Space commits the actual candidate or literal ASCII');
        const reference = target.state.text;

        await clear(desktop, target);
        const before = desktop.app._terminalInput._queue;
        const simulatedUpdates = target.state.preeditUpdates;
        await trigger(desktop, target, 'nihao ', Clutter.KEY_apostrophe, {pointer: true});
        await until(() => !desktop.indicator.menu.isOpen && desktop.app._terminalInput._queue !== before,
          'real Ctrl+click starts the production simulated-input operation');
        await desktop.app._terminalInput._queue;
        try {
          await until(() => target.state.preedit === '' && target.state.text === reference,
            `${name}: plugin and normal virtual keyboard commit the same actual result`);
        } catch (error) {
          throw new Error(`${error.message}; expected=${JSON.stringify(reference)}; actual=${JSON.stringify(target.state.text)}; preedit=${JSON.stringify(target.state.preedit)}`);
        }
        assert(modeValue(manager.currentSource) === mode,
          'Opening the clipboard and typing must not silently change the tested IME mode');
        assert(chinese ? target.state.preeditUpdates > simulatedUpdates : target.state.preeditUpdates === simulatedUpdates,
          'Plugin input must follow the same real composition or ASCII path, not bypass the tested input method');

        await clear(desktop, target);
        desktop.settings.set_string('simulated-input-mode', 'commit');
        const literal = 'nihao 中文 日本語 한국어 🙂';
        const input = desktop.app._terminalInput;
        const submittedUpdates = target.state.preeditUpdates;
        const previousSubmission = input._queue;
        await trigger(desktop, target, literal, Clutter.KEY_apostrophe, {pointer: true});
        await until(() => !desktop.indicator.menu.isOpen && input._queue !== previousSubmission,
          `${name}: full-panel text submission starts after closing the popup`);
        await input._queue;
        await until(() => target.state.text === literal && target.state.preedit === '',
          `${name}: text submission preserves the literal multilingual input`);
        await pause(100);
        assert(target.state.text === literal && target.state.preedit === ''
          && target.state.preeditUpdates === submittedUpdates,
        `${name}: submitted text must not enter IME composition or append delayed characters`);
        assert(modeValue(manager.currentSource) === mode,
          `${name}: text submission must not change the input-method mode`);

        if (chinese) {
          await clear(desktop, target);
          await desktop.type('nihao');
          await until(() => target.state.preedit.length > 0 && target.state.text === '',
            'Actual Chinese composition is active before the rejection check');
          const beforeComposition = target.state;
          input.rememberTarget();
          const rejected = input.type('MUST_NOT_REPLACE_COMPOSITION').then(() => null, error => error);
          assert((await rejected)?.code === 'composition_active',
            'Text submission must reject the real active input-method composition');
          await pause(100);
          assert(target.state.preedit === beforeComposition.preedit && target.state.text === beforeComposition.text,
            'Rejected submission must neither cancel the candidate nor append text');
          assert(modeValue(manager.currentSource) === mode,
            'Rejecting active composition must not change the input-method mode');
        }

        verified.add(name);
        print(`[simulation] TYPE-08-ime ${name}: actual committed text=${JSON.stringify(reference)}`);
        if (trial === 0) {
          await clear(desktop, target);
          const property = inputMode(manager.currentSource);
          const previous = modeValue(manager.currentSource);
          assert([IBus.PropType.NORMAL, IBus.PropType.TOGGLE].includes(property.get_prop_type()),
            'libpinyin must expose an actionable native InputMode property');
          const state = property.get_prop_type() === IBus.PropType.TOGGLE
            ? property.get_state() === IBus.PropState.CHECKED ? IBus.PropState.UNCHECKED : IBus.PropState.CHECKED
            : property.get_state();
          ibus.activateProperty(property.get_key(), state);
          await until(() => modeValue(manager.currentSource) !== previous, 'real libpinyin mode change acknowledged');
        }
      }
      assert(verified.size === 2, 'Both real Chinese and ASCII modes must have independent positive controls');
      print('[simulation] Real IME keyboard equivalence, literal text submission and active-composition rejection passed; physical hardware remains outside this fixture');
    } finally {
      await desktop.key(Clutter.KEY_Escape);
      settings.set_value('sources', sources);
      await pause(100);
      if (original) Object.values(manager.inputSources)
        .find(source => source.type === original.type && source.id === original.id)?.activate(true);
      await target.close();
    }
  },
};
