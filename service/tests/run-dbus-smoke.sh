#!/usr/bin/env bash
set -euo pipefail

service_dir=$(cd "$(dirname "$0")/.." && pwd)
temporary_dir=$(mktemp -d /tmp/clipboard-x-service-test.XXXXXX)
log_file="$temporary_dir/service.log"
export XDG_DATA_HOME="$temporary_dir/data"
export PYTHONPATH="$service_dir/src"
mkdir -p "$XDG_DATA_HOME/clipboard-x"
printf '%s\n' \
  '{"version":1,"serverAddress":"127.0.0.1:8765","apiKey":"test-secret","activeChannelId":""}' \
  >"$XDG_DATA_HOME/clipboard-x/sync.json"

cleanup() {
  if [[ -n "${service_pid:-}" ]]; then
    kill "$service_pid" 2>/dev/null || true
    wait "$service_pid" 2>/dev/null || true
  fi
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

python3 -m clipboard_x_service >"$log_file" 2>&1 &
service_pid=$!

for _attempt in {1..100}; do
  if gdbus call --session \
      --dest io.github.guleo.ClipboardX.SyncService \
      --object-path /io/github/guleo/ClipboardX/Sync \
      --method org.freedesktop.DBus.Properties.Get \
      io.github.guleo.ClipboardX.Sync1 ApiVersion >"$temporary_dir/property" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$service_pid" 2>/dev/null; then
    cat "$log_file"
    exit 1
  fi
  sleep 0.05
done

grep -q 'uint32 1' "$temporary_dir/property"
python3 "$service_dir/tests/dbus_client.py"

for _attempt in {1..100}; do
  if ! kill -0 "$service_pid" 2>/dev/null; then
    wait "$service_pid"
    unset service_pid
    break
  fi
  sleep 0.05
done

if [[ -n "${service_pid:-}" ]]; then
  echo 'Service did not exit after its final client session closed' >&2
  exit 1
fi

python3 -m clipboard_x_service >"$log_file" 2>&1 &
service_pid=$!
for _attempt in {1..100}; do
  if gdbus call --session \
      --dest io.github.guleo.ClipboardX.SyncService \
      --object-path /io/github/guleo/ClipboardX/Sync \
      --method org.freedesktop.DBus.Properties.Get \
      io.github.guleo.ClipboardX.Sync1 ApiVersion >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$service_pid" 2>/dev/null; then
    cat "$log_file"
    exit 1
  fi
  sleep 0.05
done
python3 "$service_dir/tests/lease_expiry_client.py"
wait "$service_pid"
unset service_pid
