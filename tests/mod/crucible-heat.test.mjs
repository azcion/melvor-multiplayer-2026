import test from 'node:test';
import assert from 'node:assert/strict';
import { create_heat_renderer, HEAT_SETTINGS } from '../../mod/crucible-heat.mjs';

test('Heat renderer clips to live tier, keeps positions finite, and balances Canvas state', () => {
 let tier = 0, balance = 0;
 const clips = [];
 const gradient = { addColorStop() {} };
 const context = new Proxy({}, { get(_, key) {
  if (key === 'save') return () => balance++;
  if (key === 'restore') return () => balance--;
  if (key === 'createRadialGradient') return () => gradient;
  return (...args) => {
   for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg));
   if (key === 'roundRect') clips.push(args[2]);
  };
 }, set() { return true; } });
 const draw = create_heat_renderer({ get_tier: () => tier });
 for (const width of [286, 1000]) for (tier of [0, 1, 3, 6, 9]) {
  const before = clips.length;
  draw({ context, width, height: 16, seconds: .016 });
  assert.equal(balance, 0);
  if (tier) assert.equal(clips.at(-1), width * tier / 9);
  else assert.equal(clips.length, before);
 }
 assert.equal(HEAT_SETTINGS.gearSize, .6);
 assert.equal(HEAT_SETTINGS.coinSize, 1.2);
 assert.equal(HEAT_SETTINGS.height, 16);
});
