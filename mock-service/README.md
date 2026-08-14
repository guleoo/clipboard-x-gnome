# Sync1 Mock Service

这里的 GJS 与 Python 实现用于验证 Sync1 的跨语言 D-Bus ABI、UNIX FD 传输、按需
物化、取消和重连。它们只把快照保存在内存中，不执行设备发现、网络传输、认证或
持久化，不能作为生产同步服务。

在临时 Session Bus 中启动 GJS 实现：

```sh
dbus-run-session -- gjs -m mock-service/mock-service.js
```

Python 实现需要 PyGObject：

```sh
dbus-run-session -- python3 mock-service/mock-service.py
```

两个实现都使用：

- Bus Name：`io.github.guleo.ClipboardX.MockService`
- Object Path：`/io/github/guleo/ClipboardX/Sync`
- Interface：`io.github.guleo.ClipboardX.Sync1`

直接运行 `meson test -C build --print-errorlogs` 会依次验证两个实现，并覆盖 50 MiB
FD 负载以及 Service 高频退出/重启。Mock 与协议文档不会进入扩展发布 ZIP。

实现生产 Service 时应从
[`protocol/io.github.guleo.ClipboardX.Sync1.xml`](../protocol/io.github.guleo.ClipboardX.Sync1.xml)
生成绑定，并完整实现 [`protocol/SYNC1.md`](../protocol/SYNC1.md) 中的验证、生命周期、
认证和清理要求。
