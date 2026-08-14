export class EventEmitter {
  constructor() {
    this._eventHandlers = new Map();
    this._nextEventHandlerId = 1;
  }

  connect(name, callback) {
    if (typeof callback !== 'function')
      throw new TypeError('Event callback must be a function');
    const id = this._nextEventHandlerId++;
    this._eventHandlers.set(id, {name, callback});
    return id;
  }

  disconnect(id) {
    if (!this._eventHandlers.delete(id))
      throw new Error(`Unknown event handler: ${id}`);
  }

  emit(name, ...args) {
    for (const handler of [...this._eventHandlers.values()]) {
      if (handler.name === name)
        handler.callback(this, ...args);
    }
  }

  disconnectAll() {
    this._eventHandlers.clear();
  }
}
