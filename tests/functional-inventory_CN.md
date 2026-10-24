# 功能测试清单

> 简体中文 · [English](functional-inventory.md)

这是长期维护的**验收范围和归属**，不是通过报告。入口存在只代表覆盖部分边界，不代表已在
GNOME 50/51 通过。旧 .codex 报告仅是对应版本证据，不再作为当前功能清单的维护入口。

## 证据与运行规则

- L：无图形逻辑；F：真实文件/子进程；H：受控 HTTP；S：真实 Shell/GTK（可能直接调用）；
  I：原生分发的虚拟输入；E：真实应用/门户/服务端/独立客户端；V：人工视觉。
- 优先 P0（崩溃、数据、隐私、错误输入），其次 P1 主流程、P2 外观。50、51 分别运行，不能互代。
- 使用隔离 XDG、Session Bus、合成内容和服务器；记录 commit、ZIP hash、环境、ID、配置、
  实际结果和日志。跳过不算通过。按风险选边界，不做所有配置的笛卡尔积。
- ID 沿用此前清单范围，分组不代表所有边界自动覆盖，也不要求每个 ID 创建一个文件。
- 同层同一行为只保留一处归属；逻辑与原生事件、夹具准备、多个套件复用同一函数不算重复实现。
  不删除失败用例或放宽预期来获得通过。
- 命令见[测试说明](README_CN.md)，PANEL 的稳定复现见[面板指南](../docs/panel-testing_CN.md)。

## 功能点与模拟测试归属

### 安装、启动与生命周期 — ENV-01…08

新装、冷覆盖；空目录和已有数据启动；连续启停；初始化、保存、下载、分词、截图、模拟输入中禁用；关闭再打开独立 Shell 后恢复历史和绑定目的地的队列；资源释放；设置使用独立 GTK 进程。不要求热更新或真实注销。

长期模拟入口：[lifecycle/compatibility.smoke.js](simulation/lifecycle/compatibility.smoke.js), [terminal/lifecycle.smoke.js](simulation/terminal/lifecycle.smoke.js), [settings/window.smoke.js](simulation/settings/window.smoke.js), [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

冷启动入口：`tools/test-lifecycle.py` 和 [lifecycle/cold.smoke.js](simulation/lifecycle/cold.smoke.js)。
ENV-02/06 在私有 XDG 安装并核验文件，使用不同 Shell PID 共用数据，检查固定排序、快捷语句、
DeviceId 及绑定目的地的离线上传队列。不指定 `--previous` 仅代表同包冷覆盖，不代表旧版本升级。
在途操作仍需分别确认取消点；CI 范围不变。

### 面板入口、导航与现场 — PANEL-01…10

点击和快捷键开关；隐藏入口锚点及偏移；通用尺寸和单面板覆盖；保留现场、动画关闭、快速重开；第 11 条返回保留搜索、焦点和滚动；初始目标、焦点矩阵、边界限制、键盘滚动和键鼠接续。

长期模拟入口：[panels/navigation.smoke.js](simulation/panels/navigation.smoke.js), [panels/monitors.smoke.js](simulation/panels/monitors.smoke.js), [panels/restoration.smoke.js](simulation/panels/restoration.smoke.js), [panels/search.smoke.js](simulation/panels/search.smoke.js), [panels/escape.smoke.js](simulation/panels/escape.smoke.js).

验证边界 / 缺口：使用 tools/test-panels.sh。restoration 补异步刷新竞态；search 补 Unicode、选区、修饰键、小键盘；escape 验证先收表单及返回/关闭配置。超大面板不要求自动缩小。物理显示器及视觉仍需人工验收。

### 文本与图片捕获、复用 — CLIP-01…12

外部文本、HTML、图片，多语言、多行、Tab、emoji；表示去重，拒绝空和无效内容；捕获大小边界；缩略图等比且复制编辑用原图；延迟、快速和退出的 owner、回流抑制；实际复制回读；操作按钮不误触、Ctrl+点击、可选纯文本去空白。

长期模拟入口：[clipboard/capture.smoke.js](simulation/clipboard/capture.smoke.js), [clipboard/entries.smoke.js](simulation/clipboard/entries.smoke.js), [clipboard/images.smoke.js](simulation/clipboard/images.smoke.js).

原生入口：[clipboard/native.js](simulation/clipboard/native.js)，由 `tools/test-simulation.py --group clipboard` 运行。
CLIP-01、04～11 使用独立 GTK Wayland 来源/接收端，覆盖多语言、多行长文、PNG/JPEG/WebP/GIF/SVG、
缩略图比例与原图回读、捕获大小边界、暂停/退出/快速 owner、去重、真实点击/Enter、操作隔离和 Ctrl+点击。
CLIP-03、12 的数据规则仍归逻辑测试，不重复搬入 Shell。

CLIP-02 的[实际应用条件用例](simulation/clipboard/applications.native.js)使用私有 Firefox/Chromium
profile、本地 HTML / LibreOffice RTF，原生复制后由独立 GTK 回读文本/HTML hash；浏览器原图还校验
尺寸和像素。需要安装实际应用和图形后端。XWayland 仍需独立证据；GTK 多 MIME 夹具不代替这些来源。

### 搜索、排序、保留与持久化 — HIST-01…10

固定重启后置顶；数量、容量、天数及清空保留固定项（含全固定）；preview.text 搜索、上限、无结果；加载保存禁用竞态；按设备分目录、共享引用、staging 采用；损坏、缺失、hash、越界、写入失败及临时文件清理。

长期模拟入口：[clipboard/history/startup.smoke.js](simulation/clipboard/history/startup.smoke.js).

验证边界 / 缺口：配合 logic/clipboard/history。搜索不是全文检索。startup 负责控制器和存储的启动淘汰、立即关闭，不代表全部冷启动、磁盘满及权限故障已验证。

### 隐私与应用排除 — PRIV-01…08

隐私模式暂停记录；敏感 MIME 默认不记录或仅内存；正文、缩略图不落盘、不上传；发现和手输排除应用；owner、隐私、排除策略变化拒绝旧捕获；删除和敏感重复制清理上传；固定、清空、重启不突破本地边界；日志和队列不泄露正文或 API Key。

长期模拟入口：[clipboard/privacy.smoke.js](simulation/clipboard/privacy.smoke.js), [clipboard/capture.smoke.js](simulation/clipboard/capture.smoke.js).

验证边界 / 缺口：privacy 负责敏感重复制、磁盘清理、手动上传拒绝；capture 负责隐私开启时真实剪切板变化。应用排除需真实焦点窗口；队列清理、日志复用逻辑证据。sync.json 不声称加密存储。

### 分词算法与限制 — WORD-01…08

各语言保留位置、标点、空白；缩写、相邻句、链接、邮箱、数字、路径、emoji、混合文字；按原文顺序重建；复制粘贴模拟输入结果一致，空选择不误操作；默认 2000 词及可配置边界；长文响应度；切面板、词库和生命周期后拒绝旧结果。

长期模拟入口：[word-selection/keyboard.smoke.js](simulation/word-selection/keyboard.smoke.js).

验证边界 / 缺口：算法数据边界归 logic/clipboard/tokenizer；Shell 检查控件和结果，不证明全部语言或目标应用接收。长文响应度需测时，不只检查输出。

### 分词鼠标与键盘 — SELECT-01…07

单击一次切换；按住 A→C 选 ABC，退回 B 仅 AB，从已选起点反选；反向、跨行、裁剪和外部释放；Shift+方向、Space/Enter；原文预览、词区滚动、结果和 footer；切换关闭禁用终止拖选。

长期模拟入口：[word-selection/drag.smoke.js](simulation/word-selection/drag.smoke.js), [word-selection/viewport.smoke.js](simulation/word-selection/viewport.smoke.js), [word-selection/keyboard.smoke.js](simulation/word-selection/keyboard.smoke.js).

验证边界 / 缺口：drag 使用原生分发；keyboard 对 Shift 语义也直接调用 handler。viewport 的旧失败是焦点滚动后继续使用旧 Actor 坐标，现改为固定舞台点并检查实时 picking；不能再视作已证实的产品缺陷。纯返回/复制焦点导航归 PANEL。

### 词库与降级 — DICT-01…09

语言区域匹配、系统降级、多词库启用；UTF-8、词频、重复、空文件、错误格式和有效语言声明；归属以导入时为准；大小数量边界；仅主动网络添加刷新，失败保留旧版本；编辑目录删除、原子替换、缓存失效、并发复用、取消、建索引耗时。

长期模拟入口：[settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

原生入口：[word-selection/dictionary.native.js](simulation/word-selection/dictionary.native.js)，以
`--language zh_CN` 运行。DICT-02 操作真实文件选择器和多来源开关；DICT-06 覆盖网络添加、主动刷新、
实际分词重载、失败保留、不偷偷下载（DICT-07）和删除；DICT-08 使用真实默认编辑器与文件管理器。
缺少应用/GVfs HTTP 支持标记 BLOCKED。数据限制仍归逻辑测试，大词库测时及全部后端变体仍有边界。

### 快捷语句 — PHRASE-01…08

真实加号聚焦、主和小键盘 Enter、保存按钮；再次加号或 Esc 取消；输入不触发条目快捷键；空白重复长度数量排序；配置复制粘贴模拟输入删除及复制后关闭；并发延迟失败保存保留新草稿和焦点；重启恢复、仅本地存储，不受清空历史或同步影响。

长期模拟入口：[phrases/form.smoke.js](simulation/phrases/form.smoke.js), [phrases/integration.smoke.js](simulation/phrases/integration.smoke.js).

验证边界 / 缺口：form 负责原生提交，integration 负责路由和保存竞态，logic/clipboard/phrases 负责存储；不证明 IME 输入或外部目标接收（TYPE）。

### 粘贴与模拟输入 — TYPE-01…09

复制粘贴模拟输入的剪切板作用区分；原目标在两档速度收到逐字一致的 ASCII、中日韩、emoji、Tab、多行长文；等待修饰键和超时、运行熔断、通知一次、取消队列、释放按键；输入法、CapsLock、布局、焦点、toolkit 及物理输入限制。

长期模拟入口：[terminal/typing.smoke.js](simulation/terminal/typing.smoke.js), [terminal/guard.smoke.js](simulation/terminal/guard.smoke.js), [terminal/lifecycle.smoke.js](simulation/terminal/lifecycle.smoke.js).

验证边界 / 缺口：typing 比较真实 GTK Wayland 目标；guard 构造事件，lifecycle 控制修饰键且抑制字符；不能证明物理熔断或绕过输入法，此类结论必须人工实测。

### 系统截图 — SHOT-01…07

按钮快捷键及后端支持的目标；历史复制编辑选项组合；取消无通知无副作用；拒绝超时不可用缺 URI 的错误及重试；重复请求和禁用清理；真实图像及空格中文路径。

长期模拟入口：[screenshot/pipeline.smoke.js](simulation/screenshot/pipeline.smoke.js), [screenshot/cancel.smoke.js](simulation/screenshot/cancel.smoke.js).

原生入口：[screenshot/native.js](simulation/screenshot/native.js)。SHOT-03 从按钮/快捷键进入真实门户、
权限确认及截图界面，覆盖编辑关闭时的历史/复制组合；SHOT-04 实际取消且无失败通知。等待 owner
与捕获处理完成，不以回调返回代替。Pictures 在 Shell 启动前设为私有目录。其他目标及协议故障
仍由对应 pipeline/逻辑测试负责。

### 图片编辑 — EDIT-01…07

空命令不取原图；%u/%f/%i/%%、引号和路径；非法占位符命令文件 URI；本地缓存 lazy 原图和离线边界；慢启动不读 stdin 提前退出不卡 Shell；真实原生和 Flatpak Gradia，面板关闭和编辑器生命周期。

长期模拟入口：[clipboard/images.smoke.js](simulation/clipboard/images.smoke.js).

原生入口：[screenshot/editor.native.js](simulation/screenshot/editor.native.js)。EDIT-01 检查真实空命令
通知且不取原图；EDIT-06 操作慢读/不读 stdin 和提前退出子进程，并测 Shell heartbeat；EDIT-07-native
启动真实 Gradia，检查画布中的特征像素。EDIT-07-flatpak 要求应用本身已安装，只有 CLI 不算。
参数和数据边界仍归逻辑测试。

### 取色器 — COLOR-01…07

真实采样、鼠标键盘确认取消、最新像素仅提交一次；方向键一物理像素、Ctrl 及连按；颜色格式色块；边缘负坐标分数多屏；在途采样 grab 失败、关闭禁用重开，释放 modal 信号并恢复输入。

长期模拟入口：[color-picker/sampling.smoke.js](simulation/color-picker/sampling.smoke.js), [color-picker/movement.smoke.js](simulation/color-picker/movement.smoke.js), [color-picker/lifecycle.smoke.js](simulation/color-picker/lifecycle.smoke.js).

验证边界 / 缺口：sampling 在真实色块上原生分发；movement 注入 picker 缩放及 handler，并非真实分数屏证据；lifecycle 控制在途采样并验锁屏、模拟恢复。真实硬件坐标仍需单独验证。

### 同步连接、设备与 Channel — CONN-01…10

IP/HTTP/HTTPS/子路径/认证/非法地址；测试未保存输入不重启同步；快速测试应用重试关闭不重入；应用保存并立即更新设备和 Channel；稳定 DeviceId、Tag 和自由 icon/回退/本机不显示；缺失无权限移除 Channel 不串游标目的地。离线、慢服务、失效撤销和协议不兼容提供本地化错误；设置与 Shell 并发读写不丢字段、不泄露 Key。

长期模拟入口：[settings/icon.integration.js](simulation/settings/icon.integration.js), [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

原生入口：[sync/connection.native.js](simulation/sync/connection.native.js)、
[sync/native.js](simulation/sync/native.js)，通过 `tools/test-sync-server.py` 运行。CONN-02/03/04/05
操作完整独立 GTK 窗口及真实服务端，检查未保存输入测试、忙碌互斥、快速点击、在途关闭、立即应用
设备信息和失败重试。CONN-06-profile 从管理 API 验证身份/设备持久化，不代表 web 页面验收。
URL、认证和并发配置的数据组合仍归现有逻辑测试。

### 发布策略与持久化队列 — SEND-01…10

发送模式仅固定、文本图片阈值；请求前冻结清单；按服务器 Channel 设备恢复；关闭暂停且不为新复制入队；丢响应确认；删除隐私缺原文不回流；坏队列保存失败退避永久错误、确认关闭交错落盘。

长期模拟入口：[sync/toggle.smoke.js](simulation/sync/toggle.smoke.js), [sync/status.smoke.js](simulation/sync/status.smoke.js).

原生入口：[sync/native.js](simulation/sync/native.js)、[sync/queue.native.js](simulation/sync/queue.native.js)、
[sync/local-boundary.native.js](simulation/sync/local-boundary.native.js)。真实服务端接收手动/自动/仅固定、
各 MIME 策略、精确阈值，并检查关闭期间不补传、确认落盘。独立流式 HTTP gate 挂起实际请求或丢弃
一次真实完成响应，检查冻结清单、中断/删除与幂等恢复，不伪造 SyncClient 结果。损坏、退避和完整
目的地矩阵仍归逻辑测试。

### 接收、增量与懒加载 — RECV-01…10

关闭历史激活模式；中途加入分页重放游标；本机获取阈值；直接下载或请求来源等待下载；并发复用，来源离线删除隐私过期和取消；全部表示完整；拒绝迟到覆盖；本地与 Channel 删除区分及校验后的设备缓存。

长期模拟入口：[sync/receive.smoke.js](simulation/sync/receive.smoke.js).

原生入口：[sync/native.js](simulation/sync/native.js)、[sync/network.native.js](simulation/sync/network.native.js)。
独立进程使用生产来源客户端/存储及真实服务端，覆盖接收模式、本机阈值、服务端和接收端均 lazy、
并发复用、来源拒绝、多表示持久化/离线主内容复用、迟到保护、本地与服务端删除。gate 控制真实
下载字节的时序。这是一台真实 Shell 加独立来源进程，不等于两台真实桌面或全部分页边界。

### 传输状态、恢复与错误 — XFER-01…09

未发送等待传输校验快照完成原文完整失败区分；字节精确单调和迟到保护；恢复不逐项保存重建；会话取消等待者清理；非法过大中断响应；长度 hash 和 part 清理；GLib 与可选 sha256sum 及缺依赖。

长期模拟入口：[sync/status.smoke.js](simulation/sync/status.smoke.js), [sync/toggle.smoke.js](simulation/sync/toggle.smoke.js).

XFER-02 观察真实上传及远端精确总量；XFER-02-download 限速实际响应，要求中间进度、每个传输内的
单调精确字节和最终剪切板 hash；XFER-04 恢复服务端 20 条完成记录，观察恢复阶段无逐条 render、
persist、save。它们补充而非重复 logic/sync/{transfers,http-failures,file-verifier}.test.js。
压力与各校验路径的内存预算仍显式选跑，不加入普通 CI。

### 设置、快捷键与恢复默认 — SET-01…09

当前页面配置及边界，区分内部停用键；强调色前景文字图标、尺寸布局隐藏（不禁用快捷键）；组合键录制取消清空冲突重绑；发现和手输排除；恢复默认二次确认，保留用户数据连接身份且后续可保存；关于版本链接。

长期模拟入口：[settings/window.smoke.js](simulation/settings/window.smoke.js), [settings/foreground.smoke.js](simulation/settings/foreground.smoke.js), [settings/layout.smoke.js](simulation/settings/layout.smoke.js), [settings/icon.integration.js](simulation/settings/icon.integration.js), [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

原生入口：[settings/native.js](simulation/settings/native.js)。SET-01 遍历八个真实页面；SET-06 在独立
GTK 中录制、取消、清空组合键；SET-08 操作恢复默认的两个确认分支、保留身份/语句，并确认之后还能
保存设置。主题、布局、排除和外链仍有各自的组件/数据归属，不声称所有 GUI 均已完整验收。

### 多语言、通知与视觉 — LANG-01…07

目录提取编译占位符安全；菜单设置错误通知对话框实显语言；英中日韩 RTL 长译文；基线光标偏移、主题对比 hover 选中、省略缩略图图标分割滚动条；通知适量不泄密，截图取消复用 SHOT。

长期模拟入口：[shell.smoke.js](simulation/shell.smoke.js).

原生入口：[settings/language.native.js](simulation/settings/language.native.js)，LANG-02 分别使用
`--language en_US`、`zh_CN`、`ja`、`ko`，检查实际菜单、分词、独立设置窗口及空编辑命令通知。
必须生成非 C 的基础消息 locale，C.UTF-8 会忽略 gettext 的 LANGUAGE 选择。目录完整性仍归
logic/i18n/coverage.sh；翻译质量、RTL/长文本布局和视觉效果仍人工验收。

### 响应度、资源、打包与工具 — OPS-01…08

测完整操作主循环停顿而非只测回调返回；区分网络等待，跟踪内存 FD source 及各校验路径预算；可选十倍压力；运行包无多余内容敏感信息；开发桌面构建隔离语言退出日志。

验证边界 / 缺口：使用现有 logic/sync 测量压力、logic/common 检查和 tools/check_release.py；压力显式选跑，不加普通 CI。打包复用 ENV-01 证据；异步 API 或单次成功不证明 Shell 永不卡顿。

## 重复测试审查与处理

### 原生验收补充

统一入口 `tools/test-simulation.py` 除剪切板外，还维护以下原生操作链；可用 `--case` 精确选择。
这里是覆盖范围，不是整个功能 ID 的完成认证。

| 模块 | ID | 实际验证及边界 |
| --- | --- | --- |
| `clipboard/applications.native.js` | CLIP-02-firefox/chromium/office | 实际本地 HTML/RTF、私有 profile、原生复制和独立 MIME 回读；依赖图形应用 |
| `clipboard/policy.native.js` | PRIV-01/03/04/05/07、HIST-01/04/10 | 实际 GTK owner、敏感 MIME、真实窗口排除、在途取消、固定项重启排序、Unicode 搜索、真实文件替换错误；不等于真实密码管理器或磁盘满兼容性 |
| `phrases/native.js` | PHRASE-01/02/04/05/06/07 | 原生输入/提交、Esc、独立目标收到复制/粘贴/模拟输入、关闭策略、延迟保存与实际 IO 失败重试；不覆盖全部 IME 或冷 Shell 恢复 |
| `word-selection/native.js` | WORD-05/06/07/08、SELECT-01/03/04/06/07 | 真实行入口、选择结果回读、2000 边界/配置、长文 heartbeat、迟到处理、拖选、持续 Shift 连选、滚动和退出清理 |
| `terminal/native.js` | TYPE-01/03/05/06/07 | 独立 GTK 目标、两档混合语言逐字一致、等待真实 backend 修饰键、熔断一次及队列取消、实际禁用重开不继续输入 |
| `sync/native.js` | CONN-06-profile、SEND-01/01-pinned/02/03/06/10、RECV-01/03/04/09、XFER-02/04 | 真实服务端/来源、持久化和实际传输 |
| `sync/connection.native.js` | CONN-02/03/04/05 | 完整 GTK 测试/应用/失败重试和在途关闭 |
| `sync/network.native.js` | RECV-05/06/07/08、XFER-02-download | 实际下载门控、来源失败、迟到选择及精确进度 |
| `sync/queue.native.js` | SEND-04/07/08 | 冻结清单、中断/删除、完成响应丢失 |
| `sync/local-boundary.native.js` | PHRASE-08、PRIV-08 | 活跃同步下本地数据边界；不代替日志脱敏审计 |
| `settings/native.js`、`settings/language.native.js` | SET-01/06/08、LANG-02 | 完整独立设置、原生录制/重置和实际翻译目录 |
| `word-selection/dictionary.native.js` | DICT-02/06/08（含 DICT-07） | 本地/网络导入、多来源、刷新保留、编辑器和目录 |
| `screenshot/native.js`、`screenshot/editor.native.js` | SHOT-03/04、EDIT-01/06/07-native/07-flatpak | 真实门户/取消、stdin 和 Gradia 画布 |
| `color-picker/native.js` | COLOR-01/03/04/07 | 真实色块、像素移动、格式和禁用重开 |

SELECT-01 直接复用已有 drag 实现，包含 SELECT-02 范围；SELECT-03 复用 viewport；表单和 Esc
也复用同一函数，不复制一份测试。仅以这些原生用例替代“调用 handler 就代表用户操作”的结论，
原有逻辑测试仍负责数据边界。

WORD-07 测量普通 2000 词、10 万字符 URL 和 20 万字符无空白文本，以 1000ms 主循环间隔为预算，
记录样本长度、词数和最大间隔。不扩大预算、跳过失败或修改插件代码把测试变绿。虚拟修饰键
熔断不证明物理键盘事件一定送达，也不证明绕过输入法。CI 范围未扩大。

| 原有重叠 | 处理 |
| --- | --- |
| 面板尺寸 | PANEL-03 负责完整矩阵和覆盖值，删除综合入口较小的副本。 |
| 外层 popup 高度完全相等 | 移除这个额外且不合适的约束：不同面板、Shell 版本的标题和 footer 装饰有差异。PANEL-03 按已对齐要求检查配置尺寸，不要求外层装饰等高。 |
| 隐藏锚点及直接 toggle | PANEL-01/02 负责真实输入显示配置，移除条目测试副本。 |
| 初始焦点、Ctrl+F、方向和边界 | PANEL-06/07/08 负责导航，移除语句分词 handler 副本，保留 Unicode 搜索。 |
| 语句 Enter 和直接基础保存 | phrases/form 统一主和小键盘 Enter、按钮；integration 保留不同的草稿失败竞态。 |
| 图片编辑夹带同步开关 | sync/toggle 负责状态焦点条目身份，images 仅负责原图编辑。 |
| 图片与隐私重复敏感拒绝 | clipboard/privacy 负责手动拒绝磁盘边界，sync/status 保留自动策略进度和会话重试。 |
| 修饰键等待及额外直接固定 | terminal/lifecycle 负责等待释放清理，guard 保留事件过滤；固定保留快捷键，移除额外直接 toggle。 |
| 名称类似但失败边界不同 | 保留往返与待执行恢复、普通与裁剪拖选、正常与延迟采样，不误删。 |
| 兼容性、PANEL-10 与 input-mode | 调用同一验证函数，不是重复实现；多个显式套件运行不重复计算功能覆盖。 |

综合入口 [shell.smoke.js](simulation/shell.smoke.js) 只编排领域检查，**不是全部模拟测试的入口**。
CI 仍只运行原有兼容性子集。本次不改插件功能、CI 范围和压力策略。

补测试先找已有归属，优先扩充边界；跨领域以引用复用证据（隐私/上传取消、打包/安装、通知/取消），
不再复制场景。每次验收结果另存，不把本清单当通过矩阵。纯 CSS、成熟控件普通属性、文档措辞、
release 排版不新增永久断言。物理键盘/IME、双桌面激活竞态、未安装应用和视觉仍需独立证据。
