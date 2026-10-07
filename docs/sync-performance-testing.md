# Synchronization performance and stress testing

> English · [简体中文](sync-performance-testing_CN.md)

This guide describes the extension's synchronization regression tests and controlled loopback
measurements. It distinguishes verified behavior from server interoperability and GNOME Shell
performance that still require separate acceptance testing.

The stress suite uses a fixed daily-load assumption and multiplies every dimension by exactly 10. These
numbers are an auditable test contract, not user telemetry; update them through review if real telemetry
becomes available.

| Dimension | Daily baseline | Stress load |
| --- | ---: | ---: |
| Published items | 200 | 2,000 |
| Incoming change events | 200 | 2,000 |
| On-demand source tasks | 20 | 200 |
| Progress updates | 10,000 | 100,000 |
| Large snapshot | 8 MiB | 80 MiB |

## Test layers

- `sync-receive` exercises production `SyncClient` with a transport double and real temporary files.
  It covers local text/image thresholds, different sender policies, partial multi-format entries,
  waiting for a source, shared automatic/manual requests, verification failure and retry, and
  completion after history reload. Its 2,000-item receiving burst checks serialized downloads and
  released operation state. It is not a real-server or GNOME Shell UI performance measurement.
- `sync-stress` uses an in-memory transport double and distinct, persisted text items. It checks
  2,000 incoming event identities, paginated cursors, 2,000 publications and 200 source tasks competing
  for the same serialized queue. The double reads source bytes but does not perform HTTP requests or
  import incoming items into clipboard history. Transfer states, timestamps and pending timers are
  bounded; confirmed completed transfers must release cancellation metadata.
- Its 100,000-update progress flood yields to the main loop between batches. Assertions require
  intermediate notifications, monotonic bytes, delivery of the exact completed state, and removal of
  pending callbacks. An implementation that sends no notifications cannot pass.
- `sync-stream-stress` starts a temporary Python standard-library HTTP fixture on `127.0.0.1` with
  an ephemeral port. Production `HttpTransport` and `HttpClient` upload and download a non-sparse
  80 MiB pattern through libsoup. The peer checks authentication headers, byte count and SHA-256.
  Downloads preserve the previous target during transfer; an independent `sha256sum` check verifies
  the persisted output. The fixture pauses 1 ms per 64 KiB chunk, allowing multiple measurements.
  This stress run explicitly enables the optional `sha256sum` mode; it does not change the user's
  default configuration. Downloads use native GIO streaming, followed by `sha256sum` reading the
  temporary file via stdin, and only then replace the target.
- `sync-http-failures` exercises actual HTTP disconnects, checksum rejection, download and upload
  cancellation, HTTP 503 after sending a request body, partial-file cleanup, and explicit retries.
  It is a regular regression test, not a 10× stress workload or automatic-reconnection test.
  Both the default GLib path and the optional native path are tested. Native-path cases also reject
  missing/chunked lengths, compression and oversized declarations; an excess-body case verifies
  HTTP/1 Content-Length bounds. Zero-byte content and cancellation before hashing are covered.
- `sync-file-verifier` checks binary data, unusual filenames, dependency lookup, command failures,
  malformed/oversized output and cancellation that terminates and reaps the child.
  `file-verification-settings` checks that enabling waits for a successful dependency check and
  that failure, external reset or closing settings cannot persist an unchecked enablement.
- `sync-measurement` verifies the probes themselves: a deliberately blocking 500 ms completion
  must be detected, and missing, final-only, regressing or wrong-total progress must be rejected.

## Measurements and gates

The stream test prints one JSON record per direction: duration, MiB/s, main-loop tick count,
maximum extra delay, sampled peak RSS growth, and RSS sample count.

Diagnostics also record the GJS/GLib/kernel versions, temporary filesystem, and Meson's
`MALLOC_PERTURB_` value. Downloads include a monotonic stage timeline: request/response, file
preparation, native splice, stream closing, verifier startup/read/wait/closing, target replacement,
and cleanup. Timer gaps of at least 50 ms include both time boundaries and the stage observed when
the callback finally ran. A blocking call can finish and change stages before the overdue timer
runs; compare the gap with the entire timeline, not just `observedStage`.

Linux scheduler counters and cgroup-v2 CPU statistics are supplemental diagnostics. Missing counters
are reported as `null`; zero scheduler wait does not prove there was no scheduling pause. Cgroup
counters cover the whole container and are not GJS-only measurements. A long wall-clock gap can mean
blocking code, native work, or CPU scheduling starvation; it does not establish the cause on its own.
The 250 ms gate is unchanged, and a failing benchmark is not retried or silently skipped by CI.
Failed jobs retain Meson logs as `test-logs-gnome-50` or `test-logs-gnome-51` artifacts.

- A separate fixture thread samples the GJS process's `/proc/<pid>/status` every 5 ms, including
  periods when GJS is blocked. Both upload and download have a **64 MiB peak RSS growth budget**.
  This is a sampled, per-operation budget, not proof of constant memory usage or absence of leaks.
- A 10 ms GLib timer measures extra main-loop delay. The test waits for a post-operation tick
  before removing it, so blocking at completion is not silently ignored. The limit is **250 ms**;
  at least two ticks and RSS samples are required. This is not a frame-rate guarantee.
- Each measured direction must finish within **30 seconds**. MiB/s is reported for comparison,
  not asserted as a universal network-speed requirement. Avoid running other heavy benchmarks
  concurrently; Meson runs the stream benchmark without parallel tests.

The 64 MiB download budget applies to the optional `sha256sum` path, not the default GLib path.
Controlled 80 MiB experiments on this machine found about 114 MiB additional RSS even when native
download was followed by GLib file hashing. The default remains GLib, as an explicit dependency-free
choice; this is a known memory limitation, not a passing result for that mode. The stress gate remains
unchanged for the low-memory option. Streaming API use alone does not ensure prompt GJS reclamation.

The RSS sampler currently measures GJS only, not the verifier child. The child is one short-lived
process reading the file in bounded native chunks; separate prototype sampling found approximately
4.3 MiB executable RSS, but this is not an automated per-run budget or a guarantee on other systems.
Native downloads request HTTP/1 and identity encoding and reject responses without a bounded,
uncompressed Content-Length framing. The optional path does not silently fall back to GLib.

## Running the tests

Run the stress suite (which also includes clipboard-history stress):

```sh
meson test -C build --suite stress --print-errorlogs
```

Run only the two synchronization stress tests:

```sh
meson test -C build sync-stress sync-stream-stress --print-errorlogs
```

Run the probe and HTTP-failure regressions:

```sh
meson test -C build sync-measurement sync-http-failures --print-errorlogs
```

The regular `meson test -C build` also runs these tests. The HTTP fixture requires permission to
create loopback sockets, Python 3, Linux `/proc`, and `sha256sum`. Network-restricted sandboxes must
explicitly allow loopback access; inability to start the fixture is a test failure, not a skipped pass.
Temporary files and the HTTP process are cleaned up when the test exits normally or throws.

## What passing does not prove

The 10× baseline is a count/size contract, not a measured user arrival rate. Passing does not prove
2,000 end-to-end clipboard imports, production-server compatibility, automatic reconnection,
bounded memory across arbitrary unfinished remote tasks, or a smooth GNOME Shell UI. Confirmed
server terminal states release remote cancellation markers; unfinished or unconfirmed failed tasks
retain them so cancellation remains possible, independently of UI history eviction.

Before release, separately test a real `clipboard-x-server`, mixed device activity, offline peers,
slow networks/disks, configuration changes and extension shutdown in a nested or host GNOME session.
