#!/usr/bin/env bash
set -euo pipefail

archive=$1
extension_dir=$2
schema_filename=$3
temporary_dir=$(mktemp -d)
temporary_archive="$temporary_dir/clipboard-x.zip"
staging_dir="$temporary_dir/extension"

cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

mkdir -p "$staging_dir/schemas"
cp "$extension_dir"/*.js "$staging_dir/"
cp "$extension_dir/metadata.json" "$extension_dir/stylesheet.css" "$staging_dir/"
cp "$extension_dir/schemas/gschemas.compiled" "$staging_dir/schemas/"
cp "$extension_dir/schemas/$schema_filename" "$staging_dir/schemas/"
if [[ -d "$extension_dir/locale" ]]; then
  cp -R "$extension_dir/locale" "$staging_dir/"
fi

(cd "$staging_dir" && 7z a -tzip "$temporary_archive" ./*)
mv -f "$temporary_archive" "$archive"
rm -rf -- "$temporary_dir"
trap - EXIT
