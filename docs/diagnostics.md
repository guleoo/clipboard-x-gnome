# Logs and troubleshooting

> English · [简体中文](diagnostics_CN.md)

Clipboard X uses the standard GJS console and system journal, following the
[GNOME extension debugging guide](https://gjs.guide/extensions/development/debugging.html).
There is no extension-owned log file or background logging service. Retention and persistence across
reboots are controlled by the system's journald configuration, not by Clipboard X.

## Find extension logs

```sh
# Recent messages in this boot, from both the host and nested sessions
journalctl --user -b -o cat --grep='Clipboard X ' -n 100

# Follow messages while reproducing a problem
journalctl --user -b -f -o cat --grep='Clipboard X '
```

If the desktop session's messages are not in the user journal, run the same command without `--user`.
Journal access depends on your distribution's permissions. No `sudo` is needed by the extension.

Every extension-generated diagnostic message starts with `Clipboard X `, followed by a JSON record:

```json
{"time":"2026-10-05T00:00:00.000Z","level":"error","session":"…","module":"sync","operation":"initialize","id":"…","phase":"channels","durationMs":120,"outcome":"failed","error":{"type":"HttpError","code":"channel_forbidden","frames":["/sync/client.js:…"]},"causes":[]}
```

- `session` distinguishes JS processes; it is not a device ID or a synchronization credential.
- `id` connects the stages of an operation, including concurrent operations.
- `module`, `operation`, and `phase` locate the failure. Initialization records configuration, transport,
  status, device, profile, channels, optional channel selection, transfers, changes, work, and transfer refresh.
- `durationMs` measures elapsed operation time with a monotonic clock.
- `error` and bounded `causes` retain known error codes and trusted code locations, not raw messages.
- `level` is the extension's logical severity. GJS may map console warnings and errors to the same
  journal priority, so use this field rather than relying solely on `journalctl -p`.

Normal background polls and byte-progress updates are silent. Poll failures identify the changes,
work, or transfer-refresh stage; cancellation is informational rather than an error. User notifications
remain translated and intentionally brief; journal diagnostics provide the technical context.

## Development sessions

`tools/run-dev-shell.sh` uses `systemd-cat`, when available, to route build output and the isolated
Devkit session's stdout/stderr into the system journal under `clipboard-x-devkit`. The same output is
also displayed live in the launching terminal; no extra terminal or journal follower is needed.
The script combines stdout and stderr, then uses `tee` to display and forward the stream once.
With stderr connected to a regular pipe, the
[GLib default log writer](https://docs.gtk.org/glib/func.log_writer_default.html) emits standard-stream
output instead of writing directly to journald. This avoids forwarding the same GJS message twice.
Both streams use journal priority `info`; the JSON `level` still identifies plugin warnings/errors.
To view the saved stream separately:

```sh
journalctl --user -b -f -o cat -t clipboard-x-devkit + _EXE="$(command -v gnome-shell)"
```

The `+` combines the Devkit output with native Shell journal messages. Host sessions and processes
launched separately can write GJS messages directly to the journal without the Devkit tag:
**do not use the tag alone to find all plugin errors**.
Use the `Clipboard X ` filter above for the extension's own diagnostics. The full Shell query also
includes the host Shell; PID and the `session` field help distinguish processes.

The wrapper preserves build/session exit codes and Ctrl+C, reaps its forwarding process on exit, and
does not create log files. Terminal output belongs to this invocation; the script does not subscribe
to other Shell processes' logs. A journal-forwarding failure produces a warning but leaves terminal
output and the development session available. Without `systemd-cat` or `tee`, stdout/stderr remain in
the terminal and a warning explains that those streams are not automatically retained. Native GJS
logging follows the platform's output routing; it does not independently guarantee journal storage.

## Sharing a report

Reproduce once, then collect a narrow time window:

```sh
journalctl --user -b --since '10 minutes ago' -o cat --grep='Clipboard X '
```

Include the extension version, GNOME version, host versus Devkit session, whether synchronization was
enabled, and the steps performed. A startup notification alone does not establish that synchronization
caused it; the failing `operation` and `phase` provide the evidence.

The plugin's diagnostic **message payload** omits clipboard text, images, API keys, server addresses,
device/channel/item IDs, custom file paths, and raw server responses. Unknown string error codes become
`unknown`; stack locations are restricted to extension files and GNOME resources. Journal metadata
such as PID, executable paths and source locations is supplied by the platform and is outside this
filter. Build tools, GNOME and other applications may emit unfiltered messages: review any full-session
output before sharing it publicly.
