# 开发完成审计

本文件把 `.codex/development-plan.md` 的阶段要求映射到当前实现和可重复运行的证据。
它不是以“现有测试为准”缩小范围；每项证据都必须直接覆盖对应行为。

## 阶段 0：协议与技术验证

- Sync1 正式 ABI 位于 `protocol/io.github.guleo.ClipboardX.Sync1.xml`，字段和生命周期见
  `protocol/SYNC1.md`。
- `tests/sync/protocol.test.js` 验证所有数据操作都携带 DeviceId，而 Device Tag 只出现在
  `RegisterDevice`。
- `tests/run-sync-integration.sh` 对 GJS 和 Python 两个独立 Mock 执行双向 UNIX FD、
  发布、预览、按需获取、取消、确认和重连。
- `tests/screenshot/tools.test.js` 覆盖 Screenshot Portal v2/v3 协商、成功、拒绝、取消、超时、
  缺失 URI 和重复请求，并实际启动安全 argv 测试进程。
- `tests/screenshot/tools.test.js` 覆盖原生命令、Flatpak argv、Unicode/空格/引号、`%u`、`%f`、
  `%%`、无占位符和非法占位符。

## 阶段 1–2：工程、生命周期和界面

- `meson.build` 提供 `local`、`system`、`package` 三种 target，并构建 metadata、Schema、
  CSS 和 Gettext。
- `tests/ui/shell.smoke.js` 在真正的嵌套 GNOME Shell 50 中验证面板鼠标开关、搜索框键盘
  焦点、搜索与三按钮同行布局、浮动 Tooltip、动态显隐、用户快捷键、设置生效、重复
  enable/disable、锁定/解锁和进程暂停/恢复。
- 同一测试保留旧对象引用，确认禁用后 selection/settings 信号、快捷键、D-Bus 名称
  watch、idle source、传输 waiter 和 modal grab 都已释放。
- `tests/ui/preferences.smoke.js` 从扩展打开真实 GTK 4/Libadwaita 设置窗口；窗口按剪切板、同步、
  取色器、截图和快捷键划分五页，设备类型使用图标工厂，传输尺寸以 KiB/MiB 展示。

## 阶段 3：本地剪切板

- `tests/ui/shell.smoke.js` 分别使用 `wl-copy` 和 GTK 3 X11 客户端产生真实 Wayland 与
  XWayland 剪切板所有者，验证文本捕获；另验证图片捕获和异步缩略图。
- 同一测试覆盖搜索、收藏/取消收藏、删除、清空但保留收藏、重新激活、程序化写入
  回环抑制、隐私模式和重启持久化。
- `tests/clipboard/storage.test.js` 覆盖私有目录权限、敏感内容不落盘、并发保存顺序、越界路径、
  非法/篡改对象、远端预览回收和按比例异步缩略图。

## 阶段 4：文本处理

- `src/clipboard/tokenizer/processors.js` 先识别 URL、邮箱和结构化数字，再使用 `Intl.Segmenter` 产生
  自然词元，并根据源文本位置组合所选内容。
- `tests/clipboard/tokenizer/processors.test.js` 使用中英混合文本、URL 和数字验证特殊词元不被拆散、选择顺序和
  间隔保持正确。
- `tests/ui/shell.smoke.js` 验证点击条目分词按钮会在当前小面板切换视图、逐词选择会实时
  更新结果，并能返回历史列表；超过交互大小上限时明确拒绝。

## 阶段 5–6：同步与按需物化

- `tests/sync/integration/client.js` 覆盖 DeviceId 首次生成与稳定、Unicode Tag 更新但不
  更换 ID、设备图标注册、设备目录、状态获取、增量 cursor、幂等发布/确认/取消、
  预览获取、完整内容物化和不支持 MIME。
- `tests/sync/integration/policy.js` 让 Mock 声明更小的条目/预览上限和 MIME 集，验证
  实际交集与 Unicode 安全截断。
- `tests/sync/integration/large.js` 真实传输 10 MiB 文本和 50 MiB 图片：首次只有截断
  文本或缩略图语义，用户物化后再验证完整大小与 SHA-256。
- `tests/sync/integration/retry.js` 验证快照过期显示失败且第二次请求可以恢复；
  `tests/sync/integration/offline-transfer.js` 验证传输中 Service 消失会立即失败而非卡住。
- `tests/sync/integration/malformed.js` 验证非法信号、路径型 ID 和待处理列表不能越过
  客户端边界；重连压力测试连续完成五次 Service 退出/出现。
- `tests/ui/shell.smoke.js` 覆盖图片手动发送入口、Pin 限定自动发送、敏感内容默认拒绝、
  设备来源图标、预览/失败/就绪状态、按条目精确进度环、等待、过期和取消 UI，以及
  下载内容的离线本地恢复。

## 阶段 7：截图与编辑器

- Portal Request/Response 和编辑器 argv 的边界由 `tests/screenshot/tools.test.js` 覆盖。
- `tests/ui/shell.smoke.js` 注入确定性的 Portal URI，执行“截图 → 历史 → 剪切板 → 外部
  编辑器”完整管线，也验证关闭历史记录时不会被 owner-change 重新捕获。
- 同一测试验证刚捕获的图片在后台保存尚未发生前也能立即编辑，以及已下载远端原图
  在 Service 离线时从本地缓存恢复；缩略图从未用于复制或编辑原图。

## 阶段 8：取色器

- `tests/color-picker/color.test.js` 验证 2× 缩放、舞台边界、HEX/RGB/HSL/OKLCH。
- `tests/ui/shell.smoke.js` 在 Shell 舞台获取实际纹理和 modal grab，验证逐像素键盘移动、
  取色写入历史、Escape 取消、扩展禁用时强制关闭和再次启用。
- 取色器每次打开都重新截取完整 stage，坐标按 Shell 返回的纹理 scale 映射；overlay
  绑定 stage 尺寸，因此不缓存显示器布局，显示器变化不会复用旧坐标或纹理。

## 阶段 9：可靠性、安全与性能

- 所有 Service 字典、数量、UUID、MIME、大小、哈希、delivery、FD 索引和状态进入
  缓存或 UI 前验证；未知传输和无限列表有显式上限。
- `tests/clipboard/stress.test.js` 在 10 秒门槛内构造 10 MiB 文本、50 MiB 图片元数据，并对
  10,000 条历史执行首次和缓存搜索基准；主面板只构建用户配置的最大显示条目数。
- Shell 测试连续写入 50 次剪切板；同步测试连续重启 Service 五次；禁用审计确认不再
  持有读取、发布或接收资源。
- `SECURITY.md` 记录数据流和信任边界；日志测试所用恶意 Service 错误不会把正文或
  路径写进扩展日志。

## 阶段 10：发布

- `po/clipboard-x.pot` 和 `po/zh_CN.po` 提供英语源码与完整简体中文翻译；中文 Shell
  测试确认 MO 被实际加载。
- `tools/package.sh` 从临时 staging 白名单创建全新 ZIP，排除 Mock、测试、协议源码、
  PO/POT 和开发依赖。
- 用户说明、Service 实现说明、安全模型、贡献指南和 EGO 描述分别位于 `README.md`、
  `protocol/SYNC1.md`、`mock-service/README.md`、`SECURITY.md`、`CONTRIBUTING.md` 和
  `docs/ego-description.md`。

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

在仅有虚拟显示器的环境中，如果 Mutter 能枚举 `wl-copy` MIME 却无法完成 selection
transfer，可设置 `CLIPBOARD_X_SKIP_EXTERNAL_SOURCES=1` 运行 UI/生命周期回归，并在正常
Wayland 会话单独保留外部来源用例；该开关不会跳过扩展内部的文本和图片剪切板管线。

真实 Portal 的交互选择和用户实际选择的生产 Sync1 Service 涉及用户授权与外部实现，
不能由仓库测试替用户确认；仓库分别验证 Portal 协议/扩展后续管线和两个独立 Mock 的
Sync1 ABI。它们不改变扩展自身阶段的完成边界。
