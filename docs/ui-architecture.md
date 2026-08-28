# Clipboard X UI development guide

> English · [简体中文](zh-CN/ui-architecture.md)

This document records the component boundaries and UI conventions that new panels and controls must
follow. Extend these boundaries instead of putting state and widgets back into `Indicator`.

## Responsibilities

- `ui/indicator.js`: top-bar entry point and panel orchestration. It owns system actions, menu toggles,
  panel registration, and theme coordination, but not panel-specific views.
- `ui/panel-manager.js`: panel lifecycle, scene restoration, and geometry. Settings provide default
  width and height for every panel; a registered panel may override them with a partial `geometry` object.
- `ui/navigation/focus-grid.js`: two-dimensional keyboard navigation inside a panel. Each panel owns
  its matrix; no global focus listener repairs focus.
- `ui/layouts/panel-actions.js`: layout model and validation for top and bottom actions.
- `ui/controls/`: public Shell controls. Controls provide structure and generic state; they do not read
  clipboard, synchronization, or panel settings.
- `ui/panels/`: independently switchable panels. Each panel owns its actor, scroll area, state, focus
  matrix, and domain interactions.
- `ui/settings/window.js`: preferences-page orchestration.
- `ui/settings/`: reusable GTK/Libadwaita preferences components.

## Shared components

- `QuickPhrasesPanel`: quick-phrase header, form, list, local storage, and focus state.
- `TokenizerPanel`: token layout, selection, mouse range selection, keyboard selection, preview, and focus state.
- `HistoryPanel`: search, history list, toolbar, footer, sync status, scene restoration, and focus state.
- `ContentItem`: one row with a leading marker, expandable content, and right-side actions. It owns shared
  content styling and clipping; the panel supplies focus actors in display order.
- `PanelHeader` and `PanelFooter`: shared divider, padding, and free-content regions for secondary panels.
- `SearchEntry`: shared search icon, placeholder offset, leading spacing, and search-event wiring.
- `IconButton`: shared icon size, accessible name, async-action errors, and selectable state.
- `FocusAnchor`: zero-size transparent anchor at the start of secondary panels. It consumes the first
  unmodified direction key and transfers focus to the panel's first business control.
- `Tooltip`: the extension's single floating tooltip, including target association, delay, positioning,
  input-mode changes, and signal cleanup.
- `PreferenceRows`: reusable switches, text, number, capacity, dropdown, icon-dropdown, shortcut, and
  string-list rows.

Public APIs use the domain as context and the member as the action: names should not repeat a type or
module, hide behavior, or rely on opaque abbreviations. Controls do not manage panel lifecycles or
business shortcuts; panels connect actions and use their own `FocusGrid`.

## Panel conventions

- Keep search and primary actions on one row. Default top actions are screenshot, color picker, and quick
  phrases; default footer actions are privacy, synchronization, clear, and settings. Settings control
  order and placement.
- Content rows use “left content, right actions” with one row-level hover background.
- Selected icons use the theme color; normal hover and active feedback remain distinct states.
- Entry actions, token buttons, and back buttons do not show tooltips by default. Global tools may use
  the floating tooltip.
- Every switchable panel has an independent `FocusGrid`. A setting controls whether direction keys at
  an edge may leave the extension.
- Scrollable content uses an overlay scrollbar and the shared thin-scrollbar style.
- Panel geometry, text vertical offset, and scene restoration are settings, not hard-coded per-user values.

## CSS conventions

- Put dimensions and spacing on structural components such as menus, headers, rows, toolbars, and footers.
- Do not position individual actions with one-off corrections. Use classes that express structure or state.
- Check selector specificity before adding a rule; `.cbx-menu .popup-menu-item` can override `.cbx-entry`.
- Treat theme, hover, focus, active, and checked as separate states.

## Verification

Pure layout and state algorithms need GJS unit tests. Shell actors, focus, and lifecycle are covered by
`tests/ui/shell.smoke.js`; GTK preferences are covered by `tests/ui/preferences.smoke.js`. Every
structural refactor must pass the build, normal tests, Shell smoke test, and preferences smoke test.
