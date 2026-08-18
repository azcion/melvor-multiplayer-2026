#!/bin/sh

set -eu

repo_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
deploy_env="$repo_root/.env.deploy"
if [ -f "$deploy_env" ]; then
	set -a
	# shellcheck disable=SC1090
	. "$deploy_env"
	set +a
fi

version="${1:-${MELVOR_RELEASE_VERSION:-}}"
zip_suffix="${2:-}"
server_url="${MELVOR_PI_SERVER_URL:-}"
instance_prefix="instance:release:"
legacy_instance_prefix="instance:public-test:"
output_dir="$repo_root/dist"
stage_dir=""

usage() {
	cat <<'EOF'
Usage: ./scripts/package-release.sh VERSION [ZIP_SUFFIX]

Build the immutable release ZIP from the committed mod tree.
When ZIP_SUFFIX is provided, append it to the artifact filename without changing
the version embedded in release.json.

Environment:
  MELVOR_PI_SERVER_URL  Stable public HTTPS server origin
  MELVOR_RELEASE_VERSION Version instead of the positional argument
EOF
}

if [ "$#" -gt 2 ]; then
	usage >&2
	exit 2
fi

case "$version" in
	-h|--help)
		usage
		exit
		;;
	''|*[!0-9A-Za-z.-]*|.*|*.|*-|*..*)
		printf 'Unsafe or missing release version: %s\n' "$version" >&2
		exit 2
		;;
esac

case "$zip_suffix" in
	'' )
		;;
	*[!0-9A-Za-z.-]*|.*|*.|-*|*-|*..*)
		printf 'Unsafe ZIP suffix: %s\n' "$zip_suffix" >&2
		exit 2
		;;
esac

case "$server_url" in
	https://*)
		;;
	*)
		printf 'MELVOR_PI_SERVER_URL must be the stable public HTTPS origin.\n' >&2
		exit 2
		;;
esac

server_host="${server_url#https://}"
case "$server_host" in
	''|*[!a-zA-Z0-9.:-]*|*:|.*|*.)
		printf 'MELVOR_PI_SERVER_URL must be an origin without a path or trailing slash.\n' >&2
		exit 2
		;;
esac

cleanup() {
	status=$?
	trap - EXIT INT TERM
	if [ -n "$stage_dir" ] && [ -d "$stage_dir" ]; then
		rm -rf -- "$stage_dir"
	fi
	exit "$status"
}

trap cleanup EXIT INT TERM

cd "$repo_root"
if [ -n "$(git status --porcelain --untracked-files=all -- mod)" ]; then
	printf 'Refusing to package uncommitted or untracked mod content.\n' >&2
	exit 1
fi

source_commit="$(git rev-parse --verify HEAD)"
short_commit="$(git rev-parse --short=12 "$source_commit")"
if ! git cat-file -e "$source_commit:server/backend-version.txt" 2>/dev/null; then
	printf 'Backend deployment version is not committed. Commit server/backend-version.txt first.\n' >&2
	exit 1
fi
backend_version="$(tr -d '[:space:]' < "$repo_root/server/backend-version.txt")"
case "$backend_version" in
	''|*[!0-9]*)
		printf 'Invalid backend deployment version: %s\n' "$backend_version" >&2
		exit 2
		;;
esac
if [ "$backend_version" -lt 1 ]; then
	printf 'Backend deployment versions must be positive: %s\n' "$backend_version" >&2
	exit 2
fi
artifact_version="$version"
if [ -n "$zip_suffix" ]; then
	artifact_version="${artifact_version}-${zip_suffix}"
fi
output_file="$output_dir/melvor-multiplayer-remastered-${artifact_version}.zip"
stage_dir="$(mktemp -d)"

git archive --format=tar "$source_commit" mod | tar -xf - -C "$stage_dir" --strip-components=1

if [ "$(grep -c "^const SERVER_HOST = '" "$stage_dir/main.mjs")" -ne 1 ]; then
	printf 'Expected one SERVER_HOST declaration in committed mod/main.mjs.\n' >&2
	exit 1
fi

if [ "$(grep -c "^const SERVER_INSTANCE_STORAGE_PREFIX = '" "$stage_dir/main.mjs")" -ne 1 ]; then
	printf 'Expected one SERVER_INSTANCE_STORAGE_PREFIX declaration in committed mod/main.mjs.\n' >&2
	exit 1
fi

if [ "$(grep -c '^const SERVER_INSTANCE_STORAGE_LEGACY_PREFIXES = ' "$stage_dir/main.mjs")" -ne 1 ]; then
	printf 'Expected one SERVER_INSTANCE_STORAGE_LEGACY_PREFIXES declaration in committed mod/main.mjs.\n' >&2
	exit 1
fi
if [ "$(grep -c "^const MOD_VERSION = 'development';$" "$stage_dir/main.mjs")" -ne 1 ]; then
	printf 'Expected one development MOD_VERSION declaration in committed mod/main.mjs.\n' >&2
	exit 1
fi

sed \
	-e "s|^const SERVER_HOST = '.*';$|const SERVER_HOST = '${server_url}';|" \
	-e "s|^const SERVER_INSTANCE_STORAGE_PREFIX = '.*';$|const SERVER_INSTANCE_STORAGE_PREFIX = '${instance_prefix}';|" \
	-e "s|^const SERVER_INSTANCE_STORAGE_LEGACY_PREFIXES = .*$|const SERVER_INSTANCE_STORAGE_LEGACY_PREFIXES = ['${legacy_instance_prefix}'];|" \
	-e "s|^const MOD_VERSION = 'development';$|const MOD_VERSION = '${version}';|" \
	"$stage_dir/main.mjs" > "$stage_dir/main.mjs.next"
mv "$stage_dir/main.mjs.next" "$stage_dir/main.mjs"

cat > "$stage_dir/release.json" <<EOF
{
	"name": "Melvor Multiplayer",
	"version": "$version",
	"channel": "release",
	"source_commit": "$source_commit",
	"backend_version": $backend_version,
	"server_origin": "$server_url",
	"storage_namespace": "$instance_prefix",
	"legacy_storage_namespaces": ["$legacy_instance_prefix"]
}
EOF

find "$stage_dir" -type f -exec touch -r "$stage_dir/manifest.json" {} \;
find "$stage_dir" -type f -name '*.mjs' -exec node --check {} \;

if find "$stage_dir" -type f -name '*.mjs' -exec grep -En "['\"]\\.\\.?/" {} + | grep -q .; then
	printf 'Relative module or resource specifier remains in release JavaScript; use the mod context resource APIs.\n' >&2
	exit 1
fi

if ! grep -Fq "const SERVER_HOST = '${server_url}';" "$stage_dir/main.mjs"; then
	printf 'Release server substitution failed.\n' >&2
	exit 1
fi
if ! grep -Fq "const SERVER_INSTANCE_STORAGE_PREFIX = '${instance_prefix}';" "$stage_dir/main.mjs"; then
	printf 'Release storage namespace substitution failed.\n' >&2
	exit 1
fi
if ! grep -Fq "const SERVER_INSTANCE_STORAGE_LEGACY_PREFIXES = ['${legacy_instance_prefix}'];" "$stage_dir/main.mjs"; then
	printf 'Release legacy storage namespace substitution failed.\n' >&2
	exit 1
fi
if ! grep -Fq "const MOD_VERSION = '${version}';" "$stage_dir/main.mjs"; then
	printf 'Release mod version substitution failed.\n' >&2
	exit 1
fi
if grep -Eq "127\\.0\\.0\\.1|instance:(local-mac|pi-test):" "$stage_dir/main.mjs"; then
	printf 'Development endpoint or storage namespace remains in the release client.\n' >&2
	exit 1
fi
if find "$stage_dir" -type f \( -name '.DS_Store' -o -name '*.map' -o -name '*.tmp' \) | grep -q .; then
	printf 'Development-only files remain in the release tree.\n' >&2
	exit 1
fi

mkdir -p "$output_dir"
rm -f "$output_file"
(
	cd "$stage_dir"
	find . -type f -print |
		LC_ALL=C sort |
		zip -q -X "$output_file" -@
)

unzip -tq "$output_file"
archive_files="$(unzip -Z1 "$output_file")"
for required_file in manifest.json main.mjs modal-queue.mjs server-config.mjs release.json; do
	if ! printf '%s\n' "$archive_files" | grep -Fxq "$required_file"; then
		printf 'Release ZIP is missing %s.\n' "$required_file" >&2
		exit 1
	fi
done

checksum="$(shasum -a 256 "$output_file" | awk '{print $1}')"
printf 'Packaged release mod: %s\n' "$output_file"
printf 'Version: %s\n' "$version"
printf 'Source commit: %s (%s)\n' "$source_commit" "$short_commit"
printf 'Backend deployment version: %s\n' "$backend_version"
printf 'Storage namespace: %s\n' "$instance_prefix"
printf 'Legacy storage namespace: %s\n' "$legacy_instance_prefix"
printf 'SHA-256: %s\n' "$checksum"
