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

Plugin and development-script diagnostics use English regardless of the interface language;
GNOME and other tools keep their own output language. Every extension-generated diagnostic message
starts with `Clipboard X ` and uses plain text:

```text
Clipboard X [INFO] sync initialize completed · 187 ms
Clipboard X [ERROR] sync initialize failed at channels · HttpError:channel_forbidden · 120 ms · /sync/client.js:123:5
```

- `[INFO]`, `[WARN]` and `[ERROR]` identify severity. GJS may map console warnings and errors to the
  same journal priority, so use these labels rather than relying solely on `journalctl -p`.
- The module, operation and failed stage locate the problem. For example, `sync initialize failed at
  channels` means that synchronization failed while loading channels during initialization.
- Elapsed time is measured with a monotonic clock. Known error codes and a few trusted code locations
  provide context without exposing raw messages. A bounded cause summary appears when available.

There are no JSON records or operation UUIDs, and timestamps are left to the journal. Successful
operations produce one summary instead of a message for each intermediate stage. Stages are tracked
internally for failures; an operation that hangs without failing does not emit live stage updates.

Normal background polls and byte-progress updates are silent. Poll failures identify the changes,
work, or transfer-refresh stage; cancellation is informational rather than an error. User notifications
remain translated and intentionally brief; journal diagnostics provide the technical context.

## Development sessions

The default terminal view shows build summaries, plugin messages and system warnings/errors. Long
installation lists and successful service activation messages are hidden; repeated system messages
and disposal stack traces are folded. To see the complete output in the terminal:

```sh
./tools/run-dev-shell.sh --verbose
```

`tools/run-dev-shell.sh` uses `systemd-cat`, when available, to route the **unfiltered** build output and
isolated Devkit session's stdout/stderr into the system journal under `clipboard-x-devkit`. Terminal
filtering only affects presentation, not what is saved. No extra terminal or journal follower is needed.
The script combines stdout and stderr, then uses `tee` to forward the stream once before filtering it.
With stderr connected to a regular pipe, the
[GLib default log writer](https://docs.gtk.org/glib/func.log_writer_default.html) emits standard-stream
output instead of writing directly to journald. This avoids forwarding the same GJS message twice.
Both streams use journal priority `info`; `[WARN]` and `[ERROR]` still identify plugin warnings/errors.
To view the saved stream separately:

```sh
journalctl --user -b -f -o cat -t clipboard-x-devkit + _EXE="$(command -v gnome-shell)"
```

The `+` combines the Devkit output with native Shell journal messages. Host sessions and processes
launched separately can write GJS messages directly to the journal without the Devkit tag:
**do not use the tag alone to find all plugin errors**.
Use the `Clipboard X ` filter above for the extension's own diagnostics. The full Shell query also
includes the host Shell; use `journalctl -o short` for timestamps or `-o verbose` for PID metadata to
distinguish processes.

The wrapper preserves build/session exit codes and Ctrl+C, reaps its forwarding process on exit, and
does not create log files. Terminal output belongs to this invocation; the script does not subscribe
to other Shell processes' logs. A journal-forwarding failure produces a warning but leaves terminal
output and the development session available. If terminal filtering fails, the script warns and
continues with raw output. Without `systemd-cat` or `tee`, the terminal view still works and a warning
explains that those streams are not automatically retained. Native GJS
logging follows the platform's output routing; it does not independently guarantee journal storage.

## Sharing a report

Reproduce once, then collect a narrow time window:

```sh
journalctl --user -b --since '10 minutes ago' -o cat --grep='Clipboard X '
```

Include the extension version, GNOME version, host versus Devkit session, whether synchronization was
enabled, and the steps performed. A startup notification alone does not establish that synchronization
caused it; the failed operation and stage provide the evidence.

The plugin's diagnostic **message payload** omits clipboard text, images, API keys, server addresses,
device/channel/item IDs, custom file paths, and raw server responses. Unknown string error codes become
`unknown`; stack locations are restricted to extension files and GNOME resources. Journal metadata
such as PID, executable paths and source locations is supplied by the platform and is outside this
filter. Build tools, GNOME and other applications may emit unfiltered messages: review any full-session
output before sharing it publicly.
