# Functional test inventory

> English · [简体中文](functional-inventory_CN.md)

This maintained inventory defines **acceptance scope and ownership**, not pass status. A listed entry
covers selected boundaries, not a claim of passing on GNOME 50/51. Execution results remain separate
in the [acceptance snapshot](acceptance-status.md); a case's PASS does not certify all boundaries of an ID.

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

| ID | What to test / expected result |
| --- | --- |
| ENV-01 | Install the current ZIP into an empty profile; verify metadata, schemas, translations/resources and recognition by the extension system. |
| ENV-02 | Overwrite an installed package, then start a different Shell process and verify the installed code and preserved data; hot reloading is not required. |
| ENV-03 | Start with empty and existing storage; merge copies arriving during initialization without replacing valid history with an empty snapshot. |
| ENV-04 | Enable, disable, immediately re-enable and repeat; keep one indicator, one shortcut response and one capture per clipboard change. |
| ENV-05 | Disable during initialization, save, download, word processing, screenshot or typing; cancel owned work and reject late results. A system-owned screenshot UI may remain open: completing/canceling it after disable must release its modal, keep Shell interactive and not resume plugin side effects. |
| ENV-06 | Close and reopen an isolated Shell; restore history and destination-bound upload queues, and explicitly reject corrupt state. Physical logout/power-loss recovery is not required. |
| ENV-07 | After disable, release owned signals, timers, modal grabs, virtual devices, HTTP sessions and waiting consumers. A system-owned screenshot modal is assessed after user completion/cancellation under ENV-05. |
| ENV-08 | Run preferences in a separate GTK process without Meta/Adw import errors; closing it must end owned UI and pending follow-up work. |

Maintained simulation entries: [lifecycle/compatibility.smoke.js](simulation/lifecycle/compatibility.smoke.js), [terminal/lifecycle.smoke.js](simulation/terminal/lifecycle.smoke.js), [settings/window.smoke.js](simulation/settings/window.smoke.js), [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

Cold entry: `tools/test-lifecycle.py`, [lifecycle/cold.smoke.js](simulation/lifecycle/cold.smoke.js).
ENV-02/06 install into private XDG, verify installed bytes and use two different Shell PIDs over the
same data to check pinned order, phrases, DeviceId and a destination-bound offline queue. Without
`--previous`, this is same-package replacement, not an older-version upgrade. Each in-flight operation
retains its own cancellation checkpoint; CI scope is unchanged.

### Panels — PANEL-01…10

| ID | What to test / expected result |
| --- | --- |
| PANEL-01 | Open/close from the indicator and global shortcut; a second shortcut or a desktop-background click closes the popup. |
| PANEL-02 | With the indicator hidden, open by shortcut; verify all nine anchors and positive/negative offsets in supported work areas. |
| PANEL-03 | Apply configured width/height to history, word selection and phrases; explicit per-panel overrides do not affect other panels. Automatic work-area shrinking is not required. |
| PANEL-04 | Retain or reset the active panel according to configuration; animated closing must not flash the history panel, including rapid reopen. |
| PANEL-05 | Enter word selection from a later history row and return with query, row/action focus and scroll position preserved. |
| PANEL-06 | On first navigation, target history search, the first word, the first phrase, or Add when phrases are empty. |
| PANEL-07 | Navigate the focus matrix with arrows; skip hidden controls and handle unequal rows, endpoints, Back and footer actions. |
| PANEL-08 | Respect focus-confinement configuration; local shortcuts must not intercept input outside the popup or in another extension. |
| PANEL-09 | Scroll a keyboard-focused offscreen item into view; stale asynchronous restoration must not undo the user's wheel scrolling. |
| PANEL-10 | Use the latest real pointer/keyboard input for focus/highlight and tooltip handoff; protect text editing, ignore stationary hover/wheel for retargeting, preserve selection and clean up on panel changes/close/disable. |

Maintained simulation entries: [panels/navigation.smoke.js](simulation/panels/navigation.smoke.js), [panels/monitors.smoke.js](simulation/panels/monitors.smoke.js), [panels/restoration.smoke.js](simulation/panels/restoration.smoke.js), [panels/search.smoke.js](simulation/panels/search.smoke.js), [panels/escape.smoke.js](simulation/panels/escape.smoke.js).

Evidence / remaining boundary: Use tools/test-panels.sh. Restoration adds queued refresh/input races; search adds Unicode, selected text, modifiers and keypad boundaries; Escape checks form-first cancellation and back/close configuration. Oversized panels need not auto-shrink. Physical display/visual checks remain manual.

### Capture and reuse — CLIP-01…12

| ID | What to test / expected result |
| --- | --- |
| CLIP-01 | Capture and copy back short/long, multiline and tabbed text, CJK/English, emoji and combining characters from an independent application. |
| CLIP-02 | Copy real Firefox/Chromium rich text offering plain and HTML representations; deduplicate aliases and verify primary text and preview. |
| CLIP-03 | Reject empty HTML, metadata-only/tags-only, blank and invalid representations without discarding valid rich text. |
| CLIP-04 | Capture actual PNG/JPEG/WebP/GIF/SVG offers; failed formats must not leave capture permanently busy. |
| CLIP-05 | Preserve thumbnail aspect ratio for wide/tall/high-resolution images; copy/edit the original, never the thumbnail. |
| CLIP-06 | Test below/equal/above the capture-size limit; truncated bytes must not be accepted as complete content. |
| CLIP-07 | Handle rapid copies, delayed providers, provider exit and owner changes without mixing owners or accepting stale bytes. |
| CLIP-08 | Deduplicate external recopy, history activation and remote writeback without loops or loss of pinned state. |
| CLIP-09 | Actual row click/Enter writes original bytes to the system clipboard; invalid or failed items must not appear successful. |
| CLIP-10 | Pin/Delete/word-selection/editor/sync actions must not activate content copy; capture remains usable after deletion. |
| CLIP-11 | Ctrl+click types text only, without unintended clipboard writes or system modifier shortcuts. |
| CLIP-12 | Optional trimming applies only to newly captured plain text; preserve internal whitespace and original HTML. |

Maintained simulation entries: [clipboard/capture.smoke.js](simulation/clipboard/capture.smoke.js), [clipboard/entries.smoke.js](simulation/clipboard/entries.smoke.js), [clipboard/images.smoke.js](simulation/clipboard/images.smoke.js).

Evidence / remaining boundary: Includes real St.Clipboard and optional wl-copy/XWayland. Some older routing checks use constructed events; the native entry below owns external-source/input readback.

Native entry: [clipboard/native.js](simulation/clipboard/native.js), via
`tools/test-simulation.py --group clipboard`. CLIP-01 and 04–11 use independent GTK Wayland
sources/receivers for multilingual/multiline long text, PNG/JPEG/WebP/GIF/SVG, thumbnail proportions
and original-byte readback, capture-size boundaries, suspended/exited/rapid owners, deduplication,
native click/Enter, action isolation and Ctrl+click. CLIP-03/12 data rules remain in logic tests.
CLIP-02's conditional [application cases](simulation/clipboard/applications.native.js) copy from
private Firefox/Chromium profiles and local HTML using native input. An independent
GTK receiver checks text/HTML hashes; browser originals also require exact dimensions and pixels.
The actual applications and GUI backends must be installed. XWayland remains separate; the GTK
multi-MIME fixture alone does not establish browser compatibility.

### History — HIST-01…10

| ID | What to test / expected result |
| --- | --- |
| HIST-01 | Keep pinned items first after pin/unpin, restart and mixed-device history; preserve remaining order and deduplication. |
| HIST-02 | Enforce count, storage-byte and age limits on eligible ordinary items; define and test the all-pinned case. |
| HIST-03 | Clear history while preserving pins; reapply retention after limit changes and lazy-original downloads. |
| HIST-04 | Search empty/case-varied/CJK/emoji/whitespace/no-match queries and enforce the displayed-result limit. |
| HIST-05 | Search preview.text as implemented; do not treat preview search as full-text search. |
| HIST-06 | Interleave startup reads, new copies, saves, deletion/pinning and immediate re-enable without reverting durable state. |
| HIST-07 | Store originals by source DeviceId; retain shared objects until their last reference is released. |
| HIST-08 | Interleave staging adoption, reads and deletion without losing originals or escaping managed storage. |
| HIST-09 | Handle corrupt indexes/items, missing objects, bad hashes, symlinks and escaped paths while recovering valid records. |
| HIST-10 | On unwritable/full storage or interrupted writes, preserve the old file, report errors and clean temporary files. |

Maintained simulation entries: [clipboard/history/startup.smoke.js](simulation/clipboard/history/startup.smoke.js).

Evidence / remaining boundary: Also use logic/clipboard/history. Search is not full-text. Startup covers controller/store pruning and immediate shutdown, not every cold Shell recovery, disk-full or permission fault.

### Privacy — PRIV-01…08

| ID | What to test / expected result |
| --- | --- |
| PRIV-01 | Verify default private-mode state and immediate toggling; copies made while paused never enter history. |
| PRIV-02 | Discard sensitive password-manager MIME by default; memory-only mode lasts only for the current extension lifecycle. |
| PRIV-03 | Keep memory-only sensitive text, indexes and thumbnails off disk/outbox; expose no upload action. |
| PRIV-04 | Exclude discovered applications and manually entered window classes; define empty, duplicate and case handling. |
| PRIV-05 | Changing privacy/exclusion policy during capture or thumbnail generation rejects the old pending result. |
| PRIV-06 | Deletion or sensitive recopy removes pending upload references/frozen manifests and prevents further sending. |
| PRIV-07 | Pin, clear, restart, retry and multiple representations never bypass the sensitive-content local-only boundary. |
| PRIV-08 | Logs, notifications and outbox files must not expose content or API keys; do not claim sync.json is encrypted. |

Maintained simulation entries: [clipboard/privacy.smoke.js](simulation/clipboard/privacy.smoke.js), [clipboard/capture.smoke.js](simulation/clipboard/capture.smoke.js).

Evidence / remaining boundary: privacy owns sensitive recopy/disk cleanup/manual refusal; capture owns actual clipboard changes while private mode is enabled. Application exclusion needs real focused applications. Queue cleanup and logging reuse logic evidence. sync.json is configuration, not encrypted storage.

### Word algorithm — WORD-01…08

| ID | What to test / expected result |
| --- | --- |
| WORD-01 | Segment supported languages without losing characters, punctuation, whitespace or original source positions. |
| WORD-02 | Recognize contractions such as can't, adjacent sentences such as that.I, URLs, email, numbers, paths and mixed scripts. |
| WORD-03 | Preserve emoji, combining characters, full-width symbols, newlines and repeated whitespace. |
| WORD-04 | Reconstruct adjacent/nonadjacent selections in source order with the intended punctuation and spacing. |
| WORD-05 | Copy/paste/type the same selected result; handle empty selection according to the focused-word fallback without accidental actions. |
| WORD-06 | Enforce the default 2,000-word limit, equality/overflow and configured limits; reject explicitly rather than silently truncate. |
| WORD-07 | Keep long unbroken text and URL/symbol-heavy input responsive before widget creation; measure main-loop stalls. |
| WORD-08 | Reject stale word results after changing item/panel, closing, editing dictionaries or disabling the extension. |

Maintained simulation entries: [word-selection/keyboard.smoke.js](simulation/word-selection/keyboard.smoke.js).

Evidence / remaining boundary: Algorithm/data boundaries belong to logic/clipboard/tokenizer; Shell checks prove rendered buttons/result, not every language or target-app delivery. Long-text responsiveness needs timing, not only output equality.

### Word interaction — SELECT-01…07

| ID | What to test / expected result |
| --- | --- |
| SELECT-01 | Click toggles once; after mouse release, hovering over other words must not keep selecting. |
| SELECT-02 | Hold A→C to select ABC, backtrack to B to leave AB; start on a selected word to invert the range. |
| SELECT-03 | Reverse/cross-row/scroll/clipped dragging and release outside the panel must not select wrong words or leave dragging active. |
| SELECT-04 | Shift+arrows select/invert from the anchor's initial state, including cross-row movement and endpoints. |
| SELECT-05 | Dispatch real Space/Enter, Back and Copy actions through the focus boundary. |
| SELECT-06 | Toggle source preview; scroll words while keeping the result at the bottom and omitting the history footer. |
| SELECT-07 | Changing panel, closing or disabling during a drag ends the session; reopening must not inherit a held gesture. |

Maintained simulation entries: [word-selection/drag.smoke.js](simulation/word-selection/drag.smoke.js), [word-selection/viewport.smoke.js](simulation/word-selection/viewport.smoke.js), [word-selection/keyboard.smoke.js](simulation/word-selection/keyboard.smoke.js).

Evidence / remaining boundary: drag uses native dispatch; keyboard also directly invokes handlers for Shift semantics. The old viewport failure reused stale actor coordinates after focus scrolling; the fixture now uses fixed stage points and live picking. It is not evidence of a product defect. Navigation-only Back/Copy checks belong to PANEL.

### Dictionaries — DICT-01…09

| ID | What to test / expected result |
| --- | --- |
| DICT-01 | Match dictionary language/region and use the system segmenter when needed; never reuse another language's cache. |
| DICT-02 | Enable system segmentation and multiple dictionaries independently; follow the selected list language and retain a usable source/fallback. |
| DICT-03 | Import valid UTF-8/frequency entries and test duplicates/empty/bad files; reject missing or invalid locale declarations. |
| DICT-04 | Retain import-time language ownership when the file header is edited. |
| DICT-05 | Test below/equal/above dictionary byte/entry limits; failed imports leave no partial file. |
| DICT-06 | Explicitly add/refresh HTTP/HTTPS sources; handle invalid responses, failures and changed language without losing a usable dictionary. |
| DICT-07 | Installation, startup, preferences and word selection do not download dictionaries implicitly; only explicit Add/Refresh may fetch. |
| DICT-08 | Open the default editor/directory, delete dictionaries and reload after atomic editor replacement. |
| DICT-09 | Share concurrent loads, invalidate caches/revisions and cancel safely; keep large parsing/indexing responsive. |

Maintained simulation entries: [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

Native entry: [word-selection/dictionary.native.js](simulation/word-selection/dictionary.native.js),
with `--language zh_CN`. DICT-02 operates the real file chooser and multiple source switches;
DICT-06 covers explicit network Add/refresh, actual word-panel reload, invalid-refresh retention,
no implicit downloads (DICT-07) and removal. DICT-08 targets a real default editor and file manager.
Missing applications/GVfs HTTP support are BLOCKED. Data limits stay logic-owned; large-dictionary
timing and every backend variant remain separate boundaries.

### Quick phrases — PHRASE-01…08

| ID | What to test / expected result |
| --- | --- |
| PHRASE-01 | Native Add focuses the form; actual text input and main/keypad Enter or Save persists, clears and collapses it. |
| PHRASE-02 | Add again or Escape cancels without saving; ordinary form typing must not trigger clipboard actions. |
| PHRASE-03 | Enforce whitespace/trim, duplicates, length/count limits, emoji and insertion order. |
| PHRASE-04 | Click/Enter copies, v pastes, apostrophe types and Delete removes; follow configured shortcuts. |
| PHRASE-05 | Both close-after-copy settings produce the right system clipboard content. |
| PHRASE-06 | Rapid/delayed submissions, edits, cancellation and panel changes preserve the newer draft and focus. |
| PHRASE-07 | Handle save/delete failure, corrupt files and restart restoration without reporting failed writes as success. |
| PHRASE-08 | Phrases remain local and survive clipboard clear or sync-destination changes without being published. |

Maintained simulation entries: [phrases/form.smoke.js](simulation/phrases/form.smoke.js), [phrases/integration.smoke.js](simulation/phrases/integration.smoke.js).

Evidence / remaining boundary: form owns native submission; integration owns action routing and controlled save races; logic/clipboard/phrases owns storage. These do not prove IME input or external target delivery (TYPE).

### Paste and typing — TYPE-01…09

| ID | What to test / expected result |
| --- | --- |
| TYPE-01 | Separate copy, paste and simulated typing; only the intended operations modify the system clipboard. |
| TYPE-02 | Paste into the target active before opening the panel; verify received bytes in an ordinary app and a terminal. |
| TYPE-03 | Receive exact ASCII, mixed CJK, emoji, multiline, Tab and long configuration text in the actual target. |
| TYPE-04 | Apply standard/slow speed in the actual target without missing or reordered characters. |
| TYPE-05 | Wait for trigger modifiers to be released; output nothing on timeout and avoid Ctrl+click shortcut leakage. |
| TYPE-06 | Fuse on backend modifier input during typing, cancel queued tasks, notify once and emit no trailing characters; hardware evidence remains separate. |
| TYPE-07 | Close/disable/session exit stops typing and releases keys; an old task cannot continue in a new instance. |
| TYPE-08 | Test real IME language modes, CapsLock, keyboard layouts and target changes; do not assume IME bypass. |
| TYPE-09 | Test multiple toolkits, browsers and terminals; document the Wayland limits on observing ordinary physical input. |

Maintained simulation entries: [terminal/typing.smoke.js](simulation/terminal/typing.smoke.js), [terminal/guard.smoke.js](simulation/terminal/guard.smoke.js), [terminal/lifecycle.smoke.js](simulation/terminal/lifecycle.smoke.js).

Evidence / remaining boundary: typing compares a real GTK Wayland target. guard constructs events; lifecycle controls modifier state and suppresses characters. Neither proves hardware interruption or IME bypass. Physical tests remain mandatory for those claims.

### Screenshots — SHOT-01…07

| ID | What to test / expected result |
| --- | --- |
| SHOT-01 | Open the real Screenshot Portal from both the button and global shortcut. |
| SHOT-02 | Exercise interactive/screen/window/area/active-window targets supported by the backend; unsupported targets must not report success. |
| SHOT-03 | Verify history, clipboard and editor options independently and in necessary combinations. |
| SHOT-04 | User cancellation emits no screenshot-failed notification and causes no history/copy/editor side effects. |
| SHOT-05 | Report denial, timeout, unavailable portal and missing URI clearly, then allow retry. |
| SHOT-06 | Repeated requests, capability lookup, cancellation and disable release owned requests/subscriptions/timers and reject old results. After disable, the user may complete/cancel the system screenshot UI normally without impairing Shell; immediate UI dismissal is not required. |
| SHOT-07 | Use real image/URI results, spaced/non-ASCII paths and immediate retry after cancellation. |

Maintained simulation entries: [screenshot/pipeline.smoke.js](simulation/screenshot/pipeline.smoke.js), [screenshot/cancel.smoke.js](simulation/screenshot/cancel.smoke.js).

Native entry: [screenshot/native.js](simulation/screenshot/native.js). SHOT-03 uses both entry points,
the real portal/permission UI and history/copy combinations with editing disabled; SHOT-04 cancels
actual ScreenshotUI without a failure notice. Owner/capture completion is awaited, not inferred from
callback return. Pictures is configured before Shell starts inside the private runtime. Other targets
and induced protocol failures retain separate pipeline/logic ownership.

### Image editor — EDIT-01…07

| ID | What to test / expected result |
| --- | --- |
| EDIT-01 | With no command, ask for configuration without fetching an original or launching another app. |
| EDIT-02 | Pass %u/%f/%i/%%, no-placeholder commands, quotes and spaced/non-ASCII paths as the intended argv/stdin. |
| EDIT-03 | Clearly reject invalid placeholders, missing commands/files and incompatible nonlocal URIs. |
| EDIT-04 | Edit local, cached-remote and preview-only remote images using the actual original. |
| EDIT-05 | With sync disabled, a lazy image cannot fetch an original; re-enable and retry successfully. |
| EDIT-06 | Keep Shell responsive when the editor starts slowly, never reads stdin, exits early or stays open. |
| EDIT-07 | Native/Flatpak Gradia receives the full image; close the popup at the right time without killing the editor on extension shutdown. |

Maintained simulation entries: [clipboard/images.smoke.js](simulation/clipboard/images.smoke.js).

Native entry: [screenshot/editor.native.js](simulation/screenshot/editor.native.js). EDIT-01 checks
the real missing-command notification without fetching originals; EDIT-06 exercises a slow/non-reading
stdin child and early exits while measuring Shell heartbeat. EDIT-07-native launches real Gradia and
checks distinctive image pixels on its canvas. EDIT-07-flatpak requires the installed application,
not merely the CLI. Argument/data rules remain in logic tests.

### Color picker — COLOR-01…07

| ID | What to test / expected result |
| --- | --- |
| COLOR-01 | Open by button/shortcut, sample actual screen pixels with pointer/magnifier and publish into clipboard/history. |
| COLOR-02 | Confirm with left click/Enter/Space and cancel with right click/Escape; use the latest valid sample once. |
| COLOR-03 | Move exactly one physical pixel per supported arrow; verify Ctrl steps and cumulative rapid presses. |
| COLOR-04 | Verify HEX/RGB/HSL/OKLCH output and the corresponding item color swatch. |
| COLOR-05 | Sample screen edges, negative coordinates and fractional/multiple displays accurately. |
| COLOR-06 | Initialization/grab failure or close/disable during sampling releases modal state and signals. |
| COLOR-07 | Repeated open/exit restores desktop shortcuts with no remaining overlay. |

Maintained simulation entries: [color-picker/sampling.smoke.js](simulation/color-picker/sampling.smoke.js), [color-picker/movement.smoke.js](simulation/color-picker/movement.smoke.js), [color-picker/lifecycle.smoke.js](simulation/color-picker/lifecycle.smoke.js).

Evidence / remaining boundary: sampling dispatches native events on real swatches; movement injects picker scales/handler events, NOT actual fractional-display evidence. lifecycle gates pending captures and checks lock/resume integration. Real hardware geometry remains separate.

### Connection and devices — CONN-01…10

| ID | What to test / expected result |
| --- | --- |
| CONN-01 | Accept bare IP:port, HTTP/HTTPS and proxy subpaths; reject invalid addresses and send the right DeviceId/API-key headers. |
| CONN-02 | Test the current unsaved inputs without saving or restarting active sync. |
| CONN-03 | Rapid Test/Apply/Refresh, failure/retry and closing in flight are non-reentrant and do not freeze Shell. |
| CONN-04 | Apply persists the connection and immediately updates tag/icon and channels; block duplicate submission until completion. |
| CONN-05 | After failed Apply, local persistence, error feedback and button state agree; show no false success. |
| CONN-06 | Generate DeviceId once and retain it across restart and tag/icon edits. |
| CONN-07 | Render bundled device/OS icons, fall back for unknown free-form strings and omit a local-source marker. |
| CONN-08 | Handle missing/forbidden/revoked/switched channels without mixing cursors or outgoing destinations. |
| CONN-09 | Localize offline/slow/auth-expired/revoked/incompatible-server feedback. |
| CONN-10 | Concurrent settings/Shell connection writes preserve unrelated fields and never expose the API key. |

Maintained simulation entries: [settings/icon.integration.js](simulation/settings/icon.integration.js), [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

Native entries: [sync/connection.native.js](simulation/sync/connection.native.js),
[sync/native.js](simulation/sync/native.js), via `tools/test-sync-server.py`. CONN-02/03/04/05 operate
the complete independent GTK window against the real server: unsaved Test input, busy controls,
repeated native clicks, in-flight close, immediate profile Apply and retry. CONN-06-profile checks
identity/profile persistence against the management API, not the web UI. URL/auth/concurrent-store
combinations retain their existing logic ownership.

### Upload queues — SEND-01…10

| ID | What to test / expected result |
| --- | --- |
| SEND-01 | Enforce disabled/manual/automatic and pinned-only publication policies without leaking unpinned content. |
| SEND-02 | Plain-text, additional rich-text and image switches affect only their corresponding representations, not local capture. |
| SEND-03 | At below/equal/above text and image thresholds, manifest delivery, preview and actual uploaded bytes agree. |
| SEND-04 | Durably freeze the manifest before the first request; reuse it after network interruption, restart and threshold changes. |
| SEND-05 | Bind per-server queues to Channel/DeviceId; changing destinations cannot misroute work and switching back restores it. |
| SEND-06 | Disabling sync pauses queued work; copies made while disabled are not enqueued or backfilled after re-enable. |
| SEND-07 | If the server commits but the response is lost, confirm/reuse the same publication instead of reuploading full data. |
| SEND-08 | Delete/sensitive/missing-original items stop or fail safely; received items are never republished as local echoes. |
| SEND-09 | Preserve valid work through failed writes, corrupt queues, backoff/permanent errors and exit interruption. |
| SEND-10 | Persist confirmed delivery and the shutdown snapshot despite save/disable interleaving, without relying on replayed history events. |

Maintained simulation entries: [sync/toggle.smoke.js](simulation/sync/toggle.smoke.js), [sync/status.smoke.js](simulation/sync/status.smoke.js).

Native entries: [sync/native.js](simulation/sync/native.js), [sync/queue.native.js](simulation/sync/queue.native.js)
and [sync/local-boundary.native.js](simulation/sync/local-boundary.native.js). The real server receives
manual/automatic/pinned-only publications, independent MIME policy, exact thresholds, disabled-copy
exclusion and durable delivery confirmation. A separate streaming HTTP gate holds actual requests or
drops one real completion response for frozen-manifest/interruption/deletion/idempotency checks.
It never replaces SyncClient results. Corruption, backoff and full destination matrices remain logic-owned.

### Receive and lazy content — RECV-01…10

| ID | What to test / expected result |
| --- | --- |
| RECV-01 | Enforce off/history-only/automatic-activation modes; never activate preview bytes as if they were originals. |
| RECV-02 | A new device joins retained channel history; pagination, replay, cursor advancement and persistence are correct. |
| RECV-03 | Use the receiver's text/image thresholds rather than the sender's thresholds to decide automatic fetch. |
| RECV-04 | Download cached originals directly; otherwise request the source, wait for server availability and then download. |
| RECV-05 | Share repeated manual/automatic fetches without duplicate work or overwriting each other. |
| RECV-06 | Handle offline/deleted/private sources and expired/rejected/timed-out server work with explicit failure and cancellation. |
| RECV-07 | Mark local completeness only after all required representations are ready; preserve the state across restart. |
| RECV-08 | After a new user copy or another manual activation, a late remote result must not replace the newer choice. |
| RECV-09 | Local deletion removes only the local copy; channel deletion follows the server event and is not broadcast accidentally. |
| RECV-10 | Verify hash/path and adopt objects under the source device; cached originals remain usable offline. |

Maintained simulation entries: [sync/receive.smoke.js](simulation/sync/receive.smoke.js).

Native entries: [sync/native.js](simulation/sync/native.js), [sync/network.native.js](simulation/sync/network.native.js).
An independent production source client/store uses the real server. Cases cover receive modes, local
thresholds, server-and-receiver lazy originals, shared downloads, source rejection, multi-representation
persistence/offline primary reuse, late-result protection and local versus server deletion. A streaming
gate delays actual bytes. This is one real Shell plus an independent source process, not two actual
desktops or every pagination boundary.

### Transfers and errors — XFER-01…09

| ID | What to test / expected result |
| --- | --- |
| XFER-01 | Match unsent/transferring/waiting/verifying/snapshot-complete/original-complete/error/cancel UI to the real state and available action. |
| XFER-02 | Report precise, bounded, monotonic upload/download bytes and exact totals; waiting must not show fake download percentages. |
| XFER-03 | Late progress and server clock differences cannot downgrade completion or overwrite a newer task. |
| XFER-04 | Restore many completed states by updating sync UI only, without per-item history saves or whole-list rebuilds. |
| XFER-05 | Close/toggle/configuration changes/disable cancel the old session and reject its late results. |
| XFER-06 | Task cancellation, cache eviction, waiting consumers and timeout/retry terminate correctly without hanging. |
| XFER-07 | Reject malformed JSON/HTTP, invalid MIME/IDs/counts/lengths, oversized responses and interrupted bodies. |
| XFER-08 | Length/hash errors preserve the old target; cancellation/failure removes .part files and never adopts unverified originals. |
| XFER-09 | Validate default GLib and optional sha256sum separately, including absent/broken dependencies, failures and framing limits. |

Maintained simulation entries: [sync/status.smoke.js](simulation/sync/status.smoke.js), [sync/toggle.smoke.js](simulation/sync/toggle.smoke.js).

XFER-02 observes real uploads and exact remote totals; XFER-02-download throttles a real response and
requires intermediate, bounded, monotonic byte counts per transfer plus exact final clipboard hash.
XFER-04 restores 20 completed server records and observes zero render/persist/save calls inside the
restore phase. These supplement logic/sync/{transfers,http-failures,file-verifier}.test.js. Optional
stress/verifier memory benchmarks remain separate explicit runs, not ordinary CI.

### Settings — SET-01…09

| ID | What to test / expected result |
| --- | --- |
| SET-01 | Open/reopen preferences and reach every current page; verify when runtime changes take effect. |
| SET-02 | Classify every schema key as user configuration, internal state or inactive; cover supported reads/writes and boundaries. |
| SET-03 | Follow system accent or save built-in/custom colors; configure ordinary text/icons to follow the system or a custom foreground, and test cancellation/theme changes without confusing foreground and accent. |
| SET-04 | Persist/apply panel dimensions, item limit, retention/focus policy and vertical text offset. |
| SET-05 | Order/hide top/footer/item actions, normalize empty/duplicate/invalid layouts and retain hidden-action shortcuts. |
| SET-06 | Record complete chords without accepting lone modifiers; cancel/clear, report invalid/conflicting bindings and verify actual rebinding. |
| SET-07 | Discover running applications and support manual exclusions; unavailable Shell or changing lists must not hang preferences. |
| SET-08 | Cancel/confirm reset with two-step protection; preserve history/phrases/dictionaries/connection/DeviceId and allow subsequent saves. |
| SET-09 | Open project/issue/license links from About and show the correct version; missing external apps must not crash preferences. |

Maintained simulation entries: [settings/window.smoke.js](simulation/settings/window.smoke.js), [settings/foreground.smoke.js](simulation/settings/foreground.smoke.js), [settings/layout.smoke.js](simulation/settings/layout.smoke.js), [settings/icon.integration.js](simulation/settings/icon.integration.js), [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

Native entry: [settings/native.js](simulation/settings/native.js). SET-01 visits all eight actual pages;
SET-06 records/cancels/clears a real chord in independent GTK; SET-08 operates both reset branches,
preserves identity/phrases and verifies a later setting still saves. Theme/layout/exclusion/link cases
retain their component/data ownership, not blanket GUI certification.

### Languages and visuals — LANG-01…07

| ID | What to test / expected result |
| --- | --- |
| LANG-01 | Extract/compile English and every po/LINGUAS catalog with complete messages and safe formatting placeholders. |
| LANG-02 | Use the selected language in menus, settings, notifications/errors, dependency hints and confirmation buttons. |
| LANG-03 | Display EN/ZH/JA/KO plus RTL/long strings without functional overflow, including CJK fonts and emoji. |
| LANG-04 | Manually verify placeholder/text/caret/title baselines and configurable vertical offset. |
| LANG-05 | Manually verify dark/light/high-contrast themes and accent/selected/unselected/hover/disabled icon feedback. |
| LANG-06 | Manually verify left alignment, ellipsis, image proportions, device icons, separators, padding, thin scrollbars and narrow windows. |
| LANG-07 | Bound notification counts, suppress errors on intentional screenshot cancel and never expose content/credentials. |

Maintained simulation entries: [shell.smoke.js](simulation/shell.smoke.js).

Native entry: [settings/language.native.js](simulation/settings/language.native.js), LANG-02 with
`--language en_US`, `zh_CN`, `ja`, `ko`. Check installed catalogs in the actual menu, word panel,
independent preferences and missing-editor notification. A generated non-C message locale is required:
C.UTF-8 ignores gettext LANGUAGE selection. Catalog completeness remains logic/i18n/coverage.sh;
linguistic quality, RTL/long-string layout and visual polish remain manual.

### Responsiveness and tooling — OPS-01…08

| ID | What to test / expected result |
| --- | --- |
| OPS-01 | Measure main-loop stalls during capture, thumbnails, dictionary/word processing, sync initialization/restoration/transfer and editor launch. |
| OPS-02 | Distinguish network wait from uninterrupted main-thread blocking with complete-operation phase/timeline measurements. |
| OPS-03 | Soak repeated lifecycle/toggles/refresh/polling; memory, FDs, timers, sessions and temporary files must not grow continuously. |
| OPS-04 | Measure memory budgets for default GLib and optional sha256sum separately; do not apply optional-path results to the default. |
| OPS-05 | Run optional ten-times-daily stress separately from real Shell/server acceptance; keep it out of routine CI. |
| OPS-06 | Package only runtime resources with consistent metadata/schemas/catalogs; exclude tests, dictionaries, server and credentials. |
| OPS-07 | Verify dev-shell build/package, XDG isolation, language selection, exit and journal/terminal logs. |
| OPS-08 | Make logs locate operation stages without duplication, swallowed errors or secrets; validate release/install configuration without source-format snapshot tests. |

Evidence / remaining boundary: Use existing logic/sync measurements/stress, logic/common checks and tools/check_release.py. Stress remains opt-in/outside ordinary CI. Packaging reuses ENV-01 evidence. Async APIs or one successful run do not prove the Shell never blocks.

## Native acceptance additions

`tools/test-simulation.py` maintains these additional native chains; select IDs with `--case`.
These are coverage boundaries, not certification of every requirement within an ID.

| Module | IDs | Actual evidence and boundary |
| --- | --- | --- |
| `clipboard/applications.native.js` | CLIP-02-firefox/chromium | Real local HTML sources, private browser profiles, native copy and independent MIME readback |
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

### Extended native owners

The registry now contains 134 cases (42 additions in the first batch, 9 in the next, one source removed by scope agreement), not 134 passing requirements. The following
entries extend the owners above rather than duplicate their happy paths. Failures belong in the
[result snapshot](acceptance-status.md), not weaker expected results in this inventory.

| Owner | Added/strengthened IDs | Distinct behavior |
| --- | --- | --- |
| `clipboard/native.js`, `clipboard/policy.native.js` | CLIP-04-recovery, CLIP-09-missing, PRIV-05-exclusion | Failed decode then normal capture; missing original after restart; exclusion while a real owner is paused |
| `phrases/native.js` | PHRASE-07-delete/corrupt | Real deletion IO failure/retry and invalid persisted data recovery |
| `word-selection/native.js` | SELECT-04-cross-row, SELECT-05, SELECT-07-disable | Held Shift across rows, Space/Enter and actual disable while dragging |
| `terminal/native.js` | TYPE-03/user-sample, TYPE-08-capslock/layout | Full maintained sample at both speeds, optional user file, real CapsLock and US/German input sources |
| `terminal/browser.native.js`, `terminal/vte.native.js` | TYPE-09-firefox/chromium, TYPE-02-vte | Independent browser textarea → loopback readback; real GTK3/VTE PTY with keyboard/clipboard positive controls; not physical IME |
| `lifecycle/native.js`, `lifecycle/responsiveness.native.js` | ENV-05-screenshot, OPS-01-capture | Complete/cancel the actual system screenshot UI after disable, verify released modal and native external input, no old plugin side effects, then normal re-enable; large capture/thumbnail/save main-loop gaps |
| `settings/coverage.native.js`, `settings/native.js` | SET-02/04/05/06/07/08/09 | Representative native configuration paths, layout/keyboard behavior, exclusions, invalid/clear/cancel recording, data-preserving reset and URI-handler handoff |
| `word-selection/dictionary.native.js`, `lifecycle/cold.smoke.js` | DICT-02/06/06-https/07/08/09 | Language lists, multiple sources, refresh failure/declaration change, actual editor, 120,002-word indexing, two-Shell no-implicit-download proof; TLS case is rejection, not trusted-CA success |
| `sync/scenarios.native.js` | SEND-03-image, SEND-05-destinations, RECV-02-pages/03-boundaries | Actual image/send and text-image/receive boundaries, 205-item production pagination, durable cursor and per-address/Channel queues across restart |
| `sync/scenarios.native.js`, `sync/network.native.js` | CONN-08-empty/revoked, CONN-09-device/offline, XFER-05-disable-download/06-cancel-download/09-glib/09-sha256sum, RECV-08-manual | Real missing/revoked access, refused connection, session/task cancel, both checksum paths and independently executed newer-choice branches |
| `screenshot/native.js`, `screenshot/editor.native.js`, `screenshot/remote.native.js` | SHOT-03-editor/07, EDIT-05-remote/07-lifetime | Actual screenshot/edit combinations, cancel/retry, remote original to a real custom editor, offline cache and editor surviving extension disable |
| `color-picker/native.js`, `color-picker/displays.native.js` | COLOR-05-edges/displays | Corners/clamping, actual dual virtual displays and 125% scaling; coordinates, clipboard and physical screenshot-pixel step |

Select conditional displays with `--display dual` or `--display fractional`; use
`tools/test-lifecycle.py --dictionary-cold` for a separate cold dictionary run. Application/locale
dependencies are explicit. Prepared environments are still needed for real IME, trusted HTTPS,
Flatpak Gradia and two-full-desktop races; those are not declared inherently untestable.
Do not duplicate logic-owned format, storage, policy or error-response data matrices into Shell.

Further extensions reuse existing owners: `sync/network.native.js` owns automatic/manual concurrent
materialization and remote clipboard feedback (`RECV-05-automatic-manual`, `CLIP-08-remote-loop`);
`sync/connection.native.js` owns held Refresh, disabled native clicks and natural process shutdown
(`CONN-03-refresh`). `sync/local-boundary.native.js` checks local phrases across two configured
addresses/Channels of one test backend (`PHRASE-08-destinations`). `clipboard/policy.native.js` gates
real thumbnail staging before commit (`PRIV-05-thumbnail`) and strengthens existing HIST-04 with emoji
and filtered-result limits. `word-selection/native.js` observes complete top-level handlers after close,
disable and a newer row request (`WORD-08-close/disable/newer`). `screenshot/native.js` verifies real
unsupported capabilities and supported retry (`SHOT-05-unsupported`), not fabricated portal replies.
These are distinct failure boundaries, not copies of basic capture, repeated manual clicks or direct
handler invocation. Decoder-internal cancellation, physical input and every deployment remain separate.

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
