import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create_cinder_renderer, DEFAULT_CINDER_SETTINGS } from '../../mod/expedition-cinder-engine.mjs';

test('Cinder Engine renders approved plumes, cinders and coil halos at different sizes', () => {
 assert.deepEqual(DEFAULT_CINDER_SETTINGS, {plume_count:50,plume_speed:1.15,plume_intensity:2,cinder_count:100,cinder_speed:.3,cinder_glow:2,cinder_distance:1.1,coil_intensity:2,coil_halo:2,coil_pulse:2});
 let gradients=0,arcs=0,saves=0;const finite=(...v)=>assert.ok(v.every(Number.isFinite));
 const context={save(){saves++},restore(){saves--},createRadialGradient(...v){finite(...v);gradients++;return {addColorStop(){}}},fillRect:finite,beginPath(){},arc(...v){finite(...v);arcs++},fill(){},moveTo:finite,bezierCurveTo:finite,stroke(){}};
 const draw=create_cinder_renderer({random:()=>.5});for(const [width,height] of [[1280,720],[320,180]])draw({context,width,height,seconds:.05});
 assert.equal(gradients,140);assert.equal(arcs,200);assert.equal(saves,0);
});
test('Cinder Engine mounts through the shared particle lifecycle',()=>{
 const main=readFileSync(new URL('../../mod/main.mjs',import.meta.url),'utf8'),template=readFileSync(new URL('../../mod/ui/templates.html',import.meta.url),'utf8');
 assert.match(main,/create_renderer: expedition_cinder_engine\.create_cinder_renderer/);assert.match(template,/<mp-expedition-cinder-engine v-if="state\.expedition_state\?\.expedition\?\.chamber\?\.id === 'cinder_engine'"/);
});
