# 测试目录说明

> 简体中文 · [English](README.md)

先按所需运行环境分类，每类内部继续按业务领域组织：

```text
tests/
  logic/          # 不需要图形桌面
    clipboard/    # 历史、分词、词库、模拟输入序列
    color-picker/
    common/       # 基础设施、打包与命令保护
    i18n/
    screenshot/   # 编辑器参数/标准输入及门户协议
    sync/         # 策略、状态、HTTP、存储、生命周期及可选压力测试
    ui/           # 面板模型、焦点矩阵、布局和设置逻辑
  simulation/
    ui/           # 真实 GNOME Shell、Mutter 输入及独立 GTK 进程
      fixtures/   # 显示器与背景素材
      panels/     # 面板验收驱动及用例
  fixtures/       # 共享的外部剪切板、输入目标及进程辅助程序
```

## 逻辑验证

`logic` 表示**无需图形桌面的验证**，不意味着全是纯单元测试。其中也有文件读写、私有 D-Bus
服务、本地 HTTP 服务和子进程集成，以及无磁盘的模型测试。这里的测试不能要求 `Gtk.init()`、
图形显示或正在运行的 Shell。只导入 GTK 工具 API 而不初始化显示，不算图形测试；
`logic/ui/shortcut-match.integration.js` 还需要 Shell 私有 typelib，但不需要桌面。
领域内专用夹具与其所属测试放在一起，跨领域共享时再抽到公共目录。

配置并构建 Meson 后运行：

```sh
dbus-run-session -- meson test -C build --no-suite stress --print-errorlogs
# 等价的 package 脚本：
bun run test:logic
```

Meson 只注册这一类测试，原有测试名称和可选的 `stress` 分组不变。
`meson test -C build` 仍包含压力测试，普通 CI 仍将其排除；本次整理不增加 CI 测试范围。
可选压力测试见[传输压力测试指南](../docs/sync-performance-testing_CN.md)。

## 模拟桌面验证

`simulation` 在准备好的图形环境或隔离 headless 桌面中运行真实 Shell/GTK，不是伪造控件模型。
原生输入测试使用 Mutter 虚拟设备注入事件；其他集成测试可能检查实际 actor/窗口，或使用
受控信号、回调。GTK 始终在 Shell 之外的独立进程运行。

构建发布 ZIP 后，沿用隔离入口：

```sh
bash tools/test-shell-compatibility.sh build/clipboard-x-gnome_1.x.x.zip
bash tools/test-panels.sh build/clipboard-x-gnome_1.x.x.zip --repeat 2
# 面板套件也可以通过以下入口运行：
bun run test:simulation:panels
```

`test:simulation:panels` 运行本地面板验收套件，不是执行目录内所有模拟测试。其他专项和 GTK 调用
方式见[参与开发](../CONTRIBUTING.zh-CN.md)。Shell 和面板 runner 已改用新目录；UI 验收矩阵，
以及原本由 CI 执行的生命周期子集均不变。具体隔离方式和验证边界见
[Shell 兼容性](../docs/shell-compatibility_CN.md)、[面板测试](../docs/panel-testing_CN.md)。

## 新增测试的归属

- 根据运行环境分类，不仅根据 `.test.js`、`.smoke.js`、`.integration.js` 后缀判断。
- 分类内部保持领域结构。专用辅助文件跟随所属领域，共享外部程序放入 `fixtures/`，不作为独立套件执行。
- 适合的逻辑测试再注册到 Meson；图形测试保留显式模拟入口，不隐式加入普通 CI。
- 对可维护的行为风险写断言，不锁定源码字符串、文档措辞或样式快照。
