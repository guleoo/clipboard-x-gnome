#!/usr/bin/env bash
set -euo pipefail

# Run from the checkout root, after the validated release ZIP has been downloaded.
if (($# != 3)); then
  printf 'Usage: tools/publish-release.sh TAG ARCHIVE REPOSITORY\n' >&2
  exit 1
fi
tag=$1
archive=$2
repository=$3
notes_file="docs/release/${tag}-en.md"
chinese_notes_file="docs/release/${tag}-cn.md"

for file in "$notes_file" "$chinese_notes_file"; do
  if [[ ! -f "$file" ]]; then
    printf 'Release notes are missing: %s\n' "$file" >&2
    exit 1
  fi
done

if gh release view "$tag" --repo "$repository" >/dev/null 2>&1; then
  if gh release view "$tag" --repo "$repository" \
      --json assets --jq '.assets[].name' | grep -Fxq "$archive"; then
    printf 'Release ZIP already exists; leaving the published asset untouched.\n'
  else
    gh release upload "$tag" "$archive" --repo "$repository"
  fi
else
  gh release create "$tag" "$archive" --repo "$repository" --verify-tag \
    --title "Clipboard X Gnome ${tag#v}" --notes-file "$notes_file"
fi
