import Gio from 'gi://Gio';

// Coordinates local content, remote originals and history commits. The transport
// writes into history-owned staging; history owns adoption, retention and the
// final clipboard write.
export class Content {
  constructor({history, remote, receiveMode, deviceId, onError = () => {}}) {
    this._history = history;
    this._remote = remote;
    this._receiveMode = receiveMode;
    this._deviceId = deviceId;
    this._onError = onError;
    this._destroyed = false;
  }

  async ensure(item, {withinThreshold = false, guard = () => true, flush = true} = {}) {
    this._check(item, guard);
    const missing = item.remote && item.representations.some(value => !value.bytes && !value.path);
    if (item.remote) {
      const availability = item.availability;
      try {
        try {
          await this._remote.materialize(item, {withinThreshold});
        } catch (error) {
          if (this._current(item, guard))
            this._history.commitContent(item);
          throw error;
        }
        this._check(item, guard);
        if (missing || availability !== item.availability)
          this._history.commitContent(item);
        this._check(item, guard);
        if (missing && flush)
          await this._history.persist();
        this._check(item, guard);
      } finally {
        if (!this._current(item, guard))
          await this._history.discardContent([item]);
      }
    }
    return item;
  }

  async read(item, options = {}) {
    await this.ensure(item, options);
    await this._history.materialize(item);
    this._check(item, options.guard ?? (() => true));
    return item;
  }

  async file(item, options = {}) {
    await this.ensure(item, {...options, flush: false});
    // Saving also gives a newly captured local item its stable object path.
    await this._history.persist();
    this._check(item, options.guard ?? (() => true));
    if (!item.primary?.path)
      throw new Error('The original image is not available locally');
    return item.primary.path;
  }

  async activate(item, {guard = () => true} = {}) {
    await this.ensure(item, {guard});
    await this._activate(item, guard);
    return item;
  }

  async _activate(item, guard) {
    this._check(item, guard);
    // The history rechecks this guard after its asynchronous final local read.
    await this._history.activate(item, {guard: () => this._current(item, guard)});
    this._check(item, guard);
  }

  async receive(changes, {isCurrent}) {
    const current = () => !this._destroyed && isCurrent();
    const received = new Set();
    let changed = false;
    for (const change of changes) {
      if (!current())
        return;
      if (change.kind !== 'upsert') {
        // A failed save may have removed this from memory already. Replaying
        // the removal must still flush it before the cursor is acknowledged.
        changed = true;
        this._history.remove(change.itemId);
        continue;
      }
      if (this._receiveMode() === 'disabled')
        continue;
      let incoming;
      try {
        incoming = await this._remote.getItem(change.itemId);
      } catch (error) {
        if (!current())
          return;
        if (error.code !== 'not_found')
          throw error;
        changed = true;
        this._history.remove(change.itemId);
        continue;
      }
      if (!current()) {
        await this._history.discardContent([incoming]);
        return;
      }
      if (incoming.originDeviceId === this._deviceId()) {
        await this._history.discardContent([incoming]);
        continue;
      }
      const duplicate = this._history.items.find(item => item.equals(incoming));
      const replaceDuplicate = duplicate?.remote && duplicate.id !== incoming.id
        && duplicate.representations.some(value => !value.bytes && !value.path);
      const retained = this._history.add(incoming, 'remote', {replaceDuplicate});
      received.add(retained);
      if (retained !== incoming)
        await this._history.discardContent([incoming]);
      changed = true;
    }
    if (changed)
      await this._history.persist();
    if (!current())
      return;
    for (const item of received) {
      const retained = () => current() && this._history.items.includes(item);
      // A durable snapshot is sufficient to accept this page. Offline originals
      // must not block polling; explicit use can request them again later.
      this._finishReceived(item, retained).catch(error => {
        if (retained())
          this._onError(error);
      });
    }
  }

  async _finishReceived(item, guard) {
    if (!this._current(item, guard))
      return;
    await this.ensure(item, {
      withinThreshold: this._receiveMode() !== 'activate', guard, flush: false,
    });
    if (this._receiveMode() === 'activate' && item.availability === 'ready')
      await this._activate(item, () => guard() && this._receiveMode() === 'activate');
  }

  _current(item, guard) {
    return !this._destroyed && guard() && (!item.remote || this._history.items.includes(item));
  }

  _check(item, guard) {
    if (!this._current(item, guard)) {
      throw new Gio.IOErrorEnum({
        code: Gio.IOErrorEnum.CANCELLED,
        message: 'Clipboard content is no longer available in the active history',
      });
    }
  }

  destroy() {
    this._destroyed = true;
  }
}
