# Desktop acceptance snapshot

> English · [简体中文](acceptance-status_CN.md)

Date: 2026-10-25. These are observed results, not certification of all requirements in the
[functional inventory](functional-inventory.md).

## Scope

- Artifact: `clipboard-x-gnome_1.1.0.zip`, SHA-256
  `9d7c1453af80df946c3ad2eb038323e6347588e76f1c41656cd77492c4820d17`.
- Real isolated GNOME 50.6 / 51.1 with software rendering, independent GTK sources/receivers and
  native virtual input. No host installation/logout, production changes or CI expansion.
- Native registry: **134 cases** after the agreed removal of one application source; previous batches
  added **42 + 9 cases**, plus strengthened existing checks.
  Cold dictionary restoration is a separate opt-in lifecycle check. Counts are not passing totals,
  nor can they be subtracted from the inventory's 173 requirements to calculate coverage.
- The first 42-case batch initially reported **50: 34 PASS / 8 FAIL; 51: 33 PASS / 9 FAIL**.
  After the agreed ENV-05 screenshot boundary was reverified below, that set has **50: 35 PASS / 7 FAIL;
  51: 34 PASS / 8 FAIL**. Neither count certifies all 134 cases or 173 requirements.
- The next **9 cases passed on both 50 and 51**, including stricter reruns described below.
- Sync uses disposable Docker servers, synthetic credentials, actual HTTP and a separate source
  client—not two full desktops. The private fixture allows 20,000 requests/60 seconds for the real
  205-item pagination test; production limits are unchanged.
- The previous 32-case core run passed on both versions. Expanded long-text typing now fails on 50;
  older short samples do not establish that the current suite is all green.
- Logic verification: `dbus-run-session -- meson test -C build --no-suite stress --print-errorlogs`,
  **51/51 passed**; optional stress was not run.

## Added evidence

These are focused runs, not one uninterrupted passing suite:

| Area | New evidence |
| --- | --- |
| Capture/privacy/phrases/selection | Malformed-image recovery, missing originals after restart, pending capture exclusion, deletion IO failure and corrupt phrase storage, Space/Enter, held Shift across rows and disable during held dragging; passed on 50/51 |
| Settings | Native representative switch/enum/number/threshold/command writes, entry limits, hide/reorder with keyboard actions retained, discovered/manual exclusions, reset preservation and real system URI-handler handoff; passed on 50/51, not every setting's Cartesian matrix |
| Screenshot/editor | Actual portal + custom editor combinations, cancel/retry, editor surviving extension disable, remote lazy original → exact editor bytes → cached offline editing; passed on 50/51 |
| Sync | Image send / text-image receive thresholds, 205-item pagination and persisted cursor, two address/Channel queues across actual restart, no-Channel recovery, device/key rejection recovery and connection-refused recovery; passed on 50/51 |
| Dictionaries | Language-filtered multiple sources, refresh failure preservation, changed declaration, preferences/extension restart without implicit GET, actual editor/file manager and self-signed HTTPS refusal; not trusted-HTTPS success |
| Cold dictionaries | A local HTTP dictionary imported once is reused by two separate Shells; custom-word output and no additional HTTP request are checked |
| Capture responsiveness | Actual 760,000-byte text and 2,881,318-byte PNG capture/thumbnail/persist; passed on both. On 51 maximum timer gaps were 26ms/21ms |
| Large dictionary | 120,002-word UI import/index/cache passed on both: 50 import 8,563ms, cold/warm 560ms/434ms, max gap 53ms; 51 import 7,001ms, cold/warm 566ms/423ms, max gap 39ms. Import timings include native path entry |
| Applications | Firefox/Chromium rich text and original images passed on 50/51. CLIP-02 is scoped to those two browsers; office applications are not a coverage requirement |
| Input targets | Full 460-character systemd sample, optional user sample, CapsLock, US/German layout, Firefox/Chromium textareas and a GTK3/VTE PTY; mixed results below |
| Displays | Actual virtual dual monitors / 125% Mutter scaling, color sampling and one-physical-pixel arrow step; not physical-monitor certification |

Native Gradia displayed the fixture on 51; native Gradia on 50 and Flatpak Gradia on both are absent.
Custom editor success does not close those application-specific gaps. Catalog samples cover EN/ZH
on 50 and EN/ZH/JA/KO on 51, not linguistic review of every translation.

### Follow-up concurrency and cancellation checks

| New case | Verified behavior | 50 / 51 |
| --- | --- | --- |
| CLIP-08-remote-loop | Actual remote manual/automatic clipboard writeback with automatic sending enabled: no duplicate identity/outbox or feedback POST; local publication is the positive control | PASS / PASS |
| RECV-05-automatic-manual | A real automatic original download held in flight is joined by native manual activation; exactly one GET, full verified file and actual clipboard readback | PASS / PASS |
| CONN-03-refresh | Refresh/Test/Apply share busy; native disabled clicks do not queue extra requests; closing an in-flight Refresh lets the preferences process exit naturally without forced termination or late writes | PASS / PASS |
| PHRASE-08-destinations | Phrase survives configured address/Channel switch and restart and is absent from both server histories; actual traffic proves the new address is used | PASS / PASS |
| PRIV-05-thumbnail | Real thumbnail generated/staged, then privacy/exclusion toggled before commit; old result and staging file discarded, later capture recovers | PASS / PASS |
| WORD-08-close | Native close while a real computed result is delayed; after the full handler settles, no popup resurrection or result replacement | PASS / PASS |
| WORD-08-disable | Actual disable/re-enable while the result is delayed; no population of destroyed old actors or request revival in the new instance | PASS / PASS |
| WORD-08-newer | In the same open history, B completes before held A; late A cannot replace B's state or actors | PASS / PASS |
| SHOT-05-unsupported | Read actual backend capabilities, identify the real unsupported-target error without clipboard/history side effects, then successfully capture a supported target | PASS / PASS |

Existing WORD-08 was rerun with full top-level request observation; HIST-04 adds actual emoji search
and filtered-result limits, both passing on 50/51. The thumbnail check gates completed computation
before commit, not decoder-internal abort. The phrase check uses two addresses/Channels of one
owned backend, not two deployments. The screenshot check does not exhaust actual portal failures.
Dictionary-change races and complete backend/error matrices therefore remain explicit gaps, not
automatically covered by these passing cases.

### Revised ENV-05 screenshot boundary

The system-owned screenshot UI need not disappear immediately when the extension is disabled.
Acceptance is normal screenshot completion/cancellation afterward: modal released, Shell interactive,
and no history import, clipboard write, editor launch or error notification from the disabled plugin.

Both 50 and 51 passed both native branches: Escape produced zero captures, Enter produced one actual
system capture, and the final modal count was zero. An independent GTK window received native input,
the persisted plugin history was unchanged, and the extension reopened normally after re-enable.
The former immediate-dismissal failure is superseded by this explicitly agreed scope, not a production
fix. Other sync interruption failures below remain unchanged. Use `--case ENV-05-screenshot` to rerun.

## Retained failures and unresolved target checks

| Case | Observed result / limit |
| --- | --- |
| WORD-07 | 50/51: about 5 seconds for a 100,000-character URL and 20 seconds for 200,000 unbroken characters, above the 1-second main-loop budget |
| SEND-04 / SEND-08 | Earlier actual publication interruption/deletion runs terminate the isolated Shell; SIGSEGV confirmed on 51. Later recovery is not claimed |
| CONN-08-revoked | Revoking live Channel membership terminates the isolated Shell; 51 SIGSEGV independently confirmed |
| XFER-05-disable-download / XFER-06-cancel-download | Disabling during a held download or canceling its task terminates the isolated Shell on 50/51 |
| RECV-08 / RECV-08-manual | 50/51: late activation replaces a newer external copy and a manually chosen local item; both branches now execute independently |
| XFER-09-sha256sum | 50/51: optional native verifier rejects real chunked responses without Content-Length; the default GLib path passes |
| TYPE-03 / TYPE-03-user-sample | Expanded long samples fail exact readback on 50; pass on 51. Short mixed samples cannot cancel this result |
| TYPE-08-capslock | 50/51: exact output differs with CapsLock enabled; US/German checks pass but do not establish IME bypass |
| TYPE-09-chromium | 51: ASCII passes, CJK/emoji output differs. The same selected case passes on 50; not a universal Chromium diagnosis |
| TYPE-02-vte | Native ASCII and real clipboard-paste positive controls succeed. Plugin natural paste passes on 50 but delivers zero extra PTY bytes on 51 (captured purpose 0). This is a GTK3/VTE target/version failure, not proof every terminal fails |

The HTTP gate streams real requests and changes only timing. Crashes are FAIL, later unentered
cases NOT_RUN; no silent retry, relaxed assertions or production fixes make these green.

```sh
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case WORD-07,TYPE-08-capslock --isolate-cases
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip --case CONN-08-revoked,XFER-05-disable-download,XFER-06-cancel-download,RECV-08-manual,XFER-09-sha256sum --isolate-cases
```

## Remaining boundaries

Physical input, real IME composition, every toolkit/XWayland/portal backend, trusted HTTPS,
Flatpak Gradia, two-full-desktop activation races, long soaks and visuals still require prepared
environments or manual evidence—not a declaration that automation is impossible. Logic-owned
data/security matrices are not duplicated into Shell tests.

See the [test guide](README.md) for dependencies and display/cold-run commands. Ignored
`build/simulation-tests/` and `build/lifecycle-tests/` preserve logs, per-case results, artifact hashes,
source fingerprints and screenshots when the compositor survives. Review logs before sharing.
