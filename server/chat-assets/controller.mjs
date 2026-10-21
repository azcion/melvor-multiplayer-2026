import { highlight_color } from '../../mod/chat-highlights.mjs';

// All transient state belongs to an explicit link and logical conversation. Nothing is persisted.
export const kinds = ['global', 'guild', 'alliance', 'private', 'support', 'testers'];
export function conversation_key(c) {
	const kind = c.conversation_kind ?? 'private';
	return `${kind}:${kind === 'private' ? `person:${c.participant.client_id}` :
		kind === 'support' && c.viewer_side !== 'team' ? `team:${c.support_team_id}` : c.conversation_id}`;
}
export function conversation_params(c) {
	const params = new URLSearchParams({ conversation_kind: c.conversation_kind ?? 'private' });
	if (c.conversation_id != null) params.set('conversation_id', String(c.conversation_id));
	if (c.support_team_id != null) params.set('support_team_id', String(c.support_team_id));
	return params;
}
export function poll_delay(failures, retry = 0, random = Math.random) {
	return Math.max(retry, Math.round(Math.min(60000, 5000 * 2 ** Math.min(failures, 4)) * (.9 + random() * .2)));
}
export function create_chat_controller({ transport, changed = () => {}, unauthorized = () => {},
	visible = () => true, now = Date.now, key = () => crypto.randomUUID(), random = Math.random,
	schedule = setTimeout, cancel = clearTimeout } = {}) {
	let link = null, csrf = null, epoch = 0, selected = null, timer = null, failures = 0, retry = 0, polling = false;
	let inbox = [], state = {}, notice = '', loading = false;
	const entries = new Map(), mutations = new Set(), cooldowns = new Map();
	const snapshot = () => ({ link, csrf, epoch, selected });
	const current = s => s.link === link && s.epoch === epoch && s.selected === selected;
	const entry_key = c => `${link}/${conversation_key(c)}`;
	const entry = () => selected ? entries.get(`${link}/${selected}`) : null;
	const notify = () => changed(api.view());
	function get_entry(c) {
		const id = entry_key(c);
		if (!entries.has(id)) entries.set(id, { conversation: c, messages: [], draft: '', tags: [], highlight_color: null, pending: null,
			people: [], reaction_revision: 0, has_more: false, loaded: false, denied: false, history: null, retry_at: 0 });
		const e = entries.get(id); e.conversation = c; return e;
	}
	function stop() { if (timer !== null) cancel(timer); timer = null; }
	function arm() { stop(); if (link && visible()) timer = schedule(() => void tick(), poll_delay(failures, retry, random)); }
	function failure(error, s, e) {
		if (!current(s)) return;
		failures++; retry = error.retry_after_ms ?? 0;
		if (e) e.retry_at = now() + retry;
		notice = (error.name === 'AbortError' ? 'Request timed out. Its result may be unknown.' : error.message || 'Request failed. Try again.') + (retry ? ` Wait ${Math.ceil(retry / 1000)} seconds before retrying.` : '');
		if (error.status === 401) { stop(); if (e) { e.messages = []; e.denied = true; } unauthorized(s.link); }
		else if (e && ([403, 404].includes(error.status) || error.code?.includes('MISSING') || error.code === 'MOD_MP_CHAT_RECIPIENT_UNAVAILABLE')) {
			e.messages = []; e.people = []; e.denied = true;
		}
		notify();
	}
	async function request(path, s, body) {
		return transport.request(`/chat/api/${path}`, { link: s.link, csrf: s.csrf,
			...(body === undefined ? {} : { method: 'POST', body }) });
	}
	async function refresh_inbox() {
		const s = snapshot();
		const [data, preferences] = await Promise.all([request('conversations', s), request('state', s)]);
		if (!current(s)) return;
		inbox = (data.conversations ?? []).filter(c => kinds.includes(c.conversation_kind ?? 'private'));
		state = { ...preferences, ...Object.fromEntries(['global_chat', 'guild_chat', 'alliance_chat'].map(k => [k, data[k]])) };
		if (selected) {
			const c = inbox.find(c => conversation_key(c) === selected), e = entry();
			if (c) {
				if (c.conversation_id !== e.conversation.conversation_id || Number.isSafeInteger(c.moderation_count) && Number.isSafeInteger(e.conversation.moderation_count) && c.moderation_count !== e.conversation.moderation_count) {
					e.reload = true; e.messages = []; e.reaction_revision = 0;
				}
				e.conversation = c;
			}
			else if (e?.conversation.conversation_id != null) { e.messages = []; e.people = []; e.denied = true; }
		}
		notify();
	}
	async function history(mode = 'incremental') {
		const s = snapshot(), e = entry();
		if (!e || !link || !visible() || e.denied || e.conversation.conversation_id == null && e.conversation.conversation_kind !== 'support') return;
		if (e.history) {
			if (mode === 'older' && e.history.mode !== 'older' && e.has_more) e.older_requested = true;
			return;
		}
		if (e.reload) mode = 'reload';
		const token = { mode }; e.history = token;
		let applied = false;
		const params = conversation_params(e.conversation);
		const positive = e.messages.map(m => m.message_id).filter(id => id > 0);
		if (mode === 'older' && positive.length) params.set('before', String(Math.min(...positive)));
		else if (mode === 'incremental' && e.loaded && positive.length) params.set('after', String(Math.max(...positive)));
		if (mode === 'incremental' && e.messages.some(m => ['queued','processing'].includes(m.translation_status) && now() - (m.translation_enqueued_at ?? m.created_at) < 10000)) params.delete('after');
		params.set('reaction_after', String(mode === 'reload' ? 0 : e.reaction_revision));
		notify();
		try {
			let data = await request(`messages?${params}`, s);
			if (!current(s) || !visible()) return;
			if (e.loaded && data.moderation_count !== undefined && e.moderation_count !== undefined && data.moderation_count !== e.moderation_count && mode !== 'reload') {
				// Incremental responses cannot remove hidden rows. Rebuild the selected window before rendering.
				const fresh = conversation_params(e.conversation); fresh.set('reaction_after','0');
				data = await request(`messages?${fresh}`,s);
				if (!current(s) || !visible()) return;
				mode = 'reload';
			}
			e.moderation_count = data.moderation_count;
			const merged = new Map((mode === 'reload' ? [] : e.messages).map(m => [m.message_id, m]));
			for (const m of data.messages ?? []) merged.set(m.message_id, m);
			for (const update of data.reaction_updates ?? []) if (merged.has(update.message_id))
				Object.assign(merged.get(update.message_id), { reactions: update.reactions });
			// Bounded in-memory window; older history can always be requested again after reopening.
			e.messages = [...merged.values()].sort((a,b) => a.message_id - b.message_id).slice(mode === 'older' ? 0 : -500, mode === 'older' ? 500 : undefined);
			if (mode !== 'incremental' || !e.loaded) e.has_more = Boolean(data.has_more);
			e.reaction_revision = data.reaction_revision ?? e.reaction_revision; e.loaded = true; e.reload = false; e.validating = false;
			notice = ''; failures = 0; retry = 0; applied = true;
		} catch (error) { failure(error, s, e); }
		finally {
			if (e.history === token) e.history = null;
			const older_requested = e.older_requested; e.older_requested = false;
			if (current(s)) {
				notify();
				if (applied && older_requested && e.has_more) await history('older');
			}
		}
	}
	async function tick() {
		if (polling || !link || !visible()) return;
		polling = true; const s = snapshot();
		try { await refresh_inbox(); if (current(s)) { if (entry()) await history(); else { failures = 0; retry = 0; } } }
		catch (error) { failure(error, s, entry()); }
		finally { polling = false; arm(); }
	}
	async function mutate(path, body, apply) {
		const s = snapshot(), e = entry(), id = `${s.link}/${path}`;
		if (!link || mutations.has(id) || now() < (cooldowns.get(id) ?? 0)) return;
		mutations.add(id); notify();
		try { const data = await request(path, s, body); if (current(s)) { apply?.(data); if (e) e.denied = false; notice = ''; await refresh_inbox(); } return current(s) ? data : null; }
		catch (error) { cooldowns.set(id, now() + (error.retry_after_ms ?? 0)); failure(error, s, e); }
		finally { mutations.delete(id); if (current(s)) notify(); }
	}
	async function send(retry_send = false) {
		const e = entry(), s = snapshot();
		if (!e || e.denied || e.validating || e.conversation.can_send === false || e.sending || now() < e.retry_at) return;
		if (!retry_send) {
			if (e.pending || !e.draft.trim() && !e.tags.length) return;
			const parts = [...e.tags.flatMap(part => [part, { type: 'text', text: ' ' }]), { type: 'text', text: e.draft.trim() }];
			const content = parts.map(p => p.type === 'text' ? p.text : p.type === 'item' ? `[${p.item_id.split(':')[1].replaceAll('_',' ')}]` : `@${p.display_name}`).join('');
			if (content.length > 1000 || e.tags.length > 20) { notice = 'Messages allow 1–1,000 characters and up to 20 tags.'; notify(); return; }
			e.pending = { link: s.link, csrf: s.csrf, body: JSON.parse(JSON.stringify({
				conversation_kind: e.conversation.conversation_kind ?? 'private', conversation_id: e.conversation.conversation_id,
				...(e.conversation.support_team_id ? { support_team_id: e.conversation.support_team_id } : {}),
				...(e.conversation.participant.client_id ? { client_id: e.conversation.participant.client_id } : {}),
				content, parts, ...(state.can_highlight && e.highlight_color ? { highlight_color: e.highlight_color } : {}), idempotency_key: key() })) };
		}
		if (!e.pending) return;
		const pending = e.pending; e.sending = true; notify();
		try {
			const data = await request('messages/send', { ...s, link: pending.link, csrf: pending.csrf }, pending.body);
			// Settling this owned entry is safe even offscreen; rendering remains guarded by the selection epoch.
			e.pending = null; e.draft = ''; e.tags = []; e.highlight_color = null; e.retry_at = 0; e.send_revision = (e.send_revision ?? 0) + 1;
			if (data.message) {
				const m = data.message;
				if (e.conversation.conversation_kind === 'support' && e.conversation.conversation_id == null && m.conversation_id != null) {
					e.reload = true; e.reaction_revision = 0;
				}
				e.conversation = { ...e.conversation, conversation_id: m.conversation_id ?? e.conversation.conversation_id };
				e.messages = e.messages.filter(old => old.message_id > 0 && old.message_id !== m.message_id).concat(m).sort((a,b) => a.message_id - b.message_id);
			}
			if (current(s)) { notice = ''; await refresh_inbox(); if (current(s) && e.reload) await history('reload'); }
		} catch (error) {
			// Abort/lost response may have committed: preserve the exact payload and key until explicit Retry.
			e.retry_at = now() + (error.retry_after_ms ?? 0);
			failure(error, s, e);
		} finally { e.sending = false; if (current(s)) notify(); }
	}
	const api = {
		view: () => ({ link, selected, inbox, state, notice, loading, entry: entry(), mutating: [...mutations].some(id => id.startsWith(`${link}/`)) }),
		async set_identity(id, token) {
			epoch++; stop(); link = id; csrf = token; selected = null; inbox = []; state = {}; notice = ''; loading = Boolean(id); notify();
			if (!id) return;
			const s = snapshot();
			try { await refresh_inbox(); if (current(s)) { failures = 0; retry = 0; } }
			catch (error) { failure(error, s); }
			finally { if (current(s)) { loading = false; notify(); } arm(); }
		},
		async select(c) {
			epoch++; stop(); selected = conversation_key(c); const e = get_entry(c); e.denied = false;
			e.validating = !(c.conversation_kind === 'private' && c.conversation_id == null); notice = ''; notify();
			try { await history('reload'); } finally { arm(); }
		},
		draft(value) { const e = entry(); if (e && !e.pending) { e.draft = value; } },
		highlight(value) {
			const e = entry();
			if (e && state.can_highlight === true && !e.pending) { e.highlight_color = highlight_color(value); notify(); }
		},
		tag(part) { const e = entry(); if (e && !e.pending && e.tags.length < 20) { e.tags.push(part); notify(); } },
		untag(index) { const e = entry(); if (e && !e.pending) { e.tags.splice(index,1); notify(); } },
		send, history, tick,
		foreground() { if (visible()) void tick(); else stop(); },
		async people(conversation = false) {
			const s = snapshot(), e = entry();
			if (conversation && (!e || !visible())) return [];
			// people=1 on messages also acknowledges history; only call on the visible selection.
			const path = conversation && !(e.conversation.conversation_kind === 'private' && e.conversation.conversation_id == null) ? `messages?${conversation_params(e.conversation)}&people=1` : 'profile?people=1';
			try { const data = await request(path, s); if (!current(s)) return []; if (e && conversation) e.people = data.people; return data.people ?? []; }
			catch (error) { failure(error,s,e); return []; }
		},
		async profile(id) {
			const s = snapshot();
			try { const data = await request(`profile?client_id=${id}`,s); return current(s) ? data : null; }
			catch (error) { failure(error,s); return null; }
		},
		async details(message_id) {
			const s = snapshot(), e = entry();
			if (!e || message_id <= 0 || !e.messages.some(m => m.message_id === message_id)) return null;
			const params = conversation_params(e.conversation); params.delete('support_team_id');
			try { const data = await request(`messages/details?${params}&message_id=${message_id}`,s); return current(s) ? data : null; }
			catch (error) { if (error.status === 404 && current(s)) e.messages = e.messages.filter(m => m.message_id !== message_id); failure(error,s,error.status === 401 ? e : undefined); return null; }
		},
		async start(id) { const data = await mutate('conversations/start', { client_id: id }); if (data?.conversation) await api.select(data.conversation); },
		async reaction(message_id, reaction, reacted) {
			const e = entry(); if (!e || e.denied || message_id <= 0 || !e.messages.some(m => m.message_id === message_id)) return;
			return mutate('messages/reaction', { conversation_kind: e.conversation.conversation_kind, conversation_id: e.conversation.conversation_id, message_id, reaction, reacted }, data => {
				const m = e.messages.find(m => m.message_id === message_id); if (m) m.reactions = data.reactions;
			});
		},
		preference(path, body) { return mutate(path, body); },
		async hide(message_id) {
			const e = entry(); if (!e || e.conversation.conversation_kind !== 'private' || e.pending) return;
			const body = { conversation_kind: 'private', conversation_id: e.conversation.conversation_id, ...(message_id ? { message_id } : {}) };
			return mutate(message_id ? 'messages/delete' : 'conversations/delete', body, () => {
				e.messages = message_id ? e.messages.filter(m => m.message_id !== message_id) : []; if (!message_id) selected = null;
			});
		},
		has_pending: () => [...entries.values()].some(e => e.pending),
		dispose() { epoch++; stop(); link = null; selected = null; }
	};
	return api;
}
