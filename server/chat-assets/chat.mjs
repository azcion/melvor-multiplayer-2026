import { create_chat_controller, conversation_key } from './controller.mjs';
import { node, kind_labels, presentation, render_parts, avatar_node, conversation_image, conversation_label } from './render.mjs';
import { create_transport, create_selection, pair_serialized } from './transport.mjs';
const $ = id => document.getElementById(id);
const dev_tags = new URLSearchParams(window.location.search).get('devTags') === '1';
for (const id of ['people-tag', 'item-picker']) $(id).hidden = !dev_tags;
const transport = create_transport();
let storage;
try {
	storage = sessionStorage;
}
catch { }
const selection = create_selection(storage);
let links = [], csrf = null, selected = null, items = [], avatars = [], epoch = 0, busy = false;
const locks = navigator.locks;
const chat = create_chat_controller({ transport, changed: render_chat, visible: () => document.visibilityState !== 'hidden' && !$('workspace').hidden, unauthorized: () => void reconcile_access() });
let reconciling = false, people_generation = 0, dialog_generation = 0;
let inbox_signature = '', messages_signature = '';
const translations = new Map();
const translation_key = view => `mp.chat.translation/${view.link}/${view.selected}`;
function translation(view) {
	const key = translation_key(view);
	if (!translations.has(key)) {
		let value; try { value = storage?.getItem(key); } catch { }
		translations.set(key, ['en','zh-CN'].includes(value) ? value : '');
	}
	return translations.get(key);
}
const own_message = (m, view) => m.sent_by_viewer ?? m.sender_id === view.state.client_id;
let last_thread = null;
const originals = new Set();
$('lock-help').hidden = Boolean(locks?.request);
function clear_content() { chat.dispose(); people_generation++; close_dialog(); $('message-rows').replaceChildren(); $('inbox').replaceChildren(); $('draft').value = ''; $('thread').hidden = true; inbox_signature = ''; messages_signature = ''; items = []; avatars = []; $('items').replaceChildren(); $('data-status').textContent = ''; $('workspace').hidden = true; }
function invalidate() { epoch++; transport.invalidate(); clear_content(); }
function message(text) { $('status').textContent = text; }
function error_text(error) {
	return ({ 401: 'Access or code expired, revoked or already used. Link again with a fresh code from Melvor.', 403: 'Browser verification failed. Reload this page before trying a fresh code.', 409: 'Link capacity reached. Remove an unused identity or revoke a browser in Melvor.', 429: 'Too many requests. Wait before trying again.', 503: 'Chat is temporarily unavailable. Try again later.' })[error.status] ?? 'Request failed or timed out. Its result may be unknown. Reload to check browser access before using a fresh code; do not repeat a used code.';
}
function render_identity() {
	$('identity').replaceChildren(...links.map((link, index) => { const option = document.createElement('option'); option.value = String(link.link_id); option.textContent = links.filter(candidate => candidate.display_name === link.display_name).length > 1 ? `${link.display_name} (${links.slice(0,index + 1).filter(candidate => candidate.display_name === link.display_name).length})` : link.display_name; return option; }));
	$('identity-panel').hidden = links.length === 0;
	$('link-panel').hidden = links.length > 0;
	$('link-title').textContent = links.length ? 'Add another identity' : 'Link a character';
	$('identity').value = String(selected);
	const current = links.find(link => link.link_id === selected);
	$('active-character').textContent = current?.display_name ?? 'Characters';
	$('identity-detail').textContent = current ? `${current.display_name} · link expires ${new Date(current.expires_at).toLocaleString()}` : '';
}
async function bootstrap(preferred) {
	const data = await transport.request('/chat/api/session');
	links = data.links;
	csrf = data.csrf_token;
	selected = links.some(link => link.link_id === preferred) ? preferred : selection.read(links);
	selection.write(selected);
	render_identity();
}
async function load_data(reconciled = false) {
	clear_content();
	if (!selected)
		return;
	const current = epoch;
	$('workspace').hidden = false;
	void chat.set_identity(selected, csrf);
	$('data-status').textContent = 'Loading item suggestions…';
	try {
		const data = await transport.request('/chat/api/data?locale=en', { csrf, link: selected });
		if (current !== epoch)
			return;
		items = data.items; avatars = data.avatars ?? [];
		render_items(); render_chat(chat.view());
		$('data-status').textContent = `${items.length} demo items available${data.provenance.stale ? ' · using cached suggestions' : ''}`;
	}
	catch (error) {
		if (current !== epoch)
			return;
		if (error.status === 401) { if (!reconciled) void reconcile_access(); else message('Selected access changed. Reload to check linked characters.'); }
		else
			$('data-status').textContent = 'Item suggestions are unavailable. You can still send messages.';
	}
}
function render_items() {
	const query = $('search').value.toLocaleLowerCase();
	$('items').replaceChildren(...items.filter(item => `${item.name} ${item.id}`.toLocaleLowerCase().includes(query)).slice(0, 50).map(item => {
		const row = document.createElement('li');
		if (item.media && /^https:\/\/cdn2-main\.melvor\.net\/assets\/media\/[A-Za-z0-9_./=-]+$/.test(item.media) && !item.media.includes('..')) {
			const image = document.createElement('img');
			image.alt = '';
			image.loading = 'lazy';
			image.referrerPolicy = 'no-referrer';
			image.src = item.media;
			image.addEventListener('error', () => image.remove(), { once: true });
			row.append(image);
		}
		const text = document.createElement('span');
		text.textContent = item.name;
		const id = document.createElement('small');
		id.textContent = item.id;
		text.append(id);
		const insert = node(document, 'button', 'Insert item'); insert.type = 'button'; insert.addEventListener('click', () => { chat.tag({ type: 'item', item_id: item.id }); $('draft').focus(); });
		row.append(text, insert);
		return row;
	}));
}
function set_busy(value) { busy = value; for (const element of document.querySelectorAll('button,select'))
	element.disabled = value; }
async function start() {
	invalidate();
	const current = epoch;
	set_busy(true);
	try {
		await bootstrap();
		if (current === epoch)
			message('');
	}
	catch (error) {
		if (current !== epoch)
			return;
		links = [];
		csrf = null;
		selected = null;
		render_identity();
		message(error.status === 401 ? 'Enter a fresh code from Melvor to link a character.' : error_text(error));
	}
	finally {
		if (current === epoch)
			set_busy(false);
	}
	if (current === epoch)
		await load_data();
}
$('link-form').addEventListener('submit', async (event) => {
	event.preventDefault();
	if (busy)
		return;
	const code = $('code').value.trim();
	$('code').value = '';
	invalidate();
	const current = epoch;
	set_busy(true);
	try {
		await pair_serialized(locks, async () => { try {
			await bootstrap();
		}
		catch (error) {
			if (error.status !== 401)
				throw error;
			csrf = null;
			links = [];
			selected = null;
		} }, () => transport.request('/chat/api/pair', { method: 'POST', csrf, body: { code } }), bootstrap);
		if (current === epoch)
			message('Character linked.');
	}
	catch (error) {
		if (current === epoch) {
			render_identity();
			$('link-panel').hidden = false;
			message(error_text(error));
		}
	}
	finally {
		if (current === epoch)
			set_busy(false);
	}
	if (current === epoch)
		await load_data();
});
$('identity').addEventListener('change', () => { invalidate(); selected = Number($('identity').value); selection.write(selected); render_identity(); message(''); void load_data(); });
$('add').addEventListener('click', () => { $('link-panel').hidden = false; $('code').focus(); });
async function logout(all) {
	if (busy)
		return;
	const link = selected;
	invalidate();
	const current = epoch;
	set_busy(true);
	try {
		await transport.request(all ? '/chat/api/logout-all' : '/chat/api/logout', { method: 'POST', csrf, link });
		links = [];
		selected = null;
		csrf = null;
		selection.write(null);
		render_identity();
		message(all ? 'All identities unlinked.' : 'Selected identity unlinked.');
	}
	catch (error) {
		if (current === epoch)
			message(error_text(error));
	}
	finally {
		if (current === epoch)
			set_busy(false);
	}
	if (current === epoch)
		await start();
}
$('logout').addEventListener('click', () => void logout(false));
$('logout-all').addEventListener('click', () => void logout(true));
$('translation').addEventListener('change', () => {
	const view = chat.view(); if (!view.entry) return;
	const value = ['en','zh-CN'].includes($('translation').value) ? $('translation').value : '';
	const key = translation_key(view); translations.set(key,value);
	try { storage?.setItem(key,value); } catch { }
	render_chat(view);
});
$('search').addEventListener('input', render_items);
async function reconcile_access() {
	if (reconciling) return;
	reconciling = true; invalidate(); const current = epoch;
	try {
		await bootstrap();
		if (current !== epoch) return;
		message(selected ? 'Selected access expired or was revoked. Another linked character is available.' : 'Link a character with a fresh code from Melvor.');
		if (selected) void load_data(true);
	} catch (error) {
		if (current !== epoch) return;
		if (error.status === 401) { links = []; selected = null; csrf = null; selection.write(null); render_identity(); }
		message(error_text(error));
	} finally { reconciling = false; }
}
function button(text, action, disabled = false) {
	const b = node(document,'button',text); b.type = 'button'; b.disabled = disabled; b.addEventListener('click',action); return b;
}
function close_reactions() { $('reaction-picker').hidePopover?.(); }
function close_dialog() {
	close_reactions();
	dialog_generation++; people_generation++;
	const dialog = $('dialog'); if (dialog.open) dialog.close();
	$('dialog-content').replaceChildren(); $('dialog-content').className = 'dialog-scroll'; $('dialog-actions').replaceChildren();
}
function show_dialog(title) {
	close_dialog(); $('dialog-title').textContent = title;
	const dialog = $('dialog'); if (!dialog.open) dialog.showModal();
	return dialog_generation;
}
function confirm_action(title, text, action) {
	show_dialog(title); $('dialog-content').append(node(document,'p',text));
	$('dialog-actions').append(button('Confirm', () => { close_dialog(); void action(); }));
}
function restore_focus(key) {
	if (!key) return;
	for (const element of document.querySelectorAll('button,input,select,textarea')) if (element.chatFocus === key) { element.focus({ preventScroll:true }); break; }
}
function render_chat(view) {
	const focused = document.activeElement?.chatFocus;
	const e = view.entry;
	$('chat-notice').textContent = view.notice;
	$('inbox-status').textContent = view.loading ? 'Loading conversations…' : view.inbox.length ? '' : 'No conversations available. Manage Chat participation in Melvor.';
	const next_inbox = JSON.stringify([view.link,view.selected,view.inbox,items,avatars]);
	if (inbox_signature !== next_inbox) { inbox_signature = next_inbox; $('inbox').replaceChildren(...[['Global',['global','testers']],['Guild',['alliance','guild']],['Private',['private']],['Support',['support']]].flatMap(([label,kinds]) => {
		const conversations = kinds.flatMap(kind => view.inbox.filter(c => (c.conversation_kind ?? 'private') === kind));
		if (!conversations.length) return [];
		const heading = node(document,'h3',label);
		return [heading, ...conversations.map(c => {
			const b = button('', () => { close_dialog(); $('workspace').setAttribute('data-mobile-inbox','false'); void chat.select(c); });
			b.chatFocus = `inbox/${selected}/${conversation_key(c)}`; b.className = 'conversation'; b.setAttribute('aria-pressed', String(view.selected === conversation_key(c)));
			const icon = conversation_image(document,c,avatars); if (icon) b.append(icon);
			const copy = node(document,'span',undefined,'conversation-copy'); b.append(copy);
			copy.append(node(document,'strong',conversation_label(c)));
			if (c.unread_tagged || c.unread_count) copy.append(node(document,'span', `${c.unread_tagged ? '@ Mention · ' : ''}${c.unread_count || 0} unread`, c.unread_tagged ? 'mention' : 'unread'));
			if (c.latest_message) { const preview = node(document,'small'); render_parts(document,preview,c.latest_message.parts,c.latest_message.content,items,undefined,avatars); copy.append(preview); }
			return b;
		})];
	})); }
	$('thread').hidden = !e; $('choose-thread').hidden = Boolean(e);
	if (!e) { restore_focus(focused); return; }
	const message_list = $('messages'), composer_was_hidden = $('composer').hidden;
	const sent_now = last_thread === `${view.link}/${view.selected}` && (e.send_revision ?? 0) > (message_list.chatSendRevision ?? 0);
	message_list.chatSendRevision = e.send_revision ?? 0;
	const was_at_bottom = message_list.scrollHeight - message_list.scrollTop - message_list.clientHeight < 24;
	const c = e.conversation, private_chat = c.conversation_kind === 'private';
	$('thread-title').replaceChildren();
	const icon = conversation_image(document,c,avatars); if (icon) $('thread-title').append(icon);
	$('thread-title').append(node(document,'span',conversation_label(c)));
	$('thread-title').disabled = !private_chat || !c.participant?.client_id;
	const locale = translation(view); $('translation').value = locale;
	const next_messages = JSON.stringify([view.link,view.selected,e.messages,items,avatars,locale,[...originals]]);
	if (messages_signature !== next_messages) { messages_signature = next_messages;
	const list = $('messages'), near_bottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24, old_height = list.scrollHeight, old_top = list.scrollTop;
	$('older').hidden = !e.has_more;
	const previous_first = list.chatFirst;
	$('message-rows').replaceChildren(...e.messages.map(m => {
		const row = node(document,'article',undefined,(m.sent_by_viewer ?? m.sender_id === view.state.client_id) ? 'message outgoing' : 'message');
		const header = node(document,'div',undefined,'message-header');
		const author = m.sender_id ? button('', () => void show_profile(m.sender_id)) : node(document,'strong');
		const avatar = avatar_node(document,m.sender?.icon_id,avatars); if (avatar) author.append(avatar);
		author.append(node(document,'span',m.sender?.display_name ?? 'Support')); header.append(author);
		const timestamp = button('', () => show_message_actions(m, chat.view()));
		timestamp.className = 'message-timestamp'; timestamp.setAttribute('aria-label', 'Message actions');
		timestamp.append(node(document,'time',new Date(m.created_at).toLocaleString()));
		// Synthetic welcomes have no durable message actions.
		if (m.message_id > 0) header.append(timestamp);
		else header.append(node(document,'time',new Date(m.created_at).toLocaleString()));
		row.append(header);
		const display = presentation(m,locale,own_message(m,view) || originals.has(`${selected}/${view.selected}/${m.message_id}`));
		const bubble = node(document,'div',undefined,'message-bubble'); row.append(bubble);
		const body = node(document,'div',undefined,'message-content'); render_parts(document,body,display.parts,display.text,items,id => void show_profile(id),avatars); bubble.append(body);
		const reactions = node(document,'div',undefined,'message-reactions');
		if (m.message_id > 0) for (const r of m.reactions ?? []) {
			const summary = button(`${r.reaction} ${r.count}`, () => void chat.reaction(m.message_id,r.reaction,!r.reacted),e.denied);
			summary.setAttribute('aria-pressed',String(Boolean(r.reacted))); reactions.append(summary);
		}
		if (m.message_id > 0) { if (!reactions.children.length) reactions.className += ' reactions-empty';
		const add = button('☺+', event => show_reactions(m,event?.currentTarget),e.denied); add.setAttribute('aria-label','Add reaction'); reactions.append(add); }
		if (reactions.children.length) bubble.append(reactions);
		for (const element of [...header.children,...reactions.children,...body.children]) if (element.tagName === 'BUTTON') element.chatFocus = `message/${selected}/${view.selected}/${m.message_id}/${element === timestamp ? 'timestamp' : element.textContent}`;
		return row;
	}));
	if (last_thread !== `${view.link}/${view.selected}`) list.scrollTop = list.scrollHeight;
	else if (previous_first != null && e.messages[0]?.message_id < previous_first) list.scrollTop = old_top + list.scrollHeight - old_height;
	else if (near_bottom) list.scrollTop = list.scrollHeight;
	list.chatFirst = e.messages[0]?.message_id;
	if (e.loaded) last_thread = `${view.link}/${view.selected}`; }
	$('history-status').textContent = e.denied ? 'Access changed. This conversation is unavailable.' : e.history || e.messages.length ? '' : 'No messages yet. Say hello.';
	$('older').hidden = !e.has_more; $('older').disabled = e.history?.mode === 'older' || e.denied;
	const disabled = e.denied || e.validating || c.blocked || c.can_send === false || private_chat && view.state.messaging_enabled === false;
	$('composer').hidden = disabled; $('read-only').textContent = e.validating && !e.denied ? 'Checking conversation access…' : disabled ? 'Messaging is unavailable for this conversation. Check participation, privacy or Block settings.' : '';
	if ($('draft').value !== e.draft) $('draft').value = e.draft;
	$('draft-count').textContent = `${e.draft.length} / 1000`;
	$('draft').disabled = Boolean(e.pending);
	$('send').disabled = Boolean(e.pending) || e.sending || view.mutating;
	$('retry-send').hidden = !e.pending || e.sending; $('retry-send').disabled = e.sending || Date.now() < e.retry_at;
	$('pending-warning').textContent = e.pending && !e.sending ? 'Send result may be unknown. Retry sends the exact original message once. Keep this page open; reloading loses its retry key.' : '';
	$('tags').replaceChildren(...e.tags.map((p,i) => { const row = node(document,'span',undefined,'draft-tag'); render_parts(document,row,[p],'',items); const remove = button('Remove',() => chat.untag(i),Boolean(e.pending)); remove.chatFocus = `tag/${selected}/${view.selected}/${i}`; row.append(remove); return row; }));
	$('people-tag').disabled = Boolean(e.pending); $('item-picker').disabled = Boolean(e.pending); restore_focus(focused);
	// Access validation can reveal the composer without changing message data.
	if (sent_now || composer_was_hidden !== $('composer').hidden && was_at_bottom) message_list.scrollTop = message_list.scrollHeight;
}
function show_conversation_actions() {
	const view = chat.view(), e = view.entry, c = e?.conversation;
	if (c?.conversation_kind !== 'private' || !c.participant?.client_id) return;
	show_dialog('Conversation actions'); $('dialog-content').className = 'dialog-scroll action-menu';
	$('dialog-content').append(button('Profile', () => void show_profile(c.participant.client_id)),
		button(c.blocked ? 'Unblock' : 'Block', () => confirm_action(c.blocked ? 'Unblock character' : 'Block character', 'This changes Private messaging between these characters.', () => chat.preference('block',{ client_id: c.participant.client_id, blocked: !c.blocked })), view.mutating));
	if (c.conversation_id) $('dialog-content').append(button('Hide conversation', () => confirm_action('Hide conversation','Hide this conversation and its current history for this identity?', () => chat.hide()), Boolean(e.pending) || view.mutating));
}
function show_message_actions(m, view) {
	if (m.message_id <= 0) return;
	show_dialog('Message actions'); $('dialog-content').className = 'dialog-scroll action-menu';
	const e = view.entry;
	if (!own_message(m,view) && translation(view) && typeof m.translations?.[translation(view)] === 'string' && m.translations[translation(view)].length > 0) {
		const id = `${selected}/${view.selected}/${m.message_id}`;
		$('dialog-content').append(button(originals.has(id) ? 'Show translation' : 'Show original', () => {
			if (originals.has(id)) originals.delete(id); else originals.add(id);
			close_dialog(); render_chat(chat.view());
		}));
	}
	$('dialog-content').append(button('Show Seen', () => void show_details(m,'seen')),button('View Reactions', () => void show_details(m,'reactions')));
	if (e.conversation.conversation_kind === 'private') $('dialog-content').append(button('Hide for me', () => confirm_action('Hide message','Hide this message for this identity?', () => chat.hide(m.message_id)),view.mutating || Boolean(e.pending)));
}
async function show_profile(id) {
	const generation = show_dialog('Character profile'); $('dialog-content').append(node(document,'p','Loading profile…'));
	const p = await chat.profile(id); if (generation !== dialog_generation) return;
	if (!p) { $('dialog-content').replaceChildren(node(document,'p','Profile unavailable. Close and try again.')); return; }
	$('dialog-title').textContent = p.display_name; $('dialog-content').replaceChildren();
	for (const [label,value] of [['Guild',p.guild_name ?? 'None'],['Language',p.language ?? 'Unknown'],['Total Skill Level',p.total_skill_level ?? 'Private'],['Game mode',p.game_mode_id ?? 'Private'],['Account age',p.account_age == null ? 'Unknown' : `${Math.floor(p.account_age / 86400000)} days`]]) $('dialog-content').append(node(document,'p',`${label}: ${value}`));
	if (p.can_start_chat) $('dialog-actions').append(button('Start Private Chat',() => { close_dialog(); void chat.start(p.client_id); }));
	else $('dialog-content').append(node(document,'p','Private messaging is unavailable for these characters.'));
}
async function show_people(tagging) {
	const generation = show_dialog(tagging ? 'Tag a person' : 'New Private Chat'); $('dialog-content').append(node(document,'p','Loading people…'));
	const people = await chat.people(tagging); if (generation !== dialog_generation) return;
	$('dialog-content').replaceChildren();
	const label = node(document,'label','Search characters'); const search = node(document,'input'); search.type = 'search'; label.append(search);
	const results = node(document,'div'); $('dialog-content').append(label,results);
	const render = () => results.replaceChildren(...people.filter(p => `${p.display_name} ${p.client_id}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())).slice(0,100).map(p => button(p.display_name,() => {
		if (tagging) { close_dialog(); chat.tag({ type:'person',client_id:p.client_id,display_name:p.display_name,icon_id:p.icon_id }); $('draft').focus(); }
		else void show_profile(p.client_id);
	})));
	render(); if (!people.length) $('dialog-content').append(node(document,'p','No characters available. Close and retry if loading failed.')); search.addEventListener('input',render); search.focus();
}
function show_reactions(m, anchor) {
	close_dialog();
	const popup = $('reaction-picker');
	const anchored = anchor && popup.showPopover;
	if (!anchored) { show_dialog('Add a reaction'); $('dialog-content').className = 'dialog-scroll reaction-picker'; }
	const target = anchored ? popup : $('dialog-content'); target.replaceChildren();
	for (const reaction of ['👍','👎','❤️','😂','😭','💀','👀','🔥','💯','🎉','🤔','😮','😬','😡','🗿','👋','👏','😎','🐠','🚽','🐬','🍕','🛸','⌛']) target.append(button(reaction, () => {
		close_dialog(); void chat.reaction(m.message_id,reaction,!m.reactions?.some(r => r.reaction === reaction && r.reacted));
	}));
	if (anchored) {
		popup.showPopover();
		const rect = anchor.getBoundingClientRect();
		popup.style.left = `${Math.max(8,Math.min(rect.left,window.innerWidth - popup.offsetWidth - 8))}px`;
		popup.style.top = `${Math.max(8,Math.min(rect.bottom + 8,window.innerHeight - popup.offsetHeight - 8))}px`;
	}
}
async function show_details(m, kind) {
 const generation = show_dialog(kind === 'seen' ? 'Seen by' : 'Reactions'); $('dialog-content').append(node(document,'p','Loading…'));
 const data = await chat.details(m.message_id); if (generation !== dialog_generation) return;
 if (!data) { $('dialog-content').replaceChildren(node(document,'p','Message details are unavailable. Close and try again.')); return; }
 $('dialog-content').replaceChildren();
 for (const person of data[kind] ?? []) $('dialog-content').append(node(document,'p',kind === 'seen' ? person.display_name : `${person.reaction} · ${person.display_name}`));
 if (!data[kind]?.length) $('dialog-content').append(node(document,'p',kind === 'seen' ? 'No stored readers.' : 'No reactions.'));
}
$('mobile-inbox').addEventListener('click', () => { close_dialog(); $('workspace').setAttribute('data-mobile-inbox','true'); });
// Keep the phone composer above the on-screen keyboard, including Safari.
function resize_chat_viewport() { document.documentElement?.style.setProperty('--chat-viewport-height', `${window.visualViewport?.height ?? window.innerHeight}px`); }
window.visualViewport?.addEventListener('resize',resize_chat_viewport);
window.addEventListener('resize',resize_chat_viewport);
resize_chat_viewport();
$('thread-title').addEventListener('click',show_conversation_actions);
$('composer').addEventListener('submit', event => { event.preventDefault(); chat.draft($('draft').value); void chat.send(); });
$('messages').addEventListener('scroll',close_reactions);
window.addEventListener('resize',close_reactions);
$('draft').addEventListener('input', () => { chat.draft($('draft').value); $('draft-count').textContent = `${$('draft').value.length} / 1000`; });
let composing = false;
$('draft').addEventListener('compositionstart', () => { composing = true; });
$('draft').addEventListener('compositionend', () => { composing = false; });
$('draft').addEventListener('keydown', event => {
	const mobile = window.innerWidth <= 760 || navigator.userAgentData?.mobile || navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)').matches;
	if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || composing || event.isComposing || event.keyCode === 229 || mobile) return;
	event.preventDefault();
	if (!$('send').disabled && !$('composer').hidden) { chat.draft($('draft').value); void chat.send(); }
});
$('retry-send').addEventListener('click', () => void chat.send(true));
$('older').addEventListener('click', () => void chat.history('older'));
$('people-tag').addEventListener('click', () => void show_people(true));
$('item-picker').addEventListener('click', () => { $('item-suggestions').hidden = !$('item-suggestions').hidden; if (!$('item-suggestions').hidden) $('search').focus(); });
$('dialog-close').addEventListener('click',close_dialog);
$('dialog').addEventListener('cancel',close_dialog);
document.addEventListener('visibilitychange',() => { if (document.visibilityState === 'hidden') close_dialog(); chat.foreground(); });
window.addEventListener('beforeunload',event => { if (chat.has_pending()) { event.preventDefault(); event.returnValue = ''; } });
void start();
