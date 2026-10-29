#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' 'Usage: bash tools/test-panels.sh RELEASE_ZIP [50|51] [options]' \
    '  --case PANEL-01,PANEL-10     Run selected cases (default: PANEL-01 through PANEL-10)' \
    '  --repeat N                 Run the suite in N fresh sessions, 1..20 (default: 1)' \
    '  --output DIRECTORY         Parent for unique logs (default: build/panel-tests)' \
    'This local acceptance suite is not part of CI and never installs into the host desktop.'
}
if [[ ${1:-} == '--help' || ${1:-} == '-h' ]]; then usage; exit 0; fi
if [[ $# -lt 1 ]]; then usage >&2; exit 2; fi
archive=$(realpath -e -- "$1")
shift
expected_major=''
if [[ ${1:-} == '50' || ${1:-} == '51' ]]; then expected_major=$1; shift; fi
all_cases='PANEL-01,PANEL-02,PANEL-03,PANEL-04,PANEL-05,PANEL-06,PANEL-07,PANEL-08,PANEL-09,PANEL-10'
cases=$all_cases
repeats=1
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH='' cd -- "$script_dir/.." && pwd)
output_parent="$project_dir/build/panel-tests"
while [[ $# -gt 0 ]]; do
  if [[ $# -lt 2 ]]; then usage >&2; exit 2; fi
  case "$1" in
    --case) cases=$2 ;;
    --repeat) repeats=$2 ;;
    --output) output_parent=$2 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift 2
done
if [[ ! "$cases" =~ ^PANEL-(0[1-9]|10)(,PANEL-(0[1-9]|10))*$ ]]; then
  printf '%s\n' 'Invalid case list: use PANEL-01 through PANEL-10.' >&2; exit 2
fi
if [[ ! "$repeats" =~ ^([1-9]|1[0-9]|20)$ ]]; then
  usage >&2; exit 2
fi
for dependency in gnome-shell gnome-shell-test-tool dbus-run-session timeout sha256sum; do
  command -v "$dependency" >/dev/null || { printf 'Missing dependency: %s\n' "$dependency" >&2; exit 2; }
done
shell_version=$(gnome-shell --version)
shell_major=$(sed -nE 's/^GNOME Shell ([0-9]+).*/\1/p' <<< "$shell_version")
if [[ ! "$shell_major" =~ ^(50|51)$ || ( -n "$expected_major" && "$expected_major" != "$shell_major" ) ]]; then
  printf 'Expected GNOME Shell %s, found %s. No session started.\n' "${expected_major:-50 or 51}" "$shell_major" >&2
  exit 2
fi
panel_runtime=$(mktemp -d /tmp/clipboard-x-simulation-XXXXXX)
cleanup() {
  local result=$? attempt
  trap - EXIT
  for ((attempt = 0; attempt < 50; attempt++)); do
    if rm -rf --one-file-system -- "$panel_runtime" 2>/dev/null; then exit "$result"; fi
    sleep 0.1
  done
  printf 'Warning: runtime cleanup incomplete: %s\n' "$panel_runtime" >&2
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p -- "$output_parent"
report_dir=$(mktemp -d "$output_parent/gnome${shell_major}-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
report_dir=$(realpath -- "$report_dir")
base64 --decode "$project_dir/tests/simulation/panels/fixtures/background.png.base64" > "$panel_runtime/background.png"
summary="$report_dir/summary.txt"
printf 'GNOME Shell: %s\nArchive: %s\nSHA-256: %s\nCases: %s\nRepeats: %s\n' \
  "$shell_version" "$archive" "$(sha256sum "$archive" | cut -d ' ' -f 1)" "$cases" "$repeats" > "$summary"
printf '[panels] Reports: %s\n' "$report_dir"
profiles=(standard)
failed=0
for ((round = 1; round <= repeats; round++)); do
  for profile in "${profiles[@]}"; do
    session_runtime="$panel_runtime/$profile-$round"
    mkdir -m 700 -- "$session_runtime"
    log="$report_dir/$profile-$round.log"
    test_script="$project_dir/tests/simulation/panels/navigation.smoke.js"
    printf '[panels] Running GNOME %s / %s / round %s\n' "$shell_major" "$profile" "$round"
    if (
      export XDG_RUNTIME_DIR="$session_runtime" TMPDIR="$session_runtime"
      export CBX_SIMULATION_RUNTIME="$session_runtime" CBX_PANEL_TEST_CASES="$cases"
      export LIBGL_ALWAYS_SOFTWARE=1 GTK_A11Y=none NO_AT_BRIDGE=1 PYTHONUNBUFFERED=1
      export SHELL_BACKGROUND_IMAGE="$panel_runtime/background.png" XDG_CURRENT_DESKTOP=GNOME XDG_SESSION_TYPE=wayland
      unset DISPLAY WAYLAND_DISPLAY GDK_BACKEND GSETTINGS_SCHEMA_DIR GSETTINGS_BACKEND
      timeout --kill-after=10s 300s dbus-run-session -- gnome-shell-test-tool --headless \
        --extra-filter Gjs --extra-filter gjs --extra-filter org.gnome.Shell.Extensions \
        --extension "$archive" "$test_script"
    ) > "$log" 2>&1; then
      IFS=',' read -r -a expected_cases <<< "$cases"
      complete=true
      for id in "${expected_cases[@]}"; do
        if ! grep -Eq "^\[panels\] PASS $id( |$)" "$log"; then complete=false; fi
      done
      if ! grep -q "^\[panels\] COMPLETE $profile:" "$log"; then complete=false; fi
      if [[ "$complete" == true ]]; then
        grep '^\[panels\]' "$log"
        printf 'PASS %s round %s\n' "$profile" "$round" | tee -a "$summary"
        continue
      fi
    fi
    failed=1
    printf 'FAIL %s round %s; log: %s\n' "$profile" "$round" "$log" | tee -a "$summary"
    tail -n 55 "$log"
  done
done
printf '[panels] Summary: %s\n' "$summary"
exit "$failed"
