import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create_sanctum_renderer, DEFAULT_SANCTUM_SETTINGS } from '../../mod/expedition-starless-sanctum.mjs';

test('Sanctum renders approved black ghosts and fragments at different sizes', () => {
 assert.deepEqual(DEFAULT_SANCTUM_SETTINGS,{ghost_count:24,ghost_opacity:.4,ghost_speed:.45,ghost_fade:1.6,ghost_size:.45,fragment_count:30,fragment_speed:2,fragment_opacity:1,fissure_glow:2,fissure_speed:2});
 const stops=[], images=[], finite=(...values)=>assert.ok(values.every(Number.isFinite));
 const context={save(){},restore(){},translate:finite,scale:finite,rotate:finite,createRadialGradient(...v){finite(...v);return {addColorStop(_p,color){stops.push(color)}}},fillRect:finite,drawImage(_image,...v){finite(...v);images.push(v)},beginPath(){},moveTo:finite,lineTo:finite,closePath(){},fill(){}};
 const previous=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>context})};
 try {const draw=create_sanctum_renderer({random:()=>.3});for(const [width,height] of [[1280,720],[320,180]])draw({context,width,height,seconds:.05});assert.equal(images.length,48);assert.ok(stops.some(color=>color.startsWith('rgba(0,0,0,')));assert.notDeepEqual(images[0],images[24]);} finally {globalThis.document=previous;}
});
test('Sanctum mounts through the shared particle lifecycle',()=>{
 const main=readFileSync(new URL('../../mod/main.mjs',import.meta.url),'utf8'),template=readFileSync(new URL('../../mod/ui/templates.html',import.meta.url),'utf8');
 assert.match(main,/create_renderer: expedition_starless_sanctum\.create_sanctum_renderer/);assert.match(template,/<mp-expedition-starless-sanctum v-if="state\.expedition_state\?\.expedition\?\.chamber\?\.id === 'starless_sanctum'"/);
});
