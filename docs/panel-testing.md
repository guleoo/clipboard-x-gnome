# Panel entrance, navigation, and scene regression tests

> English · [简体中文](panel-testing_CN.md)

This local suite makes PANEL-01 through PANEL-10 reproducible with real Mutter virtual keyboard,
pointer, and wheel events. It is separate from Meson and GitHub CI. It does not install the extension
on the host desktop, read the host history, or require Clipboard X Server.

The [functional inventory](../tests/functional-inventory.md) owns the complete feature scope and
duplicate-test review; this guide describes the panel runner and finite reproduction matrix.

## Run

Build a package with `-Dtarget=package`, as described in [Contributing](../CONTRIBUTING.md).
Replace `1.x.x` below with the built version:

```sh
bash tools/test-panels.sh build/clipboard-x-gnome_1.x.x.zip
```

The command runs on the installed GNOME Shell, which must be 50 or 51. It needs
`gnome-shell-test-tool`, Python 3, `dbus-run-session`, `timeout`, and a working system bus.
It does not install these dependencies or change system services. Run the same command inside
each prepared GNOME 50/51 environment to test both; appending `50` or `51` requires that exact version.
See [Shell compatibility](shell-compatibility.md) for container environment requirements.

For a repeatability check, use two or more fresh sessions per display profile:

```sh
bash tools/test-panels.sh build/clipboard-x-gnome_1.x.x.zip 51 --repeat 3
```

To reproduce a specific case:

```sh
bash tools/test-panels.sh build/clipboard-x-gnome_1.x.x.zip --case PANEL-05
bash tools/test-panels.sh build/clipboard-x-gnome_1.x.x.zip --case PANEL-10 --repeat 3
bash tools/test-panels.sh build/clipboard-x-gnome_1.x.x.zip --case PANEL-02,PANEL-09 --display standard
```

## Display profiles

The default `--display all` runs:

- `standard`: one 1280×720 virtual monitor; all selected cases.
- `dual`: a second, real 1024×768 virtual monitor; PANEL-02 on each monitor.
- `fractional`: one virtual monitor configured to 125% through Mutter DisplayConfig, then read back;
  PANEL-02 at that actual scale, not font scaling or a fabricated monitor array.

The extra display profiles run only when PANEL-02 is selected. Choose `--display standard`, `dual`,
or `fractional` for a narrower reproduction. A missing second monitor or unavailable 125% mode fails
the corresponding profile explicitly; it is not reported as a pass or silently skipped.

The single-screen size matrix may exceed the workarea. PANEL-03 checks that configured dimensions
apply to all panels, not that oversized panels are automatically shrunk.

## Cases and assertions

| ID | Reproducible operation and expected result |
| --- | --- |
| PANEL-01 | Topbar clicks and configured Ctrl+Shift+F8 toggle the popup; a desktop click closes it. |
| PANEL-02 | Hide the indicator and open by shortcut. Test nine anchors with −18/0/+18 offsets and eight extreme offset cases; popup rectangles remain in the target workarea. Extra profiles verify two monitors and 125% scaling. |
| PANEL-03 | Apply 360×400, 300×160, 480×500, and 800×800 to all three panels; change dimensions while open. A 420×260 override for quick phrases does not alter history dimensions. Geometry uses real actors through PanelManager; entrance events are tested separately. |
| PANEL-04 | Close each secondary panel by pointer with animations enabled, with retention both off and on. Actual painted fade frames must not flash history. Reopen and check the phrase draft or selected words; also reopen during closing. |
| PANEL-05 | Search the fixed history, navigate to item 11, open word selection, and click Back. Search, item identity, action focus, and the settled scroll offset remain unchanged. |
| PANEL-06 | Initial keyboard targets are search, first word, first phrase, and Add for an empty phrase list—not Back. |
| PANEL-07 | Actual arrows skip hidden tools, traverse unequal word rows, and reach Copy/Back/footer. Ctrl+F focuses search; Right edits within text and leaves the entry only at its end. |
| PANEL-08 | Direction keys remain in each panel with confinement on. With confinement off, an actual boundary key is delegated to GNOME. A real native date menu retains input ownership. Delegation does not imply every direction must leave the popup. |
| PANEL-09 | Down scrolls a hidden item into view. During a real wheel event, inject a history update before dispatch to reproduce the pending-restore race; wheel scrolling wins and no late restore reverses it. |
| PANEL-10 | Reuse `input-mode.smoke.js`: first-open and reopen pointer handoff, keyboard↔pointer navigation, direct activation, stationary hover, delayed tooltips, entry caret/empty-entry editing, word selection, and popup listener cleanup. |

All cases also check input-filter and tooltip-source cleanup when the extension is disabled.
The wheel/update overlap is deliberate scheduling of a real input race, not simulated network traffic.

## Isolation, stability, and evidence

Each profile and repetition starts a new headless Shell, session bus, keyfile settings, and XDG
directories. The driver rejects execution outside the runner's private directory. Fixtures contain
35 synthetic history entries and three quick phrases; no private clipboard is used. Each case resets
settings and navigation before running. The main suite fails at its first failing case; subsequent
profiles/repetitions still have fresh processes, and any failure keeps the overall exit status nonzero.

The suite waits for actual popup, focus, scroll, and geometry states with bounded deadlines. Short
input spacing is not a substitute for completion checks. It moves the newly created pointer away
from the hot corner before hiding Overview, so Overview cannot reopen and steal focus. Animations
remain enabled. An outer 300-second limit catches a hung Shell; cases are not retried until they pass.
The official idle wait lets pending native configuration changes settle. Before each case, the driver
also calls the native helper's window-wait method: GNOME's [performance helper](https://github.com/GNOME/gnome-shell/blob/main/src/shell-perf-helper.c)
otherwise exits after 30 seconds of inactivity, independently of whether the assertions passed.
Teardown waits for the extension's inactive state before inspecting released sources.

Reports go to a unique directory under `build/panel-tests/`. `--output /path/to/reports` changes the
parent directory, which is useful for read-only container mounts. Each directory contains:

- `summary.txt`: installed Shell version, input ZIP path and SHA-256, selection, repetition count,
  and the outcome of each session.
- `standard-N.log`, `dual-N.log`, `fractional-N.log`: complete Shell output, per-case START/PASS/FAIL,
  assertion stack, and failed panel/focus/geometry diagnostics.

The terminal prints concise case results and the report location. Nonzero status, missing completion
markers, and missing requested PASS markers all fail the run. Cleanup retries transient portal unmounts
without hiding the original result. Temporary test metadata may add GNOME 51 to a private copy;
the input release ZIP is unchanged.

These checks cover the stated finite matrix, not all themes, physical input devices, graphics drivers,
or visual aesthetics. Existing full UI, settings, clipboard, and word-dragging suites remain separate;
passing this panel suite does not claim they passed.
