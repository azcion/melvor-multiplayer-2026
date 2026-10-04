import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
	validate_config,
	load_config,
	asset_inventory,
	prepare_assets,
	upload_assets,
	verify_remote_object
} from '../../scripts/asset-hosting.mjs';

const png = await readFile(new URL('../../mod/assets/raid-boss-t1.png', import.meta.url));
const base = { mode: 'bundled', base_url: '', prefix: 'assets', assets: ['assets/raid-boss-t1.png'] };
const remote = {
	...base,
	mode: 'remote',
	base_url: 'https://cdn.example.com',
	r2: { account_id: 'a'.repeat(32), bucket: 'melvor', jurisdiction: 'eu' }
};

async function fixture(t) {
	const dir = await mkdtemp(join(tmpdir(), 'melvor-assets-'));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await mkdir(join(dir, 'assets'));
	await writeFile(join(dir, base.assets[0]), png);
	await writeFile(join(dir, 'assets/crucible.png'), png);
	await writeFile(
		join(dir, 'data.json'),
		JSON.stringify({ media: base.assets[0], sidebar: { icon: 'assets/crucible.png' }, description: base.assets[0] })
	);
	return dir;
}

test('rejects inconsistent mode, unsafe paths, duplicate assets, and non-HTTPS hosts', () => {
	assert.equal(validate_config(base), base);
	assert.equal(validate_config(remote), remote);
	for (const change of [
		{ mode: 'oops' },
		{ assets: ['assets/../secret.png'] },
		{ assets: [...base.assets, ...base.assets] },
		{ prefix: '../outside' },
		{ mode: 'remote', base_url: '' },
		{ mode: 'remote', base_url: 'http://cdn.example.com' },
		{ mode: 'remote', base_url: 'https://user:password@cdn.example.com' },
		{ mystery: true }
	])
		assert.throws(() => validate_config({ ...base, ...change }));
});

test('explicit overrides inherit inventory; missing explicit configs fail', async t => {
	const dir = await fixture(t);
	const defaults = join(dir, 'default.json');
	const overrides = join(dir, 'override.json');
	await writeFile(defaults, JSON.stringify(base));
	await writeFile(overrides, JSON.stringify({ mode: 'remote', base_url: remote.base_url }));
	assert.deepEqual(await load_config(defaults, { MELVOR_ASSET_CONFIG: overrides }), {
		...base,
		mode: 'remote',
		base_url: remote.base_url
	});
	await assert.rejects(load_config(defaults, { MELVOR_ASSET_CONFIG: join(dir, 'missing.json') }), /ENOENT/);
	await writeFile(overrides, 'null');
	await assert.rejects(load_config(defaults, { MELVOR_ASSET_CONFIG: overrides }), /must be an object/);
});

test('bundled preparation retains images and media with an empty runtime URL map', async t => {
	const dir = await fixture(t);
	let checks = 0;
	await prepare_assets(dir, base, async () => {
		checks++;
	});
	assert.equal(checks, 0);
	assert.deepEqual(await readFile(join(dir, base.assets[0])), png);
	assert.equal(JSON.parse(await readFile(join(dir, 'data.json'))).media, base.assets[0]);
	assert.deepEqual(JSON.parse(await readFile(join(dir, 'asset-urls.json'))), {});
});

test('remote preparation rewrites media, removes only managed images, and records full hashes', async t => {
	const dir = await fixture(t);
	await writeFile(join(dir, 'release.json'), JSON.stringify({ version: '1.6.2' }));
	const [entry] = await prepare_assets(dir, remote, async () => true);
	assert.equal(entry.sha256, createHash('sha256').update(png).digest('hex'));
	assert.equal(entry.key, `assets/${entry.sha256.slice(0, 16)}/raid-boss-t1.png`);
	const data = JSON.parse(await readFile(join(dir, 'data.json')));
	assert.equal(data.media, entry.url);
	assert.equal(data.sidebar.icon, 'assets/crucible.png');
	assert.equal(data.description, base.assets[0]);
	await assert.rejects(readFile(join(dir, base.assets[0])), /ENOENT/);
	assert.deepEqual(await readFile(join(dir, 'assets/crucible.png')), png);
	const release = JSON.parse(await readFile(join(dir, 'release.json')));
	assert.equal(release.assets.sha256[entry.asset], entry.sha256);
	assert.equal(release.assets.urls[entry.asset], entry.url);
	assert.equal(release.assets.r2, undefined);
});

test('missing remote assets fail before modifying the staged mod', async t => {
	const dir = await fixture(t);
	await assert.rejects(
		prepare_assets(dir, remote, async () => false),
		/missing/
	);
	assert.deepEqual(await readFile(join(dir, base.assets[0])), png);
	assert.equal(JSON.parse(await readFile(join(dir, 'data.json'))).media, base.assets[0]);
});

test('inventory rejects symlinks escaping the mod and invalid image bytes', async t => {
	const dir = await fixture(t);
	await symlink(join(dir, 'data.json'), join(dir, 'assets/bad.png'));
	await assert.rejects(asset_inventory(dir, { ...base, assets: ['assets/bad.png'] }), /symlink/);
	await writeFile(join(dir, 'assets/invalid.png'), 'not an image');
	await assert.rejects(asset_inventory(dir, { ...base, assets: ['assets/invalid.png'] }), /not a PNG/);
	const outside = join(dir, 'outside');
	await mkdir(outside);
	await cp(join(dir, base.assets[0]), join(outside, 'image.png'));
	await symlink(join(outside, 'image.png'), join(dir, 'assets/escape.png'));
	await assert.rejects(asset_inventory(join(dir, 'assets'), { ...base, assets: ['../outside/image.png'] }), /escapes/);
});

test('public verification detects missing files, wrong bytes, and wrong content types', async t => {
	const dir = await fixture(t);
	const [entry] = await asset_inventory(dir, remote);
	const response =
		(body, status = 200, type = 'image/png') =>
		async () =>
			new Response(body, { status, headers: { 'content-type': type } });
	assert.equal(await verify_remote_object(entry, response(png)), true);
	assert.equal(await verify_remote_object(entry, response('', 404)), false);
	await assert.rejects(verify_remote_object(entry, response('wrong')), /bytes differ/);
	await assert.rejects(verify_remote_object(entry, response(png, 200, 'text/html')), /image\/png/);
	await assert.rejects(verify_remote_object(entry, response('', 503)), /HTTP 503/);
});

test('upload dry-run makes no network calls; verified objects are skipped; failures propagate', async t => {
	const dir = await fixture(t);
	let runs = 0;
	let checks = 0;
	const run = () => {
		runs++;
		return { status: 0 };
	};
	const verify = async () => {
		checks++;
		return true;
	};
	await upload_assets(dir, remote, { dry_run: true, run, verify });
	assert.equal(checks, 0);
	assert.equal(runs, 0);
	await upload_assets(dir, remote, { run, verify });
	assert.equal(runs, 0);
	let args;
	await upload_assets(dir, remote, {
		verify: async () => ++checks > 2,
		run: (command, arguments_) => {
			assert.equal(command, 'wrangler');
			args = arguments_;
			return { status: 0 };
		}
	});
	assert.ok(args.includes('--remote'));
	assert.ok(args.includes('eu'));
	assert.ok(args.includes('public, max-age=31536000, immutable'));
	await assert.rejects(
		upload_assets(dir, remote, { verify: async () => false, run: () => ({ status: 1 }) }),
		/upload failed/
	);
});
