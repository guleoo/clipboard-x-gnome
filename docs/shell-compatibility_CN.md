# GNOME Shell 兼容性

> 简体中文 · [English](shell-compatibility.md)

同一个发布 ZIP 面向 GNOME Shell 50+，各版本共用实现，不维护不同的扩展分支。
目前已验证的版本为 50 和 51；后续版本需要先验证并更新支持版本元数据，才能安装。St 纵向布局使用
`orientation: Clutter.Orientation.VERTICAL`，虚拟键盘通过
`global.stage.context.get_backend().get_default_seat()` 获取设备。这些接口两个版本都有。
旧 Actor 事件信号在 51 中仍然可用，但已弃用；迁移事件控制器属于独立改动，不是加载 51 的必要条件。

## 自动验证

CI 和 Release 工作流使用 Fedora 44 / Shell 50 和 Fedora 45 / Shell 51。CI 在每次推送和 Pull Request 时执行，
Release 只在推送 `v*` 标签时执行。每个任务构建前检查实际 Shell 版本，
执行排除 `stress` 套件的 Meson 普通回归测试、校验 ZIP，然后运行隔离的无窗口 Shell 生命周期测试。版本不匹配会明确失败，
不会静默改测其他版本。Fedora 45 容器可能处于预发布阶段，兼容性目标以实际安装的 Shell 版本为准。
两个任务均成功才能发布，只上传一份运行时 ZIP。

本地构建安装包后，可运行范围较小的生命周期检查：

```sh
bash tools/test-shell-compatibility.sh build/clipboard-x-gnome_1.0.3.zip
```

末尾可添加 `50` 或 `51`，要求本机已安装的 Shell 必须是指定版本。脚本不会安装或升级 GNOME。
它使用官方 `gnome-shell-test-tool`、独立运行时目录、临时扩展/设置目录、独立会话总线和无窗口虚拟显示器，
不会修改桌面已安装的插件或其设置。环境需要可用的系统总线；容器需要自己的总线和合适的登录管理器测试环境。
CI 仅在容器内启动系统总线，并移除软件包创建的空 `/run/systemd/seats` 标记，让 Shell 使用内置的无 logind 模式。
不会触碰宿主机运行时目录，也没有使用替身替换插件接口。

测试使用自带的静态背景并关闭 Shell 动画，不依赖发行版壁纸包。英文 `[compatibility]` 日志
分别标明自动化模块初始化、Shell 启动完成、测试入口及各生命周期阶段。模块初始化后，启动阶段
最多等待 30 秒；测试中的关键等待最多 15 秒。超时信息包含当前阶段及 Shell/扩展的就绪状态。
外围仍保留原有的 120 秒限制，用于处理模块尚未初始化或主循环阻塞的情况。
启用/禁用请求是异步的：测试会等待扩展进入未激活状态且面板已移除，再重新启用；启用后
要求扩展已激活且返回新的面板实例，避免排队的设置变更合并成无操作，或把旧实例误当成重启结果。

检查范围包括扩展加载、共有的布局方向/backend/滚动接口、主面板打开、分词结果渲染、快捷语句面板构造，
以及禁用/重新启用。它不代表截图、真实键盘、服务器互操作或视觉布局的验收，这些仍需要在目标桌面单独测试。
较完整的 `shell.smoke.js` 和设置窗口检查也独立保留；生命周期检查成功不代表这些套件中的所有断言都已通过。

## 参考

- [GNOME Shell 48 迁移指南](https://gjs.guide/extensions/upgrading/gnome-shell-48.html)：共有布局方向和 context 接口。
- [GNOME Shell 51 迁移指南](https://gjs.guide/extensions/upgrading/gnome-shell-51.html)：移除的接口及弃用的事件信号。
- [同步性能测试](sync-performance-testing_CN.md)：独立传输门槛及 CI 延迟诊断。
