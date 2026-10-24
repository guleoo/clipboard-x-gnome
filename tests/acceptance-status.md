# Desktop acceptance snapshot

> English · [简体中文](acceptance-status_CN.md)

Date: 2026-10-25. This records observed results, not a declaration that every requirement in the
[functional inventory](functional-inventory.md) passes.

## Environment and evidence

- Artifact: `clipboard-x-gnome_1.1.0.zip`, SHA-256
  `9d7c1453af80df946c3ad2eb038323e6347588e76f1c41656cd77492c4820d17`.
- Isolated GNOME Shell 50.6 and 51.1, software rendering; independent GTK clipboard sources and
  input receivers. These runs neither replace the host extension nor log the host out.
- Sync uses disposable Docker instances of the adjacent `clipboard-x-server` source, synthetic
  credentials, actual HTTP transport and an independent source peer. It is not two real desktops.
- Logic verification: `dbus-run-session -- meson test -C build --no-suite stress --print-errorlogs`,
  **51/51 passed**. Optional stress was not run.
- Native clipboard/policy, phrases, typing and color-picker cases: **32/32 passed together on
  each Shell version**. Additional focused runs passed settings, screenshot/cancel, bounded editor
  stdin, cold Shell restoration and the successful sync scenarios below.
- Native registry: 84 selectable cases, in addition to the existing panel/compatibility and cold
  lifecycle entries. This count is not 84 passing cases or 173 fully covered functional IDs.
- Actual Firefox/Chromium rich-text and original-image copy passed on 51. LibreOffice is BLOCKED:
  the available executable is a headless build, not a graphical document source.
- Actual catalog checks passed English, Chinese, Japanese and Korean on 51; English and Chinese
  on 50. This is not linguistic review of all translations.
- On 51, local/network dictionary import, multiple sources, refresh preservation, default-editor
  edits and file-manager entry passed. Network dictionary checks also passed on 50; its image lacks
  the GUI applications needed for local import/editor cases.
- Native Gradia displayed the actual fixture image on 51. Flatpak Gradia is absent and BLOCKED;
  the 50 image also lacks native Gradia.

Successful real-server checks include native Test/Apply and retry, manual/automatic publication,
representation switches, threshold boundaries, lazy source → server → receiver retrieval, exact
upload/download byte progress, repeated download requests, lost-completion-response recovery,
remote deletion and restart persistence. Local-only phrases/privacy checks passed on both 50/51.
Separate focused runs must not be presented as one wholly green suite.

## Reproduced failures — not waived

| Case | Observed result | Limit of the conclusion |
| --- | --- | --- |
| WORD-07 | About 5 seconds for a 100,000-character URL and 20 seconds for 200,000 unbroken characters, exceeding the 1-second main-loop budget | Reproduced on 50/51; ordinary 2,000-word input did not show the same stall |
| SEND-04 | Disabling sync while the first publication is held terminates the isolated Shell abnormally | SIGSEGV confirmed on 51; abnormal exit on 50. Later queue recovery assertions cannot run |
| SEND-08 | Deleting an item while its publication is held also terminates the isolated Shell abnormally | Same version boundary; later remote-completion assertions cannot run |
| RECV-08 | A late remote activation download replaces a newer external clipboard copy | Reproduced on 50/51; the later manual-choice branch is not reached after this assertion fails |

These are retained failing regression scenarios, not diagnosed production fixes. The HTTP gate
controls timing around the real server; it does not return fabricated protocol results.

Reproduce independently, continuing after a crashed case:

```sh
python3 tools/test-simulation.py build/clipboard-x-gnome_1.1.0.zip --case WORD-07 --isolate-cases
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.1.0.zip --case SEND-04,SEND-08,RECV-08 --isolate-cases
```

## Still conditional or manual

Missing an application, a generated non-C locale or a required GVfs backend is BLOCKED, never PASS.
Physical-keyboard interruption, real input methods, XWayland/application interoperability beyond
the installed sources, two-desktop activation races, every portal/display backend and visual quality
still require their own evidence. Logic-owned data matrices are not duplicated into Shell cases.

Reports live in ignored `build/simulation-tests/` and `build/lifecycle-tests/`: logs, per-case outcomes,
artifact hashes, test-source fingerprint and failure screenshots when the compositor remains alive.
Do not publish unreviewed desktop logs. The [test guide](README.md) describes selection and isolation;
ordinary GitHub CI has not been expanded.
