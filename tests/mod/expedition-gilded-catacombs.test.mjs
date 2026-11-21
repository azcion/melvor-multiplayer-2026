import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create_catacombs_renderer, DEFAULT_CATACOMBS_SETTINGS } from '../../mod/expedition-gilded-catacombs.mjs';

test('Gilded Catacombs renders approved light, embers, dust and smoke at different sizes',()=>{
 assert.deepEqual(DEFAULT_CATACOMBS_SETTINGS,{firelight:2,flicker_speed:.75,flame_intensity:2,ember_count:140,ember_speed:1.95,ember_glow:2,dust_count:160,dust_opacity:2,smoke:2});
 let arcs=0,gradients=0,saves=0;const finite=(...v)=>assert.ok(v.every(Number.isFinite));
 const context={save(){saves++},restore(){saves--},createRadialGradient(...v){finite(...v);gradients++;return {addColorStop(){}}},fillRect:finite,beginPath(){},arc(...v){finite(...v);arcs++},fill(){}};
 const draw=create_catacombs_renderer({random:()=>.5});for(const [width,height] of [[1280,720],[320,180]])draw({context,width,height,seconds:.05});
 assert.equal(arcs,600);assert.equal(gradients,84);assert.equal(saves,0);assert.equal(context.globalAlpha,1);
});
test('Gilded Catacombs mounts through the shared particle lifecycle',()=>{
 const main=readFileSync(new URL('../../mod/main.mjs',import.meta.url),'utf8'),template=readFileSync(new URL('../../mod/ui/templates.html',import.meta.url),'utf8');
 assert.match(main,/create_renderer: expedition_gilded_catacombs\.create_catacombs_renderer/);assert.match(template,/<mp-expedition-gilded-catacombs v-if="state\.expedition_state\?\.expedition\?\.chamber\?\.id === 'gilded_catacombs'"/);
});
