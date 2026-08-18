![Melvor Multiplayer Remastered](assets/melvor_multiplayer_remastered_logo.png)

# Melvor Multiplayer Remastered

Melvor Multiplayer Remastered is a self-hosted Melvor Idle multiplayer mod and server rebuilt around Guild-isolated
play. This repository contains the public source for version `1.3.3`, targeting Melvor Idle v1.3.1.

This is an unofficial, community-maintained fork of
[Melvor Multiplayer](https://mod.io/g/melvoridle/m/melvor-multiplayer), originally created by Kruithne. No affiliation
with or endorsement by the original author, Games by Malcs, or Jagex is claimed.

## Service notice

The hosted service is best-effort. Back up Melvor saves before participating and avoid valuable items or GP where
practical. Multiplayer identities and server-owned Guild, transfer, marketplace, Charitree, Campaign, Council, and
Raid data may be reset when recovery requires it.

## Current multiplayer model

- Guild membership is the boundary for trades, gifts, marketplace listings, Charitree inventory, and Campaigns.
- Guild marketplaces, Charitree inventories, and Campaigns are isolated from every other Guild.
- Campaign goals scale with Guild size and require member participation to complete.
- Guild members govern shared changes and banishment through Council petitions and ballots.
- Private Guilds and the Free Fellowship can activate 72-hour Raids, spend bounded Assaults against four placeholder Monster tiers in normal
  Melvor combat, earn tier loot and standings, and receive equal Victory Caches after securing shared health.
- The server keeps one rolling timestamp of each identity's latest authenticated multiplayer activity. It scales newly
  activated Raids from members active during the previous 14 days and appears to current Guildmates as coarse last-seen
  time.
- Current Guildmates can share their equipment, minimal Player Status, current GP, game mode, and latest non-empty
  active-mod list on an opt-out basis.
  GP is stored as a raw amount and formatted using the viewing player's Melvor Number Format setting. Disabling
  game-mode or active-mod sharing hides that value from other players without deleting the compatibility snapshot
  described below.
- Current Guildmates can begin identity-owned Private conversations that persist through later Guild changes, with
  unread state, privacy controls, participant-only deletion, and time-replenishing Messaging credits.
- Each character keeps account-specific multiplayer identity bindings for every normalized server origin. Saves using
  the same PlayFab ID can discover sibling identities and schedule reversible deletion from the in-game Options menu;
  the first observed Melvor Cloud username is retained as a human-readable account label.
- The mod can connect to the bundled server origin or a trusted custom HTTPS server selected in Mod Settings.
- For compatibility diagnostics, the server keeps only the latest reported Multiplayer mod version, character
  game-mode ID, successfully loaded mod names, and report time for each multiplayer identity. It does not collect
  disabled mods, other mods' versions or settings, profile names, or snapshot history.

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
