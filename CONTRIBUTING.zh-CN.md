# 参与 clipboard-x-gnome 开发

> 简体中文 · [English](CONTRIBUTING.md)

Clipboard X Gnome 目标环境是 GNOME Shell 50+ 和 GJS 1.88 或更高版本。修改 Shell UI 时只
使用 St、Clutter 和 Shell API；GTK 4/Libadwaita 只允许出现在独立设置进程中。

## 开发流程

使用两个 Shell 版本共有的接口。[兼容性指南](docs/shell-compatibility_CN.md)说明隔离的生命周期测试及其验证边界。

```sh
meson setup build -Dtarget=package
meson compile -C build
meson test -C build --print-errorlogs
meson install -C build
```

项目不使用 ESLint。对修改的 JavaScript 文件运行 `node --check`，并执行与目标行为相关的
测试；涉及公共接口或核心逻辑时运行完整 Meson 测试。为可重复的行为风险保留长期回归测试，
不为文档措辞、CSS 细节、固定图标名称或控件的常规属性编写断言。CI/Release 配置应使用
现有校验、临时脚本或隔离 dry-run 验证，不增加锁定配置格式的测试。

Shell 交互和设置窗口测试不属于 Meson 测试集，需要在隔离测试桌面中单独运行：

```sh
run_shell_check() (
  test_runtime=$(mktemp -d /tmp/clipboard-x-gnome-check-XXXXXX)
  trap 'rm -rf -- "$test_runtime"' EXIT
  export XDG_RUNTIME_DIR="$test_runtime" LIBGL_ALWAYS_SOFTWARE=1 GTK_A11Y=none NO_AT_BRIDGE=1
  unset DISPLAY WAYLAND_DISPLAY GDK_BACKEND GSETTINGS_SCHEMA_DIR
  dbus-run-session -- gnome-shell-test-tool --headless \
    --extension build/clipboard-x-gnome_<version>.zip "$1"
)
run_shell_check tests/ui/shell.smoke.js
run_shell_check tests/ui/preferences.smoke.js
```

隐私边界、搜索光标导航/取色器移动、截图取消可以复用上述函数分别运行专项测试：

```sh
run_shell_check tests/ui/privacy.smoke.js
run_shell_check tests/ui/search-picker.smoke.js
run_shell_check tests/ui/screenshot-cancel.smoke.js
```

设备图标选择器另有 GTK 集成测试，需要图形显示环境和已经配置的打包构建目录。
它使用内存设置后端，不修改宿主插件设置：

```sh
shell_libdir=/usr/lib/gnome-shell
dbus-run-session -- env GSETTINGS_BACKEND=memory GTK_A11Y=none NO_AT_BRIDGE=1 \
  GI_TYPELIB_PATH="$shell_libdir/girepository-1.0" LD_LIBRARY_PATH="$shell_libdir" \
  CBX_TEST_BUILD_DIR="$PWD/build" gjs -m tests/ui/settings-icon.integration.js
```

`shell_libdir` 需按 GNOME Shell 的实际安装目录调整，Fedora 通常为
`/usr/lib64/gnome-shell`。设置 API 需要加载该目录中的私有 typelib。

词库吞吐与内存测量使用可选 benchmark，不在普通 CI 回归中卡耗时门槛。
传入本地词库文件即可，benchmark 不会自动下载词库：

```sh
gjs -m tools/benchmark-tokenizer.js /path/to/dictionary.txt 1000
```

交付时说明已执行的检查及结果，以及未执行的检查和原因。CSS 视觉调整可以通过构建和
人工验收检查，无需新增自动化断言。

### 嵌套桌面与界面语言

`./tools/run-dev-shell.sh` 会构建、打包扩展，并使用隔离的开发配置启动嵌套 GNOME 桌面。
以英文启动时运行：

```sh
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LANGUAGE=en ./tools/run-dev-shell.sh
```

切换语言前先关闭已有的嵌套桌面。这些环境变量只影响本次开发会话，不改变宿主桌面的语言。
可以用 `locale -a` 检查已安装的 locale；脚本没有 `--lang` 参数。

## 目录结构

- `src/extension.js`、`src/prefs.js` 只作为 GNOME 规定的加载入口。
- `src/common/` 只存放被多个领域复用的基础设施。
- `src/entry/`、`clipboard/`、`sync/`、`screenshot/`、`color-picker/` 和 `ui/` 按功能领域
  组织实现；分词属于剪切板领域，位于 `src/clipboard/tokenizer/`。
- `tests/` 使用相同的领域目录；跨进程测试程序放在 `tests/fixtures/`。

同步协议及其 OpenAPI 契约由 Clipboard X Server 负责制定。协议变更应先在 Server 仓库提出并
落地，再更新本仓库的 GJS 路由、校验器与客户端兼容性测试。兼容性破坏必须创建新的 HTTP API
主版本，客户端不能反向原地改变 v1 的既有字段或语义。

## 本地化

用户可见文本使用扩展提供的 `gettext`。新增文本后运行：

```sh
meson compile -C build clipboard-x-gnome-pot
meson compile -C build clipboard-x-gnome-update-po
```

然后补齐 `po/LINGUAS` 列出的所有语言，并运行 `bash tests/i18n/coverage.sh`。
检查会验证提取的文本、gettext 格式有效性，并拒绝缺失或 fuzzy 的译文。
源码语言为英语，无需单独的英文 PO 文件。机器翻译草稿仍需母语者审校措辞。
仓库根目录的中文文档使用 `.zh-CN.md`；`docs/` 中的指南平铺存放，中文使用 `{name}_CN.md`。
各版本发布说明统一放在 `docs/release/`，分别使用 `v<version>-en.md` 和 `v<version>-cn.md`。

## 代码约定

- 生命周期资源必须由拥有者保存句柄，并在 `disable()` 或 `destroy()` 中释放。
- 不在 Shell 主线程同步读取大文件或同步解码大图片。
- 不记录剪切板正文、用户路径、服务器原始错误正文或认证数据。
- 外部命令必须使用 argv 和 `Gio.SubprocessLauncher`，禁止隐式 `sh -c`。
- 公共 API 使用上下文表达领域、成员表达动作；避免重复上下文、含糊缩写和隐藏行为。
- 新协议数据先校验类型、数量和大小，再分配或读取负载。

发布 ZIP 必须是最小运行时集合，不能包含测试、协议源码或翻译源码。

## CI 与本地打包

[CI 工作流](.github/workflows/ci.yml)会在每次推送（分支和标签）和 Pull Request 时，使用 Fedora 44 / GNOME 50 和 Fedora 45 / GNOME 51
环境检查 JavaScript 语法、使用 `--no-suite stress` 运行 Meson 普通回归测试、构建扩展 ZIP，并确认归档中只有运行时文件和编译好的
翻译。两个环境还分别运行隔离的无窗口扩展生命周期测试，只上传一份安装包。CI 只验证并保留构建产物，不发布版本。
独立的 [Release 工作流](.github/workflows/release.yml)只在推送 `v*` 标签时触发，针对标签所指的提交重新执行相同检查，
等待两个任务均成功后发布。普通分支推送和 Pull Request 不会触发发布。
压力测试保留本地运行入口，不再由 GitHub CI 执行。

仅需在本地构建发布包、不安装到桌面且不改动 Git 状态时，运行：

```sh
./tools/release.sh
```

生成的文件在 `build/release/clipboard-x-gnome_<version>.zip`，例如
`clipboard-x-gnome_1.0.5.zip`，版本号取自 Meson。脚本使用独立的 package 构建目录，检查
JavaScript 语法、运行完整 Meson 测试，并校验归档内容和版本。
