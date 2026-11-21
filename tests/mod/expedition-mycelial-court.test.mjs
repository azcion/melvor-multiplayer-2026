import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create_court_renderer, DEFAULT_COURT_SETTINGS } from '../../mod/expedition-mycelial-court.mjs';

test('Mycelial Court renders approved spores and root and mushroom glow at different sizes',()=>{
 assert.deepEqual(DEFAULT_COURT_SETTINGS,{spore_count:260,spore_speed:1.05,spore_glow:2,mushroom_glow:2,root_pulses:2,root_speed:.2,cap_spores:2});
 let arcs=0,gradients=0;const finite=(...v)=>assert.ok(v.every(Number.isFinite));
 const context={createRadialGradient(...v){finite(...v);gradients++;return {addColorStop(){}}},fillRect:finite,beginPath(){},arc(...v){finite(...v);arcs++},fill(){}};
 const draw=create_court_renderer({random:()=>.5});for(const [width,height] of [[1280,720],[320,180]])draw({context,width,height,seconds:.05});
 assert.equal(arcs,690);assert.equal(gradients,42);assert.equal(context.globalAlpha,1);
});
test('Mycelial Court mounts through the shared particle lifecycle',()=>{
 const main=readFileSync(new URL('../../mod/main.mjs',import.meta.url),'utf8'),template=readFileSync(new URL('../../mod/ui/templates.html',import.meta.url),'utf8');
 assert.match(main,/create_renderer: expedition_mycelial_court\.create_court_renderer/);assert.match(template,/<mp-expedition-mycelial-court v-if="state\.expedition_state\?\.expedition\?\.chamber\?\.id === 'mycelial_court'"/);
});
