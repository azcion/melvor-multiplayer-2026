# Chat data proof of concept

From the repository root, run `node scripts/chat-data-poc.mjs`, then open
<http://127.0.0.1:3347>. Requires Node 22 or later. Override the port with `CHAT_DATA_POC_PORT`.

This is a localhost experiment, not a deployed chat client. It has no authentication, Multiplayer connection,
cookie persistence, or real Messages. Search official demo items, choose one, preview a tagged Message, and
switch English/German/Simplified Chinese item labels. It does not load a character or execute upstream game scripts.

The page first attempts a credential-free browser fetch of the official demo package. If that fails, it uses
an exact-file, same-origin relay. The relay fetches original official responses, caches them in memory until
restart, and never writes upstream content into the repository. Images load directly from Melvor's CDN.
The CDN origin is discovered from the official asset resolver source without evaluating it; unexpected resolver
syntax fails visibly. The tool permits only the observed production CDN for artwork. Source links and image
success/failure counters are visible in the page.

Source paths were identified in the official `cloudManager.js` (`loadGameData`), `language.js`
(`fetchLanguageJSON`), `item.js` (name/media getters), `namespaceRegistry.js` (`getMediaURL`), and `assets.js`
on 2026-10-16, web build `?12097`, at <https://steam.melvoridle.com/>.
The demo package has 671 item definitions in that observed response. This experiment only reads its `data.items`;
it does not implement dependent data, modifications, event packages, custom namespaces, full item descriptions,
or gameplay logic. It is not a complete replacement for the game registry.

Full-game and DLC packages are outside this experiment: the official loader selects them using entitlement
checks. Public reachability alone does not establish permission for public reuse or redistribution. Production
work must settle allowed access/reuse, package/version compatibility, localization fallbacks, and session scope.
The prototype's relay has no durable cache/version pin; restart it to refresh upstream responses.

Run focused offline checks with `node --test tests/operations/chat-data-poc.test.mjs`.

Browser verification on 2026-10-16: direct item-data fetch failed; the relay resolved all 671 demo items.
Search, item selection, local tagged-Message preview, German and Simplified Chinese labels, and direct CDN
artwork were observed working in the Codex in-app browser. This does not verify real Chat or browser linking.
