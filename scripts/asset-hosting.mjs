import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo_root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config_keys = new Set(['mode', 'base_url', 'prefix', 'assets', 'r2']);

export function validate_config(config) {
	if (!config || typeof config !== 'object' || Array.isArray(config))
		throw new Error('Asset configuration must be an object.');
	for (const key of Object.keys(config)) {
		if (!config_keys.has(key)) throw new Error(`Unknown asset configuration field: ${key}`);
	}
	if (!['bundled', 'remote'].includes(config.mode)) throw new Error('Asset mode must be bundled or remote.');
	if (!Array.isArray(config.assets) || config.assets.length === 0)
		throw new Error('assets must be a non-empty exact-path list.');
	if (new Set(config.assets).size !== config.assets.length) throw new Error('Duplicate managed asset paths.');
	for (const asset of config.assets) {
		if (typeof asset !== 'string' || !/^assets\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.png$/.test(asset))
			throw new Error(`Unsafe managed PNG path: ${asset}`);
	}
	if (typeof config.prefix !== 'string' || !/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/.test(config.prefix))
		throw new Error('Asset prefix must be a relative object-key path.');
	if (config.mode === 'remote') {
		const url = new URL(config.base_url);
		if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
			throw new Error('Remote base_url must be an HTTPS URL without credentials, query, or fragment.');
	}
	if (config.r2 !== undefined) {
		const r2 = config.r2;
		if (
			!r2 ||
			typeof r2 !== 'object' ||
			Object.keys(r2).some(key => !['account_id', 'bucket', 'jurisdiction'].includes(key)) ||
			!/^[a-f0-9]{32}$/.test(r2.account_id) ||
			!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(r2.bucket) ||
			!['default', 'eu', 'fedramp'].includes(r2.jurisdiction)
		)
			throw new Error('Invalid R2 upload settings.');
	}
	return config;
}

export async function load_config(default_file = resolve(repo_root, 'asset-hosting.json'), env = process.env) {
	const defaults = JSON.parse(await readFile(default_file, 'utf8'));
	const explicit = env.MELVOR_ASSET_CONFIG;
	const local_file = explicit ? resolve(repo_root, explicit) : resolve(repo_root, 'asset-hosting.local.json');
	const override = explicit || existsSync(local_file) ? JSON.parse(await readFile(local_file, 'utf8')) : {};
	for (const value of [defaults, override]) {
		if (!value || typeof value !== 'object' || Array.isArray(value))
			throw new Error('Asset configuration must be an object.');
	}
	return validate_config({ ...defaults, ...override });
}

export async function asset_inventory(mod_dir, config) {
	const root = await realpath(mod_dir);
	const inventory = [];
	const keys = new Map();
	for (const asset of config.assets) {
		const file = await realpath(resolve(root, asset));
		if (!file.startsWith(`${root}${sep}`)) throw new Error(`Managed asset escapes mod directory: ${asset}`);
		if (file !== resolve(root, asset)) throw new Error(`Managed asset must not be a symlink: ${asset}`);
		const bytes = await readFile(file);
		if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
			throw new Error(`Managed asset is not a PNG: ${asset}`);
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		const key = `${config.prefix}/${sha256.slice(0, 16)}/${basename(asset)}`;
		if (keys.has(key) && keys.get(key) !== sha256) throw new Error(`Short asset hash collision: ${key}`);
		keys.set(key, sha256);
		inventory.push({
			asset,
			file,
			key,
			sha256,
			size: bytes.length,
			url: config.mode === 'remote' ? `${config.base_url.replace(/\/+$/, '')}/${key}` : null
		});
	}
	return inventory;
}

// Only image-valued declarations are rewritten; descriptions and other data stay untouched.
export function rewrite_media(value, urls) {
	if (Array.isArray(value)) return value.map(entry => rewrite_media(entry, urls));
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [
			key,
			['media', 'icon', 'altMedia'].includes(key) && typeof entry === 'string' && Object.hasOwn(urls, entry)
				? urls[entry]
				: rewrite_media(entry, urls)
		])
	);
}

export async function verify_remote_object(entry, fetch_object = fetch) {
	// Avoid a cached 404 from the pre-upload check hiding a newly created object.
	const check_url = new URL(entry.url);
	check_url.searchParams.set('verify', randomUUID());
	const response = await fetch_object(check_url, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
	if (response.status === 404) return false;
	if (!response.ok) throw new Error(`Hosted asset HTTP ${response.status}: ${entry.url}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	const digest = createHash('sha256').update(bytes).digest('hex');
	if (bytes.length !== entry.size || digest !== entry.sha256)
		throw new Error(`Hosted asset bytes differ (possible short hash collision): ${entry.url}`);
	if (!/^image\/png(?:;|$)/i.test(response.headers.get('content-type') ?? ''))
		throw new Error(`Hosted asset is not served as image/png: ${entry.url}`);
	return true;
}

export async function prepare_assets(mod_dir, config, verify = verify_remote_object) {
	const inventory = await asset_inventory(mod_dir, config);
	const urls = {};
	if (config.mode === 'remote') {
		for (const entry of inventory) {
			if (!(await verify(entry))) throw new Error(`Hosted asset is missing; run the uploader first: ${entry.url}`);
			urls[entry.asset] = entry.url;
		}
	}
	const data_file = resolve(mod_dir, 'data.json');
	const data = JSON.parse(await readFile(data_file, 'utf8'));
	if (config.mode === 'remote')
		await writeFile(data_file, `${JSON.stringify(rewrite_media(data, urls), null, '\t')}\n`);
	await writeFile(resolve(mod_dir, 'asset-urls.json'), `${JSON.stringify(urls, null, '\t')}\n`);
	for (const entry of inventory) {
		if (config.mode === 'remote') await unlink(entry.file);
	}
	const summary = {
		mode: config.mode,
		urls,
		sha256: Object.fromEntries(inventory.map(entry => [entry.asset, entry.sha256]))
	};
	const release_file = resolve(mod_dir, 'release.json');
	if (existsSync(release_file)) {
		const release = JSON.parse(await readFile(release_file, 'utf8'));
		release.assets = summary;
		await writeFile(release_file, `${JSON.stringify(release, null, '\t')}\n`);
	}
	return inventory;
}

export async function upload_assets(
	mod_dir,
	config,
	{ dry_run = false, verify = verify_remote_object, run = spawnSync } = {}
) {
	if (config.mode !== 'remote' || !config.r2) throw new Error('Uploading requires remote mode and R2 settings.');
	const inventory = await asset_inventory(mod_dir, config);
	for (const entry of inventory) {
		console.log(`${dry_run ? 'Would upload' : 'Checking'} ${entry.asset} -> ${entry.key} (${entry.size} bytes)`);
		if (dry_run) continue;
		if (await verify(entry)) continue;
		const result = run(
			'wrangler',
			[
				'r2',
				'object',
				'put',
				`${config.r2.bucket}/${entry.key}`,
				'--file',
				entry.file,
				'--remote',
				'--jurisdiction',
				config.r2.jurisdiction,
				'--content-type',
				'image/png',
				'--cache-control',
				'public, max-age=31536000, immutable'
			],
			{ stdio: 'inherit', cwd: repo_root, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: config.r2.account_id } }
		);
		if (result.error) throw result.error;
		if (result.status !== 0) throw new Error(`Wrangler upload failed: ${entry.asset}`);
		if (!(await verify(entry))) throw new Error(`Uploaded object is not publicly available: ${entry.url}`);
	}
	return inventory;
}

async function main() {
	const [command, ...args] = process.argv.slice(2);
	if (command === 'prepare' && args.length >= 1 && args.length <= 2) {
		const config = await load_config(args[1]);
		const inventory = await prepare_assets(resolve(args[0]), config);
		console.log(
			`Assets: ${config.mode}; ${inventory.length} managed PNGs (${inventory.reduce((n, entry) => n + entry.size, 0)} bytes).`
		);
	} else if (command === 'upload' && (args.length === 0 || (args.length === 1 && args[0] === '--dry-run'))) {
		await upload_assets(resolve(repo_root, 'mod'), await load_config(), { dry_run: args[0] === '--dry-run' });
	} else {
		throw new Error('Usage: node scripts/asset-hosting.mjs prepare MOD_DIR [DEFAULT_CONFIG] | upload [--dry-run]');
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch(error => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
