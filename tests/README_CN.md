# 测试目录说明

> 简体中文 · [English](README.md)

测试以**逻辑验证**为主：插件的决策都放在不依赖 GNOME Shell 的模块里，用真实的存储、
文件、私有 D-Bus 和本地 HTTP 验证。**模拟桌面**只保留少量必须经过真实 Shell 才能证明的
核心接线，作为发版前的冒烟检查。

```text
tests/
  logic/        # 无需图形桌面；Meson 注册，CI 运行
  simulation/   # 真实 Shell/GTK；本地显式运行，不进 CI
    helpers/    # 共用的隔离桌面驱动
    panels/     # PANEL-01～10 面板导航
  fixtures/     # 独立 GTK 来源/接收端、设置进程、会话包装
```

## 逻辑验证（日常）

```sh
dbus-run-session -- meson test -C build --no-suite stress --print-errorlogs   # bun run test:logic
bash tools/test-logic-acceptance.sh                                            # bun run test:logic:acceptance
```

第一条是普通回归，几秒完成，CI 在 GNOME 50/51 上运行。第二条是无图形验收：捕获状态、
历史控制器、输入保护、截图编排、快捷语句草稿和网络词库，使用私有 Session Bus；CI 同样运行，
缺少依赖（`BLOCKED`，退出码 2）会使任务失败，而不是算作通过。
`--suite stress` 是可选压力测试，见[同步性能测试](../docs/sync-performance-testing_CN.md)。

需要真实同步服务端的无图形集成（需要 Docker 和相邻的 `clipboard-x-server` 源码或镜像）：

```sh
python3 tools/test-sync-server.py build/clipboard-x-gnome_1.x.x.zip [--image IMAGE] [--case SEND-04]
```

## 模拟桌面（发版前）

```sh
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip            # 13 个核心场景，共用一个 Shell
python3 tools/test-simulation.py build/clipboard-x-gnome_1.x.x.zip --isolate-cases   # 每个场景单独一个 Shell
bash tools/test-panels.sh build/clipboard-x-gnome_1.x.x.zip                     # PANEL-01～10
bash tools/test-shell-compatibility.sh build/clipboard-x-gnome_1.x.x.zip        # 启用/禁用/重新启用
```

运行目录位于私有 `/tmp/clipboard-x-simulation-*`，XDG、Session Bus、剪切板来源和输入目标均隔离，
不修改宿主桌面。报告保存在 `build/simulation-tests/`。`PASS`、`FAIL`、`NOT_RUN`、`BLOCKED`
分别表示通过、失败、未执行、缺少依赖。

## 场景 → 测试

| 场景 | 逻辑测试 | 模拟桌面 |
|---|---|---|
| 捕获文本/图片、写回剪切板 | `clipboard/capture`、`content`、`history/controller` | CLIP-01、CLIP-04、CLIP-09 |
| 历史排序、固定、容量、搜索、损坏恢复 | `clipboard/history/*` | — |
| 隐私模式、排除应用 | `clipboard/capture` | PRIV-01 |
| 快捷语句 | `clipboard/phrases/store`、`ui/phrase-draft` | PHRASE-01（含 Esc）、PHRASE-04 |
| 分词、词库、输入上限 | `clipboard/tokenizer/*` | — |
| 分词选择、迟到结果 | `ui/word-selection` | SELECT-01、WORD-05 |
| 模拟输入（序列、档位、熔断） | `clipboard/terminal/*` | TYPE-01、TYPE-03 |
| 截图、编辑器 | `screenshot/*` | SHOT-03 |
| 取色 | `color-picker/color` | COLOR-01 |
| 设置 | `ui/settings-defaults`、`shortcut-capture`、`string-choice` 等 | SET-01 |
| 面板导航与焦点 | `ui/focus-grid`、`panel-manager`、`panel-actions`、`entry-actions` | `test-panels.sh` |
| 同步（策略、协议、传输、队列） | `sync/*`、`ui/sync-*` | —（`test-sync-server.py`） |
| 启用/禁用生命周期 | — | `test-shell-compatibility.sh` |

## 新增测试

- 先把行为放进可在 `gjs` 中直接导入的模块，再写逻辑测试并注册到 `meson.build`。
- 只有无法在 Shell 之外证明的接线才加模拟用例；在 `simulation/manifest.json` 登记 ID，
  实现放在对应领域的 `native.js` 中，每个用例自行恢复修改过的状态。
- 断言行为结果和错误码，不匹配翻译后的错误文字、文档措辞或样式细节。
