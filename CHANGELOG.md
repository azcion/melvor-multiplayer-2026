# Changelog

## 1.5.10

- Added a persistent Using Cheats Guild-roster badge when a character reported a recognized cheat mod within the last seven days.
- Added Petition of Interdict and Petition of Heresy, allowing Guild Councils to confine members marked Using Cheats to Social Only or restore their full access.
- Added an in-game update notice for already-running sessions, prompting players to refresh or restart after a newer Multiplayer version becomes available.
- Added mandatory server-wide Polls below Global Chat, with authorized poll creation, one-or-more options, multi-select aggregate voting, append-only options, reactions, automatic updates, and a permanent discussion for each poll.
- Made profiles opened from Chat honor the sender's normal Private Chat, equipment, Skills, game mode, active-mod, language, Account Age, and Total Skill Level sharing across Guilds while keeping current activity private, and added the sender's Guild name at the bottom.

## 1.5.9

- Added Chat reactions with a curated 18-emoji picker, clickable aggregate counts, highlighted personal reactions, multiple reactions per player, and reactions on your own Messages.
- Unified Campaign and Raid participation scaling around 40% of Guild members active within four days, with one expected contributor for solo Guilds, a two-player minimum otherwise, and no upper ceiling.
- Reduced Campaign goals from twelve to four hours of estimated production per expected contributor and replaced aggressive upward rounding with nearest-increment rounding.
- Hid avatar and Guild icon choices whose registered media is the native question-mark placeholder while preserving existing saved choices.
- Replaced the Guild summary label with the number of days since the Guild was established.
- Added durable Guild creation timestamps for new Guilds; existing Guild timestamps can be backfilled from retained historical evidence.
- Allowed quantity controls to be cleared while entering a value instead of forcing the minimum back into the field.

## 1.5.8

- Added a Max action to Shuffle Leaves that previews one total per requested currency and fills the remaining Shuffle Bonus to 20 / 20 with one replay-safe request and aggregate deduction.
- Kept Shuffle Leaves confirmations open with a width-stable loader for at least two seconds to prevent rapid repeated submissions.
- Fixed Chat sender profiles from other Guilds showing a Private Chat start action that could not succeed.
- Added clear client messaging when a server operator requires Social Only mode for an identity or its Melvor account, and hid the unavailable Full Experience choice while that restriction is active.
- Fixed Shuffle Leaves becoming unresponsive when its modal could not be queued during a modal lifecycle transition.

## 1.5.7

- Added Charitree Wishes: request 1–100 discovered eligible items at no cost, wait four days, then ripen the Wish with value from decaying GP offerings before its owner picks the reward from the tree into the Inbox.
- Added Guild-visible Wish progress, owner-only forsaking and picking, account-group-wide Wish limits and Shuffle Bonus penalties, plus Wish settlement for departures and destructive Charitree Petitions.
- Fixed official base-game and DLC pet icons disappearing from the avatar picker and existing pet avatars rendering as question marks after Multiplayer pets moved out of Melvor's native pet system.
- Restored Multiplayer pet icons to the avatar picker while keeping their server-owned pet mechanics separate from Melvor's native Pets and Completion systems.
- Placed pet icons first in the avatar picker for quicker access.
- Capped per-request GP transfers and donations at 1 billion GP and other supported currencies at 1 million, including Charitree donations, Shuffle Leaves, Gifts, Trades, and Marketplace haggles; excess currency remains available in Transfer inventory.
- Fixed Max quantity selections being reset to one when a selected bank stack updates before a Transfer or Campaign contribution is submitted.

## 1.5.6

- Added Charitree decay recovery: expired offerings with GP value become Weird Gloop, which appears first and can be claimed or donated like any other offering without a timer or leaf cover.
- Added a one-time prompt after Multiplayer experience selection for players still using the default avatar, with the existing avatar picker ready for choosing a new icon.
- Replaced the inline bank Transfer and Marketplace panels with a single Multiplayer Actions entry for Transfer, Marketplace, and Charitree quantity actions.
- Buffed Charitree leaf visibility after shuffling: each shuffle lowers every offering's coverage chance by five percentage points for seven days, including 100% and undiscovered offerings, shared across every character belonging to the same user and capped at zero coverage.
- Grouped Inbox deliveries under source titles, aggregating repeated Marketplace counterparties and other matching events while retaining one Claim action for everything.
- Moved Marketplace sell proceeds into the Inbox automatically as purchases complete and removed manual payout claiming from Sell Listings.
- Marketplace listings now expire after 14 days without activity, returning remaining items or GP to the Inbox under “Expired Marketplace listing”.
- Fixed avatar-picker and display-name input modal outlines being clipped by SweetAlert's HTML-container overflow.

## 1.5.5

- Added Shuffle Leaves to the Charitree: offer the requested currency to stir its leaves for your characters. The offering joins the tree, and your characters cannot claim that currency from it for four hours. Background updates preserve the page position, and confirming an offering safely closes the modal before applying its payment.
- Moved updated clients to versioned multiplayer APIs while keeping existing 1.5.1–1.5.4 clients supported.
- Made pending item and GP transactions recover after lost responses and reloads without submitting the same transaction twice.
- Preserved automatic returns of unavailable Gift items across connection failures and reloads.
- Fixed incoming Gifts failing to appear when an unrelated Economy Receipt is waiting to apply.
- Prevented repeated Charitree donation confirmations from submitting the same donation twice.
- Fixed cleared player activities remaining visible to older clients.

## 1.5.4

- Increased Chat history pages from five to 20 messages while preserving older-history pagination.
- Made the Chat sidebar entry always open the Chat home list instead of reopening the last conversation.
- Added an independent server-wide Global Chat for every multiplayer identity, including Guildless players, with unread counts, retained history, and a separate default-on opt-out in Multiplayer Options.
- Reordered Chat into Global, Guild, Private, and Support categories.
- Added host-controlled server-wide and per-player Global Chat message limits that can be changed without a client update; delayed sends preserve the draft and quietly keep Send unavailable until the server-provided delay expires.
- Added Global Chat message moderation and persistent throttle controls to the host-local Service Console and administration CLI.
- Added avatars beside every sent and received Chat message, including messages in Global Chat.
- Made Chat message avatars and usernames open the sender's member-info modal.
- Fixed Chat opening and sending to scroll to the newest messages, while loading older messages preserves the current viewport position.

## 1.5.3

- Moved Multiplayer pets out of Melvor's native Pets and Completion systems into server-owned, per-identity Multiplayer presentation.
- Recalculated Campaign pet ownership from four completed Campaigns and moved Campaign rewards to server-side 10x or 15x calculations.
- Reset Charitree pet ownership, moved future Charitree rolls server-side without a current bonus, and disabled the second daily take flow for updated clients.
- Combined GP, supported currency, and eligible zero-GP donation values client-side before sending Charitree donations.
- Fixed supported non-GP currencies, including Slayer Coins, being treated as new Charitree items and limited to a single claimed currency.
- Simplified Charitree value limits to automatically claim up to half the player's current balance, with the selected quantity shown before claiming and new items limited to one.
- Clarified that Charitree claims no longer mark items as discovered; items remain limited to one until discovered through a normal in-game source.
- Applied Charitree value limits to supported non-GP currencies using the player's balance of the donated currency.
- Added age-based mystery to Charitree offerings: leaves always conceal undiscovered items and can deterministically conceal discovered non-currency items, become less likely and change color as expiry approaches, and refresh the countdown only every 30 seconds.
- Reduced the Charitree taking cooldown from 24 hours to 20 hours and the direct-join newcomer lock from 24 hours to 4 hours.
- Clarified that leaves may conceal any item while it is far from expiring.

## 1.5.2

- Added Marketplace Haggles for reserved Buy and Sell listing quantities, alternating GP-per-item counteroffers, 72-hour offer expiry, fully escrowed acceptance, and source-labelled claims that move settled or returned value into the Transfers Inbox.
- Fixed Charitree donations of supported unmodded currencies, including Slayer Coins, being rejected as unavailable in the active mod profile.
- Fixed Guild member separators appearing too narrow and kept “Last seen” aligned when GP sharing is hidden.
- Improved Marketplace search-result column proportions.
- Fixed Chat and Free Fellowship pagination controls scrolling with their message and member lists.
- Fixed the active Raid sidebar badge disappearing after renaming the page to Raid (preview).
- Hid placeholder sidebar badges until their state is initialized, preventing colorful 0 and null badges during load.

## 1.5.1

- Fixed Inbox items failing to claim despite available Bank space. Items held in the Inbox can be claimed after updating.
- Added a warning when remaining Inbox items cannot be claimed, instead of silently refreshing the Inbox.

## 1.5.0

- Added Social Only mode with localized first-connection selection and settings; retained social features and Raid combat while disabling Charitree, Marketplace, Trading, Gifting, Campaigns, and Raid item rewards, returning pending exchanges to the Transfers Inbox.
- Added a per-save new-version badge to Updates, clearing when Updates is viewed on desktop or Changelog is selected on mobile.
- Added Outbox currency transfers for Gold Pieces, Slayer Coins, Abyssal Pieces, and Abyssal Slayer Coins through a balance-aware Add Currency picker and quantity slider; non-GP currencies remain excluded from Transfer GP values.
- Fixed Social Only cleanup to preserve returned Gift ownership and move legacy resolved Trade items into the Transfers Inbox.
- Expanded the server-owned Inbox to accepted and declined Gifts, completed or returned Trades, Marketplace purchases, proceeds and escrow returns, Charitree takes, Campaign GP rewards, and Raid Victory Caches; incoming items and GP aggregate until whole stacks can be claimed into the Bank. Transfers now presents Inbox, Outbox, and Pending side by side on desktop and as three switchable tabs on mobile.
- Added confirmation popups before donating to the Charitree, sending counteroffers, or canceling or declining Gifts and Trade offers.
- Preserved 1.4.5 Economy Receipts, returned Gifts, resolved Trades, and Raid Victory Cache acknowledgements, including mixed-version Trade participants and recorded cross-player Marketplace recipients.
- Fixed nested-picker touch scrolling in iOS Safari for avatar, Guild creation, and Guild heraldry grids.
- Throttled foreground idle event and GP polling from about 20 seconds to at most three minutes; retained fast polling for pending exchanges, requests, applications, market completions, Chat unread state, and returns; suspended periodic event, GP, and Player Status work while backgrounded.
- Reduced Player Status writes by decoupling GP sampling, ignoring undisplayed action churn, flushing trailing activity, retrying with bounded backoff, and discarding stale-session responses.
- Renamed the sidebar labels to Charitree and Raid (preview); removed the inactive Raid preview badge while retaining the active badge.
- Updated Guildless sidebar state: hide Marketplace, Charitree, Campaign, and Raid; show a Guild onboarding badge; expose Trade and Gift only for unresolved exchanges or returned transfer inventory; recompute state after membership and exchange changes.
- Refined Guild roster presentation with larger game-mode artwork, compact activity icons, subdued language labels, current-player pinning, and relative recent-activity labels.
- Improved Guild member row spacing and hid the empty Trade / Gift inventory count.
- Added a red Trade / Gift sidebar count for gifts, trades, and returns that require player action.
- Added base-game, DLC, and Multiplayer pets to the avatar picker.
- Fixed Gift rejection blocking Guild departure while the returned Gift remained unclaimed.
- Fixed failed Trade offers closing without displaying the server error.
- Fixed overlapping Trade and Gift responses reapplying an acknowledged Economy Receipt and blocking the transfer.
- Reduced Transfer Inventory capacity to six slots; existing larger inventories remain visible but cannot accept new entries until space is freed.
- Redesigned Transfers with Inbox, Outbox, and Pending panels on desktop and three switchable tabs on mobile; hid the unused potions menu on Multiplayer pages.

## 1.4.5

- Moved the Multiplayer sidebar section after Bank and before Into the Abyss.
- Added private Marketplace activity for completed purchases and buy-order fulfillments; personalized entries include item names and quantities, are lock-marked, and retain item IDs.
- Added the Updates page with server-fetched developer notices, current work, and future plans alongside the mod.io changelog.
- Renamed Player Profile's Status control to Skills.
- Added background-collected Guild member Account Age and Total Skill Level with localized formatting.
- Fixed mobile Guild Activity pagination controls rendering outside the activity list.
- Added independently revocable installation credentials with per-installation session replacement and legacy enrollment compatibility.
- Added bounded connection diagnostics and copyable reports with request outcomes, runtime labels, and optional app build metadata; excluded IPs, raw user agents, device names, credentials, and request bodies.
- Relaxed server CORS to accept browser/native-app origins and runtime-added request headers while retaining authentication and Guild authorization.

## 1.4.4

- Fixed mobile side navigation remaining open after automatic Multiplayer page changes.
- Repaired malformed or invalid Campaign rewards, delivered affected rewards once, rounded new rewards to whole GP, and prevented malformed receipts from masking active Campaigns.

## 1.4.3

- Removed acknowledged Marketplace and economy receipts from character storage, including legacy receipt IDs, while preserving acknowledgement retry safety.

## 1.4.2

- Added optimized fallback icons for Invention, Profile, Enchanting, Necromancy, Adventuring, Shamanism, and Thuum; reduced existing custom skill PNG sizes.
- Added a collapsed-navigation badge mirroring the shared unread Chat count.
- Added first-message Support Chat intent choices that prefill the composer without overwriting a saved draft.
- Added Recent Marketplace sorting by publish date while retaining direction-specific Price sorting.
- Added Max-quantity controls to Marketplace purchase, Marketplace fulfillment, and Campaign contribution modals.
- Improved Marketplace buy-order fulfillment modal layout with a two-line title, bank quantity indicator, and bank-aware limit.
- Added Marketplace fulfillment notices listing items and quantities added to the bank.
- Fixed Marketplace pagination controls appearing when all results fit on one page.

## 1.4.1

- Added prepaid Guild Marketplace buy orders with partial or full fulfillment at a fixed unit price.
- Added separate Marketplace buying and selling views, buy-order creation, direct Bank fulfillment, and escrow/refund controls.
- Fixed buy-order escrow and requested quantities during identity deletion; returned prepaid GP without creating items.

## 1.4.0

- Bundled Archaeology, Music, Occultism, Construction, and Sailing icons for cross-profile activity and skill rendering.
- Ordered Guild discovery as Free Fellowship, joinable Guilds, and applyable Guilds by recent member activity; hid Shadowed Guilds.
- Added a 48-hour New Member roster badge.
- Added sidebar status indicators for Charitree picks and active Guild Raids.
- Restricted Guild Raid participant lists to members with an Assault, including in-progress Tier 0 Assaults.
- Added localized, paginated Guild Activity for membership, Charitree, Raid, Marketplace, Petition, and Campaign events with noisy-action throttling.
- Added concurrent Player Status activity sharing: rosters show up to three activities plus an overflow count, while profiles show the full set.
- Expanded avatars to monsters and pickpocketing targets from the base game and official DLCs, using display-name search.
- Expanded Guild icons to official combat locations from the base game and official DLCs.
- Added bounded collection of custom skill icons from Player Status; excluded official, action, and combat icons.
- Added latest reported player-language collection; hide unknown and unavailable values.
- Fixed Guild rosters remaining stale after the current player's display name or avatar changed.
- Contained long Guild member and activity lists and tightened desktop/mobile spacing.

## 1.3.4

- Added an SAE Support Team channel gated by SUPER AWESOME EXPANSION state, with a separate identity/icon and retained history.

## 1.3.3

- Added Simplified Chinese (`zh-CN`) localization with English fallback for unsupported languages.

## 1.3.2

- Fixed Multiplayer localization coverage for navigation, settings, placeholders, Raid status, tooltips, and accessibility labels.
- Fixed Active Mods two-digit numbering clipping at larger interface scales.
- Fixed failed Gift sends omitting the pending-Gift warning.
- Fixed Marketplace purchases logging a slider teardown error after completion.

## 1.3.1

- Fixed Guild roster refresh errors and `/undefined` requests for hidden or unsupported Guildmate game modes.

## 1.3.0

- Moved completed Campaign history, medals, pet progress, and unclaimed rewards with the multiplayer identity; kept unfinished contributions with their original Guild and withheld historical rewards from new members.
- Added per-load compatibility diagnostics for Multiplayer version, character game-mode ID, and loaded mod names; retained only the latest identity snapshot and excluded disabled mods, other-mod metadata, profile names, and history.
- Added opt-out game-mode sharing with base-mode icons, custom-mode fallback labels, and snapshot retention after opt-out.
- Added opt-out active-mod sharing with reported-order preservation and empty-list suppression.
- Reworked Guildmate details with activity in the first modal, an uncapped mobile-scrolling Skills and Equipment grid, and compact game-mode roster icons.
- Added privacy-aware profile self-preview and consolidated Guild departure and identity deletion controls.
- Added a non-blocking notice when the server reports a newer released mod version.

## 1.2.0

- Fixed duplicate Trade returns after cancelling a new Trade.
- Restricted linked-identity and Support Team access; identity deletion must originate from the loaded save and team access requires operator-selected authenticated identities.
- Escaped multiplayer display names in HTML contexts and limited new names to letters, numbers, spaces, and simple punctuation.
- Added retry-safe item/GP mutation handling for Marketplace, Campaign, Charitree, Gift, and Trade operations, preventing loss, duplication, and stale overwrites.
- Fixed duplicate Transfer Inventory returns after reload.
- Fixed repeated application of Banishment returns after full Transfer Inventory retries.
- Fixed stalled requests stopping event, Chat, and page refreshes until reload.
- Fixed stale Support Chat messages and read state.
- Fixed reciprocal Friend Requests creating duplicate Friends entries.
- Fixed Gifts and Trades resolved in another tab/session remaining visible.
- Added permanent discard for returned Gifts containing items from unavailable mods.
- Fixed stale Marketplace results during rapid filter, sort, and page changes; kept filtering responsive as listings grow.
- Fixed Chat drafts or newly opened conversations being replaced during rapid conversation changes.
- Fixed Guild Raid settlement deleting a newer pending result.
- Fixed Charitree pet chance calculation: start at 0.1%, scale with donation value, cap at 10%.
- Fixed repeated item/GP slider modals retaining background input listeners.
- Fixed Charitree expiry processing continuing after leaving the page.
- Improved Personal and Support Chat inbox loading for growing histories.
- Fixed the 32nd distinct Transfer Inventory entry being rejected; aligned Gifts, Trades, and Charitree donation limits.

## 1.1.1

- Reordered Chat categories with the current Guild conversation first.
- Sorted Guild members by recent Multiplayer activity and hid View Shadowed Members when no Shadowed members exist.

## 1.1.0

- Split Chat into Personal, Guild, and Support sections with shared unread state; added persistent Guild Chat tied to current Guild membership and optional participation.

## 1.0.0

- Fixed Charitree next-offering text placement on desktop and mobile.

## 0.1.0-public-test.25

- Added Shadowed membership after seven days of Multiplayer inactivity and Petition of Winnowing for persistent Shadowed members.
- Fixed Chat Send button alignment after Message capacity changes.
- Namespaced Transfer Inventory, reward/return tracking, Charitree cooldowns, Banishment notices, and pending Raid results by server origin.

## 0.1.0-public-test.24

- Added Petition of Fellowship and Petition of Enclosure for Guild gate control, including open-Guild direct joins and a 24-hour Charitree delay for newcomers.
- Removed Message capacity and its send restriction while retaining request limits, privacy, blocking, validation, and moderation.
- Fixed Alt. Magic appearing as combat in shared Player Status.
- Fixed shared Player Status skill scrolling on iOS.

## 0.1.0-public-test.23

- Added persistent Multiplayer Mod Team Support Chat with automated welcome, shared replies, independent unread state, and Guildless access.
- Kept new private Chats as drafts until their first Message.
- Made the Multiplayer sidebar collapsible and moved Raids to the end of the section.
- Added Melvor item tooltips to Marketplace icons.
- Fixed iOS scrolling for shared skill profiles, prevented shared equipment dragging, and replaced the Charitree new-item animation with a static highlight.

## 0.1.0-public-test.22

- Standardized Guild emblem terminology in Council petitions, creation, and Heraldry flows.
- Migrated published builds to a permanent release storage namespace without replacing existing identities.

## 0.1.0-public-test.21

- Fixed GP visibility crashes for unavailable snapshots.
- Fixed Guild departure breaking the Guild page or leaving modal effects subscribed to Guild state.

## 0.1.0-public-test.20

- Added opt-out GP sharing and coarse last-seen activity to Guild rosters with viewer-local number formatting.
- Added combat-icon fallback for shared activities from unavailable mods.
- Fixed modal reliability by mounting content after custom-element attachment.

## 0.1.0-public-test.19

- Added four-day Charitree expiry, high-value/undiscovered-item safeguards, and single-item first-discovery handling.
- Added Guild Council Charitree petitions to clear donations, fell the tree, or restore an empty tree; hid disabled Charitrees and blocked donations.
- Grouped linked identities by Melvor Cloud username and PlayFab ID, preserving the first observed username and individual character identities.
- Moved Multiplayer controls and status indicators into Melvor's account dropdown.

## 0.1.0-public-test.17

- Reduced background traffic with revision-aware polling, foreground-only refreshes, and request deduplication while retaining timely Chat updates.
- Bypassed cached authenticated Multiplayer reads in Android WebView.
- Fixed stale Guild state after departure or identity switching.

## 0.1.0-public-test.16

- Added Raid boss resistance windows: 99% Normal resistance initially, reduced to 33% for six seconds after each attack, with refresh on repeated attacks.
- Replaced Raid placeholder artwork with plant-themed artwork.
- Allowed `Cache-Control` and `Pragma` on authenticated CORS preflight requests.

## 0.1.0-public-test.15

- Added Guild Raids for Private Guilds and Free Fellowship with 72-hour encounters, four tiers, bounded Assaults, native material loot, standings, Victory Caches, full-HP entry, Tier 1 Toxic Dread, and reload-safe recovery.
- Added sidebar indicators for unread Chat and Raid readiness/activity.
- Added Cartography map recognition to Player Status.
- Fixed invalid Campaign Small and Medium Urn references and migrated affected state.
- Prevented stale browser/WebView caches from restoring authenticated Multiplayer reads.
- Prevented delayed responses from rendering another identity's Guild state during departure or identity switching.

## 0.1.0-public-test.14

- Linked Multiplayer identities by Melvor Cloud username and PlayFab ID and added sibling-save management under Options.
- Added reversible identity deletion with a 72-hour delay, cleanup of sessions/activity, and return of held assets through Multiplayer storage.
- Added automatic recovery for a previously deleted identity as Guildless without restoring cancelled listings, transfers, or hidden Chats.
- Created a separate Multiplayer identity when loading a save under a different Melvor Cloud account.

## 0.1.0-public-test.13

- Added namespaced modded-item support for Marketplace and Charitree, with active-profile resolution, filtering, and pagination.
- Added recovery for unavailable modded items: unavailable listings can be destroyed after proceeds are paid, remaining stock moves to destroy-only Transfer Inventory, and incoming Gifts are returned where possible.

## 0.1.0-public-test.12

- Added opt-in Player Status sharing for skill levels and current activity.
- Added private Guildmate Chat with unread state, history, blocking, privacy controls, deletion, and replenishing message capacity; retained Chats across Guild changes.

## 0.1.0-public-test.11

- Added the permanent server-wide Free Fellowship Guild with direct joining.
- Added opt-in read-only Guild equipment sharing.
- Added search and pagination to Guild member selection for Gifts and Trades.
- Consolidated display name, avatar, equipment visibility, and Guild departure controls under Options.
- Added independent backend deployment versioning.

## 0.1.0-public-test.10

- Rebuilt the server on Bun and SQLite with containerized startup, health checks, backups, and automated tests.
- Isolated Trades, Gifts, Marketplaces, Charitree inventories, and Campaigns by Guild.
- Added Guild creation, discovery, applications, membership, departure, dissolution, and equal-member decisions.
- Added Council petitions and ballots for Guild naming, heraldry, and member banishment.
- Scaled Campaign goals by Guild size and capped automatic progress.
- Added custom Multiplayer display names, avatars, Guild icons, and per-server character identities.
- Added custom HTTPS server selection with loopback HTTP support for development.
- Improved refresh, transfer recovery, concurrency, authentication, request limits, numeric boundaries, and restart persistence.
