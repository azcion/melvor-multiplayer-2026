# Mod asset hosting

A fresh checkout bundles every image. No Cloudflare account or external image service is required.
All original images remain in `mod/assets/` and in source control.

## Configuration

`asset-hosting.json` supplies the bundled default and exact managed PNG paths. The initial list covers four Raid
bosses, seven Expedition Chambers, and four passage gateways. Crucible, navigation icons, and placeholders stay bundled.

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
MELVOR_ASSET_CONFIG=asset-hosting.json ./scripts/package-mod.sh
```

Switching the multiplayer API server in Mod Settings does not change the image host baked into an installed ZIP.
Rebuild and reinstall the ZIP to change asset delivery. Remote mode requires the configured host at image load time;
it does not contain fallback copies of the omitted artwork. Existing local Expedition placeholders remain bundled.

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
./scripts/package-mod.sh
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
