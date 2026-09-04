#!/bin/sh

set -eu

repo_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
project_name="melvor-mp-test"
server_port="${MELVOR_TEST_SERVER_PORT:-3001}"
server_args_file=""
mod_args_file=""
compose_owned=0
serial_icon_test_path="./tests/api/icon-catalog.test.ts"
serial_streaming_test_path="./tests/api/icon-catalog-streaming.test.ts"
serial_test_ignore_pattern="tests/api/icon-catalog*.test.ts"

export MELVOR_SERVER_PORT="$server_port"
export MELVOR_REQUEST_SOURCE_PER_MINUTE=10000
export MELVOR_REQUEST_SOURCE_BURST=10000
export MELVOR_REQUEST_IDENTITY_PER_MINUTE=10000
export MELVOR_REQUEST_IDENTITY_BURST=10000
export MELVOR_REGISTRATIONS_PER_SOURCE_HOUR=10000
export MELVOR_REGISTRATIONS_PER_SERVICE_HOUR=10000
export MELVOR_AUTH_RESPONSE_DELAY_MS=0
export MELVOR_SUPPORT_TEAM_CLIENT_IDENTIFIERS=RESTART-SUPPORT-CLIENT

cleanup() {
	status=$?
	trap - EXIT INT TERM
	if [ -n "$server_args_file" ]; then
		rm -f -- "$server_args_file"
	fi
	if [ -n "$mod_args_file" ]; then
		rm -f -- "$mod_args_file"
	fi

	if [ "$status" -ne 0 ] && [ "$compose_owned" -eq 1 ]; then
		docker compose --project-name "$project_name" --profile test logs --no-color server >&2
	fi

	if [ "$compose_owned" -eq 1 ]; then
		docker compose --project-name "$project_name" --profile test down --volumes --remove-orphans
	fi
	exit "$status"
}

normalize_test_path() {
	case "$1" in
		server/tests/*) printf './%s\n' "${1#server/}" ;;
		./server/tests/*) printf './%s\n' "${1#./server/}" ;;
		tests/*) printf './%s\n' "$1" ;;
		*) printf '%s\n' "$1" ;;
	esac
}

if [ "$#" -gt 0 ]; then
	server_args_file="$(mktemp "${TMPDIR:-/tmp}/melvor-server-test-args.XXXXXX")"
	mod_args_file="$(mktemp "${TMPDIR:-/tmp}/melvor-mod-test-args.XXXXXX")"
	server_test_count=0
	mod_test_count=0
	for test_argument in "$@"; do
		normalized_argument="$(normalize_test_path "$test_argument")"
		case "$normalized_argument" in
			./tests/mod/*)
				if [ ! -e "$repo_root/${normalized_argument#./}" ]; then
					printf 'Focused mod test path does not exist: %s\n' "$test_argument" >&2
					rm -f -- "$server_args_file" "$mod_args_file"
					exit 2
				fi
				printf '%s\n' "$normalized_argument" >> "$mod_args_file"
				mod_test_count=$((mod_test_count + 1))
				continue
				;;
			./tests/*)
				if [ ! -e "$repo_root/server/${normalized_argument#./}" ]; then
					printf 'Focused test path does not exist under server/: %s\n' "$test_argument" >&2
					rm -f -- "$server_args_file" "$mod_args_file"
					exit 2
				fi
				printf '%s\n' "$normalized_argument" >> "$server_args_file"
				server_test_count=$((server_test_count + 1))
				;;
			*)
				printf '%s\n' "$normalized_argument" >> "$server_args_file"
				server_test_count=$((server_test_count + 1))
				;;
		esac
	done
	set --
	while IFS= read -r normalized_argument; do
		set -- "$@" "$normalized_argument"
	done < "$server_args_file"
	if [ "$mod_test_count" -gt 0 ] && [ "$server_test_count" -eq 0 ]; then
		set --
		while IFS= read -r normalized_argument; do
			set -- "$@" "$normalized_argument"
		done < "$mod_args_file"
		trap cleanup EXIT INT TERM
		cd "$repo_root"
		node --test --test-timeout=15000 "$@"
		exit "$?"
	fi
fi

trap cleanup EXIT INT TERM
compose_owned=1

docker compose --project-name "$project_name" --profile test build server test
docker compose --project-name "$project_name" --profile test up --detach --wait server

if [ "$#" -eq 0 ]; then
	docker compose --project-name "$project_name" --profile test run --rm --no-deps test \
		bun test --timeout 15000 --path-ignore-patterns="$serial_test_ignore_pattern" tests
	docker compose --project-name "$project_name" --profile test run --rm --no-deps test \
		bun test --timeout 15000 --max-concurrency=1 "$serial_icon_test_path"
	docker compose --project-name "$project_name" --profile test run --rm --no-deps test \
		bun test --timeout 15000 --max-concurrency=1 "$serial_streaming_test_path"
	docker compose --project-name "$project_name" --profile test run --rm --no-deps test \
		bun test --timeout 15000 ./tests/storage/restart.setup.ts
	docker compose --project-name "$project_name" --profile test restart server
	docker compose --project-name "$project_name" --profile test up --detach --wait server
	docker compose --project-name "$project_name" --profile test run --rm --no-deps test \
		bun test --timeout 15000 ./tests/storage/restart.verify.ts
else
	if [ "$server_test_count" -gt 0 ]; then
		docker compose --project-name "$project_name" --profile test run --rm --no-deps test \
			bun test --timeout 15000 "$@"
	fi
	if [ "$mod_test_count" -gt 0 ]; then
		set --
		while IFS= read -r normalized_argument; do
			set -- "$@" "$normalized_argument"
		done < "$mod_args_file"
		cd "$repo_root"
		node --test --test-timeout=15000 "$@"
	fi
fi
