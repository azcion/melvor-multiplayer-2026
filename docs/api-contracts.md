# Multiplayer API contracts

The minimum supported mod version is 1.5.9. The hosted API exposes one current wire contract, API v2; backend deployment
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
