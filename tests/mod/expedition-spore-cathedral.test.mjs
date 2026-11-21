import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create_spore_renderer, DEFAULT_SPORE_SETTINGS } from '../../mod/expedition-spore-cathedral.mjs';

test('Spore Cathedral renders the approved spores and cap glow at multiple sizes', () => {
 assert.deepEqual(DEFAULT_SPORE_SETTINGS, { spore_count: 240, spore_speed: 2.5, spore_intensity: .45, cap_spores: 1, fungal_glow: 1 });
 let circles = 0, glows = 0;
 const finite = (...values) => assert.ok(values.every(Number.isFinite));
 const context = { beginPath() {}, arc(...args) { finite(...args); circles++; }, fill() {}, fillRect: finite,
  createRadialGradient(...args) { finite(...args); glows++; return { addColorStop() {} }; } };
 const draw = create_spore_renderer();
 for (const [width, height] of [[1280, 720], [320, 180]]) draw({ context, width, height, seconds: .05 });
 assert.equal(circles, 2 * (240 + 85)); assert.equal(glows, 12); assert.equal(context.globalAlpha, 1);
});

test('Spore Cathedral mounts through the shared particle lifecycle', () => {
 const main = readFileSync(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
 const template = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
 assert.match(main, /create_renderer: expedition_spore_cathedral\.create_spore_renderer/);
 assert.match(template, /<mp-expedition-spore-cathedral v-if="state\.expedition_state\?\.expedition\?\.chamber\?\.id === 'spore_cathedral'"/);
});
