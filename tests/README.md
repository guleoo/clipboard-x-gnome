# Test organization

> English · [简体中文](README_CN.md)

Tests are grouped by the environment they require, then by domain:

The [functional inventory](functional-inventory.md) owns acceptance scope, entry points, gaps and
the duplicate-test review. It is not a pass report.

Observed results and retained failures are recorded separately in the
[desktop acceptance snapshot](acceptance-status.md).

```text
tests/
  environments/   # Independent GNOME 50/51 container definitions
  logic/          # No graphical desktop required
    clipboard/    # History, word selection, dictionaries, terminal sequences
    color-picker/
    common/       # Infrastructure, package and command safeguards
    i18n/
    screenshot/   # Editor argv/stdin and portal protocol checks
    sync/         # Policy, state, HTTP, storage, lifecycle and optional stress
    ui/           # Panel models, focus matrix, layouts and settings logic
  simulation/
    lifecycle/    # Installation/startup/enable/disable compatibility subset
    panels/       # PANEL-01…10, navigation, restoration, search and Escape
      cases/      # Panel suite cases and private-session driver
      fixtures/   # Display/background fixtures
    clipboard/    # Capture, entries, images, history and privacy
    phrases/      # Native forms, shortcuts and save races
    word-selection/
    terminal/     # Target typing, modifier/event guards and lifecycle
    sync/         # Toggle, progress/session recovery and received persistence
    screenshot/
    color-picker/
    settings/     # Separate GTK processes, Shell preferences and foreground
    helpers/      # Shared assertions and Shell setup, not feature cases
    shell.smoke.js # Aggregate of domain checks, not all simulation files
  fixtures/       # Shared external clipboard, typing and process helpers
```

## Independent GNOME 50 / 51 environments

Prefer the local Docker baseline instead of the host's GNOME installation. The host only needs
Python 3, Git and a running Linux Docker engine. No host extension installation, input-method
change or new GitHub workflow is involved.

```sh
# Default: both versions, non-stress logic regression and local headless acceptance
bun run test:environment
# Equivalent entry; explicitly select Docker Desktop when it is not the default context
python3 tools/test-environment.py --context desktop-linux
# Build/reuse the two environment images without running tests
python3 tools/test-environment.py --build-only
# Select desktop cases only when actual Shell behavior is required; builds the ZIP inside
python3 tools/test-environment.py --suite simulation --case TYPE-02-vte,TYPE-03
# Explicit language/display profiles and single-version selection
python3 tools/test-environment.py --shell 51 --suite simulation --case DICT-02 --language zh_CN
# Explicitly update dependency layers, never during ordinary image reuse
python3 tools/test-environment.py --rebuild --build-only
```

GNOME 50 uses `tests/environments/gnome50/Dockerfile`; GNOME 51 uses
`tests/environments/gnome51/Dockerfile`. Each pins its own Fedora base digest and Shell version,
so dependencies can evolve separately. Only the session bootstrap is shared. The build context is
`tests/environments/`; the runner selects the matching Dockerfile automatically. Image definition
hashes are independent: editing one Dockerfile does not invalidate the other version's image.
Before package installation, both images remove Fedora's English-only catalog filter and retain
GNOME/GTK translations, with Arabic and German locales available. Plugin catalogs alone do not
provide a real RTL desktop. `LANG-03 --language ar/de` observes actual Shell/GTK direction and
operates narrow panels containing long text; it never forces widget direction to obtain a pass.
`LANG-07-dictionary --language zh_CN` checks actual dictionary error bodies; an untranslated
diagnostic must remain a failure.
The runner prefers an installed matching UTF-8 locale, never an ISO-8859/EUC candidate sharing
the same language prefix. Reports record `messageLocale`; fallback to a non-C UTF-8 base permits
catalog checks, but does not certify actual RTL behavior when the requested locale is unavailable.
Every run creates a fresh container; test processes run as ordinary UID 1000. The system bus runs
only inside that container. The host supplies a read-only source snapshot, not HOME, display/input
devices, D-Bus/Docker sockets or credentials. Host environment variables are not forwarded.
The snapshot excludes `.git`, `.codex`, build directories and the user's typing sample. GTK's input
module is explicitly Wayland. The standard IBus daemon is included because Shell's Unicode/text-input
path needs it; no Fcitx or Pinyin engine is added. Framework availability is not real-IME coverage.

Runtime networking is `none`: only the container's loopback is available, including HTTP/TLS
logic fixtures. Real sync servers, public HTTPS, IME and editor installation variants retain their
specialized runners; this phase does not orchestrate the full desktop matrix. Missing optional
Gradia/Flatpak dependencies block their cases, not pass them. Browser cases set
`seccomp=unconfined` for that container to permit the browser's own namespace sandbox; they never
use privileged mode, host networking or browser `--no-sandbox`. A kernel denying user namespaces
is an environment blockage, not a plugin input failure. Containers share the engine's kernel;
they do not promise identical hardware or performance.

`build/environments-*/` holds status, base digest, actual image ID, definition/source hashes, full
RPM versions and test logs. Results are exported before deleting only the run's container; images
remain for reuse. Changed definitions require explicit rebuild. Distribution repositories can
change: **a pinned base does not make future dependency rebuilds byte-identical**. For strict
cross-machine reproduction, share the built images with Docker image save/load and compare image
IDs and package lists. Different images must not be treated as a GNOME-major-version-only comparison.

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

Capture state, history-controller, draft, input-guard, screenshot-pipeline and network-dictionary
acceptance extracted from desktop tests has an explicit local entry point:

```sh
bash tools/test-logic-acceptance.sh
# Or bun run test:logic:acceptance
```

It clears display variables and uses private session buses without starting Shell or GTK. It
complements rather than reruns the default Meson suite and is not automatically added to CI.
Existing algorithm matrices continue to reuse Meson's word, color, storage and sync tests.
Filesystem/HTTP integration is logic verification too; data rules do not require a desktop.
Network dictionaries need a GVfs HTTP(S) backend; TLS rejection also needs `openssl`. Missing
dependencies are BLOCKED, not passes.

Run logic acceptance against the real sync backend separately:

```sh
python3 tools/test-sync-http.py --list
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip --headless
```

This reuses the owned Docker backend and cleanup boundaries, exercising production clients,
storage, queues and a real HTTP gate without a graphical desktop or a GNOME version dependency.
Select publishing idempotence, device revocation, pagination, destinations or verification with
`--case`. Results go to `build/sync-http-tests/`. Known failures move with their cases rather than
being rewritten as expected successes.

## Simulated desktop verification

`simulation` runs the real Shell/GTK implementation in a prepared graphical or isolated headless
desktop. It is not a fake widget model. Native input tests inject Mutter virtual-device events;
other integration checks inspect actual actors/windows or use controlled signals and callbacks.
GTK always runs outside the Shell process.

Use the existing isolated entry points after building the release ZIP:

```sh
bash tools/test-shell-compatibility.sh build/clipboard-x-gnome_1.x.x.zip
bash tools/test-panels.sh build/clipboard-x-gnome_1.x.x.zip --repeat 2
# Native acceptance (implemented registry cases, not a claim of complete coverage):
python3 tools/test-simulation.py --list
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --group clipboard --isolate-cases
# The panel suite is also available as:
bun run test:simulation:panels
```

`test:simulation:panels` runs the local panel acceptance suite, not every simulation file. Additional
focused checks and GTK invocations are described in [Contributing](../CONTRIBUTING.md).
The Shell and panel runners automatically use the new directory; the UI check matrix and
the lifecycle subset already used by CI are unchanged. Detailed isolation and coverage boundaries:
[Shell compatibility](../docs/shell-compatibility.md), [panel tests](../docs/panel-testing.md).

Each domain's `.smoke.js` can run through the isolated `run_shell_check` helper documented in
Contributing. `shell.smoke.js` imports its checks from those owners instead of duplicating them.
`CBX_SIMULATION_CASES=phrases,wordSelection` selects named checks from that aggregate; unknown names
fail. Focused native form/search/picker suites and GTK integrations still run separately.

Do not routinely run the aggregate plus every component and count that as extra coverage. Select
the relevant entry and layer from the inventory. Viewport dragging uses fixed stage coordinates and
live picking, not stale actor coordinates after focus scrolling. An entry point is not proof that
the entire aggregate passes.

### Native functional runner

`tools/test-simulation.py` selects functional IDs from `simulation/manifest.json`. It accepts
`--case CLIP-01,CLIP-09`, `--group clipboard`, `--shell 50` / `51`, and `--language zh_CN`.
By default each module gets a fresh Shell; `--isolate-cases` starts one per case and continues after
failures, without automatic retries. The original ZIP is unchanged; metadata is amended only in a
private test copy if required for 51.

XDG directories, Session Bus, clipboard sources and input targets are isolated under a private
`/tmp/clipboard-x-simulation-*`. Never run the automation script directly in a host or development
desktop: fixtures clear their own history and phrases. `fixtures/desktop-app.js` is an independent
GTK Wayland source/receiver that reads actual MIME bytes and hashes. Delayed-owner races suspend,
resume or terminate that owned source process instead of replacing the extension's read function.
Virtual input does not establish physical-keyboard interruption guarantees.

Logs, `summary.txt` and `report.json` are saved under `build/simulation-tests/`, including ZIP hash,
Shell, language and outcomes. `PASS`, `FAIL`, `NOT_RUN`, `BLOCKED` distinguish success, failed
assertions/runs, unexecuted cases and missing dependencies. Exit codes are 0 for all selected cases
passing, 1 for failures/unexecuted cases, and 2 for dependency blocks only. Unregistered gaps remain
in the [functional inventory](functional-inventory.md); a green subset is not complete acceptance.
This entry point is not added to CI.

Reports record the original and prepared ZIP hashes plus a test-source fingerprint fixed at start.
Changing test sources during a run invalidates that run; documentation edits do not. An abnormal
Shell exit fails its active case, and later unstarted cases remain NOT_RUN. Assertion failures also
try to save a screenshot of the isolated desktop; a crashed compositor cannot supply one.

Locale-specific cases require a generated non-C UTF-8 base locale (for example `en_US.UTF-8`),
because gettext ignores `LANGUAGE` under C.UTF-8. DICT cases additionally require `--language zh_CN`;
missing locale/application/GVfs dependencies are BLOCKED, not passed. Examples:

```sh
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case DICT-02,DICT-06,DICT-08 --language zh_CN
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case LANG-02 --language ja
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case EDIT-07-native,EDIT-07-flatpak
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case CLIP-02-chromium
```

CLIP-02 uses a private Chromium profile and local HTML/images. It copies real rich text and a
standalone image, with independent original-byte readback rather than an HTML image reference.

Real server acceptance:

```sh
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip --isolate-cases
# Builds the adjacent clipboard-x-server source by default; an existing image also works:
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip --image SERVER_IMAGE --case RECV-04
# Prepare the independent GNOME images, then select 50 or 51 by image:
python3 tools/test-environment.py --build-only
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip --shell-container clipboard-x-gnome-test:50 --case SEND-06,RECV-06
# Headless backend checks use the same ordinary-user environment without starting Shell:
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip --shell-container clipboard-x-gnome-test:51 --headless --case SEND-05-destinations
```

This requires running Docker. It creates owned containers, one temporary volume and a random
loopback port with synthetic credentials. An optional Shell container shares only that server's
network namespace. Cleanup removes only this run's resources, never Docker-prunes or edits server
sources. Use `DOCKER_CONTEXT=desktop-linux` before the server command if required by your setup.
Only images from `tests/environments/gnome50` / `gnome51` are accepted by `--shell-container`.
The common bootstrap drops to UID 1000, copies an immutable source snapshot and tests the supplied
ZIP. No host paths are mounted. Server scenarios share the owned backend's network instead of the
baseline's `network=none`; native cases default to a separate Shell per case. Reports include the
actual image, source/definition hashes and package list in `build/simulation-tests/` or
`build/sync-http-tests/`. Source and environment definitions are frozen together at snapshot time.
The independent `sync-peer.js` uses production SyncClient/protocol/storage to supply originals;
it is not a second GNOME Shell and does not establish two-desktop automatic-activation races.

Full preferences run in an independent GTK process. IPC observes widget positions/state only;
clicks, scrolling, combination recording and reset confirmation use Mutter input. Actual gettext
is retained, not replaced with English. Successful screenshot tests require runner-owned special
XDG directories, never the host Pictures directory. Long cases periodically renew GNOME PerfHelper
to prevent its 30-second idle exit from being mistaken for a product failure.

The session wrapper updates only the private bus activation environment so portals/default editors
use the same private XDG as Shell. Search-indexer crawl roots are also limited to the fixture directory.
An HTTP gate streams to the real server, controlling timing/one lost response without fabricating
protocol results or logging credentials/bodies. Helpers watch their owning Shell to avoid orphan
pollers after a crash. `--isolate-cases` is useful for collecting independent failures; it is not a
hidden requirement for otherwise independent cases.

### Cold replacement and recovery

```sh
python3 tools/test-lifecycle.py build/clipboard-x-gnome_1.x.x.zip --shell 51
# Actual version upgrade, if an earlier release ZIP is available:
python3 tools/test-lifecycle.py CURRENT.zip --previous PREVIOUS.zip
```

This installs only into a private XDG, checks installed file bytes, closes one real Shell process and
opens another over the same data. ENV-02/06 restore history/pins, phrases, DeviceId and an offline
destination-bound upload queue. Without `--previous`, the same artifact is reinstalled; do not call
that a version-migration test. Logs and `report.json` are written to `build/lifecycle-tests/`.

### Extended local coverage

Use `--list` for the current native registry, not as a count of certified features. Checks reuse existing
owners for malformed-image recovery, missing originals, phrase IO failure, selection gestures,
settings persistence/layout, actual editor processes and destination-bound sync recovery.
See the [observed snapshot](acceptance-status.md) for retained failures.

```sh
# Real virtual displays, not mocked monitor objects:
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case COLOR-05-displays --display dual
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case COLOR-05-displays --display fractional
# 120,002-word import/index/cache measurement (TLS rejection is headless above):
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case DICT-09 --language zh_CN
# Real two-Shell dictionary persistence, with a local HTTP request counter:
python3 tools/test-lifecycle.py build/clipboard-x-gnome_1.x.x.zip --dictionary-cold
# Independent browser textarea / GTK3-VTE PTY targets:
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case TYPE-09-firefox,TYPE-09-chromium,TYPE-02-vte --isolate-cases
```

Display cases are BLOCKED without the requested profile. Fractional testing applies a backend-advertised
125% mode through Mutter DisplayConfig. VTE requires Python GI for Gtk 3/VTE 2.91; Chromium accepts
the `chromium` or `chromium-browser` executable. Browser targets use private profiles and an owned
loopback receiver, not external sites. The VTE fixture first verifies native ASCII and real clipboard
paste independently, then tests the plugin's natural-paste path; raw PTYs are not universal terminal apps.

`TYPE-03` checks a shared short sample at standard/slow speeds, covering ASCII, mixed CJK, emoji,
multiple lines and Tab. Mismatch diagnostics record lengths, first differing code points and hashes,
not the complete sample. The old long-sample and user-sample automated entries are removed;
`tools/simulate-input-sample.txt` is not read or modified. Long-text reliability remains a known
limitation rather than an acceptance gate for this case.

Dictionary GUI tests need a normal desktop user and installed file manager/editor; Nautilus refuses
root sessions. The headless dictionary TLS case additionally needs `openssl` and checks rejection of an owned self-signed
certificate—not trusted HTTPS success. Cold dictionary checks need a generated non-C UTF-8 locale.
No test changes host certificate stores or disables certificate verification.

Additional concurrency entries cover `RECV-05-automatic-manual`, `CLIP-08-remote-loop`,
`CONN-03-refresh` and `PHRASE-08-destinations` through the server runner. They verify one actual
download, no feedback publication, shared busy controls and a naturally exiting preferences host,
and local phrase survival across configured address/Channel changes. The latter uses two addresses
of one owned backend, not two independently deployed servers.

`PRIV-05-thumbnail` gates the return of an already generated/staged real thumbnail before capture
commit; it does not prove cancellation inside the decoder. `WORD-08-close/disable/newer` delay the
real computed result and await the entire native request handler before checking stale-result guards;
they do not simulate aborting the computation itself. `SHOT-05-unsupported` reads actual portal
capabilities, verifies the unsupported-target error and retries a supported capture. It is BLOCKED
if that backend supports every target, not a substitute for every backend's denial/timeout behavior.

The Docker wrapper changes only its disposable server config to 20,000 requests/60 seconds so real
205-item publication/pagination does not exhaust the default 600-request budget. It neither changes
production defaults nor hides rate-limit errors with retries. Custom server images with conflicting
root HTTP configuration are rejected instead of silently merged.

## Adding tests

- Choose the category by runtime requirements, not `.test.js`, `.smoke.js` or `.integration.js` alone.
- Keep the domain structure within each category. Keep test-only helpers local to their owner;
  shared external programs belong in `fixtures/` and are not independent test suites.
- Register new logic checks in Meson only when appropriate. Keep graphical checks in explicit
  simulation entry points; do not add them to ordinary CI implicitly.
- Use behavior assertions for lasting risks, not source-string, document wording or style snapshots.
