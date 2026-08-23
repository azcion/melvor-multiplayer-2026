import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { install_common_actions } from '../../mod/client-actions-common.mjs';
import {
	ICON_CATALOG_MEDIA_TIMEOUT,
	MAX_ICON_CATALOG_CANDIDATES,
	MAX_ICON_CATALOG_ICON_BYTES,
	detect_icon_media_type,
	discover_skill_icon_candidates,
	is_official_game_id,
	sha256_bytes
} from '../../mod/icon-catalog-discovery.mjs';

const svg_bytes = new TextEncoder().encode('\uFEFF<?xml version="1.0"?><!-- preserved --><!DOCTYPE svg><svg viewBox="0 0 1 1"><path/></svg>');
const png_bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function response_for(bytes) {
	const copy = bytes.slice();
	let delivered = false;
	return {
		ok: true,
		headers: { get: name => name.toLowerCase() === 'content-length' ? String(copy.length) : null },
		body: {
			getReader: () => ({
				read: async () => {
					if (delivered)
						return { done: true };
					delivered = true;
					return { done: false, value: copy };
				},
				cancel: async () => {}
			})
		}
	};
}

async function discover(skills, objects, media_bytes, options = {}) {
	const fetched = [];
	const diagnostics = [];
	const result = await discover_skill_icon_candidates(skills, {
		resolve_skill: skill_id => objects[skill_id] ?? null,
		resolve_media_url: media => `resolved/${media}`,
		fetch_media: async media => {
			fetched.push(media);
			return response_for(media_bytes[media.replace(/^resolved\//, '')] ?? new Uint8Array());
		},
		crypto_provider: webcrypto,
		on_diagnostic: diagnostic => diagnostics.push(diagnostic),
		...options
	});
	return { result, fetched, diagnostics };
}

test('collects a custom shared skill even when it is not active', async () => {
	const { result } = await discover(
		[{ skill_id: 'custom:Alchemy', level: 1 }],
		{ 'custom:Alchemy': { id: 'custom:Alchemy', media: 'alchemy.svg', isActive: false } },
		{ 'alchemy.svg': svg_bytes }
	);

	assert.equal(result.length, 1);
	assert.equal(result[0].kind, 'skill');
	assert.equal(result[0].skill_id, 'custom:Alchemy');
	assert.equal(result[0].media_type, 'image/svg+xml');
	assert.equal(result[0].byte_length, svg_bytes.length);
	assert.deepEqual(result[0].bytes, svg_bytes);
});

test('excludes official skills and installed custom skills absent from the shared snapshot', async () => {
	const resolved = [];
	const result = await discover_skill_icon_candidates([
		{ skill_id: 'melvorD:Woodcutting', level: 99 }
	], {
		resolve_skill: skill_id => {
			resolved.push(skill_id);
			return { media: 'official.png' };
		},
		fetch_media: async () => response_for(png_bytes),
		crypto_provider: webcrypto
	});
	assert.deepEqual(result, []);
	assert.deepEqual(resolved, []);

	const unshared = await discover(
		[],
		{ 'custom:Installed': { media: 'installed.png' } },
		{ 'installed.png': png_bytes }
	);
	assert.deepEqual(unshared.result, []);
});

test('does not treat action or combat activity data as skill candidates', async () => {
	const resolved = [];
	const result = await discover_skill_icon_candidates([
		{ type: 'combat', area_id: 'custom:Area' },
		{ type: 'skill', skill_id: 'custom:Action', action_id: 'custom:Action' }
	], {
		resolve_skill: skill_id => {
			resolved.push(skill_id);
			return null;
		},
		fetch_media: async () => response_for(png_bytes),
		crypto_provider: webcrypto
	});
	assert.deepEqual(result, []);
	assert.deepEqual(resolved, ['custom:Action']);
});

test('preserves SVG bytes exactly and hashes a representative raster icon', async () => {
	const { result: svg_result } = await discover(
		[{ skill_id: 'mod:SvgSkill' }],
		{ 'mod:SvgSkill': { media: 'custom.svg' } },
		{ 'custom.svg': svg_bytes }
	);
	assert.deepEqual(svg_result[0].bytes, svg_bytes);
	assert.equal(svg_result[0].content_hash, await sha256_bytes(svg_bytes, webcrypto));
	assert.equal(detect_icon_media_type(png_bytes), 'image/png');

	const { result: png_result } = await discover(
		[{ skill_id: 'mod:PngSkill' }],
		{ 'mod:PngSkill': { media: 'custom.png' } },
		{ 'custom.png': png_bytes }
	);
	assert.equal(png_result[0].media_type, 'image/png');
	assert.deepEqual(png_result[0].bytes, png_bytes);
});

test('resolves packaged media while leaving blob and data URLs untouched', async () => {
	const { result, fetched } = await discover(
		[
			{ skill_id: 'mod:Packaged' },
			{ skill_id: 'mod:Blob' },
			{ skill_id: 'mod:Data' }
		],
		{
			'mod:Packaged': { media: 'assets/media/custom.svg' },
			'mod:Blob': { media: 'blob:custom-icon' },
			'mod:Data': { media: 'data:image/png;base64,custom-icon' }
		},
		{
			'assets/media/custom.svg': svg_bytes,
			'blob:custom-icon': png_bytes,
			'data:image/png;base64,custom-icon': png_bytes
		}
	);
	assert.equal(result.length, 3);
	assert.deepEqual(fetched, [
		'resolved/assets/media/custom.svg',
		'blob:custom-icon',
		'data:image/png;base64,custom-icon'
	]);
});

test('skips an unreadable icon without preventing later candidates', async () => {
	const diagnostics = [];
	const result = await discover_skill_icon_candidates([
		{ skill_id: 'mod:Broken' },
		{ skill_id: 'mod:Good' }
	], {
		resolve_skill: skill_id => ({ media: skill_id === 'mod:Broken' ? 'broken.svg' : 'good.svg' }),
		fetch_media: async media => media.endsWith('broken.svg') ? { ok: false } : response_for(svg_bytes),
		crypto_provider: webcrypto,
		on_diagnostic: diagnostic => diagnostics.push(diagnostic)
	});
	assert.deepEqual(result.map(candidate => candidate.skill_id), ['mod:Good']);
	assert.deepEqual(diagnostics, [{ skill_id: 'mod:Broken', stage: 'read' }]);
});

test('times out stalled media and streams unknown-length bodies through the byte cap', async () => {
	let aborted = false;
	const stalled = await discover_skill_icon_candidates([{ skill_id: 'mod:Stalled' }], {
		resolve_skill: () => ({ media: 'stalled.svg' }),
		fetch_media: (_media, { signal }) => new Promise((_resolve, reject) => {
			signal.addEventListener('abort', () => {
				aborted = true;
				reject(signal.reason);
			}, { once: true });
		}),
		crypto_provider: webcrypto,
		media_timeout: 1
	});
	assert.deepEqual(stalled, []);
	assert.equal(aborted, true);
	assert.equal(ICON_CATALOG_MEDIA_TIMEOUT, 15_000);

	let cancelled = false;
	const oversized = await discover_skill_icon_candidates([{ skill_id: 'mod:Oversized' }], {
		resolve_skill: () => ({ media: 'oversized.png' }),
		fetch_media: async () => ({
			ok: true,
			headers: { get: () => null },
			body: {
				getReader: () => ({
					read: async () => ({ done: false, value: new Uint8Array(MAX_ICON_CATALOG_ICON_BYTES + 1) }),
					cancel: async () => { cancelled = true; }
				})
			}
		}),
		crypto_provider: webcrypto
	});
	assert.deepEqual(oversized, []);
	assert.equal(cancelled, true);
});

test('collapses duplicate logical entries and reuses one read for identical media', async () => {
	const { result, fetched } = await discover(
		[
			{ skill_id: 'mod:One' },
			{ skill_id: 'mod:One' },
			{ skill_id: 'mod:Two' }
		],
		{
			'mod:One': { media: 'shared.svg' },
			'mod:Two': { media: 'shared.svg' }
		},
		{ 'shared.svg': svg_bytes }
	);
	assert.deepEqual(result.map(candidate => candidate.skill_id), ['mod:One', 'mod:Two']);
	assert.deepEqual(fetched, ['resolved/shared.svg']);
});

test('bounds the candidate manifest and reports only metadata diagnostics', async () => {
	const skills = Array.from({ length: MAX_ICON_CATALOG_CANDIDATES + 6 }, (_, index) => ({
		skill_id: `mod:Skill_${index}`
	}));
	const objects = Object.fromEntries(skills.map(entry => [entry.skill_id, { media: 'shared.svg' }]));
	const { result, diagnostics } = await discover(skills, objects, { 'shared.svg': svg_bytes });
	assert.equal(result.length, MAX_ICON_CATALOG_CANDIDATES);
	assert.deepEqual(diagnostics, []);
	assert.equal(Object.hasOwn(result[0], 'bytes'), true);
});

test('uses the default combat icon for modded or unknown areas', () => {
	const actions = install_common_actions({
		game: {
			combatAreas: {
				getObjectByID: id => id === 'melvorD:Volcanic_Cave'
					? { id, media: 'official-area.png' }
					: id === 'custom:Area' ? { id, media: 'modded-area.png' } : null
			}
		},
		is_official_game_id,
		getLangString: () => 'combat'
	});

	assert.equal(actions.get_status_activity_icon({ type: 'combat', area_id: 'melvorD:Volcanic_Cave' }), 'official-area.png');
	assert.equal(actions.get_status_activity_icon({ type: 'combat', area_id: 'custom:Area' }), 'assets/media/skills/combat/combat.png');
	assert.equal(actions.get_status_activity_icon({ type: 'combat', area_id: 'custom:Missing' }), 'assets/media/skills/combat/combat.png');
});
