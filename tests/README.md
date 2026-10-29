# Test layout

> English · [简体中文](README_CN.md)

Tests are mainly **logic checks**: the extension keeps its decisions in modules that do not need
GNOME Shell, and those modules are verified with real storage, files, a private D-Bus and local HTTP.
The **desktop simulation** keeps only the few core wiring checks that must go through a real Shell,
as a smoke check before a release.

```text
tests/
  logic/        # headless; registered in Meson and run by CI
  simulation/   # real Shell/GTK; run locally and explicitly, never in CI
    helpers/    # shared isolated-desktop driver
    panels/     # PANEL-01…10 panel navigation
  fixtures/     # standalone GTK source/receiver, preferences process, session wrapper
```

## Logic checks (daily)

```sh
dbus-run-session -- meson test -C build --no-suite stress --print-errorlogs   # bun run test:logic
bash tools/test-logic-acceptance.sh                                            # bun run test:logic:acceptance
```

The first is the ordinary regression suite; it takes a few seconds and CI runs it on GNOME 50/51.
The second is headless acceptance for capture state, the history controller, input guards, screenshot
orchestration, phrase drafts and network dictionaries, each on a private session bus; CI runs it too,
and a missing dependency (`BLOCKED`, exit 2) fails the job instead of passing.
`--suite stress` holds the optional stress tests; see [sync performance testing](../docs/sync-performance-testing.md).

Headless integration against a real sync server (Docker plus the sibling `clipboard-x-server`
source or an image):

```sh
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip [--image IMAGE] [--case SEND-04]
```

## Desktop simulation (before a release)

```sh
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip                   # 13 core scenarios in one Shell
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --isolate-cases   # one Shell per scenario
bash tools/test-panels.sh build/clipboard-x-gnome_1.x.x.zip                          # PANEL-01…10
bash tools/test-shell-compatibility.sh build/clipboard-x-gnome_1.x.x.zip             # enable/disable/re-enable
```

Runs use a private `/tmp/clipboard-x-simulation-*` directory with isolated XDG, session bus, clipboard
source and input target; the host desktop is never modified. Reports are written to
`build/simulation-tests/`. `PASS`, `FAIL`, `NOT_RUN` and `BLOCKED` mean passed, failed, not run and
missing dependency.

## Scenario → test

| Scenario | Logic test | Desktop simulation |
|---|---|---|
| Capture text/images, write back to the clipboard | `clipboard/capture`, `content`, `history/controller` | CLIP-01, CLIP-04, CLIP-09 |
| History order, pins, limits, search, corruption recovery | `clipboard/history/*` | — |
| Privacy mode, excluded applications | `clipboard/capture` | PRIV-01 |
| Quick phrases | `clipboard/phrases/store`, `ui/phrase-draft` | PHRASE-01 (with Escape), PHRASE-04 |
| Tokenizing, dictionaries, input limits | `clipboard/tokenizer/*` | — |
| Word selection, late results | `ui/word-selection` | SELECT-01, WORD-05 |
| Simulated input (sequences, speeds, interruption) | `clipboard/terminal/*` | TYPE-01, TYPE-03 |
| Screenshots, editor | `screenshot/*` | SHOT-03 |
| Color picker | `color-picker/color` | COLOR-01 |
| Preferences | `ui/settings-defaults`, `shortcut-capture`, `string-choice`, … | SET-01 |
| Panel navigation and focus | `ui/focus-grid`, `panel-manager`, `panel-actions`, `entry-actions` | `test-panels.sh` |
| Sync (policy, protocol, transfers, queue) | `sync/*`, `ui/sync-*` | — (`test-sync-server.py`) |
| Enable/disable lifecycle | — | `test-shell-compatibility.sh` |

## Adding tests

- Put the behavior in a module `gjs` can import directly, then add a logic test and register it in `meson.build`.
- Add a simulation case only for wiring that cannot be proven outside the Shell: register its ID in
  `simulation/manifest.json`, implement it in the domain's `native.js`, and restore any state it changes.
- Assert behavior and error codes, not translated error text, document wording or styling details.
