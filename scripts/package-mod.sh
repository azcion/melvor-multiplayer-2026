#!/bin/sh

set -eu

repo_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
output_dir="$repo_root/dist"
output_file="$output_dir/melvor-multiplayer-local.zip"

find "$repo_root/mod" -type f -name '*.mjs' -exec node --check {} \;

if find "$repo_root/mod" -type f -name '*.mjs' -exec grep -En "['\"]\\.\\.?/" {} + | grep -q .; then
	printf 'Relative module or resource specifier remains in mod JavaScript; use the mod context resource APIs.\n' >&2
	exit 1
fi

mkdir -p "$output_dir"
rm -f "$output_file"

(
	cd "$repo_root/mod"
	zip -q -r "$output_file" . \
		-x '*.DS_Store'
)

printf 'Packaged local mod: %s\n' "$output_file"
