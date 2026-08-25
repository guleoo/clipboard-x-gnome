import GLib from 'gi://GLib';

import {MAX_TRANSFER_STATES} from './constants.js';

const UPDATE_INTERVAL_MILLISECONDS = 50;
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'expired']);

export class TransferTracker {
  constructor(emit) {
    this._emit = emit;
    this._states = new Map();
    this._lastEmittedAt = new Map();
    this._pendingSources = new Map();
  }

  get(transferId) {
    const value = this._states.get(transferId);
    return value ? {...value} : null;
  }

  forItem(itemId) {
    const values = [...this._states.values()]
      .filter(transfer => transfer.itemId === itemId)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    return values[0] ? {...values[0]} : null;
  }

  values() {
    return [...this._states.values()].map(value => ({...value}));
  }

  update(transfer, {immediate = false} = {}) {
    const previous = this._states.get(transfer.transferId);
    if (previous && transfer.updatedAt < previous.updatedAt) {
      if (!TERMINAL_STATES.has(transfer.state) || TERMINAL_STATES.has(previous.state))
        return;
      transfer = {...transfer, updatedAt: previous.updatedAt};
    }
    if (!previous && this._states.size >= MAX_TRANSFER_STATES)
      this._states.delete(this._states.keys().next().value);
    this._states.set(transfer.transferId, {...transfer});
    const now = GLib.get_monotonic_time() / 1000;
    const last = this._lastEmittedAt.get(transfer.transferId) ?? 0;
    if (immediate || TERMINAL_STATES.has(transfer.state)
        || now - last >= UPDATE_INTERVAL_MILLISECONDS) {
      this._cancelPending(transfer.transferId);
      this._emitCurrent(transfer.transferId);
      return;
    }
    if (this._pendingSources.has(transfer.transferId))
      return;
    const delay = Math.max(1, Math.ceil(UPDATE_INTERVAL_MILLISECONDS - (now - last)));
    const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      this._pendingSources.delete(transfer.transferId);
      this._emitCurrent(transfer.transferId);
      return GLib.SOURCE_REMOVE;
    });
    this._pendingSources.set(transfer.transferId, source);
  }

  clear() {
    for (const source of this._pendingSources.values())
      GLib.Source.remove(source);
    this._pendingSources.clear();
    this._states.clear();
    this._lastEmittedAt.clear();
  }

  _emitCurrent(transferId) {
    const value = this._states.get(transferId);
    if (!value)
      return;
    this._lastEmittedAt.set(transferId, GLib.get_monotonic_time() / 1000);
    this._emit({...value});
  }

  _cancelPending(transferId) {
    const source = this._pendingSources.get(transferId);
    if (source)
      GLib.Source.remove(source);
    this._pendingSources.delete(transferId);
  }
}
