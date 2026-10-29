# Clipboard X Gnome UI development guide

> English · [简体中文](ui-architecture_CN.md)

This document records the component boundaries and UI conventions that new panels and controls must
follow. Extend these boundaries instead of putting state and widgets back into `Indicator`.

## Responsibilities

- `ui/indicator.js`: top-bar entry point and panel orchestration. It owns system actions, menu toggles,
  panel registration, and theme coordination, but not panel-specific views.
- `ui/panel-manager.js`: panel lifecycle, scene restoration, and geometry. Settings provide default
  width and height for every panel; a registered panel may override them with a partial `geometry` object.
- `ui/navigation/focus-grid.js`: two-dimensional keyboard navigation inside a panel. Each panel owns
  its matrix; no global focus listener repairs focus.
- `ui/navigation/input-mode.js`: popup-wide keyboard/pointer presentation arbitration. It observes
  pointer input only while open; existing menu key capture supplies keyboard input. Real pointer targets
  are handed to the current panel's focus grid without global focus-change listeners.
- `ui/layouts/panel-actions.js`: layout model and validation for top and bottom actions.
- `ui/layouts/entry-actions.js`: clipboard-entry action order, visibility, and content-type eligibility.
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
- History action icons have their own order and visibility settings. Hidden icons are not created or
  added to the focus matrix; their keyboard shortcuts remain available. Sync remains unavailable for
  private items and while synchronization is off. The panel sync icon toggles the synchronization setting.
- Received-entry completion comes from local original availability, not retained transfer events.
  A completed server request or one downloaded representation must not mark a partial entry as complete.
  Incoming previews are added before automatic downloads selected by the local text/image thresholds;
  `materialize(item, {withinThreshold: true})` downloads only eligible representations, while explicit
  use calls `materialize(item)` for every missing original. Both paths share in-flight requests.
- Transfer buttons query the current synchronization session; notifications only trigger a refresh.
  Active tasks take precedence, and task order is local to the session rather than based on clocks
  from different devices. The UI does not retain a second transfer history across connection changes.
- Downloaded originals and thumbnails enter history-owned staging. History serializes file reads,
  pathname publication, adoption into permanent storage, and garbage collection. Indexes and cleanup
  use the same persisted descriptor snapshot; download I/O remains concurrent.
- Shared original acquisition is scoped by history storage. Discarded staging files remain protected
  until active consumers settle, then cleanup checks live history references rather than an old snapshot.
- Selected icons use the theme color; normal hover and active feedback remain distinct states.
- Entry actions, word selection buttons, and back buttons do not show tooltips by default. Global tools may use
  the floating tooltip.
- Keyboard navigation suppresses stationary-pointer hover feedback; actual pointer movement, clicks, or
  scrolling restore pointer feedback. Layout-driven hover/focus signals do not choose the input mode.
  Root mode classes gate hover/focus styling, not checked state, accent colors, entry focus, or caret.
  Actual pointer movement synchronizes focus to eligible controls in the current panel, so subsequent
  keyboard actions continue from that target. Hover does not interrupt entry editing or start it.
  Opening-time autofocus alone is not editing. Entry key input or a deliberate click protects its focus
  until focus leaves that entry; closing the popup clears this editing state.
  Wheel scrolling and layout-only hover changes never move focus or reveal a row.
  Tooltips use only the current mode's target and cancel pending help on mode changes or panel close.
- Every switchable panel has an independent `FocusGrid`. A setting controls whether direction keys at
  an edge may leave the extension.
- Refreshable panels capture and restore focused content identity and scroll position. History uses
  item ID plus action; only removal falls back to a nearby row. Word selection uses token index within
  its state, and quick phrases use phrase text plus action. Theme updates do not rebuild content.
- Scrollable content uses an overlay scrollbar and the shared thin-scrollbar style.
- Panel geometry, text vertical offset, and scene restoration are settings, not hard-coded per-user values.
- Escape dismisses an active quick-phrase form first. Otherwise secondary panels follow the configured
  action (return to history by default, or close); Escape in history always closes the popup.
- Normal text and icons inherit the system foreground color unless a custom foreground is configured.
  Accent states, selected-word contrast, and the separate tooltip/picker preview keep their own colors.
  Changing the foreground updates styles without rebuilding panel content.

## Lifecycle conventions

- Disconnect popup state/visibility callbacks before destroying the panel manager or tooltip. Destroying
  the parent PopupMenu can close an open menu and emit those signals again.
- Simulated input owns every wait timer and deferred notification. Destruction removes their sources and
  settles waiting promises; removing a source must not strand an active operation. Only one operation
  is accepted at a time; a busy request is rejected, not queued.
- Closing, hiding, or destroying the popup removes its input-mode filter before disposing the tooltip.
  Mode classes remain during the closing animation; the next opening chooses its actual input source.
- Settings use `ui/settings/lifecycle.js`'s `onClosed()` for cleanup on window close or actual unroot.
  A closed GTK window may retain rooted children, so unroot alone is not a close notification.
- Cancel read-only requests, native choosers, and launch callbacks when preferences close; explicitly close
  shortcut-recording windows. Late results must not update controls or present error dialogs.
- An already accepted persistent save/import may finish safely, but must not revive a closed UI or start
  another network stage after its owner closes.

## Text delivery

`clipboard/terminal/input.js` owns target restoration, cancellation, modifier safety and simulated
keystrokes. It rejects active input-method composition without confirming or clearing it. It does not
alter the clipboard or require a GNOME text-input connection to send keystrokes.

Timing profiles (initial / ASCII / completed Unicode-composition delay, in ms) are standard
`75 / 4 / 30`, medium `75 / 6 / 40`, slow `75 / 8 / 50`. Non-ASCII characters use the Unicode-entry chord;
individual key transitions within a character have no added delay. Newlines and Tab produce Return and
Tab keys. With a supported text-input focus snapshot, input cancels on field changes; a Tab may therefore
stop the remaining text. Unsupported clients, including XWayland targets without that connection,
expose no guaranteed field-change detection: only their window identity is guarded.

Input stops on cancellation, disable, an observable target change, observed user input or the modifier fuse.
GNOME Shell cannot observe every physical key delivered to another client. Already sent content cannot
be retracted; long or exact text should normally be pasted instead.

## CSS conventions

- Put dimensions and spacing on structural components such as menus, headers, rows, toolbars, and footers.
- Do not position individual actions with one-off corrections. Use classes that express structure or state.
- Check selector specificity before adding a rule; `.cbx-menu .popup-menu-item` can override `.cbx-entry`.
- Treat theme, hover, focus, active, and checked as separate states.

## Verification

Headless checks live in `tests/logic/`; real Shell/GTK checks live in `tests/simulation/`.
See the [test directory guide](../tests/README.md) for the boundary and execution commands.

Pure layout and state algorithms need GJS logic tests; keep decisions out of actor code so they can be
tested that way. Core Shell wiring is covered by `tools/test-simulation.py`, panel focus by
`tools/test-panels.sh`, and GTK preferences (inside the compatibility entry) by
`tests/simulation/settings/window.smoke.js`. Every structural refactor must pass the build and the logic
suite, and the simulation entries before a release.
The existing Shell compatibility entry also runs open-panel disable coverage, simulated-input source
cleanup, and the settings lifecycle integration test in a separate GTK process. Never import GTK into Shell.
`input-mode.smoke.js` verifies actual keyboard/pointer switching, delayed help, stationary hover, entry
caret, selected words, and popup cleanup on both supported Shell versions.
