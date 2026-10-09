# Security and privacy

> English · [简体中文](SECURITY.zh-CN.md)

Clipboard X Gnome handles clipboard text, screenshots, device identifiers, and synchronization credentials.
These data can include passwords, tokens, personal information, or work material. This document
describes the extension's data flows and trust boundaries.

## Data flows and trust boundaries

1. GNOME Shell provides the extension with the current clipboard MIME representations.
2. The extension reads content within the configured limits, stores immutable snapshots in the user's
   data directory, and creates previews.
3. When synchronization and its policies are enabled, the extension sends manifests, previews, and
   permitted complete objects directly to the user-configured central server over the HTTP API.
4. The server address, device API key, and active channel are stored in `sync.json`; non-secret
   incremental cursors are stored in `sync-state.json`. The API key authenticates a device; DeviceId
   provides identity, routing, and idempotency and cannot replace authentication.
5. The central server is a trusted store and management platform, not an unreadable relay. Its
   administrators can view clipboard content actually uploaded to it; large content and web previews
   can still use on-demand materialization.
6. Screenshots return a local URI from the XDG Screenshot Portal. They enter history, the clipboard,
   or an external editor only when the user enables the corresponding action.
7. External editors start from a user-configured argv template; the template is never passed through a shell.

Users may choose HTTP or HTTPS. The extension does not force HTTPS or silently upgrade HTTP URLs.
HTTP sends the API key and content in clear text on the network; users who need confidentiality and
server authentication should deploy HTTPS or use a trusted, controlled network.

## Local protection

- History is stored at `$XDG_DATA_HOME/clipboard-x/history/<DeviceId>`, separated by source device,
  with directory mode `0700). Legacy cache data is migrated on first load.
- Quick phrases are stored at `$XDG_DATA_HOME/clipboard-x/quick-phrases.json`; `sync.json` and
  `sync-state.json` use the same data root. The extension does not inspect or force permissions on
  `sync.json`; the non-secret state file uses private permissions.
- The API key is not written to GSettings, logs, status objects, or the public preferences model.
  GSettings stores only a non-secret configuration revision used to notify the running extension.
- History loading rejects path traversal, symlinks, non-regular files, invalid metadata, and objects
  with mismatched size or SHA-256.
- JSON, error bodies, previews, and complete content have independent read limits. Complete downloads
  use a random `.part` file and are atomically replaced only after size and SHA-256 verification.
- Uploads read persistent objects as streams and downloads write files as streams; large files are not
  copied into a giant JavaScript Buffer. `Gio.Cancellable` cancels all work when the extension is
  disabled or its configuration changes.
- UUIDs, channels, MIME types, sizes, hashes, states, and opaque cursors in server responses are
  boundary-checked. Transfer state, work pages, and change pages have count limits.
- Thumbnails and truncated text are previews and must never be treated as original content.
- Logs do not contain clipboard text, API keys, raw server error bodies, or complete sensitive paths.
- Privacy mode pauses capture. Password-manager-marked content is either discarded or kept only in
  memory until the extension stops; it cannot be synchronized.

Local history and `sync.json` are not a vault and are not encrypted at rest. Malicious software running
as the current user, or controlling GNOME Shell, is outside this model. Use privacy mode and disable
synchronization when handling highly sensitive content.

## Requirements for compatible HTTP servers

A compatible server must at least:

- assign each device an independent API key and bind it to its DeviceId;
- validate DeviceId, API key, and channel membership on every request;
- distrust client-declared UUIDs, MIME types, sizes, and hashes, recounting and rehashing streamed input;
- enforce limits for JSON, previews, complete content, devices, channels, change logs, work queues, and transfers;
- keep publication, upload completion, content requests, cancellation, and cursor reads idempotent or safely retryable;
- use unpredictable UploadId, TransferId, and WorkId values and prevent cross-device access to private work;
- never treat a thumbnail as original content before the source device provides the on-demand object;
- define clear retention, revocation, deletion, and web-access policies;
- avoid logging or sending clipboard text, API keys, and complete sensitive paths in telemetry.

See the Server-owned [Synchronization Protocol (HTTP API v1)](https://github.com/guleoo/clipboard-x-server/blob/master/docs/protocol.md) for formal fields and state machines.

## GNOME Extensions review boundary

Manual sending is the default. Sending clipboard content to a user-configured server is still sharing
with a third party. A GNOME Extensions review build should hide or remove automatic sending options that
are not triggered by an explicit per-entry action, and its metadata and listing must disclose clipboard
access, server data flows, and external image-editor launching.
