export class PanelManager {
  constructor({defaultPanel, clearPanelTooltips = () => {}, hideTooltip = clearPanelTooltips}) {
    if (!defaultPanel)
      throw new Error('A default panel is required');

    this._defaultPanel = defaultPanel;
    this._clearPanelTooltips = clearPanelTooltips;
    this._hideTooltip = hideTooltip;
    this._panels = new Map();
    this._current = null;
    this._resetWhenHidden = false;
  }

  register(name, lifecycle) {
    if (!name || this._panels.has(name))
      throw new Error(`Panel already registered: ${name}`);
    this._panels.set(name, lifecycle);
  }

  get currentName() {
    return this._current?.name ?? null;
  }

  get state() {
    return this._current?.state ?? null;
  }

  get focusGrid() {
    if (!this._current)
      return null;
    return this._panels.get(this._current.name)?.focusGrid ?? null;
  }

  is(name) {
    return this.currentName === name;
  }

  show(name, state = null) {
    const next = this._panels.get(name);
    if (!next)
      throw new Error(`Unknown panel: ${name}`);

    this._clearPanelTooltips();
    const previous = this._current;
    if (previous) {
      const previousPanel = this._panels.get(previous.name);
      previousPanel?.focusGrid?.clear();
      previousPanel?.leave?.(previous.state, name);
    }

    this._current = {name, state};
    this._resetWhenHidden = false;
    next.enter?.(state, previous?.name ?? null);
    next.render?.(state);
  }

  refresh() {
    if (!this._current)
      return;
    this._clearPanelTooltips();
    this._panels.get(this._current.name)?.render?.(this._current.state);
  }

  close({preserve = false} = {}) {
    this._hideTooltip();
    this._resetWhenHidden = !preserve && !this.is(this._defaultPanel);
  }

  open() {
    if (this._resetWhenHidden)
      this.reset();
  }

  hidden() {
    if (this._resetWhenHidden)
      this.reset();
  }

  reset() {
    if (this.is(this._defaultPanel)) {
      this._resetWhenHidden = false;
      return;
    }
    this.show(this._defaultPanel);
  }

  preservePendingState() {
    this._resetWhenHidden = false;
  }

  destroy() {
    this._clearPanelTooltips();
    if (this._current)
      this._panels.get(this._current.name)?.leave?.(this._current.state, null);
    for (const panel of this._panels.values())
      panel.focusGrid?.clear();
    this._current = null;
    this._panels.clear();
    this._resetWhenHidden = false;
  }
}
