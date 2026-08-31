#!/bin/sh

set -eu

repo_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
project_name="melvor-mp-test"
server_port="${MELVOR_TEST_SERVER_PORT:-3001}"
focused_args_file=""
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
	if [ -n "$focused_args_file" ]; then
		rm -f -- "$focused_args_file"
	fi

	if [ "$status" -ne 0 ]; then
		docker compose --project-name "$project_name" --profile test logs --no-color server >&2
	fi

	docker compose --project-name "$project_name" --profile test down --volumes --remove-orphans
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
	focused_args_file="$(mktemp "${TMPDIR:-/tmp}/melvor-test-args.XXXXXX")"
	for test_argument in "$@"; do
		normalized_argument="$(normalize_test_path "$test_argument")"
		case "$normalized_argument" in
			./tests/*)
				if [ ! -e "$repo_root/server/${normalized_argument#./}" ]; then
					printf 'Focused test path does not exist under server/: %s\n' "$test_argument" >&2
					rm -f -- "$focused_args_file"
					exit 2
				fi
				;;
		esac
		printf '%s\n' "$normalized_argument" >> "$focused_args_file"
	done
	set --
	while IFS= read -r normalized_argument; do
		set -- "$@" "$normalized_argument"
	done < "$focused_args_file"
fi

trap cleanup EXIT INT TERM

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
	docker compose --project-name "$project_name" --profile test run --rm --no-deps test \
		bun test --timeout 15000 "$@"
fi
