# Clipboard X UI 架构与设计约定

本文记录当前已经确认的组件边界与界面约定。后续增加面板或调整 UI 时，应优先扩展这些边界，避免把状态与控件重新堆回 `Indicator`。

## 1. 职责边界

- `ui/indicator.js`：GNOME 顶栏入口和面板编排层。负责系统级动作、菜单开关、面板注册与主题协调，不实现具体面板内部视图。
- `ui/panel-manager.js`：面板生命周期与现场管理。负责 `enter`、`leave`、`render`、视图捕获和恢复。
- `ui/navigation/focus-grid.js`：面板内的二维键盘焦点导航。每个面板维护自己的控件矩阵，不通过全局焦点监听修正焦点。
- `ui/layouts/panel-actions.js`：顶栏与底栏动作的布局模型和校正规则，不依赖 Shell actor。
- `ui/controls/`：Shell 公共控件。只负责结构、通用状态和无业务含义的交互，不读取剪切板、同步或面板设置。
- `ui/panels/`：可独立切换的 Shell 面板。面板拥有自己的 actor、滚动区域、状态、焦点矩阵和领域交互。
- `ui/settings/window.js`：设置窗口的页面编排层，不直接重复实现设置绑定控件。
- `ui/settings/`：设置窗口与可复用的 GTK/Libadwaita 设置组件。

## 2. 已有组件

- `QuickPhrasesPanel`：快捷语句标题栏、输入表单、列表、本地存储操作和焦点矩阵。
- `TokenizerPanel`：分词布局、选择状态、鼠标连续选择、键盘选择、结果预览和焦点矩阵。
- `HistoryPanel`：搜索、历史列表、工具栏、底栏、同步状态、现场恢复和焦点矩阵；条目内容与同步进度绘制位于同领域目录的独立模块。
- `ContentItem`：统一的“左侧前导标识 + 可伸展内容 + 右侧动作”条目。`focusActors` 按实际显示顺序提供给面板焦点矩阵。
- `PanelHeader`：内部由标题行和独立 divider actor 组成；标题行包含返回按钮、占据剩余空间的标题和可选右侧动作，业务面板不再自行绘制分割线。
- `PanelFooter`：带顶部分割线的自由内容容器。
- `SearchEntry`：统一搜索图标、placeholder 光学偏移、左间距以及搜索框事件接入。
- `IconButton`：统一图标尺寸、可访问名称和异步动作错误处理；`selected` 仅表达可选中按钮的状态。
- `Tooltip`：持有插件唯一的浮动提示控件，负责关联目标、延迟显示、定位、输入方式切换和信号清理。
- `PreferenceRows`：开关、文本、数字、容量、下拉框、图标下拉框、快捷键和字符串列表设置行。
- `settings/theme-color.js`：主题色选择器及自定义颜色流程。
- `settings/panel-actions.js`：顶栏与底栏动作的拖动、排序和跨区域移动。
- `panels/quick-phrases/panel.js`：快捷语句面板的视图、表单、列表和焦点状态。

公共 API 采用“上下文承载领域、成员表达动作”的命名方式。例如 `PreferenceRows.spin()`、`QuickPhrasesPanel.render()`；成员名称不重复类型已经表达的语义。

除 `Tooltip` 自己的显示生命周期外，控件不管理面板生命周期或业务快捷键。面板通过构造参数接入动作，并用自己的 `FocusGrid` 组织键盘导航。

## 3. Shell 面板约定

- 搜索框与主要动作保持在同一行；默认顶栏为截图、取色、快捷语句，默认底栏为隐私模式、同步、清空、设置。
- 动作位置和顺序由设置驱动，焦点矩阵必须从 actor 的实际顺序生成。
- 内容条目采用“左侧内容、右侧动作”结构。条目级间距由统一容器控制，不给最后一个删除按钮添加专属右边距。
- 有选中状态的图标只使用主题色表达选中；正常 hover 和 active 反馈仍然保留。
- 条目动作、分词按钮和返回按钮默认不显示 tooltip；需要说明的全局工具按钮使用浮动 tooltip。
- 每个可切换面板拥有独立的 `FocusGrid`。方向键到达边缘时是否离开插件，由统一设置控制。
- 可滚动内容使用 overlay scrollbar 和统一细滚动条样式。
- 面板宽高、文字垂直偏移和现场保留均由设置驱动，不在子面板硬编码用户环境差异。

## 4. CSS 约定

- 尺寸和间距优先定义在结构组件上，例如菜单、标题栏、条目、工具栏和底栏。
- 不为单个业务动作添加位置修正；确需差异时使用表达结构或状态的类名，而不是图标名称。
- 新增规则前检查选择器优先级。当前 `.clipboard-x-menu .popup-menu-item` 的优先级高于 `.clipboard-x-entry`，通用条目 padding 可能覆盖后者。
- 主题色、hover、focus、active 和 checked 是不同状态，不互相替代。

## 5. 后续拆分顺序

1. 继续压缩设置窗口编排层，把页面定义按领域拆分，但保持设置绑定集中复用。
2. 新面板统一使用 `PanelHeader`、`PanelFooter` 和 `FocusGrid`，不重复实现标题栏、分割线与焦点边界。

## 6. 验证要求

- 纯状态和布局算法提供 GJS 单元测试。
- Shell actor、焦点、菜单生命周期通过 `tests/ui/shell.smoke.js` 验证。
- GTK 设置组件通过 `tests/ui/preferences.smoke.js` 验证，且必须断言窗口标题不是 `Extension Error`。
- 每次结构重构必须通过构建、20 项常规测试、Shell 冒烟测试和设置窗口冒烟测试。
