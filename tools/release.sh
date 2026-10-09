#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
build_dir="$project_root/build/release"
publish=false
remote=''

usage() {
  cat <<'EOF'
Usage: tools/release.sh [--publish [--remote NAME]]

Without options, build, test, and validate a local release ZIP. Nothing is
installed into the desktop, tagged, or pushed.

  --publish       After validation, push the current branch, create an annotated
                  version tag, and push the tag to trigger GitHub Actions.
                  Requires a clean working tree and Git remote access.
  --remote NAME   Git remote to use with --publish. By default, use the current
                  branch's remote or the only configured remote.
  -h, --help      Show this help.
EOF
}

fail() {
  printf 'Release failed: %s\n' "$1" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --publish)
      publish=true
      shift
      ;;
    --remote)
      (($# >= 2)) || fail '--remote needs a remote name'
      [[ -n "$2" ]] || fail '--remote needs a remote name'
      remote=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

if [[ -n "$remote" && "$publish" != true ]]; then
  fail '--remote requires --publish'
fi

cd "$project_root"
if [[ "$publish" == true ]]; then
  [[ -z "$(git status --porcelain --untracked-files=all)" ]] ||
    fail 'Commit or remove working-tree changes before publishing'
  branch=$(git symbolic-ref --quiet --short HEAD) ||
    fail 'Publishing requires a checked-out branch'

  if [[ -z "$remote" ]]; then
    remote=$(git config --get "branch.$branch.remote" || true)
    if [[ -z "$remote" || "$remote" == '.' ]]; then
      mapfile -t remotes < <(git remote)
      ((${#remotes[@]} == 1)) ||
        fail 'Select a Git remote with --remote NAME'
      remote=${remotes[0]}
    fi
  fi
  git remote get-url --push "$remote" >/dev/null ||
    fail "Git remote is unavailable: $remote"
fi

if [[ -f "$build_dir/meson-private/coredata.dat" ]]; then
  meson setup "$build_dir" --reconfigure -Dtarget=package
else
  meson setup "$build_dir" -Dtarget=package
fi
meson compile -C "$build_dir"
find src tests -name '*.js' -print0 | xargs -0 -r -n1 node --check
dbus-run-session -- meson test -C "$build_dir" --print-errorlogs
meson install -C "$build_dir"

version=$(meson introspect --projectinfo "$build_dir" |
  python3 -c 'import json, sys; print(json.load(sys.stdin)["version"])')
archive="$build_dir/clipboard-x-gnome_${version}.zip"
tag="v$version"
python3 tools/check_release.py "$archive" --tag "$tag"
printf 'Release ZIP: %s\n' "$archive"
sha256sum "$archive"

if [[ "$publish" != true ]]; then
  printf 'Local release is ready. No Git tag or remote was changed.\n'
  exit 0
fi

if ! remote_tag=$(git ls-remote --tags "$remote" "refs/tags/$tag"); then
  fail "Could not read tags from $remote"
fi
[[ -z "$remote_tag" ]] || fail "The remote already has tag $tag"

if git show-ref --verify --quiet "refs/tags/$tag"; then
  [[ "$(git cat-file -t "refs/tags/$tag")" == tag ]] ||
    fail "Existing local tag $tag is not annotated"
  [[ "$(git rev-parse "$tag^{commit}")" == "$(git rev-parse HEAD)" ]] ||
    fail "Existing local tag $tag points to a different commit"
fi

printf 'Publishing %s from %s to %s...\n' "$tag" "$branch" "$remote"
git push "$remote" "HEAD:refs/heads/$branch"
if ! git show-ref --verify --quiet "refs/tags/$tag"; then
  git tag -a "$tag" -m "Clipboard X Gnome $version"
fi
git push "$remote" "refs/tags/$tag:refs/tags/$tag"
printf 'Tag %s pushed. GitHub Actions will build the GitHub Release.\n' "$tag"
