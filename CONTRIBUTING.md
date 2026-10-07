# Contributing to clipboard-x-gnome

> English · [简体中文](CONTRIBUTING.zh-CN.md)

Clipboard X targets GNOME Shell 50 and 51, and GJS 1.88 or later. Shell UI code must use St, Clutter, and
Shell APIs; GTK 4 and Libadwaita are restricted to the separate preferences process.

## Development workflow

Use APIs shared by both supported Shell versions. See the [compatibility guide](docs/shell-compatibility.md)
for the isolated lifecycle check and its verification boundaries.

```sh
meson setup build -Dtarget=package
meson compile -C build
meson test -C build --print-errorlogs
meson install -C build
```

The project does not use ESLint. Before committing, run `node --check` for every JavaScript file and
the complete Meson test suite. Changes involving extension lifecycle, panels, clipboard, color picker,
or preferences must also run:

```sh
gnome-shell-test-tool --headless --extension build/clipboard-x-gnome_1.0.0.zip tests/ui/shell.smoke.js
gnome-shell-test-tool --headless --extension build/clipboard-x-gnome_1.0.0.zip tests/ui/preferences.smoke.js
```

## Repository layout

- `src/extension.js` and `src/prefs.js` are only the GNOME entry points.
- `src/common/` contains infrastructure shared by multiple domains.
- `src/entry/`, `clipboard/`, `sync/`, `screenshot/`, `color-picker/`, and `ui/` are organized
  by feature domain; tokenization belongs to `src/clipboard/tokenizer/`.
- `tests/` follows the same domain layout; cross-process fixtures live in `tests/fixtures/`.

Clipboard X Server owns the synchronization protocol and its OpenAPI contract. Propose and land protocol
changes in the Server repository first; then update the GJS routes and validators and the client conformance
tests here. A breaking change requires a new HTTP API major version; do not change the meaning of an existing
v1 field in place from this client.

## Localization

User-visible strings use the extension's `gettext` domain. After adding strings, run:

```sh
meson compile -C build clipboard-x-pot
meson compile -C build clipboard-x-update-po
```

Then update every catalog listed in `po/LINGUAS` and run
`bash tests/i18n/coverage.sh`. The check rejects missing or fuzzy translations and missing
image-editor command placeholders. English is the source language and has no PO catalog.
Machine-translated drafts need native-speaker review before their wording is considered final.
Chinese documentation is maintained as the
`.zh-CN.md` counterpart for repository-root files, or a `{name}_CN.md` counterpart directly in `docs/`.
Each version has separate `v<version>-en.md` and `v<version>-cn.md` release notes in `docs/release/`.

## Code conventions

- The owner of every lifecycle resource keeps its handle and releases it in `disable()` or `destroy()`.
- Do not synchronously read large files or decode large images on the Shell main thread.
- Do not log clipboard contents, user paths, raw server error bodies, or authentication data.
- External commands must use argv and `Gio.SubprocessLauncher`; never invoke an implicit `sh -c`.
- Public APIs use the domain as context and the member as the action; avoid redundant context,
  opaque abbreviations, and hidden behavior.
- Validate protocol types, counts, and sizes before allocating or reading payloads.

Release ZIPs must contain only the runtime extension, schemas, CSS, metadata, and compiled translations;
they must not include tests, protocol source, dictionaries, or the central server.

## Releases

The [release workflow](.github/workflows/release.yml) runs on every push and pull request in a
Fedora 44 / GNOME 50 and Fedora 45 / GNOME 51 matrix. It checks JavaScript syntax, runs the full Meson suite, builds the
extension ZIP, and verifies that the archive contains exactly the runtime files and compiled catalogs.
Both environments also run an isolated headless extension lifecycle check. One ZIP is uploaded only
after validation; release publication waits for both jobs. Pull requests cannot publish a release.

To build a local release ZIP without installing it into the desktop or changing Git state, run:

```sh
./tools/release.sh
```

The result is `build/release/clipboard-x-gnome_<version>.zip`, for example
`clipboard-x-gnome_1.0.0.zip`. The version comes from Meson. The script configures a dedicated package build,
checks JavaScript syntax, runs the full Meson suite, and validates the archive and version.

To publish, update the matching `version` values in `meson.build` and `package.json` using `X.Y.Z`,
commit all changes, then run `./tools/release.sh --publish`. This additionally pushes the current
branch, creates an annotated `vX.Y.Z` tag, and pushes the tag to its configured remote. If multiple
remotes are available, specify one with `--remote NAME`. Publishing requires a clean working tree
and working Git credentials; it never force-pushes or overwrites an existing remote tag.

The tag must match both project versions and the generated `metadata.json` `version-name`, or the
workflow stops before publication. A passing tag build creates a GitHub Release with
`clipboard-x-gnome_<version>.zip` attached. Do not set the EGO-managed numeric `metadata.version` yourself.
Before tagging, prepare and commit both `docs/release/v<version>-en.md` and
`docs/release/v<version>-cn.md`. The workflow requires both files and uses the English file as the
GitHub Release description; notes are written ahead of time, not generated from commits.
Include a Simplified Chinese link at the top of the English file and an English link in the Chinese
file. Use absolute URLs pointing to these files at the matching version tag so the links work both
in the repository and in the GitHub Release, and remain tied to that version.

Version 1.0.0 describes features only. For later versions, summarize changes and fixes and end both
language files with a **Full Changelog** comparison of the previous release tag and the new one.
For example, for a future 1.1.0 release following 1.0.0:

```md
**Full Changelog**: [v1.0.0...v1.1.0](https://github.com/guleoo/clipboard-x-gnome/compare/v1.0.0...v1.1.0)
```

Submission to [GNOME Shell Extensions](https://extensions.gnome.org/) is optional. To enable it,
set the repository Actions variable `EGO_UPLOAD_ENABLED` to `true` and add repository secrets
`EGO_USER` and `EGO_PASSWORD` for an account authorized to upload this extension. On a passing
release tag, the workflow submits the same checked ZIP with `gnome-extensions upload`; it passes the
password via standard input and keeps the CLI token cache in the disposable CI environment. Without
the variable, no upload is attempted. If the variable is enabled but either secret is missing, the
upload job fails clearly. Upload success means **submitted for review**, not yet approved or visible
in the GNOME extension store.
