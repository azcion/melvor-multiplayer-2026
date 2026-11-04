# Multiplayer Wiki

A public player handbook at `/wiki/`, maintained by agents in version-controlled files. It is a standalone
static site. Building or publishing it does not require Bun, the Multiplayer API, a database, or a backend
release. There is no web editor or login. The handbook bundles its artwork and has no third-party requests. The unlisted Expedition art preview uses the mod’s public R2 artwork at `cdn.melvor.azcn.io`.

## Concept

The wiki introduces Multiplayer through practical player tasks, then provides concise reference guides.
The visual language follows Browser Chat: dark blue-gray panels, muted teal borders, green accents, existing
Multiplayer artwork, and readable system typography. Desktop has a category sidebar; mobile has an expandable
navigation menu that stays at the top while reading. Its expanded list scrolls within the screen; Escape
closes it and returns keyboard focus to the toggle. Reading and navigation work without JavaScript; search
progressively enhances the pages.

| Category | Contents |
| --- | --- |
| Getting Started | First steps, choosing a Guild, Social Only |
| Guilds & Alliances | Guild life, Council, Alliances |
| Economy & Transfers | Transfer Inventory and Inbox, Marketplace |
| Crucible | Offerings, Reclaim, Heat, Wishes, and Slag |
| Raid | Weekend Raids, Assaults, and rewards |
| Expedition | Chambers, tasks, tracking, and EP |
| Cheat Tags & Mods | Six tags and a searchable list of approved mod classifications |
| Chat & Support | Conversations, Browser Chat, getting help, glossary |

Crucible, Raid, Expedition, and Cheat Tags & Mods are top-level feature links that open their guides directly.
Keep navigation aligned with the mod’s concepts; do not hide these features inside invented umbrella categories.
Home offers a three-step first-session path and the full category map. Articles have stable URLs, section
permalinks, a contents list, and related guides. Search includes titles, summaries, aliases, and body text.
Initial coverage is an introductory handbook, not an exhaustive item database or a promise of live availability.
Expansion should deepen the existing categories before adding new ones. The Handbook explains Multiplayer;
base-game item and combat data belong in the Melvor game/wiki rather than copied tables that will drift.

## Build, test, preview

From the repository root, using Node.js 22.18 or later (no dependency installation):

```sh
node wiki/scripts/build.mjs
node --test wiki/tests/wiki.test.mjs
node wiki/scripts/preview.mjs
```

Open `http://127.0.0.1:3080/wiki/`. Set `WIKI_PORT` to use a different local preview port.
Output is under `wiki/dist/wiki/`; serve **`wiki/dist`** as the web root so `/wiki/` remains intact.
The preview is a loopback development tool, not the production server. `/chat` intentionally belongs to the
existing host and returns 404 on the isolated wiki preview.

## Agent editing contract

1. Edit the relevant category JSON under `content/`. These files are the only article source of truth.
2. Check gameplay claims against owning implementation and current English UI text. Do not infer live activation
   from local source. Avoid prices, limits, policy promises, or feature availability that you cannot verify.
3. Keep article and section IDs stable: they are public bookmarks. A renamed title does not need a renamed ID.
4. Each article needs `id`, `title`, `summary`, `aliases`, `sections`, and `related` article IDs. Every section needs
   an `id`, `title`, and at least one of `paragraphs`, `bullets`, or `steps`. Optional `note` adds a callout, `formulas` lists plain-text equations, and `reference` selects a generated gameplay reference.
   Text is plain text, escaped by the renderer; HTML and Markdown syntax are not interpreted.
5. Write as one player explaining the game to another. Start with what someone wants to do, explain unfamiliar
   terms when they become useful, and say what happens after an action. Prefer concrete examples and short
   paragraphs to abstract descriptions of systems, boundaries, or state. Use canonical product names without
   turning every sentence into a list of labels. Keep important costs, restrictions, and consequences clear.
   The Crucible article is the reference for tone; the glossary can stay a concise list of definitions.
6. Add search aliases for common player wording. Link related articles rather than repeating their rules.
7. Never include private host operations, credentials, player records, or internal investigations. No source
   files from `agents/` or runtime player data are included in the generated site.
8. Run the build and tests, inspect affected pages at desktop and mobile sizes, and update the public-source
   allowlist for any new source file. Publish wiki files independently after deployment authorization.

The generator rejects malformed fields, unsafe/duplicate IDs, and broken related links. Tests also resolve
all generated local links and section anchors and check search, escaping, and HTTP behavior.

## Independent hosting

`compose.yaml` runs only a static Nginx server on loopback port 3080. It is deliberately separate from the
backend Compose project. The read-only `/srv` mount contains a `current` symlink pointing at a complete
release directory; replacing that symlink changes the served files without restarting the container.
`nginx.conf` serves `/wiki/`, returns real 404s, uses relative redirects, and sends restrictive security and
revalidation headers. It neither proxies nor connects to the Multiplayer backend.

A generic on-host directory layout is:

```text
wiki-host/
  compose.yaml
  nginx.conf
  site/
    current -> releases/RELEASE
    releases/
      RELEASE/
        wiki/
          index.html
          assets/
          ...
```

Copy the generated `dist/` contents into `site/releases/RELEASE/`, create the relative `current` symlink,
and start `docker compose -p melvor-wiki up -d` in `wiki-host/`. The generated `wiki/revision.txt` fingerprints
all page and asset bytes. Preserve previous release directories for rollback; content updates only need a
new directory and atomic symlink switch. Recreate the static server only when its image or config changes.

Route the public hostname's **`^/wiki(/.*)?$`** path to `http://127.0.0.1:3080` before the existing catch-all
backend rule. Keep `/chat`, `/mod/`, `/api/`, and `/health` on the backend. Browser Chat imports shared modules
from `/mod/`. For a complete self-hosting example and the setting that advertises your wiki to clients, see
[self-hosting](../docs/self-hosting.md#optional-player-wiki). For a remotely managed tunnel,
change its published-application configuration; for a locally managed tunnel, change its ingress config.
This one-time routing setup is independent of subsequent wiki content updates. Consult
[Cloudflare ingress configuration](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/)
and [Nginx static file routing](https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files).

Do not add this site to the backend image, backend deployment script, or backend version counter. No game mod
ZIP is needed for wiki-only changes. The same generated files can move to another static host in the future.

For an already-running static server, run `node wiki/scripts/check-host.mjs http://127.0.0.1:3081`
with its actual origin to verify production MIME types, headers, redirects, and missing-page behavior.

## Mod lookup and UI symbols

`/wiki/cheat-tags/` explains all six tags and renders a mod lookup from the existing
`server/cheat-mod-catalog.json` at build time. Only approved, high-confidence, non-superseded classifications
are included. The generated HTML contains mod.io IDs, names, curated aliases for search, tags, and public
explanations; review rationale and pending mappings are excluded. Names and IDs also appear in global wiki
search. The complete list works without JavaScript; the local filter adds name/ID search and tag selection.
An absent result is never presented as approval. The displayed catalog hash identifies the public snapshot,
not the live backend version. Rebuild/publish the wiki to refresh it; no runtime backend request is made.
Editing the wiki does not deploy or change backend classification policy.

UI navigation symbols are six individually vendored Material Symbols Outlined SVGs, not a full icon font.
CSS masks let them inherit text color. Sources, revision and Apache license are in `assets/material/`.
No Google request is made at build time or by readers. Keep game feature artwork separate from UI symbols.

## Gameplay numbers and calculators

Crucible Heat, Wish prices and all wishable items are generated at build time.
`game-reference.mjs` reads `server/openable-wish-values.json` and imports the pure TypeScript helpers in
`server/crucible-values.ts` and `server/wish-capacity.ts`.
Node’s built-in type stripping needs Node 22.18+. These imports do not start Bun, load a database, or make
network requests. This uses repository data at build time; the deployed wiki is still entirely static.

`calculators.mjs` enhances the pre-rendered tables locally. Wish quotes use the same `mod/crucible-rules.mjs`
shipped with the game client. Historical donation formula tests use `supply-math.mjs` and the catalog in
`server/tests/fixtures/expedition-supply-catalog-v1.json`; the generated wiki no longer offers donation quotes. The Wish
catalogue lists every entry, including expansion items; in-game discovery and content ownership can limit
what a character sees. Global search indexes the item names and IDs. Curves and default tables remain
readable without JavaScript. Rebuild and publish the wiki when owning game rules or catalogues change.

## Unlisted art preview

`/wiki/expedition-art-preview/` is a standalone planning helper, excluded from handbook navigation and search,
with a `noindex, nofollow` robots directive. It is public to anyone with the URL. Its reviewed sources live in
`helpers/expedition-art-preview.html` and `assets/expedition-art-preview.{css,mjs}`; the local prototype remains
separate. Image URLs pin the same immutable R2 objects used by the mod. Only originals already hosted in R2
are offered for comparison. This page describes proposals, not live Guild progress or guaranteed release behavior.
