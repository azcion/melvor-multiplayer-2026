import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create_blackwater_renderer, DEFAULT_BLACKWATER_SETTINGS } from '../../mod/expedition-blackwater-nave.mjs';

test('Blackwater renders the selected scene with finite coordinates at multiple sizes', () => {
 assert.deepEqual(DEFAULT_BLACKWATER_SETTINGS, { root_opacity: .1, pulse_intensity: .55, pulse_speed: .8,
  bubble_count: 32, bubble_speed: 1.7, bubble_intensity: .4, gas_opacity: 1 });
 let strokes = 0, bubbles = 0;
 const finite = (...values) => assert.ok(values.every(Number.isFinite));
 const context = { beginPath() {}, moveTo: finite, lineTo: finite, quadraticCurveTo: finite,
  stroke() { strokes++; }, ellipse(...args) { finite(...args); bubbles++; }, fill() {}, fillRect: finite,
  createRadialGradient(...args) { finite(...args); return { addColorStop() {} }; } };
 const draw = create_blackwater_renderer();
 for (const [width, height] of [[1280, 720], [320, 180]]) {
  for (let i = 0; i < 20; i++) draw({ context, width, height, seconds: .05 });
 }
 assert.ok(strokes > 0); assert.ok(bubbles > 0); assert.equal(context.globalAlpha, 1);
});

test('Blackwater is mounted with the shared particle lifecycle', () => {
 const main = readFileSync(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
 const template = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
 assert.match(main, /create_renderer: expedition_blackwater_nave\.create_blackwater_renderer/);
 assert.match(template, /<mp-expedition-blackwater-nave v-if="state\.expedition_state\?\.expedition\?\.chamber\?\.id === 'blackwater_nave'"/);
});
