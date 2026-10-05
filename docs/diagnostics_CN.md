# 日志与问题排查

> 简体中文 · [English](diagnostics.md)

Clipboard X 按照 [GNOME 扩展调试指南](https://gjs.guide/extensions/development/debugging.html)，
使用标准 GJS console 和系统 journal，不创建插件专用日志文件，也不启动日志后台服务。
日志保留期限、重启后是否仍然保留，由系统 journald 配置决定，插件不修改这些配置。

## 查看插件日志

```sh
# 当前启动周期内，宿主与嵌套会话的最近日志
journalctl --user -b -o cat --grep='Clipboard X ' -n 100

# 复现问题时实时查看
journalctl --user -b -f -o cat --grep='Clipboard X '
```

如果桌面会话日志不在用户 journal 中，去掉 `--user` 再查询。日志访问权限取决于发行版的
设置，插件本身不需要 `sudo`。

插件生成的诊断消息统一以 `Clipboard X ` 开头，使用普通文本：

```text
Clipboard X [INFO] sync initialize completed · 187 ms
Clipboard X [ERROR] sync initialize failed at channels · HttpError:channel_forbidden · 120 ms · /sync/client.js:123:5
```

- `[INFO]`、`[WARN]`、`[ERROR]` 表示日志级别。GJS 可能将 console 警告与错误映射到相同的
  journal 优先级，因此不要只依赖 `journalctl -p` 来筛选。
- 模块、操作和失败阶段用于定位问题。例如 `sync initialize failed at channels` 表示同步
  初始化在获取 Channel 列表时失败。
- 耗时使用单调时钟计算。已知错误码和少量可信代码位置提供排查线索，不输出原始错误文本；
  存在底层原因时，会附上有长度限制的原因摘要。

不再输出 JSON、操作 UUID 或额外的时间字段，时间由 journal 提供。成功操作只输出一条摘要，
不逐阶段刷屏。阶段只在内部跟踪、失败时输出；操作卡住但没有报错时，不会实时显示当前阶段。

正常后台轮询和字节进度更新不输出日志；轮询失败会指出变更、任务或传输刷新阶段。
主动取消作为信息记录，不视为操作错误。桌面通知仍保持简短且支持多语言，技术细节在
journal 中查看。

## 开发会话

默认终端只显示构建摘要、插件日志和系统警告/错误。安装文件列表、服务成功启动等信息不再
刷屏，重复的系统消息和对象销毁栈会合并显示。需要在终端查看完整输出时：

```sh
./tools/run-dev-shell.sh --verbose
```

`tools/run-dev-shell.sh` 在存在 `systemd-cat` 时，将**未过滤的**构建输出及独立 Devkit 会话的
标准输出、标准错误接入系统 journal，标识为 `clipboard-x-devkit`。终端过滤只影响显示，
不会减少 journal 保存的内容，不需要额外打开终端或启动 journal 跟随器。脚本合并标准输出
和标准错误，先通过 `tee` 转发一次，再过滤终端显示。
标准错误接到普通管道时，[GLib 默认日志写入器](https://docs.gtk.org/glib/func.log_writer_default.html)
会输出到标准流，而不是直接写 journald，因此不会把同一条 GJS 消息重复转发。
合并流统一使用 journal 的 `info` 优先级，插件的 `[WARN]`、`[ERROR]` 仍区分警告与错误。
如果需要单独查看已保存的输出，可以运行：

```sh
journalctl --user -b -f -o cat -t clipboard-x-devkit + _EXE="$(command -v gnome-shell)"
```

`+` 将 Devkit 输出与 Shell 原生 journal 消息合并查询。宿主会话及独立启动的进程，其 GJS
消息可能直接写 journal，不携带 Devkit 标识，**不能仅按这个标识查找所有插件报错**。
查看插件自身的诊断时，使用上面的
`Clipboard X ` 筛选即可。完整 Shell 查询也会包含宿主 Shell，需要时间时使用
`journalctl -o short`，需要按进程区分时使用 `-o verbose` 查看 PID 元数据。

包装保留构建、会话退出码和 Ctrl+C 行为，退出时回收转发进程，不创建日志文件。
终端显示的是本次启动的输出，脚本不订阅其他 Shell 进程的日志。journal 转发失败时会给出
警告，但终端输出和开发会话仍可继续。终端过滤失败时，会警告并切回原始输出。
没有 `systemd-cat` 或 `tee` 时，终端仍可显示日志，脚本会说明这些输出没有自动留存。
原生 GJS 日志遵循平台的输出路由，本身不保证另外写入
journal。

## 提交问题反馈

复现一次后，只收集相关时间范围：

```sh
journalctl --user -b --since '10 minutes ago' -o cat --grep='Clipboard X '
```

反馈时附上扩展版本、GNOME 版本、宿主或 Devkit 会话、是否启用同步以及操作步骤。
仅凭启动时的一条通知不能确认问题来自同步，应以日志中的失败操作和阶段为依据。

插件诊断的**消息正文**不记录剪切板文本、图片、API Key、服务器地址、设备/Channel/条目 ID、
自定义文件路径或原始服务端响应。未知字符串错误码显示为 `unknown`，栈位置只接受扩展
代码与 GNOME 资源。PID、可执行文件路径、源码位置等 journal 元数据由平台提供，不属于
此过滤范围。构建工具、GNOME 和其他应用的消息也不经过插件过滤，公开分享完整会话输出
前请自行检查。
