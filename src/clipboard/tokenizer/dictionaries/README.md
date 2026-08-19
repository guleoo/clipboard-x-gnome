# Chinese tokenizer dictionary

`chinese-core.txt` is a compact, runtime-ready subset of the jieba dictionary.
It contains Han words of 2–8 characters with an upstream frequency of at least
50. POS tags and low-frequency entries are omitted to limit extension package
size and GNOME Shell heap usage.

- Upstream: [fxsjy/jieba](https://github.com/fxsjy/jieba)
- Upstream version: `v0.42.1`
- Upstream license: MIT
- Runtime entries: 45,967
- Runtime file SHA-256: `dd23abc312cebea84b88e3c2f4a3c0e11de6abbcb9f8c3807a0dee756d4f32a3`

The extension loads this file only when Chinese text is first segmented. The
settings process and normal clipboard capture path never parse it.
