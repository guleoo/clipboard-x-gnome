# Clipboard X

Clipboard X 是面向 GNOME Shell 50 的剪切板效率扩展。它通过顶栏图标或用户设置的
快捷键打开统一面板，提供文本与图片历史、文本提取工具、外部设备同步集成、截图、
取色和调用外部图片编辑器等功能。

同步能力只包含客户端协议。扩展不会建立网络连接；设备发现、配对、认证、加密、
网络传输和离线队列由实现 [Sync1](protocol/SYNC1.md) 的独立本机 Service 负责。

## 功能

- 搜索、收藏、删除和重新复制文本或图片历史。
- 按词、句、Unicode 字素、行和分隔符拆分文本，提取 URL、邮箱、数字及标识符片段，
  并支持大小写和标题格式转换。
- 小内容立即提供完整快照；大文本使用截断预览，大图片使用缩略图，并在使用时按需
  获取原文。
- 使用 XDG Screenshot Portal 调用系统截图。
- 使用 Shell 截图 API 取色，支持 HEX、RGB、HSL 和 OKLCH。
- 从已安装图片应用中选择编辑器，或配置安全的 argv 命令模板。

## 构建与安装

需要 GNOME Shell 50、GJS、Meson、Ninja、GLib、GTK 4、Libadwaita、GdkPixbuf、
Gettext 和 7-Zip。构建发布 ZIP：

```sh
meson setup build -Dtarget=package
meson compile -C build
meson install -C build
```

产物是 `build/clipboard-x.zip`。安装后需要注销并重新登录 Wayland 会话：

```sh
gnome-extensions install --force build/clipboard-x.zip
gnome-extensions enable clipboard-x@guleo.github.io
```

开发时也可以用 `-Dtarget=local` 安装到当前用户的扩展目录，或用
`-Dtarget=system --prefix=/usr` 生成系统安装布局。不同 target 请使用不同的构建目录。

## 使用

扩展首次打开主面板或设置窗口时生成 UUID v4 `DeviceId`。它是同步身份，不会因用户
修改设备标签而改变。设备标签只是发现设备时显示的友好名称。

图片编辑器优先使用设置中选择的 Desktop Application。选择“自定义命令”时支持：

- `%u`：图片 URI；
- `%f`：本地文件路径；
- `%%`：字面量 `%`。

命令按 argv 解析，不经 `sh -c`，因此不支持管道、重定向或 Shell 展开。例如
`gradia %u`、`gimp %f` 和 `flatpak run be.alexandervanhee.gradia %u`。

截图目标取决于本机 Portal 版本。Portal v2 通常支持交互选择和全屏；窗口、区域和
活动窗口需要实现 `AvailableTargets` 的 Portal v3 后端。扩展会拒绝后端未声明的目标。

## 同步 Service

在“设置 → 同步”中填写 Service 的 Session D-Bus 名称和对象路径，然后测试连接。
默认的名称只供仓库 Mock 使用，不代表已安装真实服务。

正式 ABI、字段、FD 生命周期、状态机和安全要求见：

- [Sync1 协议说明](protocol/SYNC1.md)
- [D-Bus introspection XML](protocol/io.github.guleo.ClipboardX.Sync1.xml)
- [Mock Service 使用说明](mock-service/README.md)

手动发送是默认策略。自动发送虽然适合自行安装场景，但会在没有逐条用户操作时把
剪切板交给第三方进程，因此不应直接用于提交 GNOME Extensions 的审核版本。
自动发送可进一步限制为只有用户收藏条目后才发送；敏感内容同步仍需单独启用。

## 隐私

剪切板历史保存在用户缓存目录
`$XDG_CACHE_HOME/clipboard-x@guleo.github.io`，对象目录权限设为仅当前用户可访问。
“隐私模式”会暂停捕获；密码管理器标记的敏感内容默认只保存在内存中，同步敏感内容
默认关闭。详细的数据流、信任边界和报告方式见 [SECURITY.md](SECURITY.md)。

## 测试

```sh
meson test -C build --print-errorlogs
gnome-shell-test-tool --headless --extension build/clipboard-x.zip tests/shell.smoke.js
gnome-shell-test-tool --headless --extension build/clipboard-x.zip tests/prefs.smoke.js
```

项目不使用 ESLint；构建验收使用 Node 语法检查、GJS 测试、协议互操作测试和真实
GNOME Shell 无头会话。

完整的阶段要求与自动化证据对应关系见 [开发完成审计](docs/completion-audit.md)。

## 许可证

Clipboard X 以 [GNU GPL v3 或更高版本](LICENSE.md)发布。
