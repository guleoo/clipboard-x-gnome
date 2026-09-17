import {bindStringChoice} from '../../src/ui/settings/string-choice.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

class SignalSource {
  constructor() {
    this._nextSignal = 1;
    this._signals = new Map();
  }

  connect(name, callback) {
    const id = this._nextSignal++;
    this._signals.set(id, {name, callback});
    return id;
  }

  disconnect(id) {
    this._signals.delete(id);
  }

  emit(name) {
    for (const signal of this._signals.values()) {
      if (signal.name === name)
        signal.callback();
    }
  }
}

class TestSettings extends SignalSource {
  constructor(value) {
    super();
    this.value = value;
  }

  get_string() {
    return this.value;
  }

  set_string(key, value) {
    if (this.value === value)
      return;
    this.value = value;
    this.emit(`changed::${key}`);
  }
}

class TestRow extends SignalSource {
  constructor(selected) {
    super();
    this._selected = selected;
  }

  get selected() {
    return this._selected;
  }

  set selected(value) {
    if (this._selected === value)
      return;
    this._selected = value;
    this.emit('notify::selected');
  }
}

const key = 'device-icon-kind';
const values = ['computer', 'laptop', 'android', 'tablet', 'server', 'windows'];
const settings = new TestSettings('laptop');
const row = new TestRow(0);
const disconnect = bindStringChoice(settings, row, key, values);

assert(row.selected === 1, 'binding must initialize the selected choice from GSettings');

row.selected = 2;
assert(settings.value === 'android', 'selecting a row must update GSettings');

settings.set_string(key, 'server');
assert(row.selected === 4, 'an external GSettings update must refresh the selected row');

row.selected = 99;
assert(settings.value === 'server', 'an invalid row selection must not overwrite GSettings');

disconnect();
settings.set_string(key, 'computer');
assert(row.selected === 99, 'disconnect must stop GSettings updates from reaching the row');
row.selected = 3;
assert(settings.value === 'computer', 'disconnect must stop row updates from reaching GSettings');
