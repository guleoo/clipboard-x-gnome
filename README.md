# Clipboard X

> English · [简体中文](README.zh-CN.md)

Clipboard X is a clipboard productivity extension for GNOME Shell 50. Open its unified panel from
the top-bar icon or a configured shortcut to search text and image history, select tokens, sync with
other devices, take screenshots, pick colors, and launch an external image editor.

Synchronization is performed directly by the extension's HTTP client. You configure your own central
server, device API key, and channel; streaming I/O and on-demand materialization keep large transfers
from blocking the Shell or retaining the whole object in JavaScript memory. No local synchronization
Service is installed or required.

## Features

- Search, pin, delete, and copy text or image history; each entry has a stable action area on the right.
- Split text into individually selectable tokens while preserving URLs, email addresses, and structured numbers.
- Import dictionaries for any language; the current GNOME display language selects matching dictionaries,
  with the system segmenter as a fallback.
- Keep search and the compact screenshot, color-picker, and sync buttons on one row; recording, cleanup,
  and settings actions are placed in the footer.
- Configure panel width, history height, and the maximum number of visible entries. Choose whether opening
  the extension always returns to history or restores the last panel.
- Show a user-configured device icon on entries received from other devices. Global tools provide a
  floating tooltip when hovered or keyboard-focused.
- Upload small content immediately. Large text starts with a truncated preview and large images with a
  thumbnail; the original is fetched only when it is actually used.
- Show exact byte progress for resumable upload and download transfers.
- Use the XDG Screenshot Portal for system screenshots.
- Pick colors through the Shell screenshot API and format them as HEX, RGB, HSL, or OKLCH.
- Select an installed image application or configure a safe argv command template for editing.
- Organize settings into Clipboard, Synchronization, Color Picker, Screenshot, and Shortcuts pages;
  shortcuts are recorded by pressing the desired key combination.

## Build and install

The build requires GNOME Shell 50, GJS, Meson, Ninja, GLib, GTK 4, Libadwaita, GdkPixbuf, Gettext,
and 7-Zip. Build the release ZIP with:

```sh
meson setup build -Dtarget=package
meson compile -C build
meson install -C build
```

The artifact is `build/clipboard-x.zip`. Install and enable it with:

```sh
gnome-extensions install --force build/clipboard-x.zip
gnome-extensions enable clipboard-x@guleo.github.io
```

On a Wayland session, GNOME Shell may need a logout and login before a newly installed extension is
loaded. For development, use `-Dtarget=local` in a separate build directory or run the isolated
development shell described below.

## Usage

The first time the main panel or preferences window opens, the extension creates a UUID v4
`DeviceId`. It is the synchronization identity and does not change when you edit the device tag;
the tag is only a human-friendly name used when discovering devices.

Dictionaries are stored under `$XDG_DATA_HOME/clipboard-x/dictionaries`. From “Clipboard → Dictionaries”
you can import a UTF-8 dictionary up to 8 MiB and 150,000 entries. Use one word per line with an
optional frequency, and optionally declare its language and name at the top:

```text
# locale: ja
# name: My Japanese dictionary
秘密鍵 90
画像編集 80
```

Without `# locale`, the import dialog's language selection is used and defaults to the system language.
Imported dictionaries can be opened in the default text editor or in the file manager. Release archives
do not bundle dictionaries, and installation never downloads them automatically. You can add local or
network locations explicitly. Multiple dictionaries matching the current language may be enabled at
once; their entries are merged. The system `Intl.Segmenter` is also listed as an enabled-by-default
dictionary item and can be toggled alongside user dictionaries.

Quick phrases are stored at `$XDG_DATA_HOME/clipboard-x/quick-phrases.json`. Existing GSettings phrases
are migrated on first use of the new storage format.

“Add network location” next to “Import dictionary” accepts an HTTP/HTTPS UTF-8 dictionary URL. It
downloads once when added; use the refresh button on that dictionary row for later updates. The
extension does not access the network automatically on install, startup, or panel activation.

Dictionary settings are shown only for Chinese and Japanese display languages. Other supported languages
use `Intl.Segmenter` and do not show unrelated dictionary controls.

For image editing, choose a Desktop Application in settings or use a custom command. Supported placeholders:

- `%u`: image URI;
- `%f`: local file path;
- `%i`: image bytes on standard input; this placeholder must be a standalone argument;
- `%%`: a literal `%`.

Commands are parsed as argv and never passed through `sh -c`; pipes, redirection, and shell expansion
are not supported. Examples are `gradia %i`, `gimp %f`, and `flatpak run be.alexandervanhee.gradia %u`.

Screenshot targets depend on the local Portal version. Portal v2 normally supports interactive selection
and full-screen capture; window, area, and active-window targets require a Portal v3 backend advertising
`AvailableTargets`. The extension rejects targets that the backend does not declare.

## Synchronization

In “Settings → Synchronization”, enter the server address and device API key, refresh the channel list,
choose an active channel, then enable synchronization and test the connection. The address may be a bare
IP, `IP:port`, HTTP, or HTTPS; an omitted scheme defaults to HTTP and is never silently upgraded. The
server address, API key, and active channel are stored in `$XDG_DATA_HOME/clipboard-x/sync.json`;
non-secret incremental cursors are stored separately in `sync-state.json`. The API key is never stored
in GSettings.

The extension uses a versioned HTTP API to access the central server you choose. Small text and images
are uploaded immediately; large text shares a truncated preview and large images a thumbnail first. The
source device supplies the complete object only when another device actually copies, saves, or edits it.
Upload and download progress reports exact bytes, and objects are checked for size and SHA-256 before
being committed. See the [Synchronization Protocol (HTTP API v1)](docs/sync-protocol.md).

The server is not a blind relay: it stores, displays, and manages uploaded clipboard content, devices,
and channels. Web access to a large object can use the same on-demand materialization flow. The server
is a trust boundary; its administrators can read content that devices upload.

Manual sending is the default. Automatic sending can hand clipboard contents to a user-configured
third-party server without a per-entry action, so it should not be enabled in a GNOME Extensions review
build. Sensitive content synchronization is separately disabled by default.

## Privacy

Clipboard history is stored at `$XDG_DATA_HOME/clipboard-x/history/<DeviceId>`, with separate indexes,
objects, and previews for each source device. Legacy cache data is migrated on first load. Quick phrases,
`sync.json`, and `sync-state.json` use the same XDG data root. Clipboard X does not inspect or force
filesystem permissions on `sync.json`.

Privacy mode pauses capture. Password-manager-marked sensitive content remains in memory by default, and
sensitive synchronization is disabled unless explicitly enabled. See [SECURITY.md](SECURITY.md) for
data flows, trust boundaries, and reporting guidance.

## Testing

```sh
meson test -C build --print-errorlogs
meson test -C build --suite stress --print-errorlogs
gnome-shell-test-tool --headless --extension build/clipboard-x.zip tests/ui/shell.smoke.js
gnome-shell-test-tool --headless --extension build/clipboard-x.zip tests/ui/preferences.smoke.js
```

For interactive development, run:

```sh
tools/run-dev-shell.sh
```

The script uses isolated XDG data and configuration directories and loads
`build-devkit/clipboard-x@guleo.github.io` in a nested GNOME Shell. Close the Devkit window and run it
again after code changes; the host desktop does not need to be logged out and its Clipboard X settings
are not reused.

If nested Mutter can see `wl-copy` MIME types but cannot complete selection transfer, set
`CLIPBOARD_X_SKIP_EXTERNAL_SOURCES=1` when validating UI and lifecycle only. This does not skip the
extension's internal text, image, tokenizer, synchronization-progress, or lifecycle tests.

The project does not use ESLint. Build acceptance consists of Node syntax checks, GJS tests, protocol
interoperability tests, and a real headless GNOME Shell session.

Dictionary performance can be compared with the standalone benchmark:

```sh
curl --fail --location \
  https://raw.githubusercontent.com/yanyiwu/cppjieba/master/dict/jieba.dict.utf8 \
  --output /tmp/jieba.dict.utf8
gjs -m tools/benchmark-tokenizer.js /tmp/jieba.dict.utf8 2000
```

The full dictionary is benchmark input only and is never committed to the extension archive.
The [documentation index](docs/README.md) lists all public guides.

## License

Clipboard X is released under the [GNU GPL v3 or later](LICENSE.md).
