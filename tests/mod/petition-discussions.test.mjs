import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { install_chat_actions } from '../../mod/client-actions-chat.mjs';

function harness(language = 'en') {
	const pages = [], opens = [];
	const state = { chat_client_id: 7, chat_translation_preferences: {}, chat_notification_preferences: {} };
	const runtime = { state, changePage: page => pages.push(page), game: { pages: { getObjectByID: id => id } },
		chat_view_generation: 0, stop_chat_polling: () => {},
		getLangString: key => language + ':' + key, get_chat_conversation_key: c => c?.conversation_kind + ':' + c?.conversation_id,
		localization: { resolve_multiplayer_language: lang => lang } };
	Object.assign(state, install_chat_actions(runtime));
	state.open_chat_conversation = async conversation => opens.push(conversation);
	return { state, pages, opens };
}

test('petition discussion opens from Guild and returns there without contributing notifications', async () => {
	const h = harness();
	h.state.selected_chat_conversation = { conversation_kind: 'global', conversation_id: 1 };
	h.state.chat_messages = [{ message_id: 1, content: 'Previous chat' }];
	h.state.chat_messages_loading = true;
	h.state.chat_before_cursor = 1;
	h.state.chat_reaction_revision = 5;
	const petition = { petition_id: 42, type: 'appellation', proposal: { name: 'New name' } };
	await h.state.open_petition_discussion(petition);
	assert.deepEqual(h.pages, ['multiplayer:Chat']);
	assert.equal(h.state.selected_chat_conversation.petition, petition);
	assert.equal(h.state.selected_chat_conversation.conversation_kind, 'petition-discussion');
	assert.equal(h.state.selected_chat_conversation.contributes_unread, false);
	assert.deepEqual(h.state.chat_messages, []);
	assert.equal(h.state.chat_messages_loading, false);
	assert.equal(h.state.chat_before_cursor, null);
	assert.equal(h.state.chat_reaction_revision, null);
	assert.equal(h.opens.length, 0);
	assert.equal(h.state.get_chat_notification_unread([{ ...h.state.selected_chat_conversation, unread_count: 8 }]), 0);
	let closed = false;
	h.state.close_chat_conversation = () => { closed = true; };
	h.state.back_from_chat_conversation();
	assert.equal(closed, true);
	assert.deepEqual(h.pages, ['multiplayer:Chat', 'multiplayer:Guild']);
	await h.state.open_petition_discussion({ petition_id: -42 });
	assert.equal(h.opens.length, 0);
});

test('an inbox refresh cannot restore the previous conversation after opening a petition', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const source = main.slice(main.indexOf('async function refresh_chat_conversations('), main.indexOf('\nfunction update_chat_nav('));
	for (const kind of ['global', 'guild', 'private', 'poll-discussion']) {
		for (const delayed_endpoint of ['conversations', 'polls']) {
			const h = harness();
			h.state.selected_chat_conversation = { conversation_kind: kind, conversation_id: 1 };
			h.state.polls = [];
			let release, started;
			const pending = new Promise(resolve => { release = resolve; });
			const requested = new Promise(resolve => { started = resolve; });
			const api_get = async endpoint => {
				if (endpoint.startsWith('/api/' + (delayed_endpoint === 'polls' ? 'polls' : 'chat/conversations'))) {
					started();
					await pending;
				}
				return endpoint.startsWith('/api/polls') ? { polls: [] } : {
					conversations: [{ conversation_kind: kind, conversation_id: 1, unread_count: 0 }]
				};
			};
			const refresh = new Function('state', 'api_get', 'CHAT_CAPABILITIES', 'POLLS_CAPABILITY',
				'getLangString', 'update_chat_nav', `${source}; return refresh_chat_conversations;`)
				(h.state, api_get, 'global-chat-v1', 'polls-v1', key => key, () => {});
			const refreshing = refresh();
			await requested;
			await h.state.open_petition_discussion({ petition_id: 42 });
			const discussion = h.state.selected_chat_conversation;
			release();
			await refreshing;
			assert.equal(h.state.selected_chat_conversation, discussion, `${kind}: ${delayed_endpoint}`);
		}
	}
});

test('a previous chat Message response cannot populate a petition with the same numeric ID', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const source = main.slice(main.indexOf('async function refresh_chat_messages('), main.indexOf('\nasync function refresh_chat_page('));
	const state = { selected_chat_conversation: { conversation_kind: 'global', conversation_id: 1 },
		chat_messages: [], chat_messages_loading: false };
	let release;
	const pending = new Promise(resolve => { release = resolve; });
	const refresh = new Function('state', 'api_get', 'chat_view_generation', 'log', 'GLOBAL_CHAT_CAPABILITY',
		'POLLS_CAPABILITY', 'refresh_chat_conversations', 'update_guild_nav', `${source}; return refresh_chat_messages;`)
		(state, () => pending, 1, () => {}, 'global-chat-v1', 'polls-v1', async () => {}, () => {});
	const refreshing = refresh();
	state.selected_chat_conversation = { conversation_kind: 'petition-discussion', conversation_id: 1 };
	release({ messages: [{ message_id: 10, content: 'Global message' }] });
	assert.equal(await refreshing, false);
	assert.deepEqual(state.chat_messages, []);
});

test('automatic proposal and vote Messages localize for the viewer including their own Messages', () => {
	const { state } = harness('zh-CN');
	for (const sender_id of [7, 8]) {
		const proposal = { sender_id, content: 'I propose this petition.', petition_event: 'proposal' };
		assert.equal(state.get_chat_message_content(proposal), 'zh-CN:MOD_MP_COUNCIL_DISCUSSION_PROPOSE');
		assert.deepEqual(state.get_chat_message_parts(proposal), [{ type: 'text', text: 'zh-CN:MOD_MP_COUNCIL_DISCUSSION_PROPOSE' }]);
		assert.equal(state.get_chat_message_content({ sender_id, content: 'aye', petition_event: 'aye' }), 'zh-CN:MOD_MP_COUNCIL_AYE');
		assert.equal(state.is_chat_message_translation_pending(proposal), false);
	}
});

test('every packaged locale has petition discussion strings and both petition lists expose buttons', async () => {
	const directory = new URL('../../mod/data/lang/', import.meta.url);
	for (const file of await readdir(directory)) {
		if (!file.endsWith('.json')) continue;
		const strings = JSON.parse(await readFile(new URL(file, directory), 'utf8'));
		assert.ok(strings.MOD_MP_COUNCIL_DISCUSSION, file);
		assert.ok(strings.MOD_MP_COUNCIL_DISCUSSION_PROPOSE, file);
	}
	const html = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	assert.equal((html.match(/state.open_petition_discussion\(petition\)/g) ?? []).length, 2);
	assert.match(html, /message\.petition_event === 'aye'[\s\S]*badge-success' : 'badge-danger'/);
	assert.match(html, /conversation_kind !== 'petition-discussion'/);
});


test('an open discussion reloads older hidden ballots when voting reveals them', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const source = main.slice(main.indexOf('async function refresh_chat_messages('), main.indexOf('\nasync function refresh_chat_page('));
	const conversation = { conversation_kind: 'petition-discussion', conversation_id: 42,
		petition_votes_visible: false, message_moderation_count: 0 };
	const state = { selected_chat_conversation: conversation, chat_messages: [{ message_id: 10 }],
		chat_before_cursor: 10, chat_reaction_revision: 0, chat_messages_loading: false,
		council_petitions: [{ petition_id: 42, discussion_unread_count: 2 }],
		chat_messages_are_at_bottom: () => false, scroll_chat_messages_to_bottom: async () => {} };
	const requests = [];
	const api_get = async endpoint => {
		requests.push(endpoint);
		return { messages: requests.length === 1 ? [] : [{ message_id: 9, petition_event: 'nay' }, { message_id: 10 }],
			petition_votes_visible: true, moderation_count: 0, reaction_revision: 0, has_more: false };
	};
	const refresh = new Function('state', 'api_get', 'chat_view_generation', 'log', 'GLOBAL_CHAT_CAPABILITY',
		'POLLS_CAPABILITY', 'refresh_chat_conversations', 'update_guild_nav', `${source}; return refresh_chat_messages;`)
		(state, api_get, 1, () => {}, 'global-chat-v1', 'polls-v1', async () => {}, () => {});
	assert.equal(await refresh('&after=10', false, true), true);
	assert.equal(requests.length, 2);
	assert.match(requests[0], /&after=10/);
	assert.doesNotMatch(requests[1], /&after=/);
	assert.deepEqual(state.chat_messages.map(m => m.message_id), [9, 10]);
	assert.equal(conversation.petition_votes_visible, true);
	assert.equal(state.council_petitions[0].discussion_unread_count, 0);
});


test('petition header iteration tolerates queued updates after closing or switching discussions', async () => {
	const html = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const expression = html.match(/v-for="petition in ([^"]+)"/)?.[1];
	assert.ok(expression);
	const evaluate = new Function('state', `return ${expression};`);
	const petition = { petition_id: 42, type: 'appellation', proposal: { name: 'New' } };
	const state = { selected_chat_conversation: { conversation_kind: 'petition-discussion', petition } };
	assert.deepEqual(evaluate(state), [petition]);
	state.selected_chat_conversation = null;
	assert.deepEqual(evaluate(state), []);
	state.selected_chat_conversation = { conversation_kind: 'private', conversation_id: 42 };
	assert.deepEqual(evaluate(state), []);
	state.selected_chat_conversation = { conversation_kind: 'petition-discussion', petition };
	assert.deepEqual(evaluate(state), [petition]);
});

test('shared badges deduplicate aliases, prioritize tags and open the same proposal discussion from either entry point', async () => {
 const {state}=harness();
 state.council_petitions=[{petition_id:42,discussion_id:42,type:'alliance_join',discussion_unread_count:2}];
 state.alliance_state={processes:[{process_id:8,kind:'join',discussion_id:42,discussion_unread_count:2}]};
 assert.equal(state.get_petition_nav_badge().count,2);
 state.events={petition_discussions:[{discussion_id:42,council:true,alliance:true,discussion_unread_count:3,discussion_has_unread_tag:true},
 {discussion_id:50,council:false,alliance:true,discussion_unread_count:2},
 {discussion_id:60,council:true,alliance:false,discussion_unread_count:1}]};
 assert.deepEqual(state.get_petition_nav_badge(),{count:6,tagged:true,text:'@'});
 assert.equal(state.get_petition_nav_badge('council').count,4);
 assert.equal(state.get_petition_nav_badge('alliance').count,5);
 assert.equal(state.get_petition_badge(state.council_petitions[0]).text,'@');
 await state.open_petition_discussion({...state.council_petitions[0],petition_id:99});
 assert.equal(state.selected_chat_conversation.conversation_id,42);
 assert.equal(state.selected_chat_conversation.petition.alliance_proposal.process_id,8);
 await state.open_alliance_discussion(state.alliance_state.processes[0]);
 assert.equal(state.selected_chat_conversation.conversation_id,42);
 state.events.petition_discussions[0].discussion_unread_count=0;
 assert.deepEqual(state.get_petition_nav_badge(),{count:3,tagged:false,text:'3'});
});

test('Guild sidebar unread and mention badges override vote reminders and restore them after reading',async()=> {
 const main=await readFile(new URL('../../mod/main.mjs',import.meta.url),'utf8');
 const source=main.slice(main.indexOf('function update_guild_nav()'),main.indexOf('\nfunction update_multiplayer_nav()'));
 const classes=new Set();
 const aside={hidden:true,textContent:'',classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}};
 const {state}=harness();
 Object.assign(state,{guild_state_loaded:true,is_guild_member:true,is_free_fellowship:false,guild_state:{guild:{}},visible_guild_applicants:[],council_needs_vote:true,
 events:{petition_discussions:[{discussion_id:42,council:true,alliance:true,discussion_unread_count:1}]}});
 const update=new Function('document','state','set_nav_ready','getLangString',source+'; return update_guild_nav;')({querySelector:()=>aside},state,()=>{},key=>key);
 update();assert.equal(aside.textContent,'1');assert.equal(aside.hidden,false);assert.equal(classes.has('mp-petition-unread'),true);
 state.events.petition_discussions[0].discussion_has_unread_tag=true;
 update();assert.equal(aside.textContent,'@');assert.equal(classes.has('mp-chat-tagged-nav'),true);
 state.events.petition_discussions[0].discussion_unread_count=0;
 update();assert.equal(aside.textContent,'MOD_MP_VOTE_BADGE');assert.equal(classes.has('mp-chat-tagged-nav'),false);
 state.council_needs_vote=false;update();assert.equal(aside.hidden,true);
});
