# Contributing to clipboard-x-gnome

> English · [简体中文](CONTRIBUTING.zh-CN.md)

Clipboard X targets GNOME Shell 50 and GJS 1.88 or later. Shell UI code must use St, Clutter, and
Shell APIs; GTK 4 and Libadwaita are restricted to the separate preferences process.

## Development workflow

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
gnome-shell-test-tool --headless --extension build/clipboard-x-gnome.zip tests/ui/shell.smoke.js
gnome-shell-test-tool --headless --extension build/clipboard-x-gnome.zip tests/ui/preferences.smoke.js
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
`.zh-CN.md` or `docs/zh-CN/` counterpart.

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
Fedora 44 / GNOME 50 environment. It checks JavaScript syntax, runs the full Meson suite, builds the
extension ZIP, and verifies that the archive contains exactly the runtime files and compiled catalogs.
Pull requests cannot publish a release.

To release, update the matching `version` values in `meson.build` and `package.json` using `X.Y.Z`,
run the development checks above, then push the commit and an annotated `vX.Y.Z` tag. For example:

```sh
git tag -a v0.1.0 -m 'Clipboard X 0.1.0'
git push origin master v0.1.0
```

The tag must match both project versions and the generated `metadata.json` `version-name`, or the
workflow stops before publication. A passing tag build creates a GitHub Release with
`clipboard-x-gnome.zip` attached. Do not set the EGO-managed numeric `metadata.version` yourself.

Submission to [GNOME Shell Extensions](https://extensions.gnome.org/) is optional. To enable it,
set the repository Actions variable `EGO_UPLOAD_ENABLED` to `true` and add repository secrets
`EGO_USER` and `EGO_PASSWORD` for an account authorized to upload this extension. On a passing
release tag, the workflow submits the same checked ZIP with `gnome-extensions upload`; it passes the
password via standard input and keeps the CLI token cache in the disposable CI environment. Without
the variable, no upload is attempted. If the variable is enabled but either secret is missing, the
upload job fails clearly. Upload success means **submitted for review**, not yet approved or visible
in the GNOME extension store.
