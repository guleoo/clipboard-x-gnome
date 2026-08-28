# Clipboard X documentation

> English · [简体中文](zh-CN/README.md)

This directory contains public documentation for extension users, compatible-server developers, and
contributors. Files without a language suffix are the English primary versions. Simplified Chinese
counterparts are kept under `docs/zh-CN/` with the same names.

## Protocol and synchronization

- [Synchronization Protocol (HTTP API v1)](sync-protocol.md): the public interface between the
  extension and a user-configured central server, including manifests, previews, on-demand materialization,
  transfer state, and recovery semantics.
- [Synchronization performance and stress testing](sync-performance-testing.md): the daily baseline,
  10x stress matrix, and reproducible Meson commands.

## Extension development

- [UI development guide](ui-architecture.md): panels, controls, focus grids, lifecycle, and CSS conventions.
- [Contributing](../CONTRIBUTING.md): build, test, layout, protocol changes, and code conventions.

## Security and data flows

- [Security and privacy](../SECURITY.md): local data, the synchronization-server trust boundary,
  external commands, and vulnerability reporting.

## Language policy

English is the primary language for project documentation. Every public guide has a Simplified Chinese
counterpart in `docs/zh-CN/`; links at the top of each page provide the language switch. Legal texts,
including `LICENSE.md`, retain their original English wording and are not mirrored as translated legal
documents.
