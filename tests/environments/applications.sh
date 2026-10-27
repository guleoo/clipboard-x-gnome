#!/usr/bin/env bash
# Optional real applications only; never run this installer on the host.
set -euo pipefail
# BuildKit does not create /.dockerenv during RUN. These sentinels are
# installed by the test image's baseline stage, not by a host installation.
[[ "${CBX_TEST_PROFILE:-}" == applications && -f /opt/test-session.py && -f /opt/test-packages.txt ]]

gradia_revision=9b474de0290913a27615154715db64a9baea6666
gradia_sha256=9a761dfcf16fee3719f6aaf8a84e1fe24a262b57c57e7cfe3092d371b977c5ca
flatpak_application=be.alexandervanhee.gradia
flatpak_commit=f90353219ad2384fc427fcf8b830aec26b7c9eb6a4a8165dd20db4107e7a3312
flatpak_runtime=org.gnome.Platform/x86_64/51
runtime_commit=36d7e84ff76b57bc8dd4ccf702bd154e3d15dcad2059d353d69edd10a6f3e3a3

dnf install -y --setopt=install_weak_deps=False \
    gcc pkgconf-pkg-config curl tar gzip desktop-file-utils python3-pillow python3-pytesseract blueprint-compiler \
    'pkgconfig(glib-2.0)' 'pkgconfig(gtk4)' 'pkgconfig(libadwaita-1)' \
    'pkgconfig(pygobject-3.0)' 'pkgconfig(gtksourceview-5)' \
    libportal-gtk4 flatpak ibus-libpinyin mutter-devkit
dnf clean all

application_build=$(mktemp -d /tmp/cbx-test-applications-XXXXXX)
trap 'rm -rf -- "$application_build"' EXIT
curl --fail --location --retry 3 \
    "https://codeload.github.com/AlexanderVanhee/Gradia/tar.gz/$gradia_revision" \
    --output "$application_build/gradia.tar.gz"
printf '%s  %s\n' "$gradia_sha256" "$application_build/gradia.tar.gz" | sha256sum --check --strict
mkdir "$application_build/source"
tar -xzf "$application_build/gradia.tar.gz" --strip-components=1 -C "$application_build/source"
meson setup "$application_build/build" "$application_build/source" \
    --prefix=/usr/local --buildtype=release -Denable-ocr=false
meson compile -C "$application_build/build"
meson install -C "$application_build/build"
gradia_version=$(meson introspect --projectinfo "$application_build/build" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
[[ "$gradia_version" == 1.13.0 ]]
# This pinned Gradia imports its OCR module even with enable-ocr=false.
python3 -c 'import pytesseract'

# Install is needed before pinning: `flatpak install` has no --commit option.
# Keep the real app sandbox and its runtime; omit optional locale/debug refs.
flatpak --system remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak --system install --assumeyes --noninteractive --no-related flathub "$flatpak_application"
flatpak --system update --assumeyes --noninteractive --no-related \
    --commit="$flatpak_commit" "$flatpak_application"
[[ "$(flatpak --system info --show-runtime "$flatpak_application")" == "$flatpak_runtime" ]]
flatpak --system update --assumeyes --noninteractive --no-related \
    --commit="$runtime_commit" "$flatpak_runtime"
[[ "$(flatpak --system info --show-commit "$flatpak_application")" == "$flatpak_commit" ]]
[[ "$(flatpak --system info --show-commit "$flatpak_runtime")" == "$runtime_commit" ]]

# Fixture path bridge only: Fedora's genuine helper lives in libexec, whereas
# run-dev-shell currently probes the Arch path. This is not a product fix.
test -x /usr/libexec/mutter-devkit
ln -s /usr/libexec/mutter-devkit /usr/lib/mutter-devkit

python3 - "$gradia_revision" "$gradia_sha256" "$gradia_version" \
    "$flatpak_application" "$flatpak_commit" "$flatpak_runtime" "$runtime_commit" <<'PY'
import json
from pathlib import Path
import sys

revision, checksum, version, application, commit, runtime, runtime_commit = sys.argv[1:]
Path('/opt/test-applications.json').write_text(json.dumps({
    'gradia': {'revision': revision, 'sha256': checksum, 'version': version},
    'flatpak': {'application': application, 'commit': commit,
                'runtime': runtime, 'runtimeCommit': runtime_commit},
    'devkitPathBridge': '/usr/lib/mutter-devkit -> /usr/libexec/mutter-devkit',
}, indent=2) + '\n')
PY
rpm -qa | sort > /opt/test-packages.txt
