# 参与开发

Clipboard X 目标环境是 GNOME Shell 50 和 GJS 1.88 或更高版本。修改 Shell UI 时只
使用 St、Clutter 和 Shell API；GTK 4/Libadwaita 只允许出现在独立设置进程中。

## 开发流程

```sh
meson setup build -Dtarget=package
meson compile -C build
meson test -C build --print-errorlogs
meson install -C build
```

项目不使用 ESLint。提交前请对所有 JavaScript 文件运行 `node --check`，再执行完整
Meson 测试。涉及扩展生命周期、面板、剪切板、取色或设置界面的改动，还必须运行：

```sh
gnome-shell-test-tool --headless --extension build/clipboard-x.zip tests/ui/shell.smoke.js
gnome-shell-test-tool --headless --extension build/clipboard-x.zip tests/ui/preferences.smoke.js
```

## 目录结构

- `src/extension.js`、`src/prefs.js` 只作为 GNOME 规定的加载入口。
- `src/common/` 只存放被多个领域复用的基础设施。
- `src/entry/`、`clipboard/`、`sync/`、`screenshot/`、`color-picker/` 和 `ui/` 按功能领域
  组织实现；分词属于剪切板领域，位于 `src/clipboard/tokenizer/`。
- `tests/` 使用相同的领域目录；跨进程测试程序放在 `tests/fixtures/`，同步集成场景放在
  `tests/sync/integration/`。

同步协议改动必须同时更新 XML、`protocol/SYNC1.md`、GJS Mock、Python Mock 和协议
测试。兼容性破坏必须创建新的接口主版本，不能原地改变 Sync1 的既有签名或语义。

## 本地化

用户可见文本使用扩展提供的 `gettext`。新增文本后运行：

```sh
meson compile -C build clipboard-x-pot
meson compile -C build clipboard-x-update-po
```

然后补齐 `po/zh_CN.po`，并使用 `msgfmt --check` 验证。源码语言为英语；英语无需单独
PO 文件。

## 代码约定

- 生命周期资源必须由拥有者保存句柄，并在 `disable()` 或 `destroy()` 中释放。
- 不在 Shell 主线程同步读取大文件或同步解码大图片。
- 不记录剪切板正文、用户路径、Service 原始错误或认证数据。
- 外部命令必须使用 argv 和 `Gio.SubprocessLauncher`，禁止隐式 `sh -c`。
- 公共 API 使用上下文表达领域、成员表达动作；避免重复上下文、含糊缩写和隐藏行为。
- 新协议数据先校验类型、数量和大小，再分配或读取负载。

发布 ZIP 必须是最小运行时集合，不能包含 Mock Service、测试、协议源码或翻译源码。
