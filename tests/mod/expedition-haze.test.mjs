import assert from 'node:assert/strict';
import test from 'node:test';
import { create_glassroot_renderer, normalize_glassroot_settings, DEFAULT_GLASSROOT_SETTINGS } from '../../mod/expedition-haze.mjs';
import { create_facet_glint_renderer } from '../../mod/expedition-crystals.mjs';

test('haze reuses a bounded, softly edged texture through long animation and resizing', () => {
	const previous_document = globalThis.document;
	let generated = 0, pixels;
	const texture = { getContext: () => ({
		createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
		putImageData: data => { pixels = data.data; generated++; }
	}) };
	globalThis.document = { createElement: () => texture };
	try {
		let seed = 7;
		const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
		const render = create_glassroot_renderer({ create_facet_glint_renderer, random });
		assert.equal(texture.width, 512); assert.equal(texture.height, 128);
		let maximum_alpha = 0;
		for (let y = 0; y < 128; y++) {
			const alpha = x => pixels[(y * 512 + x) * 4 + 3];
			assert.ok(Math.abs(alpha(0) - alpha(511)) <= 1, 'horizontal join remains smooth');
			for (let x = 0; x < 512; x++) {
				maximum_alpha = Math.max(maximum_alpha, alpha(x));
				if (y === 0 || y === 127) assert.equal(alpha(x), 0, 'transparent vertical edges');
			}
		}
		assert.ok(maximum_alpha > 0 && maximum_alpha <= 255, 'translucent fog');
		let draws = [];
		const context = {
			drawImage(image, ...bounds) {
				assert.equal(image, texture);
				assert.ok(this.globalAlpha > 0 && this.globalAlpha <= 0.65);
				assert.ok(bounds.every(Number.isFinite)); draws.push(bounds);
			},
			beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, fill() {}
		};
		for (const width of [1280, 320, 640]) {
			const height = width * 9 / 16;
			for (let frame = 0; frame < 1200; frame++) {
				draws = [];
				render({ context, width, height, seconds: 0.05 });
				assert.equal(draws.length, 6);
				for (let index = 0; index < draws.length; index += 2) {
					const [left, top, tile_width, tile_height] = draws[index];
					assert.ok(left >= -width && left <= 0);
					assert.equal(tile_width, width);
					assert.ok(top >= 0 && top + tile_height <= height);
					assert.ok(Math.abs(draws[index + 1][0] - left - width) < 0.00001);
				}
			}
		}
		assert.equal(generated, 1, 'no per-frame texture generation');
	} finally { globalThis.document = previous_document; }
});

test('live haze controls clamp invalid values and change density without rebuilding the texture', () => {
	assert.deepEqual(normalize_glassroot_settings({ haze_speed: NaN }), DEFAULT_GLASSROOT_SETTINGS);
	const settings = normalize_glassroot_settings({ haze_speed: 100, haze_opacity: -1,
		sparkles_per_crystal: 100, sparkle_speed: Infinity, sparkle_brightness: 2 });
	assert.equal(settings.haze_speed, 12); assert.equal(settings.haze_opacity, 0);
	assert.equal(settings.sparkles_per_crystal, 32); assert.equal(settings.sparkle_brightness, 1);
	const previous_document = globalThis.document;
	globalThis.document = { createElement: () => ({ getContext: () => null }) };
	try {
		let get_glints, anchors;
		let live = { ...DEFAULT_GLASSROOT_SETTINGS };
		const render = create_glassroot_renderer({ get_settings: () => live,
			create_facet_glint_renderer: (facets, random, get_settings) => {
				anchors = facets; get_glints = get_settings; return () => {};
			} });
		assert.equal(anchors.length, 352, 'bounded pool across eleven crystals');
		for (const [x, y] of anchors) assert.ok(x > 0 && x < 1 && y > 0 && y < 1);
		render({ context: {}, width: 640, height: 360, seconds: 0.05 });
		assert.equal(get_glints().count, 176);
		live = { ...live, sparkles_per_crystal: 32, sparkle_speed: 6, sparkle_brightness: 0.5 };
		render({ context: {}, width: 320, height: 180, seconds: 0.05 });
		assert.deepEqual(get_glints(), { count: 352, speed: 6, brightness: 0.5 });
		live.sparkles_per_crystal = 0;
		render({ context: {}, width: 320, height: 180, seconds: 0.05 });
		assert.equal(get_glints().count, 0);
	} finally { globalThis.document = previous_document; }
});
