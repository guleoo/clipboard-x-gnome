const DIRECTIONS = new Set(['left', 'right', 'up', 'down']);

export class FocusGrid {
  constructor({
    focus = actor => actor.grab_key_focus(),
    center = actor => {
      const [x] = actor.get_transformed_position();
      const [width] = actor.get_transformed_size();
      return x + width / 2;
    },
    eligible = defaultEligible,
    ensureVisible = () => {},
  } = {}) {
    this._focus = focus;
    this._center = center;
    this._eligible = eligible;
    this._ensureVisible = ensureVisible;
    this._rows = [];
  }

  setRows(rows) {
    this._rows = rows
      .filter(Array.isArray)
      .map(row => row.filter(Boolean))
      .filter(row => row.length > 0);
  }

  clear() {
    this._rows = [];
  }

  contains(actor) {
    return this._locate(actor) !== null;
  }

  move(actor, direction) {
    if (!DIRECTIONS.has(direction))
      throw new Error(`Unknown focus direction: ${direction}`);
    const location = this._locate(actor);
    if (!location)
      return null;
    const target = direction === 'left' || direction === 'right'
      ? this._horizontal(location, direction)
      : this._vertical(actor, location, direction);
    if (!target)
      return null;
    this._focus(target);
    this._ensureVisible(target);
    return target;
  }

  _locate(actor) {
    for (let row = 0; row < this._rows.length; row++) {
      const column = this._rows[row].indexOf(actor);
      if (column >= 0)
        return {row, column};
    }
    return null;
  }

  _horizontal({row, column}, direction) {
    const step = direction === 'left' ? -1 : 1;
    for (let candidate = column + step;
      candidate >= 0 && candidate < this._rows[row].length;
      candidate += step) {
      const actor = this._rows[row][candidate];
      if (this._eligible(actor))
        return actor;
    }
    return null;
  }

  _vertical(actor, {row}, direction) {
    const step = direction === 'up' ? -1 : 1;
    const origin = this._center(actor);
    for (let candidateRow = row + step;
      candidateRow >= 0 && candidateRow < this._rows.length;
      candidateRow += step) {
      const candidates = this._rows[candidateRow].filter(candidate => this._eligible(candidate));
      if (candidates.length === 0)
        continue;
      return candidates.reduce((closest, candidate) => {
        const distance = Math.abs(this._center(candidate) - origin);
        return distance < closest.distance ? {actor: candidate, distance} : closest;
      }, {actor: candidates[0], distance: Infinity}).actor;
    }
    return null;
  }
}

function defaultEligible(actor) {
  try {
    return actor.mapped !== false
      && actor.visible !== false
      && actor.can_focus !== false
      && actor.reactive !== false;
  } catch (_error) {
    return false;
  }
}
