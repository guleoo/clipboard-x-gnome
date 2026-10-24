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

验证边界 / 缺口：CI 仅覆盖生命周期子集。冷覆盖和同 XDG 的两进程重开需单独记录；旧临时探针不算长期入口。在途操作需分别确认取消点。

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

验证边界 / 缺口：浏览器/办公来源（CLIP-02）和 XWayland 兼容性还需实际应用；GTK 多 MIME 夹具不代替它们。

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

验证边界 / 缺口：数据网络使用 logic/clipboard/tokenizer/dictionary.test.js；GTK 销毁覆盖部分在途操作，不代表导入编辑刷新全流程或大文件测时通过。

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

验证边界 / 缺口：pipeline 注入门户 URI、编辑回调和阶段身份变化；cancel 还操作真实 ScreenshotUI。成功截图和每种后端目标需单独验收；logic/screenshot 覆盖协议。

### 图片编辑 — EDIT-01…07

空命令不取原图；%u/%f/%i/%%、引号和路径；非法占位符命令文件 URI；本地缓存 lazy 原图和离线边界；慢启动不读 stdin 提前退出不卡 Shell；真实原生和 Flatpak Gradia，面板关闭和编辑器生命周期。

长期模拟入口：[clipboard/images.smoke.js](simulation/clipboard/images.smoke.js).

验证边界 / 缺口：Shell 使用 /usr/bin/true 和原图探针；logic/screenshot/tools.test.js 用受控 stdin 子进程，均不代替真实 Gradia/Flatpak 验收。

### 取色器 — COLOR-01…07

真实采样、鼠标键盘确认取消、最新像素仅提交一次；方向键一物理像素、Ctrl 及连按；颜色格式色块；边缘负坐标分数多屏；在途采样 grab 失败、关闭禁用重开，释放 modal 信号并恢复输入。

长期模拟入口：[color-picker/sampling.smoke.js](simulation/color-picker/sampling.smoke.js), [color-picker/movement.smoke.js](simulation/color-picker/movement.smoke.js), [color-picker/lifecycle.smoke.js](simulation/color-picker/lifecycle.smoke.js).

验证边界 / 缺口：sampling 在真实色块上原生分发；movement 注入 picker 缩放及 handler，并非真实分数屏证据；lifecycle 控制在途采样并验锁屏、模拟恢复。真实硬件坐标仍需单独验证。

### 同步连接、设备与 Channel — CONN-01…10

IP/HTTP/HTTPS/子路径/认证/非法地址；测试未保存输入不重启同步；快速测试应用重试关闭不重入；应用保存并立即更新设备和 Channel；稳定 DeviceId、Tag 和自由 icon/回退/本机不显示；缺失无权限移除 Channel 不串游标目的地。离线、慢服务、失效撤销和协议不兼容提供本地化错误；设置与 Shell 并发读写不丢字段、不泄露 Key。

长期模拟入口：[settings/icon.integration.js](simulation/settings/icon.integration.js), [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

验证边界 / 缺口：配合 logic/ui/sync-connection* 和 logic/sync/configuration*；HTTP/GTK 夹具不证明真实服务端设备发现和管理页面已更新。

### 发布策略与持久化队列 — SEND-01…10

发送模式仅固定、文本图片阈值；请求前冻结清单；按服务器 Channel 设备恢复；关闭暂停且不为新复制入队；丢响应确认；删除隐私缺原文不回流；坏队列保存失败退避永久错误、确认关闭交错落盘。

长期模拟入口：[sync/toggle.smoke.js](simulation/sync/toggle.smoke.js), [sync/status.smoke.js](simulation/sync/status.smoke.js).

验证边界 / 缺口：logic/sync/upload-queue.test.js 负责队列目的地边界；Shell 负责确认落盘和接线；敏感拒绝复用 PRIV。真实多端中断上传需隔离服务器。

### 接收、增量与懒加载 — RECV-01…10

关闭历史激活模式；中途加入分页重放游标；本机获取阈值；直接下载或请求来源等待下载；并发复用，来源离线删除隐私过期和取消；全部表示完整；拒绝迟到覆盖；本地与 Channel 删除区分及校验后的设备缓存。

长期模拟入口：[sync/receive.smoke.js](simulation/sync/receive.smoke.js).

验证边界 / 缺口：Shell 注入客户端结果，logic/sync/{receive,client,http-client}.test.js 使用受控服务；完整 lazy 来源互操作需真实服务端和两个独立客户端。

### 传输状态、恢复与错误 — XFER-01…09

未发送等待传输校验快照完成原文完整失败区分；字节精确单调和迟到保护；恢复不逐项保存重建；会话取消等待者清理；非法过大中断响应；长度 hash 和 part 清理；GLib 与可选 sha256sum 及缺依赖。

长期模拟入口：[sync/status.smoke.js](simulation/sync/status.smoke.js), [sync/toggle.smoke.js](simulation/sync/toggle.smoke.js).

验证边界 / 缺口：配合 logic/sync/{transfers,http-failures,file-verifier}.test.js；注入状态或按钮信号不代表真实网络吞吐和完整启动耗时；分别测量校验路径。

### 设置、快捷键与恢复默认 — SET-01…09

当前页面配置及边界，区分内部停用键；强调色前景文字图标、尺寸布局隐藏（不禁用快捷键）；组合键录制取消清空冲突重绑；发现和手输排除；恢复默认二次确认，保留用户数据连接身份且后续可保存；关于版本链接。

长期模拟入口：[settings/window.smoke.js](simulation/settings/window.smoke.js), [settings/foreground.smoke.js](simulation/settings/foreground.smoke.js), [settings/layout.smoke.js](simulation/settings/layout.smoke.js), [settings/icon.integration.js](simulation/settings/icon.integration.js), [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

验证边界 / 缺口：logic/ui 覆盖设置模型。不声称全部 GUI 覆盖：真实快捷键录制、外链、重置确认和主题交互需专项界面人工证据，组件销毁不是同一行为。

### 多语言、通知与视觉 — LANG-01…07

目录提取编译占位符安全；菜单设置错误通知对话框实显语言；英中日韩 RTL 长译文；基线光标偏移、主题对比 hover 选中、省略缩略图图标分割滚动条；通知适量不泄密，截图取消复用 SHOT。

长期模拟入口：[shell.smoke.js](simulation/shell.smoke.js).

验证边界 / 缺口：logic/i18n/coverage.sh 验翻译目录，综合入口翻译模式验搜索 placeholder；不能证明翻译质量或全部通知。视觉人工验收，不做 CSS 字符串快照。

### 响应度、资源、打包与工具 — OPS-01…08

测完整操作主循环停顿而非只测回调返回；区分网络等待，跟踪内存 FD source 及各校验路径预算；可选十倍压力；运行包无多余内容敏感信息；开发桌面构建隔离语言退出日志。

验证边界 / 缺口：使用现有 logic/sync 测量压力、logic/common 检查和 tools/check_release.py；压力显式选跑，不加普通 CI。打包复用 ENV-01 证据；异步 API 或单次成功不证明 Shell 永不卡顿。

## 重复测试审查与处理

### 原生验收补充

统一入口 `tools/test-simulation.py` 除剪切板外，还维护以下原生操作链；可用 `--case` 精确选择。
这里是覆盖范围，不是整个功能 ID 的完成认证。

| 模块 | ID | 实际验证及边界 |
| --- | --- | --- |
| `clipboard/policy.native.js` | PRIV-01/03/04/05/07、HIST-01/04/10 | 实际 GTK owner、敏感 MIME、真实窗口排除、在途取消、固定项重启排序、Unicode 搜索、真实文件替换错误；不等于真实密码管理器或磁盘满兼容性 |
| `phrases/native.js` | PHRASE-01/02/04/05/06/07 | 原生输入/提交、Esc、独立目标收到复制/粘贴/模拟输入、关闭策略、延迟保存与实际 IO 失败重试；不覆盖全部 IME 或冷 Shell 恢复 |
| `word-selection/native.js` | WORD-05/06/07/08、SELECT-01/03/04/06/07 | 真实行入口、选择结果回读、2000 边界/配置、长文 heartbeat、迟到处理、拖选、持续 Shift 连选、滚动和退出清理 |
| `terminal/native.js` | TYPE-01/03/05/06/07 | 独立 GTK 目标、两档混合语言逐字一致、等待真实 backend 修饰键、熔断一次及队列取消、实际禁用重开不继续输入 |

SELECT-01 直接复用已有 drag 实现，包含 SELECT-02 范围；SELECT-03 复用 viewport；表单和 Esc
也复用同一函数，不复制一份测试。仅以这些原生用例替代“调用 handler 就代表用户操作”的结论，
原有逻辑测试仍负责数据边界。

WORD-07 保留失败断言：在本轮 GNOME 50/51 软件渲染测试中，10 万字符 URL 和 20 万字符无空白
文本造成数秒至约 20 秒主循环停顿，超过 1000ms 交互预算；普通 2000 词明显更快。入口会记录
各样本长度、词数及最大间隔，不扩大预算、跳过或通过修改插件代码把结果变绿。虚拟修饰键熔断
不证明物理键盘事件一定送达，也不证明绕过输入法。CI 范围未扩大。

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
release 排版不新增永久断言。模拟输入的物理键盘/IME、真实服务端多端、真实编辑器和视觉需补独立证据。
