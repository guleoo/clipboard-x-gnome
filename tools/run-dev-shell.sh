#!/usr/bin/env bash
set -euo pipefail

dev_verbose=0
for argument in "$@"; do
  case "$argument" in
    --verbose) dev_verbose=1 ;;
    --help|-h)
      printf '%s\n' 'Usage: tools/run-dev-shell.sh [--verbose]' \
        'Shows build summaries, plugin logs and system warnings/errors; --verbose shows all raw output.'
      exit 0
      ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; exit 2 ;;
  esac
done

extension_uuid='clipboard-x@guleoo.github.io'

if [[ "${CLIPBOARD_X_DEV_SESSION:-0}" == '1' ]]; then
  if [[ -z "${CLIPBOARD_X_DEV_ROOT:-}" || "${XDG_CONFIG_HOME:-}" != "$CLIPBOARD_X_DEV_ROOT/config" ]]; then
    printf '%s\n' 'Clipboard X Gnome [ERROR] Refusing to start Devkit without an isolated configuration directory.' >&2
    exit 1
  fi
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell enabled-extensions "[\"$extension_uuid\"]"
  exec gnome-shell --devkit
fi

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH='' cd -- "$script_dir/.." && pwd)
script_path="$project_dir/tools/run-dev-shell.sh"
build_dir=${CLIPBOARD_X_DEV_BUILD_DIR:-"$project_dir/build-devkit"}
runtime_dir=${XDG_RUNTIME_DIR:?XDG_RUNTIME_DIR is required}
dev_root=${CLIPBOARD_X_DEV_ROOT:-"$runtime_dir/clipboard-x-devkit"}
extension_parent="$dev_root/data/gnome-shell/extensions"
extension_link="$extension_parent/$extension_uuid"
extension_build="$build_dir/$extension_uuid"

format_output() {
  if awk -v verbose="$dev_verbose" -f "$script_dir/dev-output.awk"; then
    return 0
  else
    dev_formatter_status=$?
    printf '[WARN] Log filtering failed · exit %s; switching to raw output.\n' "$dev_formatter_status" >&2
    # This shell keeps the input pipe open while awk exits; cat drains the rest.
    cat || return
    return "$dev_formatter_status"
  fi
}

report_exit() {
  if [[ "$1" != '0' && "$1" != '130' && "$1" != '143' ]]; then
    printf '[ERROR] Development session exited · exit %s; see journal or --verbose for full output.\n' "$1" >&2
  fi
}

if [[ "${CLIPBOARD_X_DEV_JOURNAL:-0}" != '1' ]]; then
  if command -v systemd-cat >/dev/null 2>&1 && command -v tee >/dev/null 2>&1; then
    printf '%s\n' 'Clipboard X Gnome Devkit logs are displayed in the terminal and saved to the system journal.' \
      "View: journalctl --user -b -f -t clipboard-x-devkit + _EXE=$(command -v gnome-shell)"
    exec {dev_journal_fd}> >(systemd-cat --identifier=clipboard-x-devkit --priority=info)
    dev_journal_pid=$!
    trap 'exec {dev_journal_fd}>&-; kill "$dev_journal_pid" 2>/dev/null || true; wait "$dev_journal_pid" 2>/dev/null || true' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    # The worker sees a regular pipe, so GLib writes to stderr rather than directly
    # to journald. tee forwards that output once, while keeping the terminal live.
    if (
      exec {dev_journal_fd}>&-
      exec env CLIPBOARD_X_DEV_JOURNAL=1 "$script_path" "$@"
    ) 2>&1 | tee --output-error=warn-nopipe "/dev/fd/$dev_journal_fd" \
      | format_output; then
      dev_session_status=0
    else
      dev_pipeline_status=("${PIPESTATUS[@]}")
      dev_session_status=${dev_pipeline_status[0]}
      for status in "${dev_pipeline_status[@]:1}"; do
        if [[ "$dev_session_status" == '0' ]]; then
          dev_session_status=$status
        fi
      done
    fi
    exec {dev_journal_fd}>&-
    if ! wait "$dev_journal_pid"; then
      printf '%s\n' 'Journal forwarding failed; session output is still available in the terminal.' >&2
    fi
    trap - EXIT INT TERM
    report_exit "$dev_session_status"
    exit "$dev_session_status"
  fi
  printf '%s\n' 'systemd-cat or tee not found; build and session output is only displayed in the terminal. No log files are created.' >&2
  if env CLIPBOARD_X_DEV_JOURNAL=1 "$script_path" "$@" 2>&1 \
    | format_output; then
    exit 0
  else
    dev_pipeline_status=("${PIPESTATUS[@]}")
    if [[ "${dev_pipeline_status[0]}" != '0' ]]; then
      report_exit "${dev_pipeline_status[0]}"
      exit "${dev_pipeline_status[0]}"
    fi
    report_exit "${dev_pipeline_status[1]}"
    exit "${dev_pipeline_status[1]}"
  fi
fi

if [[ ! -x /usr/lib/mutter-devkit ]]; then
  printf '%s\n' 'Clipboard X Gnome [ERROR] /usr/lib/mutter-devkit not found; install mutter-devkit first.' >&2
  exit 1
fi

build_extension() {
  if [[ -f "$build_dir/build.ninja" ]]; then
    meson setup --reconfigure "$build_dir" "$project_dir" -Dtarget=package || return
  else
    meson setup "$build_dir" "$project_dir" -Dtarget=package || return
  fi
  meson compile -C "$build_dir" || return
  meson install -C "$build_dir" || return
}

printf '%s\n' 'Clipboard X Gnome [BUILD] Building and packaging extension'
if build_extension; then
  printf '%s\n' 'Clipboard X Gnome [BUILD] Build and packaging completed'
else
  dev_build_status=$?
  printf 'Clipboard X Gnome [ERROR] Build failed · exit %s; see journal or --verbose for full output.\n' "$dev_build_status" >&2
  exit "$dev_build_status"
fi

mkdir -p \
  "$dev_root/config" \
  "$dev_root/data" \
  "$dev_root/cache" \
  "$dev_root/state" \
  "$extension_parent"

if [[ -e "$extension_link" && ! -L "$extension_link" ]]; then
  printf 'Clipboard X Gnome [ERROR] Isolated extension path already exists and is not a symlink: %s\n' "$extension_link" >&2
  exit 1
fi

ln -sfn "$extension_build" "$extension_link"

printf 'Clipboard X Gnome Devkit build: %s\n' "$extension_build"
printf 'Clipboard X Gnome Devkit configuration: %s\n' "$dev_root"
printf '%s\n' 'Clipboard X Gnome [INFO] devkit Starting development session'

exec env \
  CLIPBOARD_X_DEV_SESSION=1 \
  CLIPBOARD_X_DEV_ROOT="$dev_root" \
  XDG_CONFIG_HOME="$dev_root/config" \
  XDG_DATA_HOME="$dev_root/data" \
  XDG_CACHE_HOME="$dev_root/cache" \
  XDG_STATE_HOME="$dev_root/state" \
  dbus-run-session -- "$script_path" "$@"
