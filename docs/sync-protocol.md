# Clipboard X synchronization protocol (HTTP API v1)

> English · [简体中文](zh-CN/sync-protocol.md)

This document defines the versioned protocol between the GNOME extension and a user-configured
Clipboard X central server. The extension accesses the server directly; no local synchronization
Service or synchronization-specific D-Bus interface is required.

## 1. Conventions

- All endpoints are below `/api/v1` at the configured server address. The address may include a
  reverse-proxy path prefix.
- Users may enter an IP, `IP:port`, HTTP, or HTTPS address. If no scheme is supplied, the extension
  uses `http://`; it never silently upgrades HTTP to HTTPS.
- Unless stated otherwise, requests and responses are UTF-8 JSON with `camelCase` fields.
- Every request carries `Authorization: Bearer <API key>` and
  `X-Clipboard-X-Device-Id: <UUID v4>`. The server must verify that the API key belongs to that
  DeviceId.
- DeviceId is an identity and routing key, not an authentication credential. Device Tag is sent only
  when device profile data changes and is not repeated on every request.
- Time fields are Unix epoch milliseconds. Byte counts are logical uncompressed bytes.
- `cursor` is an opaque server-generated string. Clients store and return it without parsing it.

Errors use:

```json
{
  "error": {
    "code": "not_authorized",
    "message": "Human-readable summary",
    "requestId": "optional-id",
    "details": {}
  }
}
```

Clients must limit JSON, error bodies, previews, and complete content, and must validate UUIDs, MIME
types, sizes, and SHA-256. Unknown fields may be ignored; a missing required field or invalid field
must reject the complete response.

## 2. Core paths

### 2.1 Get server status

`GET /api/v1/status`

Returns the protocol version, server version, state, and capability limits:

```json
{
  "apiVersion": 1,
  "serverVersion": "0.1.0",
  "state": "online",
  "capabilities": {
    "supportedMimeTypes": ["text/plain;charset=utf-8", "image/png"],
    "maxItemBytes": 268435456,
    "maxPreviewBytes": 1048576
  },
  "pendingItems": 0,
  "activeTransfers": 0,
  "lastSyncAt": 0,
  "revision": 1
}
```

`apiVersion` must be `1`. `state` is `online` or `degraded`.

### 2.2 Get and update device information

- Before the client connects, the administrator registers its client-generated DeviceId and issues
  an API key bound to that DeviceId.
- `GET /api/v1/device`: returns the device profile and state for the current API key.
- `PUT /api/v1/device/profile`: updates client-owned friendly profile data with
  `{"tag":"Work computer","iconKind":"laptop","iconColor":{"light":"#ffffff"}}`.

Device response:

```json
{
  "id": "UUID",
  "tag": "Work computer",
  "iconKind": "laptop",
  "iconColor": {"light": "#ffffff"},
  "state": "online",
  "lastSeenAt": 1787620000000
}
```

Icon values are `desktop`, `laptop`, `phone`, `tablet`, `server`, and `other`.
`iconColor` may be omitted from the profile request, in which case the server stores white.
When supplied, it requires a lowercase `#RRGGBB` `light` value and optionally accepts a `dark`
value. Omitted `dark` means clients derive the dark color from `light`; setting `dark` configures
it independently. Responses include `iconColor` and preserve the absence of linked `dark`.
The light color is used on dark backgrounds; the dark color is used on light backgrounds.
To derive a linked dark color, parse the light color into RGB channels, take the largest channel
`maximum`, multiply each channel by `min(1, 96 / maximum)` (or `1` when `maximum` is `0`), round
each channel to the nearest integer and format as lowercase `#RRGGBB`. Thus `#ffffff` yields
`#606060`. Clients recalculate this color locally; the server does not persist the derived value.

### 2.3 Publish clipboard content

`POST /api/v1/channels/{channelId}/items`

The first phase submits an immutable manifest. Binary data is never embedded in JSON:

```json
{
  "id": "item UUID",
  "createdAt": 1787620000000,
  "originDeviceId": "device UUID",
  "contents": [{
    "id": "content-id",
    "mimeType": "text/plain;charset=utf-8",
    "size": 123,
    "sha256": "64 lowercase hex characters",
    "delivery": "eager"
  }],
  "previews": [{
    "id": "preview-id",
    "contentId": "content-id",
    "mimeType": "text/plain;charset=utf-8",
    "size": 80,
    "sha256": "64 lowercase hex characters",
    "truncated": true
  }]
}
```

`delivery=eager` uploads complete content while the item is created. `on-demand` first synchronizes
the manifest and preview, then asks the source device for the original when a remote user actually uses it.
The response tells the client which objects are requested:

```json
{
  "itemId": "item UUID",
  "uploadId": "upload UUID",
  "previewIds": ["preview-id"],
  "contentIds": ["content-id"],
  "transfer": { "...": "see section 4" }
}
```

The client then streams:

- `PUT /api/v1/uploads/{uploadId}/previews/{previewId}`
- `PUT /api/v1/uploads/{uploadId}/contents/{contentId}`
- `POST /api/v1/uploads/{uploadId}/complete`

The PUT body is the original byte stream. `Content-Type` is the manifest MIME type and
`Content-Length` must match the manifest. The server counts bytes and computes SHA-256 while reading;
failed validation must not publish the item. Repeating the same ItemId, UploadId, or object is idempotent.
A completed creation may return a `completed` transfer immediately.

### 2.4 Synchronize clipboard content

1. `GET /api/v1/channels/{channelId}/changes?cursor=...&limit=200` gets incremental changes.
2. For an `upsert`, `GET /api/v1/channels/{channelId}/items/{itemId}` gets the manifest.
3. `GET .../previews/{previewId}` gets a size-limited preview.
4. Only when the user copies, pastes, saves, or edits does the client request an `on-demand` object.

Change page:

```json
{
  "cursor": "opaque-next-cursor",
  "hasMore": false,
  "changes": [{
    "sequence": 18,
    "kind": "upsert",
    "itemId": "item UUID",
    "reason": ""
  }]
}
```

`kind` is `upsert` or `remove`. The client persists the page's `cursor` after processing it.
When `hasMore=true`, the server must advance the cursor.

An item response stores source information in `origin`, followed by the content manifest and optional
`availability`:

```json
{
  "id": "item UUID",
  "createdAt": 1787620000000,
  "origin": {"deviceId":"UUID","tag":"Phone","iconKind":"phone","iconColor":{"light":"#ffffff"}},
  "contents": [],
  "previews": []
}
```

## 3. Channels

`GET /api/v1/channels` returns channels joined by the current device:

```json
{"channels":[{"id":"UUID","name":"Home"}]}
```

A device can read and write only channels it has joined. The client selects one active channel locally;
each channel has an independent change cursor.

## 4. Transfers and exact progress

Every upload and on-demand materialization has a UUID `transfer.id`:

```json
{
  "id": "transfer UUID",
  "itemId": "item UUID",
  "deviceId": "device UUID",
  "kind": "publish",
  "direction": "upload",
  "state": "transferring",
  "completedBytes": 65536,
  "totalBytes": 1048576,
  "peerDeviceIds": [],
  "createdAt": 1787620000000,
  "updatedAt": 1787620000100,
  "error": {"code":"","message":""}
}
```

- `kind`: `publish` or `content`.
- `direction`: `upload` or `download` relative to the requesting device.
- `state`: `queued`, `waiting-for-peer`, `transferring`, `verifying`, `completed`,
  `failed`, `cancelled`, or `expired`.
- `completedBytes` is in `[0,totalBytes]`; a completed transfer must have equal values.

Management endpoints:

- `GET /api/v1/transfers`: recover recent transfers for the current device.
- `GET /api/v1/transfers/{transferId}`: poll one transfer.
- `DELETE /api/v1/transfers/{transferId}`: request cancellation.

Upload progress is measured from bytes actually written to the HTTP request body. On-demand waiting is
reported by polling the server. Download progress is measured from bytes written to the temporary file.
The Shell UI is updated at most every 50 ms. Complete content is written to a `.part` file and atomically
replaced only after size and SHA-256 verification.

## 5. On-demand materialization

The requesting device calls:

`POST /api/v1/channels/{channelId}/items/{itemId}/contents/{contentId}/requests`

If the server already has the complete object it may return a `completed` transfer. Otherwise it
returns `waiting-for-peer` and creates work for the source device. The source polls:

`GET /api/v1/work?cursor=...&limit=100`

```json
{
  "cursor": "opaque-work-cursor",
  "hasMore": false,
  "work": [{
    "id": "work UUID",
    "type": "materialize-content",
    "itemId": "item UUID",
    "contentId": "content-id"
  }]
}
```

If the source cannot find the local object, it calls
`POST /api/v1/work/{workId}/reject` with
`{"code":"source_content_missing","message":""}`. Otherwise it calls
`POST /api/v1/work/{workId}/accept`, receives an `uploadId` and its own source upload transfer,
then streams the content and completes the upload.

After the request transfer completes, the requesting device streams
`GET /api/v1/channels/{channelId}/items/{itemId}/contents/{contentId}` and verifies the object.
The server web UI must use the same on-demand flow for large content rather than requiring every original
object to remain permanently cached.

## 6. Client lifecycle and recovery

- When the extension and synchronization are enabled, create a Soup HTTP session. On disable or
  configuration change, cancel all `Gio.Cancellable` objects, transfer waiters, and poll timers, then
  terminate the session.
- Poll changes, work, and unfinished transfers every five seconds. There is no resident local process,
  lease, or heartbeat.
- `sync.json` stores the server address, API key, and active channel. `sync-state.json` stores
  per-channel change cursors and the work cursor so preferences and Shell processes do not overwrite
  each other's progress. API keys are not stored in GSettings; GSettings carries only a non-secret
  revision notification.
- Local history is also the source device's on-demand object store. After restart, persisted manifests
  and cursors allow recovery; unfinished requests are retried using idempotent semantics.
- When writing a remote item to the local clipboard, suppress loops using ItemId, content hashes, and
  programmatic-write timestamps.
