#!/bin/sh

set -eu

project_name="melvor-mp-smoke"
server_port="${MELVOR_SERVER_PORT:-3000}"
base_url="http://127.0.0.1:${server_port}"
client_key="00000000-0000-4000-8000-000000000001"

export MELVOR_SERVER_PORT="$server_port"

cleanup() {
	status=$?
	trap - EXIT INT TERM

	if [ "$status" -ne 0 ]; then
		docker compose --project-name "$project_name" logs --no-color server >&2
	fi

	docker compose --project-name "$project_name" down --volumes --remove-orphans
	exit "$status"
}

trap cleanup EXIT INT TERM

docker compose --project-name "$project_name" up --build --detach --wait

preflight_headers="$(
	curl \
		--silent \
		--show-error \
		--dump-header - \
		--output /dev/null \
		--request OPTIONS \
		--header "Origin: https://melvoridle.com" \
		--header "Access-Control-Request-Method: POST" \
		--header "Access-Control-Request-Headers: content-type,x-session-token" \
		"${base_url}/api/register"
)"

case "$preflight_headers" in
	*'204 No Content'*'Access-Control-Allow-Origin: https://melvoridle.com'*)
		;;
	*)
		printf 'Unexpected browser preflight response:\n%s\n' "$preflight_headers" >&2
		exit 1
		;;
esac

register_response="$(
	curl \
		--fail-with-body \
		--silent \
		--show-error \
		--header "Origin: https://melvoridle.com" \
		--header "Content-Type: application/json" \
		--data "{\"client_key\":\"${client_key}\",\"display_name\":\"Smoke Test\"}" \
		"${base_url}/api/register"
)"

session_token="$(
	printf '%s' "$register_response" |
		sed -n 's/.*"session_token":"\([^"]*\)".*/\1/p'
)"

if [ -z "$session_token" ]; then
	printf 'Registration response did not contain a session token: %s\n' "$register_response" >&2
	exit 1
fi

events_response="$(
	curl \
		--fail-with-body \
		--silent \
		--show-error \
		--header "X-Session-Token: ${session_token}" \
		"${base_url}/api/events"
)"

case "$events_response" in
	*'"friend_requests"'*'"campaign"'*)
		printf 'Smoke test passed: registration and authenticated events request succeeded.\n'
		;;
	*)
		printf 'Unexpected events response: %s\n' "$events_response" >&2
		exit 1
		;;
esac
