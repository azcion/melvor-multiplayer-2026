#!/bin/sh

set -eu

repo_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
output_dir="$repo_root/dist"
usage() {
	cat <<'EOF'
Usage: ./scripts/package-mod.sh VERSION [ZIP_SUFFIX]

Package the working-tree client for local Creator Toolkit testing.
VERSION must be a numeric x.y.z version matching the source being tested.
ZIP_SUFFIX changes only the filename, not the version reported to the API.
No server endpoint or storage namespace is changed.
EOF
}

if [ "$#" -eq 1 ] && { [ "$1" = "--help" ] || [ "$1" = "-h" ]; }; then
	usage
	exit 0
fi
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
	usage >&2
	exit 2
fi
version="$1"
zip_suffix="${2:-}"
if ! node --input-type=module -e '
const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(process.argv[1]);
process.exit(match && match.slice(1).every(part => Number.isSafeInteger(Number(part))) ? 0 : 1);
' "$version"; then
	printf 'VERSION must be a numeric x.y.z version with safe integer components.\n' >&2
	exit 2
fi
case "$zip_suffix" in
	'' ) ;;
	*[!0-9A-Za-z.-]*|.*|*.|-*|*-|*..*)
		printf 'Unsafe ZIP suffix: %s\n' "$zip_suffix" >&2
		exit 2
		;;
esac
output_file="$output_dir/melvor-multiplayer-local-${version}${zip_suffix:+-${zip_suffix}}.zip"
stage_dir="$(mktemp -d)"
trap 'rm -rf -- "$stage_dir"' EXIT INT TERM
cp -R "$repo_root/mod/." "$stage_dir/"
if [ "$(grep -c "^const MOD_VERSION = 'development';$" "$stage_dir/main.mjs")" -ne 1 ]; then
	printf 'Expected one development MOD_VERSION declaration in mod/main.mjs.\n' >&2
	exit 1
fi
sed "s|^const MOD_VERSION = 'development';$|const MOD_VERSION = '${version}';|" \
	"$stage_dir/main.mjs" > "$stage_dir/main.mjs.next"
mv "$stage_dir/main.mjs.next" "$stage_dir/main.mjs"
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
