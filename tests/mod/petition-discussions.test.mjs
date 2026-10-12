import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { install_chat_actions } from '../../mod/client-actions-chat.mjs';

function harness(language = 'en') {
	const pages = [], opens = [];
	const state = { chat_client_id: 7, chat_translation_preferences: {}, chat_notification_preferences: {} };
	const runtime = { state, changePage: page => pages.push(page), game: { pages: { getObjectByID: id => id } },
		getLangString: key => language + ':' + key, get_chat_conversation_key: c => c?.conversation_kind + ':' + c?.conversation_id,
		localization: { resolve_multiplayer_language: lang => lang } };
	Object.assign(state, install_chat_actions(runtime));
	state.open_chat_conversation = async conversation => opens.push(conversation);
	return { state, pages, opens };
}

test('petition discussion opens from Guild and returns there without contributing notifications', async () => {
	const h = harness();
	const petition = { petition_id: 42, type: 'appellation', proposal: { name: 'New name' } };
	await h.state.open_petition_discussion(petition);
	assert.deepEqual(h.pages, ['multiplayer:Chat']);
	assert.equal(h.state.selected_chat_conversation.petition, petition);
	assert.equal(h.state.selected_chat_conversation.conversation_kind, 'petition-discussion');
	assert.equal(h.state.selected_chat_conversation.contributes_unread, false);
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
		'POLLS_CAPABILITY', 'refresh_chat_conversations', `${source}; return refresh_chat_messages;`)
		(state, api_get, 1, () => {}, 'global-chat-v1', 'polls-v1', async () => {});
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
