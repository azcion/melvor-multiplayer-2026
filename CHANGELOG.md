# Changelog

## 1.4.6 (Unreleased)

- Fixed rejecting a Gift incorrectly preventing the declining player from leaving their Guild while the returned Gift awaited collection by its original sender.

## 1.4.5

- Moved the Multiplayer sidebar section to immediately after Bank, before Into the Abyss when that section is available.
- Added private Marketplace activity entries for completed purchases and buy-order fulfillments. Buyers and sellers see personalized item quantities and names, other Guild members cannot see those entries, and private entries are marked with a lock. Activity records also retain item IDs for future icon rendering.
- Added an Updates page to the Multiplayer sidebar with server-fetched developer notices, current work, and future plans alongside the mod.io changelog. Desktop shows both columns, while mobile switches between Updates and Changelog tabs.
- Renamed Player Profile controls from Status to Skills to reflect that the profile modal shows only Skills and Equipment.
- Added Guild member Account Age (minute precision) and Total Skill Level to the member actions modal, collected in the background and localized with Melvor's language formatting.
- Fixed the Guild Activity mobile **Load more** button appearing outside the scrollable activity list instead of at the end of the loaded entries.
- Added independently revocable installation credentials while retaining automatic save-based enrollment and compatibility with older servers. Different installations can stay connected simultaneously; reconnecting the same installation replaces only its own older session, with a clear explanation instead of repeatedly failing requests.
- Added privacy-bounded connection diagnostics and a copyable report under Mod Settings, including recent request outcomes, platform/engine labels, and optional player-reported app distribution, stable/beta channel, version, and build. Reports support manual copying when clipboard access is unavailable and exclude IP addresses, raw user agents, device names, credentials, and request bodies.
- Relaxed server CORS restrictions to accept browser and native-app origins and runtime-added request headers, while retaining session authentication and Guild permissions.

## 1.4.4

- Fixed the mobile side navigation remaining open when Multiplayer automatically changes pages, without hiding the persistent navigation on desktop.
- Fixed an invalid Campaign reward leaving Campaign and other multiplayer state stuck after refreshes. Existing affected rewards are repaired and delivered once, new rewards are rounded to whole GP, and malformed receipts can no longer make an active Campaign appear inactive.

## 1.4.3

- Fixed acknowledged Marketplace and other economy receipts remaining in character storage indefinitely, including cleanup of legacy receipt IDs, while retaining retry safety for interrupted acknowledgements.

## 1.4.2

- Added optimized fallback icons for Invention, Profile, Enchanting, Necromancy, Adventuring, Shamanism, and Thuum, and reduced the size of the existing custom skill PNGs for shared Player Status.
- Added a mobile burger-menu badge that mirrors the shared unread Chat count while the side navigation is collapsed.
- Added first-message Support Chat choices for new player conversations, pre-filling the existing composer with either a problem or suggestion while preserving any saved draft.
- Added Recent Marketplace sorting, which shows the newest listings first by publish date, while retaining direction-specific Price sorting.
- Added blue Max buttons to Marketplace purchase, Marketplace fulfillment, and Campaign contribution modals for quickly selecting the available quantity.
- Improved Marketplace buy-order fulfillment modal layout with a two-line request title, bank quantity indicator, and bank-aware quantity limit.
- Added clear Marketplace buy-order fulfillment notices showing the items and quantities added to the player's bank.
- Fixed Marketplace pagination controls appearing when all results fit on one page.

## 1.4.1

- Added prepaid Guild Marketplace buy orders: players can request a specified item quantity at a fixed unit price, while other Guild members can fulfill orders partially or fully.
- Added clear Marketplace buying and selling views, a dedicated buy-order form, direct Bank fulfillment, and My Orders controls for escrow and refunds.
- Fixed Marketplace buy-order escrow and requested quantities being mishandled during identity deletion; prepaid GP now returns safely without creating free items.

## 1.4.0

- Bundled icons for Archaeology, Music, Occultism, Construction, and Sailing so shared activities and skill levels render correctly even when the viewer does not have those skill mods installed.
- Ordered Guild discovery with Free Fellowship first, followed by joinable and applyable Guilds sorted by recent member activity; Shadowed Guilds remain hidden.
- Added a green New Member badge to Guild roster members who joined within the last 48 hours; each member continues to see the existing You badge for their own row.
- Added sidebar status pills for Charitree pick availability and active Guild Raids.
- Guild Raid participant lists now show only members who have started an Assault, including in-progress Assaults at Tier 0 until they win.
- Added a localized Guild Activity feed showing recent membership, Charitree, Raid, Marketplace, Petition, and Campaign events, with bounded pagination and throttling for noisy player actions.
- Added concurrent activity sharing to Player Status. Guild rosters now show up to three current skill or combat activities, with a count for additional activities, and member profiles show the complete shared set.
- Expanded player avatar selection to include monsters and pickpocketing targets from the base game and all official DLCs. Avatar search uses their familiar in-game display names.
- Expanded Guild icon selection to include combat locations from the base game and all official DLCs.
- Added bounded collection of custom skill icons from shared Player Status to support future mod compatibility. Official, action, and combat icons are excluded, and collected data remains subject to host-controlled limits.
- Added latest reported player-language collection. Recognized language labels appear at the bottom of a Guild member's actions modal; unknown or unavailable values remain hidden.
- Fixed Guild rosters staying stale after changing the current player's display name or avatar while the Guild page was open.
- Improved Guild page layout by containing long member and activity lists, reducing excess bottom spacing, and tightening activity and member-search spacing across desktop and mobile.

## 1.3.4

- Added an SAE Support Team channel for players using SUPER AWESOME EXPANSION. It appears alongside Multiplayer Support only while the expansion is active, uses its own SAE identity and icon, and retains conversation history if the expansion is later disabled and re-enabled.

## 1.3.3

- Added Simplified Chinese localization contributed by `k348674808`. Melvor's `zh-CN` language now loads the translated Multiplayer interface while unsupported languages continue to use English.

## 1.3.2

- Fixed Multiplayer sidebar and page titles, settings, placeholders, Raid status text, item tooltips, and accessibility labels bypassing localization. Language changes now preserve both Melvor's base translations and the mod's translated text.
- Fixed two-digit numbering being clipped on the left side of the Active Mods list at larger interface scales.
- Fixed failed Gift sends not showing the pending Gift warning in the confirmation modal.
- Fixed successful Marketplace purchases logging a slider teardown error after the purchase completed.

## 1.3.1

- Fixed Guild roster refreshes logging game-mode errors and requesting `/undefined` when a Guildmate hid their game mode or used a mode without a supported roster icon.

## 1.3.0

- Made completed Campaign history, medals, pet progress, and unclaimed rewards follow each multiplayer identity between Guilds. Unfinished contributions remain with their original Guild, and joining a Guild does not grant its past Campaign rewards.
- Added compatibility diagnostics that report the current Multiplayer version, character game-mode ID, and successfully loaded mod names once per game load. The server retains only the latest snapshot for each multiplayer identity and does not collect disabled mods, other mods' versions or settings, profile names, or snapshot history.
- Added default-on game-mode sharing for current Guildmates, with recognizable base-mode icons in the Guild roster and a labeled mode in the player modal. Custom modes use a question-mark icon in the modal, show their name when the viewer has that mode installed, and otherwise appear as Unknown Mode. Sharing can be disabled from Options without deleting the compatibility snapshot.
- Added default-on active-mod sharing for current Guildmates. A Show Active Mods action appears only when the player allows sharing and has reported a non-empty list, preserves the reported order, and can be disabled from Options without deleting the compatibility snapshot.
- Simplified Guildmate details by moving current activity into the first player modal, keeping the Status & Equipment skill grid uncapped so the modal scrolls naturally on mobile, and using compact game-mode icons in Guild rosters.
- Added a privacy-aware self-preview to Options so players can inspect the same profile presentation others see, and consolidated Guild departure and identity deletion into one compact danger zone.
- Added a non-blocking update notice when the multiplayer server reports that a newer released mod version is available.

## 1.2.0

- Fixed cancelling a new trade returning its escrowed items immediately and then returning the same items a second time through the durable Trade return.
- Hardened linked identities and Support Team access: linked saves are now informational, identity deletion must be requested from the loaded save, and team access is limited to operator-selected authenticated multiplayer identities.
- Prevented player display names from being interpreted as HTML in multiplayer popups and limited new names to letters, numbers, spaces, and simple punctuation.
- Made Marketplace, Campaign, Charitree, Gift, and Trade item or GP changes recover safely after interrupted requests, preventing committed transfers from being lost, duplicated, or clearing items added while a request was in flight.
- Fixed a returned Transfer Inventory item reappearing after a reload and allowing the same item to be returned again.
- Fixed a full Transfer Inventory allowing part of a Banishment return to be applied repeatedly on every retry.
- Fixed temporary or stalled network requests permanently stopping event, Chat, or page refreshes until the game was reloaded.
- Fixed Support Chat messages and read state sometimes failing to refresh until another multiplayer event occurred.
- Fixed reciprocal Friend Requests creating duplicate entries in both players' Friends lists.
- Fixed Gifts and Trades resolved in another tab or session remaining visible until the game was reloaded.
- Added a safe permanent-discard action for returned Gifts containing items from a mod that is no longer installed, so they no longer block leaving a Guild.
- Fixed rapid Marketplace filter, sort, or page changes showing an older result, and kept searches responsive as the number of compatible listings grows.
- Fixed sending a Chat Message and immediately switching conversations changing the newly opened conversation or its draft.
- Fixed a completed Guild Raid settlement occasionally deleting a newer pending Raid result before it could be submitted.
- Fixed the Charitree pet chance always being 10%; it now starts at 0.1%, increases with donation value, and caps at 10% as intended.
- Fixed repeated item and GP slider modals retaining background input listeners after they were closed.
- Fixed the Charitree continuing to run its one-second expiry clock after leaving the page.
- Improved Personal and Support Chat inbox loading so it remains responsive as conversation history grows.
- Fixed Gifts rejecting the 32nd distinct Transfer Inventory entry; Gifts, Trades, and Charitree donations now share the documented 32-entry limit.

## 1.1.1

- Reordered Chat so the current Guild conversation appears first, followed by Personal and Support conversations.
- Ordered Guild member lists by most recent multiplayer activity, with inactive or unknown activity at the bottom, and hid the View Shadowed Members action when no members are Shadowed.

## 1.1.0

- Reorganized Chat into Personal, Guild, and Support sections with one shared unread count, and added a default-on group Chat owned by every Guild, including solo Guilds and the Free Fellowship. Guild Chat retains history for later joiners, follows the player's current Guild, hides when they leave or change Guilds, and can be left or rejoined at any time through the Add me to Guild Chat option without deleting existing Messages.

## 1.0.0

- Fixed the Charitree's next-offering message appearing beside its description instead of below it on Desktop and mobile.

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
