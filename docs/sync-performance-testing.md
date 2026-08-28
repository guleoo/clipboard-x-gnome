# Synchronization performance and stress testing

> English · [简体中文](zh-CN/sync-performance-testing.md)

This guide is for extension and compatible-server developers. It defines how to verify synchronization
throughput, progress reporting, memory use, event-loop responsiveness, and recovery behavior.

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

The suite has two layers:

- `sync-stress` uses a deterministic in-memory transport double. It covers connection state, paginated
  cursors, incoming events, the publication queue, on-demand uploads, exact terminal progress, and the
  transfer-state bound. It also asserts that uploads remain serialized so a burst cannot overload the
  Shell main thread or the network connection.
- `sync-stream-stress` reads and writes an 80 MiB object through real `Gio.InputStream` chunks. It
  covers both upload adaptation and download verification, asserting SHA-256, final size, chunked
  progress, event-loop delay, and RSS growth.

Run only the stress suite with:

```sh
meson test -C build --suite stress --print-errorlogs
```

The regular `meson test -C build` command also runs these tests because Meson includes every registered
test by default. Temporary files are created in the system temporary directory and removed afterwards.
