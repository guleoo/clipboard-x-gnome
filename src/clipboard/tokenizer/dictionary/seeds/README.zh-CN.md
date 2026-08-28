# 预导入分词词库

> 简体中文 · [English](README.md)

`zh--cppjieba-core.dict` 是 cppjieba 词典的精简运行时子集，包含长度为 2–8 个字符、
上游词频至少为 50 的汉字词语。为了限制扩展包大小和 GNOME Shell 堆内存占用，文件不包含
词性标签和低频词条。

- 上游项目：[yanyiwu/cppjieba](https://github.com/yanyiwu/cppjieba)
- 源发行版：OpenCC `1.3.2` 的 `jieba.dict.utf8`
- 源文件 SHA-256：`6f7d4350e8861ef4139b2e3a6fad05430c19ae71f4b8378190edecac8aae2e6a`
- 上游许可证：MIT
- 运行时词条数：45,967
- 语言区域：`zh`

此目录仅用于测试和 benchmark，不会安装到扩展目录，也不会进入发布归档；用户需要在设置
中明确添加词库。
