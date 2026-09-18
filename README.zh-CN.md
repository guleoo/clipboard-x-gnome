<div align="center">

# Clipboard X

**面向 GNOME Shell 的本地优先剪切板工作台。**

历史记录 · 分词选择 · 快捷语句 · 设备同步 · 截图 · 取色

[English](README.md) · [简体中文](README.zh-CN.md)

[![GNOME Shell 50](https://img.shields.io/badge/GNOME%20Shell-50-4A86CF?logo=gnome&logoColor=white)](https://www.gnome.org/)
[![GJS](https://img.shields.io/badge/GJS-ES%20Modules-F7DF1E?logo=javascript&logoColor=111)](https://gjs.guide/)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-663399)](LICENSE.md)

</div>

Clipboard X 把 GNOME 顶栏扩展成一个紧凑的剪切板工作台：搜索和复用文本或图片，只选择
句子里真正需要的词，保存常用语句，截图、取色，并可选择通过自己配置的服务器在设备间
共享剪切板快照。

不配置同步时，它仍然是一套完整的本地工具。历史记录和快捷语句保存在本机；只有用户
配置并启用兼容服务器后，剪切板同步才会启动。网络词库也只会在用户主动添加或刷新时下载。

> [!IMPORTANT]
> Clipboard X 当前面向 **GNOME Shell 50**。扩展包元数据不支持更早的 Shell 版本。

## 功能概览

| 剪切板 | 文本工具 | 捕获工具 | 多设备 |
| --- | --- | --- | --- |
| 搜索文本与图片 | 单独选择每个词元 | 调用系统截图门户 | 按设备标识远端条目 |
| 固定重要条目 | 保留链接、邮箱、数字与标点 | 提取 HEX、RGB、HSL、OKLCH 颜色 | 手动或自动发送 |
| 复制、粘贴或模拟输入 | 添加本地或网络词库 | 调用外部图片编辑命令 | 需要时才获取大体积原文 |
| 保存可复用的快捷语句 | 完整键盘导航与连选 | 配置全局快捷键 | 显示精确上传/下载进度 |

### 本地优先的历史记录

剪切板内容会成为不可变的本地快照，并按来源设备组织。固定条目不受历史数量限制；隐私
模式会暂停记录；密码管理器标记的内容默认只保存在内存中。面板宽高、条目数量、主题色、
操作图标、打开位置和焦点行为均可配置。

### 为选词而设计的分词面板

任意文本条目都可以进入分词面板，选择一个或多个词后直接复制、粘贴或模拟输入。
Clipboard X 能识别 URL、邮箱、结构化数字、多语言单词、空白与标点。基础分词使用系统
`Intl.Segmenter`；中文和日文可以同时合并多个用户词库。

### 可见、按需的同步

少量内容完整发送；大量文本先发送截断预览，大图片先发送缩略图，只有其他设备真正使用
时才物化原文。传输采用流式 I/O，校验大小与 SHA-256，并在面板中显示精确字节进度。
同步直接由扩展完成，不需要额外安装本地 Service。

## 安装

### 环境要求

- GNOME Shell 50、GJS 1.88 或更高版本；
- Meson、Ninja、GLib、GTK 4、Libadwaita、GdkPixbuf、Gettext 和 7-Zip；
- 完整的截图、取色和模拟输入体验需要 Wayland 会话。

构建发布包：

```sh
meson setup build -Dtarget=package
meson compile -C build
meson install -C build
```

安装生成的 `build/clipboard-x.zip`：

```sh
gnome-extensions install --force build/clipboard-x.zip
gnome-extensions enable clipboard-x@guleo.github.io
```

Wayland 下的 GNOME Shell 无法完整热重载扩展代码。首次安装或覆盖已有版本后，如果新版本
没有立即生效，请注销并重新登录。

## 使用 Clipboard X

### 1. 打开并配置面板

点击顶栏图标打开 Clipboard X。全局快捷键默认留空；如果需要，请打开扩展设置，在
**快捷键 → 全局 → 打开剪切板面板**中录入。再次按下同一个面板快捷键即可关闭面板。

第一次打开面板或设置时，Clipboard X 会生成 UUID v4 `DeviceId`，作为稳定的同步身份。
用户可编辑的设备 Tag 与图标只用于友好展示，不会改变设备身份。

### 2. 复用剪切板历史

点击条目，或聚焦后按 Enter，即可复制内容。根据条目类型，每行还会提供分词或图片编辑、
固定、同步和删除操作。按 `Ctrl+F` 可以聚焦搜索框。

默认的上下文快捷键如下：

| 剪切板历史中 | 操作 |
| --- | --- |
| `v` | 粘贴当前条目 |
| `p` | 固定或取消固定 |
| `Delete` | 从本机历史中删除 |
| `'` | 模拟键盘输入文本 |
| `Ctrl` + 点击 / `Ctrl+Enter` | 不复制，改为模拟输入 |

所有快捷键都可以在设置中修改或禁用。

### 3. 选择一句话中的部分内容

点击文本条目的分词按钮。方向键用于移动焦点，点击或拖动可以连续选择词元，
`Shift` + 方向键用于键盘连选。默认按 `c` 复制、`v` 粘贴、`'` 模拟输入选择结果。

中文或日文环境可以打开**设置 → 剪切板 → 词库**，启用系统分词器、导入 UTF-8 词库，
或添加 HTTP/HTTPS 网络词库位置。词库每行写一个词，后面可以跟词频：

```text
# locale: zh
# name: 团队术语
注销密钥 90
图片编辑 80
```

词库文件保存在 `$XDG_DATA_HOME/clipboard-x/dictionaries`。发布包不会捆绑第三方词库，
安装、启动或打开面板时也不会静默下载词库。

### 4. 保存快捷语句

从面板打开**快捷语句**，点击 `+`，输入内容并按 Enter 确认。快捷语句仅保存在本机，
文件位置为 `$XDG_DATA_HOME/clipboard-x/quick-phrases.json`。

### 5. 截图、取色与图片编辑

- **截图**调用 XDG Screenshot Portal，可用的截图目标取决于本机 Portal 后端。
- **取色器**从屏幕取色，并写入配置的 HEX、RGB、HSL 或 OKLCH 表示。
- **图片编辑**调用**设置 → 截图 → 图片编辑**中配置的命令。

图片编辑命令按 argv 解析，不会交给 `sh -c`。它支持 `%u` 表示图片 URI、`%f` 表示本地
路径、`%i` 表示从标准输入读取图片字节、`%%` 表示字面量百分号。例如：

```text
gradia %i
gimp %f
flatpak run be.alexandervanhee.gradia %u
```

出于安全性和可预测性考虑，不支持管道、重定向或 Shell 展开。

## 同步设备

Clipboard X 使用版本化 HTTP API 连接用户选择的中心服务器。服务器是可以读取内容的存储
和管理平台，并非端到端加密或无法查看正文的盲中转站；服务器管理员可以查看已上传内容。

连接一台设备：

1. 在兼容服务器中为设备分配独立 API Key，并把设备加入一个 Channel。
2. 打开**设置 → 同步**。
3. 输入服务器地址和 API Key，应用设置，刷新 Channel 并选择一个活动 Channel。
4. 启动同步并测试连接。
5. 保持默认的**手动**发送模式，通过条目同步按钮发送；或明确改为**自动**发送。

地址可以使用 HTTP 或 HTTPS；省略协议时默认为 HTTP。HTTP 会在网络中明文发送认证信息和
内容，需要链路机密性时应使用 HTTPS 或可信的私有网络。

服务器地址、API Key 和活动 Channel 保存在 `$XDG_DATA_HOME/clipboard-x/sync.json`；
各 Channel 的增量 cursor 单独保存在 `sync-state.json`。中途加入 Channel 的新设备会从
服务器保留的 Channel 变化历史开始获取元数据与预览，大体积原文仍按需加载。

> [!NOTE]
> 当前在扩展中删除条目，只会删除本设备的本地历史副本，不会请求从整个 Channel 删除。
> 服务端发出的删除事件则会同步到客户端。

兼容服务器的详细要求见[同步协议](docs/zh-CN/sync-protocol.md)，压力模型见
[同步性能与压力测试](docs/zh-CN/sync-performance-testing.md)。

## 模拟键盘输入

模拟输入适用于目标应用无法正常粘贴的场景，但它并不等同于粘贴。Clipboard X 会等待
触发动作的修饰键松开；输入过程中检测到 Ctrl、Alt、Shift、Super、Meta 或 Hyper 后会
取消剩余内容。GNOME Shell 无法可靠获得发送给其他 Wayland 客户端的普通物理按键，因此
字母和数字仍可能与模拟内容交错。

模拟输入结束前请不要操作物理键盘。对于长文本、敏感内容或要求完全准确的内容，应优先
使用普通剪切板粘贴。

## 数据与隐私

| 数据 | 默认位置 |
| --- | --- |
| 历史记录 | `$XDG_DATA_HOME/clipboard-x/history/<DeviceId>` |
| 快捷语句 | `$XDG_DATA_HOME/clipboard-x/quick-phrases.json` |
| 词库 | `$XDG_DATA_HOME/clipboard-x/dictionaries` |
| 同步连接信息 | `$XDG_DATA_HOME/clipboard-x/sync.json` |
| 同步 cursor | `$XDG_DATA_HOME/clipboard-x/sync-state.json` |

本地历史没有静态加密，也不是密码保险库。启用同步或处理敏感内容前，请阅读
[安全与隐私说明](SECURITY.zh-CN.md)。

## 开发与参与贡献

欢迎参与 Clipboard X：报告 Bug、提交聚焦的修复、改进 UI、补充协议测试、完善文档，或
提供经过认真校对的翻译，都很有价值。

1. 阅读[参与开发](CONTRIBUTING.zh-CN.md)和[中文文档索引](docs/zh-CN/README.md)。
2. 较大的行为或协议变更应先创建 Issue，讨论并明确范围。
3. 保持改动聚焦；每次行为变更都要新增或更新测试。
4. 提交 Pull Request 前运行完整测试，并主动 Review 自己的 Diff。
5. 公开行为发生变化时，同时更新英文与简体中文文档。

最快的交互式开发方式是：

```sh
tools/run-dev-shell.sh
```

脚本会完成构建和打包，然后在独立的 Mutter Devkit 会话中启动扩展，使用隔离的 XDG 数据
和设置，不需要注销宿主桌面。

提交代码前运行：

```sh
meson test -C build --print-errorlogs
meson test -C build --suite stress --print-errorlogs
gnome-shell-test-tool --headless --extension build/clipboard-x.zip tests/ui/shell.smoke.js
gnome-shell-test-tool --headless --extension build/clipboard-x.zip tests/ui/preferences.smoke.js
```

项目不使用 ESLint。目录结构、本地化流程、代码约定和发布边界见
[参与开发](CONTRIBUTING.zh-CN.md)。安全问题请按照[安全说明](SECURITY.zh-CN.md)中的私密
渠道报告，不要创建公开 Issue。

## 文档

- [中文文档索引](docs/zh-CN/README.md)
- [同步协议（HTTP API v1）](docs/zh-CN/sync-protocol.md)
- [UI 开发指南](docs/zh-CN/ui-architecture.md)
- [同步性能与压力测试](docs/zh-CN/sync-performance-testing.md)
- [安全与隐私](SECURITY.zh-CN.md)
- [参与开发](CONTRIBUTING.zh-CN.md)

## 许可证

Clipboard X 是以 [GNU GPL v3 或更高版本](LICENSE.md)发布的自由软件。
