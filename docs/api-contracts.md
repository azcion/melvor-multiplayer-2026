# Multiplayer API contracts

The minimum supported mod version is 1.6.1. The hosted API exposes one current wire contract, API v2; backend deployment
versions remain independent of mod releases.

Authentication may include `social_mode_enforcement` as `identity`, `account`, or null. When non-null, the effective
`social_mode` is `social`, Full-mode changes return `MOD_MP_SOCIAL_MODE_ENFORCED`, and every Social Only authorization
gate remains authoritative for both API majors. Older clients safely receive the effective mode without needing the
new field; 1.5.8 uses it to explain the operator restriction and hide the unavailable Full Experience choice.

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
  Social Only authorization apply on both versions. Unsupported reported clients cannot bypass the refresh gate by
  changing the URL prefix.

The contract tests cover the current v2 route/method boundary directly; historical release inventories remain in the
compatibility cleanup plan rather than executable fixtures.

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

Charitree Wish Make, Forsake, and Pick commands use UUIDs and a dedicated shared server journal on every API alias.
They do not issue Economy Receipts: Make and Forsake move no character value, while Pick atomically places the reward
in the server-owned Inbox, whose existing claim receipt handles later character-side delivery. Clients older than
1.5.7 receive ordinary Charitree contents without Wish fields and cannot operate the Wish endpoints.

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
- `GET /api/alliances/guild-preview?guild_id=ID` returns basic Guild identity, member count, establishment and policy Tags.
- `POST /api/alliances/propose` accepts `{kind, target_id?, name?}`; kinds are `found`, `join`, `leave`, `remove`,
  `market_enable`, and `market_disable`. Successful creation returns `process_id` and the local `petition_id`.
- `POST /api/alliances/consider` and `/withdraw` accept `{process_id}` and return a Council `petition_id`.
- Existing Council vote routes handle linked Alliance Petitions. New individual ballots reset a common 24-hour
  inactivity deadline; frozen electorates and resolved Guild ballots remain unchanged.
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
