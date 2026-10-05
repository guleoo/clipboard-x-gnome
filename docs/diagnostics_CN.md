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

插件生成的诊断消息统一以 `Clipboard X ` 开头，后面是 JSON 记录：

```json
{"time":"2026-10-05T00:00:00.000Z","level":"error","session":"…","module":"sync","operation":"initialize","id":"…","phase":"channels","durationMs":120,"outcome":"failed","error":{"type":"HttpError","code":"channel_forbidden","frames":["/sync/client.js:…"]},"causes":[]}
```

- `session` 区分不同 JS 进程，不是设备 ID 或同步凭据。
- `id` 关联同一操作的各阶段，并发操作分别使用自己的 ID。
- `module`、`operation` 和 `phase` 定位失败环节。同步初始化包含配置读取、传输层创建、
  服务状态、设备信息、设备资料更新、Channel 列表、必要时的 Channel 选择、传输列表、
  剪切板变更、待执行任务和传输刷新。
- `durationMs` 使用单调时钟计算操作耗时。
- `error` 和有数量限制的 `causes` 保留已知错误码与可信代码位置，不输出原始错误文本。
- `level` 是插件的逻辑级别。GJS 可能将 console 警告与错误映射到相同的 journal 优先级，
  因此不要只依赖 `journalctl -p` 来筛选。

正常后台轮询和字节进度更新不输出日志；轮询失败会指出变更、任务或传输刷新阶段。
主动取消作为信息记录，不视为操作错误。桌面通知仍保持简短且支持多语言，技术细节在
journal 中查看。

## 开发会话

`tools/run-dev-shell.sh` 在存在 `systemd-cat` 时，将构建输出及独立 Devkit 会话的标准输出、
标准错误接入系统 journal，标识为 `clipboard-x-devkit`。显示启动说明后，当前终端不再
实时输出子进程日志；可以另开终端查看：

```sh
journalctl --user -b -f -o cat -t clipboard-x-devkit + _EXE="$(command -v gnome-shell)"
```

`+` 将 Devkit 输出与 Shell 原生 journal 消息合并查询。GJS console 消息可能直接写 journal，
不携带 Devkit 标识，**不能仅按这个标识查找插件报错**。查看插件自身的诊断时，使用上面的
`Clipboard X ` 筛选即可。完整 Shell 查询也会包含宿主 Shell，可以用 PID 和 `session`
区分不同进程。

包装保留构建、会话退出码与信号处理方式，不创建日志文件。没有 `systemd-cat` 时，输出仍
显示在终端，脚本会说明这些输出没有自动留存；标准 GJS journal 日志仍由平台负责。

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
