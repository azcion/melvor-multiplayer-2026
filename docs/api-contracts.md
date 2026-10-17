# Multiplayer API contracts

The minimum supported mod version is 1.6.14. The hosted API exposes one current wire contract, API v2; backend deployment
versions remain independent of mod releases.

The compiled support baseline is 1.6.14. The operator may raise the minimum supported version; clearing an override
restores that baseline. Empty, malformed or older stored overrides cannot reopen retired request contracts. API
discovery, major selection, explicit capability negotiation and update notices remain available for future releases.

Authentication may include `social_mode_enforcement` as `identity`, `account`, or null. When non-null, the effective
`social_mode` is `social`, Full-mode changes return `MOD_MP_SOCIAL_MODE_ENFORCED`, and every Social Only authorization
gate remains authoritative. Clients use the enforcement source to explain the operator restriction and hide the
unavailable Full Experience choice.

Developer badges (1.6.13+) use server-owned plain-text labels. Registration, authentication, Chat state, and Events
(including unchanged Events) include `dev_badge_labels`, a map from stable Chat feature IDs to display labels.
Guild roster and applicant entries include nullable `dev_badge_label`, already filtered by the character's visibility
preference. Clients render the label using the existing pink developer badge style; `null` means no badge.
Stable feature IDs preserve saved Chat tags when labels change. Structured feature, person and badge parts are returned
directly for supported clients.

## Selection

`GET /api/versions` returns `api_versions: [2]` and `preferred_api_version: 2`. Clients select before authentication,
then use `/api/v2/register` or `/api/v2/authenticate`. Successful bootstrap responses include `api_version: 2` and
`api_versions: [2]`.

Logical `/api/...` names are mapped to `/api/v2/...` by the current client/test transport. Unversioned and `/api/v1/...`
wire paths are not registered. Unknown majors return 404; invalid methods on known paths return 405. `/health` is
independent of API versioning.

## v2 differences

- Receipt-backed economy mutations require a lowercase, hyphenated UUID `command_id` before any domain mutation.
  Claim/acknowledgement protocols retain their existing identifiers.
- Authenticated reads use GET. POST is registered only for explicitly mutating operations. Binary upload and CORS
  preflight remain available on versioned paths.
- Status sync uses `activities`; omission leaves activities unchanged and an empty array clears them. Skills and Activity
  visibility use their separate endpoints. Historical snapshot fallbacks remain for persisted rows.
- Server-owned pets and reward computation are unconditional. Historical recipient delivery predicates and payout queues
  remain until their value-safe reconciliation is complete.
- Optional runtime metadata is not an authentication credential. Session, installation, Guild, ownership, and
  Social Only authorization apply to every request. Unsupported reported clients cannot bypass the refresh gate by
  changing the URL prefix.

The contract tests cover the current v2 route/method boundary directly; historical release inventories remain in the
compatibility cleanup plan rather than executable fixtures.

## Standalone Chat browser authentication

Browser credentials are scoped separately from game sessions. Game-authenticated
`POST /api/v2/chat/browser-links/issue`, `GET /api/v2/chat/browser-links/list`, and
`POST /api/v2/chat/browser-links/revoke` issue a five-minute one-use code, list the authenticated Client's links,
and revoke one owned `session_id`. Codes and browser bearers are stored only as hashes. Each identity requires
its own code; reported Melvor account siblings never inherit browser access.

The browser-only routes have no CORS support and return private/no-store responses:

| Method | Path | Contract |
| --- | --- | --- |
| POST | `/chat/api/pair` | JSON `{code}`; returns `{ok:true,link_id}` and a host-only HttpOnly cookie |
| GET | `/chat/api/session` | Returns `{links:[{link_id,client_id,display_name,expires_at}],csrf_token}`; no selected identity |
| POST | `/chat/api/logout` | JSON `{}`; revoke exactly the selected link |
| POST | `/chat/api/logout-all` | JSON `{}`; revoke this browser and all its links |

All mutations require exact configured Origin and `Content-Type: application/json`; supplied foreign/null Origin
and cross-site Fetch Metadata are rejected on reads too. Same-origin GET may omit Origin. Adding a link to an
existing browser and both logout routes require `X-Chat-CSRF` from bootstrap. Identity-scoped operations also
require exactly one canonical positive safe-integer `X-Chat-Link-ID` belonging to that browser; missing or ambiguous
selection returns 400, unauthorized/expired/revoked links return 401, and invalid CSRF returns 403. There is no
implicit identity selection. Bootstrap does not refresh idle clocks or return Chat content.

The cookie uses `Path=/chat; Secure; HttpOnly; SameSite=Strict`, no Domain, and thirty-day Max-Age; explicit loopback
HTTP configuration uses a distinct non-Secure local cookie. A link has thirty-day absolute and seven-day idle
expiry, with limits of ten active identities per browser and ten active browsers per identity. Adding another
identity retains the bearer and extends cookie retention without extending existing links. A fresh code for an
already active link is consumed and returns the existing link without renewing it. Relinking after revocation or
expiry requires a fresh code and returns a new link ID.

A stale browser cookie on bootstrap/pair returns 401 with cookie expiry. Pairing does not consume the code or
silently replace that browser; a subsequent explicit no-cookie attempt can establish a new browser. Logout-one
retains the cookie while other links remain. Logout-all revokes the container and every link atomically. Browser
cookies never authenticate game API routes or update game activity, runtime snapshots or game sessions. Chat
content uses the scoped shared handlers documented below; the website messaging UI is a separate slice.

## Guild mod-category markings

Authorized Guild roster, directory and applicant rows retain `using_cheats`, `cheats_detected_at` and `cheat_mods`
with their original eight-mod Interdict meaning. They also include `cheat_categories`, ordered by the stable IDs
`time`, `items`, `resources`, `multitasking`, `shops`, `loot_rng`. Each entry contains `id`, `detected_at`, `expires_at`,
`details_unavailable` and `mods`. Supporting mod entries contain a catalog `id`, `name`, capability `explanation`,
`detected_at` and `expires_at`. Timestamps are milliseconds since the epoch; the inclusive seven-day window excludes
future reports. A timestamp-only historical Interdict marking appears as Item Cheats with empty `mods` and unavailable
details. New categories are informational and do not alter Social Only enforcement. Flagged-mod details follow the
existing roster/applicant audience and remain visible when ordinary active-mod sharing is disabled; complete runtime
mod lists retain their separate visibility gate.

## Loaded-save tracking

Registration and authentication optionally accept `client_runtime.loaded_save`:
`{load_id, save_timestamp, client_loaded_at, capture_source}`. `load_id` is a UUID for one game load;
reconnecting reports the same ID and snapshot. `save_timestamp` is a positive safe-integer timestamp in milliseconds,
or null when unavailable; `client_loaded_at` is a non-negative safe-integer client timestamp in milliseconds.
`capture_source` is `decode` for capture immediately after save decoding or `character_loaded` for a later fallback.

The server retains the first observation per Client/load ID and updates only its last server report time on reconnect.
Current sessions reference that observation; replacing sessions does not remove load history. Clients omitting the
report keep their existing authentication contract. Reports are player assertions, not proof of save integrity.
The server now records observational rollback incidents for prior outgoing activity when a new load is admitted.
Reconnects retain the original observation and never compare that load with its own later operations. Independent
incoming rewards and server decisions do not establish restored deductions. The persisted mitigation policy defaults
OFF. Explicit prospective opt-in activation can hold admission while classification/correction completes; ordinary
unaffected clients retain their existing recovery. No repeat threshold, ban, debt or retention purge is configured.

Tracked bootstrap responses add `rollback_clock_sample: {server_admitted_at, load_id, original_handshake}`; untracked clients receive null.
The new client timing interface is `POST /api/v2/save-load/clock`, authenticated with the resulting session, accepting
`{server_admitted_at, client_sent_at, client_received_at, elapsed_ms}`. All values are non-negative safe integers in
milliseconds; `elapsed_ms` is the measured monotonic duration of the original handshake, rounded to an integer.
Registration and the first authentication for a Client/load return `original_handshake: true`; same-load reconnects return false.
The server admission time must match the session's original load. The first accepted sample is retained unchanged;
retries return success. Do not submit reconnect timing against an original admission sample. This endpoint returns
`{success: true, rollback: STATUS}` or a validation error, without incident/candidate/correction details.
The original report and its admission processing share one immediate transaction; a retry after failure cannot leave
confirmed partial correction. Reconnect timing must never be substituted for the original handshake.

The admission event falls between the client send and receive times. Translating the decoded save timestamp through
that interval yields lower/upper server cutoffs. Prior operations inside the uncertainty interval remain uncertain;
operations beyond its upper bound require matching calibrated installation/clock evidence to be definite timestamp
candidates. Missing provenance, fallback capture, missing/changed clocks or devices, future timestamps, calibration
after 60 seconds, RTT above 30 seconds, or wall/monotonic disagreement above 50 ms remain review-only. These gates
classify evidence quality. Automatic correction additionally requires enabled prospective Client opt-in, explicit
protocol capability, a confirmed decision and exact custody. Uncertain/historical evidence stays review-only.
The mod advertises `save-rollback-v1` and measures send/receive at actual scheduled fetch dispatch, before response
body consumption. It stores the original validated sample by selected server, Client and load, retries it after a
lost clock POST, and reuses it on reconnect. Without a retained original sample it never fabricates reconnect timing.
Supporting servers with missing or malformed status keep unsafe client actions closed. Legacy servers retain their
existing behavior. Admission release requires a complete events/receipt snapshot before ordinary command submission.
Review/upgrade responses preserve the exact pending command. Exact retired command IDs clear recovery records without
applying any Bank, GP or Transfer deduction. Immutable issued claims and terminal recovery reach the server's custody
gates even during review; independent incoming receipts remain applicable.

Older-save notices use the native informational modal queue, four-second timer and progress bar, without a confirm
button. They contain only the generic localized title/message. A per-server/Client/notice marker is saved on actual
modal opening, followed by owner acknowledgement with retry; stale callbacks cannot acknowledge a different session.
Legacy Wish recovery records without an explicit Client owner remain intact and block new Wish actions with a Support
review message. Only records with an explicit valid owner and compatible server stamp migrate to that owner's key;
conflicts remain intact. The currently connected identity is never used to guess ownership.

### Optional rollback protocol

`GET /api/versions` advertises `capabilities: ["save-rollback-v1"]`. A supporting client sends
`client_runtime.capabilities: ["save-rollback-v1"]`; release version alone is insufficient (1.6.10-B lacks support).
Missing capability is ordinary compatibility metadata, never misconduct. Session persistence and cache reloads retain
this promise separately from the latest Client runtime snapshot.

Capable bootstrap responses add `rollback: STATUS`. Authenticated `GET /api/v2/save-rollback/status`, successful clock
responses, and `/api/v2/events` (including unchanged snapshots) return the same private-to-owner status:
`{protocol:"save-rollback-v1", admission:"waiting"|"review"|"ready"|"released", economy_review_pending:boolean,
upgrade_required:boolean, notice:null|{notice_id,kind:"older_save"}, retired_command_ids:string[]}`.
Retired IDs are bounded to the latest 64 commands; exact journal replay remains authoritative beyond that window.
No affected items, amounts, candidate events, counts or cleanup results appear in the status or notice.

On a new opted-in load, wait for the original handshake's clock report and a non-held status before recovering outgoing
receipts or submitting new economy commands. `/api/events` withholds outgoing effects during a shared Client hold,
but keeps valid incoming receipts. Eligibility is applied before the 64-receipt limit. Affected unsupported sessions
also withhold unretired outgoing effects after admission release or enforcement disable; each session's retained
capability controls this recovery, independently of the latest runtime snapshot. A new client connecting to an older backend must treat absent capability/status
fields as the existing protocol, and must not require new endpoints there. Reconnects reuse the frozen load and
original sample; if original timing is unavailable, do not fabricate it. Review may require operator resolution.

Unsafe held economy returns HTTP 409 `{success:false,error:"economy_review_pending",message}`. Affected unsupported
sessions receive HTTP 426 `{success:false,error:"economy_upgrade_required",required_capability:"save-rollback-v1",message}`
only for unsafe actions. Safe reads, Chat, profile sync, acknowledgements, original incoming/acknowledged receipt
replay, original Wish-command replay and already-issued Inbox/return claim recovery remain available. Counterparty
Gift/Trade/Marketplace source-changing mutations and shared-account Wish/Slag mutations also respect participating
Client holds. Wish/Slag sibling coordination is limited to the shared Guild. Terminal Haggle claims and settled Trade
Inbox delivery preserve the other party's entitlement despite that party's source owner being held; the requesting
actor's own uncertain unissued benefits remain gated. Friends, independent Raid/work actions, Market search/catalog,
and non-mutating Guild applications remain available; membership/departure and Council cleanup paths stay gated.
New claims are held; replay returns the existing issued claim snapshot. No Social Only transition implements a hold.

A retired outgoing command always returns `{success:false,error:"economy_command_retired",retired_command_id,receipt:null}`
to capable sessions, including after enforcement is disabled. Retire the matching local journal/replay marker without
applying any Bank/Transfer Inventory effect. Unsupported affected sessions must upgrade to handle that disposition.
Original signed receipts and correction evidence remain immutable.

Queue the generic localized informational modal after the game UI is ready. Title: **Older save detected**.
Text: **An older save seems to have been loaded. If you think this is an error, please message Multiplayer Support.**
Use the same text for all cases. `POST /api/v2/save-rollback/notice/acknowledge` with `{notice_id}` acknowledges delivery
only (200 success or 404 for missing/wrong owner); it never dismisses an incident or releases a hold. Persisted notice
identity survives restored saves/reconnects; retrying acknowledgement is idempotent. Fetch the next pending notice after
acknowledgement. Client UI/journal/timing implementation and full integration acceptance remain the next slice.

## Profile registration and recovery (1.6.15)

`GET /api/versions` advertises `identity-registration-v1`. `POST /api/register` optionally accepts a UUID
`registration_id`, used as the new `client_identifier`. Clients persist and read-verify a pending UUID identifier plus
`client_key` in origin/account-scoped character storage and require a verified native save before sending. Requests
without this field retain the generated-identifier contract for older clients.

The backend remains compatible with 1.6.14 authentication, registration and installation enrollment. That client can
reconnect another device using the keeper profile's binding carried in a native save, including a cloud save. The
target device authenticates with that proof and enrolls its own installation credential for the keeper identity;
both installations can retain access when the duplicate identity is later disabled. This does not merge server data.
The older client's automatic registration on missing proof remains unchanged until the client is upgraded.

The registration transaction checks for an existing identifier before insertion. Repeating the same identifier,
save proof and exact account association returns HTTP 409 with `{identity_status: "registration_exists"}`;
the client then uses `/api/authenticate` to obtain the retained profile and preferences through normal authorization.
A different proof/account, or a disabled/deleted existing profile, returns 401 without changing it. A replay never
creates another registration audit event. Pending authentication uses that same saved proof after a lost response;
registration replay is bounded to one authentication attempt per connection attempt. No schema migration is required.

The 1.6.15 client offers explicit existing-profile recovery or confirmed creation when proof is absent or rejected. The
exception for valid legacy proof associated with a different active Melvor account still creates that account's own
Client, as before. New clients refuse registration on servers lacking the capability; healthy authentication works.

A portable `MP1.` recovery code contains the normalized origin and save-carried UUID identifier/key, encoded as
base64 JSON. It is a bearer credential, not encryption, an account lookup, or a new source of authority. Imported proof
must pass the ordinary authentication route, including supplied installation revocation and account-association
checks, before replacing a binding. Successful import saves the binding before activation. User-facing guidance
warns against sharing codes or credential-bearing saves. Neither codes nor authentication payloads are logged.

## Recovery

A logical command retains its original UUID, payload, command kind, and originating API major across retries and
reloads. The client stores one unresolved outgoing command per identity within its server-origin storage namespace.
It reconciles pending receipts before allowing new spending; the first event read requests a full snapshot.

All retries share the same server journal. Owner-and-command-kind replay precedes domain input validation
so a changed runtime report cannot prevent retrieval of an already committed result. Acknowledged replay returns no receipt effects. Upgrading does
not create new identity namespaces or discard processed IDs, pending Inbox/return claims, or local Transfer Inventory.
Existing saved Social Only commands without protocol metadata recover through v1. Automatic unavailable-item Gift
declines and Charity confirmations also retain their pending action until a definitive outcome.

Independent event summaries and Gift content reads continue while an Economy Receipt is blocked. A blocked receipt
is never acknowledged or skipped, and the client does not advance its event revision past that receipt. Retrying a
Charity confirmation reuses its saved snapshot rather than donating the current inventory again.

Crucible Wish creation in 1.6.11+ uses the Economy Receipt journal (`crucible-wish-make`).
Make submits `{command_id,item_id,qty,ep_micros,gp,gp_balance}`. The server validates the current integer quote,
spends character EP, creates the Wish, and adds the upfront GP Offering atomically; its receipt deducts GP locally.
Quantity is 1–1000. Below the active base, EP is rounded upward to 0.001; above it, each +100 increment
costs 2 EP, then 3, 4, and so on, in addition to 1 EP; partial increments are prorated and the total rounded
upward to 0.001 EP. For example, 101 items at base 100 costs 1.020 EP. GP is half the full funding requirement, rounded upward
to whole GP. Funding progress starts at zero. Cancellation refunds neither charge.

`/api/crucible/contents` includes `capacity`: base, expiry, renewal enabled/paused flags, exact EP balance,
renewal price and tier purchase/full prices in micro-EP. `/api/crucible/wish/capacity` submits
`{command_id,base,ep_micros,auto_renew}`; `/api/crucible/wish/renewal` submits
`{command_id,ep_micros,auto_renew}`, where `ep_micros` confirms the current full renewal price.
Both use receipt journals with no local effects. Character capacity defaults to 100; tiers 200/300/400/500 cost
10/30/60/100 EP outright, or the difference for an active upgrade. Every purchase sets expiry to 30 days from
purchase. Active tiers cannot be purchased again or downgraded; tier purchase prices are zero at or below
the active base. Renewal-setting commands charge no EP and leave expiry unchanged. After expiry, a tier
can be purchased again at full price. Automatic renewals settle at scheduled 30-day boundaries before later EP credits. Insufficient EP
expires the buff and pauses renewal permanently until an explicit new purchase. Accepted Wish quantities survive expiry.

Upfront GP uses Cast contribution custody and an account/Guild GP reclaim lock lasting four hours. The lock is
independent of Offering generations, so merges cannot remove it. Merges reset Meld progress; even maximum Heat
needs six hours to Meld, preventing an earlier indirect return through Wish funding or Gloop.

Wish Cancel and Claim retain their dedicated server journal and server-owned outcomes. Historical committed Make
commands replay that journal without a new charge after upgrading. New Make commands require validated EP/GP
quotes and an Economy Receipt; the server-only free Make request contract has been retired.
All receipt replays precede current domain validation, including changed Guild membership, expiry or balances.

Do not delete historical value queues or journal rows as part of API retirement. Marketplace legacy payouts and
participant transfer protocol records are retained until a separate value-conservation reconciliation proves removal safe.

## Chat item tags (1.5.12)

Chat sends optionally include `parts`, an ordered array of `{type: "text", text: "..."}` and
`{type: "item", item_id: "melvorD:Bronze_Sword"}`. The server normalizes adjacent text and outer whitespace,
allows at most 20 item occurrences and 100 input parts, and enforces the existing 1,000-character limit on its
readable fallback string (including bracketed item names derived from IDs). Item identifiers are bounded to 256
characters and the official `melvorD`, `melvorF`, `melvorTotH`, `melvorAoD`, and `melvorItA` namespaces; the server
validates identifier syntax, while clients resolve actual registered items. Modded namespaces are rejected.

The existing `content` field remains required for compatibility; when parts are supplied, the server derives content
from them. Identical idempotency keys must preserve both content and item identities. Tagged Messages return `parts`
in send responses, history, and inbox previews. Persisted translations additionally expose `translation_parts` keyed
by language, alongside the existing readable `translations`. Clients resolve each item in their own game language.
Unknown local items remain visible as unavailable references. Ordinary text-only clients and historical Messages
continue using their existing strings.

Azure receives one server-generated HTML sentence with escaped text and numeric occurrence markers such as
`<span translate="no">0</span>`, using `textType=html`. Returned markup must contain exactly one of every expected
marker and no unexpected markup; marker order may change. The server decodes text once, rebuilds typed parts, and
stores the result atomically. Failed validation follows bounded translation retries and falls back to original
content. Item-only Messages skip the external request. HTML is never used as a client rendering payload.

## Guild Alliances (private preview)

Alliances remain a private preview in 1.6.2. Every Alliance operation requires an authenticated session reporting
1.6.2 or later (or development), linked to the stored preview account selected in `server/alliances.ts`.
The operator may disable the preview for every account, including the selected account, without deleting Alliance data.
Identity startup and event snapshots return `alliance_access` for client visibility. Other accounts retain ordinary
Council and same-Guild Marketplace access, with Alliance Petitions and Guild activity entries filtered out and
Alliance Chat excluded from conversations and unread totals. Both participants must qualify for cross-Guild
Marketplace access. Runtime headers and character display names cannot bypass these gates. Ordinary Free Fellowship
Council features remain available to every 1.6.2+ client.

- `GET /api/alliances` returns current Guild summary, membership, affiliation-pending state, and bounded process history
  prioritizing unfinished processes. Collective tallies contain eligible/Aye/Nay totals and the viewer's own Guild ballot.
- `GET /api/alliances/discover?mode=found|join&page=0` returns 20 candidates and `has_more`.
- `GET /api/alliances/guild-preview?guild_id=ID` returns basic Guild identity, member count, establishment and policy Tags. An absent Guild returns HTTP 200 with `{ "guild": null }`, allowing historical references without browser 404 errors. Invalid IDs and access failures retain their error statuses.
- `POST /api/alliances/propose` accepts `{kind, target_id?, name?}`; kinds are `found`, `join`, `leave`, `remove`,
  `market_enable`, and `market_disable`. Successful creation returns `process_id` and the local `petition_id`.
- `POST /api/alliances/consider` and `/withdraw` accept `{process_id}` and return a Council `petition_id`.
- Existing Council vote routes handle linked Alliance Petitions. New individual ballots reset a common 24-hour
  inactivity deadline; frozen electorates and resolved Guild ballots remain unchanged.
- Destructive Alliance decisions (`leave`, `remove`, `market_disable`) require Aye to outnumber Nay;
  a zero-vote deadline denies them. Other zero-vote deadline consent remains unchanged.
- When an Alliance majority accepts or defeats a proposal, unfinished Member Guild ballots resolve immediately
  from their current tallies and record their Alliance votes. They are not marked withdrawn. Completed history
  remains unchanged; cancellation, expiry, and explicit withdrawal retain their existing behavior.
- Existing Chat routes accept `conversation_kind: "alliance"` and the Alliance ID. Participation is independent through
  `POST /api/chat/alliance-participation` with `{enabled}`. Membership authorizes every operation.

Shared Marketplace uses existing Buy, Buy Order, fulfill and Haggle commands and Economy Receipts. Cross-Guild
permissions are checked in the same transaction as settlement; losing access restores active reservations and escrow
through existing claims. Terminal claims and original command replay remain recoverable. Policy-loss cleanup never
reverses committed purchases. Player responses omit member-proposal initiators and other Guild ballot identities or
timestamps; founding participants, applicants and removal targets remain named as subjects of their proposals.

## Page snapshots (1.6.6)

`GET /api/versions` advertises `page_snapshots: true`. Clients without that capability continue using the individual
reads. `GET /api/v2/pages/snapshot?page=transfers|guild|decisions` authenticates and charges one request, then returns
`{ data: { "/api/logical/read?query": <existing read model>, ... } }`. The page names select fixed server-owned lists;
unknown names return 400. All underlying Client ownership, Guild membership, Social Only, version and Alliance access
checks remain effective. Unavailable sections return `{ status: HTTP_STATUS }` or the existing domain error model.

Transfers includes Inbox, Haggles and the first page of each of the three history feeds. Guild includes Guild state,
Council, Alliance, initial Shadowed Members and Activity; Guildless Clients receive state and discovery instead.
Decisions includes Guild state, Council and Alliance for background badge updates. Existing routes and pagination
remain unchanged for 1.6.5 clients. Snapshots do not claim items, acknowledge receipts or replace mutation protocols.

The 1.6.6 client shares selected page reads for 15 seconds, invalidates affected reads after mutations and changed
Events, and paces requests with acknowledgement priority. HTTP 429 applies a shared `Retry-After` cooldown; GETs retry
once, while writes retain their existing explicit recovery protocol.

## Transfers exchange history (1.6.9)

`GET /api/v2/transfers/history?pane=inbox|outbox|pending` may include an optional `exchange` object on a
history entry: `{ label: "purchased" | "paid" | "sold" | "proceeds", item_id: string, qty: number }`.
It is unsigned presentation context for the other half of a direct Marketplace purchase or Buy Order fulfillment;
`items` continues to contain only the existing recorded movements. Paid and Proceeds use the actual payment currency
and total, and Purchased and Sold use the actual exchanged quantity. Clients must not apply exchange context as an
economy effect. Claim source breakdowns and receipt replay are unchanged. Older entries without reliable retained
context omit the object. Transfers page snapshots reuse this same read model.

### Standalone shell and demo definitions (unreleased 1.6.15)

`GET /chat` serves the browser shell; `/chat/` redirects to it. Only the explicitly registered
`/chat/assets/chat.css`, `/chat/assets/chat.mjs`, `/chat/assets/transport.mjs`,
`/chat/assets/controller.mjs`, and `/chat/assets/render.mjs` assets are served.
Unknown paths return 404 and known paths with unsupported methods return 405. The shell uses self-hosted
scripts/styles, same-origin API requests, no inline user HTML, and no-store/referrer/nosniff/CSP protections.

`GET /chat/api/data?locale=en|de|zh-CN` requires a valid cookie, `X-Chat-CSRF`, and explicit
`X-Chat-Link-ID`. It returns `{locale,items:[{id,name,media}],provenance}`. Unsupported locales and unavailable
localized labels fall back to English. It is a fixed official demo adapter, not a URL relay or complete game
registry. Only official demo JSON, the three fixed language files and the official asset-resolver source text
are fetched; upstream scripts are never executed and browser credentials are never forwarded upstream.
Artwork is allowed only when the inspected resolver establishes the supported official CDN and item media path.
Unknown DLC/mod items retain readable local and canonical IDs without guessed media.

Each upstream response is capped at 8 MB while streaming, uses a 15-second timeout and rejects redirects.
Five fixed cache keys share in-flight requests, remain fresh for one hour, and may serve validated stale data
for at most 24 hours from fetch during source failures/schema drift. Provenance includes adapter version,
package, source paths, oldest fetch timestamp and stale status. The route authorizes again after upstream
I/O, including failures; a revoked selection cannot receive the result. Data failures leave linking usable.

The shell stores only the selected nonsecret link ID in tab-local session storage. CSRF stays in memory;
linking codes are cleared on submit and never retried automatically. Initial linking holds an origin-wide
Web Lock around session recheck, exchange and bootstrap; without Web Locks the page instructs single-tab
linking and fresh-code recovery after simultaneous anonymous exchanges. The server cannot merge two fresh
anonymous requests. Identity switches abort pending reads, invalidate late responses, and clear old content.
Selected-link 401 responses re-bootstrap remaining links without discarding another valid identity.
The responsive inbox and composer use only the authenticated shared Chat API below. Only the foreground selected
conversation requests history (history reads acknowledge returned Messages); inbox polls never fetch every thread.
Older pages, incremental Message/reaction cursors and moderation-count invalidation use the shared read model.
Foreground polling is single flight with finally rescheduling, bounded jitter/backoff and server retry guidance.

Drafts, typed tags, people, cursors, history and pending sends are isolated in memory by selected link and conversation.
A lost/aborted send retains its original payload, identity and idempotency key; only explicit Retry sends it again.
Switching never automatically sends or retargets a pending payload. The page warns before reload while a result is
unknown, because reload loses that in-memory recovery state. No Message body or bearer is stored in browser storage.
Presentation language selects persisted translations and validated demo item labels without changing game runtime;
original text remains available. Missing translations/items use readable text/canonical IDs. Upstream item failures
leave the inbox and composer usable. All Message/translated/tag text uses DOM text nodes; artwork accepts only
validated official demo CDN media. Private-only participant hiding is separate from host moderation, which this UI
never exposes. Virtual Support welcomes have no durable Message actions before materialization.

### Standalone shared Chat adapter (unreleased 1.6.15)

Every route below requires the browser cookie, `X-Chat-Link-ID`, and `X-Chat-CSRF`, including GET.
POST also requires the configured Origin and JSON. Payloads and ordinary Chat read models match the
corresponding `/api/v2/chat/` routes; there is no game credential or cookie fallback between transports.

| Method | Exact `/chat/api/` suffixes |
| --- | --- |
| GET | `state`, `profile` (including `people=1`), `conversations`, `messages`, `messages/details` |
| POST | `conversations/start`, `messages/send`, `messages/reaction`, `global-participation`, `guild-participation`, `alliance-participation`, `block`, `privacy`, `messages/delete`, `conversations/delete` |

The server supplies only `global-chat-v1,guild-chat-v1` capabilities, ignoring browser capability parameters.
Supported `conversation_kind` values are `private`, `global`, `guild`, `alliance`, `support`, and `testers`
(Expedition Chat). Poll/Petition discussions and unknown kinds return 400 before domain dispatch on every
exposed path, including people queries. Participant deletion accepts only omitted/`private` kind, preventing
numeric ID collisions from deleting another domain's Private history. Delete-for-all and other game actions
are unregistered (404); known wrong methods return 405.

Shared synchronous handlers run inside selected-link authorization's SQLite transaction. They retain canonical
conversation permissions, current membership, participation, Blocks/privacy, shadow visibility, Support exact-Client
membership, immutable idempotent sends, typed parts, translation markers, reactions and read acknowledgements.
History reads acknowledge returned Messages; callers must fetch only the visible selected conversation.
Browser state omits `is_admin`, inbox entries omit `can_moderate`, and Poll summaries/counts are absent.
Profile construction disables admin overrides before calculating private fields, even for a linked administrator.
Message details use ordinary reaction visibility and expose readers/reactors only for visible Messages.
Browser dispatch updates its selected link's browser clock and normal Chat state, without game activity,
runtime, save admission, Expedition catch-up, identity recovery, or economy operations.
