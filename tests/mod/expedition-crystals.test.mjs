import assert from 'node:assert/strict';
import test from 'node:test';
import { create_crystal_renderer } from '../../mod/expedition-crystals.mjs';

test('crystal particles remain bounded and finite through long animation and responsive resizing', () => {
	let seed = 7;
	const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
	const render = create_crystal_renderer(random);
	let points = [];
	let arcs = 0;
	const context = {
		beginPath() {}, closePath() {},
		fill() { assert.ok(this.globalAlpha >= 0 && this.globalAlpha <= 0.65); },
		arc(x, y, radius) { assert.ok(radius > 0 && radius <= 4.2); points.push([x, y]); arcs++; },
		moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); }
	};
	for (const width of [1280, 320, 640]) {
		const height = width * 9 / 16;
		for (let frame = 0; frame < 1200; frame++) {
			points = []; arcs = 0;
			render({ context, width, height, seconds: 0.05 });
			assert.equal(arcs, 84, 'fixed 42-mote pool with core and halo');
			for (const [x, y] of points) {
				assert.ok(Number.isFinite(x) && x >= 0 && x <= width);
				assert.ok(Number.isFinite(y) && y >= 0 && y <= height);
			}
		}
	}
});
