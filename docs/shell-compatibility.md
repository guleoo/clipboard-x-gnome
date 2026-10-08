# GNOME Shell compatibility

> English · [简体中文](shell-compatibility_CN.md)

One release ZIP targets GNOME Shell 50+, using a shared implementation rather than separate
extension branches. Currently verified versions are 50 and 51; later versions require validation
and an update to the supported-version metadata before installation. Use
`orientation: Clutter.Orientation.VERTICAL` for vertical St layouts and
`global.stage.context.get_backend().get_default_seat()` for the virtual keyboard. These interfaces
exist in both versions. Old actor event signals are still supported in 51, although deprecated;
moving to controllers is a separate change, not required just to load on 51.

## Automated verification

The CI and Release workflows use Fedora 44 / Shell 50 and Fedora 45 / Shell 51. CI runs on every push
and pull request; Release runs only on `v*` tag pushes. Each job checks the actual
Shell version before building, runs the Meson regression suite excluding `stress`, validates the ZIP, and runs an isolated
headless Shell lifecycle test. A version mismatch fails rather than silently testing another version.
Fedora 45 may be a prerelease container; the installed Shell version is the compatibility target.
Both jobs must succeed before publication. Only one runtime ZIP is uploaded.

Run the narrow lifecycle check locally after building the package:

```sh
bash tools/test-shell-compatibility.sh build/clipboard-x-gnome_1.0.1.zip
```

Optionally append `50` or `51` to require that exact installed Shell version. The script does not
install or upgrade GNOME. It uses the official `gnome-shell-test-tool`, a private runtime directory,
temporary extension/settings directories, a private session bus and a headless virtual monitor.
It does not change the desktop's installed extension or its settings. A system bus must be available;
containers need their own bus and a suitable login-manager test environment. CI starts a container-only
system bus and removes the empty `/run/systemd/seats` package-created marker so Shell uses its built-in
no-logind mode. No host runtime directory is touched, and no mock plugin API is substituted.

The test uses a self-contained static background and disables Shell animations, avoiding dependencies
on distribution wallpaper packages. English `[compatibility]` messages distinguish automation
initialization, Shell startup completion, test entry and each lifecycle stage. A 30-second watchdog
covers startup after the automation module initializes; important test waits have a 15-second deadline.
Timeouts include the current stage and Shell/extension readiness. The outer 120-second limit remains
in place for hangs before the module can initialize or while the main loop is blocked.

The check verifies extension loading, shared orientation/backend/scroll APIs, opening the main panel,
tokenizer rendering, quick phrases construction, and disable/re-enable. It is not a screenshot,
physical-keyboard, server-interoperability or visual-layout acceptance test. Those still require
separate testing on the target desktop. The larger `shell.smoke.js` and preferences checks remain
independent; a successful lifecycle test does not claim that every assertion in those suites passed.

## References

- [GNOME Shell 48 migration guide](https://gjs.guide/extensions/upgrading/gnome-shell-48.html):
  shared orientation and context APIs.
- [GNOME Shell 51 migration guide](https://gjs.guide/extensions/upgrading/gnome-shell-51.html):
  removed interfaces and deprecated event signals.
- [Synchronization performance testing](sync-performance-testing.md): independent transfer budgets
  and CI delay diagnostics.
