// Game-session management only. Pairing codes never enter storage or URLs.
export function install_browser_link_actions({ state, api_get, api_post_response, get_scope, get_origin,
	getLangString, navigator = globalThis.navigator, openLink = globalThis.openLink,
	now = Date.now, set_timer = setTimeout, clear_timer = clearTimeout }) {
	let generation = 0, expiry_timer = null;
	const text = key => getLangString('MOD_MP_BROWSER_LINK_' + key);
	const current = (turn, scope) => turn === generation && scope === get_scope();
	const actions = {
		browser_link_code: '', browser_link_expiry: 0, browser_link_sessions: [],
		browser_link_pending: false, browser_link_feedback: '', browser_links_visible: false,
		clear_browser_links() {
			generation++;
			if (expiry_timer !== null) clear_timer(expiry_timer);
			expiry_timer = null;
			state.browser_link_code = '';
			state.browser_link_expiry = 0;
			state.browser_link_sessions = [];
			state.browser_link_pending = false;
			state.browser_link_feedback = '';
			state.browser_links_visible = false;
		},
		browser_chat_url() { return get_origin() + '/chat'; },
		open_browser_chat_url() {
			const url = state.browser_chat_url();
			if (typeof openLink === 'function') openLink(url);
		},
		browser_link_time(value) { return new Date(value).toLocaleString(); },
		async manage_browser_links(operation = 'list', session_id = null) {
			if (state.browser_link_pending || !state.is_connected) return;
			if (operation === 'revoke' && !state.browser_link_sessions.some(entry => entry.id === session_id)) return;
			if (!['list', 'issue', 'revoke'].includes(operation)) return;
			state.browser_link_pending = true;
			if (operation === 'list') state.browser_links_visible = false;
			if (operation === 'issue') {
				if (expiry_timer !== null) clear_timer(expiry_timer);
				expiry_timer = null;
				state.browser_link_code = '';
				state.browser_link_expiry = 0;
			}
			state.browser_link_feedback = '';
			const turn = generation, scope = get_scope();
			try {
				if (operation === 'list') {
					const result = await api_get('/api/chat/browser-links/list', () => current(turn, scope));
					if (!current(turn, scope)) return;
					if (!Array.isArray(result?.sessions)) throw new Error();
					state.browser_link_sessions = result.sessions;
					state.browser_links_visible = true;
				} else {
					const { response, json } = await api_post_response('/api/chat/browser-links/' + operation,
						operation === 'revoke' ? { session_id } : {});
					if (!current(turn, scope)) return;
					if (response?.status === 429) {
						state.browser_link_feedback = text('RATE_LIMIT');
						return;
					}
					if (response?.status === 409 && operation === 'issue') {
						state.browser_link_feedback = text('CAPACITY');
						return;
					}
					if (response?.status !== 200) throw new Error();
					if (operation === 'issue') {
						if (typeof json?.code !== 'string' || !Number.isSafeInteger(json.expires_at) || json.expires_at <= now()) throw new Error();
						if (expiry_timer !== null) clear_timer(expiry_timer);
						state.browser_link_code = json.code;
						state.browser_link_expiry = json.expires_at;
						expiry_timer = set_timer(() => {
							if (!current(turn, scope)) return;
							state.browser_link_code = '';
							state.browser_link_expiry = 0;
							state.browser_link_feedback = text('EXPIRED');
						}, json.expires_at - now());
					} else {
						state.browser_link_sessions = state.browser_link_sessions.filter(entry => entry.id !== session_id);
						state.browser_link_feedback = text('REVOKED');
					}
				}
			} catch {
				if (current(turn, scope)) state.browser_link_feedback = text('ERROR');
			} finally {
				if (current(turn, scope)) state.browser_link_pending = false;
			}
		},
		async copy_browser_link_code() {
			if (!state.browser_link_code || state.browser_link_pending || state.browser_link_expiry <= now()) return;
			const turn = generation, scope = get_scope(), code = state.browser_link_code;
			state.browser_link_pending = true;
			try {
				if (!navigator?.clipboard?.writeText) throw new Error();
				await navigator.clipboard.writeText(code);
				if (current(turn, scope) && state.browser_link_code === code) state.browser_link_feedback = text('COPIED');
			} catch {
				if (current(turn, scope) && state.browser_link_code === code) state.browser_link_feedback = text('COPY_MANUALLY');
			} finally {
				if (current(turn, scope)) state.browser_link_pending = false;
			}
		}
	};
	return actions;
}
