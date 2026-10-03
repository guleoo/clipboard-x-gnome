# Clipboard X 1.0.0

## English

Clipboard X 1.0.0 is the first stable release of `clipboard-x-gnome`. It brings clipboard history,
token selection, quick phrases, screenshots, and color picking together in a GNOME top-bar panel,
with optional synchronization through a self-hosted `clipboard-x-server`.

### Highlights

- **Text and image history**: search saved entries, pin important content, and reuse it by mouse or
  keyboard. Local history is stored in the user data directory and organized by device.
- **Token selection**: select words or ranges while preserving punctuation, whitespace, links, and
  numbers. Copy, paste, or simulate typing the selected result. Chinese and Japanese can combine the
  system segmenter with user-imported or explicitly downloaded dictionaries.
- **Quick phrases**: save frequently used text in a dedicated, local-only panel.
- **Screenshots and image editing**: capture through the system Screenshot Portal. Cancelling a
  screenshot is silent. Open images with a user-configured editor command, such as `gradia %i`.
- **Color picking**: copy colors as HEX, RGB, HSL, or OKLCH. Arrow keys move the sampling point one
  screenshot pixel at a time, including on scaled displays.
- **Optional device synchronization**: connect to `clipboard-x-server` with a device API key and
  Channel. Send manually or automatically, exchange previews first for large content, and fetch
  originals on demand with transfer progress and size/hash verification. No separate local service
  is required.
- **Configurable panels and shortcuts**: adjust panel dimensions, position, accent color, visible
  actions, and keyboard shortcuts. Right Arrow leaves an empty search field or one with the cursor
  at the end; text selections and modifier-key editing retain normal behavior.
- **Privacy and localization**: pause capture with privacy mode, exclude applications, and discard
  sensitive marked content or retain it only in memory. Sensitive content is never synchronized.
  The interface includes English and 25 translated languages.

### Requirements and installation

This release declares support for **GNOME Shell 50**, with **GJS 1.88 or later**. Use a Wayland session
for the complete screenshot, color picker, and simulated-input experience.

The release archive is `clipboard-x-gnome_1.0.0.zip`. From the directory containing the downloaded ZIP:

```sh
gnome-extensions install --force clipboard-x-gnome_1.0.0.zip
gnome-extensions enable clipboard-x@guleoo.github.io
```

If GNOME Shell does not recognize the extension or continues running the previous code, log out and
back in, then enable it in Extensions or Extension Manager. Global shortcuts are unassigned by default;
configure the panel shortcut in **Preferences → Shortcuts → Global**.

For source builds and the full usage guide, see the [README](https://github.com/guleoo/clipboard-x-gnome/blob/v1.0.0/README.md).

### Important limitations

- Synchronization is disabled by default and requires a separately deployed `clipboard-x-server`.
  The server can read uploaded content; this is not end-to-end encryption. HTTPS provides transport
  encryption, while HTTP transmits credentials and content without it.
- Deleting an entry locally does not delete it across the Channel. Server-originated removal events
  do propagate to clients.
- Simulated typing is less reliable than normal paste. Modifier keys cancel remaining input, but
  ordinary physical keystrokes cannot be reliably detected when another Wayland client has focus.
  Avoid keyboard input during typing and prefer paste for long or exact content.
- No image editor or third-party dictionary is bundled. The editor command is empty by default;
  configure one before editing. Network dictionaries download only when explicitly added or refreshed.
- GNOME extension-store submission and approval are separate from publishing a GitHub Release.

See [Security and privacy](https://github.com/guleoo/clipboard-x-gnome/blob/v1.0.0/SECURITY.md) for the data and trust boundaries.

## 简体中文

Clipboard X 1.0.0 是 `clipboard-x-gnome` 的首个正式版本。它将剪切板历史、分词选择、
快捷语句、截图和取色整合到 GNOME 顶栏面板中，也可选择通过自建的 `clipboard-x-server`
同步设备之间的剪切板内容。

### 主要功能

- **文本与图片历史**：搜索保存的条目、固定重要内容，通过鼠标或键盘复用。
  本地历史保存在用户数据目录中，按设备划分存储。
- **分词选择**：点选词语或连续选择，保留标点、空白、链接和数字；可复制、粘贴或模拟
  输入选定结果。中文和日文支持将系统分词器与用户导入或主动下载的词库组合使用。
- **快捷语句**：在独立面板中保存常用文字，仅存放在本机。
- **截图与图片编辑**：通过系统 Screenshot Portal 截图，主动取消不会弹出错误提示。
  图片可使用用户配置的命令拉起编辑器，例如 `gradia %i`。
- **屏幕取色**：将颜色复制为 HEX、RGB、HSL 或 OKLCH。使用方向键逐个截图像素移动
  采样点，在缩放显示下也保持每次移动一格。
- **可选设备同步**：通过设备 API Key 与 Channel 连接 `clipboard-x-server`，支持手动或
  自动发送。大内容先交换预览，原文按需获取，提供传输进度与大小、哈希校验，无需额外
  运行本地 Service。
- **面板与快捷键配置**：调整面板尺寸、位置、主题色、显示的操作按钮和快捷键。
  搜索框为空或光标在末尾时，右方向键可移到右侧按钮；选区和带修饰键的文字编辑保持
  正常行为。
- **隐私与多语言**：隐私模式暂停记录，支持排除应用；带敏感标记的内容可丢弃或仅留在
  内存中，禁止同步。界面提供英文及 25 种翻译语言。

### 环境要求与安装

本版本声明支持 **GNOME Shell 50**，需要 **GJS 1.88 或更高版本**。
完整的截图、取色和模拟输入体验需要 Wayland 会话。

发布包名称为 `clipboard-x-gnome_1.0.0.zip`。在下载的 ZIP 所在目录中执行：

```sh
gnome-extensions install --force clipboard-x-gnome_1.0.0.zip
gnome-extensions enable clipboard-x@guleoo.github.io
```

如果 GNOME Shell 尚未识别扩展，或仍运行旧代码，请注销并重新登录，再通过“扩展”或
“扩展管理器”启用。全局快捷键默认未分配，可在**设置 → 快捷键 → 全局**配置面板快捷键。

源码构建与完整使用说明见 [README](https://github.com/guleoo/clipboard-x-gnome/blob/v1.0.0/README.zh-CN.md)。

### 注意事项与已知限制

- 同步默认关闭，需要单独部署 `clipboard-x-server`。服务器可以查看已上传内容，
  这不是端到端加密；HTTPS 提供传输加密，HTTP 不加密传输凭据与内容。
- 本地删除条目不会在整个 Channel 中删除它；服务端发出的删除事件会同步到客户端。
- 模拟输入不如正常粘贴可靠。按下修饰键会中止剩余输入，但其他 Wayland 应用拥有焦点时，
  无法可靠检测普通物理按键。模拟期间不要操作键盘，长文本或要求精确的内容优先使用粘贴。
- 插件不捆绑图片编辑器或第三方词库。图片编辑命令默认为空，使用前需要配置；
  网络词库仅在用户主动添加或刷新时下载。
- 发布 GitHub Release 不等于已在 GNOME 插件商店上架，送审与审核是独立流程。

数据流与信任边界见[安全说明](https://github.com/guleoo/clipboard-x-gnome/blob/v1.0.0/SECURITY.zh-CN.md)。
