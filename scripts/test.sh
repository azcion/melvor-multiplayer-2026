#!/bin/sh

set -eu

repo_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
project_name="${MELVOR_TEST_PROJECT:-melvor-mp-test-$$}"
server_port="${MELVOR_TEST_SERVER_PORT:-0}"
server_args_file=""
node_args_file=""
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
export MELVOR_CHAT_MODERATOR_CLIENT_IDENTIFIERS=RESTART-CHAT-MODERATOR,RESTART-CHAT-MODERATOR-2,33333333-3333-4333-8333-333333333333
export MELVOR_POLL_CREATOR_CLIENT_IDENTIFIERS=11111111-1111-4111-8111-111111111111
export MELVOR_AZURE_TRANSLATOR_KEY_FILE=/app/config/disabled-for-tests.key

cleanup() {
	status=$?
	trap - EXIT INT TERM
	if [ -n "$server_args_file" ]; then
		rm -f -- "$server_args_file"
	fi
	if [ -n "$node_args_file" ]; then
		rm -f -- "$node_args_file"
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

append_node_test_path() {
	normalized_argument="$1"
	test_path="$repo_root/${normalized_argument#./}"
	if [ ! -e "$test_path" ]; then
		printf 'Focused Node test path does not exist: %s\n' "$normalized_argument" >&2
		rm -f -- "$server_args_file" "$node_args_file"
		exit 2
	fi
	if [ -d "$test_path" ]; then
		discovered_files="$(find "$test_path" -type f -name '*.test.mjs' -print | sort)"
		if [ -z "$discovered_files" ]; then
			printf 'Focused Node test directory contains no .test.mjs files: %s\n' "$normalized_argument" >&2
			rm -f -- "$server_args_file" "$node_args_file"
			exit 2
		fi
		printf '%s\n' "$discovered_files" >> "$node_args_file"
		discovered_count="$(printf '%s\n' "$discovered_files" | wc -l | tr -d ' ')"
		node_test_count=$((node_test_count + discovered_count))
		return
	fi
	printf '%s\n' "$normalized_argument" >> "$node_args_file"
	node_test_count=$((node_test_count + 1))
}

if [ "$#" -gt 0 ]; then
	server_args_file="$(mktemp "${TMPDIR:-/tmp}/melvor-server-test-args.XXXXXX")"
	node_args_file="$(mktemp "${TMPDIR:-/tmp}/melvor-node-test-args.XXXXXX")"
	server_test_count=0
	node_test_count=0
	for test_argument in "$@"; do
		normalized_argument="$(normalize_test_path "$test_argument")"
		case "$normalized_argument" in
			./tests/mod|./tests/mod/*|./tests/operations|./tests/operations/*)
				append_node_test_path "$normalized_argument"
				continue
				;;
			./tests/*)
				if [ ! -e "$repo_root/server/${normalized_argument#./}" ]; then
					printf 'Focused test path does not exist under server/: %s\n' "$test_argument" >&2
					rm -f -- "$server_args_file" "$node_args_file"
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
	if [ "$node_test_count" -gt 0 ] && [ "$server_test_count" -eq 0 ]; then
		set --
		while IFS= read -r normalized_argument; do
			set -- "$@" "$normalized_argument"
		done < "$node_args_file"
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
	if [ "$node_test_count" -gt 0 ]; then
		set --
		while IFS= read -r normalized_argument; do
			set -- "$@" "$normalized_argument"
		done < "$node_args_file"
		cd "$repo_root"
		node --test --test-timeout=15000 "$@"
	fi
fi
