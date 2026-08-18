export class PanelManager {
  constructor({
    defaultPanel,
    clearPanelTooltips = () => {},
    hideTooltip = clearPanelTooltips,
    onGeometry = () => {},
  }) {
    if (!defaultPanel)
      throw new Error('A default panel is required');

    this._defaultPanel = defaultPanel;
    this._clearPanelTooltips = clearPanelTooltips;
    this._hideTooltip = hideTooltip;
    this._onGeometry = onGeometry;
    this._panels = new Map();
    this._viewStates = new Map();
    this._geometry = null;
    this._geometryOverrides = {};
    this._current = null;
    this._resetWhenHidden = false;
  }

  register(name, lifecycle) {
    if (!name || this._panels.has(name))
      throw new Error(`Panel already registered: ${name}`);
    this._panels.set(name, lifecycle);
    this._applyGeometry(name, lifecycle);
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

  get geometry() {
    return this._current ? this._resolveGeometry(this._current.name) : null;
  }

  is(name) {
    return this.currentName === name;
  }

  setGeometry(defaults, overrides = {}) {
    this._geometry = {...defaults};
    this._geometryOverrides = {...overrides};
    for (const [name, panel] of this._panels)
      this._applyGeometry(name, panel);
    this._publishGeometry();
  }

  show(name, state = null) {
    const next = this._panels.get(name);
    if (!next)
      throw new Error(`Unknown panel: ${name}`);

    this._clearPanelTooltips();
    const previous = this._current;
    if (previous) {
      const previousPanel = this._panels.get(previous.name);
      this._captureView(previous.name, previousPanel, previous.state);
      previousPanel?.focusGrid?.clear();
      previousPanel?.leave?.(previous.state, name);
    }

    this._current = {name, state};
    this._resetWhenHidden = false;
    this._publishGeometry();
    next.enter?.(state, previous?.name ?? null);
    next.render?.(state);
    next.restoreView?.(this._viewStates.get(name), state, previous?.name ?? null);
  }

  refresh() {
    if (!this._current)
      return;
    this._clearPanelTooltips();
    const panel = this._panels.get(this._current.name);
    this._captureView(this._current.name, panel, this._current.state);
    panel?.render?.(this._current.state);
    panel?.restoreView?.(
      this._viewStates.get(this._current.name),
      this._current.state,
      this._current.name,
    );
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
    this._viewStates.clear();
    this._geometry = null;
    this._geometryOverrides = {};
    this._resetWhenHidden = false;
  }

  _captureView(name, panel, state) {
    if (!panel?.captureView)
      return;
    const viewState = panel.captureView(state);
    if (viewState !== undefined)
      this._viewStates.set(name, viewState);
  }

  _applyGeometry(name, panel) {
    if (!this._geometry || !panel?.setGeometry)
      return;
    panel.setGeometry(this._resolveGeometry(name));
  }

  _resolveGeometry(name) {
    if (!this._geometry)
      return null;
    return {
      ...this._geometry,
      ...(this._geometryOverrides[name] ?? {}),
    };
  }

  _publishGeometry() {
    const geometry = this.geometry;
    if (geometry)
      this._onGeometry(geometry);
  }
}
