import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { install_chat_actions } from '../../mod/client-actions-chat.mjs';

function harness(response) {
	const modals = [];
	const requests = [];
	const state = {
		chat_is_admin: true, chat_client_id: 7,
		selected_chat_conversation: { conversation_kind: 'private', conversation_id: 12 },
		selected_chat_message: { message_id: 14, sender_id: 7, content: 'Own Message' },
		get_chat_participant_icon: () => 'avatar',
		close_modal_and_wait: async () => {},
		get_chat_message_content: message => message.content
	};
	const runtime = {
		state, chat_view_generation: 1,
		api_get: async endpoint => { requests.push(endpoint); return typeof response === 'function' ? response() : response; },
		queue_modal: (...args) => modals.push(args),
		getLangString: key => key
	};
	Object.assign(state, install_chat_actions(runtime));
	state.get_chat_message_content = message => message.content;
	return { state, runtime, requests, modals };
}

test('groups reaction characters vertically and clears details on close, including own Messages', async () => {
	const { state, modals, requests } = harness({ reactions: [
		{ reaction: '👍', client_id: 1 }, { reaction: '❤️', client_id: 2 }, { reaction: '👍', client_id: 3 }
	] });
	await state.show_admin_details('reactions');
	assert.equal(requests[0], '/api/chat/messages/details?conversation_kind=private&conversation_id=12&message_id=14');
	assert.deepEqual(state.admin_detail_groups, [
		{ label: '👍', characters: [{ reaction: '👍', client_id: 1 }, { reaction: '👍', client_id: 3 }] },
		{ label: '❤️', characters: [{ reaction: '❤️', client_id: 2 }] }
	]);
	assert.equal(modals[0][1], 'admin-details-modal');
	modals[0][3].didClose();
	assert.deepEqual(state.admin_detail_groups, []);
});

test('blocks non-admin detail reads and drops responses from a changed chat view', async () => {
	const h = harness(() => { h.runtime.chat_view_generation++; return { seen: [] }; });
	h.state.chat_is_admin = false;
	await h.state.show_admin_details('seen');
	assert.equal(h.requests.length, 0);
	h.state.chat_is_admin = true;
	await h.state.show_admin_details('seen');
	assert.equal(h.modals.length, 0);
});

test('Poll detail groups retain every option and timestamp actions hand off after teardown', async () => {
	const h = harness({ options: [{ option_id: 1, content: 'One', characters: [{ client_id: 5 }] }, { option_id: 2, content: 'Two', characters: [] }] });
	h.state.selected_poll = { poll_id: 20, can_edit: true, can_delete: true, open: true, options: [{ option_id: 1, content: 'One' }, { option_id: 2, content: 'Two' }] };
	await h.state.show_admin_details('responses');
	assert.deepEqual(h.state.admin_detail_groups, [{ label: 'One', characters: [{ client_id: 5 }] }, { label: 'Two', characters: [] }]);
	const events = [];
	h.state.close_modal_and_wait = async template => events.push(template);
	h.state.show_poll_creator = poll => events.push(poll.poll_id);
	await h.state.edit_selected_poll();
	assert.deepEqual(events, ['poll-actions-modal', 20]);
});

test('detail modals delegate scrolling to the modal and expose localized admin actions', async () => {
	const templates = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const details = templates.slice(templates.indexOf('<template id="template-mp-admin-details-modal">'), templates.indexOf('<template id="template-mp-chat-translation-modal">'));
	assert.doesNotMatch(details, /overflow|max-height|touchmove|modal-scroll/);
	assert.match(details, /v-for="group in state.admin_detail_groups"/);
	assert.match(details, /v-text="character.display_name"/);
	assert.match(templates, /state\.show_poll_actions\(poll\)/);
	assert.match(templates, /state\.selected_guild_member\.last_active_at/);
	for (const locale of ['en', 'zh-CN', 'zh-TW', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'pt', 'pt-br', 'ru', 'tr']) {
		const language = JSON.parse(await readFile(new URL(`../../mod/data/lang/${locale}.json`, import.meta.url), 'utf8'));
		for (const key of ['MOD_MP_CHAT_SHOW_REACTIONS', 'MOD_MP_CHAT_SHOW_SEEN', 'MOD_MP_POLLS_SHOW_RESPONSES', 'MOD_MP_LAST_ACTIVE', 'MOD_MP_ADMIN_DETAILS_EMPTY', 'MOD_MP_CHAT_SEEN_INFO']) assert.ok(language[key]);
	}
});

test('incremental polling removes a moderated Message already visible to another character', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const source = main.slice(main.indexOf('async function refresh_chat_messages('), main.indexOf('\nasync function refresh_chat_page('));
	const state = {
		selected_chat_conversation: { conversation_kind: 'private', conversation_id: 12, message_moderation_count: 0 },
		chat_messages: [{ message_id: 14 }], chat_before_cursor: 14, chat_reaction_revision: 0,
		chat_messages_loading: false
	};
	const requests = [];
	const api_get = async endpoint => {
		requests.push(endpoint);
		return { messages: [], moderation_count: 1, reaction_revision: 0, has_more: false };
	};
	const refresh = new Function('state', 'api_get', 'chat_view_generation', 'log', 'GLOBAL_CHAT_CAPABILITY', 'POLLS_CAPABILITY',
		`${source}; return refresh_chat_messages;`)(state, api_get, 1, () => {}, 'global-chat-v1', 'polls-v1');
	assert.equal(await refresh('&after=14', false, true), true);
	assert.equal(requests.length, 2);
	assert.match(requests[0], /&after=14/);
	assert.doesNotMatch(requests[1], /&after=/);
	assert.deepEqual(state.chat_messages, []);
	assert.equal(state.selected_chat_conversation.message_moderation_count, 1);
});
