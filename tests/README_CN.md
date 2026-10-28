# 测试目录说明

> 简体中文 · [English](README.md)

先按所需运行环境分类，每类内部继续按业务领域组织：

[功能测试清单](functional-inventory_CN.md) 统一维护验收范围、入口、缺口和重复测试审查，
不是通过报告。

实际运行结果、保留的失败和环境限制另见[桌面验收结果快照](acceptance-status_CN.md)。

```text
tests/
  environments/   # 独立 GNOME 50/51 容器定义
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

## 独立 GNOME 50 / 51 环境

本地基线优先使用 Docker 环境，不依赖宿主安装的 GNOME。宿主只需 Python 3、Git 和运行中的
Linux Docker 引擎；不安装宿主插件、不修改宿主输入法，也不新增 GitHub 工作流。

```sh
# 默认两版：构建/复用环境，运行非压力逻辑测试和本地无图形验收
bun run test:environment
# 等价入口；Docker Desktop 非默认 context 时显式指定
python3 tools/test-environment.py --context desktop-linux
# 只准备两份环境镜像
python3 tools/test-environment.py --build-only
# 只有必须经过真实 Shell 的结果才选择模拟用例；自动构建测试包
python3 tools/test-environment.py --suite simulation --case TYPE-02-vte,TYPE-03
# 语言/显示条件按需求显式选择；也可只跑一个版本
python3 tools/test-environment.py --shell 51 --suite simulation --case DICT-02 --language zh_CN
# 显式更新环境依赖；不在每次运行时自动升级
python3 tools/test-environment.py --rebuild --build-only
```

GNOME 50 使用 `tests/environments/gnome50/Dockerfile`，GNOME 51 使用
`tests/environments/gnome51/Dockerfile`，各自固定 Fedora 基础镜像 digest 和 Shell 版本，
可以独立调整依赖，仅共享会话启动脚本。构建上下文为 `tests/environments/`，入口自动选择
对应的 Dockerfile。环境定义 hash 也按版本独立计算，修改其中一份不会使另一版镜像失效。
安装包前取消 Fedora 基础镜像的英文翻译过滤，保留 GNOME/GTK 系统语言资源，并提供阿拉伯语和
德语 locale；仅打包插件译文不足以验证 RTL 桌面。`LANG-03 --language ar/de` 读取实际 Shell/GTK
方向并操作窄面板长文本；不强制控件 RTL 来换取通过。`LANG-07-dictionary --language zh_CN`
验证实际词库错误正文，已知未本地化也应报告失败。
语言入口优先实际已安装的匹配 UTF-8 locale，不选择 ISO-8859/EUC 等同名前缀候选；报告记录实际
`messageLocale`，缺目标 locale 时才回退非 C 的 UTF-8 基础语言，不据此宣称已验真实 RTL。
每次启动全新容器，测试进程为 UID 1000 普通用户；系统 D-Bus 仅在容器内启动。
宿主仅提供只读代码快照，不挂载 HOME、桌面/输入设备、D-Bus socket、Docker socket 或凭据，
不传入宿主环境变量。`.git`、`.codex`、构建目录和用户输入样本不进入快照。GTK 输入模块固定
为 Wayland；包含 Shell Unicode/文本输入路径所需的标准 IBus daemon，默认基线不安装 Fcitx 或拼音
引擎。基础框架可用不等于已验证真实中文输入法。

实际编辑器/输入法验收显式选各版本 Dockerfile 的 `applications` 阶段：**仅在镜像内**安装
固定源码的原生 Gradia、固定 Flathub 应用/runtime、Fedora libpinyin 和真实 Mutter Devkit：

```sh
python3 tools/test-environment.py --profile applications --build-only
python3 tools/test-environment.py --profile applications --suite simulation --case EDIT-07-native,EDIT-07-flatpak,TYPE-08-ime
```

对应镜像为 `:50-applications` / `:51-applications`，不改变基础镜像。报告记录应用提交/hash、
runtime 提交和实际 RPM 版本。IME 用例观察 Gtk preedit，分别比较中英文模式的普通虚拟按键与
插件输出，不以引擎名称冒充组字正控，也不宣称绕过输入法。只有 Flatpak 用例额外取消容器系统
路径屏蔽（`systempaths=unconfined`），使其自身 bubblewrap 沙箱能创建嵌套 namespace；不挂载
宿主路径/设备，不移除应用沙箱。Fedora Devkit 真实路径只在可选夹具里桥接到开发脚本目前探测的路径。

开发桌面的真实完整链有独立入口：

```sh
python3 tools/test-environment.py --profile applications --suite simulation --case OPS-07-devkit --language zh_CN
```

只有该用例在一次性容器中启动真实持久化 journald，并授予测试用户读取该容器日志的权限。
私有 PipeWire/WirePlumber 驱动真实嵌套 Devkit 窗口；原样开发脚本必须完成构建/打包、隔离
XDG/总线/设备身份、沿用指定语言、正常关窗 exit 0，并让关键日志在终端和用户 journal 各出现一次。
参数、失败、Ctrl+C 等继续归既有逻辑测试，不另复制 GUI 矩阵。不使用宿主日志或系统服务。

两小时资源观察必须显式使用自有后端入口（另一版将 `:50` 换成 `:51`）：

```sh
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip --image clipboard-x-server:verify-doc-copy --shell-container clipboard-x-gnome-test:50 --case OPS-03-soak --timeout 7500
```

可指定本地构建的服务端镜像，或省略 `--image` 从同级服务端源码构建；必要时指定 `DOCKER_CONTEXT`。
该用例从默认/分组选择中排除，不加入 GitHub CI。复用短程资源断言，保持实际数据集固定，每 30 秒
真实同步/刷新，每 10 轮重启插件。持续时间和资源释放是硬断言；RSS/FD 采样及分窗中位数导出供
趋势审查，不凭空设内存阈值或宣称绝无泄漏。`7500` 秒留出启动/收尾余量，普通用例默认超时不变。

运行时网络为 `none`，仅容器自身 loopback 可用；HTTP/TLS 逻辑夹具照常运行，不访问公网。
同步后端仍用自有服务端专项入口；可选 profile 提供 IME/编辑器依赖，不声称编排全部模拟矩阵。
未安装的 Gradia/Flatpak 等依赖会阻塞对应用例，不算通过。
浏览器用例为允许其内部 namespace 沙箱，只对这次容器设置 `seccomp=unconfined`，不使用
`--privileged`、宿主网络或浏览器 `--no-sandbox`；内核不允许 user namespace 时应判为环境阻塞，
不能据此认定插件输入失败。容器仍共享 Docker 引擎的内核，不是硬件/性能完全相同的虚拟机。

结果位于 `build/environments-*/`：汇总状态、基础 digest、实际镜像内容 ID、环境定义/源码快照 hash、
完整 RPM 版本及各层测试日志。容器结束后先导出结果，再删除本次容器；环境镜像保留供下次复用。
环境定义变化会要求显式重建。首次构建从发行版仓库解析依赖，仓库会更新，**固定基础 digest 不等于
未来重建依赖逐字节相同**；跨机器严格复现应通过 Docker image save/load 共享同一份已构建镜像，
并核对报告的镜像 ID 和包清单。不要把不同镜像的差异直接归因为 GNOME 大版本。

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

从桌面测试下沉的捕获状态、历史控制器、草稿、输入保护、截图编排和网络词库验收，使用显式本地入口：

```sh
bash tools/test-logic-acceptance.sh
# 或 bun run test:logic:acceptance
```

该入口不启动 Shell/GTK，并清除图形显示环境；各项使用私有 Session Bus。它补充而不重复执行默认
Meson 套件，也不自动加入 CI。原有纯算法矩阵仍复用 Meson 中的分词、颜色、存储和同步领域测试。
文件/HTTP 集成同样属于逻辑测试，不必为了验收数据规则启动桌面。
网络词库用例需要 GVfs HTTP(S) 后端，TLS 拒绝还需 `openssl`；缺依赖标为 BLOCKED，不算通过。

需要真实同步服务端的逻辑验收单独运行：

```sh
python3 tools/test-sync-http.py --list
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip --headless
```

沿用 Docker 的独占后端与清理边界，执行生产客户端、存储、队列和真实 HTTP gate，但不创建图形
桌面，也不依赖 GNOME 版本。可用 `--case` 选择发布幂等、设备撤销、分页、目的地和校验用例；
结果保存在 `build/sync-http-tests/`。已知失败随用例迁移，不改成预期成功。

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
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case CLIP-02-chromium
```

CLIP-02 只使用私有 Chromium profile、本地 HTML/图片，实际复制富文本和独立图片；
独立回读原图字节，不把 HTML 图片引用当作图片复制通过。

真实同步服务端验收使用：

```sh
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip --isolate-cases
# 默认构建相邻 clipboard-x-server 源码；也可提供已有镜像：
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip --image SERVER_IMAGE --case RECV-04
# 先准备独立 GNOME 镜像，再通过镜像选择 50 或 51：
python3 tools/test-environment.py --build-only
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip --shell-container clipboard-x-gnome-test:50 --case SEND-06,RECV-06
# 无图形后端验证使用同一普通用户环境，不启动 Shell：
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip --shell-container clipboard-x-gnome-test:51 --headless --case SEND-05-destinations
```

该入口需要运行中的 Docker；创建独占容器、一个临时 volume 和随机 loopback 端口，使用合成认证信息。
另一个 Shell 镜像仅共享该服务端的网络命名空间。结束后只删除本次资源，不执行 Docker prune，
不修改服务端源码。Docker Desktop 有需要时，在服务端命令前加 `DOCKER_CONTEXT=desktop-linux`。
`--shell-container` 仅接受 `tests/environments/gnome50` / `gnome51` 构建的镜像；
共用启动脚本降为 UID 1000，复制不可变源码快照，并测试指定 ZIP，不挂载宿主路径。
服务端场景共享自有后端的网络，不沿用基础入口的 `network=none`；原生用例默认逐项独立 Shell。
实际镜像、源码/定义 hash、完整包清单及日志复制回 `build/simulation-tests/` 或
`build/sync-http-tests/`。源码与环境定义在取快照时一起固定。
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

原生注册表的当前用例以 `--list` 为准，不代表同等数量的功能已全部通过。检查复用原有归属，补齐畸形图片恢复、
原文丢失、语句 IO 故障、选择手势、设置持久化/布局、实际编辑进程及按目的地恢复同步队列。
保留失败见[实际结果](acceptance-status_CN.md)。

```sh
# 实际虚拟显示器，不伪造 monitor 对象：
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case COLOR-05-displays --display dual
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case COLOR-05-displays --display fractional
# DICT-09：120,002 词的真实导入/索引/缓存和主循环测量，无需桌面（按需压力套件）：
dbus-run-session -- meson test -C build tokenizer-dictionary-performance --print-errorlogs
# 两个真实 Shell 之间恢复词库，本地 HTTP 独立计数：
python3 tools/test-lifecycle.py build/clipboard-x-gnome_1.x.x.zip --dictionary-cold
# 独立浏览器 textarea / GTK3-VTE PTY 输入目标：
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --case TYPE-09-firefox,TYPE-09-chromium,TYPE-02-vte --isolate-cases
```

显示用例缺所需 profile 时为 BLOCKED。分数缩放通过 Mutter DisplayConfig 应用后端实际支持的 125%。
VTE 需要 Python GI 的 Gtk 3 / VTE 2.91；Chromium 支持 `chromium` / `chromium-browser` 命令。
浏览器目标使用私有 profile 和自有 loopback 接收器，不访问外站。VTE 先独立验证原生 ASCII 输入与
真实剪切板粘贴，再测插件自然粘贴；raw PTY 嵌入目标不等于所有终端应用。

`TYPE-03` 在标准/慢速两档检查共享短文本，覆盖 ASCII、中英及其他 CJK 文字、emoji、多行和 Tab。
差异日志只记录长度、首个不同码点和 hash，不输出整个样本。旧的长样本和用户样本自动入口已移除，
不读取或修改 `tools/simulate-input-sample.txt`。长文本可靠性作为已知限制，不再作为此项验收门槛。

词库 GUI 用例需要普通桌面用户及文件管理器/编辑器，Nautilus 不支持 root 会话。
无图形词库 TLS 用例还需 `openssl`，验证自有自签名证书被拒绝，不代表可信 HTTPS 成功。
词库冷恢复需要已生成的非 C UTF-8 locale；不改宿主证书库，不关闭证书验证。

`RECV-05` 的单次 GET、多消费者，以及 `SEND-04/08` 的冻结清单/删除取消，由无图形真实 HTTP
入口负责。`RECV-05-automatic-manual` 仅保留自动接收不改剪切板、点击后才复制原文的桌面接线；
`CLIP-08-remote-loop`、`CONN-03-refresh` 继续验证真实回流边界、busy 和设置进程自然退出。
目的地矩阵归 `SEND-05-destinations` 的 HTTP 验证，快捷语句只保留 `PHRASE-08` 的本地数据接线。

`logic/clipboard/capture.test.js` 使用真实解码/缩略图/暂存文件验证隐私及排除变更后的清理；
桌面只留 `PRIV-05` 的真实 owner 传输中切换，不证明解码器内部取消。
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
