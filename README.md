<div align="center">

# Clipboard X

**A local-first clipboard workspace for GNOME Shell.**

History · Token selection · Quick phrases · Device sync · Screenshots · Color picking

[English](README.md) · [简体中文](README.zh-CN.md)

[![GNOME Shell 50](https://img.shields.io/badge/GNOME%20Shell-50-4A86CF?logo=gnome&logoColor=white)](https://www.gnome.org/)
[![GJS](https://img.shields.io/badge/GJS-ES%20Modules-F7DF1E?logo=javascript&logoColor=111)](https://gjs.guide/)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-663399)](LICENSE.md)

</div>

Clipboard X turns the GNOME top bar into a compact workspace for everything that passes through your
clipboard. Search and reuse text or images, select exactly the words you need, keep reusable phrases,
take screenshots, pick colors, and optionally share clipboard snapshots through a server you control.

The extension is designed to stay useful without synchronization. History and quick phrases are stored
locally; clipboard synchronization starts only after you configure and enable a compatible server.
Network dictionaries are downloaded only when you explicitly add or refresh them.

> [!IMPORTANT]
> Clipboard X currently targets **GNOME Shell 50**. Earlier Shell releases are not supported by the
> packaged extension metadata.

## At a glance

| Clipboard | Text tools | Capture tools | Devices |
| --- | --- | --- | --- |
| Search text and images | Select individual tokens | Use the system screenshot portal | Identify remote entries by device |
| Pin important entries | Preserve links, email, numbers, and punctuation | Pick HEX, RGB, HSL, or OKLCH colors | Send manually or automatically |
| Copy, paste, or simulate typing | Add local or network dictionaries | Launch an image editor command | Fetch large originals only when used |
| Keep reusable quick phrases | Navigate and select by keyboard | Configure global shortcuts | Show exact upload/download progress |

### Local-first history

Clipboard contents become immutable local snapshots organized by source device. Pinned entries survive
history limits, privacy mode pauses capture, and password-manager-marked content is kept in memory by
default. The panel width, height, item count, accent color, actions, position, and focus behavior are all
configurable.

### Purpose-built token selection

Open the tokenizer from any text entry, select one or more tokens, then copy, paste, or type the result.
Clipboard X recognizes URLs, email addresses, structured numbers, multilingual words, whitespace, and
punctuation. It uses `Intl.Segmenter` as the system baseline and can merge multiple user dictionaries for
Chinese and Japanese.

### Lazy, visible synchronization

Small content is sent in full. Large text starts with a truncated preview and large images with a
thumbnail; the original is materialized only when another device actually uses it. Transfers stream data,
verify size and SHA-256, and expose byte-accurate progress in the panel. Synchronization runs directly in
the extension—there is no separate local service to install.

## Install

### Requirements

- GNOME Shell 50 and GJS 1.88 or later;
- Meson, Ninja, GLib, GTK 4, Libadwaita, GdkPixbuf, Gettext, and 7-Zip;
- a Wayland session for the complete screenshot, color picker, and simulated-input experience.

Build a release archive:

```sh
meson setup build -Dtarget=package
meson compile -C build
meson install -C build
```

Install the generated `build/clipboard-x.zip`:

```sh
gnome-extensions install --force build/clipboard-x.zip
gnome-extensions enable clipboard-x@guleo.github.io
```

GNOME Shell on Wayland cannot reload all extension code in place. After the first installation—or after
replacing an installed build—log out and back in if the new version is not loaded.

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
| `Ctrl` + click / `Ctrl+Enter` | Simulate typing instead of copying |

All shortcuts can be changed or disabled in Preferences.

### 3. Select part of a sentence

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

Dictionary files are stored in `$XDG_DATA_HOME/clipboard-x/dictionaries`. Release archives do not bundle
or silently download third-party dictionaries.

### 4. Keep quick phrases

Open **Quick phrases** from the panel, press `+`, enter a phrase, and confirm with Enter. Quick phrases
are local-only and stored in `$XDG_DATA_HOME/clipboard-x/quick-phrases.json`.

### 5. Capture, pick, and edit

- **Screenshot** calls the XDG Screenshot Portal. Available targets depend on the local portal backend.
- **Color picker** samples the screen and writes the configured HEX, RGB, HSL, or OKLCH representation.
- **Image editing** launches the command configured under **Preferences → Screenshot → Image editing**.

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

Clipboard X speaks a versioned HTTP API to a central server chosen by the user. The server is a readable
storage and management platform—not an end-to-end encrypted or blind relay. Its administrators can inspect
content uploaded to it.

To connect a device:

1. Give the device its own API key on a compatible server and add it to a Channel.
2. Open **Preferences → Synchronization**.
3. Enter the server address and API key, apply the settings, refresh Channels, and select one.
4. Enable synchronization and test the connection.
5. Keep the default **Manual** send mode and use an entry's sync button, or explicitly choose **Automatic**.

Addresses may use HTTP or HTTPS; a missing scheme defaults to HTTP. HTTP sends both credentials and content
without transport encryption, so use HTTPS or a trusted private network when confidentiality matters.

The server address, API key, and active Channel are stored in
`$XDG_DATA_HOME/clipboard-x/sync.json`. Per-Channel change cursors are stored separately in
`sync-state.json`. A newly joined device starts from the retained Channel change history and downloads
metadata and previews first; complete large objects remain lazy.

> [!NOTE]
> Deleting an entry in the extension currently deletes only that device's local history copy. It does not
> request a Channel-wide deletion. Server-originated removal events do propagate to clients.

See the [Synchronization Protocol](docs/sync-protocol.md) for compatible-server requirements and
[Synchronization performance testing](docs/sync-performance-testing.md) for the stress model.

## Simulated keyboard input

Simulated input is useful where normal paste is unavailable, but it is not equivalent to pasting. Clipboard X
waits for the triggering modifiers to be released and cancels when Ctrl, Alt, Shift, Super, Meta, or Hyper is
detected during typing. GNOME Shell cannot reliably observe ordinary physical key presses sent to another
Wayland client, so letters and numbers may still interleave with simulated text.

Do not use the physical keyboard until simulated typing finishes. Prefer normal clipboard paste for long,
sensitive, or exact content.

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
5. Update both English and Simplified Chinese documentation when public behavior changes.

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
gnome-shell-test-tool --headless --extension build/clipboard-x.zip tests/ui/shell.smoke.js
gnome-shell-test-tool --headless --extension build/clipboard-x.zip tests/ui/preferences.smoke.js
```

Clipboard X does not use ESLint. See [CONTRIBUTING.md](CONTRIBUTING.md) for the repository layout,
localization workflow, code conventions, and release boundaries. Please report security problems through
the private process described in [SECURITY.md](SECURITY.md), not a public issue.

## Documentation

- [Documentation index](docs/README.md)
- [Synchronization Protocol (HTTP API v1)](docs/sync-protocol.md)
- [UI development guide](docs/ui-architecture.md)
- [Synchronization performance and stress testing](docs/sync-performance-testing.md)
- [Security and privacy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## License

Clipboard X is free software released under the [GNU GPL v3 or later](LICENSE.md).
