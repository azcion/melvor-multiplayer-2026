# Colosseum — 1.7.0

The Multiplayer Colosseum page is a reward-free melee arena with permanently unlocked unlimited food and a separate Online
character. Native levels and equipment are not imported. Every Online skill starts at level 1, including Hitpoints;
each Hitpoints level grants 10 HP. Personal equipment projects unlock reusable Online gear. Online HP
starts full and remains separate from native HP. There is no XP, combat reward, equipment loss or offline combat.

Attack, Strength, Defence and Hitpoints can be purchased independently with EP within permanent skill caps.
Tutorial graduation opens Hitpoints cap 3 only; Attack, Strength and Defence stay at 1. Golbin tiers I, II
and III open ASDH caps 3, 6 and 9 respectively. Tidal Caverns then opens caps 12 and 15, with Herring access at its first boundary. Unlocks permit purchases; they grant no free levels or gear. Ranged and Magic
remain visible but disabled until their attack styles are implemented. A destination level costs `floor(level / 10) + 1`
EP: levels 2–9 cost 1 EP each, 10–19 cost 2, and so on through 90–99 at 10. Each compact skill row shows its native icon, name and current level / unlocked cap. Clicking + opens a centered levels-to-add
stepper, a current-to-target preview and the EP cost. The stepper is bounded by 1 and the remaining levels to its unlocked cap;
Cancel discards that skill’s pending upgrades and collapses its editor.
Each skill previews its cost across price bands; Confirm buys that skill, while Confirm all buys all pending upgrades
in one atomic command with a combined cost preview. The server recomputes that cost and checks the
character revision and balance. Purchases and resets use UUID command replay protection and cannot run during a fight.

Resetting all levels normally returns 90% of invested EP. If a banked free reset is available, the reset consumes
one and returns 100%; the confirmation shows the applicable fee and refund. An empty reset does not use a free reset.
Free reset grants are personal and can be banked before character creation. EP is displayed to two decimal
places. Desktop and mobile both open on Fighter, with PvP and Dungeons beside it. PvP stays locked;
Dungeons opens after completing or skipping the tutorial. Fighter hosts the current tutorial trial, Start Battle
and tutorial arena above preparation. Levels, Equipment and Consumables use three desktop columns and mounted
mobile tabs; food and equipment controls appear only after creating a fighter. Dungeons owns Golbin Horde,
Tidal Caverns, Sinking Mire and Cinder Quarry, with separate time leaderboards. Mobile Dungeons retains its
Dungeons, Selected and Leaderboard tabs. The arena omits post-combat summary, history, log and Food Policy cards. Its square toolbar controls use separated groups without dividers; the player portrait uses the Colosseum sidebar icon and zero-damage attacks display Miss. The food cooldown fills gray from the bottom, then fades over 100 ms.
Starting combat scrolls the visible page to the top, keeps its originating tab selected and locks the other tabs.
Only the active combat card remains visible until the run finishes, when setup and post-combat cards return
within the same tab.

Stab, Slash and Block use native localized names and can be selected before starting; their custom bonuses remain
+6 hidden Attack, Strength and Defence levels respectively, matching the official melee style data.
Ranged and magic fighting, runes, potions, prayer points, summoning and item effects are deferred. The reviewed Demo catalog supplies ordinary Bronze–Rune melee equipment and six arrow unlock projects; special-effect gear remains excluded.

Equipment access is purchased on Combat through the equipment grid. Slot, equip and project tiles open compact, animation-free modals with direct action labels. Slot borders and numeric badges show purchased material access independently of equipped gear; lock and upgrade markers remain at the bottom right. Slot pickers list permanently unlocked equipment from highest material to lowest, alongside the current material and separate Unlock slot or Upgrade material actions with EP costs. Item details show online offensive/defensive stats, skill requirements, additional occupied slots and project work. The Equipment Projects link sits below the grid and above unlocked items. General Combat description blocks and fixed respawn timing copy are omitted. The centered Equipment sets grid offers Melee and an inspectable Ranged tab; Magic stays locked. Ranged exposes Quiver preparation, with unfinished weapon and armor slots disabled. Access currently remains shared across the style views. Quiver appears only under Ranged; there is no separate Arrows access section. Equipment Projects remain in Expedition, alongside Chamber Tasks, even without a Guild, grouped as compact Weapons, Armor and Arrows icon grids. Projects appear only after their slot and material tier are open and the same item in the previous material is completed. Permanent unlocks fold into a compact details panel. Each equipment slot costs 1 EP to open. Its tiers unlock sequentially at 1 EP for Bronze, 2 for Iron, 3 for Steel,
4 for Mithril, 5 for Adamant and 6 for Rune. Beyond Bronze, a slot can advance only while a permanently unlocked item matching its current purchased material is equipped and meets Online level requirements. Discover an item in the current save before beginning its personal project.
The server defines projects from official Smithing recipes: gather the required ores, smelt the required bars, then
craft the item, normally with five minutes of work per required ingredient unit. The tutorial recipes (Bronze Sword,
Bronze Helmet, Bronze Shield and Iron Shield) instead take 45 seconds per ingredient unit, displayed as 0:45 for one
or 2:15 for three. These shorter definitions also apply after graduation. The Bronze Dagger retains its original
five minutes each of Copper and Tin Mining, Bronze Bar Smithing and Bronze Dagger Smithing. Native materials are consumed
and native products awarded by the game normally; the project makes no additional Bank deduction.

One task can be tracked across Chamber and equipment work. Tracking is automatic for 1.7.0 clients and prefers
matching personal work when selecting a new target. Cancelling an active project after confirmation discards its
progress and stops its tracking, without removing completed unlocks. Authorized administrators can use Equipment Projects → Test controls to complete one available task or the current project after stopping tracking. Each shortcut requires confirmation, uses a server-checked project/revision, and records an audit event. It grants no EP or native items and does not validate timed native work. Project-start discovery, access and predecessor requirements still apply. Completed native action-event intervals provide evidence. Mining, Smithing and Fletching require exact actions;
only the explicitly defined any-Woodcutting arrow task accepts every tree. Unrelated work earns nothing. Reports retain their original capture and
operation ID across retries, settle conservatively on missing/reset counters, and cap credit by elapsed time and
concurrent native work. Action counters are isolated by selected server and character. Offline work reports after the
native offline loop finishes; actual loaded-game acceptance remains a separate validation gate.

### Permanent arrow unlock projects

Bronze, Iron, Steel, Mithril, Adamant and Rune Arrows have a separate Quiver access track: 1 EP for the slot,
then sequential tiers costing 1–6 EP, with the same-family previous material and native item discovery required.
Quiver project access is available through the Ranged equipment tab. Higher Quiver tiers require equipping the current material, so remain blocked while arrow equipping is unavailable. Previously purchased higher access and existing projects remain intact. Completing a project permanently
unlocks unlimited arrows of that type for future Online Ranged use. There is no Bank quantity import, deposit,
withdrawal, escrow, per-shot depletion, additional material deduction or native item reward. Ordinary native
crafting still consumes and produces items normally. Food remains unchanged in this release.

The generator reads the official `?12097` Demo Smithing/item package and Full Fletching package; generated source
hashes and native recipe quantities are retained in `server/equipment-recipes-v1.json`. Regenerate with
`node scripts/build-equipment-recipes.mjs DEMO_JSON server/equipment-recipes-v1.json FULL_JSON`. The six recipes use one bar
for 15 arrowtips; 15 shafts plus 15 feathers make 15 headless arrows; 15 arrowtips plus 15 headless arrows make
15 finished arrows. Shafts use the native interchangeable log alternatives (one Normal Log yields 15 shafts).
There is no separate feather task or Bank check: native Headless Arrow Fletching is the work evidence.

| Tier | Native bar inputs | Bar | Total tracked work |
| --- | --- | --- | --- |
| Bronze | 1 Copper Ore + 1 Tin Ore | Bronze Bar | 110 minutes |
| Iron | 1 Iron Ore | Iron Bar | 105 minutes |
| Steel | 1 Iron Ore + 2 Coal Ore | Steel Bar | 115 minutes |
| Mithril | 1 Mithril Ore + 4 Coal Ore | Mithril Bar | 125 minutes |
| Adamant | 1 Adamantite Ore + 6 Coal Ore | Adamantite Bar | 135 minutes |
| Rune | 1 Runite Ore + 8 Coal Ore | Runite Bar | 145 minutes |

Each project has four stages. Tasks within a stage may be done in either order, but only one can be tracked:

1. Mine each required ore for **5 minutes per ingredient unit** (Coal: Steel 10, Mithril 20, Adamant 30, Rune 40 minutes), and perform **any Woodcutting for 5 minutes**.
2. Smith the native bar for **5 minutes**, and Fletch `melvorF:Arrow_Shafts` for **5 minutes**.
3. Smith that material's Arrowtips for **5 minutes**, and Fletch `melvorF:Headless_Arrows` for **5 minutes**.
4. Fletch that material's finished arrows (`melvorF:<Material>_Arrows`) for **75 minutes**.

Mining scales with native ingredient quantities. Other prerequisite tasks take five minutes each; final
Fletching uses 15 × 5 minutes. Native Woodcutting emits one interval for its set of
active trees, counted once per event. Exact Fletching recipe IDs use the `melvorF` namespace even where the product
item uses `melvorD`. Pending/offline reports and admin task/project completion reuse the existing shared tracker.
Arrow equipping and combat admission are explicitly disabled; these projects do not implement Ranged combat,
bows, armor or ammunition consumption. Backend 349 / schema 201 adds Quiver access while preserving existing slots,
projects and work evidence. Backend 350 corrects quantity-scaled arrow Mining targets. Deploy the matching backend before testing this client; no deployment is implied.

Personal project tasks never award EP, completion rewards, or Guild work. Finishing permanently unlocks that item;
equip or unequip it on Combat. Battleaxes use one hand; two-handed swords also occupy the Shield slot. Current Online levels determine usable gear, and unlocks survive level resets. Slot and
tier spending is separate from level investment and is not refunded by a level reset. A separate equipment-access reset
refunds 90% of purchased equipment slots and material tiers, or 100% using one free reset from the same banked pool as
level resets. It locks equipment slots and materials and unequips equipment, preserving food slots, Online levels, completed equipment
unlocks, current project progress and active work tracking. Current work can continue without access repurchases;
other projects require their slot/material and predecessor gates again. Permanently unlocked items need repurchased
slot/material access before equipping. The confirmation quotes invested EP, fee and refund and requires acknowledgement.
This reset and the equipped-material upgrade rule require backend 352 with a matching client. No deployment is implied. Backend 343 / schema 199 adds
private project tables without clearing shared EP, Expedition, identity, food custody, or existing Combat progression.

Food uses eight unlimited unlocks: Shrimp 30, Herring 50, Trout 70, Salmon 90, Lobster 110, Swordfish 130,
Crab 150 and Carp 180 HP. Each sequential tier costs 1 EP, including Shrimp; there is no separate slot charge.
Consumables enables the first food slot at 1 EP per tier. It must equip its
highest unlocked food before buying its next tier. The second food slot is temporarily locked in the client
and rejects new slot/tier purchases on the backend. Existing second-slot access remains refundable.
Two potion slots remain locked. Neutral slot tiles show tier numbers and eligible upgrade arrows; the shared
equipment picker and tier modal show best-first unlocked food, access and upgrade pricing.
Shrimp requires 45 seconds Fishing followed by 45 seconds actively Cooking. Other food projects require
30 minutes Fishing the specific raw fish, followed by 30 minutes actively Cooking that recipe. Native action intervals count, including
burns; production quantities, perfect products and doubling do not matter. Passive Cooking does not contribute.
Food uses the shared personal-project, single-tracking and offline-evidence lifecycle. Native action products
normalize Fishing/Cooking activity IDs to the same raw/cooked item IDs used by event evidence.

Select any completed food with purchased access, best to worst, or choose no food. Combat continues using only
the first food slot; the second remains unavailable. Admission freezes the
server-owned food ID and tier healing along with the build; client food, quantity and healing inputs are ignored.
Consumables has its own Reset all slots control, refunding only food access while preserving equipment slots.
Both card resets show their own investment, fee and refund and require separate confirmation. Free resets cross
out the ordinary 10% fee and return 100% instead of the paid 90%. Backend 359 adds scoped card reset commands.
Completed food projects and current work survive resets,
but access must be purchased again to select food. Native healing modifiers and Auto Eat upgrades do not apply.
Results and encounter history show times eaten. There are no deposits, withdrawals, quantities or incident refunds.
Backend 357/schema 203 discards test-era food balances and encounter history with the sole tester's authorization;
remaining food custody is retired to a terminal consumed location while preserving economy ancestry.
Backend 358/schema 204 preserves existing access and selection in food slot 1 and adds independent slot 2 access.

The Combat target picker defaults to a single Golbin. It also offers Golbin Scout, Mind Golbin, all three
Golbins together, six Plants. The former Mossbound boss encounter is retired. Selection locks during a fight;
results retain the encounter actually played. The server accepts only these encounter IDs before admitting combat.
Training enemies have no on-hit effects. Golbin/Scout/Mind Golbin have 20 HP and attack every 24/26/28 ticks;
Plants have 10 HP and attack every 100 ticks. Their Defence/Strength/Ranged/Magic/Attack/Hitpoints levels are
respectively 1/1/1/1/2/2, 3/1/3/1/1/2, 3/1/1/4/1/2 and 1/1/1/1/1/1. Melee and ranged training damage uses the native standard maximum-hit formula with zero equipment bonuses.
Mind Golbin retains an authored spell maximum of Magic + 9; spell selection and native magic damage are not implemented.
Training actors use their declared offensive levels for accuracy and Defence for melee evasion, with no equipment bonuses.
The ready handshake advertises supported encounters; omitted encounter selection defaults to a single Golbin.
The retired Mossbound encounter is rejected before admitting combat.

## Native melee foundation

The `native-melee-1` ruleset uses the official build `?12097` base melee calculations and Standard combat triangle.
Online EP progression remains independent. Summed ordinary equipment stats select the Stab, Slash or Block accuracy
bonus and contribute melee strength and attack-type-specific defence. Stab/Slash/Block add +6 hidden
Attack/Strength/Defence respectively; hidden bonuses can exceed the purchased level cap of 99.

- Accuracy and evasion rating: `(effective level + 9) * (equipment bonus + 64)`.
- Magic evasion uses `floor(0.3 * effective Defence + 0.7 * Magic)`; Online Magic remains 1 while disabled.
- With `L = effective Strength + 9` and `B = melee strength bonus`, base maximum hit is
  `floor(10 * (1.3 + L/10 + B/80 + L*B/640))`.
- Hit chance is `0.5 * accuracy/evasion` below equal ratings, otherwise `1 - 0.5 * evasion/accuracy`, bounded 0–1.
- Ordinary successful attacks roll an integer from 1 through the raw maximum. Player damage then receives the Standard
  triangle multiplier (melee against melee 1, ranged 1.1, magic 0.85), target resistance, and one final floor.
- Incoming enemies receive no outgoing player triangle multiplier. Player resistance receives the Standard resistance
  multiplier (melee against melee 1, ranged 1.25, magic 0.75) before applying incoming reduction. Ordinary supported
  Bronze–Rune equipment has no resistance; unsupported modifiers and special effects remain excluded.
- Weapon speed comes from official item data; unarmed attacks use 4 seconds. The Online scheduler retains 100ms ticks.

Actor cards publish the target-adjusted damage endpoints and actual chance used by the simulation. Damage rolls use
raw endpoints before triangle/resistance, rather than uniformly sampling the transformed displayed range. Switching
targets refreshes the player's damage and accuracy; switching style refreshes both sides and resets the player attack timer.

The melee catalog contains 66 ordinary Bronze–Rune items across eleven equipment families, verified against the official
Demo package. All 66 have server-defined personal unlock projects, slot assignments, level requirements and combat stats.
Client reports supply discovery and native work evidence, never item numbers or recipes. Ranged/Magic player styles, prayers, potions, summoning, special attacks
and gear modifiers remain deferred. Unlimited food tiers and forgiving eating remain Online rules.

## Combat outcomes

All actors alive at the start of a 100ms tick may land attacks due on that tick, even if another attack or effect
kills them during it. Collect attacks and effect damage before applying damage and resolving the outcome.
A draw requires the player and every opponent to reach zero HP on the same tick. A surviving opponent means defeat;
any positive player HP with all opponents defeated means victory. Near-death victories remain victories.
Draws terminate repeating runs without counting a win or advancing the tutorial. Encounter history preserves `draw`.
Terminal victory, defeat and draw snapshots open a compact modal with the Colosseum wreath and an uppercase localized
result title. Wins and draws show seconds to one decimal place beneath the title; raids use the total run
timer including spawns. Victories also list newly increased skill caps, confirmed by comparing pre-fight
access with the settled inventory; repeats show no unlock list. Close or click outside to dismiss; Escape is disabled.
Intermediate repeat/playlist wins continue normally without a popup. Surrender, expiry and disconnect have no result modal.

## Retired Mossbound prototype

The custom boss/minion encounter and its effect procs are unavailable. Its source and test snapshots are retained in private development history. The generic effect helpers remain covered but no
active training encounter applies effects. This retirement does not alter Raid or Expedition Mossbound content.

### Forgiving eating within a tick

Automatic eating is unavailable throughout early combat, including the tutorial and Golbin Horde. Only an
explicit server-owned permanent capability can enable it; no source grants that capability yet. The following
auto-eat algorithm is retained for that future capability. Manual eating remains available.

Manual and auto eat share a 10-tick cooldown. Each activation heals exactly one portion; manual eating also resets the attack timer and is allowed at full HP, counting a portion without increasing HP.
Auto eat can activate again only after the shared cooldown, even if HP remains below its threshold. Eligibility is checked before and after damage packets, including effect damage; HP must be positive
and at or below the threshold. The player cannot pre-heal from above the threshold to avert a lethal hit.

Incoming packets remain indivisible. Keep the original order if it survives; otherwise search integer-HP subset
sums for a surviving prefix that opens a legal healing opportunity. Tie-break by smallest pre-heal damage sum,
then the first input-order subset. No attacks, deaths, effect applications or packets move to another tick. If no
ordering survives, resolve the original order; player death means defeat unless every opponent also dies that tick.
A single 70-damage hit at 60/100 HP is lethal; separate hits of 70 and 30 can survive as 30, heal by 45, then 70. At most one eating activation can occur in a tick.
The authority records the eating count and terminal status before those states are published.

## Tutorial and encounter selection

The seven mandatory tutorial trials run within Fighter. Only the current server-owned trial is selectable;
starting requires the correct loadout, and graduation removes the trial controls. Dungeons is the regular battle
selection after graduation. There is no Practice tab, roster, category, tier selector or completion display.

Ordinary Practice encounters are retired in 1.7.6. The backend no longer serves their catalog or accepts new
Practice fights. Historical encounter and completion records remain stored without new completion awards.
A saved Practice fight becomes interrupted and can be acknowledged through normal recovery, releasing its
admission lock. Tutorial rewards, project requirements, manual eating and Dungeon progression remain unchanged.
Legacy non-Practice socket run modes retain their engine behavior below for compatibility.

Every Start, including one-off, waits a server-owned 3000 ms respawn interval before attacks begin. Repeat and playlist
victories queue the next wave after the same delay; each actor then starts a full attack interval. The low-level fight
engine remains independently single-shot; `combat/runs.ts` owns scheduling and wraparound. During respawn the socket
and encounter stay active, the client shows a countdown instead of enemy tiles, and Stop, eating and stance changes
remain available. HP, stance, selected food, cumulative eating count and cooldown carry between waves; there is no free healing.
Defeat, surrender and per-fight expiry terminate the run. Disconnect and fifteen-minute transport expiry pause recovery-capable PvE runs; legacy connections still terminate.

One encounter ID covers the entire run. Intermediate victories do not refresh preparation or submit another start
command. The authority commits cumulative eating count and terminal status before publication.
No additional native value movement or 1.6.x API changes are introduced.

## Encounter authority and recovery

The main backend stores the Online character, equipment, selected unlocked food and encounter history. The separate
combat service has no database mount and connects to the main backend through an authenticated internal WebSocket
at `ws://server:3003/authority`; that port remains private to the Compose network.

Admission freezes the server-owned loadout and selected food for the encounter. Food is unlimited and no Bank or
inventory reservation occurs. The authority commits changes to the cumulative eating count and terminal status
before the combat service publishes them. Recovery-capable connections also checkpoint ordinary combat every two seconds.
A backend restart or loss of the authority connection pauses recoverable encounters; legacy encounters are interrupted.

## Independent deployment

`Dockerfile.combat` builds only `server/combat/` on the pinned Bun runtime. It has no database mount, native game
runtime or access to the main application's modules. Compose profile `combat` is optional. Build/deploy only that
service with `docker compose --profile combat up -d --build --no-deps combat`. This does not restart the main API.
Use a compatible main backend and combat service together; the current client uses combat protocol 4.
Subsequent compatible combat-only updates need not restart the main API.
For a combat-only update, build the exact committed combat sources in a separate build context, retain the previous
image for recovery, tag the new image for the existing combat Compose service, and recreate only `combat` with
`--no-build --no-deps`. Keep the existing key mount and ingress. Do not rebuild from a main-backend checkout that
still contains older combat sources. Record the combat image's source revision separately from the main API release.

Before enabling, provision a random 32-byte (64 hex character) key as `config/combat-ticket.key`. Keep it out of Git,
logs and client code. Both containers must be able to read it; the combat image runs as the unprivileged `bun` user.
Use owner/group permissions appropriate for that UID instead of making the whole configuration directory writable.
Set `MELVOR_COMBAT_TICKET_KEY_FILE=/app/config/combat-ticket.key` for the main service and recreate it. Missing or
invalid key leaves ticket issuance disabled. Each deployment/server instance must use a different key.

Route the exact public path `/combat/socket` to combat port 3002 and preserve the path, Origin header and WebSocket
Upgrade. All other requests continue to the main backend. Both published ports remain loopback-bound. For a
Cloudflare Tunnel, add the exact socket path rule before the existing catch-all rule. For another reverse proxy,
enable WebSocket upgrades and a suitably long idle timeout. TLS terminates at that existing public ingress.
The mod derives `wss://SELECTED-ORIGIN/combat/socket` from its selected HTTPS server; it never sends credentials to
a separately configured combat host. Local HTTP testing similarly needs one ingress routing API and socket paths.

Combat accepts browser, Steam, Android, iOS, custom, opaque and absent origins by default, matching the public API.
Admission requires a signed, short-lived, single-use ticket; origins and cookies never authorize combat access.
Self-hosters can optionally restrict origins with `COMBAT_ALLOWED_ORIGINS` outside the Compose defaults.
Native in-game acceptance remains separate from automated socket coverage.

## Protocol and authority

One authenticated `POST /api/v2/combat/ticket` per connection returns a 30-second HMAC ticket. The client opens a
socket and sends it in the first message, never in a URL. It cannot use the ticket for ordinary API actions. Combat
verifies signatures and audience, rejects ticket reuse, and permits one socket per identity per service process.
The main API's normal request limits still protect ticket issuance and handshakes can still fail or be limited by
the ingress. There is no claim that WebSockets are immune to overload or that HTTP 429 is impossible.

All subsequent start, target, stance, eat, surrender, acknowledgement, heartbeat and state messages use that socket. The
service advances 100 ms logical steps (10 Hz) and sends updates at 5 Hz. Clients may advertise
`capabilities: ["state-delta-v1"]` during authentication; the ready message confirms selection. Supporting connections
receive a full `state` with `seq`, then `state_delta` messages with `seq`, `base`, arena `id` and `changes`.
Each change is `[path, value]` to replace a field or `[path]` to remove it; paths are arrays of object keys or array-index
strings. Equal-length arrays can update individual actors; changed-length arrays replace atomically. Null values are
preserved. A full keyframe is sent at least every five seconds during streaming and on a new arena. The client
reconstructs immutable snapshots, rejects invalid paths/sequence gaps and closes safely rather than predicting state.
Unnegotiated clients retain the original full-state messages; new clients also accept older services. Combat protocol 4
reports encounter and event times as `elapsed_ms`; `step_ms` advertises the simulation step. Older POC clients
are intentionally unsupported. Existing 1.6.17 clients do not use the combat protocol and retain their API behavior. Commands carry monotonically increasing sequences
and encounter IDs. Only the server computes HP, hits, supplies and terminal state. Client clocks and derived stats
are not authoritative. Attack bars interpolate cosmetically using browser animation frames, reset directly to
the latest server timer, and hold full until an attack is confirmed. Interpolation stops after 400 ms without a
snapshot, on terminal state, or on teardown. Reduced-motion users see authoritative snapshot positions. Messages are capped at 2 KiB and 20/second, send buffers at 64 KiB, and connections at 128.
The client has one in-flight command, a 5-second command timeout and no automatic command replay or reconnect loop.

Heartbeat interval is 2 seconds with a 10-second lease. Navigating between Combat, Chat and native skill pages retains the same socket and encounter.
The sidebar shows a pulsing active badge only while an authoritative encounter is active (static with reduced motion).
Off-screen attack animations stop; returning paints the latest snapshot. Hiding the app, closing or navigating away
from the game document, explicitly disconnecting or changing identity closes the client socket. Recovery-capable PvE pauses on detected closure; legacy connections interrupt their arena. Network-loss detection may take up to the lease duration.
Reconnect requires a new ticket. Recovery-capable clients discover the saved battle and require manual Resume; legacy clients start fresh. Fights expire after 3000 simulation ticks; transport connections expire at fifteen minutes. A stalled
service closes sockets instead of catching up more than a second of accumulated time. Restart restores recoverable arenas as paused. There is no offline simulation.

Tickets are verified locally, and the main authority checks current identity admission when admitting a fight.
Revocation is not continuously pushed during an existing fight; connection lifetime remains bounded and rollback
holds stop consumption at the authority. Multi-replica ownership and production PvP fairness remain future work.
Run one combat replica. Protect public ingress against connection floods before broader rollout. The connection
cap is a defensive bound, not a measured Raspberry Pi capacity promise.

## PvE recovery and maintenance (1.7.1)

Protocol 4 remains unchanged. The optional `pve-recovery-v1` capability enables recovery only when both client
and combat service support it. Existing 1.7.0 clients keep their previous disconnect behavior and API response
shape; no minimum-client version change is required. The inventory query `recovery=1` adds saved-battle and
maintenance summaries. Deploy the main authority first, then the matching combat image, then test 1.7.1.
Do not enable recovery clients against a new combat service backed by an older authority.

The SQLite authority stores one versioned arena per identity, with controller and revision fencing. Complete
arena/run state is checkpointed every two seconds, on food/progression/terminal changes, and on clean closure.
Checkpoint and progression writes share a transaction. A crash can rewind ordinary combat to the last checkpoint;
random draws after that point are not replay-identical. Persisted food usage and progression cannot be replayed.
The format constant must change for incompatible engine/content changes. Unsupported checkpoints terminate with
an expired notice while keeping already committed progression. Terminal results remain until client delivery is
acknowledged; a lost acknowledgement may redisplay the result but cannot grant progression twice.

Resume restores frozen loadout, HP, effects, attack/eating timers and wave state after checking current admission.
Inspecting a paused battle does not extend retention. Actual resume ends that pause; the next disconnect starts a
new roughly 30-minute allowance. An authority availability clock advances on healthy combat-service checks every
two seconds; gaps over ten seconds, global maintenance and combat drain do not count. Recovery after an outage
ensures at least five minutes remain. This detects backend/combat outages, not failures of public ingress or a
particular player's network. PvP/shared multiplayer raids are not implemented and must not inherit this pause policy.

Compose grants both services 15 seconds to stop. Main-authority shutdown requests a combat flush and waits up to
four seconds; combat shutdown awaits socket cleanup before exit. Forced kills fall back to durable checkpoints.
For planned maintenance, run these host CLI commands from the server working directory:

```sh
bun run admin.ts combat-maintenance status
bun run admin.ts combat-maintenance drain 5
# Return immediately if idle, otherwise wait until running battles finish or pause.
bun run admin.ts combat-maintenance wait
# Only for a known incompatible update: warn that remaining battles will end.
bun run admin.ts combat-maintenance drain 5 incompatible
bun run admin.ts combat-maintenance clear
```

Drain blocks new starts and resumes immediately, broadcasts a minute countdown to capable clients, and lets
existing fights continue until the deadline. At the deadline they pause; explicit incompatible mode ends retained
paused battles. Drain persists across restarts and must be cleared after deployment. Legacy clients cannot show
the new countdown but retain normal play outside this deliberate maintenance window.

The countdown is a maximum finish window, not a mandatory delay. `status` includes `running_battles`,
`paused_battles` and `ready`; `wait` exits successfully as soon as the closed admission gate has no running
battles, including legacy battles. Compatible paused battles and unacknowledged terminal results do not delay
deployment. In incompatible mode, paused battles also block readiness until the service invalidates them.
Admission checks share the SQLite write lock with the drain setting, preventing a new start from slipping
between gate closure and the idle check. The waiter polls once per second, fails if the drain changes, and
fails closed if battles remain fifteen seconds beyond the deadline. Failure leaves the drain enabled for
operator investigation; it never treats elapsed time alone as permission to deploy.

Recovery tests include actual combat/authority SIGKILL and graceful authority shutdown with a file-backed database.
The load fixture accepts `COMBAT_LOAD_DATABASE=1 COMBAT_LOAD_RECOVERY=1`; on 2026-11-02, five-second local stages
at 25/50/100 clients completed without failures. The 100-client stage wrote 378 checkpoints (about 1.03 MiB),
with 0.05 ms checkpoint p95, 6.2% of one CPU core and 88.2 MiB peak RSS. This short in-process authority fixture
excludes private-socket/public-ingress overhead and is not a production Pi capacity claim.

## Validation

`./scripts/test.sh ./tests/unit/combat.test.ts ./tests/unit/combat-effects.test.ts` exercises the core and actual ephemeral Bun WebSockets. Inventory tests additionally exercise file-backed recovery and the private/public socket path. The normal
server typecheck includes the service. Client controller tests run through `node --test tests/mod/combat.test.mjs`.
Real-game rendering and production tunnel routing are separate acceptance steps after authorized deployment and ZIP
installation. No default Compose service starts combat and packaging a ZIP does not deploy it.


## Isolated concurrency benchmark

`bun run server/tests/support/combat-load.ts` starts its own loopback service with disposable signing credentials
and stages 25, 50 and 100 socket clients. By default it injects a test combat authority and reads no database; neither mode connects to production. Each stage lasts
15 seconds by default; `COMBAT_LOAD_STAGE_SECONDS` accepts 5–60 seconds. Set `COMBAT_LOAD_DELTA=1` to measure the negotiated compact stream against the default legacy stream. Clients heartbeat and restart completed
reward-free encounters. Failures, snapshot frequency and accumulated clock drift are checked.

The default mode measures simulation and streaming only, excluding durable authority costs. The output reports combined service-and-generator CPU (percentage of one core) and peak RSS, outgoing JSON bytes,
snapshot gaps and clock drift. These short loopback measurements include client work and do not establish public
Cloudflare throughput, real-game rendering, long-running stability, or future Raid/PvP capacity. On a shared host,
run in a separate container with explicit CPU/memory limits and no network or database mount, then verify the
existing API health. Do not point a synthetic population at the deployed admission route.

Set `COMBAT_LOAD_DATABASE=1` to exercise actual admission, eating and wave/terminal settlement against a
disposable file-backed WAL database using guarded Quarry II test profiles. The adapter calls the real authority
functions in-process; it does not measure the private authority WebSocket or public ingress. It also builds full
inventory responses at setup and settlement, plus negotiated compact inventory bursts every five seconds during measurement. Output includes durable progress calls, inventory reads, bytes and p95 read latency.
Fixture construction is excluded from timed CPU measurements. This remains a short local benchmark, not a Pi
capacity guarantee; no production database, credentials or live routes are used.

### Player health-bar indicators

Online Combat owns these indicators; they are not assumed native game features. One red marker shows the highest
server-published maximum hit among living enemies, divided by the player's maximum HP. Defeated enemies are
excluded; no enemies alive hides the marker. This is a single-enemy hit threshold, not a combined group burst or a
survival guarantee. When the server explicitly enables auto-eat, one blue marker shows its boundary in whole HP
(rounded down), independent of food availability. The blue marker and its label are hidden throughout current early
combat. Auto eat still requires food and surviving a hit. Markers use
different vertical portions so equal thresholds remain distinguishable. No extra requests or server rules are added.

## Remaining differences from native combat

Online Combat uses native base melee stats, selected-style bonuses and the Standard triangle for its bounded ordinary
gear scope. It does not import native character progression, equipment ownership, modifiers or native effects.
Training enemies have authored encounter composition and attack intervals; Mind Golbin uses an authored spell maximum.
The 100ms scheduler, unlimited food and optional auto-eat algorithm remain custom. Player ranged/magic support remains deferred.

## Mandatory first-steps tutorial

New Online characters complete seven ordered training trials before regular Battles and Online level purchases
unlock. Character preparation grants 1 EP once; victories in the first six trials grant 1, 1, 2, 1, 1 and 2 EP,
respectively, for 9 EP total. Defeat, surrender, interruption and replay never award a second allowance. Tutorial
progress and encounter settlement belong to the backend and survive reconnects. Equipment-access resets are unavailable
during training. Other multiplayer features and normal Expedition EP earning remain available.

Opening Weapon or Shield access permanently unlocks its Online-only Wooden Sword or Wooden Shield. Players
must equip it themselves. Later steps require real material purchases, native item discovery where applicable,
normal Equipment Projects and equipping: Bronze Sword, Bronze Helmet, Shrimp, Bronze Shield, then Iron Shield.
No crafted item is awarded by the tutorial. Tutorial equipment work takes 45 seconds per ingredient unit; Shrimp
Fishing and Cooking take 45 seconds each. Existing recorded work is preserved; the upgrade completes saved projects
that already meet every reduced target. Automatic tracking, the shared tracking target and offline report rules remain unchanged. The UI outlines the next relevant page, slot, purchase, project or item
in green and explains the current task in both Combat and Projects. Tutorial guidance is currently English preview
copy, consistent with the existing encounter picker.

The seven trials are Training Partner, Sparring Partner, Armoured Squire, Practice Partner, Endurance Bout, Heavy
Hitter and Final Assessment. The first partner is harmless. Trials teach attack bars, stances, accuracy, preparation
and eating. Final Assessment contains two consecutive bouts with HP and eating cooldown carried between them.
Each individual bout targets approximately 20–50 seconds for the expected level 1 loadout; random damage and
misses can produce shorter or longer outliers. Regular fights remain rewardless. Tutorial EP and required equipment
are verified on the server independently of UI highlights.

## Golbin Horde and permanent caps

Raid admission fixes the endpoint from permanent clears: the first run ends at I, the next at II, then every
subsequent run targets III. Every attempt starts at I and plays through its endpoint. There is no lower-tier
selector, automatic extension of a newly cleared endpoint, or purchase prerequisite. Fixed authored waves are:

| Tier | Waves (M melee, R ranged, W magic) | Skill cap grant |
| --- | --- | --- |
| I | M / R / W / MRW | ASDH 3 |
| II | 3M / 3R / 3W / 2M2R2W | ASDH 6 |
| III | 3M3R / 6R / 6M | ASDH 9 |

Raid attack intervals differ by style: melee/ranged/magic use 3.8/4.0/4.2 seconds in tiers I and III,
and 4.0/4.2/4.4 seconds in tier II. Previous ruleset records are retained
but do not compete with the revised balance; permanent tier unlocks are unaffected.

The server supplies each actor's `possible_effects`, covering effects received from opponents or itself.
Effect rows reserve space only when this list or active effects is nonempty. Current encounters have no effect
sources, so their tiles omit the empty rows. Older servers without this field retain reserved space.

HP, stance and eating cooldown carry between battles without free healing. Levels, gear and food selection
remain frozen for the run. Each tier's explicit win requirement is currently one. Tier grants commit with
monotonic wave progress and survive later defeat, draw, surrender, interruption, expiry and ordinary resets.
No EP, loot, cosmetics, repeat payouts or cash-out rewards are granted. Equipment access is independently
initially bounded per slot to Iron, food initially to tier 1; Tidal Caverns grants food tier 2 and Cinder Quarry tier I raises supported melee material caps to Steel. Existing catalog
recipes remain defined for retained progress and future content. Ranged and Magic stay at cap 1.

Only a successful 11-battle I–III run qualifies for the Golbin time leaderboard. Recovery-capable runs use
authoritative simulation duration, including initial/between-wave delays but excluding pauses and service stalls.
Legacy runs retain wall time from reservation through victory. Existing records remain in the same board; this
is an intentional timing improvement without deleting historical achievements. Client messages cannot supply
completion times or select an endpoint. Records are scoped to the authored `golbin-2` ruleset;
a strictly faster run replaces both time and achieved timestamp, while equal/slower times preserve the original.
Display dates use the viewer's local timezone. Ordering is elapsed time, achieved timestamp, then Client ID.
The paginated board excludes disabled/deleted identities and follows current public display names and avatars.
The Dungeon browser shows Dungeons, selected dungeon details and Leaderboard in three desktop columns, with three tabs
below 768px, reusing the existing mobile tab styling and separators with a Selected details tab. Desktop
columns grow independently. The first raid is selected by default. Matching compact, fixed-width tier badges
in the list and unlock rows show permanent clears; unlock rows omit opponent portraits. The admitted tier
is highlighted and named on Start Dungeon; later tiers show locks in the details badges. The details carry brief raid flavor and a short leaderboard qualification note. Each tier lists its actual
skill-cap gains vertically, with its compact badge aligned at the top left: Tier I lists Attack, Strength, Defence and Hitpoints at 3; II and III raise these caps to 6 and 9. Opponent image filters are authored in
`COMBAT_ACTOR_IMAGE_EFFECTS` in `mod/combat-arena.mjs`, shared by picker and combat artwork (including numbered
raid actors). All three Golbin styles use distinct, muted, darker portrait treatments.

The 1.6.17 client has no Online Combat controller. Its v2 APIs, payloads and minimum support policy remain intact;
legacy socket run modes also retain their existing full-snapshot path.


## Tidal Caverns

Unlocked by permanent completion of all three Golbin Horde tiers. Two finite endpoints replay from wave 1:
Tier I ends at wave 3; Tier II ends at wave 6. Completion and records are dungeon-specific, independent of
shared skill caps. Golbin progress and `golbin-2` records are preserved. Existing encounter rows identify
content by their server-frozen ruleset, so no schema migration is needed for these two-tier encounters.

| Wave | Opponents | Permanent boundary reward |
| --- | --- | --- |
| 1 | 8 Saltwings | — |
| 2 | 6 Saltwings + 2 Reefbreakers | — |
| 3 | 10 Saltwings + 1 Reefbreaker | ASDH caps 12; Herring access |
| 4 | 12 Saltwings | — |
| 5 | 6 Saltwings + 3 Reefbreakers | — |
| 6 | 8 Undertide Tendrils | ASDH caps 15 |

All opponents use authored melee profiles: Saltwing 20 HP / max hit 6 / 2.4 s / Attack 50 / Defence 7;
Reefbreaker 85 HP / max hit 22 / 3.6 s / Attack 65 / Defence 9;
Undertide Tendril 90 HP / max hit 12 / 3.6 s / Attack 70 / Defence 12.
Attack levels are authored separately from defence so accuracy can threaten prepared Iron builds without
turning every opponent into a prolonged accuracy check. Tier I expects ASDH9, full Iron and Shrimp;
tier II expects ASDH12, full Iron and Herring. Manual eating remains necessary and resets the player attack timer.
Opening attacks are staggered by 200 ms per opponent. Each limb is independently targetable and all eight
must die; there is no head target. Removing targets reduces pressure. No automatic eating is granted.
The Kraken is collective/dungeon artwork; limb icons use native Tentacle artwork with a restrained filter.
Seagull and GiantCrab portraits use registered monster media, with a question-mark fallback if absent.

Food rewards in Unlocks display the item icon, localized item name and healing amount as `Herring (+50 HP)`; use this format for future food tiers. The value comes from the equipment catalog.

Herring access raises the food ceiling; ordinary EP purchase and project completion still apply. Grants commit
with monotonic wave progress and survive later losses or resets. No Steel, Trout, levels, equipment, EP or loot
is awarded. A six-wave clear qualifies for a separate `tidal-2` server-timed leaderboard. Only current-ruleset times qualify; permanent clears and unlocks are unchanged.
The compact automatic battle view retains all 8/9/11/12 targets without a content-count cap.
Native desktop/mobile rendering, portrait readability and manual interaction still require in-game acceptance.

## Sinking Mire

Unlocked by permanent completion of both Tidal Caverns tiers. Three finite endpoints replay from wave 1,
ending at waves 2, 4 and 6. Cap grants survive later defeat or resets and do not depend on purchased levels.

> Beneath the still waters of the Sinking Mire, hungry roots stir and venomous toads gather. Blobs glide through the shallows, their yielding bodies heavily corrosive to Bronze.

| Tier | Wave | Opponents | Permanent boundary reward |
| --- | --- | --- | --- |
| I — Shallow Pools | 1 | 3 Blobs | — |
| I | 2 | 2 Blobs + 1 Bittertoad | ASDH caps 17 |
| II — Feeding Ground | 3 | 3 Blobs + 1 Bogmaw | — |
| II | 4 | 2 Blobs + 2 Bittertoads | ASDH caps 19 |
| III — Drowned Root | 5 | 1 Bittertoad + 2 Bogmaws | — |
| III | 6 | 2 Blobs + 1 Bittertoad + Drowned Root | ASDH caps 21 |

All four opponents use authored melee profiles:

| Opponent | HP | Max hit | Attack interval | Attack level | Defence level |
| --- | --- | --- | --- | --- | --- |
| Blob | 75 | 10 | 1.4 s | 28 | 10 |
| Bittertoad | 65 | 8 | 2.0 s | 35 | 15 |
| Bogmaw | 110 | 32 | 3.2 s | 45 | 18 |
| Drowned Root | 200 | 20 | 1.8 s | 45 | 20 |

Blob's corrosion is specific to equipped Bronze items. Bronze weapon hits deal 1 damage to Blob;
misses deal 0. Blob ignores Bronze armor and shield evasion bonuses when calculating its hit chance.
It retains player levels, stance and other equipment's evasion. Damage per hit and damage reduction are
unchanged. Wooden and other materials do not inherit these penalties. Corrosion applies only to Blobs;
other enemies use ordinary combat math. Server snapshots publish target-specific player maximum hits
so markers and selected-target stats match the damage cap.

Bittertoads have a 35% poison chance on successful hits. Poison uses the existing ten pulses of 1% maximum
HP over five seconds, including fractional carry; it neither stacks nor refreshes while active. Eating
remains available. Removing toads stops new applications; existing poison finishes normally unless the
encounter ends. Temporary effects clear between encounters, while HP, stance, food usage and eating
cooldown carry without a free heal. Opening enemy attacks are staggered by 200 ms per opponent.

Tier entry preparation is ASDH15/17/19, full Iron and Herring. The complete-run target is approximately
five minutes at ASDH21 with full Iron/Herring; six minutes is acceptable. The first encounter deliberately
walls Bronze weapons while rewarding Iron preparation. No food, material, auto-eat, EP or loot reward
is granted. Full six-wave clears qualify for the separate `mire-1` server-timed leaderboard.

Portraits use native standalone asset resolution: GreenSlime and Grumpy_Willow are mirrored horizontally;
poison_toad and hungry_plant retain their supplied orientation. Treatments apply in previews and battle.
Native desktop/mobile presentation and manual difficulty acceptance remain to be verified in game.

## Cinder Quarry

Requires all Sinking Mire tiers. Three cumulative endpoints contain 2/5/8 battles, with permanent
boundary rewards and a separate `quarry-1` full-clear leaderboard.

> Ash drifts over abandoned quarry ledges. Shelled creatures creep between cooling stones, fiery wisps haunt the galleries, and serpents coil beneath a heart of molten rock.

| Chamber | Battle | Composition | Boundary reward |
| --- | --- | --- | --- |
| I — Cinder Approach | 1 | 2 Cinder Snails + Kiln Wisp | — |
| I | 2 | Cinder Snail + Embercoil | Steel access for supported melee slots |
| II — Furnace Galleries | 3 | 2 Cinder Snails + 2 Kiln Wisps | — |
| II | 4 | Cinder Snail + Kiln Wisp + Embercoil | — |
| II | 5 | 2 Embercoils | ASDH caps 23 |
| III — Molten Heart | 6 | 2 Kiln Wisps + 2 Embercoils | — |
| III | 7 | 2 Cinder Snails + Embercoil | — |
| III | 8 | Slagheart + Kiln Wisp + Embercoil | ASDH caps 25 |

| Opponent | HP | Base max hit | Attack interval | Attack level | Defence level | Native portrait below assets/media/ |
| --- | --- | --- | --- | --- | --- | --- |
| Cinder Snail | 100 | 13 | 1.8 s | 48 | 18 | pets/harry.png |
| Kiln Wisp | 55 | 12 | 1.2 s | 50 | 15 | monsters/fire_spirit.png |
| Embercoil | 130 | 22 | 2.2 s | 52 | 20 | monsters/burning_snake.png |
| Slagheart | 280 | 55 | 3.6 s | 60 | 24 | monsters/Lava_Golem.png |

Tier II multiplies base maximum hits by 1.3 and tier III by 1.5, rounding down. Other profile values
remain fixed. Enemy openings stagger by 200 ms. Native artwork resolves through `assets.getURI`.

Every successful Embercoil hit rolls once: 20% Poison, 15% Burn, 65% neither. An already active result
does nothing, without rerolling. One hit cannot apply both; separate hits can overlap. Neither ordinary
effect stacks nor refreshes. Poison deals ten half-second pulses of 1% maximum HP. Burn deals 1%
current HP every half-second, speeds player attacks by 25%, and ends after two player attacks. Eating
remains available and interrupts the attack windup. Slagheart has no additional effect.

Tier II/III chambers apply persistent Slow while any Iron Helmet, Platebody, Platelegs, Boots, Gloves
or Shield is equipped. Multiple pieces do not stack it. Iron weapons retain ordinary damage. Steel,
Bronze and empty slots do not inherit this material condition. Slow reduces attack speed by 25%;
Burn's existing +25% temporarily cancels it. Starting equipment is fixed for the run. Effects are absent
during respawns, applied at battle start and cleared on victory, defeat, flee and reset; carried HP and
eating cooldown do not reset between battles. Conditions appear before admission and in the arena.

Tier I expects ASDH21/Iron/Herring; tier II ASDH21/Steel/Herring; tier III ASDH23/Steel/Herring.
The full I–III target is 5–8 minutes at ASDH25/Steel/Herring. Production-engine simulations meet this
for one-handed prepared builds; slower Battleaxe/2H builds can exceed it as eating interrupts windups.
Iron armor substantially lengthens later battles. Bronze remains a viable high-level alternative with
no Iron-specific Slow. Native manual-eating difficulty and rendering acceptance remain pending.

### Reusable chamber effects

`DungeonTier.chamber_effects` is server-owned data. For example:

```ts
chamber_effects: [{
  id: 'iron_heat',
  effect: 'slow',
  equipment: { material: 'Iron', slots: ['Helmet', 'Platebody', 'Platelegs', 'Boots', 'Gloves', 'Shield'] }
}]
```

Omit `equipment` for an unconditional effect, or choose another existing effect ID for future content.
Use unique stable IDs per chamber source. Supported catalog item IDs must match the exact material
and one configured slot; this is not a minimum-material threshold. Definitions also drive localized
previews and arena condition text. Active instances use source `chamber:<id>` and lifetime `persistent`,
with no expiry or attack count; ordinary applications retain their timers and attack counts. Independent
sources coexist but identical effect IDs contribute speed and damage once. Persistent sources take
precedence for damage pulses; attack-inflicted timers still progress independently. Removing a source
leaves other sources intact. Every battle starts fresh and reapplies its chamber definitions.

## Fighter Adventures

The Adventures tab follows the server capability advertisement, independently of reward refresh or economy-command
readiness, and retains that availability through reconnect resets.

The Adventure card gives Offline Limit one-third of the desktop width and its description two-thirds,
separated by a rule; mobile stacks them vertically. Offline Limit initially shows its current level and a plus
button. The target preview, stepper, EP cost, Cancel and Confirm controls appear only after pressing plus.
Successful upgrades close the editor. A separate Areas card contains the area cards with native
artwork in the top-right backdrop. Monster icon/name badges wrap horizontally and toggle selection through
pressed styling, without checkbox icons. One chest below each area’s monster list opens the combined hourly
drops for its current selection; drops are not listed inside the area card. The drop modal shows undiscovered items
crossed out in red, explains that they cannot be looted, and keeps GP available. It uses `/h`, sorts quantities highest-first, and has a top-right close button with no nested
scroll surface. Each area places its chest, Send Fighter action and wrapping estimate on one row.

Adventures lists all twelve base-game Combat Areas, with an explicit selection of one or more monsters. Monsters
with magic or special attacks are unavailable until those mechanics are modeled. The server owns
all monster stats, loot weights, quantities, bones and GP ranges. Rewards use native, unmodified monster drop tables;
there are no authored resource pools, Marketplace rotations, global rare drops, pets, XP or combat progression rewards.
Only items already discovered in the character's save are eligible. Undiscovered outcomes are discarded without
rerolling or increasing the odds of another item. Bones use the same discovery rule; GP needs no discovery entry.

The Fighter uses the ordinary Colosseum melee stats in accurate stance, including weapon speed, defensive bonuses
and the Standard triangle. Each selected opponent must have a maximum single hit below maximum Fighter HP, and
selected first-slot Colosseum food must sustain its average incoming damage. Defence affects enemy accuracy;
resistance affects damage on a hit. No food is substituted from the second slot or from higher unlocks.
The readiness estimate does not simulate unlucky bursts. Adventures consumes no HP or food and can run alongside
ordinary battles.

The server solves expected attacks against each opponent's finite HP, including misses, damage rounding and overkill.
Let `T` be expected attack time, `D` expected incoming damage per second and `H` healing per portion. Eating adds
`T * D / (H - D)` seconds when `H > D`, charging a flat second per estimated portion while enemies keep attacking.
A damaging opponent requires selected food even when one fight might finish before eating is necessary. The ordinary
unmodified native spawn delay is three seconds. Sum these times across selected opponents to obtain one cycle.
Each selected monster earns equal fractional kill credit at `elapsed_seconds / cycle_seconds`. Whole credits become
independent loot rolls; ordinary payout boundaries retain fractions. The editable pace multiplier starts at 1.
Displayed hourly rates are expectations, not guaranteed quantities.

Assignments accrue capped real time, including downtime. Online five-minute check-ins and reconnect settlement
move rewards automatically to the separate Adventures Inbox section. Routine online deliveries are quiet; a returning
player's haul has one notification cleared by viewing that section. Claims use the existing durable Inbox protocol,
including bank-slot-free GP, replay and owner acknowledgement. Participation is character-owned, Guild-independent,
and explicitly opt-in for Social Only players.

Adventure actions commit entirely on the server. Assignment, check-in and capacity requests use the revision
from the Adventure state they were based on. A stale request cannot repeat a payout, charge or assignment
change. Reading the Inbox section acknowledges only the observed haul revision. Discovery is sent with start
and check-in and stays out of the character's economy journal. Adventure loot remains in server custody until
an Inbox claim.

Accumulation starts at one hour and can be increased with EP to 99 hours. Upgrades retain used time and never restore
time already lost at the old cap. Capacity resets retain the existing refund and banked-reset rules. Delivery releases
capacity immediately; claiming items later does not affect the production clock. A Fighter contributes to the
shared-area bonus only until their capacity runs out. A later check-in restarts their contribution from that time;
the capped gap does not grant bonuses retroactively. Deleted characters stop contributing at deletion.

Fighter, gear, food and discovery changes first settle elapsed time against the saved rate and eligibility. Eligible
loadout changes preserve fractional credits. An ineligible selected opponent ends the whole assignment after earned
rewards reach Inbox. Changing monster selection or stopping also pays earned rewards, then discards fractions.
Catalog changes follow the same end-and-restart rule: settle saved monster data, deliver earned rewards and end the
assignment. A fingerprint includes all catalog inputs, so changing data without changing its version still ends an
old assignment. Delivered rewards remain claimable.

### Native data and performance verification

`server/fighter-adventures-catalog.json` records the official source URL, acquisition date and SHA-256. Its Demo hash
matches the existing reviewed Colosseum equipment package. Monsters with unmodeled magic, special attacks or passives
remain unavailable until their mechanics and admission rules are reviewed. No upstream runtime scripts or artwork
are copied into this catalog. Third-party data is excluded from this fork's CC0 dedication.

To reproduce the reviewed subset from the unmodified official download:

```sh
python3 scripts/extract-adventure-catalog.py melvorDemo.json /tmp/adventure-catalog.json
cmp server/fighter-adventures-catalog.json /tmp/adventure-catalog.json
```

The extractor rejects an unreviewed source hash. Source updates require reviewing native mechanics, modifiers and
reward channels before replacing the pin. The retained source has no package build number; do not infer one from
its retrieval date. Runtime references from build 12097 establish the ordinary three-second spawn delay and the
unmodified item-table, bone and currency roll paths.

Loot sampling draws binomial counts by enumerating probability mass outwards from its mode, then uses conditional
binomials for weighted tables and uniform quantity sums. It uses no per-kill simulation, normal approximation or
unbounded rejection loop. Catalog limits bound monster count, table rows, quantity ranges and pace. At 99 hours,
maximum supported pace and the minimum spawn delay, one monster cannot exceed 1,188,000 credited kills per settlement.
The synthetic benchmark in `server/tests/benchmarks/fighter-adventures.ts` measures real SQLite settlement, cached
state reads, maximum supported table/quantity sampling and adversarial binomial tail quantiles. It uses an in-memory
fixture. Set `DB_PATH=:memory:` so transitive module initialization also stays in memory; never supply a live
application database path.

Local ARM64 Docker/Bun 1.4.4 evaluation on 2026-11-07 (20 samples per workload): 99h Wet Forest settlement
p50 0.94 ms / p95 3.69 ms; bounded maximum loot workload p50 3.85 ms / p95 5.27 ms. These are laptop
measurements, not Pi capacity evidence.

The user-approved isolated Raspberry Pi 5 evaluation on 2026-11-07 used Bun 1.4.4, 20 samples per workload,
a half-CPU limit and 256 MB memory limit. The container had no network, a read-only root/source mount and no live
database or deployment mounts; temporary source and the container were removed after completion.

| Workload | Median (ms) | p95 / maximum (ms) |
| --- | ---: | ---: |
| 99h Wet Forest settlement with SQLite Inbox delivery | 3.31 | 69.35 |
| Cached state and hourly estimates | 0.20 | 2.69 |
| Maximum supported loot sampler | 12.00 | 81.38 |
| Adversarial binomial tail quantile | 1.86 | 67.87 |

These wall-clock measurements include scheduling under the CPU quota. With 20 samples, the reported p95 is the
maximum sample. This isolated workload does not establish live-server concurrency capacity.

At pace 1, selecting every monster in an area produces these expected hourly outputs before discovery filtering.
Bones below assume Bones has been discovered; GP is always eligible. Other item drops are additional native rolls.

| Fighter and food | Golbin Village kills of each monster/h | Golbin Village GP/h | Wet Forest kills of each monster/h | Wet Forest GP/h |
| --- | ---: | ---: | ---: | ---: |
| Attack/Strength/Defence 1, HP 3, no gear, Shrimp | 35.11 | 421.35 | Ineligible | — |
| All four levels 20, Bronze Sword and Shield, Shrimp | 126.65 | 1,519.80 | 11.78 | 1,832.34 |
| All four levels 99, Rune Scimitar, Carp | 273.00 | 3,275.96 | 73.25 | 11,391.09 |

The chosen 100% pace remains the evaluation baseline. These estimates establish the comparison for subsequent
balance review; they do not constitute final production-rate acceptance.
