# Self-hosting from the public source

The backend and the mod are separate. Start the backend from this repository and point the published mod at it
first. Build a local mod only if you want to test or change the client source.

## Start a fresh backend

Install Docker with Docker Compose and start the Docker daemon. No host Bun installation or external database is
needed. Obtain the public source, for example with Git:

```sh
git clone https://github.com/azcion/melvor-multiplayer-2026.git
cd melvor-multiplayer-2026
```

For a reproducible release test, check out the desired release tag before building.
Run all Compose commands below from the repository root.

Use a dedicated Compose project name so an existing development database is not reused:

```sh
docker compose --project-name melvor-selfhost up --build --detach --wait server
curl --fail --show-error http://127.0.0.1:3000/health
curl --fail --show-error http://127.0.0.1:3000/api/versions
```

The health response contains `"status":"ok"` and the backend deployment version. API discovery reports the supported
API versions and any minimum mod version. A fresh database has no player identities, and registration is available
without configuring an administrator. Optional translation credentials are not required.

The server binds to `127.0.0.1:3000` on the Docker host. If that port is occupied, set `MELVOR_SERVER_PORT=3001` in
a local `.env` file before starting, and use that port in every URL below. `.env.example` lists optional settings;
the defaults work for the API local test. To use Browser Chat locally, also set
`MELVOR_CHAT_PUBLIC_ORIGIN=http://127.0.0.1:3000` (adjust the host and port to the exact browser origin), then
recreate the server. Keep the same project name for subsequent commands.

The `melvor-selfhost_database-data` named volume holds SQLite state. An unused project name creates a new volume;
repeating the start command with the same name preserves the existing database. To stop while keeping data:

```sh
docker compose --project-name melvor-selfhost down
```

To deliberately erase this test instance's database, stop it with the following command. This removes the project's
named volumes permanently; it does not clear multiplayer identities stored in Melvor saves or browser storage.

```sh
docker compose --project-name melvor-selfhost down --volumes
```

For a second blank-slate scenario, use a different unused project name after stopping the first server. This avoids
reusing its database without deleting it.

## Connect the published mod on the same machine

1. Enable the published Melvor Multiplayer Remastered mod. Disable the original Multiplayer mod and any local
   Creator Toolkit copy, then reload Melvor.
2. Use a test character and back up its save before testing.
3. Open **Mod Settings → Melvor Multiplayer → Connection** and set the custom server to
   `http://127.0.0.1:3000` (or your configured port).
4. Fully reload Melvor so the new origin takes effect. If the browser asks whether `melvoridle.com` may access
   other apps and services on this device, choose **Allow**. Remember the choice if you want it to persist.
   After granting permission, fully reload Melvor again; the initial connection attempt may already have stopped.
5. Register/connect, create or join a Guild, and check that its pages load. Save and fully reload again; confirm the
   same identity and Guild return and that polling stays connected.

The setting accepts HTTP only for the exact loopback hosts `127.0.0.1`, `localhost`, and `[::1]`. Use one spelling
consistently: `http://localhost:3000` and `http://127.0.0.1:3000` are different server origins and receive separate
client identities. The port is also part of the origin.

The published mod's empty custom-server setting restores its bundled service. It does not select your local Docker
server. Each normalized custom origin has its own multiplayer identity and server-coupled storage; switching servers
does not move Guilds or other backend data between them.

## Use a hostname or another device

Loopback refers to the device running Melvor. A phone's `127.0.0.1` does not reach the Docker server on your computer.
A LAN IP address, `.local` hostname, or fully qualified domain name requires HTTPS in the custom-server setting.

Before using an origin such as `https://multiplayer.example.com`, provide:

- DNS or a local hosts entry resolving that hostname on each game device.
- An HTTPS reverse proxy with a certificate trusted by each game browser or app. Compose serves HTTP and does not
  provision DNS, certificates, or an HTTPS proxy.
- Proxy routing for `/health`, `/api/`, `/chat` and `/chat/`, and `/mod/` to the backend, preserving paths, query
  strings, request bodies, `Origin`, cookies, and the mod's request/response headers. Forward `OPTIONS` requests to
  the backend; it supplies CORS headers. Browser Chat imports shared modules from `/mod/`.
- Network access to the proxy from the game device. The default backend port is loopback-only. A proxy running on
  the Docker host can reach `127.0.0.1:3000`; a proxy container on the same Compose network uses `server:3000`.

Check `https://multiplayer.example.com/health` and `/api/versions` in the actual game browser without a certificate
warning before connecting. Set only the origin in Mod Settings, without `/api`, a path, credentials, query, or fragment.
Keep `MELVOR_TRUST_PROXY=0` for an ordinary reverse proxy; this option specifically trusts Cloudflare's
`CF-Connecting-IP` header and is not a general HTTPS switch.

With this default, the backend puts **all source-limited requests into one shared bucket**, even for direct connections.
By default that allows a combined burst of 30 requests and refills at 120 per minute; registrations share a bucket
with a capacity of 4 that refills at 4 per hour. Multiple players can therefore receive HTTP 429 responses. Authenticated
identity limits and the service-wide registration limit also apply. The source and registration limits can be tuned
in `.env` using the settings listed in `.env.example`, but raising them reduces the protection they provide. The backend
ignores `X-Forwarded-For`, so the Nginx example does not provide per-client source limits.

For supported per-client source limits, route public traffic exclusively through a Cloudflare Tunnel to the
loopback-bound backend and set `MELVOR_TRUST_PROXY=1` in `.env`. Ensure that Cloudflare supplies the correct
`CF-Connecting-IP` for every request and that clients cannot reach the backend through another route, including a
directly exposed port or an ordinary proxy. Protect access from untrusted processes or containers on the host as
well: the backend does not authenticate the sender of that header, so any route that can bypass Cloudflare can
spoof client addresses and evade source limits. Missing or invalid addresses share an `unknown` bucket. Recreate
the server after changing the setting. Leave trust disabled if you cannot enforce this boundary; an ordinary proxy
alone is not a supported per-client source configuration.

Set the browser-facing origin in `.env` before starting the server:

```dotenv
MELVOR_CHAT_PUBLIC_ORIGIN=https://multiplayer.example.com
```

After changing `.env`, recreate the server:

```sh
docker compose --project-name melvor-selfhost up --build --detach --wait server
```

The value must be the exact origin used to open Browser Chat: HTTPS except for HTTP on `localhost`, `127.0.0.1`,
or `[::1]`. Include a non-default port when used, but no trailing slash, path, credentials, query, or fragment. Compose passes it to the backend as
`CHAT_PUBLIC_ORIGIN`. Its default points at the official service, so set it for your own deployment. Open `/chat`
on that origin and pair it from the game. A different host spelling or port fails the origin check.

### Example: Nginx on the Docker host

This HTTPS server block forwards all backend paths without rewriting them. Install a trusted certificate and replace
the example hostname and certificate paths. This example assumes Nginx runs directly on the Docker host, with the
backend on loopback port 3000. Add it to your Nginx configuration, test with `nginx -t`, then reload Nginx.

```nginx
server {
    listen 443 ssl;
    server_name multiplayer.example.com;
    ssl_certificate /etc/ssl/example/fullchain.pem;
    ssl_certificate_key /etc/ssl/example/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

For an optional wiki on port 3080, insert these two locations in the same `server` block. Nginx selects them ahead
of the backend catch-all and preserves `/wiki` in the request URI:

```nginx
location = /wiki { proxy_pass http://127.0.0.1:3080; }
location ^~ /wiki/ { proxy_pass http://127.0.0.1:3080; }
```

The example does not enable the optional Online Combat service; that service needs its own WebSocket routing.
Verify `/health`, `/api/versions`, `/chat`, `/chat/assets/chat.mjs`, and `/mod/chat-items.mjs` through HTTPS,
and, if enabled, `/wiki/`. Pair Browser Chat and check the game connection from the actual client as well.

### Optional player wiki

The default wiki link points to the official handbook. To host a copy, build the static site with Node.js 22.18+
and run its separate Nginx container from the repository root:

```sh
node wiki/scripts/build.mjs
mkdir -p wiki/site/releases/initial
cp -R wiki/dist/. wiki/site/releases/initial/
ln -s releases/initial wiki/site/current
docker compose -f wiki/compose.yaml -p melvor-wiki up -d --wait
node wiki/scripts/check-host.mjs http://127.0.0.1:3080
```

Route `/wiki` and `/wiki/` to that service as above. Set `MELVOR_WIKI_URL=https://multiplayer.example.com/wiki/`
in `.env`, then recreate the backend so clients discover your wiki link through `/api/versions`. An empty, unset, or
invalid URL falls back to the official wiki; use HTTP or HTTPS without credentials. Older clients or servers that do
not advertise a valid URL also use the official link.

To update the wiki, rebuild, copy `wiki/dist/` into a **new** release directory, and atomically switch the `current`
symlink to that directory; retain the previous directory for rollback. The wiki server need not restart for content
updates. See [wiki hosting](../wiki/README.md#independent-hosting) for the layout, checks, and update details. The
wiki is independently hosted and updating it does not update the backend or the mod.

For a disposable local acceptance check, run `./scripts/self-host-acceptance.sh`. It builds the backend and wiki,
starts isolated Docker services, checks Browser Chat pairing and the example proxy routes, then removes its test
containers and database. It requires Docker and Node.js 22.18 or later; it does not test HTTPS certificates or
replace pairing from an actual game client.

## Test a source-built mod

Mod builds include all artwork by default. For optional external image hosting and smaller ZIPs, see
[asset hosting](asset-hosting.md). The selected multiplayer API server and the image host are independent settings.

Do this after the published-mod scenario works. Stop its backend without removing its volume, then start another
fresh backend on the same port:

```sh
docker compose --project-name melvor-selfhost down
docker compose --project-name melvor-selfhost-toolkit up --build --detach --wait server
```

To keep the first backend running during this test, start the second on an unused port instead:

```sh
MELVOR_SERVER_PORT=3002 docker compose --project-name melvor-selfhost-toolkit up --build --detach --wait server
```

In that case, set the local mod's custom server to `http://127.0.0.1:3002` and reload. Its bundled default still
uses port 3000. The different origin also keeps the second test's client identity separate from the first.

Install Node.js and the `zip` command on the build host. Package the checked-in client and validate the archive
with `unzip`:

```sh
./scripts/package-mod.sh 1.7.0 A
unzip -tq dist/melvor-multiplayer-local-1.7.0-A.zip
unzip -p dist/melvor-multiplayer-local-1.7.0-A.zip main.mjs | head -n 5
```

The archive must have `manifest.json` and `main.mjs` at its root. The checked-in client defaults to
`http://127.0.0.1:3000`. Pass the numeric `x.y.z` version matching your source checkout (for example, `1.7.0`
for 1.7.0 source); the packager replaces `development` only in the staged copy. The backend rejects
`development` and versions below its supported minimum. A version override does not make older source compatible.
The optional suffix (`A` above) distinguishes rebuilds in the filename without changing the API version.
The script packages working-tree changes, including uncommitted edits, and leaves source files unchanged.
A ZIP made this way does not inherit
the published release's bundled endpoint. The Connection setting can override its endpoint in the same way.

1. Import `dist/melvor-multiplayer-local-1.7.0-A.zip` using Creator Toolkit and enable it in a dedicated mod profile.
2. Disable the published remaster and the original Multiplayer mod in that profile so only this local client runs.
3. Fully reload Melvor and open a separate test character. Verify the Connection setting uses the intended origin.
4. Repeat registration, Guild-page, save/reload, and ongoing-connection checks against the fresh backend.

When rebuilding, give the ZIP a distinct filename and replace the imported local mod using Creator Toolkit's upload
control, then fully reload. If old behavior remains, delete the old local entry and import the new ZIP again.
Creator Toolkit copies the imported ZIP; overwriting the file on disk alone does not update the loaded mod.

The local client mirrors character data into browser local storage for Creator Toolkit's local mod version. Use
the same browser profile and save slot for reload checks. An incognito window or a different profile has separate
storage. A fresh backend also needs a fresh test character when you want to exercise first-time registration rather
than reconnecting an identity from a previous database at that origin.

## Diagnose a failed connection

```sh
docker compose --project-name melvor-selfhost ps
docker compose --project-name melvor-selfhost logs --tail 100 server
```

Substitute `melvor-selfhost-toolkit` when testing that stack. A healthy container proves the backend started; it does
not prove that the game browser can reach it. Check the exact origin, full reload, certificate trust for HTTPS,
browser local-network permission, and whether another copy of the mod is enabled.

In the browser console, `Local Network Access permission required` can identify this browser permission gate.
Entries followed by `prompt action: auto_allow` also appear for successful requests, so their presence alone is not
an API failure. Check the request's HTTP status and whether the mod reports an authenticated session. CORS headers
from the backend do not grant the browser's device-access permission.

Check browser preflight separately:

```sh
curl --include --request OPTIONS \
  --header 'Origin: https://melvoridle.com' \
  --header 'Access-Control-Request-Method: POST' \
  --header 'Access-Control-Request-Headers: content-type,x-session-token' \
  http://127.0.0.1:3000/api/v2/register
```

Expect HTTP 204 and `Access-Control-Allow-Origin: https://melvoridle.com`. For a hostname test, repeat with its HTTPS
origin. This verifies the API/proxy response, but browser restrictions and the actual game flow still need manual
validation. Do not include session tokens, identity credentials, or full saves in shared diagnostics.

The automated fresh-stack smoke test registers a disposable player, requests authenticated events, and removes its
own database. Run it on an unused port so it does not conflict with the persistent manual-test instance:

```sh
MELVOR_SERVER_PORT=3001 ./scripts/smoke-test.sh
```

The smoke test uses the fixed Compose project `melvor-mp-smoke`; do not run competing smoke tests concurrently.

## Expedition preparation activation

Backend deployments keep Expedition supply donations enabled by default. Rift Preparations are activated separately
through the host administration CLI: `bun run admin.ts expedition-preparations enable confirm` from the server
working directory. Inspect with `bun run admin.ts expedition-preparations status`. This persistent, one-way switch
closes new donations and exposes personal preparation tasks; committed donation receipts and earned EP remain.
Coordinate activation with the matching client release and supported-client floor. Code deployment alone never
activates this cutover.
