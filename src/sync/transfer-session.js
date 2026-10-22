import Gio from 'gi://Gio';

import {SyncError} from './errors.js';
import {TransferTracker} from './transfers.js';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired']);

// One instance belongs to one connection generation. Closing it invalidates
// queued work, stops active I/O and releases every waiting consumer together.
export class TransferSession {
  constructor({isCurrent, transport, timeout, onChange}) {
    this._isCurrent = isCurrent;
    this._transport = transport;
    this._timeout = timeout;
    this._closed = false;
    this._chain = Promise.resolve();
    this._waiters = new Map();
    this._materializations = new Map();
    this._operations = new Map();
    this._remoteIds = new Set();
    this._cancellables = new Set();
    this._tracker = new TransferTracker(onChange);
  }

  get current() { return !this._closed && this._isCurrent(); }
  get(id) { return this._tracker.get(id); }
  forItem(id) { return this._tracker.forItem(id); }
  values() { return this._tracker.values(); }
  running(id) { return this._operations.has(id); }

  check() {
    if (!this.current)
      throw new Gio.IOErrorEnum({code: Gio.IOErrorEnum.CANCELLED,
        message: 'Synchronization transfer session is no longer current'});
  }

  enqueue(action) {
    const run = () => { this.check(); return action(); };
    const result = this._chain.then(run, run);
    this._chain = result.catch(() => {});
    return result;
  }

  async materialize(key, action) {
    this.check();
    let operation = this._materializations.get(key);
    if (!operation) {
      operation = action();
      this._materializations.set(key, operation);
    }
    try {
      const result = await operation;
      this.check();
      return result;
    } finally {
      if (this._materializations.get(key) === operation)
        this._materializations.delete(key);
    }
  }

  observe(transfer) {
    if (TERMINAL.has(transfer.state))
      this._remoteIds.delete(transfer.transferId);
    else
      this._remoteIds.add(transfer.transferId);
  }

  record(transfer, immediate = false) {
    this.check();
    this._tracker.update(transfer, {immediate});
    const waiter = this._waiters.get(transfer.transferId);
    if (!waiter || !TERMINAL.has(transfer.state))
      return;
    clearTimeout(waiter.timeout);
    this._waiters.delete(transfer.transferId);
    if (transfer.state === 'completed')
      waiter.resolve();
    else
      waiter.reject(new Error(transfer.errorMessage || `Transfer ${transfer.state}`));
  }

  wait(id) {
    this.check();
    const transfer = this.get(id);
    if (!transfer)
      return Promise.reject(new Error('Synchronization transfer ID is unknown'));
    if (transfer.state === 'completed')
      return Promise.resolve();
    if (TERMINAL.has(transfer.state))
      return Promise.reject(new Error(transfer.errorMessage || `Transfer ${transfer.state}`));
    const existing = this._waiters.get(id);
    if (existing)
      return existing.promise;
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const timeout = setTimeout(() => {
      this._waiters.delete(id);
      this.cancel(id).catch(() => {});
      reject(new Error('Timed out waiting for synchronized content'));
    }, this._timeout());
    this._waiters.set(id, {promise, resolve, reject, timeout});
    return promise;
  }

  async cancel(id) {
    this.check();
    this._operations.get(id)?.cancel();
    if (this._remoteIds.has(id)) {
      try {
        await this._transport().cancel(id);
        this.check();
        this._remoteIds.delete(id);
      } catch (error) {
        if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
          throw error;
      }
    }
    this.check();
    const transfer = this.get(id);
    if (transfer && !TERMINAL.has(transfer.state))
      this.record({...transfer, state: 'cancelled', updatedAt: Date.now()}, true);
  }

  async run(action, {errorCode, guard = () => true} = {}) {
    this.check();
    const transport = this._transport();
    if (!transport)
      throw new SyncError('server_unavailable', 'Synchronization server is unavailable');
    const cancellable = new Gio.Cancellable();
    this._cancellables.add(cancellable);
    let transfer = null;
    let finished = false;
    const check = () => {
      this.check();
      if (!guard())
        throw new Gio.IOErrorEnum({code: Gio.IOErrorEnum.CANCELLED,
          message: 'Clipboard operation is no longer eligible'});
      cancellable.set_error_if_cancelled();
    };
    const track = (value, {remote = true} = {}) => {
      check();
      if (transfer && transfer.transferId !== value.transferId)
        throw new Error('Synchronization transfer identity changed during an operation');
      transfer = {...value};
      if (remote)
        this.observe(transfer);
      this._operations.set(transfer.transferId, cancellable);
      this.record(transfer, true);
    };
    const update = (value, immediate = false) => {
      // I/O callbacks may arrive after abort; never throw into those callbacks.
      if (finished || !transfer || !this.current || !guard() || cancellable.is_cancelled())
        return;
      transfer = {...transfer, ...value, updatedAt: Date.now()};
      this.record(transfer, immediate);
    };
    try {
      check();
      const result = await action({transport, cancellable, check, track, update});
      check();
      return result;
    } catch (error) {
      this.check();
      if (transfer) {
        this.record({...transfer,
          state: error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ? 'cancelled' : 'failed',
          updatedAt: Date.now(), errorCode: String(error.code ?? errorCode), errorMessage: error.message}, true);
      }
      throw error;
    } finally {
      finished = true;
      if (transfer && this._operations.get(transfer.transferId) === cancellable)
        this._operations.delete(transfer.transferId);
      this._cancellables.delete(cancellable);
    }
  }

  close(error) {
    if (this._closed)
      return;
    this._closed = true;
    for (const cancellable of this._cancellables)
      cancellable.cancel();
    for (const waiter of this._waiters.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this._waiters.clear();
    this._materializations.clear();
    this._operations.clear();
    this._remoteIds.clear();
    this._cancellables.clear();
    this._tracker.clear();
  }
}
