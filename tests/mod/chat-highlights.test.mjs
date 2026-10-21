import test from 'node:test';
import assert from 'node:assert/strict';
import * as highlights from '../../mod/chat-highlights.mjs';
import * as items from '../../mod/chat-items.mjs';
import { install_chat_actions } from '../../mod/client-actions-chat.mjs';

function fixture(reply = async payload => ({ success: true, message: { message_id: 1, conversation_id: 1, ...payload } })) {
	const conversation = { conversation_kind: 'global', conversation_id: 1, participant: { client_id: null } };
	const state = { selected_chat_conversation: conversation, chat_client_id: 2, chat_can_highlight: true,
		chat_highlight_drafts: { 'global:1': '#4D96FF' }, chat_draft: 'hello', chat_drafts: { 'global:1': 'hello' },
		chat_item_drafts: {}, chat_pending_sends: {}, chat_sending_conversations: {}, chat_messages: [],
		is_chat_item_draft_valid: () => true, get_chat_draft_parts: () => [{ type: 'text', text: 'hello' }] };
	const payloads = [], modals = [];
	const runtime = { state, chat_items: items, chat_highlights: highlights, chat_view_generation: 1,
		get_chat_conversation_key: c => c ? `${c.conversation_kind}:${c.conversation_id}` : null,
		crypto: { randomUUID: () => `key-${payloads.length}` }, queue_modal: (...args) => modals.push(args),
		api_post: async (url, payload) => { payloads.push(payload); return reply(payload); },
		refresh_chat_conversations: async () => {}, start_chat_polling() {}, log() {}, getLangString: s => s };
	const actions = install_chat_actions(runtime);
	Object.assign(state, actions, { get_chat_draft_parts: () => [{ type: 'text', text: 'hello' }], is_chat_item_draft_valid: () => true,
		scroll_chat_messages_to_bottom: async () => {}, close_modal() {} });
	return { state, runtime, payloads, modals };
}
test('accepts six-digit RGB, normalizes pasted hash and rejects alpha, shorthand and CSS', () => {
	for (const value of ['aAbBcC', '#aabbcc', ' #AABBCC ']) assert.equal(highlights.highlight_color(value), '#AABBCC');
	for (const value of ['#abc', '#aabbccdd', 'rgb(1,2,3)', 'red', '#12345g', '##123456', '123456; color:red', '', null])
		assert.equal(highlights.highlight_color(value), null);
	assert.equal(highlights.CHAT_HIGHLIGHT_PRESETS.length, 8);
	assert.equal(new Set(highlights.CHAT_HIGHLIGHT_PRESETS).size, 8);
});
test('pink mentions take priority; sender and other viewers retain chosen message color', () => {
	const { state } = fixture();
	const m = { highlight_color: '#123456', sender_id: 1, parts: [{ type: 'person', client_id: 2 }] };
	assert.deepEqual(state.get_chat_highlight_style(m), {});
	state.chat_client_id = 1;
	assert.deepEqual(state.get_chat_highlight_style(m), { '--mp-chat-highlight': '#123456' });
	state.chat_client_id = 3;
	assert.deepEqual(state.get_chat_highlight_style(m), { '--mp-chat-highlight': '#123456' });
	assert.deepEqual(state.get_chat_highlight_style({ highlight_color: 'red' }), {});
});
test('draft previews and modal edits are conversation-scoped and permission gated', () => {
	const { state, modals } = fixture();
	assert.deepEqual(state.get_chat_draft_highlight_style(), { '--mp-chat-highlight': '#4D96FF' });
	state.open_chat_highlight_picker(); assert.equal(modals.length, 1);
	const event = { target: { value: ' #abC123 ' } }; state.update_chat_highlight_input(event);
	assert.equal(event.target.value, 'ABC123');
	state.selected_chat_conversation = { conversation_kind: 'guild', conversation_id: 5 };
	state.apply_chat_highlight(); assert.equal(state.chat_highlight_drafts['guild:5'], undefined);
	state.selected_chat_conversation = { conversation_kind: 'global', conversation_id: 1 };
	state.apply_chat_highlight(); assert.equal(state.get_chat_draft_highlight(), '#ABC123');
	state.apply_chat_highlight(true); assert.equal(state.get_chat_draft_highlight(), null);
	state.chat_can_highlight = false; state.open_chat_highlight_picker(); assert.equal(modals.length, 1);
});
test('successful send persists the color on the sender message and resets only its draft', async () => {
	const { state, payloads } = fixture(); state.chat_highlight_drafts['guild:5'] = '#FFFFFF';
	await state.send_chat_message();
	assert.equal(payloads[0].highlight_color, '#4D96FF');
	assert.equal(state.chat_messages[0].highlight_color, '#4D96FF');
	assert.equal(state.get_chat_draft_highlight(), null);
	assert.equal(state.chat_highlight_drafts['guild:5'], '#FFFFFF');
});
test('lost response retains color and key for exact retry; changing the color creates a new send', async () => {
	const { state, payloads } = fixture(async () => null);
	await state.send_chat_message(); await state.send_chat_message();
	assert.equal(state.get_chat_draft_highlight(), '#4D96FF');
	assert.deepEqual(payloads[0], payloads[1]);
	state.chat_highlight_drafts['global:1'] = '#FFFFFF'; await state.send_chat_message();
	assert.notEqual(payloads[2].idempotency_key, payloads[0].idempotency_key);
	state.chat_can_highlight = false; await state.send_chat_message();
	assert.equal('highlight_color' in payloads[3], false);
});
