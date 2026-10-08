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
test_runtime=$(mktemp -d /tmp/clipboard-x-shell-test-XXXXXX)
trap 'rm -rf -- "$test_runtime"' EXIT
export XDG_RUNTIME_DIR="$test_runtime"
export LIBGL_ALWAYS_SOFTWARE=1 GTK_A11Y=none NO_AT_BRIDGE=1
# Never inherit the host display or a development-session schema override.
unset DISPLAY WAYLAND_DISPLAY GDK_BACKEND GSETTINGS_SCHEMA_DIR
printf 'Testing extension lifecycle on GNOME Shell %s in an isolated headless session.\n' "$shell_major"
timeout --kill-after=10s 120s dbus-run-session -- \
  gnome-shell-test-tool --headless --extension "$archive" \
  "$project_dir/tests/ui/compatibility.smoke.js"
