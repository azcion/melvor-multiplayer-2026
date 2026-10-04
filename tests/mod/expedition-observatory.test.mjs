import assert from 'node:assert/strict';
import test from 'node:test';
import { create_observatory_renderer, normalize_observatory_settings,
	DEFAULT_OBSERVATORY_SETTINGS } from '../../mod/expedition-observatory.mjs';

test('observatory animation stays bounded through long runs, maximum controls and resizing', () => {
	let seed = 17;
	const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
	let settings = { ...DEFAULT_OBSERVATORY_SETTINGS };
	let width, height, arcs = 0;
	const point = (x, y) => {
		assert.ok(Number.isFinite(x) && x >= 0 && x <= width);
		assert.ok(Number.isFinite(y) && y >= 0 && y <= height);
	};
	const context = {
		createLinearGradient(...coords) {
			point(coords[0], coords[1]); point(coords[2], coords[3]);
			return { addColorStop() {} };
		},
		beginPath() {}, closePath() {}, moveTo: point, lineTo: point,
		arc(x, y, radius) {
			point(x, y); assert.ok(y / height < 0.471, 'dust stays above the terraces inside the light shafts');
			assert.ok(radius > 0 && radius <= 3.3); arcs++;
		},
		fill() { assert.ok(this.globalAlpha >= 0 && this.globalAlpha <= 1); },
		stroke() { assert.fail('this chamber must not draw a dial sweep'); }
	};
	const render = create_observatory_renderer({ random, get_settings: () => settings });
	for (width of [1280, 320, 640]) {
		height = width * 9 / 16;
		settings = { dust_density: 360, dust_speed: 8, beam_intensity: 1, beam_speed: 6,
			glint_frequency: 6, glint_brightness: 1 };
		for (let frame = 0; frame < 1200; frame++) {
			arcs = 0; render({ context, width, height, seconds: 0.05 });
			assert.equal(arcs, 720, 'bounded pool draws a halo and core per dust grain');
		}
	}
	settings = { dust_density: 0, dust_speed: 0, beam_intensity: 0, beam_speed: 0,
		glint_frequency: 0, glint_brightness: 0 };
	context.fill = function () { assert.equal(this.globalAlpha, 0); };
	arcs = 0; render({ context, width: 640, height: 360, seconds: 0.05 });
	assert.equal(arcs, 0, 'all effects can be disabled live');
});

test('observatory controls reject nonfinite values and bound density and intensity', () => {
	assert.deepEqual(normalize_observatory_settings({ dust_speed: NaN, beam_speed: Infinity }), DEFAULT_OBSERVATORY_SETTINGS);
	const settings = normalize_observatory_settings({ dust_density: 999, beam_intensity: -1, glint_brightness: 9 });
	assert.equal(settings.dust_density, 360); assert.equal(settings.beam_intensity, 0);
	assert.equal(settings.glint_brightness, 1);
});

test('the right-edge shaft receives both breathing light and its share of dust', () => {
	let right_edge_gradients = 0, right_edge_grains = 0;
	const context = {
		createLinearGradient(x1, y1, x2, y2) {
			if (x1 >= 0.895 * 1280 && x2 >= 0.965 * 1280) right_edge_gradients++;
			return { addColorStop() {} };
		},
		beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, fill() {},
		arc(x, y) { if (x > 0.895 * 1280) right_edge_grains++; },
		stroke() { assert.fail('no floor sweep in the Observatory'); }
	};
	const render = create_observatory_renderer({ random: () => 0.5 });
	for (let frame = 0; frame < 100; frame++) {
		right_edge_gradients = 0; right_edge_grains = 0;
		render({ context, width: 1280, height: 720, seconds: 0.05 });
		assert.equal(right_edge_gradients, 1);
		assert.equal(right_edge_grains, 48, '24 of 120 dust grains, each with a halo and core');
	}
});
