# Test organization

> English · [简体中文](README_CN.md)

Tests are grouped by the environment they require, then by domain:

```text
tests/
  logic/          # No graphical desktop required
    clipboard/    # History, word selection, dictionaries, terminal sequences
    color-picker/
    common/       # Infrastructure, package and command safeguards
    i18n/
    screenshot/   # Editor argv/stdin and portal protocol checks
    sync/         # Policy, state, HTTP, storage, lifecycle and optional stress
    ui/           # Panel models, focus matrix, layouts and settings logic
  simulation/
    ui/           # Real GNOME Shell, Mutter input and separate GTK processes
      fixtures/   # Display/background fixtures
      panels/     # Panel acceptance driver and cases
  fixtures/       # Shared external clipboard, typing and process helpers
```

## Logic verification

`logic` means **headless verification**, not exclusively pure unit tests. It includes filesystem
operations, private D-Bus services, loopback HTTP servers and subprocesses, as well as disk-free
model tests. These checks must not require `Gtk.init()`, an active display or a running Shell.
Importing GTK utility APIs without initializing a display does not make a test graphical;
`logic/ui/shortcut-match.integration.js` additionally needs Shell's private typelibs, but no desktop.
Supporting fixtures stay with their owning domain unless shared across domains.

After configuring and building with Meson:

```sh
dbus-run-session -- meson test -C build --no-suite stress --print-errorlogs
# Equivalent package script:
bun run test:logic
```

Meson registers this category only. The existing test names and the optional `stress` suite remain
unchanged. `meson test -C build` still includes stress tests; ordinary CI still excludes them.
This reorganization does not add checks to CI. See the [transfer stress guide](../docs/sync-performance-testing.md)
for optional stress runs.

## Simulated desktop verification

`simulation` runs the real Shell/GTK implementation in a prepared graphical or isolated headless
desktop. It is not a fake widget model. Native input tests inject Mutter virtual-device events;
other integration checks inspect actual actors/windows or use controlled signals and callbacks.
GTK always runs outside the Shell process.

Use the existing isolated entry points after building the release ZIP:

```sh
bash tools/test-shell-compatibility.sh build/clipboard-x-gnome_1.x.x.zip
bash tools/test-panels.sh build/clipboard-x-gnome_1.x.x.zip --repeat 2
# The panel suite is also available as:
bun run test:simulation:panels
```

`test:simulation:panels` runs the local panel acceptance suite, not every simulation file. Additional
focused checks and GTK invocations are described in [Contributing](../CONTRIBUTING.md).
The Shell and panel runners automatically use the new directory; the UI check matrix and
the lifecycle subset already used by CI are unchanged. Detailed isolation and coverage boundaries:
[Shell compatibility](../docs/shell-compatibility.md), [panel tests](../docs/panel-testing.md).

## Adding tests

- Choose the category by runtime requirements, not `.test.js`, `.smoke.js` or `.integration.js` alone.
- Keep the domain structure within each category. Keep test-only helpers local to their owner;
  shared external programs belong in `fixtures/` and are not independent test suites.
- Register new logic checks in Meson only when appropriate. Keep graphical checks in explicit
  simulation entry points; do not add them to ordinary CI implicitly.
- Use behavior assertions for lasting risks, not source-string, document wording or style snapshots.
