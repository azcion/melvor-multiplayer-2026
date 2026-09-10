# Multiplayer API contracts

The minimum supported mod version is 1.5.1. API major versions are independent of mod releases and backend deployment
versions. Existing clients continue using their original URLs and JSON contracts.

## Selection

`GET /api/versions` returns `api_versions: [1, 2]` and `preferred_api_version: 2`. Clients select before authentication,
then use `/api/v2/register` or `/api/v2/authenticate`. Successful explicit-version bootstrap responses include
`api_version` and `api_versions`. The packaged 1.5.5 candidate implements this selection.

`/api/...` and `/api/v1/...` share v1 handlers, authorization, rate limits, and command journals. An older server without
discovery (404/405) can be used through the original `/api/...` v1 paths. Transport failures, invalid discovery, or
failed mutations never cause automatic version fallback. Unknown majors return 404; invalid methods on known paths
return 405. `/health` is independent of API versioning.

## v2 differences

- Receipt-backed economy mutations require a lowercase, hyphenated UUID `command_id` before any domain mutation.
  v1 retains its existing omitted-ID behavior. Claim/acknowledgement protocols retain their existing identifiers.
- Authenticated reads use GET. v1 retains historical JSON POST read aliases; v2 exposes POST only for explicitly
  registered POST operations. Binary upload and CORS preflight remain available on versioned paths.
- Status sync uses `activities`. Omission leaves activities unchanged; an empty array clears them. The legacy
  `activity` request field is rejected. Skills and Activity visibility use their separate endpoints; the combined
  `/client/status/visibility` route and `status_visible`/`status_available` response aliases are absent in v2.
- Server-owned pets and reward computation are part of v2 regardless of optional runtime metadata. v1 keeps the
  supported 1.5.1/1.5.2 reward bridge. Historical recipient delivery rules are retained on both versions.
- Optional runtime metadata is not an authentication credential. Session, installation, Guild, ownership, and
  Social Only authorization apply on both versions. Unsupported reported clients cannot bypass the refresh gate by
  changing the URL prefix.

The exact baseline route/method inventory is in `server/tests/fixtures/v1-route-manifest.json`. The contract tests
also retain SHA-256 provenance and endpoint inventories from the actual supported release ZIPs.

## Recovery

A logical command retains its original UUID, payload, command kind, and originating API major across retries and
reloads. The client stores one unresolved outgoing command per identity within its server-origin storage namespace.
It reconciles pending receipts before allowing new spending; the first event read requests a full snapshot.

All aliases and majors share the same server journal. Owner-and-command-kind replay precedes domain input validation
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

Keep a backend serving both majors available after distributing v2 clients. Do not remove v1 while supported old
clients remain, and do not delete historical value queues or journal rows as part of API retirement.
