# 参与 clipboard-x-gnome 开发

> 简体中文 · [English](CONTRIBUTING.md)

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
gnome-shell-test-tool --headless --extension build/clipboard-x-gnome.zip tests/ui/shell.smoke.js
gnome-shell-test-tool --headless --extension build/clipboard-x-gnome.zip tests/ui/preferences.smoke.js
```

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
meson compile -C build clipboard-x-pot
meson compile -C build clipboard-x-update-po
```

然后补齐 `po/LINGUAS` 列出的所有语言，并运行 `bash tests/i18n/coverage.sh`。
检查会拒绝缺失或 fuzzy 的译文，以及图片编辑命令说明中丢失的占位符。
源码语言为英语，无需单独的英文 PO 文件。机器翻译草稿仍需母语者审校措辞。

## 代码约定

- 生命周期资源必须由拥有者保存句柄，并在 `disable()` 或 `destroy()` 中释放。
- 不在 Shell 主线程同步读取大文件或同步解码大图片。
- 不记录剪切板正文、用户路径、服务器原始错误正文或认证数据。
- 外部命令必须使用 argv 和 `Gio.SubprocessLauncher`，禁止隐式 `sh -c`。
- 公共 API 使用上下文表达领域、成员表达动作；避免重复上下文、含糊缩写和隐藏行为。
- 新协议数据先校验类型、数量和大小，再分配或读取负载。

发布 ZIP 必须是最小运行时集合，不能包含测试、协议源码或翻译源码。

## 发布版本

[发布工作流](.github/workflows/release.yml)会在每次推送和 Pull Request 时，使用 Fedora 44 / GNOME 50
环境检查 JavaScript 语法、运行完整 Meson 测试、构建扩展 ZIP，并确认归档中只有运行时文件和编译好的
翻译。Pull Request 不会触发发布。

仅需在本地构建发布包、不安装到桌面且不改动 Git 状态时，运行：

```sh
./tools/release.sh
```

生成的文件在 `build/release/clipboard-x-gnome.zip`。脚本使用独立的 package 构建目录，检查
JavaScript 语法、运行完整 Meson 测试，并校验归档内容和版本。

需要正式发布时，先把 `meson.build` 和 `package.json` 的版本号同步改为 `X.Y.Z`，提交所有改动，
再运行 `./tools/release.sh --publish`。脚本会额外推送当前分支、创建带注释的 `vX.Y.Z` 标签并
推送标签。如果有多个远端，可用 `--remote NAME` 指定。发布要求工作区干净、Git 认证可用；
脚本不会强制推送，也不会覆盖远端已有的同名标签。

标签、两处项目版本和生成的 `metadata.json` 中的 `version-name` 必须一致，否则工作流会在发布前
停止。标签构建通过后，会创建附带 `clipboard-x-gnome.zip` 的 GitHub Release。不要自行设置由
GNOME 扩展网站管理的数字型 `metadata.version`。

向 [GNOME Shell Extensions 插件商店](https://extensions.gnome.org/)送审是可选的。需要启用时，
把仓库 Actions 变量 `EGO_UPLOAD_ENABLED` 设为 `true`，并设置有权上传该扩展的账号所对应的
仓库密钥 `EGO_USER`、`EGO_PASSWORD`。标签构建通过后，工作流会用 `gnome-extensions upload`
提交同一个经过检查的 ZIP；密码通过标准输入传递，CLI 的登录令牌缓存只保留在临时 CI 环境。
不设置该变量就不会上传；开启后缺少任一密钥，上传任务会明确失败。上传成功只代表**已送审**，
不代表已经通过审核或在商店中可见。
