#!/bin/sh

set -eu

repo_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
output_dir="$repo_root/dist"
output_file="$output_dir/melvor-multiplayer-local.zip"
stage_dir="$(mktemp -d)"
trap 'rm -rf -- "$stage_dir"' EXIT INT TERM
cp -R "$repo_root/mod/." "$stage_dir/"
node "$repo_root/scripts/asset-hosting.mjs" prepare "$stage_dir"

find "$stage_dir" -type f -name '*.mjs' -exec node --check {} \;

if find "$stage_dir" -type f -name '*.mjs' -exec grep -En "['\"]\\.\\.?/" {} + | grep -q .; then
	printf 'Relative module or resource specifier remains in mod JavaScript; use the mod context resource APIs.\n' >&2
	exit 1
fi

mkdir -p "$output_dir"
rm -f "$output_file"

(
	cd "$stage_dir"
	zip -q -r "$output_file" . \
		-x '*.DS_Store'
)
unzip -tq "$output_file"

printf 'Packaged local mod: %s\n' "$output_file"
