#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C.UTF-8

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
diff -u \
  <(msgcat --no-location --no-wrap --properties-output "$project_dir/po/clipboard-x.pot" \
    | sed -n '/^![^=]/p' | sort) \
  <(cd "$project_dir" && xgettext --from-code=UTF-8 --keyword=_ --keyword=N_ \
    --keyword=C_:1c,2 --keyword=NC_:1c,2 --files-from=po/POTFILES.in --output=- \
    | msgcat --no-location --no-wrap --properties-output - | sed -n '/^![^=]/p' | sort)
catalogs=("$@")
if ((${#catalogs[@]} == 0)); then
  mapfile -t catalogs < "$project_dir/po/LINGUAS"
fi

for locale in "${catalogs[@]}"; do
  catalog="$project_dir/po/$locale.po"
  msgfmt --check --check-format -o /dev/null "$catalog"
  coverage=$(msgmerge --quiet --no-fuzzy-matching -o - \
    "$catalog" "$project_dir/po/clipboard-x.pot" \
    | msgfmt --statistics -o /dev/null - 2>&1)
  if [[ "$coverage" == *" untranslated "* || "$coverage" == *" fuzzy "* ]]; then
    printf '%s: %s\n' "$locale" "$coverage" >&2
    exit 1
  fi
done
