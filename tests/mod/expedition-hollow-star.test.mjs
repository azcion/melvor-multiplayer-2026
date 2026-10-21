import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
	DEFAULT_HOLLOW_STAR_SETTINGS, HOLLOW_STAR_LIMITS, normalize_hollow_star_settings,
	hollow_star_tasks, create_hollow_star_renderer
} from '../../mod/expedition-hollow-star.mjs';

const task = (task_id, values = {}) => ({ task_id, target_ms: 100, player_ms: 0, system_ms: 0,
	unlocked_at: 1, completed_at: null, trackers: [], ...values });
const snapshot = (tasks, tracking = null, visit_id = 7) => ({
	expedition: { chamber: { id: 'hollow_star', visit_id, tasks } }, tracking
});

test('Hollow Star keeps exact approved settings and bounds invalid controls', () => {
	assert.deepEqual(DEFAULT_HOLLOW_STAR_SETTINGS, {
		blob_size: 1.35, turbulence: 1, motion_speed: 0.45, brightness: 1.6, glow: 6, cell_intensity: 2.95,
		spark_count: 120, spark_speed: 0.25, gas_opacity: 3, gas_speed: 1.2, transition_speed: 4,
		star_count: 900, star_speed: 30.6, star_brightness: 2.84, combat_haze: 1.28,
		tendril_count: 80, tendril_height: 0.75, tendril_opacity: 1, tendril_speed: 1.5,
		molten_color: '#ff782d', plasma_color: '#b7aeff'
	});
	assert.deepEqual(normalize_hollow_star_settings({ star_speed: Infinity, molten_color: 'bad' }), DEFAULT_HOLLOW_STAR_SETTINGS);
	const s = normalize_hollow_star_settings({ star_count: 90000, tendril_count: -1, gas_opacity: 20, star_speed: 100 });
	assert.equal(s.star_count, 3600); assert.equal(s.tendril_count, 0);
	assert.equal(s.gas_opacity, 4); assert.equal(s.star_speed, 50);
});

test('shared task work drives each visual stage; missing or locked work contributes nothing', () => {
	const state = hollow_star_tasks(snapshot([
		task('arrival_support', { player_ms: 25, system_ms: 25 }),
		task('groundwork', { completed_at: 0 }),
		task('melt_star', { player_ms: 20, system_ms: 45 }),
		task('ending_departure', { player_ms: 20, unlocked_at: null }),
		task('initial_defense', { player_ms: 10 }),
		task('continued_defense', { trackers: [{ client_id: 4 }] })
	]));
	assert.deepEqual(state, { visit_id: 7, vent: .5, light: 1, defense: .1, melt: .65,
		continued_defense: 0, complete: 0, defense_active: true, continued_defense_active: true });
	assert.equal(hollow_star_tasks(snapshot([task('melt_star', { player_ms: 900 })])).melt, 1);
	for (const value of [null, {}, { expedition: { chamber: { id: 'entrance' } } }]) {
		const empty = hollow_star_tasks(value);
		assert.equal(empty.light, 0); assert.equal(empty.complete, 0); assert.equal(empty.visit_id, null);
	}
	for (const values of [{ target_ms: 0 }, { player_ms: NaN, system_ms: -5 }, { target_ms: Infinity }])
		assert.equal(hollow_star_tasks(snapshot([task('groundwork', values)])).light, 0);
});

test('combat follows matching work tracking and ceases on completion, including stale trackers', () => {
	const rows = [task('initial_defense')];
	assert.equal(hollow_star_tasks(snapshot(rows, { visit_id: 7, task_id: 'initial_defense' })).defense_active, true);
	assert.equal(hollow_star_tasks(snapshot(rows, { visit_id: 6, task_id: 'initial_defense' })).defense_active, false);
	rows[0].unlocked_at = null;
	assert.equal(hollow_star_tasks(snapshot(rows, { visit_id: 7, task_id: 'initial_defense' })).defense_active, false);
	rows[0] = task('initial_defense', { completed_at: 4, trackers: [{}], player_ms: 90 });
	const done = hollow_star_tasks(snapshot(rows, { visit_id: 7, task_id: 'initial_defense' }));
	assert.equal(done.defense, 1); assert.equal(done.defense_active, false);
});

function with_canvas(run) {
	const previous = globalThis.document;
	const textures = [], stack = [];
	const log = { arcs: 0, strokes: 0, lines: [], moves: [], images: 0 };
	const finite = (...values) => values.forEach(value => assert.ok(Number.isFinite(value)));
	const c = {
		globalAlpha: 1, globalCompositeOperation: 'source-over',
		save() { stack.push([this.globalAlpha, this.globalCompositeOperation]); },
		restore() { [this.globalAlpha, this.globalCompositeOperation] = stack.pop(); },
		beginPath() {}, closePath() {}, clip() {},
		moveTo(...xy) { finite(...xy); log.moves.push(xy); },
		lineTo(...xy) { finite(...xy); log.lines.push(xy); },
		quadraticCurveTo: finite, bezierCurveTo: finite, ellipse: finite,
		arc(...values) { finite(...values); assert.ok(values[2] > 0); log.arcs++; },
		createRadialGradient(...values) {
			finite(...values); assert.ok(values[2] >= 0 && values[5] > 0);
			return { addColorStop(offset) { assert.ok(offset >= 0 && offset <= 1); } };
		},
		fillRect: finite, fill() {}, stroke() { log.strokes++; },
		drawImage(texture, ...bounds) { assert.ok(textures.includes(texture)); finite(...bounds); log.images++; }
	};
	let alpha = 1;
	Object.defineProperty(c, 'globalAlpha', { get: () => alpha, set: value => {
		assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `invalid alpha ${value}`); alpha = value;
	} });
	globalThis.document = { createElement: () => {
		const texture = { getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
			putImageData(pixels) { texture.pixels = pixels.data; } }) };
		textures.push(texture); return texture;
	} };
	let seed = 754;
	const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
	const reset = () => { log.arcs = log.strokes = log.images = 0; log.lines = []; log.moves = []; };
	try { run({ c, log, stack, textures, random, reset }); }
	finally { globalThis.document = previous; }
}

test('pit tendrils retain geometry across depth while batching calls and reusing textures at extremes', () => with_canvas(({ c, log, stack, textures, random, reset }) => {
	let settings = { ...DEFAULT_HOLLOW_STAR_SETTINGS }, tasks = { visit_id: 7, defense: .5, defense_active: true };
	const draw = create_hollow_star_renderer({ random, get_settings: () => settings, get_tasks: () => tasks });
	assert.equal(textures.length, 2);
	for (const texture of textures) {
		assert.equal(texture.width, 256); assert.equal(texture.height, 96);
		for (let y = 0; y < 96; y++) {
			const a = x => texture.pixels[(y * 256 + x) * 4 + 3];
			assert.ok(Math.abs(a(0) - a(255)) <= 2);
			if (y === 0 || y === 95) for (let x = 0; x < 256; x++) assert.equal(a(x), 0);
		}
	}
	for (const width of [390, 1100]) {
		const height = width * 9 / 16;
		reset(); draw({ context: c, width, height, seconds: .05 });
		assert.equal(log.strokes, 384); assert.equal(log.lines.length, 13 + 80 * 24);
		const ys = log.moves.slice(1).map(xy => xy[1] / height);
		assert.ok(Math.min(...ys) < .65); assert.ok(Math.max(...ys) > 1);
		settings = normalize_hollow_star_settings(Object.fromEntries(Object.entries(HOLLOW_STAR_LIMITS).map(([key, bounds]) => [key, bounds[1]])));
		tasks = { ...tasks, light: 1, melt: 1 };
		for (let i = 0; i < 60; i++) {
			reset(); draw({ context: c, width, height, seconds: .05 });
			assert.ok(log.arcs <= 4080); assert.ok(log.strokes <= 396); assert.equal(stack.length, 0);
			assert.equal(c.globalCompositeOperation, 'source-over');
		}
		settings = { ...DEFAULT_HOLLOW_STAR_SETTINGS }; tasks = { visit_id: tasks.visit_id + 1, defense: .5, defense_active: true };
	}
	assert.equal(textures.length, 2);
}));

test('completion ends combat, leaves the stellar field, and a new visit resets the effect immediately', () => with_canvas(({ c, log, random, reset }) => {
	let tasks = { visit_id: 7, light: 1, melt: 1, defense: 1, continued_defense: .5, continued_defense_active: true };
	const draw = create_hollow_star_renderer({ random, get_tasks: () => tasks });
	const frame = () => { reset(); draw({ context: c, width: 1100, height: 618.75, seconds: .05 }); };
	for (let i = 0; i < 120; i++) frame();
	assert.ok(log.strokes > 384); assert.equal(log.images, 14);
	tasks = { ...tasks, continued_defense: 1, complete: 1, continued_defense_active: false };
	for (let i = 0; i < 160; i++) frame();
	assert.equal(log.strokes, 9); assert.equal(log.images, 8);
	assert.equal(log.arcs, 1020);
	tasks = { visit_id: 8 }; frame();
	assert.equal(log.strokes, 0); assert.equal(log.arcs, 32); assert.equal(log.images, 8);
}));

test('Hollow Star loads via the mod context, reads current snapshots and mounts only for its chamber', () => {
	const main = readFileSync(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const template = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	assert.ok(main.includes("ctx.loadModule('expedition-hollow-star.mjs')"));
	assert.ok(main.includes('get_tasks: () => expedition_hollow_star.hollow_star_tasks(state.expedition_state)'));
	assert.match(template, /<mp-expedition-hollow-star v-if="state\.expedition_state\?\.expedition\?\.chamber\?\.id === 'hollow_star'"><\/mp-expedition-hollow-star>/);
});
