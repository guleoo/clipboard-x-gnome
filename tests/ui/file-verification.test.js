import {bind} from '../../src/ui/settings/file-verification.js';

function assert(value, text) { if (!value) throw new Error(text); }

class Signals {
  constructor() { this.signals = new Map(); this.next = 1; }
  connect(name, callback) { const id = this.next++; this.signals.set(id, {name, callback}); return id; }
  disconnect(id) { this.signals.delete(id); }
  emit(name) { for (const signal of this.signals.values()) if (signal.name === name) signal.callback(); }
}
class Settings extends Signals {
  constructor() { super(); this.value = false; }
  get_boolean() { return this.value; }
  set_boolean(key, value) {
    if (this.value !== value) { this.value = value; this.emit(`changed::${key}`); }
  }
}
class Row extends Signals {
  constructor() { super(); this.value = false; this.sensitive = true; }
  get active() { return this.value; }
  set active(value) {
    if (this.value !== value) { this.value = value; this.emit('notify::active'); }
  }
}
function pending() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
}
async function settle() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

const settings = new Settings();
const row = new Row();
const errors = [];
let operation;
let cancellable;
const disconnect = bind(settings, row, {
  checkDependency: value => { cancellable = value; operation = pending(); return operation.promise; },
  onError: error => errors.push(error),
});
assert(!row.active && row.sensitive, 'default must be off');
row.active = true;
assert(!settings.value && !row.sensitive, 'setting must not enable before the dependency check completes');
operation.reject(new Error('missing dependency'));
await settle();
assert(!row.active && !settings.value && row.sensitive && errors.length === 1,
  'failed checks must restore off and show a dependency error');
row.active = true;
operation.resolve();
await settle();
assert(row.active && settings.value && row.sensitive, 'successful checks must persist enabled');
row.active = false;
assert(!settings.value, 'disabling must not require another dependency check');
row.active = true;
settings.emit('changed::sync-use-sha256sum');
assert(cancellable.is_cancelled(), 'external settings changes must cancel an outstanding check');
operation.resolve();
await settle();
assert(!settings.value && !row.active, 'a late successful check must not override an external reset');
row.active = true;
disconnect();
assert(cancellable.is_cancelled(), 'closing settings must cancel the check');
operation.reject(new Error('closed'));
await settle();
assert(!settings.value && errors.length === 1, 'closed settings must not persist or show a late dialog');
assert(settings.signals.size === 0 && row.signals.size === 0, 'disconnect must remove both subscriptions');
