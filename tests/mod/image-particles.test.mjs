import assert from 'node:assert/strict';
import test from 'node:test';
import { create_image_particle_element } from '../../mod/image-particles.mjs';

test('image overlays pause, resize, adopt cloned canvases and release every scheduled resource', () => {
	const keys = ['HTMLElement', 'document', 'window', 'ResizeObserver', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame'];
	const originals = new Map(keys.map(key => [key, globalThis[key]]));
	const frames = new Map();
	const listeners = new Set();
	let sequence = 0;
	let clears = 0;
	const draws = [];
	const context = { setTransform() {}, clearRect() { clears++; }, save() {}, restore() {} };
	const canvas = () => ({ style: {}, setAttribute() {}, getContext: () => context });
	const motion = { matches: false, addEventListener(_, cb) { listeners.add(cb); }, removeEventListener(_, cb) { listeners.delete(cb); } };
	try {
		globalThis.HTMLElement = class {
			constructor() { this.children = []; this.style = {}; this.clientWidth = 400; this.clientHeight = 225; this.isConnected = true; }
			setAttribute() {}
			append(child) { child.parentElement = this; this.children.push(child); }
			querySelector() { return this.children[0] ?? null; }
			querySelectorAll() { return this.children; }
		};
		globalThis.document = { hidden: false, createElement: canvas, addEventListener: motion.addEventListener, removeEventListener: motion.removeEventListener };
		globalThis.window = { devicePixelRatio: 3, matchMedia: () => motion };
		globalThis.ResizeObserver = globalThis.IntersectionObserver = class {
			constructor(cb) { this.callback = cb; }
			observe() { this.observing = true; }
			disconnect() { this.observing = false; }
		};
		globalThis.requestAnimationFrame = cb => { frames.set(++sequence, cb); return sequence; };
		globalThis.cancelAnimationFrame = id => frames.delete(id);
		const tick = time => { const [id, cb] = frames.entries().next().value; frames.delete(id); cb(time); };
		const Particles = create_image_particle_element({ create_renderer: () => frame => draws.push(frame) });
		const element = new Particles();
		element.append(canvas()); // Template clone: existing DOM, no instance fields.
		element.connectedCallback();
		assert.equal(element.children.length, 1);
		assert.equal(element.canvas.width, 800);
		assert.equal(element.canvas.height, 450);
		assert.equal(frames.size, 0);
		element.intersection_observer.callback([{ isIntersecting: true }]);
		element.sync_running();
		assert.equal(frames.size, 1);
		tick(1000);
		tick(5000);
		assert.deepEqual(draws.map(frame => frame.seconds), [0, 0.05]);
		for (const cause of ['hidden', 'motion', 'offscreen', 'zero']) {
			if (cause === 'hidden') document.hidden = true;
			if (cause === 'motion') motion.matches = true;
			if (cause === 'offscreen') element.visible = false;
			if (cause === 'zero') { element.clientWidth = 0; element.resize(); }
			const before = clears;
			element.sync_running();
			assert.equal(frames.size, 0, cause);
			assert.ok(clears > before);
			document.hidden = false; motion.matches = false; element.visible = true;
			element.clientWidth = 400; element.resize(); element.sync_running();
			tick(10000);
			assert.equal(draws.at(-1).seconds, 0, 'resume does not catch up');
		}
		const observer = element.intersection_observer;
		element.isConnected = false;
		element.disconnectedCallback();
		assert.equal(frames.size, 0);
		assert.equal(listeners.size, 0);
		assert.equal(observer.observing, false);
		observer.callback([{ isIntersecting: true }]);
		assert.equal(frames.size, 0, 'late observer cannot restart a detached element');
		element.isConnected = true;
		element.connectedCallback();
		assert.equal(element.children.length, 1);
		element.disconnectedCallback();
		const unavailable = new Particles();
		unavailable.append({ ...canvas(), getContext: () => null });
		unavailable.connectedCallback();
		unavailable.intersection_observer.callback([{ isIntersecting: true }]);
		assert.equal(frames.size, 0);
		unavailable.disconnectedCallback();
	} finally {
		for (const [key, value] of originals) {
			if (value === undefined) delete globalThis[key];
			else globalThis[key] = value;
		}
	}
});
