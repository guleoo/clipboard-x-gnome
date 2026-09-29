# clipboard-x-gnome 文档

> 简体中文 · [English](../README.md)

这里是 Clipboard X 的公开文档，内容面向扩展使用者、兼容服务器开发者和项目贡献者。
英文是项目文档的主语言，简体中文是对应的副语言；本目录与英文目录保持相同文件名，
方便在两种语言之间切换。

## 协议与同步

- [同步协议（HTTP API v1）](https://github.com/guleoo/clipboard-x-server/blob/master/docs/zh-CN/protocol.md)：
  由 Server 负责制定，当前 GNOME 客户端及未来其他平台客户端共同遵循。
- [同步性能与压力测试指南](sync-performance-testing.md)：日常基线、10 倍压力矩阵和可重复
  的 Meson 测试命令。

## 扩展开发

- [界面开发指南](ui-architecture.md)：面板、控件、焦点矩阵、生命周期和 CSS 约定。
- [参与开发](../../CONTRIBUTING.zh-CN.md)：构建、测试、目录结构、协议改动和代码约定。

## 安全与数据流

- [安全说明](../../SECURITY.zh-CN.md)：本地数据、同步服务器信任边界、外部命令和漏洞报告方式。

## 文档职责

`docs/` 只保留可长期公开、可供用户或贡献者直接阅读的指南和协议。阶段性完成审计、发布
审核草稿、内部决策和实验记录放在 `.codex/`，不作为 GitHub 公开文档导航的一部分。
