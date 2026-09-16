# Clipboard X 同步协议（HTTP API v1）

> 规范版本：v1 · 文档语言：简体中文 · [English](../sync-protocol.md)

本文是 Clipboard X 扩展与兼容服务器之间的公开协议指南。字段、状态和幂等要求属于
跨实现的接口约定；实现细节以各自项目为准。

本文定义 GNOME 扩展与用户配置的 Clipboard X 中心服务器之间的版本化协议。扩展直接
访问服务器，不需要本机同步 Service，也不使用同步专用 D-Bus 接口。

## 1. 基本约定

- 所有端点位于用户配置地址下的 `/api/v1`；配置地址可以包含反向代理前缀。
- 用户可以填写 `IP:端口`、`http://` 或 `https://` 地址；未写 scheme 时扩展补
  `http://`，不擅自把 HTTP 改成 HTTPS。
- 除协议另有说明外，请求和响应使用 UTF-8 JSON，字段采用 `camelCase`。
- 每个请求都携带 `Authorization: Bearer <API key>` 和
  `X-Clipboard-X-Device-Id: <UUID v4>`。服务器必须校验 API Key 属于该 DeviceId。
- DeviceId 是唯一身份和路由键，不是认证凭据。Device Tag 只在设备资料更新时发送，
  不附加在每个请求中。
- 时间字段为 Unix epoch 毫秒；字节数为未压缩原始内容的逻辑字节数。
- `cursor` 是服务器生成的不透明字符串。客户端只保存和回传，不解析其内容。

错误响应使用：

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

客户端必须限制 JSON、错误正文、预览和完整内容的最大读取量，并校验 UUID、MIME、大小
与 SHA-256。未知字段可忽略；缺少必需字段或字段非法时必须拒绝整条响应。

## 2. 四条核心路径

### 2.1 获取状态

`GET /api/v1/status`

返回协议版本、服务器版本、当前状态和能力限制：

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

`apiVersion` 必须等于 `1`。`state` 为 `online` 或 `degraded`。

### 2.2 获取和更新设备信息

- 客户端连接前，管理员先登记客户端生成的 DeviceId，并签发绑定到该 DeviceId 的 API Key。
- `GET /api/v1/device`：获取当前 API Key 对应的设备资料和状态。
- `PUT /api/v1/device/profile`：更新客户端维护的友好资料，请求体为
  `{"tag":"工作电脑","iconKind":"laptop","iconColor":{"light":"#ffffff"}}`。

设备响应：

```json
{
  "id": "UUID",
  "tag": "工作电脑",
  "iconKind": "laptop",
  "iconColor": {"light": "#ffffff"},
  "state": "online",
  "lastSeenAt": 1787620000000
}
```

图标枚举为 `desktop`、`laptop`、`phone`、`tablet`、`server`、`other`。
资料请求可以省略 `iconColor`，此时服务端存储白色。提供该对象时，`light` 是必需的
小写 `#RRGGBB`；`dark` 可选。省略 `dark` 表示客户端由亮色自动计算暗色，提供 `dark`
则使用独立配置。响应始终包含 `iconColor`，联动状态下不含 `dark`。亮色用于深色背景，
暗色用于浅色背景。
联动计算规则：将亮色拆为 RGB 通道，取最大通道值 `maximum`；各通道乘以
`min(1, 96 / maximum)`（当最大值为 `0` 时取 `1`），四舍五入至整数，格式化为小写
`#RRGGBB`。因此 `#ffffff` 对应 `#606060`。客户端本地计算，服务端不存储计算结果。

### 2.3 推送剪切板内容

`POST /api/v1/channels/{channelId}/items`

第一阶段只提交不可变清单，不把二进制编码进 JSON：

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

`delivery=eager` 表示创建条目时上传完整内容；`on-demand` 表示先同步清单和预览，等远端
真正使用时再向来源设备取回。响应明确告诉客户端还缺哪些对象：

```json
{
  "itemId": "item UUID",
  "uploadId": "upload UUID",
  "previewIds": ["preview-id"],
  "contentIds": ["content-id"],
  "transfer": { "...": "见第 4 节" }
}
```

客户端依次流式调用：

- `PUT /api/v1/uploads/{uploadId}/previews/{previewId}`
- `PUT /api/v1/uploads/{uploadId}/contents/{contentId}`
- `POST /api/v1/uploads/{uploadId}/complete`

PUT 正文就是原始字节流，`Content-Type` 使用清单 MIME，`Content-Length` 必须与清单一致。
服务器边读边计算大小和 SHA-256，校验失败不能发布条目。重复提交相同 ItemId、UploadId
或对象必须幂等；已完成的创建请求可以直接返回 `completed` 传输。

### 2.4 同步剪切板内容

1. `GET /api/v1/channels/{channelId}/changes?cursor=...&limit=200` 获取增量变化。
2. 对 `upsert` 调用 `GET /api/v1/channels/{channelId}/items/{itemId}` 获取清单。
3. 用 `GET .../previews/{previewId}` 获取限量预览。
4. 只有用户真正复制、粘贴、保存或编辑时，才为 `on-demand` 内容发起物化请求。

变化页结构：

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

`kind` 为 `upsert` 或 `remove`。客户端处理完一页后持久化该页 `cursor`；当
`hasMore=true` 时服务器必须推进 cursor。

条目响应把来源资料放在 `origin`，内容清单与发布结构一致，并可增加 `availability`：

```json
{
  "id": "item UUID",
  "createdAt": 1787620000000,
  "origin": {"deviceId":"UUID","tag":"手机","iconKind":"phone","iconColor":{"light":"#ffffff"}},
  "contents": [],
  "previews": []
}
```

## 3. Channel

`GET /api/v1/channels` 返回当前设备已加入的 Channel：

```json
{"channels":[{"id":"UUID","name":"家庭"}]}
```

设备只能读写其所属 Channel。客户端本地只选择一个活动 Channel；切换后使用该 Channel
独立的增量 cursor。

## 4. 传输与精确进度

所有上传和按需物化都有 UUID `transfer.id`：

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

- `kind`：`publish`、`content`。
- `direction`：相对于当前请求设备的 `upload`、`download`。
- `state`：`queued`、`waiting-for-peer`、`transferring`、`verifying`、`completed`、
  `failed`、`cancelled`、`expired`。
- `completedBytes` 必须在 `[0,totalBytes]` 内；`completed` 时两者必须相等。

管理端点：

- `GET /api/v1/transfers`：恢复当前设备最近的传输。
- `GET /api/v1/transfers/{transferId}`：轮询一条传输。
- `DELETE /api/v1/transfers/{transferId}`：请求取消。

上传进度由发送端从实际写入 HTTP 请求体的字节数计算；按需等待阶段由客户端轮询服务器
传输；下载进度由实际写入临时文件的字节数计算。Shell UI 更新最多每 50 ms 一次，避免
大文件高频进度事件拖慢界面。完整内容先写 `.part` 文件，大小和 SHA-256 验证成功后再
原子替换正式对象。

## 5. 按需内容物化

请求设备调用：

`POST /api/v1/channels/{channelId}/items/{itemId}/contents/{contentId}/requests`

服务器若已有完整内容，可返回 `completed` 传输；否则返回 `waiting-for-peer`，并为来源
设备建立工作项。来源设备每 5 秒调用：

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

来源设备找不到本地对象时调用
`POST /api/v1/work/{workId}/reject`，正文为 `{"code":"source_content_missing","message":""}`。
能够提供时调用 `POST /api/v1/work/{workId}/accept`，取得 `uploadId` 与来源设备自己的上传
传输，再通过 `PUT /api/v1/uploads/{uploadId}/contents/{contentId}` 和 complete 上传。

请求传输完成后，请求设备用
`GET /api/v1/channels/{channelId}/items/{itemId}/contents/{contentId}` 流式下载并验证。
服务器网页查看完整内容也必须走同一套按需物化流程，不要求永久缓存所有大内容。

## 6. 客户端生命周期与恢复

- 扩展启用且同步开启时建立 Soup HTTP 会话；扩展禁用或配置改变时取消所有
  `Gio.Cancellable`、传输等待器和轮询定时器，并终止会话。
- 扩展每 5 秒轮询 changes、work 和未完成传输。这里没有常驻本机后台进程、租约或心跳。
- `sync.json` 保存服务器地址、API Key 和活动 Channel；`sync-state.json` 保存每 Channel
  changes cursor 和 work cursor，避免设置进程与 Shell 并发写同一文件。API Key 不写入
  GSettings；GSettings 只用不含机密的 revision 通知已运行扩展重载。
- 本地历史本身就是来源设备的按需内容仓库。扩展重启后可依据持久化清单和 cursor 恢复；
  未完成网络请求按幂等语义重新发起，不依赖进程内事件。
- 远端条目写入本机剪切板时继续使用 ItemId、内容哈希和程序化写入时间抑制回环。
