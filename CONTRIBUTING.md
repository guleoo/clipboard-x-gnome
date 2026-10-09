# Contributing to clipboard-x-gnome

> English · [简体中文](CONTRIBUTING.zh-CN.md)

Clipboard X Gnome targets GNOME Shell 50+ and GJS 1.88 or later. Shell UI code must use St, Clutter, and
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

The project does not use ESLint. Run `node --check` for changed JavaScript files and tests relevant to
the behavior changed. Use the complete Meson suite for changes to shared interfaces or core logic.
Add lasting regression tests for repeatable behavior, not document wording, CSS details, fixed icon
names, or routine widget properties. Validate CI/release configuration with existing checks, temporary
scripts, or isolated dry-runs instead of adding tests that lock its formatting.

Shell interaction and preferences checks run separately from Meson, in an isolated test desktop:

```sh
run_shell_check() (
  test_runtime=$(mktemp -d /tmp/clipboard-x-gnome-check-XXXXXX)
  trap 'rm -rf -- "$test_runtime"' EXIT
  export XDG_RUNTIME_DIR="$test_runtime" LIBGL_ALWAYS_SOFTWARE=1 GTK_A11Y=none NO_AT_BRIDGE=1
  unset DISPLAY WAYLAND_DISPLAY GDK_BACKEND GSETTINGS_SCHEMA_DIR
  dbus-run-session -- gnome-shell-test-tool --headless \
    --extension build/clipboard-x-gnome_<version>.zip "$1"
)
run_shell_check tests/ui/shell.smoke.js
run_shell_check tests/ui/preferences.smoke.js
```

For privacy boundaries, search cursor navigation / color-picker movement, or screenshot cancellation,
run the corresponding focused check using the same helper:

```sh
run_shell_check tests/ui/privacy.smoke.js
run_shell_check tests/ui/search-picker.smoke.js
run_shell_check tests/ui/screenshot-cancel.smoke.js
```

The device-icon chooser has a separate GTK integration check. It requires a graphical display and
a configured package build; it uses an in-memory settings backend, not the host extension's settings:

```sh
shell_libdir=/usr/lib/gnome-shell
dbus-run-session -- env GSETTINGS_BACKEND=memory GTK_A11Y=none NO_AT_BRIDGE=1 \
  GI_TYPELIB_PATH="$shell_libdir/girepository-1.0" LD_LIBRARY_PATH="$shell_libdir" \
  CBX_TEST_BUILD_DIR="$PWD/build" gjs -m tests/ui/settings-icon.integration.js
```

Set `shell_libdir` to the installed GNOME Shell library directory (typically
`/usr/lib64/gnome-shell` on Fedora). Its private typelibs are needed by the preferences API.

Dictionary throughput and memory measurements belong in the optional benchmark, not normal CI
regressions. Supply a local dictionary file; the benchmark does not download one:

```sh
gjs -m tools/benchmark-tokenizer.js /path/to/dictionary.txt 1000
```

Report checks executed and their results, plus any checks skipped and why. Visual CSS changes can
be checked through a build and manual inspection without new automated assertions.

### Nested desktop and interface language

`./tools/run-dev-shell.sh` builds and packages the extension, then starts a nested GNOME desktop
with isolated development settings. To start it in English, run:

```sh
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LANGUAGE=en ./tools/run-dev-shell.sh
```

Close any existing nested desktop before restarting with a different language. These environment
variables affect only this development session, not the host desktop language. Use `locale -a` to
check installed locales; the script has no `--lang` option.

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
meson compile -C build clipboard-x-gnome-pot
meson compile -C build clipboard-x-gnome-update-po
```

Then update every catalog listed in `po/LINGUAS` and run
`bash tests/i18n/coverage.sh`. The check verifies extracted strings, gettext format validity, and
missing or fuzzy translations. English is the source language and has no PO catalog.
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

The [CI workflow](.github/workflows/ci.yml) runs on every push (branches and tags) and pull request in a
Fedora 44 / GNOME 50 and Fedora 45 / GNOME 51 matrix. It checks JavaScript syntax, runs the Meson
regression suite with `--no-suite stress`, builds the extension ZIP, and verifies that the archive
contains exactly the runtime files and compiled catalogs.
Both environments also run an isolated headless extension lifecycle check. One ZIP is uploaded only
after validation. CI only validates and retains artifacts; it never publishes a release.
The separate [Release workflow](.github/workflows/release.yml) runs only when a `v*` tag is pushed.
It repeats the same checks at the tagged commit and publishes only after both jobs succeed.
Ordinary branch pushes and pull requests cannot publish a release.
Stress tests remain available locally and are not run by GitHub CI.

To build a local release ZIP without installing it into the desktop or changing Git state, run:

```sh
./tools/release.sh
```

The result is `build/release/clipboard-x-gnome_<version>.zip`, for example
`clipboard-x-gnome_1.0.3.zip`. The version comes from Meson. The script configures a dedicated package build,
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

For each version, summarize changes and fixes and end both
language files with a **Full Changelog** comparison of the previous release tag and the new one.
For example, for v1.0.1 following v1.0.0:

```md
**Full Changelog**: [v1.0.0...v1.0.1](https://github.com/guleoo/clipboard-x-gnome/compare/v1.0.0...v1.0.1)
```

Submission to [GNOME Shell Extensions](https://extensions.gnome.org/) is optional. To enable it,
set the repository Actions variable `EGO_UPLOAD_ENABLED` to `true` and add repository secrets
`EGO_USER` and `EGO_PASSWORD` for an account authorized to upload this extension. On a passing
release tag, the workflow submits the same checked ZIP with `gnome-extensions upload`; it passes the
password via standard input and keeps the CLI token cache in the disposable CI environment. Without
the variable, no upload is attempted. If the variable is enabled but either secret is missing, the
upload job fails clearly. Upload success means **submitted for review**, not yet approved or visible
in the GNOME extension store.
