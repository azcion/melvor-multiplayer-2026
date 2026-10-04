import assert from 'node:assert/strict';
import test from 'node:test';
import { create_orrery_renderer, normalize_orrery_settings, DEFAULT_ORRERY_SETTINGS } from '../../mod/expedition-orrery.mjs';

test('unmasked orbiting constellation stays bounded through long runs and resizing', () => {
	let seed = 13;
	const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
	let settings = { ...DEFAULT_ORRERY_SETTINGS, star_count: 120, connections_per_star: 4,
		connection_distance: 0.22, orbit_speed: 8 };
	let width, height, arcs, strokes, path, degrees;
	const point = (x, y) => {
		assert.ok(Number.isFinite(x) && x >= 0 && x <= width);
		assert.ok(Number.isFinite(y) && y >= 0 && y <= height);
		path.push([x, y]);
	};
	const context = {
		globalCompositeOperation: 'source-over', globalAlpha: 1,
		beginPath() { path = []; }, closePath() {}, moveTo: point, lineTo: point,
		arc(x, y, radius) { point(x, y); assert.ok(radius > 0 && radius <= 6.4); arcs++; },
		fillRect() { assert.equal(this.globalCompositeOperation, 'source-over'); },
		fill() {
			assert.ok(this.globalAlpha >= 0 && this.globalAlpha <= 1);
			assert.equal(this.globalCompositeOperation, 'source-over', 'all stars remain visible without a mask');
		},
		stroke() {
			assert.equal(this.globalCompositeOperation, 'source-over');
			assert.ok(this.globalAlpha >= 0 && this.globalAlpha <= 1);
			assert.equal(path.length, 2);
			for (const [x, y] of path) {
				const key = `${x},${y}`;
				degrees.set(key, (degrees.get(key) ?? 0) + 1);
			}
			strokes++;
		}
	};
	const render = create_orrery_renderer({ random, get_settings: () => settings });
	for (width of [1280, 320, 640]) {
		height = width * 9 / 16;
		for (let frame = 0; frame < 600; frame++) {
			arcs = 0; strokes = 0; degrees = new Map();
			render({ context, width, height, seconds: 0.05 });
			assert.equal(arcs, settings.star_count * 2);
			assert.ok(strokes <= settings.star_count * settings.connections_per_star / 2);
			assert.ok([...degrees.values()].every(degree => degree <= settings.connections_per_star));
			assert.equal(context.globalCompositeOperation, 'source-over', 'no occlusion compositing');
		}
	}
	settings = { ...settings, star_count: 0 };
	arcs = 0; strokes = 0; degrees = new Map();
	render({ context, width, height, seconds: 0.05 });
	assert.equal(arcs, 0); assert.equal(strokes, 0);
});

test('orrery tuning clamps pool size, link budget and nonfinite inputs', () => {
	assert.deepEqual(normalize_orrery_settings({ orbit_speed: NaN }), DEFAULT_ORRERY_SETTINGS);
	const settings = normalize_orrery_settings({ star_count: 999, connections_per_star: 99, line_opacity: -1 });
	assert.equal(settings.star_count, 120); assert.equal(settings.connections_per_star, 4);
	assert.equal(settings.line_opacity, 0);
});
