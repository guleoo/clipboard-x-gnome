# Clipboard X

Clipboard X 是面向 GNOME Shell 50 的剪切板效率扩展。它通过顶栏图标或用户设置的
快捷键打开统一面板，提供文本与图片历史、词元选择式分词、外部设备同步集成、截图、
取色和调用外部图片编辑器等功能。

同步由扩展内的 HTTP 客户端直接完成。用户配置自己的中心服务器地址、设备 API Key 和
Channel；扩展使用流式上传、下载与按需物化控制大内容的内存和主线程开销，不需要额外
安装或运行本机同步 Service。

## 功能

- 搜索、Pin、删除和重新复制文本或图片历史；每个条目在右侧提供固定操作区。
- 在当前小面板中把文本拆成可逐个选择的词元，并完整保留 URL、邮箱和结构化数字。
- 支持导入任意语言的本地词库；按当前 GNOME 显示语言自动选择，未匹配时回退系统分词器。
- 搜索框与截图、取色、同步三个紧凑按钮位于同一行；暂停记录、清理和设置位于底部。
- 面板宽度、历史区域高度和最大显示条目数可配置；可选择每次返回历史主页，或保留分词现场。
- 多设备历史出现时显示用户配置的设备类型图标；图标悬停或键盘聚焦时显示浮动 Tooltip。
- 小内容立即提供完整快照；大文本使用截断预览，大图片使用缩略图，并在使用时按需
  获取原文。
- 上传与下载都使用可恢复的任务 ID，并在对应条目上显示精确字节进度环。
- 使用 XDG Screenshot Portal 调用系统截图。
- 使用 Shell 截图 API 取色，支持 HEX、RGB、HSL 和 OKLCH。
- 从已安装图片应用中选择编辑器，或配置安全的 argv 命令模板。
- 设置窗口按剪切板、同步、取色器、截图和快捷键划分五个页面；快捷键通过直接按键录入。

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

分词词库统一保存在 `$XDG_DATA_HOME/clipboard-x/dictionaries`。设置中的“剪切板 → 词库”
可以导入不超过 8 MB、15 万词条的 UTF-8 文本词库，每行写一个词，后面可选跟随词频。词库可以用头部声明语言和名称：

```text
# locale: ja
# name: My Japanese dictionary
秘密鍵 90
画像編集 80
```

没有 `# locale` 时使用导入界面下拉选择的语言，默认选中当前系统语言。词库导入后可
直接用系统默认文本编辑器编辑，也可在文件管理器中打开其存储位置。发布包不包含词库，
安装扩展时也不会自动下载词库；可以通过本地导入或网络位置主动添加。设置中
可以针对当前语言同时启用多个词库，分词会合并已启用词库；没有匹配项时直接
使用系统 `Intl.Segmenter`。系统 `Intl.Segmenter` 本身也作为默认启用的词库项显示在
列表中，可以和用户词库一起开关。

快捷语句保存在 `$XDG_DATA_HOME/clipboard-x/quick-phrases.json`。首次使用新版存储时，
已有的 GSettings 快捷语句会迁移到该文件。

“导入词库”旁边的“添加网络位置”支持 HTTP/HTTPS UTF-8 词库地址。添加后会主动下载
一次，之后可以使用词库行上的刷新按钮手动更新；扩展安装、启动和打开面板都不会自动
联网。

词库设置只在中文和日文显示语言下出现；其他已支持语言使用系统
`Intl.Segmenter` 完成基础分词，不显示不相关的词库配置。

图片编辑器优先使用设置中选择的 Desktop Application。选择“自定义命令”时支持：

- `%u`：图片 URI；
- `%f`：本地文件路径；
- `%i`：通过标准输入传递图片字节，该占位符必须是独立参数；
- `%%`：字面量 `%`。

命令按 argv 解析，不经 `sh -c`，因此不支持管道、重定向或 Shell 展开。例如
`gradia %i`、`gimp %f` 和 `flatpak run be.alexandervanhee.gradia %u`。

截图目标取决于本机 Portal 版本。Portal v2 通常支持交互选择和全屏；窗口、区域和
活动窗口需要实现 `AvailableTargets` 的 Portal v3 后端。扩展会拒绝后端未声明的目标。

## 剪切板同步

在“设置 → 同步”中填写服务器地址、设备 API Key，刷新并选择活动 Channel，然后启动
同步并测试连接。地址可以是纯 IP、`IP:端口`、HTTP 或 HTTPS；未写协议时按 HTTP 处理，
扩展不会擅自升级协议。服务器地址、API Key 和活动 Channel 保存在
`$XDG_DATA_HOME/clipboard-x/sync.json`；非机密的增量游标单独保存在 `sync-state.json`，
避免设置进程和 Shell 并发保存时互相覆盖。API Key 不写入 GSettings。

扩展直接使用版本化 HTTP API 访问用户选择的可信中心服务器。小文本和小图片立即流式
上传；大文本只先传截断预览，大图片只先传缩略图，用户真正复制、保存或编辑时才请求
来源设备提供完整内容。上传和下载按实际字节提供精确进度，并在落盘前校验大小与
SHA-256。协议端点、字段、状态机和实现要求见 [HTTP API v1](protocol/HTTP1.md)。

服务器不是盲中转站：它可以保存、展示和管理已经上传的剪切板内容，管理设备及 Channel；
网页查看大内容仍可以使用同一套按需物化流程。服务器是同步信任边界，服务器管理员可以
读取实际上传到服务器的内容。

手动发送是默认策略。自动发送虽然适合自行安装场景，但会在没有逐条用户操作时把
剪切板交给用户配置的第三方服务器，因此不应直接用于提交 GNOME Extensions 的审核版本。
自动发送可进一步限制为只有用户收藏条目后才发送；敏感内容同步仍需单独启用。

## 隐私

剪切板历史保存在用户数据目录
`$XDG_DATA_HOME/clipboard-x/history/<DeviceId>`，每个来源设备分别存放索引、对象和预览，
目录权限设为仅当前用户可访问。旧缓存数据会在首次加载时迁移到该结构。
快捷语句文件、`sync.json` 和 `sync-state.json` 位于同一个用户数据根目录。快捷语句与
同步进度按私有数据写入；插件不检查或强制修改 `sync.json` 的文件系统权限。
“隐私模式”会暂停捕获；密码管理器标记的敏感内容默认只保存在内存中，同步敏感内容
默认关闭。详细的数据流、信任边界和报告方式见 [SECURITY.md](SECURITY.md)。

## 测试

```sh
meson test -C build --print-errorlogs
meson test -C build --suite stress --print-errorlogs
gnome-shell-test-tool --headless --extension build/clipboard-x.zip tests/ui/shell.smoke.js
gnome-shell-test-tool --headless --extension build/clipboard-x.zip tests/ui/preferences.smoke.js
```

交互式调试可以运行：

```sh
tools/run-dev-shell.sh
```

该脚本使用独立的 XDG 数据和配置目录，并让嵌套 GNOME Shell 直接加载
`build-devkit/clipboard-x@guleo.github.io`。修改代码后关闭 Devkit 窗口并重新运行脚本，
无需注销宿主桌面，也不会读取宿主桌面的 Clipboard X 配置。

若嵌套 Mutter 能看到 `wl-copy` MIME 却无法完成 selection transfer，可在只验证 UI 与
生命周期时设置 `CLIPBOARD_X_SKIP_EXTERNAL_SOURCES=1`；这只跳过外部 Wayland/XWayland
来源用例，不跳过扩展内部的文本、图片、截图、分词、同步进度和生命周期测试。
翻译加载可以使用 `LC_ALL=zh_CN.UTF-8 CLIPBOARD_X_EXPECT_CHINESE=1
CLIPBOARD_X_TRANSLATION_ONLY=1` 运行同一个 Shell 冒烟脚本。

项目不使用 ESLint；构建验收使用 Node 语法检查、GJS 测试、协议互操作测试和真实
GNOME Shell 无头会话。

词库性能对比可以使用独立 benchmark。它会在两个独立的 GJS 子进程中分别测量精简
词库和外部完整词库的词条数、文件大小、首次加载耗时、缓存后分词耗时和 RSS 增量：

```sh
curl --fail --location \\
  https://raw.githubusercontent.com/yanyiwu/cppjieba/master/dict/jieba.dict.utf8 \\
  --output /tmp/jieba.dict.utf8
gjs -m tools/benchmark-tokenizer.js /tmp/jieba.dict.utf8 2000
```

完整词库只作为 benchmark 输入，不会被提交到扩展包；脚本会复用正式的词库解析和
分词加载路径。

完整的阶段要求与自动化证据对应关系见 [开发完成审计](docs/completion-audit.md)。

## 许可证

Clipboard X 以 [GNU GPL v3 或更高版本](LICENSE.md)发布。
