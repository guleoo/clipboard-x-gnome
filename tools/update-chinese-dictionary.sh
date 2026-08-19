#!/usr/bin/env bash
set -euo pipefail

source_url='https://raw.githubusercontent.com/fxsjy/jieba/v0.42.1/jieba/dict.txt'
target='src/clipboard/tokenizer/dictionaries/chinese-core.txt'
temporary_directory=$(mktemp -d)

cleanup() {
  rm -rf -- "$temporary_directory"
}
trap cleanup EXIT

curl --fail --location --silent --show-error "$source_url" --output "$temporary_directory/dict.txt"
rg --pcre2 '^\p{Han}{2,8} ' "$temporary_directory/dict.txt" \
  | awk '$2 >= 50 {print $1, $2}' > "$temporary_directory/chinese-core.txt"
install -m 0644 "$temporary_directory/chinese-core.txt" "$target"
sha256sum "$target"
wc -c -l "$target"
