#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  printf '%s\n' 'Usage: tools/test-shell-compatibility.sh RELEASE_ZIP [50|51]' >&2
  exit 2
fi

archive=$(realpath -- "$1")
shell_major=$(gnome-shell --version | sed -nE 's/^GNOME Shell ([0-9]+).*/\1/p')
expected_major=${2:-"$shell_major"}
if [[ "$shell_major" != "$expected_major" || ! "$shell_major" =~ ^(50|51)$ ]]; then
  printf 'Expected supported GNOME Shell %s, found %s.\n' "$expected_major" "$shell_major" >&2
  exit 1
fi

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH='' cd -- "$script_dir/.." && pwd)
test_runtime=$(mktemp -d /tmp/clipboard-x-gnome-shell-test-XXXXXX)
cleanup_runtime() {
  local result=$?
  local attempt
  trap - EXIT
  # Bus-activated helpers can still be unmounting the document portal after Shell exits.
  # Do not traverse their mounts, and retry transient removal failures without hiding the test status.
  for ((attempt = 0; attempt < 50; attempt++)); do
    if rm -rf --one-file-system -- "$test_runtime" 2>/dev/null; then
      exit "$result"
    fi
    sleep 0.1
  done
  printf 'Warning: could not clean up test runtime: %s\n' "$test_runtime" >&2
  exit "$result"
}
trap cleanup_runtime EXIT

# Keep the upload artifact unchanged while exercising GNOME 51 runtime support.
if [[ "$shell_major" == '51' ]]; then
  test_archive="$test_runtime/$(basename -- "$archive")"
  python3 - "$archive" "$test_archive" <<'PY'
import json
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as source, zipfile.ZipFile(sys.argv[2], "w") as target:
    metadata = json.loads(source.read("metadata.json"))
    if "51" not in metadata["shell-version"]:
        metadata["shell-version"].append("51")
    for entry in source.infolist():
        content = source.read(entry)
        if entry.filename == "metadata.json":
            content = (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        target.writestr(entry, content)
    target.comment = source.comment
PY
  archive="$test_archive"
  printf '%s\n' 'GNOME Shell 51 added to temporary test ZIP metadata; release ZIP unchanged.'
fi

export XDG_RUNTIME_DIR="$test_runtime"
export LIBGL_ALWAYS_SOFTWARE=1 GTK_A11Y=none NO_AT_BRIDGE=1
# Do not depend on the performance tool's animated wallpaper or distro background packages.
base64 --decode "$project_dir/tests/simulation/panels/fixtures/background.png.base64" > "$test_runtime/background.png"
export SHELL_BACKGROUND_IMAGE="$test_runtime/background.png"
export PYTHONUNBUFFERED=1
# Never inherit the host display or a development-session schema override.
unset DISPLAY WAYLAND_DISPLAY GDK_BACKEND GSETTINGS_SCHEMA_DIR
printf 'Testing extension lifecycle on GNOME Shell %s in an isolated headless session.\n' "$shell_major"
timeout --kill-after=10s 120s dbus-run-session -- \
  gnome-shell-test-tool --headless --disable-animations --extra-filter Gjs --extra-filter gjs --extension "$archive" \
  "$project_dir/tests/simulation/lifecycle/compatibility.smoke.js"
