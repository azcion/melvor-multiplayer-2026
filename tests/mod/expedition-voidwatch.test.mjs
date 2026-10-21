import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { create_voidwatch_renderer, normalize_voidwatch_settings, DEFAULT_VOIDWATCH_SETTINGS } from '../../mod/expedition-voidwatch.mjs';

test('Voidwatch retains approved settings and bounds live color and particle controls', () => {
	assert.deepEqual(DEFAULT_VOIDWATCH_SETTINGS, {
		color: '#9c8dff', flame_height: 0.25, flame_intensity: 1, flame_speed: 1.5,
		ember_count: 120, ember_speed: 1.1, mist_opacity: 1, mist_speed: 1.4,
		doorway_intensity: 0.16, doorway_speed: 4
	});
	assert.deepEqual(normalize_voidwatch_settings({ flame_speed: Infinity, color: 'invalid' }), DEFAULT_VOIDWATCH_SETTINGS);
	const s = normalize_voidwatch_settings({ color: '#ffae52', ember_count: 1000, flame_height: -1, mist_opacity: 20 });
	assert.equal(s.color, '#ffae52'); assert.equal(s.ember_count, 120);
	assert.equal(s.flame_height, 0); assert.equal(s.mist_opacity, 1);
});

test('Voidwatch reuses seamless mist and emits fire and embers only at the three visible pillars', () => {
	const previous_document = globalThis.document;
	let generated = 0, pixels, arcs = [], centers = [], draws = [], stack = [];
	const texture = { getContext: () => ({
		createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
		putImageData: data => { pixels = data.data; generated++; }
	}) };
	globalThis.document = { createElement: () => texture };
	try {
		let seed = 17;
		const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
		let live = { ...DEFAULT_VOIDWATCH_SETTINGS };
		const render = create_voidwatch_renderer({ random, get_settings: () => live });
		assert.equal(texture.width, 256); assert.equal(texture.height, 96);
		for (let y = 0; y < 96; y++) {
			const alpha = x => pixels[(y * 256 + x) * 4 + 3];
			assert.ok(Math.abs(alpha(0) - alpha(255)) <= 2, 'periodic horizontal join');
			if (y === 0 || y === 95) for (let x = 0; x < 256; x++) assert.equal(alpha(x), 0);
		}
		const finite = (...values) => assert.ok(values.every(Number.isFinite));
		const alpha = () => assert.ok(context.globalAlpha >= 0 && context.globalAlpha <= 1);
		const context = {
			globalAlpha: 1,
			save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop(); },
			beginPath() {}, closePath() {}, clip() {}, moveTo: finite, lineTo: finite,
			rect: finite, bezierCurveTo: finite,
			createRadialGradient(...args) { finite(...args); centers.push(args.slice(0, 2)); return { addColorStop() {} }; },
			fillRect(...args) { finite(...args); alpha(); }, fill() { alpha(); },
			drawImage(image, ...bounds) { assert.equal(image, texture); finite(...bounds); alpha(); draws.push(bounds); },
			arc(x, y, radius) { finite(x, y, radius); assert.ok(radius > 0); alpha(); arcs.push([x, y]); }
		};
		for (const width of [1280, 390, 640]) {
			const height = width * 9 / 16;
			for (let frame = 0; frame < 240; frame++) {
				arcs = []; centers = []; draws = [];
				render({ context, width, height, seconds: 0.05 });
				assert.equal(arcs.length, 120); assert.equal(centers.length, 4);
				for (const [index, expected] of [0.372, 0.518, 0.618].entries()) {
					assert.ok(Math.abs(centers[index + 1][0] / width - expected) < 1e-12);
				}
				assert.ok(arcs.every(([x]) => x / width > 0.35), 'removed left source emits no embers');
				assert.equal(draws.length, 6); assert.equal(stack.length, 0);
				for (let i = 0; i < 6; i += 2) assert.ok(Math.abs(draws[i + 1][0] - draws[i][0] - width) < 1e-8);
			}
		}
		live = { ...live, ember_count: 0, color: '#ffae52' }; arcs = [];
		render({ context, width: 390, height: 219.375, seconds: 0.05 });
		assert.equal(arcs.length, 0); assert.equal(generated, 1, 'settings and resizing reuse texture');
	} finally { globalThis.document = previous_document; }
});

test('Voidwatch loads through the mod context and mounts only for its chamber', () => {
	const main = readFileSync(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const template = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	assert.ok(main.includes("ctx.loadModule('expedition-voidwatch.mjs')"));
	assert.ok(main.includes('create_renderer: expedition_voidwatch.create_voidwatch_renderer'));
	assert.match(template, /<mp-expedition-voidwatch v-if="state\.expedition_state\?\.expedition\?\.chamber\?\.id === 'voidwatch_threshold'"><\/mp-expedition-voidwatch>/);
});
