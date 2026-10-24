# 测试目录说明

> 简体中文 · [English](README.md)

先按所需运行环境分类，每类内部继续按业务领域组织：

[功能测试清单](functional-inventory_CN.md) 统一维护验收范围、入口、缺口和重复测试审查，
不是通过报告。

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
    lifecycle/    # 安装、启动、启停的兼容性子集
    panels/       # PANEL-01～10、导航、恢复、搜索、Esc
      cases/      # 用例及私有会话驱动
      fixtures/   # 显示器与背景素材
    clipboard/    # 捕获、条目、图片、历史、隐私
    phrases/      # 原生表单、快捷键、保存竞态
    word-selection/
    terminal/     # 实际目标输入、修饰键/事件保护、生命周期
    sync/         # 开关、进度/会话恢复、接收落盘
    screenshot/
    color-picker/
    settings/     # 独立 GTK、设置入口及前景色
    helpers/      # 共用断言和 Shell 准备，不是功能用例
    shell.smoke.js # 领域检查编排，不是全部模拟文件入口
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
# 原生功能验收（清单内已实现的用例，不等于全部功能已通过）：
python3 tools/test-simulation.py --list
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --group clipboard --isolate-cases
# 面板套件也可以通过以下入口运行：
bun run test:simulation:panels
```

`test:simulation:panels` 运行本地面板验收套件，不是执行目录内所有模拟测试。其他专项和 GTK 调用
方式见[参与开发](../CONTRIBUTING.zh-CN.md)。Shell 和面板 runner 已改用新目录；UI 验收矩阵，
以及原本由 CI 执行的生命周期子集均不变。具体隔离方式和验证边界见
[Shell 兼容性](../docs/shell-compatibility_CN.md)、[面板测试](../docs/panel-testing_CN.md)。

各领域的 `.smoke.js` 可使用参与开发文档中的隔离 `run_shell_check` 执行。
`shell.smoke.js` 导入领域检查，不复制实现；可用 `CBX_SIMULATION_CASES=phrases,wordSelection`
选择其中的命名检查，未知名称直接失败。原生表单、搜索、取色和 GTK 专项仍需单独运行。

不要常规运行“综合入口 + 全部组件”再当作额外覆盖。根据清单选择相关入口和层级。
裁剪区拖选使用固定舞台坐标和实时 picking，避免焦点滚动后复用过时 Actor 坐标。
入口存在不表示整个综合套件已通过。

### 原生功能验收入口

`tools/test-simulation.py` 按 `simulation/manifest.json` 中的功能 ID 运行，支持 `--case CLIP-01,CLIP-09`、
`--group clipboard`、`--shell 50` / `51` 和 `--language zh_CN`。默认每个模块一个独立 Shell；
`--isolate-cases` 每个用例启动新的 Shell，失败后继续下一项，不自动重试。
原包不变；51 测试需要时只补测试副本的 metadata。

运行目录位于私有 `/tmp/clipboard-x-simulation-*`；XDG、Session Bus、剪切板来源和输入目标均隔离。
不要把该入口的 automation script 直接放进宿主或开发桌面运行：夹具会清空自己的历史与语句。
`fixtures/desktop-app.js` 是真正独立的 GTK Wayland 来源和接收端，直接回读 MIME 字节/hash；
来源竞态通过暂停/恢复/退出自己的来源进程制造，不替换插件读取函数。虚拟设备不证明物理输入熔断。

日志、`summary.txt`、`report.json` 保存于 `build/simulation-tests/`，包含包 hash、Shell、语言及结果。
`PASS`、`FAIL`、`NOT_RUN`、`BLOCKED` 分别表示通过、断言/运行失败、未执行、缺少依赖；
退出码分别为 0（全部选中项通过）、1（失败或未执行）、2（仅依赖阻塞）。注册用例之外的缺口仍以
[功能清单](functional-inventory_CN.md)为准，不能用选中子集的绿色结果代替整体结论。此入口不加入 CI。

## 新增测试的归属

- 根据运行环境分类，不仅根据 `.test.js`、`.smoke.js`、`.integration.js` 后缀判断。
- 分类内部保持领域结构。专用辅助文件跟随所属领域，共享外部程序放入 `fixtures/`，不作为独立套件执行。
- 适合的逻辑测试再注册到 Meson；图形测试保留显式模拟入口，不隐式加入普通 CI。
- 对可维护的行为风险写断言，不锁定源码字符串、文档措辞或样式快照。
