import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { install_social_actions } from '../../mod/client-actions-social.mjs';
function setup() {
	const calls=[];
	const state={get_guild_icon: id => 'guild-icon:' + id,is_guild_member:true,alliance_access:true,alliance_loading:false,alliance_modal:null,alliance_name_input:'  My Alliance  ',alliance_picker_mode:'found',alliance_picker_page:0};
	const runtime={state,api_get:async route=> { calls.push(['get',route]); return route.includes('guild-preview')?{guild:{guild_id:2,name:'Other'}}:route.includes('discover')?{entries:[],has_more:false}:{alliance:null,processes:[]}; },
		api_post:async(route,payload)=> { calls.push(['post',route,payload]); return {success:true}; },
		queue_modal:(...args)=>calls.push(['modal',...args]),close_modal_and_wait:async id=>calls.push(['close',id]),close_modal:()=>{},
		update_guild_nav:()=>{},refresh_council:async()=>calls.push(['council']),getLangString:key=>key,is_button_spinning:()=>false,show_button_spinner:()=>{},hide_button_spinner:()=>{},notify_error:()=>{},notify:()=>{}};
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
	const buttons=[...source.matchAll(/<button\b((?:[^>"']|"[^"]*"|'[^']*')*)>(.*?)<\/button>/gs)].filter(([,attributes])=>attributes.includes('state.alliance_action') || (attributes.includes('state.show_alliance_confirmation') && !attributes.includes('null, null, true')));
	assert.equal(buttons.length,10);
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
	const header=source.slice(source.indexOf('class="block-content mp-guild-summary"'),source.indexOf('class="block block-rounded mp-guild-applicants-block"'));
	assert.doesNotMatch(header,/alliance_guild_tags|badge/);
	assert.match(source,/mp-alliance" v-show="state.alliance_access && state.is_guild_member"/);
	assert.match(source,/mp-chat-visibility" v-if="state.alliance_access"/);
	assert.match(source,/v-if="state.alliance_access && state.alliance_chat_enabled"/);
});


test('Council copy distinguishes founding consent, applications, and Alliance ballots', () => {
	const {state,runtime}=setup();
	const english=JSON.parse(readFileSync(new URL('../../mod/data/lang/en.json',import.meta.url),'utf8'));
	runtime.getLangString=key=>english[key];
	Object.assign(state,install_social_actions(runtime));
	const founding={type:'alliance_consider',proposal:{kind:'found',name:'Silver Dawn'}};
	assert.equal(state.alliance_petition_kind(founding),'consider');
	assert.match(state.alliance_proposal_description(founding.proposal,state.alliance_petition_kind(founding)),/already approved/);
	assert.equal(state.alliance_petition_collective(founding),false);
	const application={type:'alliance_join',proposal:{kind:'apply',name:'Silver Dawn'}};
	assert.equal(state.alliance_proposal_heading(state.alliance_petition_kind(application)),'Join Alliance');
	assert.match(state.alliance_proposal_description(application.proposal),/Apply for our Guild/);
	assert.equal(state.alliance_petition_collective(application),false);
	assert.equal(state.alliance_petition_collective({type:'alliance_ballot',proposal:{kind:'join'}}),true);
	assert.match(state.alliance_proposal_description({kind:'market_enable',name:'$& <Council>'}),/\$& <Council>/);
	assert.equal(state.alliance_proposal_description({kind:'found',name:'Silver Dawn'},'withdraw'),
		'Withdraw our Guild’s proposal: Propose creating Silver Dawn with an unavailable Guild. They must also approve.');
});

test('Council Guild names reuse available summaries and deduplicate missing preview reads', async () => {
	const {state,calls}=setup();
	state.alliance_state={alliance:{member_guilds:[{guild_id:1,name:'Known'}]},processes:[]};
	const petitions=[{type:'alliance_found',proposal:{guild_ids:[1,2]}},{type:'alliance_remove',proposal:{guild_ids:[2]}}];
	await state.resolve_alliance_petition_guilds(petitions);
	assert.equal(calls.filter(call=>call[0]==='get').length,1);
	assert.deepEqual(petitions[0].proposal.guilds.map(guild=>guild.name),['Known','Other']);
	assert.equal(petitions[1].proposal.guilds[0].name,'Other');
});

test('Alliance previews use the Guild name as their accessible button text', () => {
	const source=readFileSync(new URL('../../mod/ui/templates.html',import.meta.url),'utf8');
	const buttons=[...source.matchAll(/<button\b((?:[^>"']|"[^"]*"|'[^']*')*)>(.*?)<\/button>/gs)].filter(([,attributes])=>attributes.includes('state.preview_alliance_guild'));
	assert.equal(buttons.length,7);
	for (const [,attributes,body] of buttons) {
		assert.match(attributes,/type="button"/);
		assert.ok(['{{ guild.name }}','{{ part.text }}'].includes(body));
	}
});


test('inline names stay text, exclude the founding Guild itself, and format synthetic withdrawal safely', async () => {
	const {state,runtime}=setup();
	const english=JSON.parse(readFileSync(new URL('../../mod/data/lang/en.json',import.meta.url),'utf8'));
	runtime.getLangString=key=>english[key];Object.assign(state,install_social_actions(runtime));
	state.guild_state={guild:{guild_id:1}};
	const proposal={kind:'found',name:'<strong>Alliance</strong>',guilds:[{guild_id:1,name:'Ours'},{guild_id:2,name:'The Criminals'}]};
	const parts=state.alliance_proposal_parts(proposal);
	assert.deepEqual(parts.filter(p=>p.bold),[{text:'<strong>Alliance</strong>',bold:true},{text:'The Criminals',bold:true,guild_id:2}]);
	state.alliance_state={alliance:{member_guilds:[{guild_id:2,name:'The Criminals'}]},processes:[]};
	const synthetic={synthetic:true,type:'alliance_withdraw',proposal:{kind:'withdraw',name:'Example',guild_ids:[]}};
	await state.resolve_alliance_petition_guilds([synthetic]);
	assert.equal(synthetic.proposal.guilds[0].name,'The Criminals');
	assert.match(state.alliance_proposal_description(synthetic.proposal,'withdraw'),/Withdraw our Guild’s proposal: Propose creating Example with The Criminals/);
});

function showcase_state() {
	const { state, calls } = setup();
	const main = readFileSync(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const getters = runInNewContext('({' + main.slice(main.indexOf('get guild_showcase()'), main.indexOf('get alliance_needs_vote()')) + '})');
	Object.defineProperties(state, Object.getOwnPropertyDescriptors(getters));
	Object.assign(state, { guild_state: { guild: { guild_id: 96, name: 'Ours', is_public: false } },
		guild_member_count: 4, guild_applicants: [], council_petitions: [{ synthetic: true }],
		alliance_state: { alliance: null, processes: [], affiliation_pending: false }, alliance_preview_affiliated: true });
	return { state, calls };
}

test('showcase groups incoming applications, totals members, and preserves real membership state', () => {
	const { state } = showcase_state();
	assert.equal(state.visible_guild_applicants.length, 2);
	assert.equal(state.alliance_member_count, 24);
	assert.equal(state.alliance_member_guilds[0].guild_id, 96);
	assert.equal(state.alliance_applications.length, 2);
	assert.equal(state.alliance_active_proposals.length, 2);
	assert.equal(state.alliance_proposal_history.length, 9);
	assert.equal(state.alliance_state.alliance, null);
	state.alliance_preview_affiliated = false;
	assert.equal(state.alliance_view.alliance, null);
	assert.equal(state.alliance_applications.length, 0);
	assert.equal(state.alliance_active_proposals[0].kind, 'found');
	state.council_petitions = [];
	assert.equal(state.alliance_view, state.alliance_state);
	assert.equal(state.visible_guild_applicants.length, 0);
	state.alliance_state.alliance = { member_guilds: [{guild_id: 2,member_count: 7}, {guild_id: 96,member_count: 4}] };
	assert.equal(state.alliance_member_guilds[0].guild_id, 96);
	assert.equal(state.alliance_member_count, 11);
});

test('open Guilds hide all applicants and synthetic actions never send writes', async () => {
	const { state, calls } = showcase_state();
	const fixture = state.visible_guild_applicants[0];
	await state.decide_guild_application({currentTarget:{}}, fixture, true);
	await state.alliance_action({currentTarget:{}}, 'leave');
	assert.equal(calls.length, 0);
	await state.preview_alliance_guild(-101);
	assert.equal(state.alliance_preview.name, 'The Criminals');
	assert.equal(calls.filter(call => call[0] === 'get').length, 0);
	state.alliance_preview_affiliated = false;
	await state.preview_alliance_guild(-101);
	assert.equal(state.alliance_preview.name, 'The Criminals');
	state.guild_state.guild.is_public = true;
	state.guild_applicants = [{application_id: 1}];
	assert.equal(state.visible_guild_applicants.length, 0);
	state.guild_state.guild.is_public = false;
	state.is_free_fellowship = true;
	assert.equal(state.visible_guild_applicants.length, 0);
});

test('Applicants precede Members and empty applicant cards are hidden', () => {
	const source = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	assert.ok(source.indexOf('mp-guild-applicants-block') < source.indexOf('lang-id="MOD_MP_GUILD_MEMBERS"', source.indexOf('mp-guild-applicants-block')));
	assert.match(source, /mp-guild-applicants-block" v-if="state.visible_guild_applicants.length > 0"/);
});


test('passing notches use half rounded up for Council and a strict Alliance majority', () => {
	const { state } = setup();
	for (const eligible of [1, 2, 3, 4, 5, 10]) {
		const row = {kind: 'join', tally: {eligible, aye: 1, nay: 0}};
		assert.equal(state.get_tally_threshold(row), Math.ceil(eligible / 2) / eligible * 100 + '%');
		assert.equal(state.get_tally_threshold(row, true), (Math.floor(eligible / 2) + 1) / eligible * 100 + '%');
		assert.equal(state.get_tally_threshold({...row, kind: 'found'}, true), (Math.floor(eligible / 2) + 1) / eligible * 100 + '%');
	}
	assert.equal(state.get_council_tally_width({tally: {eligible: 5, aye: 2, nay: 1}}, 'uncast'), '40%');
	assert.equal(state.get_tally_threshold({tally: {eligible: 5, required_aye: 4}}, true), '80%');
});

test('applicant inspection omits New Member, activity, and last seen while preserving tags and GP privacy', () => {
	const source = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const applicants = source.slice(source.indexOf('mp-guild-applicants-block'), source.indexOf('lang-id="MOD_MP_GUILD_MEMBERS"', source.indexOf('mp-guild-applicants-block')));
	assert.match(applicants, /state.show_member_actions\(application\)/);
	assert.match(applicants, /application.gp_visible && application.gp != null/);
	assert.match(applicants, /MOD_MP_RAID_MEMBER_DEFEATS/);
	assert.match(applicants, /MOD_MP_GUILD_USING_CHEATS/);
	assert.doesNotMatch(applicants, /MOD_MP_GUILD_NEW_MEMBER|last-seen|status_activities/);
	const alliance = source.slice(source.indexOf('id="mp-guild-alliance-column"'), source.indexOf("state.guild_page_view === 'applicant'"));
	assert.doesNotMatch(alliance, /new Date|proposal.expires_at/);
	assert.match(alliance, /class="mp-alliance-roster-name"/);
	assert.ok(alliance.indexOf('MOD_MP_ALLIANCE_POLICIES') < alliance.indexOf('MOD_MP_ALLIANCE_PROPOSAL_HISTORY'));
});


test('Guild preview uses its own title and icon and backdrop dismissal restores the picker once', async () => {
	const { state, calls } = setup();
	await state.show_alliance_picker('found');
	await state.preview_alliance_guild(2, true);
	const preview = calls.findLast(call => call[0] === 'modal');
	assert.equal(preview[1], 'Other');
	assert.equal(preview[3], 'guild-icon:undefined');
	assert.equal(preview[4].allowOutsideClick, undefined);
	assert.equal(preview[5], false);
	assert.equal(preview[6], false);
	preview[4].didClose();
	await Promise.resolve();
	assert.equal(calls.filter(call => call[0] === 'modal' && call[2] === 'alliance-picker-modal').length, 2);
	preview[4].didClose();
	await Promise.resolve();
	assert.equal(calls.filter(call => call[0] === 'modal' && call[2] === 'alliance-picker-modal').length, 2);
});


test('Alliance confirmation cancels without writes and tears down before confirmed submission', async () => {
	const { state, calls } = setup();
	await state.show_alliance_confirmation('leave');
	assert.equal(calls.filter(call => call[0] === 'post').length, 0);
	await state.close_alliance_confirmation();
	await state.confirm_alliance_proposal({currentTarget: {}});
	assert.equal(calls.filter(call => call[0] === 'post').length, 0);
	calls.length = 0;
	await state.show_alliance_confirmation('remove', 2);
	await state.confirm_alliance_proposal({currentTarget: {}});
	assert.deepEqual(calls.find(call => call[0] === 'post'), ['post', '/api/alliances/propose', {kind: 'remove', target_id: 2}]);
	assert.ok(calls.findIndex(call => call[0] === 'close') < calls.findIndex(call => call[0] === 'post'));
});

test('synthetic proposal confirmations and pickers are usable without reads or writes', async () => {
	const { state, calls } = showcase_state();
	state.alliance_preview_affiliated = false;
	assert.equal(state.alliance_active_proposals[0].tally.eligible, 0);
	assert.equal(state.alliance_active_proposals[0].own_ballot, null);
	for (const kind of ['join', 'found']) {
		await state.show_alliance_confirmation(kind, null, null, true);
		await state.confirm_alliance_proposal({currentTarget: {}});
		assert.equal(state.alliance_modal, 'alliance-picker-modal');
		assert.ok(state.alliance_picker_entries.length > 0);
		await state.alliance_action({currentTarget: {}}, kind, -1);
		state.close_alliance_picker();
	}
	await state.show_alliance_confirmation('market_enable');
	await state.confirm_alliance_proposal({currentTarget: {}});
	assert.equal(calls.filter(call => ['post', 'get'].includes(call[0])).length, 0);
});

test('backdrop cancellation clears confirmation and does not submit', async () => {
	const { state, calls } = setup();
	await state.show_alliance_confirmation('leave');
	calls.find(call => call[0] === 'modal')[4].didClose();
	await state.confirm_alliance_proposal({currentTarget: {}});
	assert.equal(state.alliance_confirmation, null);
	assert.equal(calls.filter(call => call[0] === 'post').length, 0);
});


test('confirmation captures the button before the browser clears currentTarget', async () => {
	const { state, calls, runtime } = setup();
	const button = {};
	const event = {currentTarget: button};
	runtime.close_modal_and_wait = async () => { event.currentTarget = null; };
	runtime.is_button_spinning = target => { assert.equal(target, button); return false; };
	Object.assign(state, install_social_actions(runtime));
	await state.show_alliance_confirmation('leave');
	await state.confirm_alliance_proposal(event);
	assert.equal(calls.filter(call => call[0] === 'post').length, 1);
});

test('synthetic applicant decisions dismiss only local fixtures', async () => {
	const {state, calls} = showcase_state();
	const application = state.visible_guild_applicants[0];
	await state.decide_guild_application({currentTarget: {}}, application, true);
	assert.equal(state.visible_guild_applicants.length, 1);
	assert.equal(state.visible_guild_applicants[0].application_id, -2);
	assert.equal(calls.length, 0);
});

test('Alliance summaries show active members and Shadowed-excluding Guild counts', () => {
	const {state, runtime} = setup();
	const english = JSON.parse(readFileSync(new URL('../../mod/data/lang/en.json', import.meta.url), 'utf8'));
	runtime.getLangString = key => english[key];
	Object.assign(state, install_social_actions(runtime));
	const alliance = {member_guilds: [{member_count: 12, active_member_count: 10}, {member_count: 10, active_member_count: 8}, {member_count: 0, active_member_count: 0}]};
	assert.equal(state.alliance_members_text(alliance), '22 Members (18 Active)');
	assert.equal(state.alliance_guild_count_text(alliance), '3 Member Guilds (2 Active)');
	assert.equal(state.alliance_members_text({member_guilds: [{member_count: 2, active_member_count: 0}]}), '2 Members (0 Active)');
});


test('confirmation state changes only after modal teardown and repeated clicks cannot submit twice', async () => {
	const {state, calls, runtime} = setup();
	let release;
	runtime.close_modal_and_wait = async () => {
		assert.equal(state.alliance_confirmation.kind, 'leave');
		await new Promise(resolve => { release = resolve; });
	};
	Object.assign(state, install_social_actions(runtime));
	await state.show_alliance_confirmation('leave');
	const confirmation = state.alliance_confirmation;
	const first = state.confirm_alliance_proposal({currentTarget: {}});
	await state.confirm_alliance_proposal({currentTarget: {}});
	assert.equal(state.alliance_confirmation, confirmation);
	assert.equal(calls.filter(call => call[0] === 'post').length, 0);
	release();
	await first;
	assert.equal(state.alliance_confirmation, null);
	assert.equal(calls.filter(call => call[0] === 'post').length, 1);
});

test('all-active Alliance counts omit redundant parentheses', () => {
	const {state, runtime} = setup();
	const english = JSON.parse(readFileSync(new URL('../../mod/data/lang/en.json', import.meta.url), 'utf8'));
	runtime.getLangString = key => english[key];
	Object.assign(state, install_social_actions(runtime));
	const alliance = {member_guilds: [{member_count: 12, active_member_count: 12}, {member_count: 10, active_member_count: 10}]};
	assert.equal(state.alliance_members_text(alliance), '22 Members');
	assert.equal(state.alliance_guild_count_text(alliance), '2 Member Guilds');
	assert.equal(state.alliance_guild_count_text({member_guilds: [{member_count: 2, active_member_count: 0}]}), '1 Member Guild (0 Active)');
});


test('Alliance age tolerates queued updates after affiliation disappears', () => {
	const {state} = setup();
	state.alliance_view = {alliance: null};
	assert.equal(state.alliance_established_days(), 0);
});

test('parallel founding descriptions do not claim the other Council has already approved',()=> {
	const {state,runtime}=setup();
	const english=JSON.parse(readFileSync(new URL('../../mod/data/lang/en.json',import.meta.url),'utf8'));
	runtime.getLangString=key=>english[key]??key;Object.assign(state,install_social_actions(runtime));
	const proposal={kind:'found',governance_version:2,name:'GAB',founding_guilds:[{guild_id:2,name:'GB'}]};
	assert.equal(state.alliance_proposal_description(proposal,'consider'),'Create GAB with GB. Both Guild Councils must approve.');
	assert.match(state.alliance_proposal_description({...proposal,governance_version:1},'consider'),/already approved/);
});

test('proposal confirmations distinguish mutual consent, admission, majority, departure and withdrawal',()=> {
	const {state,runtime}=setup();
	const english=JSON.parse(readFileSync(new URL('../../mod/data/lang/en.json',import.meta.url),'utf8'));
	runtime.getLangString=key=>english[key]??key;Object.assign(state,install_social_actions(runtime));
	state.alliance_confirmation={kind:'found'};
	assert.match(state.alliance_confirmation_hint(),/Both Guild Councils must approve/);
	state.alliance_confirmation={kind:'join'};
	assert.match(state.alliance_confirmation_hint(),/Your Guild does not count toward that majority/);
	state.alliance_confirmation={kind:'market_enable'};
	assert.match(state.alliance_confirmation_hint(),/does not supply an automatic Aye/);
	state.alliance_confirmation={kind:'leave'};
	assert.match(state.alliance_confirmation_hint(),/Other Member Guilds do not need to approve/);
	state.alliance_confirmation={kind:'withdraw'};
	assert.match(state.alliance_confirmation_hint(),/original proposal can still be decided/);
});

test('parallel statuses explain unfinished consent and cancellation names remain literal text',()=> {
	const {state,runtime}=setup();
	const english=JSON.parse(readFileSync(new URL('../../mod/data/lang/en.json',import.meta.url),'utf8'));
	runtime.getLangString=key=>english[key]??key;Object.assign(state,install_social_actions(runtime));
	assert.match(state.alliance_proposal_status({kind:'found',governance_version:2,stage:'recipient',own_council:'granted'}),/Awaiting the other Guild/);
	assert.match(state.alliance_proposal_status({kind:'join',governance_version:2,stage:'collective',tally:{aye:2,required_aye:2},applicant_consent:'active'}),/Awaiting the applicant/);
	assert.equal(state.alliance_proposal_status({kind:'join',governance_version:2,stage:'collective',tally:{aye:2,required_aye:2},applicant_consent:'granted'}),'Alliance voting');
	const name='<img src=x onerror=alert(1)>';
	const parts=state.alliance_cancellation_parts({stage:'cancelled',resolution_reason:'affiliated_elsewhere',resolution_guild_name:name});
	assert.deepEqual(parts.find(part=>part.bold),{text:name,bold:true});
	assert.deepEqual(state.alliance_cancellation_parts({stage:'cancelled',resolution_reason:null}),[]);
	state.alliance_view={processes:[{kind:'market_enable',stage:'collective'}]};
	assert.equal(state.alliance_market_pending(),true);
	state.alliance_view.processes[0].stage='denied';
	assert.equal(state.alliance_market_pending(),false);
});


test('Chef showcase covers blocked founding, pending applicant consent and every cancellation explanation', () => {
	const {state,calls}=showcase_state();
	const applications=state.alliance_applications;
	const waiting=applications.find(p=>p.applicant_consent==='active');
	assert.ok(waiting.tally.aye>=waiting.tally.required_aye);
	assert.equal(state.alliance_proposal_status(waiting),'MOD_MP_ALLIANCE_AWAITING_APPLICANT_CONSENT');
	const accepted=state.alliance_proposal_history.find(p=>p.stage==='accepted' && p.own_ballot==='nay');
	assert.equal(accepted.kind,'market_disable');
	assert.ok(accepted.tally.aye>=accepted.tally.required_aye);
	const cancellations=state.alliance_proposal_history.filter(p=>p.stage==='cancelled');
	assert.deepEqual(new Set(cancellations.map(p=>p.resolution_reason)),new Set(['roster_changed','affiliated_elsewhere','guild_unavailable','alliance_unavailable','target_unavailable']));
	assert.equal(cancellations.filter(p=>p.resolution_reason==='affiliated_elsewhere').length,2);
	for(const proposal of cancellations) assert.ok(state.alliance_cancellation_parts(proposal).length);
	state.alliance_preview_affiliated=false;
	const pending=state.alliance_active_proposals.find(p=>p.own_council==='granted');
	assert.equal(state.alliance_proposal_status(pending),'MOD_MP_ALLIANCE_FOUNDING_OTHER_COUNCIL');
	const blocked=state.alliance_active_proposals.find(p=>p.consider_blocked_reason==='affiliation_pending');
	assert.equal(blocked.can_consider,true);
	assert.equal(state.alliance_proposal_history.length,9);
	assert.ok(state.alliance_view.processes.every(p=>p.synthetic && p.process_id<0));
	assert.equal(new Set(state.alliance_view.processes.map(p=>p.process_id)).size,state.alliance_view.processes.length);
	assert.equal(state.alliance_state.processes.length,0);
	assert.equal(calls.filter(call=>call[0]==='post').length,0);
});

test('founding picker removes own Guild while joining retains matching Alliance IDs',async()=> {
	const {state,runtime}=setup();
	state.guild_state={guild:{guild_id:2}};
	runtime.api_get=async()=>({entries:[{guild_id:2},{guild_id:3}],has_more:false});
	Object.assign(state,install_social_actions(runtime));
	await state.show_alliance_picker('found');
	assert.deepEqual(state.alliance_picker_entries.map(g=>g.guild_id),[3]);
	runtime.api_get=async()=>({entries:[{id:2,member_guilds:[]}],has_more:false});
	Object.assign(state,install_social_actions(runtime));
	await state.show_alliance_picker('join');
	assert.equal(state.alliance_picker_entries.length,1);
});


test('Alliance modal content scrolls natively while footer actions stay outside the scroll boundary', () => {
	const templates = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const style = readFileSync(new URL('../../mod/ui/style.css', import.meta.url), 'utf8');
	for (const modal of ['preview', 'confirm']) {
		const template = templates.split(`<template id="template-mp-alliance-${modal}-modal">`)[1].split('</template>')[0];
		assert.match(template, /<div class="mp-alliance-modal-scroll" @touchmove="state\.stop_icon_scroll_propagation\(\$event\)">/);
		assert.match(template, /<\/div>\s*<div class="mp-button-tray/);
	}
	assert.match(style, /\.mp-alliance-picker-scroll,\s*\.mp-alliance-modal-scroll \{[^}]*max-height: 320px;[^}]*max-height: min\(40dvh, 320px\);[^}]*overflow-y: scroll;[^}]*-webkit-overflow-scrolling: touch;[^}]*touch-action: pan-y;[^}]*overscroll-behavior-y: contain;/);
	const { state } = setup();
	let stopped = false;
	state.stop_icon_scroll_propagation({ stopPropagation() { stopped = true; }, preventDefault() { assert.fail('Native touch scrolling must remain enabled'); } });
	assert.equal(stopped, true);
});


test('every Alliance modal opts out of the outer SweetAlert scroll container', async () => {
	const { state, calls } = setup();
	await state.show_alliance_confirmation('found', null, null, true);
	await state.close_alliance_confirmation();
	await state.show_alliance_picker('found');
	await state.preview_alliance_guild(2, true);
	for (const id of ['alliance-confirm-modal', 'alliance-picker-modal', 'alliance-preview-modal']) {
		const call = calls.find(call => call[0] === 'modal' && call[2] === id);
		assert.equal(call[4].customClass.popup, 'mp-alliance-modal-popup');
	}
	const style = readFileSync(new URL('../../mod/ui/style.css', import.meta.url), 'utf8');
	assert.match(style, /\.mp-alliance-modal-popup \.swal2-html-container,[^{]*\{\s*overflow: visible;/);
});
