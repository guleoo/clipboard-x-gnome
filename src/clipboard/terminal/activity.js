export class Activity {
  constructor(quietMicroseconds) {
    this._quietMicroseconds = quietMicroseconds;
    this._pressed = new Map();
    this._lastEventAt = null;
  }

  update(device, keyCode, pressed, time) {
    let keys = this._pressed.get(device);
    if (pressed) {
      if (!keys) {
        keys = new Set();
        this._pressed.set(device, keys);
      }
      keys.add(keyCode);
    } else if (keys) {
      keys.delete(keyCode);
      if (keys.size === 0)
        this._pressed.delete(device);
    }
    this._lastEventAt = time;
  }

  ready(time) {
    return this._pressed.size === 0
      && (this._lastEventAt === null
        || time >= this._lastEventAt + this._quietMicroseconds);
  }

  reset() {
    this._pressed.clear();
    this._lastEventAt = null;
  }
}
