# 测试目录说明

> 简体中文 · [English](README.md)

先按所需运行环境分类，每类内部继续按业务领域组织：

[功能测试清单](functional-inventory_CN.md) 统一维护验收范围、入口、缺口和重复测试审查，
不是通过报告。

实际运行结果、保留的失败和环境限制另见[桌面验收结果快照](acceptance-status_CN.md)。

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

报告在开始时固定原包/测试包 hash 和测试源码指纹；运行中修改测试源码会使本轮无效，文档修改不影响。
Shell 异常退出会把正在执行的用例标为 FAIL，之后尚未开始的仍是 NOT_RUN。断言失败时也尽量保存
隔离桌面的截图；合成器已经崩溃时无法截图。

指定语言需生成非 C 的基础 UTF-8 locale（如 `en_US.UTF-8`），否则 gettext 会忽略 LANGUAGE。
DICT 还要求 `--language zh_CN`；缺少 locale、应用或 GVfs 等依赖均为 BLOCKED，不算通过。例如：

```sh
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case DICT-02,DICT-06,DICT-08 --language zh_CN
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case LANG-02 --language ja
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case EDIT-07-native,EDIT-07-flatpak
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case CLIP-02-firefox,CLIP-02-chromium,CLIP-02-office --isolate-cases
```

实际应用来源使用私有 profile、本地 HTML/RTF/图片。只有 headless 的 Office 构建不证明图形
剪切板兼容性。Firefox 使用原生右键菜单“复制图像”，Chromium 复制独立图片；两者均要求
独立回读原图字节，而不把 HTML 图片引用当作图片复制通过。

真实同步服务端验收使用：

```sh
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip --isolate-cases
# 默认构建相邻 clipboard-x-server 源码；也可提供已有镜像：
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip --image SERVER_IMAGE --case RECV-04
# 已准备好 Python/GJS/GNOME 测试工具的另一个 Shell 版本镜像：
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip --shell-container GNOME_TEST_IMAGE --shell 50 --isolate-cases
```

该入口需要运行中的 Docker；创建独占容器、一个临时 volume 和随机 loopback 端口，使用合成认证信息。
另一个 Shell 镜像仅共享该服务端的网络命名空间。结束后只删除本次资源，不执行 Docker prune，
不修改服务端源码。跨容器日志会复制回 `build/simulation-tests/`。
独立 `sync-peer.js` 使用生产 SyncClient、协议和存储提供原文，但它不是第二个 GNOME Shell；
不能据此宣称已经验证两个真实桌面的剪切板自动激活竞态。

完整设置窗口在独立 GTK 进程构造，IPC 只观察控件位置/状态；点击、滚动、组合键录制和恢复默认
使用 Mutter 输入。保留真实 gettext，而不是把翻译替换成英文。成功截图前会为隔离 Shell 准备
私有 XDG Pictures 等目录，拒绝把截图保存到宿主的图片目录。长用例定期续活 GNOME PerfHelper，
不把助手的 30 秒空闲退出误判为产品失败。

会话 wrapper 仅更新私有总线的激活环境，让门户和默认编辑器与 Shell 共用私有 XDG；搜索索引器的
扫描根目录也限制到夹具目录。HTTP gate 流式转发到真实服务端，只改变时序或丢一次完成响应，
不伪造协议结果、不记录认证或正文。助手监测所属 Shell，避免崩溃后残留轮询进程。
`--isolate-cases` 用于收集独立失败，不是正常组合运行的隐藏前提。

### 冷覆盖与恢复

```sh
python3 tools/test-lifecycle.py build/clipboard-x-gnome_1.x.x.zip --shell 51
# 有旧版 ZIP 时，验证实际版本升级：
python3 tools/test-lifecycle.py CURRENT.zip --previous PREVIOUS.zip
```

该入口只安装到私有 XDG，核验安装文件字节，关闭一个真实 Shell 进程，再共用数据启动另一个进程。
ENV-02/06 检查历史/固定项、语句、DeviceId 和绑定原目的地的离线上传队列。未指定 `--previous`
是重装同一个包，不可视为旧版本数据迁移测试。日志和 `report.json` 位于 `build/lifecycle-tests/`。

### 扩展本地覆盖

原生注册表有 135 个可选用例，不代表 135 项功能已全部通过。新检查复用原有归属，补齐畸形图片恢复、
原文丢失、语句 IO 故障、选择手势、设置持久化/布局、实际编辑进程及按目的地恢复同步队列。
保留失败见[实际结果](acceptance-status_CN.md)。

```sh
# 实际虚拟显示器，不伪造 monitor 对象：
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case COLOR-05-displays --display dual
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case COLOR-05-displays --display fractional
# 120,002 词导入/索引/缓存测量，以及不可信 TLS 拒绝：
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case DICT-09,DICT-06-https --language zh_CN --isolate-cases
# 两个真实 Shell 之间恢复词库，本地 HTTP 独立计数：
python3 tools/test-lifecycle.py build/clipboard-x-gnome_1.x.x.zip --dictionary-cold
# 独立浏览器 textarea / GTK3-VTE PTY 输入目标：
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case TYPE-09-firefox,TYPE-09-chromium,TYPE-02-vte --isolate-cases
```

显示用例缺所需 profile 时为 BLOCKED。分数缩放通过 Mutter DisplayConfig 应用后端实际支持的 125%。
VTE 需要 Python GI 的 Gtk 3 / VTE 2.91；Chromium 支持 `chromium` / `chromium-browser` 命令。
浏览器目标使用私有 profile 和自有 loopback 接收器，不访问外站。VTE 先独立验证原生 ASCII 输入与
真实剪切板粘贴，再测插件自然粘贴；raw PTY 嵌入目标不等于所有终端应用。

`TYPE-03-user-sample` 可选读取 `tools/simulate-input-sample.txt`（少于 20,000 字符）；不创建、修改或
提交该用户文件，缺文件为 BLOCKED。差异日志只记录长度、首个不同码点和 hash，不输出整个样本。
普通 TYPE-03 始终在两档速度下检查维护中的 460 字符样本。

词库 GUI 用例需要普通桌面用户及文件管理器/编辑器，Nautilus 不支持 root 会话。
`DICT-06-https` 还需 `openssl`，验证自有自签名证书被拒绝，不代表可信 HTTPS 成功。
词库冷恢复需要已生成的非 C UTF-8 locale；不改宿主证书库，不关闭证书验证。

其他并发入口 `RECV-05-automatic-manual`、`CLIP-08-remote-loop`、`CONN-03-refresh`、
`PHRASE-08-destinations` 由 server runner 运行：验证实际只下载一次、无回流发布、共用 busy 与设置进程
自然退出，以及切配置地址/Channel 后语句仍仅本地。后一项使用同一自有后端的两个地址，不是两个独立部署。

`PRIV-05-thumbnail` 只在真实缩略图已生成/暂存、capture 提交前延迟返回，不证明解码器内部取消。
`WORD-08-close/disable/newer` 延迟真实计算结果，等原生顶层请求结束再验迟到防线，不模拟强行终止计算。
`SHOT-05-unsupported` 读取真实门户能力，核对不支持目标的错误并重试支持的截图；后端支持所有目标时
为 BLOCKED，不替代所有门户的拒绝/超时行为。

Docker wrapper 只把临时服务配置改为每 60 秒 20,000 请求，避免真实 205 条发布/分页消耗默认 600 次预算。
不改生产默认，不自动重试掩盖限流。自定义镜像已有冲突的根 HTTP 配置时直接拒绝，不静默合并。

## 新增测试的归属

- 根据运行环境分类，不仅根据 `.test.js`、`.smoke.js`、`.integration.js` 后缀判断。
- 分类内部保持领域结构。专用辅助文件跟随所属领域，共享外部程序放入 `fixtures/`，不作为独立套件执行。
- 适合的逻辑测试再注册到 Meson；图形测试保留显式模拟入口，不隐式加入普通 CI。
- 对可维护的行为风险写断言，不锁定源码字符串、文档措辞或样式快照。
