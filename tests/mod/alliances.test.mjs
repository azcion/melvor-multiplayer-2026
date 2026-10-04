import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { install_social_actions } from '../../mod/client-actions-social.mjs';
function setup() {
	const calls=[];
	const state={is_guild_member:true,alliance_access:true,alliance_loading:false,alliance_modal:null,alliance_name_input:'  My Alliance  ',alliance_picker_mode:'found',alliance_picker_page:0};
	const runtime={state,api_get:async route=> { calls.push(['get',route]); return route.includes('guild-preview')?{guild:{guild_id:2,name:'Other'}}:route.includes('discover')?{entries:[],has_more:false}:{alliance:null,processes:[]}; },
		api_post:async(route,payload)=> { calls.push(['post',route,payload]); return {success:true}; },
		queue_modal:(...args)=>calls.push(['modal',...args]),close_modal_and_wait:async id=>calls.push(['close',id]),close_modal:()=>{},
		refresh_council:async()=>calls.push(['council']),getLangString:key=>key,is_button_spinning:()=>false,show_button_spinner:()=>{},hide_button_spinner:()=>{},notify_error:()=>{}};
	Object.assign(state,install_social_actions(runtime));
	return {state,calls,runtime};
}
test('Guild preview restores picker only when opened from the picker',async()=> {
	const {state,calls}=setup();
	await state.show_alliance_picker('found');
	await state.preview_alliance_guild(2,true);
	assert.ok(calls.some(call=>call[0]==='close'&&call[1]==='alliance-picker-modal'));
	await state.close_alliance_preview();
	assert.equal(calls.filter(call=>call[0]==='modal'&&call[2]==='alliance-picker-modal').length,2);
	await state.preview_alliance_guild(2,false);
	await state.close_alliance_preview();
	assert.equal(calls.filter(call=>call[0]==='modal'&&call[2]==='alliance-picker-modal').length,2);
});
test('founding sends exact local consent request and refreshes Council after modal teardown',async()=> {
	const {state,calls}=setup();
	await state.show_alliance_picker('found');
	await state.alliance_action({currentTarget:{}},'found',2);
	assert.deepEqual(calls.find(call=>call[0]==='post'),['post','/api/alliances/propose',{kind:'found',target_id:2,name:'My Alliance'}]);
	assert.ok(calls.findIndex(call=>call[0]==='close')<calls.findIndex(call=>call[0]==='council'));
});
test('failed reads release loader and retain the preceding Alliance state',async()=> {
	const {state,runtime}=setup();state.alliance_state={alliance:{id:1}};
	runtime.api_get=async()=>null;
	// Actions capture the configured boundary when installed.
	Object.assign(state,install_social_actions(runtime));
	await state.refresh_alliance();
	assert.equal(state.alliance_loading,false);assert.equal(state.alliance_state.alliance.id,1);assert.equal(state.alliance_error,'MOD_MP_GENERIC_ERR');
});

test('Alliance mutation buttons provide the established spinner element',()=> {
	const source=readFileSync(new URL('../../mod/ui/templates.html',import.meta.url),'utf8');
	const buttons=[...source.matchAll(/<button\b((?:[^>"']|"[^"]*"|'[^']*')*)>(.*?)<\/button>/gs)].filter(([,attributes])=>attributes.includes('state.alliance_action'));
	assert.equal(buttons.length,6);
	for(const [,,body] of buttons) assert.match(body,/role="status"/);
});


test('characters without Alliance access make no Alliance requests and clear stale state', async () => {
	const {state,calls}=setup();
	state.alliance_access=false;
	state.alliance_state={alliance:{id:1},processes:[{process_id:1}]};
	await state.refresh_alliance();
	await state.show_alliance_picker('found');
	await state.preview_alliance_guild(2);
	await state.alliance_action({currentTarget:{}},'found',2);
	assert.deepEqual(calls,[]);
	assert.deepEqual(state.alliance_state,{alliance:null,processes:[],affiliation_pending:false});
});

test('Guild headers contain no policy tags and Alliance entry points require server eligibility', () => {
	const source=readFileSync(new URL('../../mod/ui/templates.html',import.meta.url),'utf8');
	const header=source.slice(source.indexOf('class="block-content mp-guild-summary"'),source.indexOf('class="mp-guild-columns"'));
	assert.doesNotMatch(header,/alliance_guild_tags|badge/);
	assert.match(source,/mp-alliance" v-show="state.alliance_access && state.is_guild_member"/);
	assert.match(source,/mp-chat-visibility" v-if="state.alliance_access"/);
	assert.match(source,/v-if="state.alliance_access && state.alliance_chat_enabled"/);
});
