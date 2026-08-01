# Changelog

## 0.1.0-public-test.11

- Added the Free Fellowship, a permanent server-wide Guild that players can join directly without an application.
- Added Guild equipment sharing. Members can view another member's latest shared equipment setup in a read-only view, while each player controls whether their equipment is visible.
- Improved Guild member selection with search and pagination for gifts and trades.
- Consolidated display name, avatar, equipment visibility, and Guild departure controls under the new Options menu.
- Added independent backend deployment versioning.

## 0.1.0-public-test.10

- Rebuilt the server around Bun and SQLite with containerized startup, health checks, backups, and automated tests.
- Replaced shared server-wide multiplayer activity with Guild-isolated trades, gifts, marketplaces, Charitree
  inventories, and Campaigns.
- Added Guild creation, discovery, applications, membership, departure, dissolution, and equal member decisions.
- Added Council petitions and ballots for Guild appellation, heraldry, and member banishment.
- Scaled Campaign goals for Guild size and capped automatic progress so member participation remains necessary.
- Added custom multiplayer display names, player avatars, Guild icons, and per-server character identities.
- Added custom HTTPS server selection with loopback HTTP support for local development.
- Improved refresh behavior, transfer recovery, concurrency handling, authentication, request limits, numeric
  boundaries, and persistent restart behavior.
