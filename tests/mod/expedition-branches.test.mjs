import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
	create_branch_renderer,
	DEFAULT_BRANCH_SETTINGS,
	normalize_branch_settings,
	APPROVED_BRANCH_SETTINGS,
} from '../../mod/expedition-branches.mjs';

test('branch atmosphere stays bounded at desktop and mobile sizes, with live density and no unknown fallback', (t) => {
	const previous_document = globalThis.document;
	globalThis.document = {
		createElement: () => ({
			getContext: () => ({
				save() {},
				restore() {},
				translate() {},
				scale() {},
				fillRect() {},
				clearRect() {},
				drawImage() {},
				createRadialGradient: () => ({ addColorStop() {} }),
			}),
		}),
	};
	t.after(() => {
		if (previous_document === undefined) delete globalThis.document;
		else globalThis.document = previous_document;
	});
	assert.deepEqual(normalize_branch_settings({ speed: NaN }), DEFAULT_BRANCH_SETTINGS);
	assert.deepEqual(normalize_branch_settings({ density: 80, speed: -1, brightness: 80 }), {
		...DEFAULT_BRANCH_SETTINGS,
		density: 40,
		speed: 0,
		brightness: 8,
	});
	assert.throws(() => create_branch_renderer('unfinished_chamber'));
	for (const id of [
		'drowned_cloister',
		'rootforge_passage',
		'tideworn_crypts',
		'embervein_machinery',
		'mossbound_reliquary',
	]) {
		let settings = { ...APPROVED_BRANCH_SETTINGS[id] },
			draws = 0,
			depth = 0;
		const render = create_branch_renderer(id, { random: () => 0.5, get_settings: () => settings });
		let width, height;
		const point = (x, y) => {
			assert.ok(Number.isFinite(x) && Number.isFinite(y));
		};
		const c = {
			drawImage(...args) {
				assert.ok(args.slice(1).every(Number.isFinite));
				assert.ok(this.globalAlpha >= 0 && this.globalAlpha <= 1);
				if (this.globalAlpha > 0) draws++;
			},
			save() {
				depth++;
			},
			restore() {
				depth--;
			},
			beginPath() {},
			closePath() {},
			clip() {},
			translate() {},
			scale() {},
			createRadialGradient: () => ({ addColorStop() {} }),
			stroke() {
				if (this.globalAlpha > 0) draws++;
			},
			ellipse(x, y, rx, ry) {
				assert.ok([x, y, rx, ry].every(Number.isFinite));
			},
			moveTo: point,
			lineTo: point,
			fill() {
				if (this.globalAlpha > 0) draws++;
				assert.ok(this.globalAlpha >= 0 && this.globalAlpha <= 1);
			},
			arc(x, y, r) {
				point(x, y);
				assert.ok(r > 0);
			},
			fillRect(x, y, w, h) {
				point(x, y);
				assert.ok(w > 0 && h > 0);
				if (this.globalAlpha > 0) draws++;
			},
		};
		for (width of [1280, 390]) {
			height = (width * 9) / 16;
			for (let i = 0; i < 300; i++) render({ context: c, width, height, seconds: 0.05 });
		}
		assert.ok(draws > 0);
		assert.equal(depth, 0);
		settings = Object.fromEntries(Object.keys(settings).map((key) => [key, 0]));
		draws = 0;
		render({ context: c, width, height, seconds: 0.05 });
		assert.equal(draws, 0);
	}
});

test('all supported artwork has distinct versioned URLs while The Rift and legacy files remain available', async () => {
	const [main, content, hosting] = await Promise.all(
		['mod/main.mjs', 'server/expedition-content-v3.json', 'asset-hosting.json'].map((path) =>
			readFile(new URL('../../' + path, import.meta.url), 'utf8'),
		),
	);
	const assets = JSON.parse(hosting).assets;
	for (const chamber of JSON.parse(content).chambers) {
		const name = chamber.id.replaceAll('_', '-');
		const asset = `assets/expedition-chambers/${chamber.id === 'entrance' ? '' : '1.7.0/'}${name}.png`;
		assert.ok(assets.includes(asset), asset);
		const png = await readFile(new URL('../../mod/' + asset, import.meta.url));
		assert.equal(png.readUInt32BE(0), 0x89504e47);
		assert.equal(png.readUInt32BE(16), 1280);
		assert.equal(png.readUInt32BE(20), 720);
		if (chamber.id !== 'entrance') assert.ok(main.includes(`1.7.0/${name}`));
	}
	for (const name of [
		'entrance',
		'prismatic-descent',
		'glassroot-terraces',
		'buried-observatory',
		'prismatic-orrery',
		'voidwatch-threshold',
		'hollow-star',
	])
		assert.ok(assets.includes(`assets/expedition-chambers/${name}.png`));
});

// Heat must resolve the current sibling image after late loading or DOM cloning.
test('furnace heat samples the current artwork and approved settings need no preview state', (t) => {
	const previous = globalThis.document;
	globalThis.document = {
		createElement: () => ({
			getContext: () => ({ fillRect() {}, createRadialGradient: () => ({ addColorStop() {} }) }),
		}),
	};
	t.after(() => {
		if (previous === undefined) delete globalThis.document;
		else globalThis.document = previous;
	});
	let artwork = { complete: false, naturalWidth: 1280, naturalHeight: 720 },
		samples = 0;
	const context = {
		canvas: { parentElement: { parentElement: { querySelector: () => artwork } } },
		save() {},
		restore() {},
		translate() {},
		scale() {},
		fillRect() {},
		beginPath() {},
		ellipse() {},
		fill() {},
		createRadialGradient: () => ({ addColorStop() {} }),
		drawImage(source, ...args) {
			assert.ok(args.every(Number.isFinite));
			if (source === artwork) samples++;
		},
	};
	for (const id of ['rootforge_passage', 'embervein_machinery']) {
		const render = create_branch_renderer(id, { random: () => 0.5 });
		samples = 0;
		artwork.complete = false;
		render({ context, width: 1280, height: 720, seconds: 0.05 });
		assert.equal(samples, 0);
		artwork = { complete: true, naturalWidth: 1280, naturalHeight: 720 };
		render({ context, width: 390, height: 219.375, seconds: 0.05 });
		assert.ok(samples > 0);
	}
	assert.equal(APPROVED_BRANCH_SETTINGS.drowned_cloister.mist_opacity, undefined);
});
