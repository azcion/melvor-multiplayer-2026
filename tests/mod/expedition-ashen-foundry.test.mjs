import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create_ashen_foundry_renderer } from '../../mod/expedition-ashen-foundry.mjs';

test('Ashen Foundry draws the approved falling ash and hot ash only', () => {
	const circles = [], fills = [];
	const context = { beginPath() {}, arc(x, y, radius) { circles.push({ x, y, radius }); },
		fill() { fills.push({ color: this.fillStyle, alpha: this.globalAlpha, blur: this.shadowBlur }); } };
	const draw = create_ashen_foundry_renderer({ random: () => 0.5 });
	draw({ context, width: 1280, height: 720, seconds: 0.05 });
	assert.equal(circles.length, 115);
	assert.equal(fills.filter(fill => fill.color === '#c2c0b5').length, 100);
	assert.equal(fills.filter(fill => fill.color === '#ffad5c' && fill.blur === 8).length, 15);
	assert.ok(circles.every(({ x, y, radius }) => Number.isFinite(x) && Number.isFinite(y) && radius > 0));
	const firstY = circles[0].y;
	circles.length = 0; fills.length = 0;
	draw({ context, width: 640, height: 720, seconds: 0.05 });
	assert.ok(circles[0].y > firstY);
	assert.equal(context.globalAlpha, 1);
	assert.equal(context.shadowBlur, 0);
});

test('Ashen Foundry is wired to the shared lifecycle for its chamber', () => {
	const main = readFileSync(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const template = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	assert.match(main, /create_renderer: expedition_ashen_foundry\.create_ashen_foundry_renderer/);
	assert.match(template, /<mp-expedition-ashen-foundry v-if="state\.expedition_state\?\.expedition\?\.chamber\?\.id === 'ashen_foundry'"/);
});
