# clipboard-x-gnome 文档

> 简体中文 · [English](README.md)

这里是 Clipboard X 的公开文档，内容面向扩展使用者、兼容服务器开发者和项目贡献者。
英文是项目文档的主语言，简体中文是对应的副语言。指南直接放在 `docs/` 根目录，
各版本发布说明放在 `docs/release/`。指南英文使用 `{name}.md`，中文使用 `{name}_CN.md`，
同一指南的两种语言放在同一目录，文首链接用于切换语言。发布说明分别使用
`v{version}-en.md` 和 `v{version}-cn.md`，文首链接指向对应版本标签下的另一语言文档。
GitHub Release 默认展示英文，并提供中文入口。

## 版本发布

- [1.0.2 发布说明](release/v1.0.2-cn.md)：词库异步加载、面板生命周期修复与发布包清理。
- [1.0.1 发布说明](release/v1.0.1-cn.md)：启动、同步与历史保存修复。
- [1.0.0 发布说明](release/v1.0.0-cn.md)：首个正式版本的功能介绍。

## 协议与同步

- [同步协议（HTTP API v1）](https://github.com/guleoo/clipboard-x-server/blob/master/docs/zh-CN/protocol.md)：
  由 Server 负责制定，当前 GNOME 客户端及未来其他平台客户端共同遵循。
- [同步性能与压力测试指南](sync-performance-testing_CN.md)：日常基线、10 倍压力矩阵和可重复
  的 Meson 测试命令。

## 扩展开发

- [GNOME Shell 兼容性](shell-compatibility_CN.md)：50+ 共用接口、CI 矩阵和隔离生命周期检查。

- [日志与问题排查](diagnostics_CN.md)：系统 journal、Devkit 输出、初始化阶段与隐私边界。
- [界面开发指南](ui-architecture_CN.md)：面板、控件、焦点矩阵、生命周期和 CSS 约定。
- [参与开发](../CONTRIBUTING.zh-CN.md)：构建、测试、目录结构、协议改动和代码约定。

## 安全与数据流

- [安全说明](../SECURITY.zh-CN.md)：本地数据、同步服务器信任边界、外部命令和漏洞报告方式。

## 文档职责

`docs/` 只保留可公开、可供用户或贡献者直接阅读的指南与发布说明。阶段性完成审计、发布
审核草稿、内部决策和实验记录放在 `.codex/`，不作为 GitHub 公开文档导航的一部分。
