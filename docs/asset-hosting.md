# Mod asset hosting

A fresh checkout bundles every image. No Cloudflare account or external image service is required.
All original images remain in `mod/assets/` and in source control.

## Configuration

`asset-hosting.json` supplies the bundled default and exact managed PNG paths. The managed list covers four Colosseum
Dungeon setting illustrations, four Raid bosses, the seven legacy Expedition scenes, eleven versioned 1.7.0 Expedition scenes, four passage gateways,
and the Crucible visual guide. Other Crucible artwork,
navigation icons, gamemode icons, and placeholders stay bundled.

Create an ignored `asset-hosting.local.json` to override settings for your builds:

```json
{
	"mode": "remote",
	"base_url": "https://images.example.com",
	"prefix": "assets"
}
```

The configuration order is tracked defaults, then the local override. Set `MELVOR_ASSET_CONFIG` to select an explicit
override instead of the local file; relative paths are resolved from the repository root. An explicitly selected
missing file fails. Override fields replace default fields, including the whole `assets` array when provided.
The asset list identifies paths whose references are wired through the mod asset resolver; when adding new images,
route their UI references through that resolver too.

| Mode      | Selected image URLs   | ZIP contents                                      |
| --------- | --------------------- | ------------------------------------------------- |
| `bundled` | Mod resources         | All images                                        |
| `remote`  | Configured HTTPS host | Selected images omitted; other resources retained |

The delivery mode controls both links and inclusion in `package-mod.sh` and `package-release.sh`.
Remote builds require accessible hosted files whose full SHA-256,
size, and image/png content type match the source. Packaging never uploads files.
Release builds derive the source images and tracked defaults from the committed tree, and record delivery mode,
full hashes, and resolved URLs in `release.json`. Support-test builds inherit the source release's asset policy.
Only the resolved URL map reaches the game; upload settings stay outside the ZIP.

Force a self-contained build even on a machine configured for remote hosting:

```sh
MELVOR_ASSET_CONFIG=asset-hosting.json ./scripts/package-mod.sh 1.7.0 A
```

Switching the multiplayer API server in Mod Settings does not change the image host baked into an installed ZIP.
Rebuild and reinstall the ZIP to change asset delivery. Remote mode requires the configured host at image load time;
it does not contain fallback copies of the omitted artwork. Existing local Expedition placeholders remain bundled.

## Artwork handoff preflight

After changing managed PNG bytes or inventory, run `node scripts/asset-hosting.mjs check` before handing off
artwork or starting a remote release build. It uses the same effective configuration and content hashes as packaging,
checks every managed object, and changes no files or hosted objects. Bundled mode checks local PNG validity only.
A dry-run upload lists keys but does not prove public availability. Review the reported override and mode first.

An override's `assets` array replaces the tracked inventory; compare that array with `asset-hosting.json` when
investigating stale configuration. If the effective inventory includes the expected path and its current hash URL
returns HTTP 404, that exact object is unpublished at the configured host. A network failure cannot establish absence.
The preflight lists all missing objects; upload using the reviewed provider workflow, then rerun it. Packaging stays
fail-closed and never uploads automatically.

For an intentionally bundled release test without changing the ignored host configuration:

```sh
asset_config="$(mktemp "${TMPDIR:-/tmp}/melvor-bundled-assets.XXXXXX")"
git show HEAD:asset-hosting.json > "$asset_config"
MELVOR_ASSET_CONFIG="$asset_config" ./scripts/package-release.sh VERSION SUFFIX
```

Remove the temporary file afterward and inspect the release asset metadata. Follow the next unused release suffix.

## Expedition artwork compatibility

The 1.7.0 expansion uses `assets/expedition-chambers/1.7.0/` for all new/replacement scenes. The Rift retains
`assets/expedition-chambers/entrance.png`. Preserve the original unversioned images and any hosted objects referenced
by 1.6.17 or older supported clients. Keep both generations in the managed inventory; updating only asset URLs does
not replace the backend obligation to preserve existing content snapshots, tasks, visits and route history.

## Upload to Cloudflare R2

Install Wrangler using npm and authenticate with `wrangler login`. Add upload settings to the local override:

```json
{
	"mode": "remote",
	"base_url": "https://images.example.com",
	"r2": {
		"account_id": "YOUR_32_CHARACTER_HEX_ACCOUNT_ID",
		"bucket": "your-bucket",
		"jurisdiction": "eu"
	}
}
```

Use `default` for a bucket without a jurisdiction restriction. Configure the bucket's public HTTPS custom domain
before uploading. The uploader uses Wrangler's existing credentials; never place tokens or secrets in configuration.

```sh
node scripts/asset-hosting.mjs upload --dry-run
node scripts/asset-hosting.mjs upload
node scripts/asset-hosting.mjs check
./scripts/package-mod.sh 1.7.0 A
```

The first command lists the exact source paths, object keys, and sizes without accessing R2 or the public host.
The uploader checks existing files, skips byte-identical objects, and verifies each new upload through the public URL.
It sends `image/png` and `Cache-Control: public, max-age=31536000, immutable`.

Keys use `assets/<first-16-SHA256-hex-characters>/<filename>`. Full-digest verification detects collisions and stops
instead of replacing different bytes. Changed images get new URLs, so existing releases keep their artwork.
Uploads never remove old objects. Keep objects referenced by supported releases.

Other HTTPS storage providers work too: upload the exact keyed files there and omit `r2` from the configuration.
Remote ZIP preparation performs the same public byte verification regardless of provider.

To roll back hosting, build in bundled mode and reinstall. This does not require deleting R2 objects or changing
the backend. Node.js 22+ and the usual ZIP tools are needed for packaging; Wrangler is required only for R2 uploads.

## Gamemode compatibility icons

The bundled `gamemode_*.png` icons use the supplied HCCO, MCCO, HRCO, RMCO, Randomized Adventure, and Phoenix artwork.
They are limited to 192×192 for the roster's 96px display (2× density), stripped of metadata, and PNG-compressed.
Phoenix uses a 256-color palette with transparency (22,425 bytes, reduced from 477,812 bytes).
`gamemode_taskman.svg` is the small static icon from Taskman's published 0.6.2.0 archive.

Names and IDs were checked against the published mod files:

- [HCCO](https://mod.io/g/melvoridle/m/hcco), 4.2.5, file 7068582: `hcco`, `mcco`, `rehcco`, `remcco` in namespace `hcco`.
- [Randomized Adventure](https://mod.io/g/melvoridle/m/randomized-adventure-mode), 1.1.4, file 5286038: `RandomAdventure:RandomAdventure`.
- [Taskman](https://mod.io/g/melvoridle/m/taskman-mode), 0.6.2.0, file 8290130: `taskman:Taskman`. Task variants share this ID.
- [Gamemodes by Phoenix](https://mod.io/g/melvoridle/m/gamemodes-by-phoenix), 1.0.0, file 5724975: `gamemodesbyphoenix:adventurenoxpcap`.
- [Phoenix Gamemode Manager](https://mod.io/g/melvoridle/m/phoenix-gamemode-manager), 1.2.0, file 5724870: `phoenixgamemodemanager:BirthdayMode`. The archive calls it `???`; Multiplayer uses the descriptive label **Phoenix Birthday Mode**. Both Phoenix modes share the supplied icon.

These are exact display mappings; they do not infer Taskman settings or change multiplayer economy policy.
