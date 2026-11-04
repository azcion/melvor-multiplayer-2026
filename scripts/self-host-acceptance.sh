#!/bin/sh
# Disposable clean-install acceptance for the backend image and independent wiki server.
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"
project="melvor-selfhost-$$"
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/melvor-selfhost.XXXXXXXX")
cleanup() {
    status=$?
    trap - EXIT INT TERM
    if [ "$status" -ne 0 ]; then
        docker compose -p "$project" logs --no-color server >&2 || :
        docker compose -p "${project}-wiki" -f wiki/compose.yaml logs --no-color wiki >&2 || :
    fi
    docker rm -f "$project-proxy" >/dev/null 2>&1 || :
    docker compose -p "$project" down --volumes --remove-orphans --rmi local || :
    docker compose -p "${project}-wiki" -f wiki/compose.yaml down --volumes --remove-orphans || :
    rm -rf -- "$tmp_dir"
    exit "$status"
}
trap cleanup EXIT INT TERM
export MELVOR_SERVER_PORT=0 MELVOR_CHAT_PUBLIC_ORIGIN=http://127.0.0.1:43123
export MELVOR_AUTH_RESPONSE_DELAY_MS=0 MELVOR_BACKUP_DIR="$tmp_dir/backups" MELVOR_LOG_DIR="$tmp_dir/logs"
export WIKI_PORT=0 WIKI_SITE_ROOT="$tmp_dir/site"
mkdir -p "$tmp_dir/backups" "$tmp_dir/logs" "$tmp_dir/site/releases/current"
node wiki/scripts/build.mjs
cp -R wiki/dist/wiki "$tmp_dir/site/releases/current/"
ln -s releases/current "$tmp_dir/site/current"
docker compose -p "$project" up --build --detach --wait server
docker compose -p "${project}-wiki" -f wiki/compose.yaml up --detach --wait wiki
backend=$(docker compose -p "$project" port server 3000)
wiki=$(docker compose -p "${project}-wiki" -f wiki/compose.yaml port wiki 8080)
case "$backend:$wiki" in 127.0.0.1:*:127.0.0.1:*) ;; *) printf 'Unexpected published addresses.\n' >&2; exit 1;; esac
# Use the published example verbatim, changing only TLS/listen and upstreams for this disposable network.
node - "$tmp_dir/proxy.conf" <<'NODE'
const fs = require('node:fs');
const docs = fs.readFileSync('docs/self-hosting.md', 'utf8').split('### Example: Nginx on the Docker host')[1].split('### Optional player wiki')[0];
const blocks = [...docs.matchAll(/```nginx\n([\s\S]*?)```/g)].map(match => match[1]);
if (blocks.length !== 2) throw new Error('Nginx example blocks not found');
let config = blocks[0].replace('listen 443 ssl;', 'listen 8080;').replace(/^    ssl_certificate.*\n/gm, '')
    .replace('http://127.0.0.1:3000', 'http://server:3000')
    .replace('    location / {', blocks[1].replace(/^/gm, '    ') + '\n    location / {')
    .replaceAll('http://127.0.0.1:3080', 'http://wiki:8080');
fs.writeFileSync(process.argv[2], config);
NODE
proxy_image=$(docker compose -p "${project}-wiki" -f wiki/compose.yaml config --images | head -n 1)
docker create --name "$project-proxy" --network "${project}_default" -p 127.0.0.1::8080 -v "$tmp_dir/proxy.conf:/etc/nginx/conf.d/default.conf:ro" "$proxy_image" >/dev/null
docker network connect "${project}-wiki_default" "$project-proxy"
docker start "$project-proxy" >/dev/null
proxy=$(docker port "$project-proxy" 8080/tcp)
case "$proxy" in 127.0.0.1:*) ;; *) printf 'Unexpected proxy address.\n' >&2; exit 1;; esac
node tests/operations/self-host-acceptance.mjs "http://$backend" "http://$wiki" "$MELVOR_CHAT_PUBLIC_ORIGIN" "http://$proxy"
