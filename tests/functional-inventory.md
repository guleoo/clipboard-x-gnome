# Functional test inventory

> English · [简体中文](functional-inventory_CN.md)

This maintained inventory defines **acceptance scope and ownership**, not pass status. A listed entry
covers selected boundaries, not a claim of passing on GNOME 50/51. Historical .codex reports remain
revision-specific evidence, not the maintenance entry for current requirements.

## Evidence and execution rules

- L: no-display logic; F: real files/subprocesses; H: controlled HTTP; S: real Shell/GTK, possibly direct
  calls; I: native-dispatched virtual input; E: real apps/portal/server/independent clients; V: manual visual.
- Prioritize P0 crashes/data/privacy/unintended input, then P1 main flows and P2 cosmetics. Run 50/51
  independently. Use isolated XDG/bus/content/server; record revision, ZIP hash, environment, IDs,
  configuration, actual results and logs. Skips are not passes. Avoid an all-settings Cartesian product.
- IDs retain earlier inventory ranges; grouping does not imply full automatic coverage or one file per ID.
- Keep one behavioral owner per necessary layer. Logic versus native events, fixture setup and reused
  verifiers are not duplicate implementations. Never delete failures or weaken expectations to pass.
- Commands: [test organization](README.md); stable PANEL reproduction: [panel guide](../docs/panel-testing.md).

## Functional points and simulation ownership

### Lifecycle — ENV-01…08

Fresh/cold-overwrite installation; empty/existing storage; repeated enable/disable; cancel in-flight initialization/save/download/segmentation/screenshot/typing; recover history and destination-bound queues after closing/reopening an isolated Shell; release owned resources; preferences stay in a separate GTK process. No hot-update or physical logout requirement.

Maintained simulation entries: [lifecycle/compatibility.smoke.js](simulation/lifecycle/compatibility.smoke.js), [terminal/lifecycle.smoke.js](simulation/terminal/lifecycle.smoke.js), [settings/window.smoke.js](simulation/settings/window.smoke.js), [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

Cold entry: `tools/test-lifecycle.py`, [lifecycle/cold.smoke.js](simulation/lifecycle/cold.smoke.js).
ENV-02/06 install into private XDG, verify installed bytes and use two different Shell PIDs over the
same data to check pinned order, phrases, DeviceId and a destination-bound offline queue. Without
`--previous`, this is same-package replacement, not an older-version upgrade. Each in-flight operation
retains its own cancellation checkpoint; CI scope is unchanged.

### Panels — PANEL-01…10

Entrance/shortcut toggles; hidden indicator anchors/offsets; shared dimensions and per-panel overrides; retention/animated close/rapid reopen; return from history item 11 with query/focus/scroll intact; initial targets, focus matrices, confinement, keyboard scroll and pointer/keyboard handoff.

Maintained simulation entries: [panels/navigation.smoke.js](simulation/panels/navigation.smoke.js), [panels/monitors.smoke.js](simulation/panels/monitors.smoke.js), [panels/restoration.smoke.js](simulation/panels/restoration.smoke.js), [panels/search.smoke.js](simulation/panels/search.smoke.js), [panels/escape.smoke.js](simulation/panels/escape.smoke.js).

Evidence / remaining boundary: Use tools/test-panels.sh. Restoration adds queued refresh/input races; search adds Unicode, selected text, modifiers and keypad boundaries; Escape checks form-first cancellation and back/close configuration. Oversized panels need not auto-shrink. Physical display/visual checks remain manual.

### Capture and reuse — CLIP-01…12

External text/HTML/image sources, multilingual/multiline/tab/emoji content, representation deduplication, invalid HTML/empty content rejection; capture-size boundaries; thumbnail aspect ratio versus original data; delayed/rapid/exited owners and loop suppression; actual copy readback; independent row actions, Ctrl+click typing and optional plain-text trimming.

Maintained simulation entries: [clipboard/capture.smoke.js](simulation/clipboard/capture.smoke.js), [clipboard/entries.smoke.js](simulation/clipboard/entries.smoke.js), [clipboard/images.smoke.js](simulation/clipboard/images.smoke.js).

Evidence / remaining boundary: Includes real St.Clipboard and optional wl-copy/XWayland. Some older routing checks use constructed events; the native entry below owns external-source/input readback.

Native entry: [clipboard/native.js](simulation/clipboard/native.js), via
`tools/test-simulation.py --group clipboard`. CLIP-01 and 04–11 use independent GTK Wayland
sources/receivers for multilingual/multiline long text, PNG/JPEG/WebP/GIF/SVG, thumbnail proportions
and original-byte readback, capture-size boundaries, suspended/exited/rapid owners, deduplication,
native click/Enter, action isolation and Ctrl+click. CLIP-03/12 data rules remain in logic tests.
CLIP-02's conditional [application cases](simulation/clipboard/applications.native.js) copy from
private Firefox/Chromium profiles and a LibreOffice RTF document using native input. An independent
GTK receiver checks text/HTML hashes; browser originals also require exact dimensions and pixels.
The actual applications and GUI backends must be installed. XWayland remains separate; the GTK
multi-MIME fixture alone does not establish browser/office compatibility.

### History — HIST-01…10

Pinned-first ordering after restart; count/bytes/age and clear policies preserve pins (including all-pinned cases); preview.text search, limits and no matches; load/save/disable races; device directories, shared references and staging adoption; corrupt/missing/hash/escaped files, failed writes and temporary-file cleanup.

Maintained simulation entries: [clipboard/history/startup.smoke.js](simulation/clipboard/history/startup.smoke.js).

Evidence / remaining boundary: Also use logic/clipboard/history. Search is not full-text. Startup covers controller/store pruning and immediate shutdown, not every cold Shell recovery, disk-full or permission fault.

### Privacy — PRIV-01…08

Private mode pauses capture; sensitive MIME defaults to discard or remains memory-only; no disk/thumbnail/upload leakage; discovered/manual excluded apps; owner/privacy/exclusion changes invalidate old captures; delete/sensitive recopy cleans uploads; pin/clear/restart cannot escape local-only rules; no body/API key in logs or queue metadata.

Maintained simulation entries: [clipboard/privacy.smoke.js](simulation/clipboard/privacy.smoke.js), [clipboard/capture.smoke.js](simulation/clipboard/capture.smoke.js).

Evidence / remaining boundary: privacy owns sensitive recopy/disk cleanup/manual refusal; capture owns actual clipboard changes while private mode is enabled. Application exclusion needs real focused applications. Queue cleanup and logging reuse logic evidence. sync.json is configuration, not encrypted storage.

### Word algorithm — WORD-01…08

All languages preserve positions/punctuation/whitespace; contractions, adjacent sentences, URL/email/number/path, emoji and mixed scripts; source-order reconstruction; identical copy/paste/type result, empty selection; configurable default 2000-word limit and exact boundaries; long-input responsiveness; stale results after panel/dictionary/lifecycle changes.

Maintained simulation entries: [word-selection/keyboard.smoke.js](simulation/word-selection/keyboard.smoke.js).

Evidence / remaining boundary: Algorithm/data boundaries belong to logic/clipboard/tokenizer; Shell checks prove rendered buttons/result, not every language or target-app delivery. Long-text responsiveness needs timing, not only output equality.

### Word interaction — SELECT-01…07

Click toggles once; held A→C selects ABC, backtracking to B leaves AB, selected anchors invert; reverse/cross-row/clipped/outside releases; Shift+arrows and Space/Enter; source preview, scroll/result/footer layout; leaving/closing/disabling ends dragging.

Maintained simulation entries: [word-selection/drag.smoke.js](simulation/word-selection/drag.smoke.js), [word-selection/viewport.smoke.js](simulation/word-selection/viewport.smoke.js), [word-selection/keyboard.smoke.js](simulation/word-selection/keyboard.smoke.js).

Evidence / remaining boundary: drag uses native dispatch; keyboard also directly invokes handlers for Shift semantics. The old viewport failure reused stale actor coordinates after focus scrolling; the fixture now uses fixed stage points and live picking. It is not evidence of a product defect. Navigation-only Back/Copy checks belong to PANEL.

### Dictionaries — DICT-01…09

Locale/region matching and system fallback; multiple enabled dictionaries; UTF-8/frequency/duplicates/empty/bad data and valid language declaration; import-time language ownership; size/count boundaries; explicit network add/refresh only with old-version retention; editor/directory/delete, atomic replacement, cache invalidation, shared loads, cancellation and indexing latency.

Maintained simulation entries: [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

Native entry: [word-selection/dictionary.native.js](simulation/word-selection/dictionary.native.js),
with `--language zh_CN`. DICT-02 operates the real file chooser and multiple source switches;
DICT-06 covers explicit network Add/refresh, actual word-panel reload, invalid-refresh retention,
no implicit downloads (DICT-07) and removal. DICT-08 targets a real default editor and file manager.
Missing applications/GVfs HTTP support are BLOCKED. Data limits stay logic-owned; large-dictionary
timing and every backend variant remain separate boundaries.

### Quick phrases — PHRASE-01…08

Real Add focus, main/keypad Enter and save button; repeated Add/Escape cancel; no entry-edit shortcut interception; whitespace/duplicates/length/count/order; configured copy/paste/type/delete and close-after-copy; concurrent/delayed/failed saves preserve newer draft/focus; restart and local-only persistence independent of clipboard clear/sync.

Maintained simulation entries: [phrases/form.smoke.js](simulation/phrases/form.smoke.js), [phrases/integration.smoke.js](simulation/phrases/integration.smoke.js).

Evidence / remaining boundary: form owns native submission; integration owns action routing and controlled save races; logic/clipboard/phrases owns storage. These do not prove IME input or external target delivery (TYPE).

### Paste and typing — TYPE-01…09

Distinct clipboard effects for copy/paste/type; original target receives exact ASCII/CJK/emoji/tab/multiline/long content at both speeds; trigger-modifier wait/timeout, active modifier fuse, one notification, queued cancellation and key release; IME/CapsLock/layout/focus/toolkit variations and documented physical-input limits.

Maintained simulation entries: [terminal/typing.smoke.js](simulation/terminal/typing.smoke.js), [terminal/guard.smoke.js](simulation/terminal/guard.smoke.js), [terminal/lifecycle.smoke.js](simulation/terminal/lifecycle.smoke.js).

Evidence / remaining boundary: typing compares a real GTK Wayland target. guard constructs events; lifecycle controls modifier state and suppresses characters. Neither proves hardware interruption or IME bypass. Physical tests remain mandatory for those claims.

### Screenshots — SHOT-01…07

Button/shortcut and supported portal targets; history/copy/editor option combinations; cancel without notification/side effects; denial/timeout/unavailable/missing URI errors and retry; repeated requests and disable cleanup; real images with spaced/non-ASCII paths.

Maintained simulation entries: [screenshot/pipeline.smoke.js](simulation/screenshot/pipeline.smoke.js), [screenshot/cancel.smoke.js](simulation/screenshot/cancel.smoke.js).

Native entry: [screenshot/native.js](simulation/screenshot/native.js). SHOT-03 uses both entry points,
the real portal/permission UI and history/copy combinations with editing disabled; SHOT-04 cancels
actual ScreenshotUI without a failure notice. Owner/capture completion is awaited, not inferred from
callback return. Pictures is configured before Shell starts inside the private runtime. Other targets
and induced protocol failures retain separate pipeline/logic ownership.

### Image editor — EDIT-01…07

Empty command does not fetch; argv %u/%f/%i/%%, quoting and paths; invalid placeholders/commands/files/URIs; local/cached/lazy originals and offline rules; slow/non-reading/early-exit editor must not block Shell; real native/Flatpak Gradia, correct popup close and editor lifetime.

Maintained simulation entries: [clipboard/images.smoke.js](simulation/clipboard/images.smoke.js).

Native entry: [screenshot/editor.native.js](simulation/screenshot/editor.native.js). EDIT-01 checks
the real missing-command notification without fetching originals; EDIT-06 exercises a slow/non-reading
stdin child and early exits while measuring Shell heartbeat. EDIT-07-native launches real Gradia and
checks distinctive image pixels on its canvas. EDIT-07-flatpak requires the installed application,
not merely the CLI. Argument/data rules remain in logic tests.

### Color picker — COLOR-01…07

Real sampling, pointer/key confirm/cancel, latest pixel once; one physical pixel per arrow, Ctrl and rapid steps; color formats/swatches; edges, negative coordinates, fractional/multiple monitors; pending samples/grab failures, close/disable/reopen release modal/signals and restore input.

Maintained simulation entries: [color-picker/sampling.smoke.js](simulation/color-picker/sampling.smoke.js), [color-picker/movement.smoke.js](simulation/color-picker/movement.smoke.js), [color-picker/lifecycle.smoke.js](simulation/color-picker/lifecycle.smoke.js).

Evidence / remaining boundary: sampling dispatches native events on real swatches; movement injects picker scales/handler events, NOT actual fractional-display evidence. lifecycle gates pending captures and checks lock/resume integration. Real hardware geometry remains separate.

### Connection and devices — CONN-01…10

IP/HTTP/HTTPS/subpaths/authentication/invalid URLs; test unsaved inputs without restarting sync; non-reentrant rapid test/apply/retry/close; apply persists and immediately updates device/channels; stable DeviceId, editable tag/free icon string/fallback/local omission; missing/forbidden/removed channels without cursor/destination leakage. Offline, slow, expired/revoked or incompatible servers have localizable errors; concurrent settings/Shell writes preserve configuration fields without leaking keys.

Maintained simulation entries: [settings/icon.integration.js](simulation/settings/icon.integration.js), [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

Native entries: [sync/connection.native.js](simulation/sync/connection.native.js),
[sync/native.js](simulation/sync/native.js), via `tools/test-sync-server.py`. CONN-02/03/04/05 operate
the complete independent GTK window against the real server: unsaved Test input, busy controls,
repeated native clicks, in-flight close, immediate profile Apply and retry. CONN-06-profile checks
identity/profile persistence against the management API, not the web UI. URL/auth/concurrent-store
combinations retain their existing logic ownership.

### Upload queues — SEND-01…10

Send modes/favorites-only, exact text/image thresholds; freeze manifest before request; per-server/channel/device recovery; disabled sync pauses without enqueueing new copies; lost-response confirmation; deletion/sensitivity/missing originals, no remote echo; corrupt queues/save failures/backoff/permanent errors and confirmation/shutdown persistence.

Maintained simulation entries: [sync/toggle.smoke.js](simulation/sync/toggle.smoke.js), [sync/status.smoke.js](simulation/sync/status.smoke.js).

Native entries: [sync/native.js](simulation/sync/native.js), [sync/queue.native.js](simulation/sync/queue.native.js)
and [sync/local-boundary.native.js](simulation/sync/local-boundary.native.js). The real server receives
manual/automatic/pinned-only publications, independent MIME policy, exact thresholds, disabled-copy
exclusion and durable delivery confirmation. A separate streaming HTTP gate holds actual requests or
drops one real completion response for frozen-manifest/interruption/deletion/idempotency checks.
It never replaces SyncClient results. Corruption, backoff and full destination matrices remain logic-owned.

### Receive and lazy content — RECV-01…10

Off/history/activate modes; late join, pagination, replay and cursor persistence; local fetch thresholds; direct download or request-origin/wait/download; concurrent reuse, offline/deleted/private/expired sources, cancellation; all representations complete; late-result protection; local versus channel removal and verified device cache.

Maintained simulation entries: [sync/receive.smoke.js](simulation/sync/receive.smoke.js).

Native entries: [sync/native.js](simulation/sync/native.js), [sync/network.native.js](simulation/sync/network.native.js).
An independent production source client/store uses the real server. Cases cover receive modes, local
thresholds, server-and-receiver lazy originals, shared downloads, source rejection, multi-representation
persistence/offline primary reuse, late-result protection and local versus server deletion. A streaming
gate delays actual bytes. This is one real Shell plus an independent source process, not two actual
desktops or every pagination boundary.

### Transfers and errors — XFER-01…09

Distinct unsent/wait/transfer/verify/snapshot-complete/original-complete/error states; exact monotonic bytes and stale-result protection; restore without per-item saves/rebuild; session/cancel/waiter cleanup; malformed/oversized/interrupted responses; length/hash and part cleanup; GLib versus optional sha256sum, including missing dependency.

Maintained simulation entries: [sync/status.smoke.js](simulation/sync/status.smoke.js), [sync/toggle.smoke.js](simulation/sync/toggle.smoke.js).

XFER-02 observes real uploads and exact remote totals; XFER-02-download throttles a real response and
requires intermediate, bounded, monotonic byte counts per transfer plus exact final clipboard hash.
XFER-04 restores 20 completed server records and observes zero render/persist/save calls inside the
restore phase. These supplement logic/sync/{transfers,http-failures,file-verifier}.test.js. Optional
stress/verifier memory benchmarks remain separate explicit runs, not ordinary CI.

### Settings — SET-01…09

Current pages/options and valid boundaries; classify internal/inactive keys; accent/foreground text+icons, geometry, layout/hiding (shortcuts remain); full chord capture/cancel/clear/conflicts/rebind; discovered/manual exclusions; reset confirmation preserves user data/connection/identity and later saves; About version/links.

Maintained simulation entries: [settings/window.smoke.js](simulation/settings/window.smoke.js), [settings/foreground.smoke.js](simulation/settings/foreground.smoke.js), [settings/layout.smoke.js](simulation/settings/layout.smoke.js), [settings/icon.integration.js](simulation/settings/icon.integration.js), [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

Native entry: [settings/native.js](simulation/settings/native.js). SET-01 visits all eight actual pages;
SET-06 records/cancels/clears a real chord in independent GTK; SET-08 operates both reset branches,
preserves identity/phrases and verifies a later setting still saves. Theme/layout/exclusion/link cases
retain their component/data ownership, not blanket GUI certification.

### Languages and visuals — LANG-01…07

Catalog extraction/compilation and safe placeholders; actual menu/settings/error/notification/dialog language; EN/ZH/JA/KO, RTL/long strings; baseline/caret/offset, themes/contrast/hover/selection, ellipsis/thumbnails/icons/separators/scrollbars. Bounded, non-sensitive notifications; screenshot cancellation reuses SHOT.

Maintained simulation entries: [shell.smoke.js](simulation/shell.smoke.js).

Native entry: [settings/language.native.js](simulation/settings/language.native.js), LANG-02 with
`--language en_US`, `zh_CN`, `ja`, `ko`. Check installed catalogs in the actual menu, word panel,
independent preferences and missing-editor notification. A generated non-C message locale is required:
C.UTF-8 ignores gettext LANGUAGE selection. Catalog completeness remains logic/i18n/coverage.sh;
linguistic quality, RTL/long-string layout and visual polish remain manual.

### Responsiveness and tooling — OPS-01…08

Measure main-loop stalls across complete operations, not only callback return; distinguish network waits, track memory/FD/source growth and verifier-specific budgets; optional ten-times-daily stress; runtime-only packages/no secrets; dev-shell build/isolation/language/exit/logs.

Evidence / remaining boundary: Use existing logic/sync measurements/stress, logic/common checks and tools/check_release.py. Stress remains opt-in/outside ordinary CI. Packaging reuses ENV-01 evidence. Async APIs or one successful run do not prove the Shell never blocks.

## Native acceptance additions

`tools/test-simulation.py` maintains these additional native chains; select IDs with `--case`.
These are coverage boundaries, not certification of every requirement within an ID.

| Module | IDs | Actual evidence and boundary |
| --- | --- | --- |
| `clipboard/applications.native.js` | CLIP-02-firefox/chromium/office | Real local HTML/RTF sources, private profiles, native copy and independent MIME readback; conditional on GUI applications |
| `clipboard/policy.native.js` | PRIV-01/03/04/05/07, HIST-01/04/10 | Actual GTK owners, sensitive MIME, focused-window exclusion, in-flight cancellation, pinned-first restart, Unicode search and real replace errors; not password-manager or disk-full interoperability |
| `phrases/native.js` | PHRASE-01/02/04/05/06/07 | Native input/submission, Escape, independent copy/paste/type receiver, close policy, delayed writes and retry after real IO failure; not every IME or cold-Shell recovery |
| `word-selection/native.js` | WORD-05/06/07/08, SELECT-01/03/04/06/07 | Native row entry, result readback, 2000-word/configured limits, long-input heartbeat, late results, held dragging/Shift ranges, scrolling and exit cleanup |
| `terminal/native.js` | TYPE-01/03/05/06/07 | Independent GTK target, exact mixed-language output at both speeds, real backend modifier wait/fuse, one notification/queued cancellation, no old typing after actual disable/re-enable |
| `sync/native.js` | CONN-06-profile, SEND-01/01-pinned/02/03/06/10, RECV-01/03/04/09, XFER-02/04 | Real server/source, durable state and actual transport |
| `sync/connection.native.js` | CONN-02/03/04/05 | Complete GTK Test/Apply/failure/retry and in-flight close |
| `sync/network.native.js` | RECV-05/06/07/08, XFER-02-download | Real gated downloads, source failure, stale choices and exact progress |
| `sync/queue.native.js` | SEND-04/07/08 | Frozen disk manifests, interrupted/deleted work and lost responses |
| `sync/local-boundary.native.js` | PHRASE-08, PRIV-08 | Active-server local-only data boundaries; not a log-redaction audit |
| `settings/native.js`, `settings/language.native.js` | SET-01/06/08, LANG-02 | Complete independent preferences, native recording/reset and actual catalogs |
| `word-selection/dictionary.native.js` | DICT-02/06/08 (also DICT-07) | Local/network import, multiple sources, refresh/retention, editor/file manager |
| `screenshot/native.js`, `screenshot/editor.native.js` | SHOT-03/04, EDIT-01/06/07-native/07-flatpak | Actual portal, cancellation, bounded stdin and real Gradia canvas |
| `color-picker/native.js` | COLOR-01/03/04/07 | Actual swatches, pixel movement, formats and disable/reopen |

SELECT-01 reuses the existing drag implementation including SELECT-02 ranges; SELECT-03 reuses
viewport. Form/Escape also share verifiers instead of copied scenarios. Native cases replace claims
that invoking a handler alone establishes user interaction; logic tests still own data boundaries.

WORD-07 measures ordinary 2000-word input, 100,000-character URLs and 200,000-character unbroken text
against a 1000ms main-loop budget. Each sample logs length, word count and maximum gap. Do not enlarge
budgets, skip failures or change production code just to make tests green. A virtual backend modifier
fuse proves neither physical input delivery nor input-method bypass. CI scope is unchanged.

## Duplicate-test review

| Previous overlap | Disposition |
| --- | --- |
| Panel dimensions | PANEL-03 owns the full matrix/overrides; remove the smaller aggregate copy. |
| Outer-popup height equality | Drop this stronger, unsuitable constraint: title/footer chrome differs across panels and Shell versions. PANEL-03 verifies configured panel dimensions, as agreed, not identical outer decoration. |
| Hidden anchors and direct toggle | PANEL-01/02 own actual events/display profiles; remove clipboard entry copies. |
| Initial focus, Ctrl+F, arrows, confinement | PANEL-06/07/08 own navigation; remove phrase/word handler copies, retain Unicode search. |
| Phrase Enter and basic direct save | phrases/form owns main/keypad Enter and button; retain distinct draft/failure races in integration. |
| Sync toggle inside image editing | sync/toggle owns state/focus/row identity; images owns original/editor behavior. |
| Sensitive refusal in image and privacy tests | clipboard/privacy owns manual refusal/disk boundary; sync/status keeps automatic policy and progress/session retry. |
| Modifier-release wait and duplicate direct pin | terminal/lifecycle owns wait/release/cleanup; retain guard's distinct filter check. Keep row pin shortcut, remove extra direct toggles. |
| Similar names, different failure boundaries | Keep round-trip versus queued restoration, normal versus clipped dragging, sampling versus delayed capture. |
| Compatibility, PANEL-10 and input-mode | Call one verifier, not duplicate implementations; repeated explicit suite runs are not extra feature coverage. |

The aggregate [shell.smoke.js](simulation/shell.smoke.js) only composes domain checks; it does **not** run
all simulation files. CI keeps its existing compatibility subset. No production behavior, CI scope or
stress-test policy changes are part of this organization.

Extend an existing owner before adding another test. Reference cross-domain evidence (privacy/upload
cancellation, package/install, notification/cancel), rather than copy scenarios. Store run results separately.
Do not add permanent assertions for CSS strings, routine widget properties, wording or release formatting.
Physical typing/IME, two-desktop activation races, uninstalled applications and visuals need independent evidence.
