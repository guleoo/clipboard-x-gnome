#!/usr/bin/env bash
set -euo pipefail

source_url='https://raw.githubusercontent.com/yanyiwu/cppjieba/master/dict/jieba.dict.utf8'
source_sha256='6f7d4350e8861ef4139b2e3a6fad05430c19ae71f4b8378190edecac8aae2e6a'
target='src/clipboard/tokenizer/dictionaries/chinese-core.txt'
temporary_directory=$(mktemp -d)

cleanup() {
  rm -rf -- "$temporary_directory"
}
trap cleanup EXIT

curl --fail --location --silent --show-error "$source_url" --output "$temporary_directory/dict.txt"
printf '%s  %s\n' "$source_sha256" "$temporary_directory/dict.txt" | sha256sum --check --status
rg --pcre2 '^\p{Han}{2,8} ' "$temporary_directory/dict.txt" \
  | awk '$2 >= 50 {print $1, $2}' > "$temporary_directory/chinese-core.txt"
install -m 0644 "$temporary_directory/chinese-core.txt" "$target"
sha256sum "$target"
wc -c -l "$target"
