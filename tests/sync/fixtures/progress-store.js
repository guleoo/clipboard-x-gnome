// A disk-free progress store for protocol/lifecycle tests. Persistence and
// destination validation are exercised against the real store separately.
export class MemoryProgressStore {
  constructor() {
    this.values = new Map();
    this.saves = [];
  }

  async load(scope) {
    const value = this.values.get(JSON.stringify(scope)) ?? {cursors: {}, workCursor: ''};
    return {...value, cursors: {...value.cursors}};
  }

  async save(scope, value) {
    const progress = {...value, cursors: {...value.cursors}};
    this.values.set(JSON.stringify(scope), progress);
    this.saves.push({scope: {...scope}, progress});
    return {...progress, cursors: {...progress.cursors}};
  }
}
