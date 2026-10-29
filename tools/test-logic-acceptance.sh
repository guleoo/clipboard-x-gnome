#!/usr/bin/env bash
# Headless acceptance extracted from desktop suites; also run by CI.
set -uo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$project_root" || exit 1
passed=0
failed=0
blocked=0

run_case() {
  local label=$1
  local test_file=$2
  shift 2
  printf '\nRunning %s without a graphical display\n' "$label"
  if env -u DISPLAY -u WAYLAND_DISPLAY -u GIO_USE_VFS dbus-run-session -- \
      env GSETTINGS_BACKEND=memory gjs -m "$test_file" "$@"; then
    printf 'PASS %s\n' "$label"
    passed=$((passed + 1))
  else
    local result=$?
    if [[ $result == 77 ]]; then
      printf 'BLOCKED %s (missing dependency)\n' "$label"
      blocked=$((blocked + 1))
    else
      printf 'FAIL %s (exit %s)\n' "$label" "$result"
      failed=$((failed + 1))
    fi
  fi
}

run_case capture tests/logic/clipboard/capture.test.js
run_case history-controller tests/logic/clipboard/history/controller.test.js
run_case input-guard tests/logic/clipboard/terminal/guard.test.js
run_case screenshot-pipeline tests/logic/screenshot/pipeline.test.js
run_case phrase-draft tests/logic/ui/phrase-draft.test.js
run_case dictionary-http tests/logic/clipboard/tokenizer/network.test.js
run_case dictionary-tls tests/logic/clipboard/tokenizer/network.test.js --tls

printf '\nHeadless acceptance: %s passed, %s failed, %s blocked\n' "$passed" "$failed" "$blocked"
((failed == 0)) || exit 1
((blocked == 0)) || exit 2
