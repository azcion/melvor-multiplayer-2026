#!/bin/sh

set -eu

project_name="melvor-mp-test"
server_port="${MELVOR_TEST_SERVER_PORT:-3001}"

export MELVOR_SERVER_PORT="$server_port"
export MELVOR_CORS_ALLOWED_ORIGINS="https://melvoridle.com,https://play.melvoridle.com,https://ios.melvoridle.com,https://android.melvoridle.com"
export MELVOR_REQUEST_SOURCE_PER_MINUTE=10000
export MELVOR_REQUEST_SOURCE_BURST=10000
export MELVOR_REQUEST_IDENTITY_PER_MINUTE=10000
export MELVOR_REQUEST_IDENTITY_BURST=10000
export MELVOR_REGISTRATIONS_PER_SOURCE_HOUR=10000
export MELVOR_REGISTRATIONS_PER_SERVICE_HOUR=10000
export MELVOR_AUTH_RESPONSE_DELAY_MS=0
export MELVOR_SUPPORT_TEAM_PLAYFAB_IDS=RESTART-SUPPORT-ID

cleanup() {
	status=$?
	trap - EXIT INT TERM

	if [ "$status" -ne 0 ]; then
		docker compose --project-name "$project_name" --profile test logs --no-color server >&2
	fi

	docker compose --project-name "$project_name" --profile test down --volumes --remove-orphans
	exit "$status"
}

trap cleanup EXIT INT TERM

docker compose --project-name "$project_name" --profile test build server test
docker compose --project-name "$project_name" --profile test up --detach --wait server

if [ "$#" -eq 0 ]; then
	docker compose --project-name "$project_name" --profile test run --rm --no-deps test
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
