const domain_errors = {
	MOD_MP_CHAT_RECIPIENT_UNAVAILABLE: 'Messaging is unavailable because of privacy or Block settings.',
	MOD_MP_CHAT_CONVERSATION_MISSING: 'This conversation is no longer available.',
	MOD_MP_CHAT_BUDGET_EMPTY: 'Message capacity is temporarily unavailable.'
};
export class ChatError extends Error {
	constructor(status, value = {}, retry = 0) {
		super(domain_errors[value.error_lang] ?? (value.error_lang ? `Chat could not complete this action (${value.error_lang}).` :
			status === 429 || value.retry_after_ms ? 'Please wait before trying again.' : `Request failed (${status}).`));
		this.status = status; this.code = value.error_lang;
		this.retry_after_ms = Math.min(300000, Math.max(0, Number(value.retry_after_ms) || retry || 0));
	}
}
const reads = {
	session: [], data: ['locale'], state: [], profile: ['people', 'client_id'], conversations: [],
	messages: ['conversation_kind', 'conversation_id', 'support_team_id', 'before', 'after', 'reaction_after', 'people'],
	'messages/details': ['conversation_kind', 'conversation_id', 'message_id']
};
const writes = new Set(['pair', 'logout', 'logout-all', 'conversations/start', 'messages/send', 'messages/reaction',
	'global-participation', 'guild-participation', 'alliance-participation', 'block', 'privacy', 'messages/delete', 'conversations/delete']);
export function allowed_endpoint(path, method) {
	if (typeof path !== 'string' || !path.startsWith('/chat/api/') || path.includes('#')) return false;
	const [suffix, query = ''] = path.slice(10).split('?');
	if (path.split('?').length > 2) return false;
	if (method === 'POST') return writes.has(suffix) && !query;
	if (method !== 'GET' || !Object.hasOwn(reads, suffix)) return false;
	const params = new URLSearchParams(query), seen = new Set();
	for (const [key, value] of params) {
		if (seen.has(key) || !reads[suffix].includes(key)) return false;
		seen.add(key);
		if (key === 'locale' ? !['en', 'de', 'zh-CN'].includes(value) :
			key === 'conversation_kind' ? !['private', 'global', 'guild', 'alliance', 'support', 'testers'].includes(value) :
			key === 'people' ? value !== '1' : !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) return false;
	}
	return true;
}
export function create_transport({ fetcher = fetch, timeout_ms = 15000 } = {}) {
	let generation = 0;
	const active = new Set();
	return {
		invalidate() { generation++; for (const controller of active)
			controller.abort(); active.clear(); },
		async request(path, { method = 'GET', csrf, link, body } = {}) {
			if (!allowed_endpoint(path, method))
				throw new Error('Unknown Chat endpoint');
			const current = generation;
			const controller = new AbortController();
			active.add(controller);
			const timer = setTimeout(() => controller.abort(), timeout_ms);
			try {
				const headers = {};
				if (csrf)
					headers['X-Chat-CSRF'] = csrf;
				if (link)
					headers['X-Chat-Link-ID'] = String(link);
				if (method !== 'GET')
					headers['Content-Type'] = 'application/json';
				const response = await fetcher(path, { method, headers, credentials: 'same-origin', cache: 'no-store',
					signal: controller.signal, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) });
				if (current !== generation)
					throw new DOMException('Selection changed', 'AbortError');
				let value;
				try { value = await response.json(); }
				catch (error) { if (response.ok || controller.signal.aborted) throw error; value = {}; }
				if (current !== generation)
					throw new DOMException('Selection changed', 'AbortError');
				if (!response.ok || value.error_lang || value.success === false) {
					const retry = response.headers?.get('Retry-After');
					throw new ChatError(response.status, value, retry ? (Number(retry) * 1000 || Date.parse(retry) - Date.now()) : 0);
				}
				return value;
			}
			catch (error) {
				if (current !== generation)
					throw new DOMException('Selection changed', 'AbortError');
				throw error;
			}
			finally {
				clearTimeout(timer);
				active.delete(controller);
			}
		}
	};
}
export function create_selection(storage) {
	const key = 'mp.chat.selected-link';
	return {
		read(links) { let id; try {
			id = storage?.getItem(key);
		}
		catch { } return links.find(link => String(link.link_id) === id)?.link_id ?? links[0]?.link_id ?? null; },
		write(id) { try {
			if (id === null)
				storage?.removeItem(key);
			else
				storage?.setItem(key, String(id));
		}
		catch { } }
	};
}
// Lock encompasses the recheck, exchange and bootstrap, including a fresh cookie.
export async function pair_serialized(locks, recheck, exchange, bootstrap) {
	const pair = async () => { await recheck(); const result = await exchange(); await bootstrap(result.link_id); };
	if (locks?.request)
		return locks.request('mp.chat.initial-pair', pair);
	return pair();
}
export function readable_item(id, items = []) {
	return items.find(item => item.id === id) ?? { id, name: id.split(':').slice(1).join(':').replaceAll('_', ' ') || id, media: null };
}
