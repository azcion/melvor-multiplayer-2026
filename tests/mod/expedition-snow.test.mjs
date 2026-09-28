import assert from 'node:assert/strict';
import test from 'node:test';
import { advance_snow_particle, create_expedition_snow_element, DEFAULT_SNOW_SETTINGS, normalize_snow_settings } from '../../mod/expedition-snow.mjs';

test('snow settings bound density and drawing cost while keeping the size range ordered', () => {
	assert.deepEqual(normalize_snow_settings({ count: 999, speed: -20, opacity: 150,
		min_size: 6, max_size: 2, angle: 90 }),
		{ count: 120, speed: 0, opacity: 100, min_size: 6, max_size: 6, angle: 60 });
	assert.deepEqual(DEFAULT_SNOW_SETTINGS,
		{ count: 120, speed: 40, opacity: 50, min_size: 0.5, max_size: 1, angle: -60 });
});

test('snow angle changes horizontal travel and particles wrap within the art', () => {
	const settings = normalize_snow_settings({ ...DEFAULT_SNOW_SETTINGS, speed: 40, angle: 45 });
	const particle = { x: 20, y: 20, speed_factor: 1, size_factor: 0.5 };
	const radius = advance_snow_particle(particle, settings, 100, 100, 1);
	assert.ok(Math.abs(particle.x - 60) < 0.00001);
	assert.equal(particle.y, 60);
	assert.equal(radius, 0.75);
	advance_snow_particle(particle, settings, 100, 70, 1, () => 0.25);
	assert.equal(particle.y, -radius);
	assert.equal(particle.x, 25);
});

test('reconnecting the snow element keeps a single canvas', () => {
	const originals = Object.fromEntries(['HTMLElement', 'document', 'window', 'ResizeObserver', 'IntersectionObserver']
		.map(key => [key, globalThis[key]]));
	const context = { setTransform() {}, clearRect() {} };
	try {
		globalThis.HTMLElement = class {
			constructor() { this.children = []; this.clientWidth = 400; this.clientHeight = 225; }
			append(child) { child.parentElement = this; this.children.push(child); }
			querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
			querySelectorAll(selector) { return selector === 'canvas' ? this.children : []; }
		};
		globalThis.document = {
			createElement: () => ({ setAttribute() {}, getContext: () => context }),
			addEventListener() {}, removeEventListener() {}
		};
		globalThis.window = { devicePixelRatio: 1, matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }) };
		globalThis.ResizeObserver = class { observe() {} disconnect() {} };
		globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
		const Snow = create_expedition_snow_element({ get_settings: () => DEFAULT_SNOW_SETTINGS, on_stats() {} });
		const snow = new Snow();
		snow.connectedCallback();
		snow.disconnectedCallback();
		snow.connectedCallback();
		assert.equal(snow.children.length, 1);
		assert.equal(snow.canvas.width, 400);
		assert.equal(snow.canvas.height, 225);
		snow.disconnectedCallback();
		const cloned = new Snow();
		cloned.append({ setAttribute() {}, getContext: () => context });
		cloned.connectedCallback();
		assert.equal(cloned.children.length, 1);
		assert.equal(cloned.canvas, cloned.children[0]);
		cloned.disconnectedCallback();
	} finally {
		for (const [key, value] of Object.entries(originals)) {
			if (value === undefined) delete globalThis[key];
			else globalThis[key] = value;
		}
	}
});
