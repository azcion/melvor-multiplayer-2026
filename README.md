![Melvor Multiplayer](/assets/melvor_multiplayer_logo.png)

# Melvor Multiplayer 2026 - Public Test

Melvor Multiplayer 2026 is a self-hosted Melvor Idle multiplayer mod and server rebuilt around Guild-isolated play.
This repository contains the public source for public-test version `0.1.0-public-test.10`, targeting Melvor Idle
v1.3.1 on Desktop and Browser.

This is an unofficial, community-maintained fork of
[Melvor Multiplayer](https://mod.io/g/melvoridle/m/melvor-multiplayer), originally created by Kruithne. No affiliation
with or endorsement by the original author, Games by Malcs, or Jagex is claimed.

## Public-test notice

This is a test release, not a finished version. Expect bugs, balance changes, downtime, and incomplete behavior. Back
up Melvor saves before participating and avoid valuable items or GP where practical. Multiplayer identities and
server-owned Guild, transfer, marketplace, Charitree, Campaign, and Council data may be reset when recovery requires
it.

## Current multiplayer model

- Guild membership is the boundary for trades, gifts, marketplace listings, Charitree inventory, and Campaigns.
- Guild marketplaces, Charitree inventories, and Campaigns are isolated from every other Guild.
- Campaign goals scale with Guild size and require member participation to complete.
- Guild members govern shared changes and banishment through Council petitions and ballots.
- Each character keeps a separate multiplayer identity for every normalized server origin.
- The mod can connect to the bundled server origin or a trusted custom HTTPS server selected in Mod Settings.

## Run a self-hosted server

Docker and Docker Compose are the only host prerequisites. Optionally copy `.env.example` to `.env`, then run:

```sh
docker compose up --build --wait
```

The server listens at `http://127.0.0.1:3000` by default. The port is loopback-bound unless you deliberately place a
trusted HTTPS proxy in front of it. Stop the stack with:

```sh
docker compose down
```

The SQLite database is stored in the `database-data` Docker volume. Add `--volumes` only when you deliberately want to
delete that local data. The server does not import data from the original project's MySQL storage.

## Build the local mod

Create a Creator Toolkit-ready ZIP from the checked-in loopback development client:

```sh
./scripts/package-mod.sh
```

Import `dist/melvor-multiplayer-local.zip` through Melvor's Creator Toolkit, enable it in a dedicated mod profile, and
reload the game. Disable the original Melvor Multiplayer mod in that profile so both clients do not run together.

To connect a character to another compatible server, open this mod under **Mod Settings**, set an HTTPS server origin
under **Connection**, and fully reload Melvor. HTTP overrides are accepted only for loopback development servers.
Connect only to operators you trust with the multiplayer identity and gameplay data sent through the mod.

## Validate the source

Run the complete containerized server suite and restart checks:

```sh
./scripts/test.sh
```

Run the standalone client tests:

```sh
node --test tests/mod/*.test.mjs
```

Run the fresh-stack server smoke test:

```sh
./scripts/smoke-test.sh
```
