#!/usr/bin/env bash
set -euo pipefail

extension_uuid='clipboard-x@guleoo.github.io'

if [[ "${CLIPBOARD_X_DEV_SESSION:-0}" == '1' ]]; then
  if [[ -z "${CLIPBOARD_X_DEV_ROOT:-}" || "${XDG_CONFIG_HOME:-}" != "$CLIPBOARD_X_DEV_ROOT/config" ]]; then
    printf '%s\n' '拒绝在未隔离的配置目录中启动 Devkit。' >&2
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

if [[ "${CLIPBOARD_X_DEV_JOURNAL:-0}" != '1' ]]; then
  if command -v systemd-cat >/dev/null 2>&1; then
    printf '%s\n' 'Clipboard X Devkit 日志写入系统 journal，不再在此终端实时输出。' \
      "查看：journalctl --user -b -f -t clipboard-x-devkit + _EXE=$(command -v gnome-shell)"
    exec env CLIPBOARD_X_DEV_JOURNAL=1 \
      systemd-cat --identifier=clipboard-x-devkit --priority=info --stderr-priority=warning \
      "$script_path"
  fi
  printf '%s\n' '未找到 systemd-cat；构建和会话输出仅显示在终端，不额外保存日志文件。' >&2
fi

if [[ ! -x /usr/lib/mutter-devkit ]]; then
  printf '%s\n' '缺少 /usr/lib/mutter-devkit，请先安装 mutter-devkit。' >&2
  exit 1
fi

if [[ -f "$build_dir/build.ninja" ]]; then
  meson setup --reconfigure "$build_dir" "$project_dir" -Dtarget=package
else
  meson setup "$build_dir" "$project_dir" -Dtarget=package
fi

meson compile -C "$build_dir"
meson install -C "$build_dir"

mkdir -p \
  "$dev_root/config" \
  "$dev_root/data" \
  "$dev_root/cache" \
  "$dev_root/state" \
  "$extension_parent"

if [[ -e "$extension_link" && ! -L "$extension_link" ]]; then
  printf '隔离扩展路径已存在且不是符号链接：%s\n' "$extension_link" >&2
  exit 1
fi

ln -sfn "$extension_build" "$extension_link"

printf 'Clipboard X Devkit 构建：%s\n' "$extension_build"
printf 'Clipboard X Devkit 配置：%s\n' "$dev_root"

exec env \
  CLIPBOARD_X_DEV_SESSION=1 \
  CLIPBOARD_X_DEV_ROOT="$dev_root" \
  XDG_CONFIG_HOME="$dev_root/config" \
  XDG_DATA_HOME="$dev_root/data" \
  XDG_CACHE_HOME="$dev_root/cache" \
  XDG_STATE_HOME="$dev_root/state" \
  dbus-run-session -- "$script_path"
