#!/bin/sh

set -eu

if [ "$#" -eq 0 ] && [ -t 0 ]; then
	printf 'Usage: %s LOG_FILE...\n' "$0" >&2
	exit 2
fi

summary_file="$(mktemp "${TMPDIR:-/tmp}/melvor-api-traffic.XXXXXX")"
trap 'rm -f -- "$summary_file"' EXIT INT TERM

awk '
	/type=http/ {
		method = path = status = duration = ""
		for (column = 1; column <= NF; column++) {
			split($column, field, "=")
			if (field[1] == "method") method = field[2]
			else if (field[1] == "path") path = field[2]
			else if (field[1] == "status") status = field[2]
			else if (field[1] == "duration_ms") duration = field[2]
		}
		if (path !~ /^\/api\// || method == "" || status == "" || duration !~ /^[0-9]+$/)
			next
		key = method "\t" path "\t" status
		count[key]++
		total[key] += duration
	}
	END {
		for (key in count)
			printf "%d\t%s\t%.2f\n", count[key], key, total[key] / count[key]
	}
' "$@" > "$summary_file"

printf 'requests\tmethod\tpath\tstatus\taverage_ms\n'
sort -t "$(printf '\t')" -k1,1nr -k3,3 "$summary_file"
