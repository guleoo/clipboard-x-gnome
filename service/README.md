# Clipboard X Sync Service

这里是 Clipboard X 的生产级本地同步 Service。GNOME Shell 扩展只通过 Session D-Bus
与它通信；Service 负责读取 `sync.json`、连接中心服务器、维护离线队列并把网络传输
进度映射为 Sync1 信号。

当前阶段已经提供：

- Python 进程入口和 Session D-Bus 名称注册；
- Sync1 对象、属性、设备注册和配置读取；
- 可配置租约、心跳续租和最后一个客户端离开后的安全退出；
- D-Bus 自动激活模板；
- 明确的未配置及网络层未实现状态。

当前阶段尚未提供中心服务器 HTTP 客户端、持久化队列和内容传输。未实现的方法会返回
Sync1 的 `Offline` 错误，不会伪造同步成功。

## 开发运行

依赖 Linux、Python 3.11+、PyGObject，以及 Gio/GLib typelib。Fedora 的对应系统包通常是
`python3-gobject`，Debian/Ubuntu 通常是 `python3-gi`。

在独立 Session Bus 中运行：

```sh
dbus-run-session -- env PYTHONPATH=service/src \
  python3 -m clipboard_x_service
```

正常桌面会话中可直接运行：

```sh
PYTHONPATH=service/src python3 -m clipboard_x_service
```

## Linux 安装与启动

项目的 Meson `local` 和 `system` 安装目标会安装 Python 模块、启动命令以及
`io.github.guleo.ClipboardX.SyncService.service`。插件启用同步后调用
`StartServiceByName`，D-Bus 再执行安装好的 `clipboard-x-service`，因此无需插件直接
创建或守护后台进程。

插件默认申请 15 秒租约，并每 5 秒续租一次。正常禁用时主动关闭 Session；异常停止
续租后，Service 在租约过期、没有活动传输且队列已经安全落盘时执行退出清理。下次调用
再由 D-Bus 自动启动。

开发安装：

```sh
meson setup build --reconfigure -Dtarget=local
meson install -C build
```

也可以通过 `pyproject.toml` 构建 Python wheel。wheel 不是完全独立的跨发行版二进制，
仍要求目标系统安装 PyGObject 和 GLib。若需要单文件程序，可以后续使用 PyInstaller 或
Nuitka，但仍需针对目标发行版打包 GI typelibs 和原生库；不建议把一个构建产物当作所有
Linux 发行版都能运行的通用二进制。

## 源码布局

`service/src/clipboard_x_service` 使用标准 Python `src layout`：`src` 是源码根，
`clipboard_x_service` 是实际可导入包。这样测试和开发命令必须显式使用源码包或安装后的
包，不会因为当前工作目录恰好包含同名目录而掩盖安装错误。包内继续按配置、Session、
D-Bus 接口和进程生命周期拆分模块。
