![Melvor Multiplayer Remastered](assets/melvor_multiplayer_remastered_logo.png)

# Melvor Multiplayer Remastered

A 2026 remaster of Melvor Multiplayer. Bring your Melvor characters into a shared world: join a Guild to chat, trade,
pursue collective goals, face Guild Raids, and shape your community together.

## Features

- Group chat, private chat, in-app support chat.
- Public and private Guilds, or the Free Fellowship.
- Trading, gifting, the Marketplace, and Charitree.
- Cooperative Guild goals and Guild Raids.
- Showing off profiles for equipment, skill levels, GP, and current activity.
- Guild Council petitions, so members can shape their Guild together.

## Self-hosting

See the [self-hosting guide](docs/self-hosting.md) for Docker setup, connecting the published mod, and building a
Creator Toolkit ZIP.

## Validate the source

Run the complete server suite:

```sh
./scripts/test.sh
```

Run the client tests:

```sh
node --test tests/mod/*.test.mjs
```

Run the fresh-stack smoke test:

```sh
./scripts/smoke-test.sh
```

## Compatibility and privacy

Supports Melvor Idle v1.3.1 on iOS, Android, Desktop, and Browser. The service may undergo maintenance without notice.

The server stores the multiplayer data needed to provide these features, including Guild data, shared Player Status,
the latest reported player language, and Messages. Deleted Messages and conversations are removed only from your view.
Request logs are retained for seven days. New clients report a random, server-scoped installation ID and coarse
platform/engine labels. Optional app distribution (including Huawei AppGallery), stable/beta channel, app version,
and build are explicitly player-reported, not inferred from the phone brand. These labels accompany authenticated
request logs; origin categories, recognized preflight header names, and rejection reasons help diagnose transport
failures. The operator retains up to 32 latest installation records per Client, with first/last authentication times; those records are erased when the Client is deleted.
Diagnostics exclude IP addresses, raw user agents, device names, credentials, and request bodies. Connection request
details remain local to the installation and are not uploaded as a report automatically.

New servers enroll a separate installation credential in device-local storage after a successful connection.
Credential hashes and revocation state remain with the retained Client to support recovery after soft deletion;
they are never included in diagnostic reports. Different installations may stay connected simultaneously; reconnecting an installation replaces only its own
previous session. Keep your Melvor saves synchronized: last-save overwrite does not reverse trades or other shared
server changes made from another copy, and unacknowledged character-owned deliveries may reach both copies. Installation revocation does not revoke the save-carried identity proof:
anyone holding that proof may enroll another installation. Do not share saves containing multiplayer credentials.
Older servers continue using the save credential and cannot enforce installation revocation.

## Attribution

> Melvor Multiplayer 2026 is an unofficial, community-maintained fork of [Melvor Multiplayer](https://mod.io/g/melvoridle/m/melvor-multiplayer), originally created by **Kruithne**. It is not affiliated with or endorsed by the original author, Games by Malcs, or Jagex.
