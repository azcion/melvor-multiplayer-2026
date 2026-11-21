import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create_convergence_renderer, DEFAULT_CONVERGENCE_SETTINGS } from '../../mod/expedition-convergence-gallery.mjs';

test('Convergence renders approved settings with finite geometry across sizes and fall phases', () => {
 assert.deepEqual(DEFAULT_CONVERGENCE_SETTINGS, { dust_count: 37, dust_speed: 3, dust_opacity: 1, ember_count: 100,
  ember_speed: 2, ember_brightness: 1, fissure_glow: 1, fall_frequency: 1, fall_density: 5, fall_size: .9,
  fissure_pulses: 1, strand_count: 24, strand_intensity: .85 });
 let circles = 0, paths = 0, shapes = 0;
 const finite = (...values) => assert.ok(values.every(Number.isFinite));
 const context = { beginPath() {}, moveTo: finite, lineTo: finite, bezierCurveTo: finite, quadraticCurveTo: finite,
  arc(...args) { finite(...args); circles++; }, stroke() { paths++; }, fill() { shapes++; }, closePath() {},
  save() {}, restore() {}, translate: finite, rotate: finite, fillRect: finite,
  createRadialGradient(...args) { finite(...args); return { addColorStop() {} }; } };
 const draw = create_convergence_renderer();
 for (const [width, height] of [[1280, 720], [320, 180]]) for (let i = 0; i < 600; i++) draw({ context, width, height, seconds: .05 });
 assert.ok(circles >= 1200 * 137); assert.ok(paths > 0); assert.ok(shapes > circles); assert.equal(context.globalAlpha, 1);
});

test('Convergence mounts through the shared particle lifecycle', () => {
 const main = readFileSync(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
 const template = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
 assert.match(main, /create_renderer: expedition_convergence_gallery\.create_convergence_renderer/);
 assert.match(template, /<mp-expedition-convergence-gallery v-if="state\.expedition_state\?\.expedition\?\.chamber\?\.id === 'convergence_gallery'"/);
});
