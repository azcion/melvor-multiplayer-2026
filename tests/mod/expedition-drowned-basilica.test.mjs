import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create_basilica_renderer, DEFAULT_BASILICA_SETTINGS } from '../../mod/expedition-drowned-basilica.mjs';

test('Drowned Basilica draws approved swimming lights within the water mask at different sizes', () => {
 assert.deepEqual(DEFAULT_BASILICA_SETTINGS, {fish_count:55,fish_speed:.4,fish_brightness:.55,fish_glow:2,fish_size:.6,fish_trails:2});
 let ellipses=0, clips=0, saves=0;
 const finite=(...values)=>assert.ok(values.every(Number.isFinite));
 const context={save(){saves++},restore(){saves--},beginPath(){},moveTo:finite,lineTo:finite,closePath(){},clip(rule){assert.equal(rule,'evenodd');clips++},translate:finite,rotate:finite,ellipse(...v){finite(...v);ellipses++},fill(){},quadraticCurveTo:finite,stroke(){}};
 const draw=create_basilica_renderer({random:()=>.5});
 for(const [width,height] of [[1280,720],[320,180]]) draw({context,width,height,seconds:.05});
 assert.equal(ellipses,110);assert.equal(clips,2);assert.equal(saves,0);
});

test('Drowned Basilica mounts through the shared particle lifecycle',()=>{
 const main=readFileSync(new URL('../../mod/main.mjs',import.meta.url),'utf8');
 const template=readFileSync(new URL('../../mod/ui/templates.html',import.meta.url),'utf8');
 assert.match(main,/create_renderer: expedition_drowned_basilica\.create_basilica_renderer/);
 assert.match(template,/<mp-expedition-drowned-basilica v-if="state\.expedition_state\?\.expedition\?\.chamber\?\.id === 'drowned_basilica'"/);
});
