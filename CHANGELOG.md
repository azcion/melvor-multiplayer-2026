# Changelog

## 0.1.0-public-test.25

- Added Shadowed membership for players inactive from multiplayer for more than seven days, keeping durable Guild access while excluding Shadowed members and Guilds from ordinary discovery and new shared calculations. Guild Councils can use the new Petition of Winnowing to banish members who remain Shadowed.
- Fixed the Chat Send button moving left after Message capacity was disabled and restored spacing beneath the composer.
- Isolated Transfer Inventory, reward and return delivery tracking, Charitree cooldowns, Banishment notices, and pending Raid results by multiplayer server so custom servers cannot reuse or consume another server's character state.

## 0.1.0-public-test.24

- Added Petition of Fellowship and Petition of Enclosure, allowing ordinary Guild Councils to open or close their gates. Open Guilds can be joined without an application, while newcomers must wait 24 hours before taking Charitree offerings.
- Disabled Message capacity and its sending restriction while retaining ordinary request limits, Chat privacy controls, blocking, validation, and moderation.
- Fixed Alt. Magic activity appearing as combat in shared Player Status.
- Fixed shared Player Status skill scrolling still not responding on iOS.

## 0.1.0-public-test.23

- Expanded Chat with a permanent Multiplayer Mod Team Support channel, a simpler Conversations inbox, an automated welcome, shared team replies, reliable independent unread state, and access while Guildless or ordinary Messaging is disabled.
- Kept newly opened private Chats as drafts until their first Message is sent instead of persisting empty conversations.
- Made the Multiplayer sidebar section collapsible through the same visibility control used by Melvor's built-in sections and moved Raids to the end of the section.
- Added Melvor item tooltips to Marketplace item icons.
- Improved interface behavior by allowing shared skill profiles to scroll on iOS, preventing shared equipment icons from being dragged, and replacing the Charitree's animated new-item glow with a static highlight.

## 0.1.0-public-test.22

- Refined Guild Council petition descriptions and adopted Guild emblem terminology throughout the creation and Heraldry flows.
- Preserved existing multiplayer identities while moving published builds to a permanent release storage namespace.

## 0.1.0-public-test.21

- Fixed the GP visibility control crashing when a Guild roster evaluated an unavailable GP snapshot.
- Fixed leaving a Guild breaking the Guild page or leaving detached modal effects subscribed to Guild state.

## 0.1.0-public-test.20

- Added default-on GP sharing and coarse last-seen activity to Guild rosters, with independent GP privacy control, viewer-local Melvor number formatting, and clearer compact dividers between members.
- Improved shared Player Status activity icons by falling back to Melvor's combat icon when a combat area is supplied by an unavailable mod.
- Improved modal reliability by mounting modal content only after its custom element is attached to the document.

## 0.1.0-public-test.19

- Reworked the Charitree with four-day expiry timers for donated stacks, safeguards for high-value and undiscovered items, and first-discovery handling for single-item rewards.
- Added Guild Council control over the Charitree with petitions to clear donated stacks, fell the Charitree, or restore an empty one; disabled Charitrees are hidden and cannot receive donations.
- Improved linked identity handling by grouping saves under the same PlayFab ID, preserving the first observed Melvor Cloud username as a label, and consolidating duplicate account groups without merging individual character identities.
- Moved multiplayer controls into Melvor's account dropdown, including the existing multiplayer status indicators.

## 0.1.0-public-test.17

- Reduced multiplayer background traffic with revision-aware event polling, foreground-only refreshes, and deduplicated requests while preserving timely Chat updates.
- Improved Android WebView reliability by bypassing cached authenticated multiplayer reads.
- Fixed Guild state becoming stale after leaving a Guild or switching multiplayer identities.

## 0.1.0-public-test.16

- Added Raid boss vulnerability windows: bosses begin with 99% Normal resistance and expose 33% resistance for six seconds after each attack, with repeated attacks refreshing the window.
- Replaced the Raid placeholder artwork with a plant-themed image across the Raid page and combat encounters.
- Improved browser reliability for authenticated, cache-bypassed reads by allowing the `Cache-Control` and `Pragma` headers used during CORS preflight.

## 0.1.0-public-test.15

- Added Guild Raids for Private Guilds and the Free Fellowship: activate a 72-hour shared encounter, spend bounded Assaults against four placeholder Monster tiers through normal Melvor combat, earn native material loot, compare Guild standings, and receive a Victory Cache after helping secure the Raid. Assaults require full Hitpoints to begin, Tier 1 includes the Toxic Dread special attack, and interrupted Assaults recover safely across reloads.
- Added sidebar status indicators for unread Chat messages and Raids that are ready or active.
- Improved Player Status so active Cartography maps are recognized.
- Fixed invalid Small and Medium Urn references in Campaigns and migrated affected saved Campaign state.
- Prevented authenticated multiplayer reads from being restored from stale browser or Android WebView caches. Guild membership now remains in a loading or error state until a fresh response arrives instead of incorrectly showing Guildless actions.
- Stabilized the Guild page during departures and multiplayer identity changes so delayed responses cannot render another identity's Guild state.

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
