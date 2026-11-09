# Self-hosting from the public source

Start with the main server and connect the published Melvor Multiplayer Remastered mod. Add the combat service
only if you want Online Combat.

| Compose service | What it does | Default host address |
| --- | --- | --- |
| `server` | Required. Handles the multiplayer API, accounts, Guilds, Browser Chat, and the SQLite database. It also issues Online Combat tickets and saves combat progress. | `127.0.0.1:3000` |
| `combat` | Optional. Runs Online Combat fights and streams updates to the game over WebSocket. It talks to `server` over the private Compose network and uses the main server's database through that connection. | `127.0.0.1:3002` |

## Windows setup

Install and start [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)
with Linux containers and the WSL 2 backend. Open PowerShell in the source folder, or install Git and use the
clone command below. Run `docker compose version` to check that Compose is available. The Git and Compose
commands in this guide work in PowerShell. Use `curl.exe` for the HTTP checks. Examples marked Bash require a
Bash shell, such as WSL with Docker Desktop integration enabled.

## Start the main server

Start Docker with Compose support. The containers supply Bun and SQLite. Clone the public source:

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

Expect `"status":"ok"` and a backend version from `/health`. The `/api/versions` response lists supported API
versions and any minimum mod version. You can register on a fresh server with the default settings.

The server binds to `127.0.0.1:3000` on the Docker host. If that port is occupied, set `MELVOR_SERVER_PORT=3001` in
a local `.env` file before starting, and use that port for direct API requests. `.env.example` lists optional
settings. To use Browser Chat locally, also set
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

## Update an existing backend

In the source checkout used for the server, get the newer version. If the checkout follows `main`, run:

```sh
git pull --ff-only
```

If you checked out a release tag, fetch tags and switch to the newer tag instead. Back up the database before
rebuilding. Then run the same start command and use the same Compose project name as before:

```sh
docker compose --project-name melvor-selfhost up --build --detach --wait server
```

Use your existing project name in place of `melvor-selfhost`; changing it creates a separate database volume. This
command keeps the current database and applies the newer backend source. If you enabled Online Combat, use the
two-service start command below so both services are rebuilt from the same checkout. Avoid `down --volumes`, which
deletes the database.

## Enable Online Combat

Use a source checkout that includes the `combat` Compose profile and a compatible mod. First confirm the main
server works. Then create a shared ticket key **once** and keep it private. If `config/combat-ticket.key` already
exists for this instance, reuse it.

**PowerShell**

```powershell
New-Item -ItemType Directory -Force config | Out-Null
if (-not (Test-Path config/combat-ticket.key)) {
    $combatKey = New-Object byte[] 32
    $combatRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $combatRng.GetBytes($combatKey)
    $combatRng.Dispose()
    [BitConverter]::ToString($combatKey).Replace('-', '') | Set-Content -Encoding ascii config/combat-ticket.key
}
```

**Bash (requires OpenSSL)**

```bash
mkdir -p config
test -f config/combat-ticket.key || openssl rand -hex 32 > config/combat-ticket.key
```

In the repository root, add this line to `.env`. The value is the path **inside** the containers, including on Windows.

```dotenv
MELVOR_COMBAT_TICKET_KEY_FILE=/app/config/combat-ticket.key
```

Build and start both services under the same project name. Check the combat process directly (use `curl.exe` in PowerShell).

```sh
docker compose --project-name melvor-selfhost --profile combat up --build --detach --wait server combat
curl --fail --show-error http://127.0.0.1:3002/health
```

The combat health check returns `OK` when the process is listening. To play, put both services behind one origin
using the [proxy example below](#example-nginx-on-the-docker-host). Route `/combat/socket` to `combat` and keep
the API routes on `server`. The mod derives its WebSocket URL from the server URL in Connection settings.
Keep the internal authority connection (`server:3003`) inside Docker.

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

### Steam workaround for local HTTP on Windows

If the Steam edition blocks your local HTTP server, you can try these Chromium flags for same-PC testing.
They relax web security across the game client. Use them only with a trusted server on loopback.

1. Exit Melvor Idle. In your Steam Library, right-click **Melvor Idle → Manage → Browse local files**.
2. Back up the game's `package.json`, then open it in a text editor.
3. Find `"chromium-args"`. Append the following inside its existing quoted value, separated from the other
   arguments by a space. Keep the existing arguments. See the [NW.js manifest reference](https://docs.nwjs.io/References/Manifest%20Format/#chromium-args).
4. Save the file, relaunch from Steam, and try connecting to `http://127.0.0.1:3000` (or your local proxy port).

```text
--allow-running-insecure-content --disable-web-security
```

The mod still requires HTTPS for LAN IPs and other hostnames. Restore the backed-up file to re-enable the
client's default protections.

Thanks, albertoacv4498!

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

After changing `.env`, rerun the start command for the services you enabled.

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

For Online Combat, add this location inside the same `server` block. These headers let Nginx pass the
[WebSocket upgrade](https://nginx.org/en/docs/http/websocket.html) through to the combat service.

```nginx
location = /combat/socket {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

For a proxy container on the same Compose network, use `server:3000` for the API and `combat:3002` for the socket.

For same-PC play, you can use the same Nginx routes with HTTP on loopback. To keep an existing
`http://127.0.0.1:3000` game connection, set `MELVOR_SERVER_PORT=3001` in `.env` and rerun the two-service
start command. In the Nginx example, use `listen 127.0.0.1:3000;` and `server_name 127.0.0.1;`, remove both
certificate lines, and change the API upstream to `http://127.0.0.1:3001`. Keep the combat upstream on port 3002.
Use `http://127.0.0.1:3000` for the mod and, if using Browser Chat, for `MELVOR_CHAT_PUBLIC_ORIGIN`.

On Windows, unpack [Nginx for Windows](https://nginx.org/en/docs/windows.html). In its `conf/nginx.conf`, replace
the default `server` block inside `http` with the loopback version above, including the combat location. From the
Nginx folder in PowerShell, check the config with `.\nginx.exe -t` and start it with `Start-Process .\nginx.exe`.
If it is already running, use `.\nginx.exe -s reload`.

Check `/health` and `/api/versions` on the proxy origin. If using Browser Chat or the wiki, open those through
the proxy too. For Online Combat, start a fight with a test character and confirm it progresses. The game's
network inspector should show a WebSocket upgrade (HTTP 101) on `/combat/socket`. If the main API works but
combat fails, check the socket route and the logs for both services:

```sh
docker compose --project-name melvor-selfhost --profile combat logs --tail 100 server combat
```

### Optional player wiki

The default wiki link points to the official handbook. To host a copy, build the static site with Node.js 22.18+
and run its separate Nginx container from the repository root:

```bash
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

```bash
MELVOR_SERVER_PORT=3002 docker compose --project-name melvor-selfhost-toolkit up --build --detach --wait server
```

In that case, set the local mod's custom server to `http://127.0.0.1:3002` and reload. Its bundled default still
uses port 3000. The different origin also keeps the second test's client identity separate from the first.

Install Node.js and the `zip` command on the build host. Package the checked-in client and validate the archive
with `unzip`. Run these commands in Bash:

```bash
./scripts/package-mod.sh 1.7.9 A
unzip -tq dist/melvor-multiplayer-local-1.7.9-A.zip
unzip -p dist/melvor-multiplayer-local-1.7.9-A.zip main.mjs | head -n 5
```

The archive must have `manifest.json` and `main.mjs` at its root. The checked-in client defaults to
`http://127.0.0.1:3000`. Pass the numeric `x.y.z` version matching your source checkout (for example, `1.7.9`
for 1.7.9 source); the packager replaces `development` only in the staged copy. The backend rejects
`development` and versions below its supported minimum. A version override does not make older source compatible.
The optional suffix (`A` above) distinguishes rebuilds in the filename without changing the API version.
The script packages working-tree changes, including uncommitted edits, and leaves source files unchanged.
Use the mod’s Connection setting to change the endpoint.

1. Import `dist/melvor-multiplayer-local-1.7.9-A.zip` using Creator Toolkit and enable it in a dedicated mod profile.
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

Check browser preflight separately. In PowerShell, use `curl.exe` and paste this as one line:

```sh
curl --include --request OPTIONS --header 'Origin: https://melvoridle.com' --header 'Access-Control-Request-Method: POST' --header 'Access-Control-Request-Headers: content-type,x-session-token' http://127.0.0.1:3000/api/v2/register
```

Expect HTTP 204 and `Access-Control-Allow-Origin: https://melvoridle.com`. For a hostname test, repeat with its HTTPS
origin. This verifies the API/proxy response, but browser restrictions and the actual game flow still need manual
validation. Do not include session tokens, identity credentials, or full saves in shared diagnostics.

The automated fresh-stack smoke test registers a disposable player, requests authenticated events, and removes its
own database. Run it on an unused port so it does not conflict with the persistent manual-test instance:

```bash
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
