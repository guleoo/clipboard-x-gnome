<div align="center">

# clipboard-x-gnome

**Clipboard X — a GNOME clipboard extension built around your workflow.**

History · Token selection · Quick phrases · Device sync · Screenshot editing · Quick color picking

[English](README.md) · [简体中文](README.zh-CN.md)

[![GNOME Shell 50](https://img.shields.io/badge/GNOME%20Shell-50-4A86CF?logo=gnome&logoColor=white)](https://www.gnome.org/)
[![GJS](https://img.shields.io/badge/GJS-ES%20Modules-F7DF1E?logo=javascript&logoColor=111)](https://gjs.guide/)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-663399)](LICENSE.md)

</div>

Clipboard X is a GNOME Shell extension that brings text and image history, token selection, and quick
phrases together in a top-bar panel. It also provides screenshot capture, color picking, and a way to
open images in a configured editor. To share clipboard snapshots across devices, connect a
`clipboard-x-server` that you configure yourself.

By default, history and quick phrases stay on this device. Clipboard synchronization requires a
configured server and must be enabled explicitly; network dictionaries are downloaded only when added
or refreshed by the user.

> [!IMPORTANT]
> Clipboard X currently declares support for **GNOME Shell 50**. Other Shell versions are not listed
> in the packaged extension metadata.

## Features

- **Clipboard history** — Search local snapshots of text and images, with source-device icons for remote entries in multi-device history.
- **Token selection** — Select words or ranges to copy, paste, or type; preserve links, email addresses, numbers, whitespace, and punctuation.
- **Custom dictionaries** — Use the system `Intl.Segmenter` or combine local and network dictionaries for Chinese and Japanese.
- **Quick phrases** — Save and reuse frequently used text locally.
- **Privacy mode** — Pause history capture; password-manager-marked content stays in memory by default.
- **Keyboard shortcuts** — Configure shortcuts to open the panel and act on entries or selected tokens; use arrow keys to navigate.
- **Screenshots and editing** — Capture from the panel and open copied images with an editor command you configure.
- **Color picker** — Copy a screen color as HEX, RGB, HSL, or OKLCH text.
- **Device synchronization** — Send entries manually or automatically through a self-hosted `clipboard-x-server` and its Channels, with remote entries identified by device.
- **Lazy transfers** — Send previews of large text and images first, fetch originals when needed, and show verified, byte-accurate progress without a separate local service.
- **Customizable panel** — Adjust size, visible item count, accent color, position, focus behavior, and action icons.

## Installation

The recommended route is the [GNOME Shell Extensions website](https://extensions.gnome.org/). Search for
**Clipboard X**, check that the listing supports **GNOME Shell 50**, and install it. You can then enable
the extension and open its preferences in the Extensions app or Extension Manager.

### Install from source

#### Requirements

- GNOME Shell 50 and GJS 1.88 or later;
- Meson, Ninja, GLib, GTK 4, Libadwaita, GdkPixbuf, Gettext, and 7-Zip;
- a Wayland session for the complete screenshot, color picker, and simulated-input experience.

Build a release archive:

```sh
meson setup build -Dtarget=package
meson compile -C build
meson install -C build
```

Install the generated `build/clipboard-x-gnome.zip`:

```sh
gnome-extensions install --force build/clipboard-x-gnome.zip
gnome-extensions enable clipboard-x@guleo.github.io
```

GNOME Shell on Wayland cannot reload all extension code in place.

After the first installation or when replacing an existing build, log out and back in if the new version
is not loaded.

## Use Clipboard X

### 1. Open and configure the panel

Open Clipboard X from its top-bar icon. Global shortcuts are intentionally unassigned by default; open
the extension preferences and choose **Shortcuts → Global → Open clipboard panel** if you want one.
Pressing the configured panel shortcut again closes the panel.

The first time Clipboard X opens its panel or preferences, it creates a UUID v4 `DeviceId`. This is the
stable synchronization identity. The editable device tag and icon are only its human-friendly profile.

### 2. Reuse clipboard history

Click a history entry—or focus it and press Enter—to copy it. Each row also exposes tokenization or image
editing, pinning, synchronization, and deletion actions when applicable. Search with `Ctrl+F`.

Default contextual shortcuts are:

| In clipboard history | Action |
| --- | --- |
| `v` | Paste the focused entry |
| `p` | Pin or unpin it |
| `Delete` | Delete it from local history |
| `'` | Simulate typing its text |
| `Ctrl` + click | Simulate typing instead of copying |

The keyboard shortcuts in the table can be changed or disabled in Preferences; `Ctrl` + click is fixed.

### 3. Simulated keyboard input

Use simulated typing when the target application does not accept normal paste:

1. Focus the target text field, then open Clipboard X.
2. For a text history entry, use `Ctrl` + click or focus it and press `'`. In the token panel, select the words you need and press `'`.
3. The panel closes and Clipboard X types into the previously focused field after the triggering modifier keys are released. Unlike copy or paste, this does not replace your clipboard content.

Simulated typing is **not** as reliable as pasting. GNOME Shell cannot reliably detect ordinary physical
key presses sent to another Wayland client, so letters and numbers may interleave with the simulated
text. Do not use the keyboard until typing finishes. Cancellation does not undo text already entered;
prefer normal paste for long, sensitive, or exact content.

If an application misses keystrokes, select **Slow** under **Preferences → Clipboard → Simulated input**.
This changes the typing interval; it cannot guarantee that another application accepts every key.

> [!IMPORTANT]
> During simulated typing, GNOME Shell can detect accidental modifier-key presses, but not all physical
> key presses. Pressing Ctrl, Alt, Shift, Super, Meta, or Hyper cancels the remaining input and shows a
> GNOME notification.

### 4. Tokenization mode

Press the token button on a text entry. Move with the arrow keys, click or drag across tokens to select
them, and use `Shift` + arrow keys for keyboard range selection. The default actions are `c` to copy,
`v` to paste, and `'` to simulate typing the selected result.

For Chinese or Japanese, open **Preferences → Clipboard → Dictionaries** to enable the system segmenter,
import UTF-8 dictionaries, or add an HTTP/HTTPS dictionary location. A dictionary may contain one word
per line with an optional frequency:

```text
# locale: zh
# name: Team terminology
注销密钥 90
图片编辑 80
```

Release archives do not bundle third-party dictionaries, and the extension does not silently download
them when installed, started, or opened.

### 5. Keep quick phrases

Open **Quick phrases** from the panel, press `+`, enter a phrase, and confirm with Enter. Quick phrases
stay local.

### 6. Capture, pick, and edit

- **Screenshot** calls the XDG Screenshot Portal. Available targets depend on the local portal backend.
- **Color picker** samples the screen and writes the configured HEX, RGB, HSL, or OKLCH representation.
- **Image editing** launches the command configured under **Preferences → Screenshot → Image editing**.

For example, enter `gradia %i` to use Gradia.

The editor command is parsed as argv and never passed through `sh -c`. It supports `%u` for an image URI,
`%f` for a local path, `%i` for image bytes on standard input, and `%%` for a literal percent sign. For
example:

```text
gradia %i
gimp %f
flatpak run be.alexandervanhee.gradia %u
```

Pipes, redirection, and shell expansion are intentionally unsupported.

## Synchronize devices

Synchronization is off by default. Deploy your own `clipboard-x-server`, then configure and enable it.

To connect a device:

1. Deploy `clipboard-x-server`, register the device's generated DeviceId, issue its own API key, and add it to a Channel.
2. Open **Preferences → Synchronization**.
3. Enter the server address and API key, apply the settings, refresh Channels, and select one.
4. Enable synchronization and test the connection.
5. Keep the default **Manual** send mode and use an entry's sync button, or explicitly choose **Automatic**.

**Preferences → Synchronization → Polling interval** controls how often this device checks for updates;
longer intervals reduce server requests but delay incoming items. To stop recording from an application,
choose it from **Preferences → Clipboard → Privacy → Running application** or enter its window class under
**Excluded applications**.

Addresses may use HTTP or HTTPS; a missing scheme defaults to HTTP. HTTP sends both credentials and content
without transport encryption, so use HTTPS or a trusted private network when confidentiality matters.

The server address, API key, and active Channel are stored in
`$XDG_DATA_HOME/clipboard-x/sync.json`. Per-Channel change cursors are stored separately in
`sync-state.json`. A newly joined device starts from the retained Channel change history and downloads
metadata and previews first; complete large objects remain lazy.

> [!NOTE]
> Deleting an entry in the extension currently deletes only that device's local history copy. It does not
> request a Channel-wide deletion. Server-originated removal events do propagate to clients.

See the [protocol maintained by clipboard-x-server](https://github.com/Guleo/clipboard-x-server/blob/master/docs/protocol.md) for API details and
[Synchronization performance testing](docs/sync-performance-testing.md) for the stress model.

## Data and privacy

| Data | Default location |
| --- | --- |
| History | `$XDG_DATA_HOME/clipboard-x/history/<DeviceId>` |
| Quick phrases | `$XDG_DATA_HOME/clipboard-x/quick-phrases.json` |
| Dictionaries | `$XDG_DATA_HOME/clipboard-x/dictionaries` |
| Sync connection | `$XDG_DATA_HOME/clipboard-x/sync.json` |
| Sync cursors | `$XDG_DATA_HOME/clipboard-x/sync-state.json` |

Local history is not encrypted at rest and is not a password vault. Review [Security and privacy](SECURITY.md)
before enabling synchronization or handling sensitive material.

## Develop and contribute

Contributions are welcome—bug reports, focused fixes, UI refinements, protocol tests, documentation, and
careful translations all help.

1. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the relevant guide in the
   [documentation index](docs/README.md).
2. Open an issue before a large behavioral or protocol change so its scope can be agreed first.
3. Keep changes focused and add or update tests for every behavior change.
4. Run the complete test suite and review your own diff before submitting a pull request.
5. Update the documentation when public behavior changes.

The fastest interactive development loop is:

```sh
tools/run-dev-shell.sh
```

It builds and packages the extension, then starts it in an isolated Mutter Devkit session with separate
XDG data and settings. The host desktop does not need to log out.

Before submitting code:

```sh
meson test -C build --print-errorlogs
meson test -C build --suite stress --print-errorlogs
gnome-shell-test-tool --headless --extension build/clipboard-x-gnome.zip tests/ui/shell.smoke.js
gnome-shell-test-tool --headless --extension build/clipboard-x-gnome.zip tests/ui/preferences.smoke.js
```

Clipboard X does not use ESLint. See [CONTRIBUTING.md](CONTRIBUTING.md) for the repository layout,
localization workflow, code conventions, and release boundaries. Please report security problems through
the private process described in [SECURITY.md](SECURITY.md), not a public issue.

## Documentation

- [Documentation index](docs/README.md)
- [Synchronization Protocol (HTTP API v1)](https://github.com/Guleo/clipboard-x-server/blob/master/docs/protocol.md) — owned by Clipboard X Server
- [UI development guide](docs/ui-architecture.md)
- [Synchronization performance and stress testing](docs/sync-performance-testing.md)
- [Security and privacy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## License

Clipboard X is free software released under the [GNU GPL v3 or later](LICENSE.md).
