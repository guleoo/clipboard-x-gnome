# clipboard-x-gnome documentation

> English · [简体中文](README_CN.md)

This directory contains public documentation for extension users and contributors. Guides live directly
in `docs/`; versioned release notes live in `docs/release/`. English primary versions use `{name}.md`,
and Simplified Chinese counterparts use `{name}_CN.md` in the same directory. Release notes are a
single bilingual file per version, with English followed by Simplified Chinese.

## Releases

- [1.0.0 release notes](release/v1.0.0.md): features included in the initial stable release.

## Protocol and synchronization

- [Synchronization Protocol (HTTP API v1)](https://github.com/guleoo/clipboard-x-server/blob/master/docs/protocol.md):
  the Server-owned contract followed by this GNOME client and future clients on other platforms.
- [Synchronization performance and stress testing](sync-performance-testing.md): the daily baseline,
  10x stress matrix, and reproducible Meson commands.

## Extension development

- [Logs and troubleshooting](diagnostics.md): system journal, Devkit output, initialization stages, and privacy boundaries.
- [UI development guide](ui-architecture.md): panels, controls, focus grids, lifecycle, and CSS conventions.
- [Contributing](../CONTRIBUTING.md): build, test, layout, protocol changes, and code conventions.

## Security and data flows

- [Security and privacy](../SECURITY.md): local data, the synchronization-server trust boundary,
  external commands, and vulnerability reporting.

## Language policy

English is the primary language for project documentation. Every public guide has a Simplified Chinese
counterpart named `{name}_CN.md` in the same directory; links at the top of each page provide the language switch. Legal texts,
including `LICENSE.md`, retain their original English wording and are not mirrored as translated legal
documents. Release notes use a single bilingual file instead of separate language files.
