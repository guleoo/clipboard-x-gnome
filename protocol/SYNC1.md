# Clipboard X Sync1 协议

Sync1 是 Clipboard X 扩展与本机会话中的外部同步 Service 之间的公开 D-Bus
协议。扩展不进行设备发现、认证或网络传输；Service 接管不可变快照，并决定如何把
它传送到其他设备。

正式 ABI 以 [`io.github.guleo.ClipboardX.Sync1.xml`](io.github.guleo.ClipboardX.Sync1.xml)
为准。本文件解释字段语义、生命周期和实现约束。

## 寻址与兼容性

- 使用 Session D-Bus；接口名固定为 `io.github.guleo.ClipboardX.Sync1`。
- Bus Name 和 Object Path 由用户配置，Service 可以提供 D-Bus 激活文件。
- 客户端连接后必须读取所有属性，并拒绝不等于 `1` 的 `ApiVersion`。
- `MaxItemBytes` 或 `MaxPreviewBytes` 为 `0` 时表示 Service 不声明额外上限；客户端自身
  的安全限制仍然有效。
- `SupportedMimeTypes` 为空表示不额外限制 MIME；否则客户端只发布交集中的表示。

## 设备身份

客户端第一次使用时生成并持久化 UUID v4 `DeviceId`。所有会改变或读取同步状态的
方法都携带它，Service 必须以 DeviceId 做路由、幂等和去重。

`Device Tag` 只是允许重复的 Unicode 友好名称。客户端在连接、重连或 Tag 变化时调用
一次 `RegisterDevice`；其余调用不重复携带 Tag。Service 可在 `GetItem` 返回的条目
元数据中补充 `origin-device-tag`，但不能把它当作安全身份。

## 条目和内容元数据

`a{sv}` 保留扩展字段能力。Sync1 定义以下字段；未知字段必须被忽略并在转发时尽量保留。

条目元数据：

| 字段 | 类型 | 必需 | 含义 |
| --- | --- | --- | --- |
| `id` | `s` | 是 | 不可变 UUID；重复 Publish 必须幂等 |
| `created-at` | `t` | 是 | Unix epoch 毫秒 |
| `origin-device-id` | `s` | 是 | 产生条目的 DeviceId |
| `origin-device-tag` | `s` | 返回时可选 | Service 解析出的友好名称 |
| `favorite` | `b` | 否 | 来源设备的收藏提示，不改变保留策略 |
| `contents` | `aa{sv}` | 是 | 可物化内容表示清单 |

每个 `contents` 元素以及 FD 负载的元数据：

| 字段 | 类型 | 必需 | 含义 |
| --- | --- | --- | --- |
| `content-id` | `s` | 是 | 条目内稳定且唯一的表示 ID |
| `mime-type` | `s` | 清单中是 | 规范化 MIME 类型 |
| `size` | `t` | 是 | 原始字节数 |
| `sha256` | `s` | 完整内容是 | 小写十六进制 SHA-256 |
| `delivery` | `s` | 完整内容是 | `eager` 或 `on-demand` |
| `truncated` | `b` | 预览是 | 预览是否不是完整原文 |

预览的 `content-id` 指向它派生自的完整内容。缩略图和截断文本只能用于展示，不能
作为复制、保存或编辑的原始内容。

## UNIX FD 传输

`Publish`、`GetItem` 和 `OpenContent` 使用 D-Bus UNIX FD (`h`) 带外传输字节，避免
把大负载放进消息体。数组中的 `h` 是当前消息 FD List 的索引，不是可跨消息保存的
进程文件描述符。接收方必须在方法返回期间复制或完整读取 FD。

发送方应提供从偏移 0 开始、读到 EOF 的可读快照。接收方必须：

1. 在分配或读取前校验声明大小和协商上限；
2. 限量流式读取，不信任 EOF 前的声明大小；
3. 对完整内容重新计算大小和 SHA-256；
4. 校验成功后才写入剪切板、保存或启动编辑器。

## 生命周期

发布流程：

1. 客户端调用 `Publish`，同时提交清单、预览和不可变完整快照。
2. 方法成功后 Service 接管快照生命周期，并以条目 ID 保持幂等。
3. Service 发出 `ItemAvailable`；客户端也必须在重连后调用 `ListPending`，不能只依赖
   可能错过的信号。

按需物化流程：

1. 客户端调用 `RequestContent`，方法立即返回 `transferId`。
2. Service 通过 `TransferChanged` 报告 `queued`、`waiting-for-source`、
   `transferring`，最终进入 `ready`、`cancelled`、`expired` 或 `failed`。
3. `ready` 后客户端逐个调用 `OpenContent`，验证大小与哈希。
4. 客户端调用 `Acknowledge` 报告 `accepted`、`rejected` 或实现定义结果。
5. 等待期间可以调用 `CancelTransfer`；取消和重复取消都应是幂等操作。

远端条目在完整内容物化前不得自动覆盖本地剪切板。写入后客户端以条目 ID、内容哈希
和短时间窗口抑制 owner-change 回环。

## 错误与边界

Service 应使用接口名前缀的 D-Bus 错误，例如
`io.github.guleo.ClipboardX.Sync1.Error.TooLarge`。标准尾名为：

- `UnsupportedVersion`
- `UnsupportedMimeType`
- `TooLarge`
- `Unavailable`
- `Expired`
- `NotAuthorized`
- `InvalidItem`
- `Busy`
- `Offline`

方法超时不等于任务失败：`RequestContent` 返回后，任务只以 `TransferChanged` 的终态
结束。Service 离线时客户端取消本地等待、保留预览，并在重新出现后重新协商能力、
注册设备和调用 `ListPending`。

## 安全模型

Sync1 只跨本机会话总线，不定义网络认证或端到端加密。Service 负责用户授权、设备
配对、网络加密、离线队列和远端快照删除。实现不得在日志中记录剪切板正文、认证信息
或完整敏感路径；客户端隐私模式和敏感内容策略优先于自动发布。

仓库中的 GJS 与 Python Mock Service 都只用于互操作测试，不是网络同步服务，也不应
随 GNOME Extensions 发布包安装。
