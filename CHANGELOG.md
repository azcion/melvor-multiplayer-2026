# Changelog

## 1.6.15

- Added standalone Multiplayer Chat at https://melvor.azcn.io/chat. Link each character with a one-use code from Options → Browser Chat, manage linked browsers in a dedicated dialog, switch between linked characters, and return without loading Melvor. Chat keeps a split-pane inbox with in-game styling, character avatars, item and feature tags, reactions, and per-conversation English or Chinese translation across Global, Guild, Private and Support groups. Message actions open from timestamps; desktop Enter sends and Shift+Enter adds a newline, while mobile uses Send. Browser access is limited to Chat and can be revoked for each character.
- Missing or rejected profile credentials now offer **Connect existing profile** or an explicitly confirmed **Create new profile** choice, preventing silent duplicate profiles. Multiplayer Options includes a private Recovery code to reconnect on another device or keep as a backup.
- New profile creation safely retries interrupted requests and requires saved credentials before contacting the server. Self-hosters must update the backend before creating profiles with this client; existing profiles can still connect to older compatible servers.

## 1.6.14

- Added localized Listing Filters in Multiplayer Settings to hide Sell Listings and Crucible offerings by cheat-category badge, with Item Cheats selected initially. Every account receives a one-time prompt after startup dialogs to review these filters. Mixed Crucible stacks show and reclaim only unfiltered contributions; Buy Orders, Wishes and direct trades remain available.
- Reduced loading delays and request traffic across Chat, Guild, Transfers, Crucible and Expedition. Visible pages take priority, Transfers history loads when expanded, and optional startup reads are deferred.
- Added a local Loading report in Mod Settings with queue, cache, request and page timings.
- Backend changes remain compatible with version 1.6.13.

## 1.6.13

- Expanded member search to shared gamemodes, mods and developer badges, with SAE and OSRS shortcuts and tags showing why each result matched.
- Added a pink OSRS Overhaul Dev badge to Guild rosters, applicants and Chat feature tags, with per-character visibility controls. Developer badge labels can now be renamed by the server host.
- Added New Member, developer, cheat-category, Social Only, Aye and Nay badges to the $Feature Chat picker, with localized, copyable labels and readable text for older clients.
- Added player-detail and roster icons for Hardcore and Mediumcore Combat Only (including Rebalance variants), Randomized Adventure, Taskman, Phoenix Adventure and Phoenix Birthday, even without those mods installed. Other installed custom gamemodes can use their registered icons in player details.

## 1.6.12

- Restored Guild names in player modals opened from the Guild roster or Chat for members of your Guild.
- Opened View Reactions and Show Seen to everyone for Messages they can access, showing who reacted or acknowledged reading. Poll response details and moderation remain admin-only.
- Added six mod-detection badges to Guild members and applicants: Time Cheats, Item Cheats, Resource Cheats, Multitasking, Shop Cheats and Loot Cheats. Each shows supporting mods, report age and expiry. Interdict and Heresy apply only to Item Cheats, using a reviewed nine-mod set that adds X Auto Manger and Requirement Filler and excludes God Mode. Existing reports are re-evaluated without extending expiry; other categories are informational.
- Added shared discussions for new Alliance proposals, open to participating Guild members, including newcomers during deliberation. Named votes appear after voting or resolution; participating Guilds retain access after closure. Existing proposals keep their Guild-only history. Petition discussions show unread and mention badges, excluding automated Aye/Nay Messages.
- Closing the shared Marketplace, proposing another Guild’s removal, and proposing your Guild’s departure now require an additional confirmation with a reason of at least 10 characters, posted beneath the proposal in its discussion.
- Fixed Go to Discussion opening the previous Chat conversation.
- Fixed Council history repeatedly requesting dissolved Guilds; opening an unavailable Guild now explains that it no longer exists.
- Shared Marketplace policy now opens its disable confirmation from the existing Enabled badge instead of a separate proposal button. The enable button remains available while Disabled.

## 1.6.11

- Set the minimum supported client version to 1.6.11.
- Fixed chat profiles showing your own settings when viewing another player while guildless; shared Skills & Equipment are accessible across Guilds.
- Older-save review findings no longer block new multiplayer economy actions after correction; original evidence and reversed-command protections remain intact.
- Limited older-save clock recovery storage to the current load while preserving pending economy commands.
- Removed verified duplicate legacy Creator Toolkit identity data while preserving conflicts and recovery data.
- Changed Wish creation to cost EP based on quantity and base capacity, with progressively priced +100-item increments, prorated partial increments, rounding up to 0.001 EP, and a 1000-item limit. Creation also contributes half the full funding requirement in GP, rounded up, to Crucible Offerings without advancing the Wish. The payer’s account cannot reclaim GP from that Guild for four hours. Neither cost is refunded on cancellation. Make a Wish now separates creation costs from Meld funding and explains excess-item pricing.
- Added character-specific 30-day Wish capacity upgrades from 100 to 500 items, with incremental pricing and optional auto-renewal that pauses when EP is insufficient. Active tiers cannot be re-bought or downgraded before expiry; renewal settings can be changed without charge. Confirmation shows costs, capacity and expiry.

## 1.6.10

- Added Guild petition discussions with proposal details, replies, reactions and separate unread counts. Named Aye/Nay Messages follow tally visibility rules; discussions remain available after closure. Hosts can hide creator attribution.
- Limited Free Fellowship Petitions to 36 hours, even when votes refresh their activity.
- Added a Mod Conflict warning on each character load when Melvor Multiplayer or [Galy] Melvor Multiplayer Fixes is loaded, listing the mods to disable.
- Identified loaded mods by mod.io ID where available, with name fallback for local imports and older clients, improving cheat recognition and partner Support Chat eligibility.
- Added older-save detection and economy recovery safeguards, with an informational notice. Opted-in servers can mark attributable remaining value while preserving settled transfers, issued claims and original history.
- Completed owned Marketplace listings are now hidden once no quantity remains available or reserved and any seller payout has been collected.
- Alliance proposals retain their original voting Guilds and majority when membership changes. Eligible leave and removal proposals are available from Guild previews opened through the Member Guilds pane.

## 1.6.9

- Expanded $Feature Chat tags with Alt. Magic using Magic’s icon, plus lowercase alliance, alliance member guild, guild member, petition, policy, buy order, sell listing, trade, gift, wish, haggle, and chamber tags without icons. Tag labels are localized in all supported languages.
- Restyled Chat and Updates to match Expedition and Crucible. Chat controls stay visible while scrolling, and the changelog has more room on desktop.
- Removed retired Charitree code and assets. Existing pets remain available.
- Expedition work reports now show the retry banner only after five seconds or a failed submission, keeping normal check-ins quiet apart from their existing notification.
- Added Manual, Prompt, and Automatic Expedition work tracking modes. Automatic tracking prioritizes Required tasks, then the most remaining earnable EP, with the usual in-game tracking notification.
- Fixed Expedition Magic requirements and tracking to match the active Magic skill, including existing runs and 1.6.8 clients through backend compatibility.
- Transfers history now shows both sides of Marketplace purchases and Buy Order fulfillments together: exchanged items beside outgoing payments and incoming proceeds, and the amount paid beside incoming items. Outgoing exchange entries show the player directly.
- Fixed Crucible Offering locks to show whenever no quantity can be reclaimed, including insufficient currency balance, reclaim cooldowns, and a sealed Crucible.
- Improved Chinese localization: Simplified Chinese Chat uses scoped terminology for plain-text Bank Slot Tokens and explicit Guild/group members, and Chinese Multiplayer currency displays use 金币/金幣 without a GP abbreviation. Typed Chat links, mod titles, and amounts remain preserved.
- Added @Person Chat tags with avatars, clickable profiles and a searchable picker that prioritizes recent speakers and active Guild members. Mentions highlight Messages and show a magenta @ in navigation and previews. Supports @ and ＠; excludes Shadowed players and self-tagging.

## 1.6.8

- Council Petitions now decide from cast Aye/Nay votes when voting closes, including in-progress Petitions. Their bars show cast-vote proportions, a midpoint notch, and a remaining-time countdown. Guild-cast Alliance decisions retain their majority requirement.
- Shortened the Crucible Slag-clearing description in every language.
- Disabled Buy Order Haggle and Sell actions when no matching items are owned, and allowed direct fulfillment of orders that disable Haggles.
- Expanded admin Chat actions with Delete for Everyone across all chats, reaction details, and read acknowledgements.
- Added Last Active to admin character profile details.
- Moved Add Options and Delete Poll to timestamp actions and added admin response details.

## 1.6.7

- Crucible Offering tiles show per-player reclaim locks in the bottom-right corner, clear of contributor avatars.
- Moved all Guild Raids to a shared weekend schedule: Friday 12:00 UTC–Monday 12:00 UTC, with Assault grants at noon UTC on Friday, Saturday and Sunday. Each character enters once per cycle; entry does not extend the deadline. The page shows local times, countdowns and active results, then the next start time. Existing Raids finish normally; interrupted Assaults and lost responses can recover without expired reservations blocking new attempts.

## 1.6.6

- Redesigned Sell on Market with quantity shortcuts, GP/SC/AP/ASC pricing, optional Alliance prices, per-player limits, Haggle controls and live totals. Unlimited purchases and Haggles start enabled; payments and refunds use the listing currency. Existing listings and 1.6.5 clients remain compatible.
- New Council votes lock an equal Aye/Nay requirement from the four-day active-member count. Any current Guild member can vote after 20 hours in the Guild, including returning players and later joiners. The first side to reach the requirement decides the vote; tallies remain hidden until voting.
- Extended Council Petition expiry to 48 hours after the last ballot and Alliance proposal expiry to 96 hours after the last ballot.
- Redesigned the Heat card with an animated melting heap, hotter colors and glow, and a collapsible level guide highlighting the current level. Heat and Meld speed remain visible when collapsed.
- Reduced API traffic when navigating Transfers and Guild, coalesced repeated refreshes, and prioritized commands and delivery acknowledgements over optional reads. Clients now pace requests and respect server throttling cooldowns.
- Fixed transient Crucible refresh failures freezing Chat and other Multiplayer pages until a reload. Startup and page reads now recover from overlapping refresh invalidation.

## 1.6.5

- Fixed mobile scrolling in Alliance pickers, Guild previews, proposal confirmations, Council heraldry and banishment pickers, and Expedition work prompts by matching the avatar picker’s native scrolling behavior.

## 1.6.4

- Fixed vertical scrolling in Alliance pickers, Guild previews, and proposal confirmation modals on mobile, keeping their action buttons accessible.

## 1.6.3

- Fixed declining Trade counteroffers, including empty counteroffers, returning each player’s offered items safely.
- Made the Guild roster’s Using Cheats badge clickable, showing recognized item-spawning mods detected in the past seven days and the latest detection age in whole days and hours, regardless of Mods privacy.
- Scoped active Crucible Wishes and Slag-clearing bonuses per account, per Guild. Accounts with a positive existing Slag bonus receive a fresh 48-hour maximum in each Guild containing an active character.
- Restored Crucible sidebar badges: wish for your claimable Wish, otherwise reclaim when an offering can be reclaimed, with no Make Wish reminder.
- Moved Expedition passage choices and voting to the top of Journey on mobile, with a vote badge when an eligible player has an open vote they have not cast.
- Added host-controlled feature previews for Pending exchanges and Council Petitions without changing real exchanges or Guild decisions.
- Clarified in all supported languages that a Crucible Wish resets the Slag-clearing bonus to -10 and caps it at 10.
- Added personal Transfers history for the last 14 days, with item and currency amounts, source/destination details, and five entries per page. Older history remains stored; Charitree actions and Bank/Outbox movements are excluded.
- Restyled Guild into Guild, Council and Alliance columns, with mobile tabs, applicant and vote badges, a bounded Activity list and collapsed Petition History.
- Restyled Transfers to match Expedition and Crucible, with collapsible Inbox/Outbox/Pending panes, compact item grids, clearer exchange totals and keyboard-accessible Outbox selection.
- Changed the button on fully fulfilled My Buy Orders from Cancel to an info-colored Remove button.

## 1.6.2

- Added admin-only Account Name as the first entry in Guild and Chat member details, using the stored PlayFab account name.
- Opened the Expedition preview, Chat and reactions to all Guild members, including Social Only players. Version 1.6.1 retains tester-only participation; the preview route remains fixed.
- Reduced the mod download size by hosting Raid boss and Expedition artwork separately. Self-hosted builds retain bundled artwork by default and can configure their own asset host. Resized and compressed the Crucible navigation image.
- Changed new Council Petitions to use members active within four days and expire 24 hours after the last ballot. Petitioners can withdraw only before another member votes; existing Petitions retain their rules. Opened a limited Free Fellowship Council for Interdict/Heresy, Temperance/Indulgence and Winnowing on 1.6.2+ clients.
- Set the minimum supported client version to 1.6.1; 1.6.1 retains existing Guild features.
- Added drifting crystal motes and softly shimmering crystal facets to Prismatic Descent in the Expedition preview, with reduced-motion support.
- Changed Expedition work credit to award verified activity time up to the work remaining when tracking starts, even if another player finishes the task before Check In. Check Ins carry the unused allowance forward, and Chamber departure and membership boundaries still apply.
- Added automatic Expedition Check Ins every 10 minutes while online, keeping shared task progress current without opening the Expedition page.

## 1.6.1

- Added a brief Expedition modal when task tracking stops, including activity changes, task switches, and completed tasks, and active tracked skill icons beside Expedition in the sidebar.
- Fixed Raid bosses to start at 95% damage reduction, falling one percentage point per six tier defeats by current non-Shadowed Guild members, to a 75% floor at 120 defeats. Vulnerable phases remain at 33%. Localized Raid text and standardized combat-effect icons.
- Added Raid boss info and Drops popups showing encounter stats, special attacks with consistent effect icons in previews and combat, damage-reduction phases, and reward quantities and odds, with items delivered to the Inbox.
- Changed the button on fully sold-out My Sell Listings from Cancel to an info-colored Remove button.

## 1.6.0

- Added a tester Expedition preview with shared Chamber work, supply donations, passage votes and Journey history along a fixed route from The Rift to The Hollow Star. All 1.6.0 players can read Expedition Chat; sending and reactions are reserved for testers.
- Replaced Charitree with the Crucible: merged Offerings, Guild-wide Heat that speeds Melds, Wishes funded by Melded value, Weird Gloop, Reclaim, Slag clearing and Council petitions, localized in every supported language.
- Removed the Campaign page and client actions while preserving Campaign pets and icon options; retained Campaign state and legacy API access for supported 1.5.16 clients.
- Kept partially filled and sold-out Marketplace listings visible with remaining/original quantities and a Show Available filter. Sold-out listings expire after 20 hours unless held by an active Haggle; 1.5.16 clients retain their existing view.
- Fixed repeated errors when opening Transfers with an active Marketplace Haggle that has no claim yet.
- Expanded Guild Raids with uncapped personal contribution, Assault countdowns, per-character tier unlocks, immediate Inbox rewards and full-HP entry confirmation. Lifetime defeat totals appear on members and tier cards; current non-Shadowed members’ tier wins reduce initial boss resistance from 99% toward 75%.
- Added unread Message counts to Poll Discussions without adding them to Chat navigation totals.
- Added clickable Chat feature tags through $ or ＄, with icons for Multiplayer pages, Melvor skills, Combat, Bank, and Shop; the picker follows sidebar order, and older clients see readable feature names.
- Added account-wide Dev and SAE Dev Guild roster badges with character-level visibility controls.
- Added account-wide Chat shadowbans and moderator observer access, and let configured admins view hidden active-mod lists through the shared admin identity list used for Chat and Poll management.
- Set the minimum supported client version to 1.5.16, including clients with missing or invalid version reports.

## 1.5.16

- Added Petition of Temperance and Petition of Indulgence, allowing Guilds to require members to discover items before creating Buy Orders or buying from Sell Listings, or restore unrestricted Marketplace trading.
- Fixed accepting a Marketplace Haggle locking up other Multiplayer UI actions.
- Made Charitree Wish timing permanent: Wishes mature in 20 hours, and offerings decay in 20 hours while a Maturing or Ripening Wish is active instead of the standard four days.
- Expanded the Chat reaction picker to four rows, keeping the original 18 reactions and adding six randomized Unicode 16.0 emoji on each open.

## 1.5.15

- Made Chat item tags clickable, with quick actions to open the item's Melvor Wiki page or find its Sell Listings and Buy Orders in the Marketplace.
- Fixed reactions in Poll Discussions failing with a request error.

## 1.5.14

- Added Single Choice and Multi-Choice Polls with Open/Closed indicators and moderator voting controls. Reactions remain in Poll Discussions; removed card reactions and notification bells.
- Fixed Chat opening briefly showing the oldest loaded Messages before moving to the latest Messages.
- Added automatic translation of Poll questions and options in the selected Chat translation language, including backfill for existing Polls and refresh after translation completes.

## 1.5.13

- Fixed the Chat item tag picker so its item list scrolls correctly on mobile.
- Fixed duplicate items appearing in the Chat item tag picker when marketplace and recently selected categories overlap.

## 1.5.12

- Added a Charitree Filter Wishes toggle beside Make a Wish to show only your own Wishes.
- Added current owned item quantities beside Available sell listings and Requested buy orders in the Marketplace.
- Added inline Chat item tags with an Insert Item picker and # shortcut for base-game and official DLC items. Item names appear in each reader’s game language and stay intact during whole-message translation.
- Added per-chat notification bell toggles, enabled by default, to exclude muted chats from navigation unread badges while keeping their inline unread counts.
- Fixed automatic Chat translation updates remaining hidden in an open conversation after the initial translation wait elapsed.
- Improved Chat translation controls with an explicit Apply action and prevented the language picker opening automatically on mobile.

## 1.5.11

- Localized Support Chat welcomes in every supported language while retaining English in shared history.
- Added optional per-conversation automatic Chat translation between English and Simplified Chinese, plus a Translate action for individual incoming Messages.
- Added localization for every game language and corrected Simplified Chinese.
- Reworked Guild icon and player avatar pickers with consistent Multiplayer-owned layouts, including larger, centered Guild emblem tiles.
- Kept Shadowed members available as targets in the Petition for Banishment picker.
- Restructured Guild discovery to match the Guildmates list, with compact emblems, Open or Private tags, clearer localized member counts, and distinct Apply styling for private Guilds.

## 1.5.10

- Added a persistent Using Cheats Guild-roster badge when a character reported a recognized cheat mod within the last seven days.
- Added Petition of Interdict and Petition of Heresy, allowing Guild Councils to confine members marked Using Cheats to Social Only or restore their full access.
- Added an in-game update notice for already-running sessions, prompting players to refresh or restart after a newer Multiplayer version becomes available.
- Added server-wide Polls below Global Chat, with authorized creation, multi-select voting, append-only options, reactions and a permanent discussion for each Poll.
- Made Chat profiles honor cross-Guild sharing settings for Private Chat, equipment, Skills, gamemode, mods, language, Account Age and Total Skill Level. Current activity remains private; profiles also show the sender’s Guild.

## 1.5.9

- Added Chat reactions with an 18-emoji picker, counts and highlighted personal selections. Players can add multiple reactions, including to their own Messages.
- Unified Campaign and Raid participation scaling around 40% of Guild members active within four days, with one expected contributor for solo Guilds, a two-player minimum otherwise, and no upper ceiling.
- Reduced Campaign goals from twelve to four hours of estimated production per expected contributor and replaced aggressive upward rounding with nearest-increment rounding.
- Hid avatar and Guild icon choices whose registered media is the native question-mark placeholder while preserving existing saved choices.
- Replaced the Guild summary label with days since establishment, using creation timestamps for new Guilds and historical evidence where available for existing Guilds.
- Allowed quantity controls to be cleared while entering a value instead of forcing the minimum back into the field.

## 1.5.8

- Added a Max action to Shuffle Leaves, showing currency totals and filling the remaining Shuffle Bonus to 20 / 20 with one payment. Confirmations stay open with a loader for at least two seconds to prevent repeated submissions.
- Fixed Chat sender profiles from other Guilds showing a Private Chat start action that could not succeed.
- Added clear client messaging when a server operator requires Social Only mode for an identity or its Melvor account, and hid the unavailable Full Experience choice while that restriction is active.
- Fixed Shuffle Leaves becoming unresponsive when its modal could not be queued during a modal lifecycle transition.

## 1.5.7

- Added Charitree Wishes for 1–100 discovered eligible items at no cost. After four days, decaying GP offerings ripen the Wish for its owner to pick into the Inbox. Progress is Guild-visible; forsaking and picking are owner-only. Wish limits and Shuffle Bonus penalties apply across linked characters, with settlement on departure or destructive Charitree Petitions.
- Restored official and Multiplayer pet icons in the avatar picker and existing avatars, and placed pets first in the picker.
- Capped per-request GP transfers and donations at 1 billion GP and other supported currencies at 1 million, including Charitree donations, Shuffle Leaves, Gifts, Trades, and Marketplace haggles; excess currency remains available in Transfer inventory.
- Fixed Max quantity selections being reset to one when a selected bank stack updates before a Transfer or Campaign contribution is submitted.

## 1.5.6

- Added Charitree decay recovery: expired offerings with GP value become Weird Gloop, which appears first and can be claimed or donated like any other offering without a timer or leaf cover.
- Added a one-time prompt after Multiplayer experience selection for players still using the default avatar, with the existing avatar picker ready for choosing a new icon.
- Replaced the inline bank Transfer and Marketplace panels with a single Multiplayer Actions entry for Transfer, Marketplace, and Charitree quantity actions.
- Made each Shuffle Leaves use reduce offering coverage by five percentage points for seven days, down to zero, across all linked characters, including undiscovered offerings.
- Grouped Inbox deliveries under source titles, aggregating repeated Marketplace counterparties and other matching events while retaining one Claim action for everything.
- Moved Marketplace sell proceeds into the Inbox automatically as purchases complete and removed manual payout claiming from Sell Listings.
- Marketplace listings now expire after 14 days without activity, returning remaining items or GP to the Inbox under “Expired Marketplace listing”.
- Fixed avatar-picker and display-name input modal outlines being clipped by SweetAlert's HTML-container overflow.

## 1.5.5

- Added Shuffle Leaves: offer the requested currency to stir Charitree leaves for your characters. The currency joins the tree and cannot be reclaimed by your characters for four hours.
- Moved updated clients to versioned multiplayer APIs while keeping existing 1.5.1–1.5.4 clients supported.
- Made pending item and GP transactions recover after lost responses and reloads without submitting the same transaction twice.
- Preserved automatic returns of unavailable Gift items across connection failures and reloads.
- Fixed incoming Gifts failing to appear when an unrelated Economy Receipt is waiting to apply.
- Prevented repeated Charitree donation confirmations from submitting the same donation twice.
- Fixed cleared player activities remaining visible to older clients.

## 1.5.4

- Increased Chat history pages from five to 20 messages while preserving older-history pagination.
- Made the Chat sidebar entry always open the Chat home list instead of reopening the last conversation.
- Added Global Chat for all multiplayer identities, including Guildless players, with history, unread counts and a default-on participation setting. Reordered Chat into Global, Guild, Private and Support. Hosts can moderate Global Chat and set server-wide or per-player message limits; delayed sends preserve drafts.
- Added clickable avatars and usernames to Chat Messages, opening the sender’s profile.
- Fixed Chat opening and sending to scroll to the newest messages, while loading older messages preserves the current viewport position.

## 1.5.3

- Moved Multiplayer pets out of Melvor's native Pets and Completion systems into server-owned, per-identity Multiplayer presentation.
- Recalculated Campaign pet ownership from four completed Campaigns and moved Campaign rewards to server-side 10x or 15x calculations.
- Reset Charitree pet ownership, moved future Charitree rolls server-side without a current bonus, and disabled the second daily take flow for updated clients.
- Combined GP, supported currency, and eligible zero-GP donation values client-side before sending Charitree donations.
- Applied Charitree claim limits to supported non-GP currencies using the donated currency’s balance, without treating currencies as undiscovered items.
- Changed Charitree claims to allow up to half the player’s current balance, with quantities shown before claiming. Undiscovered items remain limited to one, and claims do not count as discovery.
- Added leaf cover to Charitree offerings: undiscovered items are always hidden, and discovered non-currency items may be hidden. Cover becomes less likely and leaves change color as expiry approaches.
- Reduced the Charitree taking cooldown from 24 hours to 20 hours and the direct-join newcomer lock from 24 hours to 4 hours.

## 1.5.2

- Added Marketplace Haggles for reserved Buy and Sell listing quantities, alternating GP-per-item counteroffers, 72-hour offer expiry, fully escrowed acceptance, and source-labelled claims that move settled or returned value into the Transfers Inbox.
- Fixed Charitree donations of supported unmodded currencies, including Slayer Coins, being rejected as unavailable in the active mod profile.
- Fixed Guild member separators appearing too narrow and kept “Last seen” aligned when GP sharing is hidden.
- Improved Marketplace search-result column proportions.
- Fixed Chat and Free Fellowship pagination controls scrolling with their message and member lists.
- Fixed the active Raid sidebar badge disappearing after renaming the page to Raid (preview).
- Hid placeholder sidebar badges until their state is initialized, preventing colorful 0 and null badges during load.

## 1.5.1

- Fixed Inbox claims failing despite available Bank space, and added a warning when remaining items cannot be claimed.

## 1.5.0

- Added Social Only mode with per-character selection and settings. Social features and Raid combat remain available; Charitree, Marketplace, Trading, Gifting, Campaigns and Raid item rewards are disabled, with pending exchanges returned to the Inbox.
- Added a per-save new-version badge to Updates, clearing when Updates is viewed on desktop or Changelog is selected on mobile.
- Added Outbox currency transfers for Gold Pieces, Slayer Coins, Abyssal Pieces, and Abyssal Slayer Coins through a balance-aware Add Currency picker and quantity slider; non-GP currencies remain excluded from Transfer GP values.
- Expanded the server-owned Inbox to Gift and Trade settlements, Marketplace purchases, proceeds and returns, Charitree takes, Campaign GP rewards and Raid Victory Caches, with aggregated Bank claims and recovery for existing transfers. Redesigned Transfers with Inbox, Outbox and Pending panels on desktop and tabs on mobile.
- Added confirmation popups before donating to the Charitree, sending counteroffers, or canceling or declining Gifts and Trade offers.
- Fixed nested-picker touch scrolling in iOS Safari for avatar, Guild creation, and Guild heraldry grids.
- Reduced idle event and GP polling from about 20 seconds to at most three minutes, while retaining fast updates for pending actions and Chat. Suspended periodic polling in the background and reduced redundant Player Status updates.
- Renamed the sidebar labels to Charitree and Raid (preview); removed the inactive Raid preview badge while retaining the active badge.
- Updated Guildless sidebar state: hide Marketplace, Charitree, Campaign, and Raid; show a Guild onboarding badge; expose Trade and Gift only for unresolved exchanges or returned transfer inventory; recompute state after membership and exchange changes.
- Refined Guild rosters with larger gamemode artwork, compact activity icons, subdued language labels, current-player pinning, relative activity times and improved spacing.
- Hid the empty Trade / Gift inventory count.
- Added a red Trade / Gift sidebar count for gifts, trades, and returns that require player action.
- Added base-game, DLC, and Multiplayer pets to the avatar picker.
- Fixed Gift rejection blocking Guild departure while the returned Gift remained unclaimed.
- Fixed failed Trade offers closing without displaying the server error.
- Fixed overlapping Trade and Gift responses reapplying an acknowledged Economy Receipt and blocking the transfer.
- Reduced Transfer Inventory capacity to six slots; existing larger inventories remain visible but cannot accept new entries until space is freed.
- Hid the unused potions menu on Multiplayer pages.

## 1.4.5

- Moved the Multiplayer sidebar section after Bank and before Into the Abyss.
- Added private Marketplace activity for purchases and buy-order fulfillments, showing item names and quantities.
- Added the Updates page with server-fetched developer notices, current work, and future plans alongside the mod.io changelog.
- Renamed Player Profile's Status control to Skills.
- Added background-collected Guild member Account Age and Total Skill Level with localized formatting.
- Fixed mobile Guild Activity pagination controls rendering outside the activity list.
- Added independently revocable installation credentials with per-installation session replacement and legacy enrollment compatibility.
- Added copyable connection reports with request outcomes and runtime details, excluding credentials, request bodies and personal device/network details.
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
- Improved Marketplace fulfillment dialogs with clearer titles, Bank quantities and Bank-aware limits, plus notices listing delivered items.
- Fixed Marketplace pagination controls appearing when all results fit on one page.

## 1.4.1

- Added prepaid Guild Marketplace Buy Orders with fixed unit prices, partial or full fulfillment from the Bank, separate buying/selling views, and escrow/refund controls, including GP returns on identity deletion.

## 1.4.0

- Bundled Archaeology, Music, Occultism, Construction, and Sailing icons for cross-profile activity and skill rendering.
- Ordered Guild discovery as Free Fellowship, open Guilds and Guilds accepting applications, sorted by recent member activity; hid Shadowed Guilds.
- Added a 48-hour New Member roster badge.
- Added sidebar status indicators for Charitree picks and active Guild Raids.
- Restricted Guild Raid participant lists to members with an Assault, including in-progress Tier 0 Assaults.
- Added localized, paginated Guild Activity for membership, Charitree, Raid, Marketplace, Petition, and Campaign events with noisy-action throttling.
- Added concurrent Player Status activity sharing: rosters show up to three activities plus an overflow count, while profiles show the full set.
- Expanded avatars to monsters and pickpocketing targets from the base game and official DLCs, using display-name search.
- Expanded Guild icons to official combat locations from the base game and official DLCs.
- Added custom skill icons to shared Player Status.
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
- Added compatibility reports for client version, gamemode and loaded mods, retaining only the latest snapshot.
- Added opt-out gamemode and active-mod sharing, with base-mode icons and custom-mode fallback labels.
- Reworked Guildmate details with activity in the first modal, an uncapped mobile-scrolling Skills and Equipment grid, and compact game-mode roster icons.
- Added privacy-aware profile self-preview and consolidated Guild departure and identity deletion controls.
- Added a non-blocking notice when the server reports a newer released mod version.

## 1.2.0

- Fixed duplicate Trade, Transfer Inventory and Banishment returns after cancellation, reload or retries with a full inventory.
- Restricted linked-identity and Support Team access; identity deletion must originate from the loaded save and team access requires operator-selected authenticated identities.
- Escaped multiplayer display names in HTML contexts and limited new names to letters, numbers, spaces, and simple punctuation.
- Added retry-safe item/GP mutation handling for Marketplace, Campaign, Charitree, Gift, and Trade operations, preventing loss, duplication, and stale overwrites.
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
- Fixed modals failing to initialize their contents.

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

- Added Guild Raids for Private Guilds and Free Fellowship, with 72-hour encounters, four tiers, Assaults, standings, material loot and Victory Caches. Entry requires full HP; progress recovers after reload.
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
