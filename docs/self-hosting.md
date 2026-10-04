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

For a reproducible release test, check out its tag before building, for example `git checkout 1.6.1`.
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
the defaults work for this local test. Keep the same project name for subsequent commands.

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
- Proxy routing for `/health`, `/api/versions`, and all `/api/` paths to the backend, preserving paths, request bodies,
  `Origin`, and the mod's request/response headers. Forward `OPTIONS` requests to the backend; it supplies CORS headers.
- Network access to the proxy from the game device. The default backend port is loopback-only. A proxy running on
  the Docker host can reach `127.0.0.1:3000`; a proxy container on the same Compose network uses `server:3000`.

Check `https://multiplayer.example.com/health` and `/api/versions` in the actual game browser without a certificate
warning before connecting. Set only the origin in Mod Settings, without `/api`, a path, credentials, query, or fragment.
Keep `MELVOR_TRUST_PROXY=0` for an ordinary reverse proxy; this option specifically trusts Cloudflare's
`CF-Connecting-IP` header and is not a general HTTPS switch.

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
./scripts/package-mod.sh
unzip -tq dist/melvor-multiplayer-local.zip
unzip -p dist/melvor-multiplayer-local.zip main.mjs | head -n 5
```

The archive must have `manifest.json` and `main.mjs` at its root. The checked-in client defaults to
`http://127.0.0.1:3000` and reports `development` as its internal mod version. A ZIP made this way does not inherit
the published release's bundled endpoint. The Connection setting can override its endpoint in the same way.

1. Import `dist/melvor-multiplayer-local.zip` using Creator Toolkit and enable it in a dedicated mod profile.
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
