# 面板入口、导航与现场回归测试

> 简体中文 · [English](panel-testing.md)

本地测试入口使用 Mutter 真实分发的虚拟键盘、鼠标和滚轮事件，复现 PANEL-01～10。
它独立于 Meson 和 GitHub CI，不安装宿主插件、不读取宿主历史，也不需要 Clipboard X Server。

## 运行

按[参与开发](../CONTRIBUTING.zh-CN.md)使用 `-Dtarget=package` 构建，将下列 `1.x.x` 替换为实际版本：

```sh
bash tools/test-panels.sh build/clipboard-x-gnome_1.x.x.zip
```

命令使用当前环境已安装的 GNOME Shell，要求版本为 50 或 51，并提供
`gnome-shell-test-tool`、Python 3、`dbus-run-session`、`timeout` 及正常的系统总线。
脚本不会安装依赖或修改系统服务。两版验证需要分别在准备好的 GNOME 50/51 环境运行，
在 ZIP 后加 `50` 或 `51` 可校验实际版本。容器环境要求见[兼容性指南](shell-compatibility_CN.md)。

验证重复运行的稳定性，每个显示环境使用多个全新会话：

```sh
bash tools/test-panels.sh build/clipboard-x-gnome_1.x.x.zip 51 --repeat 3
```

单项或指定组合复现：

```sh
bash tools/test-panels.sh build/clipboard-x-gnome_1.x.x.zip --case PANEL-05
bash tools/test-panels.sh build/clipboard-x-gnome_1.x.x.zip --case PANEL-10 --repeat 3
bash tools/test-panels.sh build/clipboard-x-gnome_1.x.x.zip --case PANEL-02,PANEL-09 --display standard
```

## 显示环境

默认 `--display all` 执行：

- `standard`：单个 1280×720 虚拟屏，执行全部选中项目。
- `dual`：真实增加第二个 1024×768 虚拟屏，在两块屏分别补验 PANEL-02。
- `fractional`：通过 Mutter DisplayConfig 实际应用并回读 125% 显示缩放，再补验 PANEL-02；不使用字体缩放或伪造 monitor 数组。

只有选中 PANEL-02 才运行额外显示环境。可用 `--display standard`、`dual`、`fractional`
单独复现。缺少第二块屏，或当前模式不支持 125%，对应环境会明确失败，不静默跳过或算作通过。

单屏尺寸矩阵允许大于工作区；PANEL-03 检查配置的宽高实际生效，不要求自动缩小超大面板。

## 验收项与断言

| ID | 可复现操作与预期结果 |
| --- | --- |
| PANEL-01 | 顶栏点击、配置后的 Ctrl+Shift+F8 可开关面板；点击桌面空白关闭。 |
| PANEL-02 | 隐藏顶栏后使用快捷键打开；九宫格各测 −18/0/+18 偏移及八组极限偏移，实际 popup 矩形留在目标工作区；额外验证双屏和 125%。 |
| PANEL-03 | 三个面板依次应用 360×400、300×160、480×500、800×800，验证打开时修改；快捷语句的 420×260 局部覆盖不影响历史面板。几何通过 PanelManager 操作真实 actor，入口事件另测。 |
| PANEL-04 | 开启动画，分别在保留现场开/关时用鼠标关闭两个副面板；真实绘制的淡出帧不闪回历史。重开验证语句草稿或分词选择，并验证关闭过程中快速重开。 |
| PANEL-05 | 在固定历史中实际搜索，导航到第 11 条进入分词，再点击返回；搜索、条目身份、操作按钮焦点及稳定后的滚动值不变。 |
| PANEL-06 | 首次键盘目标为搜索框、首个分词、首条快捷语句；空列表为加号，不先聚焦返回按钮。 |
| PANEL-07 | 实际方向键跳过隐藏工具，遍历不等长分词行并到达复制、返回、footer；Ctrl+F 聚焦搜索，Right 在文本中移动光标，只在末尾离开输入框。 |
| PANEL-08 | 开启焦点约束时各面板不逃出；关闭时实际边缘键交回 GNOME；打开原生日期菜单后输入不被插件抢走。交回 GNOME 不意味着每个方向都必须移出。 |
| PANEL-09 | Down 将屏外条目滚入视口；在真实滚轮事件分发前注入历史更新，稳定复现待恢复 idle 与滚轮交错，滚轮优先且不被迟到恢复拉回。 |
| PANEL-10 | 复用 `input-mode.smoke.js`：首次打开和重开的鼠标接续、键鼠切换、直接激活、静止 hover、迟到 tooltip、输入光标及空框编辑、分词选中状态、关闭后的监听清理。 |

全部用例结束后还会验证禁用扩展时输入 filter 和 tooltip source 正确清理。
滚轮与更新的交错是对真实输入竞态的受控安排，不冒充实际网络推送。

## 隔离、稳定性和证据

每种显示环境、每次重复都使用全新 headless Shell、Session Bus、keyfile 设置和 XDG 目录。
测试驱动拒绝在 runner 私有目录之外执行。测试数据是 35 条合成历史及三条快捷语句，不使用
私人剪切板；每项运行前重置配置和导航。主套件首项失败即停止，之后其他显示环境或重复轮次
仍有独立进程；任何一次失败都会保留最终非零退出码。

测试通过有期限的状态等待确认面板、焦点、滚动及几何已稳定；短暂的输入间隔不替代完成断言。
新虚拟鼠标初始化后先移离热角再关闭 Overview，避免热角重新打开 Overview 抢焦点。
动画保持开启。外层 300 秒上限用于捕获 Shell 卡死，不自动重试到成功为止。
配置重置后使用官方空闲等待，让原生配置变更完成。每项开始前还调用原生助手的窗口等待方法，
避免 GNOME [performance helper](https://github.com/GNOME/gnome-shell/blob/main/src/shell-perf-helper.c)
在空闲 30 秒后自行退出，造成断言通过但进程退出失败。清理时先等扩展真正进入 inactive 状态，再检查资源释放。

报告保存在 `build/panel-tests/` 下每次新建的独立目录；`--output /path/to/reports` 可以指定父目录，
适用于仓库只读挂载的容器。目录中包括：

- `summary.txt`：实际 Shell 版本、输入 ZIP 路径及 SHA-256、选择项目、重复次数和各会话结果。
- `standard-N.log`、`dual-N.log`、`fractional-N.log`：完整 Shell 输出、每项 START/PASS/FAIL、
  失败堆栈，以及当时的面板、焦点和几何信息。

终端只显示简明结果及报告位置。非零退出码、缺少完成标记、缺少所选项目的 PASS 标记都会使
本轮失败。清理阶段重试门户卸载造成的临时删除失败，不覆盖原测试结果。若需要测试 GNOME 51，
只给临时 ZIP 补充版本声明，输入的发布包不变。

通过仅适用于这里明确的有限矩阵，不代表所有主题、物理输入设备、显卡驱动或视觉美观均已验证。
完整 UI、设置、剪切板和分词拖选套件保持独立；本套件通过不意味着这些套件也通过。
