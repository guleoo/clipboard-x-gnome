# Pre-imported tokenizer dictionaries

> English · [简体中文](README.zh-CN.md)

`zh--cppjieba-core.dict` is a compact, runtime-ready subset of the cppjieba dictionary.
It contains Han words of 2–8 characters with an upstream frequency of at least
50. POS tags and low-frequency entries are omitted to limit extension package
size and GNOME Shell heap usage.

- Upstream: [yanyiwu/cppjieba](https://github.com/yanyiwu/cppjieba)
- Source distribution: OpenCC `1.3.2` `jieba.dict.utf8`
- Source SHA-256: `6f7d4350e8861ef4139b2e3a6fad05430c19ae71f4b8378190edecac8aae2e6a`
- Upstream license: MIT
- Runtime entries: 45,967
- Locale: `zh`

This directory is used only by tests and benchmarks. It is excluded from both
the installed extension and release archive; users add dictionaries explicitly
from settings.
