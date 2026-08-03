# Changelog

## 0.1.0-public-test.14

- Linked multiplayer identities belonging to saves under the same Melvor Cloud username and PlayFab ID. When multiple identities are found, Options now includes an Identities menu for managing sibling saves.
- Added reversible identity deletion with a 72-hour delay. Loading the target save automatically cancels a pending deletion; after execution, multiplayer sessions and shared activity are cleaned up and held assets are returned through multiplayer storage.
- Added automatic recovery when a previously deleted identity is loaded. It returns as Guildless without restoring canceled listings, transfers, or hidden Chat conversations.
- Loading a save under a different Melvor Cloud account now creates and stores a separate multiplayer identity without changing the original account's identity.

## 0.1.0-public-test.13

- Added modded item support for the Marketplace and Charitree. Valid namespaced items are accepted by the server, while the client only shows items resolved by the active mod profile; Marketplace filtering and pagination account for that compatibility.
- Added recovery for shared items unavailable in the active mod profile. Unresolved Marketplace listings appear as unavailable and can be destroyed after accrued sale proceeds are paid out; remaining stock is placed in a destroy-only transfer inventory instead of the bank. Incoming gifts containing unavailable items are returned to their sender where possible.

## 0.1.0-public-test.12

- Added optional Player Status sharing, showing skill levels and current activity.
- Added private Guildmate Chat with unread indicators, message history, blocking and privacy controls, conversation deletion, and replenishing message capacity. Chats remain available after Guild changes.

## 0.1.0-public-test.11

- Added the Free Fellowship, a permanent server-wide Guild that players can join directly without an application.
- Added Guild equipment sharing. Members can view another member's latest shared equipment setup in a read-only view, while each player controls whether their equipment is visible.
- Improved Guild member selection with search and pagination for gifts and trades.
- Consolidated display name, avatar, equipment visibility, and Guild departure controls under the new Options menu.
- Added independent backend deployment versioning.

## 0.1.0-public-test.10

- Rebuilt the server around Bun and SQLite with containerized startup, health checks, backups, and automated tests.
- Replaced shared server-wide multiplayer activity with Guild-isolated trades, gifts, marketplaces, Charitree inventories, and Campaigns.
- Added Guild creation, discovery, applications, membership, departure, dissolution, and equal member decisions.
- Added Council petitions and ballots for Guild appellation, heraldry, and member banishment.
- Scaled Campaign goals for Guild size and capped automatic progress so member participation remains necessary.
- Added custom multiplayer display names, player avatars, Guild icons, and per-server character identities.
- Added custom HTTPS server selection with loopback HTTP support for local development.
- Improved refresh behavior, transfer recovery, concurrency handling, authentication, request limits, numeric boundaries, and persistent restart behavior.
