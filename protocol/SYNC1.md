# Clipboard X Sync1 协议

Sync1 是 Clipboard X 扩展与本机会话中外部同步 Service 之间的公开 D-Bus 协议。扩展不进行远端认证或网络传输；Service 接管不可变快照，并负责连接用户配置的 Clipboard X Server。服务器是可信中心存储，可以查看已经上传到服务器的剪切板内容。

正式 ABI 以 [`io.github.guleo.ClipboardX.Sync1.xml`](io.github.guleo.ClipboardX.Sync1.xml) 为准。本文件定义字段语义、恢复机制和进度计量规则。

## 寻址与兼容性

- 使用 Session D-Bus；接口名固定为 `io.github.guleo.ClipboardX.Sync1`。
- Bus Name 固定为 `io.github.guleo.ClipboardX.SyncService`，Object Path 固定为
  `/io/github/guleo/ClipboardX/Sync`。Service 可以提供 D-Bus 激活文件；测试实现可以在
  隔离环境中覆盖寻址信息，但普通用户不需要配置 D-Bus 技术细节。
- 客户端连接后必须读取所有属性，并拒绝不等于 `1` 的 `ApiVersion`。
- `MaxItemBytes` 或 `MaxPreviewBytes` 为 `0` 时表示 Service 不声明额外上限；客户端自身的安全限制仍然有效。
- `SupportedMimeTypes` 为空表示不额外限制 MIME；否则客户端只发布交集中的表示。
- `a{sv}` 是协议的 Options Object。未知字段必须被忽略；必需字段缺失时必须返回 `InvalidItem`。

## 设备身份和设备目录

客户端第一次使用时生成并持久化 UUID v4 `DeviceId`。所有读取或改变同步状态的方法都携带调用方 DeviceId。DeviceId 用于路由、幂等和去重，不等同于网络认证凭据。

客户端连接、重连或本机资料变化时调用：

```text
RegisterDevice(deviceId, profile)
```

`profile` 定义：

| 字段 | 类型 | 必需 | 含义 |
| --- | --- | --- | --- |
| `tag` | `s` | 是 | 可重复的 Unicode 友好名称 |
| `icon-kind` | `s` | 是 | `desktop`、`laptop`、`phone`、`tablet`、`server` 或 `other` |

Tag 和图标只在注册或变化时发送，不在每次内容调用中重复携带。Service 通过 `ListDevices` 返回设备目录，每条设备记录包含：

| 字段 | 类型 | 必需 | 含义 |
| --- | --- | --- | --- |
| `device-id` | `s` | 是 | 稳定 DeviceId |
| `tag` | `s` | 是 | 当前友好名称 |
| `icon-kind` | `s` | 是 | 跨设备稳定的预设图标类型 |
| `state` | `s` | 是 | `online`、`offline` 或 `unavailable` |
| `last-seen-at` | `t` | 是 | Unix epoch 毫秒 |
| `is-current` | `b` | 是 | 是否为调用方设备 |

任意本地文件路径、主题私有图标名和图片字节都不能作为 `icon-kind`。

## 服务器连接与 Channel

服务器地址、设备 API Key 和活动 Channel 由插件设置页持久化到
`$XDG_DATA_HOME/clipboard-x/sync.json`。该文件是插件与本地 Service 的共享配置真源，
插件不检查或强制修改该文件的文件系统权限。API Key 不写入 GSettings，也不允许通过
`GetConfiguration` 从 Service 读回。

```text
GetConfiguration(deviceId) -> configuration
UpdateConfiguration(deviceId, changes) -> configuration
ListChannels(deviceId) -> channels
TestConnection(deviceId) -> result
```

`configuration` 返回：

| 字段 | 类型 | 必需 | 含义 |
| --- | --- | --- | --- |
| `server-address` | `s` | 是 | 用户填写的服务器地址；未配置时为空 |
| `api-key-configured` | `b` | 是 | Service 是否已保存设备 API Key |
| `active-channel-id` | `s` | 是 | 当前 Channel UUID；未选择时为空 |
| `active-channel-name` | `s` | 否 | 当前 Channel 友好名称 |

`UpdateConfiguration` 使用增量 changes，把设置进程刚写入 `sync.json` 的值即时通知给
Service：字段缺失表示保留旧值；`server-address` 更新服务器地址；`api-key` 是只写字段，
用于替换现有 Key；`clear-api-key=true` 清除内存中的 Key；`active-channel-id` 选择当前设备
已经加入的 Channel。方法返回更新后的脱敏 configuration。Service 启动时必须主动读取
`sync.json`，不能要求设置窗口保持运行。

Service 接受的服务器地址形式由实现决定，Clipboard X 标准实现应接受纯主机/IP、`IP:端口`、`http://` 和 `https://`。设置界面不替用户选择传输协议。

`ListChannels` 只返回当前 API Key 对应设备已经加入的 Channel。每条记录包含 UUID `id`、友好 `name` 和布尔值 `active`。设备可以加入多个 Channel，但每次只有一个活动 Channel；每条发布记录只属于一个明确 Channel。

`Publish` 和 `GetChanges` 总是作用于 Service 当前保存的活动 Channel。切换 Channel 后，Service 必须切换到该 Channel 独立的变化流；扩展收到 `ConfigurationChanged` 后丢弃内存 cursor，并用空 cursor 重建一致视图。Service 不得把旧 Channel 的 cursor 用到新 Channel。

`TestConnection` 对当前已保存配置执行一次有限时长测试，返回 `state`（`online`、`offline` 或 `error`）、非负 `latency-ms`、可选 `server-version` 和可选 `message`。它不得返回 API Key 或剪切板正文。

## Service 状态

`GetStatus(deviceId)` 返回 Service 对调用方的权威状态：

| 字段 | 类型 | 必需 | 含义 |
| --- | --- | --- | --- |
| `state` | `s` | 是 | `online`、`offline`、`degraded` 或 `error` |
| `network-state` | `s` | 是 | Service 定义的网络状态 |
| `pending-items` | `u` | 是 | 等待调用方处理的变化数 |
| `active-transfers` | `u` | 是 | 调用方的活动传输数 |
| `last-sync-at` | `t` | 是 | 最近一次成功同步时间；未知为 0 |
| `revision` | `t` | 是 | 状态快照修订号 |
| `error-code` | `s` | 否 | 机器可读错误码 |
| `error-message` | `s` | 否 | 适合用户阅读的简短错误 |

## 条目和内容元数据

条目元数据：

| 字段 | 类型 | 必需 | 含义 |
| --- | --- | --- | --- |
| `id` | `s` | 是 | 不可变 UUID；重复 Publish 必须幂等 |
| `created-at` | `t` | 是 | Unix epoch 毫秒 |
| `origin-device-id` | `s` | 是 | 产生条目的 DeviceId |
| `origin-device-tag` | `s` | 返回时必需 | Service 解析出的友好名称快照 |
| `origin-device-icon-kind` | `s` | 返回时必需 | Service 解析出的设备图标快照 |
| `contents` | `aa{sv}` | 是 | 可物化内容表示清单 |

每个 `contents` 元素以及 FD 负载的元数据：

| 字段 | 类型 | 必需 | 含义 |
| --- | --- | --- | --- |
| `content-id` | `s` | 是 | 条目内稳定且唯一的表示 ID |
| `mime-type` | `s` | 清单中是 | 规范化 MIME 类型 |
| `size` | `t` | 是 | 原始逻辑字节数 |
| `sha256` | `s` | 完整内容是 | 小写十六进制 SHA-256 |
| `delivery` | `s` | 完整内容是 | `eager` 或 `on-demand` |
| `truncated` | `b` | 预览是 | 预览是否不是完整原文 |

预览的 `content-id` 指向它派生自的完整内容。缩略图和截断文本只能用于展示，不能作为复制、保存、分词或编辑的原始内容。

## 发布和精确上传进度

```text
Publish(deviceId, item, previews, contents, options) -> itemId, transferId
```

`Publish` 只创建异步发布任务并返回稳定的 `transferId`。Service 必须在返回前取得所有 UNIX FD 的独立所有权，之后可以异步读取。方法返回不表示远端发布已经完成。

发布任务的 `kind` 为 `publish`、`direction` 为 `upload`。对于 `on-demand` 内容，初始发布进度只计算实际上传到中心服务器的清单、预览和 eager 内容；完整原文以后被 Web 或其他设备请求时建立独立的 `content` 传输。这样 100% 不会错误表示大内容已经缓存到服务器。

## 增量同步

```text
GetChanges(deviceId, cursor, options) -> nextCursor, changes, hasMore
```

cursor 是 Service 定义的不透明字符串。空字符串表示客户端没有 cursor，Service 必须返回可建立一致状态的快照或增量起点。`options.limit` 是可选的无符号整数。

每条 change 是 `a{sv}`：

| 字段 | 类型 | 必需 | 含义 |
| --- | --- | --- | --- |
| `sequence` | `t` | 是 | Service 内单调递增序号 |
| `kind` | `s` | 是 | `upsert` 或 `remove` |
| `item-id` | `s` | 是 | 受影响条目 |
| `reason` | `s` | remove 时可选 | 删除原因 |

客户端对 `upsert` 调用 `GetItem` 获取元数据和预览，对 `remove` 删除本地远端副本。客户端必须逐页读取直到 `hasMore` 为 false，成功应用一页后才能持久化 `nextCursor`。

## 按需物化和精确下载进度

```text
RequestContent(deviceId, itemId, contentIds, options) -> transferId
```

该任务的 `kind` 为 `content`，在接收设备观察时 `direction` 为 `download`，在来源设备观察时为 `upload`。Service 可以为两个观察方创建不同 transferId，但必须关联同一 item。

`ready` 已被统一终态 `completed` 取代。`completed` 后客户端逐个调用 `OpenContent`，校验大小和 SHA-256，再调用 `Acknowledge`。

## Transfer 模型

`GetTransfer` 和 `ListTransfers` 返回的每个传输记录，以及 `TransferChanged` 信号，都使用同一份 `a{sv}`：

| 字段 | 类型 | 必需 | 含义 |
| --- | --- | --- | --- |
| `transfer-id` | `s` | 是 | UUID v4 |
| `item-id` | `s` | 是 | 关联条目 |
| `device-id` | `s` | 是 | 该记录的观察方 DeviceId |
| `kind` | `s` | 是 | `publish` 或 `content` |
| `direction` | `s` | 是 | `upload` 或 `download` |
| `state` | `s` | 是 | 下述状态之一 |
| `completed-bytes` | `t` | 是 | 已完成逻辑字节数 |
| `total-bytes` | `t` | 是 | 总逻辑字节数；未知为 0 |
| `peer-device-ids` | `as` | 是 | 任务开始时冻结的对端设备集合 |
| `created-at` | `t` | 是 | Unix epoch 毫秒 |
| `updated-at` | `t` | 是 | Unix epoch 毫秒 |
| `error-code` | `s` | 否 | 机器可读错误码 |
| `error-message` | `s` | 否 | 简短错误信息 |

标准状态：`queued`、`waiting-for-peer`、`transferring`、`verifying`、`completed`、`failed`、`cancelled`、`expired`。

精确进度按未经压缩和加密的逻辑内容字节计量。`completed-bytes` 必须单调递增且不大于 `total-bytes`；进入 `transferring` 后非零 total 不得改变；`completed` 时两者必须相等。total 为 0 时 UI 显示不定进度。Service 应在状态变化时立即发信号，在连续传输时把频率限制在每秒 10 至 20 次，并且不能节流最终状态。

多目标发布开始后必须冻结目标集合；聚合 total 是每个目标实际传输逻辑字节数之和。

## UNIX FD 传输

`Publish`、`GetItem` 和 `OpenContent` 使用 D-Bus UNIX FD (`h`) 带外传输字节。数组中的 `h` 是当前消息 FD List 的索引，不是可跨消息保存的进程文件描述符。

接收方必须限量流式读取、不信任声明大小，并在完整内容交付前重新验证大小和哈希。

## 信号和恢复

信号只提供低延迟通知，方法提供可恢复的权威状态：

| 信号 | 作用 | 权威恢复方法 |
| --- | --- | --- |
| `StatusChanged(status)` | Service 整体状态变化 | `GetStatus` |
| `DeviceChanged(device)` | 设备资料或在线状态变化 | `ListDevices` |
| `DeviceRemoved(deviceId, reason)` | 设备解除配对或永久删除 | `ListDevices` |
| `ChangesAvailable(latestCursor)` | 提示变化日志已有新内容 | `GetChanges` |
| `TransferChanged(transfer)` | 上传或下载状态及精确进度 | `GetTransfer` / `ListTransfers` |
| `ConfigurationChanged(configuration)` | 服务器地址、Key 状态或活动 Channel 变化 | `GetConfiguration` |
| `ChannelsChanged(revision)` | 当前设备可用 Channel 集合变化 | `ListChannels` |

`ChangesAvailable` 可以合并，不能携带剪切板正文。客户端重连后必须主动调用全部对应恢复方法，不能假设信号从未丢失。设备删除后，已有条目应继续显示保存于条目元数据中的来源 Tag 和图标快照。

## 错误与安全边界

标准错误尾名：`UnsupportedVersion`、`UnsupportedMimeType`、`TooLarge`、`Unavailable`、`Expired`、`NotAuthorized`、`InvalidItem`、`InvalidConfiguration`、`NotConfigured`、`Busy`、`Offline`。

Sync1 只跨本机会话总线，不定义服务器 HTTP API 的认证和传输协议。标准服务端采用每设备 API Key，服务器拥有并可查看实际上传的内容；连接使用 HTTP 还是 HTTPS 由用户填写的服务器地址决定。Service 负责 Key 保存、网络请求、离线队列和远端快照删除。实现不得在日志或信号中记录剪切板正文、API Key、Authorization 或完整敏感路径；客户端隐私模式和敏感内容策略优先于自动发布。

仓库中的 GJS 与 Python Mock Service 只用于互操作测试，不是网络同步服务，也不随 GNOME Extensions 发布包安装。
