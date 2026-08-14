#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "$0")/.." && pwd)
ready_file=$(mktemp)
client_file=$(mktemp)
stress_file=$(mktemp)
cache_dir=$(mktemp -d /tmp/clipboard-x-sync-cache.XXXXXX)
export XDG_CACHE_HOME="$cache_dir"

cleanup() {
  if [[ -n "${service_pid:-}" ]]; then
    kill "$service_pid" 2>/dev/null || true
    wait "$service_pid" 2>/dev/null || true
  fi
  if [[ -n "${client_pid:-}" ]]; then
    kill "$client_pid" 2>/dev/null || true
    wait "$client_pid" 2>/dev/null || true
  fi
  if [[ -n "${stress_pid:-}" ]]; then
    kill "$stress_pid" 2>/dev/null || true
    wait "$stress_pid" 2>/dev/null || true
  fi
  rm -f "$ready_file"
  rm -f "$client_file"
  rm -f "$stress_file"
  if [[ "$cache_dir" == /tmp/clipboard-x-sync-cache.* ]]; then
    rm -rf -- "$cache_dir"
  fi
}
trap cleanup EXIT

gjs -m "$project_dir/mock-service/mock-service.js" >"$ready_file" 2>&1 &
service_pid=$!

for _attempt in {1..100}; do
  if grep -q READY "$ready_file"; then
    gjs -m "$project_dir/tests/sync.integration.js"
    gjs -m "$project_dir/tests/sync-client.integration.js"
    gjs -m "$project_dir/tests/sync-large.integration.js"
    break
  fi
  if ! kill -0 "$service_pid" 2>/dev/null; then
    cat "$ready_file"
    exit 1
  fi
  sleep 0.05
done

if ! grep -q READY "$ready_file"; then
  cat "$ready_file"
  echo "Mock service did not become ready" >&2
  exit 1
fi

kill "$service_pid"
wait "$service_pid" 2>/dev/null || true
unset service_pid

gjs -m "$project_dir/tests/sync-reconnect.integration.js" >"$client_file" 2>&1 &
client_pid=$!
for _attempt in {1..100}; do
  grep -q OFFLINE_READY "$client_file" && break
  sleep 0.05
done
grep -q OFFLINE_READY "$client_file"

: >"$ready_file"
gjs -m "$project_dir/mock-service/mock-service.js" >"$ready_file" 2>&1 &
service_pid=$!
for _attempt in {1..100}; do
  grep -q READY "$ready_file" && break
  sleep 0.05
done
gdbus call --session \
  --dest io.github.guleo.ClipboardX.MockService \
  --object-path /io/github/guleo/ClipboardX/Sync \
  --method org.freedesktop.DBus.Properties.GetAll io.github.guleo.ClipboardX.Sync1 >/dev/null
for _attempt in {1..100}; do
  grep -q FIRST_ONLINE "$client_file" && break
  sleep 0.05
done
if ! grep -q FIRST_ONLINE "$client_file"; then
  cat "$client_file"
  cat "$ready_file"
  exit 1
fi

kill "$service_pid"
wait "$service_pid" 2>/dev/null || true
unset service_pid
for _attempt in {1..100}; do
  grep -q OFFLINE_AGAIN "$client_file" && break
  sleep 0.05
done
if ! grep -q OFFLINE_AGAIN "$client_file"; then
  cat "$client_file"
  exit 1
fi

: >"$ready_file"
gjs -m "$project_dir/mock-service/mock-service.js" >"$ready_file" 2>&1 &
service_pid=$!
for _attempt in {1..100}; do
  grep -q RECONNECTED "$client_file" && break
  sleep 0.05
done
if ! grep -q RECONNECTED "$client_file"; then
  cat "$client_file"
  cat "$ready_file"
  exit 1
fi
wait "$client_pid"
unset client_pid

gjs -m "$project_dir/tests/sync-reconnect-stress.integration.js" >"$stress_file" 2>&1 &
stress_pid=$!
for _attempt in {1..100}; do
  grep -q STRESS_ONLINE_1 "$stress_file" && break
  sleep 0.05
done
grep -q STRESS_ONLINE_1 "$stress_file"

for cycle in {1..5}; do
  kill "$service_pid"
  wait "$service_pid" 2>/dev/null || true
  unset service_pid
  for _attempt in {1..100}; do
    grep -q "STRESS_OFFLINE_${cycle}" "$stress_file" && break
    sleep 0.05
  done
  grep -q "STRESS_OFFLINE_${cycle}" "$stress_file"

  : >"$ready_file"
  gjs -m "$project_dir/mock-service/mock-service.js" >"$ready_file" 2>&1 &
  service_pid=$!
  next_online=$((cycle + 1))
  for _attempt in {1..100}; do
    grep -q "STRESS_ONLINE_${next_online}" "$stress_file" && break
    sleep 0.05
  done
  if ! grep -q "STRESS_ONLINE_${next_online}" "$stress_file"; then
    cat "$stress_file"
    cat "$ready_file"
    exit 1
  fi
done
wait "$stress_pid"
unset stress_pid

kill "$service_pid"
wait "$service_pid" 2>/dev/null || true
unset service_pid

: >"$ready_file"
python3 "$project_dir/mock-service/mock-service.py" >"$ready_file" 2>&1 &
service_pid=$!
for _attempt in {1..100}; do
  grep -q READY "$ready_file" && break
  if ! kill -0 "$service_pid" 2>/dev/null; then
    cat "$ready_file"
    exit 1
  fi
  sleep 0.05
done
if ! grep -q READY "$ready_file"; then
  cat "$ready_file"
  echo "Python Mock service did not become ready" >&2
  exit 1
fi
gjs -m "$project_dir/tests/sync.integration.js"
CLIPBOARD_X_EXPECTED_IMPLEMENTATION='Clipboard X Python Mock Service' \
  gjs -m "$project_dir/tests/sync-client.integration.js"

kill "$service_pid"
wait "$service_pid" 2>/dev/null || true
unset service_pid

: >"$ready_file"
CLIPBOARD_X_MOCK_MAX_ITEM_BYTES=16 \
CLIPBOARD_X_MOCK_MAX_PREVIEW_BYTES=8 \
CLIPBOARD_X_MOCK_MIME_TYPES='text/plain;charset=utf-8' \
  gjs -m "$project_dir/mock-service/mock-service.js" >"$ready_file" 2>&1 &
service_pid=$!
for _attempt in {1..100}; do
  grep -q READY "$ready_file" && break
  sleep 0.05
done
if ! grep -q READY "$ready_file"; then
  cat "$ready_file"
  exit 1
fi
gjs -m "$project_dir/tests/sync-policy.integration.js"

kill "$service_pid"
wait "$service_pid" 2>/dev/null || true
unset service_pid

: >"$ready_file"
CLIPBOARD_X_MOCK_TRANSFER_SEQUENCE='expired,ready' \
  gjs -m "$project_dir/mock-service/mock-service.js" >"$ready_file" 2>&1 &
service_pid=$!
for _attempt in {1..100}; do
  grep -q READY "$ready_file" && break
  sleep 0.05
done
if ! grep -q READY "$ready_file"; then
  cat "$ready_file"
  exit 1
fi
gjs -m "$project_dir/tests/sync-retry.integration.js"

kill "$service_pid"
wait "$service_pid" 2>/dev/null || true
unset service_pid

: >"$ready_file"
CLIPBOARD_X_MOCK_TRANSFER_DELAY_MS=5000 \
  gjs -m "$project_dir/mock-service/mock-service.js" >"$ready_file" 2>&1 &
service_pid=$!
for _attempt in {1..100}; do
  grep -q READY "$ready_file" && break
  sleep 0.05
done
if ! grep -q READY "$ready_file"; then
  cat "$ready_file"
  exit 1
fi

: >"$client_file"
gjs -m "$project_dir/tests/sync-offline-transfer.integration.js" >"$client_file" 2>&1 &
client_pid=$!
for _attempt in {1..100}; do
  grep -q TRANSFER_STARTED "$client_file" && break
  sleep 0.05
done
if ! grep -q TRANSFER_STARTED "$client_file"; then
  cat "$client_file"
  exit 1
fi
kill "$service_pid"
wait "$service_pid" 2>/dev/null || true
unset service_pid
wait "$client_pid"
unset client_pid
grep -q TRANSFER_OFFLINE "$client_file"

: >"$ready_file"
CLIPBOARD_X_MOCK_MALFORMED=1 \
  gjs -m "$project_dir/mock-service/mock-service.js" >"$ready_file" 2>&1 &
service_pid=$!
for _attempt in {1..100}; do
  grep -q READY "$ready_file" && break
  sleep 0.05
done
if ! grep -q READY "$ready_file"; then
  cat "$ready_file"
  exit 1
fi
gjs -m "$project_dir/tests/sync-malformed.integration.js"
