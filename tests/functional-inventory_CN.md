# 功能测试清单

> 简体中文 · [English](functional-inventory.md)

这是长期维护的**验收范围和归属**，不是通过报告。入口存在只代表覆盖部分边界，不代表已在
GNOME 50/51 通过。执行结果另见[验收快照](acceptance-status_CN.md)；单个用例通过不等于整个功能 ID 的全部边界通过。

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

## 剩余缺口补充入口（2026-10-28）

下表补充自动验证归属，不代表所有剩余项目均已补齐；运行结果另见验收快照。

| 功能点 | 唯一补充入口与验证边界 |
| --- | --- |
| SHOT-02/05 | `logic/screenshot/tools.test.js`：v2/v3 目标能力/拒绝矩阵，真实类型的 D-Bus 异常、清理和同实例重试；不伪装已遍历全部门户部署。 |
| RECV-06 / XFER-06 | `logic/sync/transfer-session.test.js`：失败/过期/取消终态结束所有共享等待者；真实短超时、一次远端取消及新传输重试。受控传输层，不冒充真实来源离线。 |
| TYPE-03/04 | `simulation/terminal/native.js`：标准/慢速分别注册为独立 case，前者失败不能阻止慢速执行，字符回读预期不变。 |
| COLOR-06 | `simulation/color-picker/failures.native.js`：实际取色器初始化拒绝、原生 grab 边界抛错、modal/chrome/订阅清理及正常重开；断言在测试清理之前执行。 |
| SET-01 | `SET-01-official` 点击生产设置入口，官方宿主关闭再打开；原 SET-01 仍唯一负责八页导航。 |
| SET-03 | `simulation/settings/colors.native.js`：原生 GTK 内置/自定义强调色、前景色、确认/取消与恢复系统；不验圆形/间距等视觉属性。 |
| LANG-07 / OPS-08 / PRIV-08 | `logic/sync/errors.test.js` 验证全部稳定错误码经过翻译且不暴露诊断；`LANG-07-errors` 验证真实 GNOME 通知、未知错误安全回退、原生 Gio 异常和取消零通知。其他出口的审计仍独立列出。 |
| CONN-07 / XFER-01 | `simulation/sync/presentation.native.js`：真实混合设备历史标记；独立设置驱动真实传输控件，逐态原生点击。受控动作只验 UI 接线，不冒充真实传输，后端行为继续归原有服务端用例。 |
| HIST-03 / SET-02 | `logic/clipboard/history/controller.test.js`：实际文件容量 32→16 MB，最旧普通项淘汰、Pin 保留、未下载原文不计本地预算，索引与 GC 一致；`SET-02` 原生补充小数 KB/MB、重开与外部刷新不误回写。 |
| RECV-06 / PRIV-06 | `logic/sync/receive.test.js`：请求拒绝、等待失败/过期/取消后预览和重试；`logic/sync/integration/backend.test.js` 的 `RECV-06-offline-source` / `RECV-06-sensitive-source` / `RECV-06-missing-source` 运行真实来源关闭→超时取消→重开，以及来源改为敏感/原文件被删→拒绝原文→恢复重试。 |
| SET-06 | `SET-06-global-actions` 在面板关闭时验证隐私/清空两个真实 WM 快捷键、解绑和重绑，不复制录制控件矩阵。 |
| LANG-02/03/07 | 既有 `LANG-02` 与 `LANG-07-errors` 显式四语言双版本；`LANG-03 --language ar/de` 验证实际方向、窄面板长文本操作/完整复制及长译文设置可达；`LANG-07-dictionary --language zh_CN` 保留真实词库错误正文的本地化断言。字形和视觉质量仍人工。 |
| OPS-01/02/03 | 既有 `XFER-02` / `XFER-02-download` 同时测精确字节、实际内容和全过程最大主循环间隙；`OPS-03-bounded` 预热 2 轮后启停 10 轮，断言 UI/名称/快捷键清理并记录 RSS/FD 趋势，不冒充数小时 soak。 |
| CONN-01/09 | 无图形 `CONN-01-tls-prefix` / `CONN-09-protocol` 通过真实后端验证私有 CA 信任、代理前缀、请求头和协议恢复；原生 `CONN-09-protocol-feedback` 负责实际 GTK 翻译提示与 busy 接线。 |
| SET-03/09 | `SET-03-system` 改真实桌面主题/强调色并用独立主题探针，验证自定义颜色隔离和恢复系统；`SET-09-failure` 只在外部 URI 边界注入一次真实原生 Gio 失败，验证中文提示、关闭和设置继续可用。 |
| OPS-03 | `sync/resources.native.js` 补 2 轮预热＋8 轮真实上传/接收/轮询/刷新/开关，以 Shell 自有 TCP、任务所有权和暂存文件断言释放；RSS/FD 只记录趋势，不冒充长期无泄漏。 |
| TYPE-08 / EDIT-07 | 可选 `applications` 镜像：`TYPE-08-ime` 使用实际 libpinyin、Gtk preedit 和中英文模式普通按键正控；既有 Gradia 原生/Flatpak 用例验证实际图片画布，安装依赖本身不算通过。 |
| OPS-03/07 | 仅显式选择的 `OPS-03-soak` 复用真实同步清理断言，固定实际数据集、周期重启插件并记录两小时趋势；`OPS-07-devkit` 跑真实构建/启动/私有配置/正常关窗/journal 完整链，参数和注入失败规则继续归逻辑测试。 |

## 验收层级

功能点不要求一律经过桌面。排序、保留策略、捕获取消状态、草稿修订、分词边界、词库文件规则、
上传队列、分页与校验，以无图形逻辑/文件/HTTP 集成为主要验收证据；真实服务端也不等于模拟桌面。
这些规则测试通过后，不再因缺少重复的 Shell 数据矩阵标为“部分通过”。

同一功能确有界面接线时，只保留代表性操作链：例如 Pin 后重启、刷新词库后的可见结果、
输入框异步保存后不抢焦点、真实 owner 变化、进度 actor 或系统截图取消。焦点、拖选、模态、
真实剪切板所有权、Shell 主循环及崩溃回归仍必须在模拟桌面验证，不能以模型通过替代。
逻辑失败仍是失败；转移测试层级不能消除已发现的问题，也不代表磁盘满、物理断电等条件已实测。

## 功能点与测试归属

### 安装、启动与生命周期 — ENV-01…08

| ID | 要测什么 / 预期结果 |
| --- | --- |
| ENV-01 | 从当前 ZIP 新装，metadata、Schema、翻译和资源完整，扩展系统识别正确；不要求第三方扩展管理器图形列表。 |
| ENV-02 | 覆盖安装后，在重新启动的独立 Shell 中加载新版代码；同一 Shell 内不要求热更新。 |
| ENV-03 | 全新数据目录、已有正常数据目录分别启动，不用空启动快照覆盖原数据。 |
| ENV-04 | 启用、禁用、立即重新启用、连续启停；无重复入口、失效快捷键或重复捕获。 |
| ENV-05 | 初始化、保存、下载、分词、截图或模拟输入中禁用，取消自有任务并拒绝迟到回调。系统截图界面允许保留；禁用后完成/取消截图应正常释放模态，Shell 可交互，且不恢复插件副作用。 |
| ENV-06 | 关闭独立Shell后重新打开，恢复历史和上传队列；不将损坏状态当成功。不要求真实注销/登录、物理断电或未落盘数据的崩溃恢复。 |
| ENV-07 | 禁用后自有信号、定时器、modal grab、虚拟设备、HTTP 会话与等待消费者正确释放；系统自有截图模态按 ENV-05 在用户完成/取消后验收。 |
| ENV-08 | 设置进程与 Shell 进程独立运行，无 Meta/Adw 导入错误；设置关闭后无悬挂操作。 |

长期模拟入口：[lifecycle/compatibility.smoke.js](simulation/lifecycle/compatibility.smoke.js), [terminal/lifecycle.smoke.js](simulation/terminal/lifecycle.smoke.js), [settings/window.smoke.js](simulation/settings/window.smoke.js), [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

冷启动入口：`tools/test-lifecycle.py` 和 [lifecycle/cold.smoke.js](simulation/lifecycle/cold.smoke.js)。
ENV-02/06 在私有 XDG 安装并核验文件，使用不同 Shell PID 共用数据，检查固定排序、快捷语句、
DeviceId 及绑定目的地的离线上传队列。不指定 `--previous` 仅代表同包冷覆盖，不代表旧版本升级。
在途操作仍需分别确认取消点；CI 范围不变。

### 面板入口、导航与现场 — PANEL-01…10

| ID | 要测什么 / 预期结果 |
| --- | --- |
| PANEL-01 | 顶栏点击打开/关闭，全局快捷键打开/再次按下关闭，桌面空白处关闭。 |
| PANEL-02 | 隐藏顶栏入口后仍可通过快捷键打开，九宫格锚点和正负偏移落在有效工作区。 |
| PANEL-03 | 主面板、分词、快捷语句按配置正常变更宽高；单面板尺寸覆盖不影响其他面板。不要求自动限制为工作区大小。 |
| PANEL-04 | 保留现场开/关时正确恢复或重置当前面板；关闭动画不先闪回历史面板。 |
| PANEL-05 | 从历史第 N 条进入分词后返回，搜索、滚动、条目及按钮焦点不跳回顶部。 |
| PANEL-06 | 首次导航目标正确：历史搜索框、首个分词、首个快捷语句或空列表的加号。 |
| PANEL-07 | 方向键按焦点矩阵移动，跳过隐藏控件；不等长行、首尾、返回和底部按钮正确。 |
| PANEL-08 | 焦点限制开/关符合配置；面板外或其他插件不被本插件局部快捷键拦截。 |
| PANEL-09 | 导航到不可见条目会滚动；用户鼠标滚动不被旧的异步恢复覆盖。 |
| PANEL-10 | 键鼠高亮及tooltip跟随最近实际输入，不被静止hover或迟到提示干扰；实际移动到有效控件后，方向键及激活操作从该控件接续。悬停不打断输入框编辑，滚轮不重定位焦点；业务选中状态不变，切面板、关闭和禁用时正确清理。 |

长期模拟入口：[panels/navigation.smoke.js](simulation/panels/navigation.smoke.js), [panels/monitors.smoke.js](simulation/panels/monitors.smoke.js), [panels/restoration.smoke.js](simulation/panels/restoration.smoke.js), [panels/search.smoke.js](simulation/panels/search.smoke.js), [panels/escape.smoke.js](simulation/panels/escape.smoke.js).

验证边界 / 缺口：使用 tools/test-panels.sh。restoration 补异步刷新竞态；search 补 Unicode、选区、修饰键、小键盘；escape 验证先收表单及返回/关闭配置。超大面板不要求自动缩小。物理显示器及视觉仍需人工验收。

### 文本与图片捕获、复用 — CLIP-01…12

| ID | 要测什么 / 预期结果 |
| --- | --- |
| CLIP-01 | 独立应用复制短文本、多行、Tab、长文本、中文/英文、emoji、组合字符；记录与复制回读一致。 |
| CLIP-02 | 实际 Chromium 复制同时提供纯文本和 HTML，表示去重正确，优先正文与预览正确。 |
| CLIP-03 | 空 HTML、仅 meta/标签、空白与无效表示不会制造伪条目；有效富文本不误删。 |
| CLIP-04 | PNG/JPEG/WebP/GIF/SVG 等实际可提供的图像表示可捕获；失败有反馈，不永久卡在捕获中。 |
| CLIP-05 | 宽图、长图、大分辨率图片缩略图等比；复制/编辑使用原图，不使用缩略图。 |
| CLIP-06 | 捕获大小在阈值前、等于、超过边界时行为正确，截断数据不能冒充完整正文。 |
| CLIP-07 | 快速连续复制、延迟提供内容、来源应用退出或 owner 变化，不混合来源、不接受旧结果。 |
| CLIP-08 | 重复复制、选择自身历史、远端写回剪切板不循环增加记录；不丢固定状态。 |
| CLIP-09 | 点击条目或 Enter 真正把原内容写回系统剪切板；失败和已失效条目不能伪装成功。 |
| CLIP-10 | 条目的 Pin/Delete/分词/编辑/同步按钮不误触内容复制；删除后后续内容仍可捕获。 |
| CLIP-11 | Ctrl+点击只对文本执行模拟输入，不意外复制或触发系统组合键。 |
| CLIP-12 | 去首尾空白开/关仅作用于新纯文本，内部空白不变，HTML 原始格式不被重写。 |

长期模拟入口：[clipboard/capture.smoke.js](simulation/clipboard/capture.smoke.js), [clipboard/entries.smoke.js](simulation/clipboard/entries.smoke.js), [clipboard/images.smoke.js](simulation/clipboard/images.smoke.js).

原生入口：[clipboard/native.js](simulation/clipboard/native.js)，由 `tools/test-simulation.py --group clipboard` 运行。
CLIP-01、04～11 使用独立 GTK Wayland 来源/接收端，覆盖多语言、多行长文、PNG/JPEG/WebP/GIF/SVG、
缩略图比例与原图回读、捕获大小边界、暂停/退出/快速 owner、去重、真实点击/Enter、操作隔离和 Ctrl+点击。
CLIP-03、12 的数据规则仍归逻辑测试，不重复搬入 Shell。

CLIP-02 的[实际应用条件用例](simulation/clipboard/applications.native.js)只使用私有 Chromium
profile、本地 HTML，原生复制后由独立 GTK 回读文本/HTML hash；浏览器原图还校验
尺寸和像素。需要安装实际应用和图形后端。XWayland 仍需独立证据；GTK 多 MIME 夹具不代替这些来源。

### 搜索、排序、保留与持久化 — HIST-01…10

| ID | 要测什么 / 预期结果 |
| --- | --- |
| HIST-01 | Pin/unpin、重启、多来源混合后固定项仍置顶；其余排序及重复项行为一致。 |
| HIST-02 | 历史数量、存储容量、保留天数限制只淘汰应淘汰的普通项；全为固定项时保留策略明确。 |
| HIST-03 | 清空历史保留固定项；修改限额及 lazy 原文下载后重新执行容量策略。 |
| HIST-04 | 搜索空串、大小写、中文、emoji、前后空白、无匹配与结果上限。 |
| HIST-05 | 搜索范围按当前实现的 preview.text 验收，不把它宣传或测试成全文检索。 |
| HIST-06 | 启动读取中复制、保存中增删/固定、禁用后立即启用，最终磁盘状态不回退。 |
| HIST-07 | 按来源 DeviceId 分目录；共享对象删一条不误删另一条，最后引用释放后回收。 |
| HIST-08 | staging 到稳定对象的采用、删除和读取交错，不丢原图、不越出受管目录。 |
| HIST-09 | 坏索引、单项损坏、缺对象、hash 错、符号链接或越界路径安全处理，其余有效数据可恢复。 |
| HIST-10 | 不可写、空间不足、写中断时不破坏旧文件；错误不被隐藏，临时文件得到清理。 |

逻辑入口：[history/order.test.js](logic/clipboard/history/order.test.js)、
[history/storage.test.js](logic/clipboard/history/storage.test.js)、
[history/controller.test.js](logic/clipboard/history/controller.test.js)。排序、淘汰、保存交错和真实文件故障
在这一层验收；模拟桌面仅保留 HIST-01 的 Pin→保存→重启→取消固定，以及 HIST-04 的搜索操作。
跨 Shell 冷恢复复用 ENV-02/06。真实文件替换失败不等于磁盘满或物理断电已实测。

### 隐私记录边界 — PRIV-01/02/05

| ID | 要测什么 / 预期结果 |
| --- | --- |
| PRIV-01 | 隐私模式默认状态与切换即时生效，隐私模式开启期间新复制不进入历史。 |
| PRIV-02 | 仅内存条目可在当前生命周期使用，不落盘、不上传，插件禁用或重启后消失。 |
| PRIV-05 | 开启停止记录时，正在捕获的旧内容不能晚到后进入历史；已产生的临时内容被清理，之后正常捕获可恢复。 |

入口：[clipboard/policy.native.js](simulation/clipboard/policy.native.js) 的 PRIV-01/02/05，
及 [capture.test.js](logic/clipboard/capture.test.js) 的取消规则、真实解码和临时图片清理。

本组只验收“不记录 / 仅内存 / 在途切换”三条边界，不要求实际密码管理器，也不展开
Pin、清空、错误重试或多格式组合。仅内存沿用现有敏感内容策略，用一个带标记的受控来源提供输入；
这不是新增隐私模式选项，隐私开关本身仍表示停止自动捕获。
原 PRIV-03/07 合并到 PRIV-02，不保留重复用例。

### 应用排除 — PRIV-04

| ID | 要测什么 / 预期结果 |
| --- | --- |
| PRIV-04 | 排除运行中的应用和手动 window class 均正确；恢复后正常捕获，数据规整规则归逻辑测试。 |

真实窗口接线由 PRIV-04 负责；在途策略/格式矩阵归 capture.test.js，设置发现/手输入口复用 SET-07。
此项与隐私模式分开验收，不因应用发现或密码管理器兼容性阻碍隐私开关通过。

### 分词算法与限制 — WORD-01…08

| ID | 要测什么 / 预期结果 |
| --- | --- |
| WORD-01 | 中/英/日/韩及其余支持语言的基本切分不丢字符、标点、空白，原文位置正确。 |
| WORD-02 | 英文缩写 can't、相邻句 that.I、链接、邮箱、数字、路径和混合语种被正确识别。 |
| WORD-03 | emoji、组合字符、全角符号、换行与连续空白不损坏。 |
| WORD-04 | 相邻和不相邻词按原文顺序重建，标点及间隔规则符合当前设计。 |
| WORD-05 | 复制、粘贴、模拟输入使用同一选择结果；空选择时底部复制按钮不可用，快捷键按聚焦词回退规则处理，不误操作。 |
| WORD-06 | 默认 2000 项、恰好等于、超过及配置调整，超限明确拒绝、不静默截断。 |
| WORD-07 | 内置输入上限为 20,000 个 Unicode 字符（不是字节/词数）；恰好允许，超过在词库与分词之前拒绝，不截断、不创建控件，后续正常输入可恢复，主循环不冻结。 |
| WORD-08 | 点击分词后先进入面板显示加载，完成后显示词；等待时返回、关闭、改选其他条目或禁用插件，原来的任务完成后不能自动跳回，也不能替换新条目的内容。 |

长期模拟入口：[word-selection/keyboard.smoke.js](simulation/word-selection/keyboard.smoke.js).

验证边界 / 缺口：算法数据边界归 logic/clipboard/tokenizer；Shell 检查控件和结果，不证明全部语言或目标应用接收。长文响应度需测时，不只检查输出。

### 分词鼠标与键盘 — SELECT-01…07

| ID | 要测什么 / 预期结果 |
| --- | --- |
| SELECT-01 | 单击选中/取消；鼠标松开后仅悬停不继续连选。 |
| SELECT-02 | 按住 A→C 选 ABC，仍按住退回 B 只保留 AB；从已选起点开始连续反选。 |
| SELECT-03 | 反向拖动、跨行、滚动、裁剪区域、面板外释放不会选错或卡在拖选状态。 |
| SELECT-04 | Shift+方向键按起始项状态连选/反选，跨行和首尾行为正确。 |
| SELECT-05 | Space/Enter、返回、复制按钮和焦点边界走实际事件分发。 |
| SELECT-06 | 原文预览开/关；词区滚动、结果固定底部，不显示主面板 footer。 |
| SELECT-07 | 拖选中切换、关闭或禁用，立即释放选择会话，重开不沿用按住状态。 |

长期模拟入口：[word-selection/drag.smoke.js](simulation/word-selection/drag.smoke.js), [word-selection/viewport.smoke.js](simulation/word-selection/viewport.smoke.js), [word-selection/keyboard.smoke.js](simulation/word-selection/keyboard.smoke.js).

验证边界 / 缺口：drag 使用原生分发；keyboard 对 Shift 语义也直接调用 handler。viewport 的旧失败是焦点滚动后继续使用旧 Actor 坐标，现改为固定舞台点并检查实时 picking；不能再视作已证实的产品缺陷。纯返回/复制焦点导航归 PANEL。

### 词库与降级 — DICT-01…09

| ID | 要测什么 / 预期结果 |
| --- | --- |
| DICT-01 | 无匹配词库时使用系统分词器；按当前语言及区域匹配，不混用其他语言缓存。 |
| DICT-02 | 系统分词器和多个词库可分别启用；列表随语言变化，至少有可用来源或明确降级。 |
| DICT-03 | 本地合法 UTF-8 文件、词频、重复词、空文件和格式错误；缺少/非法 locale 声明拒绝导入。 |
| DICT-04 | 词库语言以导入时确定的归属为准，编辑文件头不会悄悄改归属。 |
| DICT-05 | 文件大小/词条数量在当前实现限制的前、等于、超过边界，失败不留半文件。 |
| DICT-06 | 添加 HTTP/HTTPS 网络词库及主动刷新，失败、语言变化、非法内容保留原可用版本。 |
| DICT-07 | 安装、启动、打开设置或分词不会偷偷下载；只有主动添加/刷新访问网络。 |
| DICT-08 | 默认编辑器、打开目录、删除入口可用；编辑器原子替换后重新分词加载新内容。 |
| DICT-09 | 并发加载复用、缓存失效、revision 改变和取消正确；大词库解析/建索引保持响应。 |

长期模拟入口：[settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

原生入口：[word-selection/dictionary.native.js](simulation/word-selection/dictionary.native.js)，以
`--language zh_CN` 运行。DICT-02 操作真实文件选择器和多来源开关；DICT-06 覆盖网络添加、主动刷新、
实际分词重载、失败保留、不偷偷下载（DICT-07）和删除；DICT-08 使用真实默认编辑器与文件管理器。
缺少应用/GVfs HTTP 支持标记 BLOCKED。数据限制仍归逻辑测试，大词库测时及全部后端变体仍有边界。

### 快捷语句 — PHRASE-01…08

| ID | 要测什么 / 预期结果 |
| --- | --- |
| PHRASE-01 | 真实点击加号展开并聚焦，实际输入后主 Enter/小键盘 Enter 或确认按钮保存、清空、收起。 |
| PHRASE-02 | 再次加号和 Esc 取消不保存；输入框普通文字不触发历史快捷动作。 |
| PHRASE-03 | 空白、trim、重复内容、最大长度、emoji、数量限制、新旧排序均符合当前策略。 |
| PHRASE-04 | 点击或 Enter 复制，v 粘贴、撇号模拟输入、Delete 删除；跟随对应快捷键配置。 |
| PHRASE-05 | 复制后关闭面板开/关，两种状态下实际剪切板内容正确。 |
| PHRASE-06 | 快速提交、延迟保存中改文/取消/切面板，不清掉新草稿、不抢回焦点。 |
| PHRASE-07 | 保存/删除失败、坏文件、重启恢复；不把写入失败显示为保存成功。 |
| PHRASE-08 | 仅本地保存；清空剪切板、切换同步配置不删除或上传快捷语句。 |

长期模拟入口：[phrases/form.smoke.js](simulation/phrases/form.smoke.js), [phrases/integration.smoke.js](simulation/phrases/integration.smoke.js).

验证边界 / 缺口：form 负责原生提交，integration 负责路由和保存竞态，logic/clipboard/phrases 负责存储；不证明 IME 输入或外部目标接收（TYPE）。

草稿修订、编辑后改回、重开、重叠提交及失败保留的完整矩阵归
[phrase-draft.test.js](logic/ui/phrase-draft.test.js)。原生 PHRASE-06 只保留延迟保存后新输入和焦点不丢的接线验证。

### 粘贴与模拟输入 — TYPE-01…09

| ID | 要测什么 / 预期结果 |
| --- | --- |
| TYPE-01 | 复制、粘贴、模拟输入三种动作分离，只有应修改系统剪切板的动作修改它。 |
| TYPE-02 | 粘贴回打开面板前的目标，普通应用和终端分别验收；实际收到内容而非只验证组合键序列。 |
| TYPE-03 | 用包含 ASCII、中英及其他 CJK 文字、emoji、多行和 Tab 的短文本验收，目标收到的字符串逐字一致；长文本可靠性不作为通过门槛。 |
| TYPE-04 | 复用 TYPE-03 短文本，标准/慢速两档独立执行并回读；前档失败不遮挡另一档，不丢字符、不乱序。 |
| TYPE-05 | 启动时等待触发修饰键释放；超时不输出；Ctrl+点击不变成系统快捷键。 |
| TYPE-06 | 执行中 backend 修饰键熔断、后续排队任务停止、通知次数正确，无尾部输入；以实际后端的虚拟按键验收该状态路径。 |
| TYPE-07 | 关闭/禁用/注销时停止并释放虚拟按键；旧任务不在新实例继续运行。 |
| TYPE-08 | 输入法中/英文模式、键盘布局、目标应用切换分别测试，不能假定可绕过输入法。 |
| TYPE-09 | 不同 toolkit、浏览器和终端验收；普通物理按键在 Wayland 下不可可靠感知的限制明确披露。 |

逻辑保护入口：[terminal/guard.test.js](logic/clipboard/terminal/guard.test.js)。
长期模拟入口：[terminal/typing.smoke.js](simulation/terminal/typing.smoke.js)、[terminal/lifecycle.smoke.js](simulation/terminal/lifecycle.smoke.js)。

验收口径：逻辑 guard 验证取消判定与重复取消，typing 比较真实 GTK Wayland 目标；lifecycle 控制修饰键且抑制字符。
TYPE-05/06 以真实后端的虚拟 Ctrl 按住、释放与熔断结果验收，不再因缺少物理键盘重复测试而标为部分通过。
这不等于虚拟设备与物理设备的所有事件路径都相同；普通人为按键识别、物理设备特性和真实 IME 组字仍是独立边界。
没有目标应用通用的字符提交确认，长文本可能受输入法、应用及时序影响；历史长文本差异作为已知限制保留，不因短文本通过而视为修复。

### 系统截图 — SHOT-01…07

| ID | 要测什么 / 预期结果 |
| --- | --- |
| SHOT-01 | 按钮和全局快捷键启动真实 Screenshot Portal。 |
| SHOT-02 | 交互/全屏/窗口/区域/活动窗口按后端支持能力工作，不把不支持误报成功。 |
| SHOT-03 | 加入历史、写剪切板、打开编辑器相关配置分别及必要组合正确。 |
| SHOT-04 | 用户主动取消无“截图失败”通知，不写历史、不复制、不启动编辑器。 |
| SHOT-05 | 拒绝、超时、门户不可用、无 URI 时有可理解错误，并能再次截图。 |
| SHOT-06 | 连续点击、能力查询或截图期间取消/禁用，清理自有请求、订阅、超时，不复活旧请求；禁用后用户仍可正常完成/取消系统截图，不影响 Shell，不要求立即关闭系统界面。 |
| SHOT-07 | 真实结果图像和 URI、空格/中文路径、取消后立即重试均正确。 |

长期模拟入口：[screenshot/pipeline.smoke.js](simulation/screenshot/pipeline.smoke.js), [screenshot/cancel.smoke.js](simulation/screenshot/cancel.smoke.js).

原生入口：[screenshot/native.js](simulation/screenshot/native.js)。SHOT-03 从按钮/快捷键进入真实门户、
权限确认及截图界面，覆盖编辑关闭时的历史/复制组合；SHOT-04 实际取消且无失败通知。等待 owner
与捕获处理完成，不以回调返回代替。Pictures 在 Shell 启动前设为私有目录。其他目标及协议故障
仍由对应 pipeline/逻辑测试负责。

### 图片编辑 — EDIT-01…07

| ID | 要测什么 / 预期结果 |
| --- | --- |
| EDIT-01 | 未配置命令只提示配置，不取原文、不启动无关应用。 |
| EDIT-02 | %u、%f、%i、%%、无占位符、引号、空格和非 ASCII 路径按 argv 正确传递。 |
| EDIT-03 | 非法占位符、命令不存在、原文件不存在、非本地 URI 不适用占位符时清楚失败。 |
| EDIT-04 | 本地、已下载远端、仅预览远端分别编辑；不得把缩略图当原图。 |
| EDIT-05 | 关闭同步时 lazy 图片不能请求原文；开启后可重新获取并编辑。 |
| EDIT-06 | 编辑器启动慢、不读 stdin、提前退出、持续运行，Shell 都持续响应。 |
| EDIT-07 | 真实 Gradia 原生/Flatpak 读取完整图片；面板关闭时机正确，外部编辑器不因插件关闭被误杀。 |

长期模拟入口：[clipboard/images.smoke.js](simulation/clipboard/images.smoke.js).

原生入口：[screenshot/editor.native.js](simulation/screenshot/editor.native.js)。EDIT-01 检查真实空命令
通知且不取原图；EDIT-06 操作慢读/不读 stdin 和提前退出子进程，并测 Shell heartbeat；EDIT-07-native
启动真实 Gradia，检查画布中的特征像素。EDIT-07-flatpak 要求应用本身已安装，只有 CLI 不算。
参数和数据边界仍归逻辑测试。

### 取色器 — COLOR-01…07

| ID | 要测什么 / 预期结果 |
| --- | --- |
| COLOR-01 | 按钮/快捷键打开，真实屏幕采样、放大镜、鼠标移动，结果进入系统剪切板及正常历史。 |
| COLOR-02 | 左键/Enter/Space 确认，右键/Esc 取消；确认使用最后采样点，不使用迟到旧样本。 |
| COLOR-03 | 方向键和当前支持的其他方向键每次一物理像素，Ctrl 步长及快速连按累加正确。 |
| COLOR-04 | HEX/RGB/HSL/OKLCH 输出及颜色条目小方块一致。 |
| COLOR-05 | 屏幕边缘、分数缩放、多显示器和负坐标采样正确。 |
| COLOR-06 | 初始化失败、grab 失败、采样中关闭/禁用，释放 modal 与信号。 |
| COLOR-07 | 重复打开和退出后桌面、其他快捷键恢复正常，没有残留覆盖层。 |

长期模拟入口：[color-picker/sampling.smoke.js](simulation/color-picker/sampling.smoke.js)、[color-picker/native.js](simulation/color-picker/native.js) 的 COLOR-03/04、[color-picker/lifecycle.smoke.js](simulation/color-picker/lifecycle.smoke.js)。

验证边界 / 缺口：sampling 和 COLOR-03 在真实色块上原生分发，缩放/舍入矩阵复用 logic/color-picker；COLOR-04 保留非默认格式的设置→采样→剪切板链。分数屏使用实际 DisplayConfig；lifecycle 控制在途采样并验锁屏、模拟恢复。真实硬件坐标仍需单独验证。

### 同步连接、设备与 Channel — CONN-01…10

| ID | 要测什么 / 预期结果 |
| --- | --- |
| CONN-01 | IP:端口、HTTP、HTTPS、代理子路径和非法地址；设备/API Key 认证头正确。 |
| CONN-02 | 测试连接只检查当前输入，不保存、不重启正在运行的同步。 |
| CONN-03 | 快速连点测试/应用/刷新、失败后重试、设置关闭时请求在途，不重入或卡 Shell。 |
| CONN-04 | 应用保存连接，立即同步设备 Tag/icon 并加载 Channel；完成前禁用重复提交。 |
| CONN-05 | 应用请求失败时本地保存结果、错误与按钮状态一致，不显示虚假成功。 |
| CONN-06 | DeviceId 首次生成、重启后稳定，Tag/icon 修改不改变身份。 |
| CONN-07 | 自带设备/操作系统图标、未知自由 icon 字符串回退；本机条目不展示远端标记。 |
| CONN-08 | 无 Channel、无权限、Channel 被撤销/切换；游标和出站目的地不能串用。 |
| CONN-09 | 离线、慢服务器、认证失效、设备撤销、协议不兼容均有可本地化反馈。 |
| CONN-10 | 设置进程与 Shell 并发读写连接配置，不丢字段、不泄露 API Key。 |

长期模拟入口：[settings/icon.integration.js](simulation/settings/icon.integration.js), [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

原生入口：[sync/connection.native.js](simulation/sync/connection.native.js)、
[sync/native.js](simulation/sync/native.js)，通过 `tools/test-sync-server.py` 运行。CONN-02/03/04/05
操作完整独立 GTK 窗口及真实服务端，检查未保存输入测试、忙碌互斥、快速点击、在途关闭、立即应用
设备信息和失败重试。CONN-06-profile 从管理 API 验证身份/设备持久化，不代表 web 页面验收。
URL、认证和并发配置的数据组合仍归现有逻辑测试。

### 发布策略与持久化队列 — SEND-01…10

| ID | 要测什么 / 预期结果 |
| --- | --- |
| SEND-01 | 关闭、手动、自动及仅固定项的发送策略实际生效；Pin 不导致不该发送的内容外传。 |
| SEND-02 | 纯文本、附加富文本格式、图片开关仅影响对应表示；不会误改变本地捕获。 |
| SEND-03 | 文本/图片阈值前、等于、超过，清单 delivery、预览和实际上传字节一致。 |
| SEND-04 | 首次请求前持久化冻结清单；断网、重启、阈值变化后重试复用原清单。 |
| SEND-05 | 按服务器保存队列并绑定 Channel/DeviceId，切换不串发，切回正确恢复。 |
| SEND-06 | 关闭同步暂停已有任务；关闭期间复制不入队，开启后不自动补传。 |
| SEND-07 | 服务端已提交但响应丢失时复用/确认同一发布，不重复上传完整内容。 |
| SEND-08 | 条目删除、变隐私、原文丢失后停止或安全失败；远端条目不回流发布。 |
| PRIV-06 | 删除或变为敏感后，待上传引用与冻结清单被清理；真实在途取消归同步领域，不计入隐私模式验收。 |
| SEND-09 | 保存失败、队列损坏、重试退避、永久错误、退出中断不丢应保留的任务。 |
| SEND-10 | 本次发布确认后 delivery 落盘；停用与保存交错仍有关闭快照，不依赖历史事件重放保存。 |

长期模拟入口：[sync/toggle.smoke.js](simulation/sync/toggle.smoke.js), [sync/status.smoke.js](simulation/sync/status.smoke.js).

原生入口：[sync/native.js](simulation/sync/native.js)、
[sync/local-boundary.native.js](simulation/sync/local-boundary.native.js)。真实服务端接收手动/自动/仅固定、
代表性富文本/图片，并检查关闭期间不补传、确认落盘。完整 MIME/阈值/目的地矩阵及完成响应丢失
归无图形真实 HTTP 集成；冻结清单、中断/删除同样在此用独立 gate 挂起真实请求，
不伪造 SyncClient 结果。桌面只保留删除→队列通知接线，损坏和退避继续复用逻辑测试。

### 接收、增量与懒加载 — RECV-01…10

| ID | 要测什么 / 预期结果 |
| --- | --- |
| RECV-01 | 接收关闭/仅历史/自动激活三种模式；仅预览不能冒充完整原文写入剪切板。 |
| RECV-02 | 新设备中途加入 Channel，从保留变化获取历史；分页、重复页、游标推进和保存正确。 |
| RECV-03 | 接收按本机文本/图片阈值决定自动获取，不错误沿用发送端阈值。 |
| RECV-04 | 服务端已有原文时直接下载；仅 lazy 时请求来源上传、等待、服务端就绪后再下载。 |
| RECV-05 | 多个点击、自动获取与手动请求并发复用任务，不重复请求或相互覆盖。 |
| RECV-06 | 来源离线/删除原文/变隐私，服务端过期/拒绝/超时，等待可取消且能明确失败。 |
| RECV-07 | 多表示条目所有必要原文就绪后才显示本地完整；重启后状态仍正确。 |
| RECV-08 | 用户新复制或手动选别项后，晚到远端结果不覆盖更新选择。 |
| RECV-09 | 本地删除只删本机副本，服务端删除事件再按协议移除；不误传播全 Channel 删除。 |
| RECV-10 | 远端对象按来源设备落盘，哈希/路径校验后采用；离线时已缓存原文仍可使用。 |

长期模拟入口：[sync/receive.smoke.js](simulation/sync/receive.smoke.js).

原生入口：[sync/native.js](simulation/sync/native.js)、[sync/network.native.js](simulation/sync/network.native.js)。
独立进程使用生产来源客户端/存储及真实服务端，覆盖接收模式、本机阈值、服务端和接收端均 lazy、
并发复用、来源拒绝、多表示持久化/离线主内容复用、迟到保护、本地与服务端删除。gate 控制真实
下载字节的时序。这是一台真实 Shell 加独立来源进程，不等于两台真实桌面或全部分页边界。

### 传输状态、恢复与错误 — XFER-01…09

| ID | 要测什么 / 预期结果 |
| --- | --- |
| XFER-01 | 未发送、传输中、等待来源、校验、快照发布完成、本地原文完整、失败/取消图标与实际动作一致。 |
| XFER-02 | 上传/下载字节精确、单调、最终值正确；等待阶段不能显示假的下载百分比。 |
| XFER-03 | 迟到进度和服务器时钟差异不能将完成状态降级或错误覆盖新任务。 |
| XFER-04 | 开启同步恢复大量已完成状态，只更新对应同步显示，不逐条保存或全量重建历史。 |
| XFER-05 | 关闭、快速切换、配置改变和插件禁用取消旧会话，晚到结果不污染新会话。 |
| XFER-06 | 单任务取消、状态缓存淘汰、等待消费者、超时后重试均能正确结束，不无限挂起。 |
| XFER-07 | JSON/HTTP 错误、非法 MIME/标识/计数/长度、过大响应、响应体中断安全拒绝。 |
| XFER-08 | 长度/hash 错误不覆盖旧目标，失败/取消清理 .part，不使用未校验原文。 |
| XFER-09 | 默认 GLib 与可选 sha256sum 各自验收；依赖缺失/失效/失败不跳过校验，framing 限制清楚。 |

长期模拟入口：[sync/status.smoke.js](simulation/sync/status.smoke.js), [sync/toggle.smoke.js](simulation/sync/toggle.smoke.js).

XFER-02 观察真实上传及远端精确总量；XFER-02-download 限速实际响应，要求中间进度、每个传输内的
单调精确字节和最终剪切板 hash；XFER-04 恢复服务端 20 条完成记录，观察恢复阶段无逐条 render、
persist、save。它们补充而非重复 logic/sync/{transfers,http-failures,file-verifier}.test.js。
压力与各校验路径的内存预算仍显式选跑，不加入普通 CI。

### 设置、快捷键与恢复默认 — SET-01…09

| ID | 要测什么 / 预期结果 |
| --- | --- |
| SET-01 | 从插件或扩展管理器打开设置，全部当前导航可访问；关闭重开、运行中修改生效时机正确。 |
| SET-02 | 所有 schema 键逐个归类：当前用户配置、内部状态、已停用项；当前配置的读写和合法边界都要覆盖。 |
| SET-03 | 强调色跟随系统、内置色、自定义色；普通文字与图标可跟随系统或自定义前景色，取消/保存及系统主题变化正确，强调色与前景色不混用。 |
| SET-04 | 面板参数、最大显示条目、现场与焦点限制、文字偏移配置正确保存并生效。 |
| SET-05 | 顶部/footer/条目按钮的排序和隐藏正确，空/重复/异常配置规整；隐藏图标不禁用快捷键。 |
| SET-06 | 快捷键录制完整组合，单独修饰键不误保存；取消、清空、非法组合/冲突反馈和实际重新绑定。 |
| SET-07 | 运行应用发现与手输排除列表；Shell 不可用或列表变化时不卡设置进程。 |
| SET-08 | 恢复默认二次确认；取消无副作用，确认不删除历史/语句/词库/连接/DeviceId，恢复后后续设置仍可保存。 |
| SET-09 | 关于页版本、项目/问题/许可证链接可打开；外部程序不可用不造成设置崩溃。 |

长期模拟入口：[settings/window.smoke.js](simulation/settings/window.smoke.js), [settings/foreground.smoke.js](simulation/settings/foreground.smoke.js), [settings/layout.smoke.js](simulation/settings/layout.smoke.js), [settings/icon.integration.js](simulation/settings/icon.integration.js), [settings/lifecycle.integration.js](simulation/settings/lifecycle.integration.js).

原生入口：[settings/native.js](simulation/settings/native.js)。SET-01 遍历八个真实页面；SET-06 在独立
GTK 中录制、取消、清空组合键；SET-08 操作恢复默认的两个确认分支、保留身份/语句，并确认之后还能
保存设置。主题、布局、排除和外链仍有各自的组件/数据归属，不声称所有 GUI 均已完整验收。

SET-02 的当前 schema 责任清单如下。共 81 键：74 个用户配置、4 个内部状态、3 个暂停功能。
同类配置复用消费逻辑和代表性原生接线；不为每个成熟控件属性建立一份 GUI 测试。
Schema 类型/范围可临时用 memory backend 校验，不能用它代替下表的实际功能行为。

| 当前用户配置 | 键名 | 行为归属 |
| --- | --- | --- |
| 设备（2） | `device-tag`, `device-icon-kind` | device/client 逻辑，CONN-06-profile/07 |
| 常规与面板（19） | `show-indicator`, `panel-anchor`, `panel-offset-x`, `panel-offset-y`, `theme-color`, `foreground-color`, `custom-theme-colors`, `panel-escape-action`, `panel-confine-focus`, `panel-visible-item-limit`, `panel-width`, `panel-height`, `panel-text-vertical-offset`, `panel-toolbar-actions`, `panel-footer-actions`, `panel-hidden-actions`, `entry-actions`, `entry-hidden-actions`, `preserve-panel-state` | panel-manager/focus-grid/actions，PANEL、SET-03/04/05；文字视觉偏移归 LANG-04 |
| 剪切板（9） | `history-size`, `cache-size-mib`, `history-retention-days`, `private-mode`, `trim-whitespace`, `capture-size-limit-mib`, `excluded-apps`, `sensitive-content-mode`, `simulated-input-speed` | history-controller/capture/input 逻辑，CLIP/PRIV/TYPE |
| 分词和词库（3） | `tokenizer-show-source-preview`, `tokenizer-word-limit`, `tokenizer-dictionary-files` | processors/dictionary/selection 逻辑，WORD/DICT |
| 快捷语句（3） | `saved-phrase-limit`, `saved-phrase-newest-first`, `phrase-close-after-copy` | phrase-store 逻辑，PHRASE |
| 同步（15） | `sync-enabled`, `sync-use-sha256sum`, `sync-poll-interval-seconds`, `sync-send-mode`, `sync-receive-mode`, `sync-text`, `sync-html`, `sync-images`, `sync-favorites-only`, `text-full-threshold`, `text-preview-limit`, `image-full-threshold`, `thumbnail-size`, `thumbnail-byte-limit`, `sync-transfer-timeout-seconds` | client/lifecycle/queue/receive/policy/verifier/storage，CONN/SEND/RECV/XFER；单位接线归 SET-02 |
| 截图与编辑（5） | `screenshot-target`, `screenshot-add-history`, `screenshot-write-clipboard`, `screenshot-open-editor`, `editor-command` | screenshot tools/pipeline，SHOT/EDIT |
| 取色（1） | `color-format` | color 逻辑与 COLOR-04 |
| 全局快捷键（5） | `panel-shortcut`, `screenshot-shortcut`, `color-picker-shortcut`, `private-mode-shortcut`, `clear-history-shortcut` | SET-06、SET-06-global-actions、SHOT/COLOR 的真实 WM 绑定 |
| 剪切板局部快捷键（5） | `history-search-shortcut`, `history-paste-shortcut`, `history-pin-shortcut`, `history-delete-shortcut`, `history-type-shortcut` | matcher/capture 逻辑，PANEL/HIST/PHRASE/TYPE 默认动作与代表性改键 |
| 分词局部快捷键（7） | `tokenizer-copy-shortcut`, `tokenizer-paste-shortcut`, `tokenizer-type-shortcut`, `tokenizer-select-previous-shortcut`, `tokenizer-select-next-shortcut`, `tokenizer-select-above-shortcut`, `tokenizer-select-below-shortcut` | matcher/capture 逻辑，WORD/SELECT/TYPE |
| 内部状态（4，不是用户配置） | `device-id`, `tokenizer-dictionary-revision`, `sync-configuration-revision`, `saved-phrases` | 身份、修订号和旧语句暂存；当前快捷语句存储仍为独立 JSON |
| 暂停功能（3） | `device-icon-color-light`, `device-icon-color-dark`, `device-icon-color-linked` | 无设置入口，不进入设备 profile；现有 device 逻辑验证忽略 |

服务器地址、API key、Channel 存于 `sync.json`，不属于遗漏的 schema 键，其读写和应用由 CONN 验收。

### 多语言、通知与视觉 — LANG-01…07

| ID | 要测什么 / 预期结果 |
| --- | --- |
| LANG-01 | 英文及 po/LINGUAS 中全部翻译目录完整提取、编译，格式占位符安全。 |
| LANG-02 | 菜单、设置、通知、错误、依赖提示、确认弹窗按钮实际使用所选系统语言，不残留英文回退。 |
| LANG-03 | 英文/中文/日文/韩文代表性实显；RTL、长译文、CJK 字体和 emoji 无功能性溢出。 |
| LANG-04 | 搜索 placeholder、输入文字、光标、分词标题基线及文字偏移，人工验收。 |
| LANG-05 | 深浅/高对比主题、强调色、选中/非选中/hover/禁用图标反馈一致，人工验收。 |
| LANG-06 | 内容左对齐、文本省略、图像比例、设备图标、分割线、边距、细滚动条和窄窗口，人工验收。 |
| LANG-07 | 错误/取消通知次数适当；主动截图取消无错误提示；通知不泄露正文或认证信息。 |

长期模拟入口：[shell.smoke.js](simulation/shell.smoke.js).

原生入口：[settings/language.native.js](simulation/settings/language.native.js)，LANG-02 分别使用
`--language en_US`、`zh_CN`、`ja`、`ko`，检查实际菜单、分词、独立设置窗口及空编辑命令通知。
必须生成非 C 的基础消息 locale，C.UTF-8 会忽略 gettext 的 LANGUAGE 选择。目录完整性仍归
logic/i18n/coverage.sh；翻译质量、字形和视觉效果仍人工验收，RTL/长文本的功能布局已归 LANG-03 自动验收。

### 响应度、资源、打包与工具 — OPS-01…08

| ID | 要测什么 / 预期结果 |
| --- | --- |
| OPS-01 | 复制大内容、缩略图、词库加载、分词、同步初始化/恢复/传输、启动编辑器期间测主循环最大停顿。 |
| OPS-02 | 区分异步网络等待与连续主线程阻塞，保留阶段和时间线，不只测按钮回调同步返回。 |
| OPS-03 | 长期启停、连续开关/刷新/轮询后内存、FD、定时器、会话与临时文件不持续增长。 |
| OPS-04 | 默认 GLib 与可选 sha256sum 分开记录内存预算；不能把可选路径的低内存结果套给默认路径。 |
| OPS-05 | 现有十倍压力负载独立运行，不能替代真实 Shell 和真实服务器；不重新加入每次 GitHub CI。 |
| OPS-06 | ZIP 仅含运行时资源、元数据/Schema/翻译一致，安装后可加载；无测试、词库、服务端或凭据误打包。 |
| OPS-07 | run-dev-shell 构建打包、隔离设置/数据、指定语言、退出和系统日志/终端输出正常。 |
| OPS-08 | 日志可定位操作阶段、不重复/吞错、不输出敏感信息；发布和安装配置用现有校验/临时验证，不新增格式锁定型测试。 |
| PRIV-08 | 日志、通知、上传队列不泄露正文或 API Key；sync.json 是连接配置，不误声称加密存储。本项归运行与安全审查，不计入隐私模式验收。 |

验证边界 / 缺口：使用现有 logic/sync 测量压力、logic/common 检查和 tools/check_release.py；压力显式选跑，不加普通 CI。打包复用 ENV-01 证据；异步 API 或单次成功不证明 Shell 永不卡顿。

## 重复测试审查与处理

### 由模拟桌面下沉的逻辑验收

| 功能 | 无图形验收归属 | 保留的桌面证据 |
| --- | --- | --- |
| HIST-01/04/06/10、捕获取消与恢复 | `logic/clipboard/{capture,history/controller,history/order}.test.js`；排序重载、搜索/limit 矩阵、真实缩略图暂存取消与恢复 | 真实 Pin/取消固定、输入/Unicode 粘贴查询、外部 owner 与一次隐私在途切换 |
| WORD-06/07 | `logic/clipboard/tokenizer/processors.test.js` 的字符/词数边界及词库加载前拒绝 | 小配置上限提示；WORD-07 保留 2000 个真实按钮布局、一次超长拒绝和恢复 |
| DICT-06/09 | `logic/clipboard/tokenizer/network.test.js` 的 HTTP/TLS；`performance.test.js` 按需测 120,002 词导入、索引、缓存和 GJS 心跳 | 小词库的真实 GTK 导入/刷新、结果重载及错误反馈；不再用文件选择器跑大词库 |
| PHRASE-06/07、TYPE 取消判定、截图流程策略 | `logic/ui/phrase-draft.test.js`、`clipboard/phrases/store.test.js`、`clipboard/terminal/guard.test.js`、`screenshot/pipeline.test.js`；完整文件失败/损坏及异步阶段/配置矩阵 | 表单焦点与失败反馈、实际输入设备、真实门户取消/禁用；截图仅三次代表链路 |
| COLOR-03/04 | 已有 `logic/color-picker/color.test.js` 的缩放/舍入/格式 | 实际像素移动、非默认格式写剪切板、真实双屏/125% |
| SEND-02/03、RECV-03 | `logic/sync/integration/backend.test.js`：开关与文本/图片阈值矩阵，真实生产客户端和服务端 | 单条富文本/PNG 捕获发送，以及 lazy 自动接收 |
| SEND-04/05/07/08、RECV-02/05 | 同一 HTTP 集成：冻结清单、删除取消、按目的地队列、丢 ACK 幂等、205 条分页/游标、自动/手动共享一次 GET | RECV-02-restore 只验真实重启后入站/出站与删除→队列清理；RECV-05-automatic-manual 只验系统剪切板接线 |
| CONN-09-device/offline、XFER-09-glib/sha256sum | 同一 HTTP 集成：真实设备撤销/新 Key、连接拒绝与恢复、真实校验路径与 framing | 不重复放入 Shell；独立 GTK 错误反馈和 Shell 取消/崩溃回归保留 |
| SET-08、LANG-07 错误映射 | `logic/ui/settings-defaults.test.js` 使用真实 store 核对数据保留；`logic/sync/errors.test.js` 负责全部错误码与翻译映射 | 真正确认/取消重置、控件仍可编辑；代表性安全通知、真实 Gio 异常及取消零通知 |

运行方式见[逻辑验证](README_CN.md#逻辑验证)。完整 HTTP 集成不等于第二个 GNOME 桌面，
不会证明渲染或剪切板 owner 行为。已知 sha256sum framing 失败继续按真实结果登记。

### 原生验收补充

统一入口 `tools/test-simulation.py` 除剪切板外，还维护以下原生操作链；可用 `--case` 精确选择。
这里是覆盖范围，不是整个功能 ID 的完成认证。

| 模块 | ID | 实际验证及边界 |
| --- | --- | --- |
| `clipboard/applications.native.js` | CLIP-02-chromium | 实际本地 HTML、私有 Chromium profile、原生复制和独立 MIME 回读 |
| `clipboard/policy.native.js` | PRIV-01/02/04/05、HIST-01/04 | 不记录、仅内存生命周期、真实窗口排除、一次在途切换、Pin/取消固定与查询输入；矩阵归逻辑层 |
| `phrases/native.js` | PHRASE-01/02/04/05/06/07 | 原生输入/提交、Esc、独立目标收到复制/粘贴/模拟输入、关闭策略、延迟保存与实际 IO 失败重试；不覆盖全部 IME 或冷 Shell 恢复 |
| `word-selection/native.js` | WORD-05/06/07/08、SELECT-01/03/04/06/07 | 真实行入口、选择结果回读、小配置上限与提示、长文 heartbeat、迟到处理、拖选、持续 Shift 连选、滚动和退出清理；2000 算法边界归逻辑层 |
| `terminal/native.js` | TYPE-01/03/05/06/07 | 独立 GTK 目标、两档混合语言逐字一致、等待真实 backend 修饰键、熔断一次及队列取消、实际禁用重开不继续输入 |
| `sync/native.js` | CONN-06-profile、SEND-01/01-pinned/02/06/10、RECV-01/03/04/09、XFER-02/04 | 真实服务端/来源、持久化和实际传输；SEND-02 只保留代表性富文本接线 |
| `sync/connection.native.js` | CONN-02/03/04/05 | 完整 GTK 测试/应用/失败重试和在途关闭 |
| `sync/network.native.js` | RECV-05-automatic-manual/06/07/08、XFER-02-download | 系统剪切板接线、来源失败、迟到选择及精确进度；共享 GET 归无图形 HTTP |
| `sync/local-boundary.native.js` | PHRASE-08、PRIV-08 | 活跃同步下本地数据边界；不代替日志脱敏审计 |
| `settings/native.js`、`settings/language.native.js` | SET-01/06/08、LANG-02 | 完整独立设置、原生录制/重置和实际翻译目录 |
| `word-selection/dictionary.native.js` | DICT-02/06/08（含 DICT-07） | 本地/网络导入、多来源、刷新保留、编辑器和目录 |
| `screenshot/native.js`、`screenshot/editor.native.js` | SHOT-03/04、EDIT-01/06/07-native/07-flatpak | 真实门户/取消、stdin 和 Gradia 画布 |
| `color-picker/native.js` | COLOR-01/03/04/07 | 真实色块、像素移动、格式和禁用重开 |

SELECT-01 直接复用已有 drag 实现，包含 SELECT-02 范围；SELECT-03 复用 viewport；表单和 Esc
也复用同一函数，不复制一份测试。仅以这些原生用例替代“调用 handler 就代表用户操作”的结论，
原有逻辑测试仍负责数据边界。

WORD-07 只测 2000 个真实按钮布局、一次 20,001 字符拒绝提示及之后的短文本恢复。
字符/词数和超长 URL 的规则矩阵归逻辑层，不再跨进程重复传输大文本。1000ms 主循环预算不变，
记录样本长度和最大间隔；字符数按 Unicode 码点计数，emoji 不按两个 UTF-16 单元计数。
词库加载前拒绝及中英文/emoji 的长度边界由逻辑测试验证。虚拟修饰键
熔断不证明物理键盘事件一定送达，也不证明绕过输入法。CI 范围未扩大。

### 扩展原生用例的归属

原生注册表当前用例以 `--list` 为准，数据规则下沉后不再维持原来的用例总数。以下扩展原有归属，不复制正常路径。
实际失败写进[结果快照](acceptance-status_CN.md)，不在本清单放宽预期。

| 归属 | 新增/强化 ID | 独立行为边界 |
| --- | --- | --- |
| `clipboard/native.js`、`clipboard/policy.native.js` | CLIP-04-recovery、CLIP-09-missing、PRIV-05 | 解码失败后正常捕获；重启后原文缺失；真实 owner 传输中切换隐私 |
| `phrases/native.js` | PHRASE-07-delete/corrupt | 实际删除 IO 失败/重试、损坏持久文件恢复 |
| `word-selection/native.js` | SELECT-04-cross-row、SELECT-05、SELECT-07-disable | 持续 Shift 跨行、Space/Enter、按住拖动时真正禁用 |
| `terminal/native.js` | TYPE-03、TYPE-08-layout | 两档短文本精确回读、实际 US/German 输入源；不读取用户长样本 |
| `terminal/browser.native.js`、`terminal/vte.native.js` | TYPE-09-firefox/chromium、TYPE-02-vte | 独立浏览器 textarea→loopback 回读；真实 GTK3/VTE PTY，先做键盘/剪切板正控；不代表物理 IME |
| `lifecycle/native.js`、`lifecycle/responsiveness.native.js` | ENV-05-screenshot、OPS-01-capture | 禁用后真正完成/取消系统截图，验证模态释放、外部窗口原生输入、旧插件无副作用及重新启用；大捕获/缩略图/保存主循环间隙 |
| `settings/coverage.native.js`、`settings/native.js` | SET-02/04/05/06/07/08/09 | 原生代表性配置路径、布局/快捷键行为、排除、无效/清空/取消录制、重置保留数据、URI handler 交接 |
| `word-selection/dictionary.native.js`、`lifecycle/cold.smoke.js` | DICT-02/06/07/08 | 语言、多来源、刷新反馈、实际编辑器、跨 Shell 无隐式下载；大词库、HTTP/TLS 矩阵归逻辑层 |
| `sync/scenarios.native.js` | SEND-03-image、RECV-02-restore | 单次图片捕获/发送；真实扩展启停后的入站/出站、删除清理接线；游标/目的地矩阵归逻辑层 |
| `sync/scenarios.native.js`、`sync/network.native.js` | CONN-08-empty/revoked、XFER-05-disable-download/06-cancel-download、RECV-08-manual | 实际无权限/撤销、会话/任务取消及较新选择分支，保留 Shell 异常退出和覆盖回归 |
| `screenshot/native.js`、`screenshot/editor.native.js`、`screenshot/remote.native.js` | SHOT-03-editor/07、EDIT-05-remote/07-lifetime | 实际截图编辑组合、取消重试、远端原图送到真实自定义编辑进程、离线缓存及禁用后编辑器继续存活 |
| `color-picker/native.js`、`color-picker/displays.native.js` | COLOR-05-edges/displays | 四角/clamp、实际虚拟双屏/125%，坐标、剪切板和一个物理截图像素步长 |

显示条件用 `--display dual` / `--display fractional`；词库冷启动用独立
`tools/test-lifecycle.py --dictionary-cold`。应用/locale 依赖显式登记。
真实 IME、Flatpak Gradia、两个完整桌面竞态仍需专门准备环境，不视为天然不可测。
可信 HTTPS 已通过公开 GitHub 词库在两环境补验，见[结果快照](acceptance-status_CN.md)。
格式、存储、策略、错误响应等数据矩阵继续归逻辑测试，不复制到 Shell。

后续补充继续复用已有归属：`sync/network.native.js` 负责自动/手动获取竞争、远端剪切板回流
（`RECV-05-automatic-manual`、`CLIP-08-remote-loop`）；`sync/connection.native.js` 负责在途 Refresh、
忙态真实点击及设置进程自然退出（`CONN-03-refresh`）；`sync/local-boundary.native.js` 仅保留
`PHRASE-08` 的本地语句接线，目的地矩阵归无图形 HTTP。真实缩略图暂存取消归
`logic/clipboard/capture.test.js`；HIST-04 只保留输入/Unicode 粘贴与可见上限接线。
`word-selection/native.js` 等关闭、禁用、较新条目请求后的顶层 handler 完整结束再验迟到结果
（`WORD-08-close/disable/newer`）。这些用例先确认加载面板已经绘制、还没有词按钮，再实际返回、
关闭、禁用或返回后选择另一条内容；词库文件更新规则复用 dictionary.test.js，不重复组合到桌面。
`screenshot/native.js` 验证真实不支持目标及支持目标重试
（`SHOT-05-unsupported`），不伪造门户响应。这些是独立故障边界，不重复基础捕获、重复手动点击或
直接调用 handler；解码器内部取消、物理输入、所有部署环境仍单列。

| 原有重叠 | 处理 |
| --- | --- |
| 面板尺寸 | PANEL-03 负责完整矩阵和覆盖值，删除综合入口较小的副本。 |
| 外层 popup 高度完全相等 | 移除这个额外且不合适的约束：不同面板、Shell 版本的标题和 footer 装饰有差异。PANEL-03 按已对齐要求检查配置尺寸，不要求外层装饰等高。 |
| 隐藏锚点及直接 toggle | PANEL-01/02 负责真实输入显示配置，移除条目测试副本。 |
| 初始焦点、Ctrl+F、方向和边界 | PANEL-06/07/08 负责导航，移除语句分词 handler 副本，保留 Unicode 搜索。 |
| 语句 Enter 和直接基础保存 | phrases/form 统一主和小键盘 Enter、按钮；integration 保留不同的草稿失败竞态。 |
| 图片编辑夹带同步开关 | sync/toggle 负责状态焦点条目身份，images 仅负责原图编辑。 |
| 敏感拒绝与 Pin/清空组合 | 删除旧 privacy.smoke；仅内存/重启合并到 PRIV-02，上传拒绝、队列和日志安全复用所属逻辑或同步测试，不重复扩展隐私模式矩阵。 |
| 修饰键等待及额外直接固定 | terminal/lifecycle 负责等待释放清理，逻辑 guard 负责取消判定；固定保留快捷键，移除额外直接 toggle。 |
| 名称类似但失败边界不同 | 保留往返与待执行恢复、普通与裁剪拖选、正常与延迟采样，不误删。 |
| 兼容性、PANEL-10 与 input-mode | 调用同一验证函数，不是重复实现；多个显式套件运行不重复计算功能覆盖。 |

综合入口 [shell.smoke.js](simulation/shell.smoke.js) 只编排领域检查，**不是全部模拟测试的入口**。
CI 仍只运行原有兼容性子集。本次不改插件功能、CI 范围和压力策略。

补测试先找已有归属，优先扩充边界；跨领域以引用复用证据（隐私/上传取消、打包/安装、通知/取消），
不再复制场景。每次验收结果另存，不把本清单当通过矩阵。纯 CSS、成熟控件普通属性、文档措辞、
release 排版不新增永久断言。物理键盘/IME、双桌面激活竞态、未安装应用和视觉仍需独立证据。
