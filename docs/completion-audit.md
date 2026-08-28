# 开发完成审计

本文把 `.codex/development-plan.md` 的要求对应到当前仓库中可重复运行的证据。未完成项
明确列出，不用旧架构测试或 Mock 代替真实服务器互操作。

## 已有证据

### 工程与生命周期

- `meson.build` 提供 local、system、package target，并构建 metadata、Schema、CSS 和翻译。
- `tests/ui/shell.smoke.js` 覆盖扩展 enable/disable、面板、剪切板、同步 UI 注入、Portal、
  取色器、快捷键和销毁后的资源释放。
- `tests/ui/preferences.smoke.js` 覆盖 GTK 4/Libadwaita 设置窗口加载。
- `tools/run-dev-shell.sh` 使用隔离的 XDG 目录运行嵌套 GNOME Shell，供人工 UI 验收。

### 本地剪切板与文本工具

- `tests/clipboard/history/` 覆盖按 DeviceId 分区的稳定数据目录、对象校验、Pin 排序、迁移、
  删除和压力场景。
- `tests/clipboard/tokenizer/` 覆盖中文、英文、韩文、日文及其他已支持语言，包含 URL、邮箱、
  数字、标点、重复句和用户词库。
- `tests/clipboard/terminal/` 覆盖模拟键盘序列和检测真实按键后的暂停。
- `tests/ui/focus-grid.test.js` 与 `tests/ui/panel-manager.test.js` 覆盖面板内键盘焦点和现场恢复。

### 截图、编辑器和取色

- `tests/screenshot/tools.test.js` 覆盖 Portal 目标协商、取消、拒绝、超时、URI 以及安全 argv
  命令模板。
- `tests/color-picker/color.test.js` 覆盖坐标缩放和 HEX、RGB、HSL、OKLCH 格式。
- 真实 Portal 的交互选择仍由人工 GNOME 会话验收，自动测试不替用户完成系统授权界面。

### 插件内 HTTP 同步

- 正式协议位于 `docs/HTTP1.md`，路由集中在 `src/sync/http/routes.js`。
- `tests/sync/protocol.test.js` 覆盖 API 版本、状态、Channel、清单、预览、变化、Transfer 和 Work
  的 JSON 边界。
- `tests/sync/http-client.test.js` 覆盖 HTTP/HTTPS 地址规范化、反向代理前缀、凭据/查询拒绝、
  路径 segment 编码和结构化请求。
- `tests/sync/configuration-store.test.js` 覆盖服务器地址、API Key、活动 Channel、每 Channel
  changes cursor 与 work cursor 的持久化。
- `tests/sync/transfers.test.js` 覆盖陈旧进度抑制和终态不会被本地时间戳遮蔽。
- `tests/sync/client.test.js` 使用注入的 HTTP Transport 覆盖认证启动、设备资料、Channel、游标
  保存、两阶段小文本发布、精确字节和销毁时 abort。
- `tests/sync/http-client.test.js` 还会把响应流写入临时对象，验证大小、SHA-256、精确进度和
  原子落盘；异步输出会处理部分写入，不假设单次写调用完成整个分块。
- 2026-08-25 的独立 GJS/libsoup 3 基准验证 256 MB 流式上传不会构造同体积 JS Buffer；
  详细数字记录在开发计划“性能基线”。

### 本次完整回归

- `meson compile -C build-devkit` 通过。
- `meson install -C build-devkit` 成功生成最小发布 ZIP；归档包含新的 `sync/http`、协议校验
  与传输跟踪代码，不包含已删除的 Service、Mock 或 Sync1 文件。
- Meson 27 项测试中 26 项在受限沙盒内直接通过；唯一的图片存储测试因为沙盒禁止
  GdkPixbuf/Glycin 的 D-Bus 编码调用而失败，同一测试在宿主环境单独运行通过。
- 同步压力套件新增 `sync-stress` 和 `sync-stream-stress`：固定放大 10 倍的控制面负载，
  以及 80 MiB 真实 Gio 流式对象；两项在本次回归中通过。
- 全部 `src/`、`tests/` JavaScript 通过 `node --check`，Schema 严格检查和全部 PO 的
  `msgfmt --check` 通过。
- GNOME 50 的 Preferences 冒烟测试在隔离 Session Bus 中通过，直连同步设置页可以加载；
  测试环境仍会报告缺失日历库、AT-SPI systemd unit 等与扩展无关的系统警告。

## 尚未完成的证据

- 中心服务器 `/api/v1` 尚未实现，因而还没有真实网络互操作测试。
- 大文本/大图片跨两个真实设备的 content request → source work → upload → download 全链路
  尚未验收。
- 来源离线、服务器重启、对象过期、取消竞态、重复请求幂等和恶意响应需要服务器夹具后测试。
- 完整 Shell 冒烟测试已经启动，但在进入同步生命周期断言前，被与本次同步改动无关的
  既有“文字垂直偏移”断言阻断；本次未修改对应 UI/CSS，需作为独立 UI 回归处理。

## 可重复验收命令

```sh
meson setup build -Dtarget=package
meson test -C build --print-errorlogs
meson install -C build
gnome-shell-test-tool --headless --test-iters 3 \
  --extension build/clipboard-x.zip tests/ui/shell.smoke.js
LC_ALL=zh_CN.UTF-8 LANGUAGE=zh_CN CLIPBOARD_X_EXPECT_CHINESE=1 \
  CLIPBOARD_X_TRANSLATION_ONLY=1 \
  gnome-shell-test-tool --headless --extension build/clipboard-x.zip tests/ui/shell.smoke.js
gnome-shell-test-tool --headless --extension build/clipboard-x.zip tests/ui/preferences.smoke.js
```

在仅有虚拟显示器的环境中，如果 Mutter 能枚举外部 selection MIME 却无法完成 transfer，
可以设置 `CLIPBOARD_X_SKIP_EXTERNAL_SOURCES=1` 只跳过外部 Wayland/XWayland 来源；扩展内部
文本、图片、分词、同步 UI 和生命周期用例仍必须运行。
