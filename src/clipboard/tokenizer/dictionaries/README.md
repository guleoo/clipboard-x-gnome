# Chinese tokenizer dictionary

`chinese-core.txt` is a compact, runtime-ready subset of the cppjieba dictionary.
It contains Han words of 2–8 characters with an upstream frequency of at least
50. POS tags and low-frequency entries are omitted to limit extension package
size and GNOME Shell heap usage.

- Upstream: [yanyiwu/cppjieba](https://github.com/yanyiwu/cppjieba)
- Source distribution: OpenCC `1.3.2` `jieba.dict.utf8`
- Source SHA-256: `6f7d4350e8861ef4139b2e3a6fad05430c19ae71f4b8378190edecac8aae2e6a`
- Upstream license: MIT
- Runtime entries: 45,967
- Runtime file SHA-256: `dd23abc312cebea84b88e3c2f4a3c0e11de6abbcb9f8c3807a0dee756d4f32a3`

The extension loads this file only when Chinese text is first segmented. The
settings process and normal clipboard capture path never parse it.
