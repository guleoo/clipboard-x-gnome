# GNOME Extensions 发布说明草稿

## 简短说明

Clipboard history, text extraction tools, color picking and screenshots, with optional integration
for a separately installed synchronization service.

## 完整说明

Clipboard X adds a compact panel for searching, favoriting and reusing text and image clipboard
history. It includes word, sentence, line, URL, email, number and identifier extraction; a desktop
color picker; and screenshots through the system Screenshot Portal. Screenshots and local images can
be opened in an image editor explicitly selected by the user.

This extension reads clipboard content to build local history. Content is stored in the user's cache
according to the configured retention, size, private-mode and sensitive-content policies. Clipboard X
does not contain a network client or cloud backend. When the user explicitly chooses “Send to sync
service”, it passes the selected immutable snapshot over the local Session D-Bus to a separately
installed, user-configured Sync1 service. That service is responsible for pairing, authentication,
encryption, networking and remote retention.

No keyboard shortcut is assigned by default. The extension does not bundle executables, the Mock
Service, or an image editor.

## 审核前检查

- 审核构建只保留手动发送；隐藏或移除自动发送选项。
- `metadata.json` 的 description 与本说明都声明剪切板访问及第三方 Service 数据流。
- 默认快捷键为空。
- ZIP 中只包含扩展 JavaScript、CSS、metadata、Schema 和编译后的翻译。
- 不捆绑 Mock、网络服务、二进制或外部编辑器。
- 在目标 GNOME Shell 50 版本重新执行 enable/disable 与设置窗口测试。
