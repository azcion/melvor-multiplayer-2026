const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISTRIBUTIONS = ['unknown', 'google_play', 'huawei_appgallery', 'apple_app_store', 'steam', 'epic', 'other'];
const CHANNELS = ['unknown', 'stable', 'beta'];
const VERSION = /^[0-9][0-9A-Za-z.+_-]{0,31}$/;

export function sanitize_app_details(value = {}) {
	return {
		distribution: DISTRIBUTIONS.includes(value?.distribution) ? value.distribution : 'unknown',
		app_channel: CHANNELS.includes(value?.app_channel) ? value.app_channel : 'unknown',
		app_version: typeof value?.app_version === 'string' && VERSION.test(value.app_version) ? value.app_version : null,
		app_build: typeof value?.app_build === 'string' && VERSION.test(value.app_build) ? value.app_build : null
	};
}
export function detect_runtime(manager, user_agent = '') {
	// Read only coarse booleans. Never call native deviceInfo(), which includes unrelated private data.
	const flags = {};
	for (const name of ['isAndroid', 'isIOS', 'isSteam', 'isEpicGames', 'isGeckoView']) {
		try { flags[name] = manager?.[name]; } catch { flags[name] = undefined; }
	}
	const flag = name => flags[name] === true;
	const platform = flag('isAndroid') ? 'android' : flag('isIOS') ? 'ios' : flag('isSteam') ? 'steam' :
		flag('isEpicGames') ? 'epic' : ['isAndroid', 'isIOS', 'isSteam', 'isEpicGames'].every(name => flags[name] === false) ? 'browser' : 'unknown';
	// The UA is classified locally and is neither retained nor sent. Engine never implies release channel.
	const ua = typeof user_agent === 'string' ? user_agent.toLowerCase() : '';
	const engine = flag('isGeckoView') || /firefox\/|geckoview/.test(ua) ? 'gecko' :
		/chrome\/|chromium\/|edg\//.test(ua) ? 'chromium' : /applewebkit\//.test(ua) ? 'webkit' : 'unknown';
	return { platform, engine };
}
export function create_installation_store(storage, random_uuid = () => crypto.randomUUID()) {
	const memory = new Map();
	function key(origin) { return `multiplayer:installation:${new URL(origin).origin}`; }
	function read(origin) {
		const namespace = key(origin);
		if (memory.has(namespace)) return memory.get(namespace);
		let saved;
		try { saved = JSON.parse(storage?.getItem(namespace) ?? 'null'); } catch { /* Storage may be unavailable. */ }
		const value = {
			installation_id: UUID.test(saved?.installation_id) ? saved.installation_id : random_uuid(),
			...sanitize_app_details(saved)
		};
		memory.set(namespace, value);
		try { storage?.setItem(namespace, JSON.stringify(value)); } catch { /* Keep an ephemeral ID for this runtime. */ }
		return value;
	}
	function update(origin, details) {
		const value = { installation_id: read(origin).installation_id, ...sanitize_app_details(details) };
		memory.set(key(origin), value);
		try { storage?.setItem(key(origin), JSON.stringify(value)); } catch { /* Diagnostics never block play. */ }
		return value;
	}
	return { read, update };
}

// Only known fixed API routes may appear in a report. No query strings, arbitrary paths, or payloads.
const ROUTES = new Set(["/api/installations/enroll", "/api/authenticate", "/api/banishment/returns/acknowledge", "/api/banishment/returns/claim", "/api/campaign/claim", "/api/campaign/contribute", "/api/campaign/info", "/api/charity/contents", "/api/charity/donate", "/api/charity/take", "/api/chat/block", "/api/chat/conversations", "/api/chat/conversations/delete", "/api/chat/conversations/start", "/api/chat/guild-participation", "/api/chat/messages", "/api/chat/messages/delete", "/api/chat/messages/send", "/api/chat/privacy", "/api/chat/state", "/api/client/active-mods/visibility", "/api/client/equipment/sync", "/api/client/equipment/visibility", "/api/client/game-mode/visibility", "/api/client/gp/visibility", "/api/client/icon-catalog/check", "/api/client/icon-catalog/upload", "/api/client/set_display_name", "/api/client/set_icon", "/api/client/status/sync", "/api/client/status/visibility", "/api/economy/receipts/acknowledge", "/api/events", "/api/friends/accept", "/api/friends/add", "/api/friends/get", "/api/friends/ignore", "/api/friends/remove", "/api/gift/accept", "/api/gift/decline", "/api/gift/discard", "/api/gift/send", "/api/guilds/active-mods", "/api/guilds/activity", "/api/guilds/application/decide", "/api/guilds/apply", "/api/guilds/council", "/api/guilds/create", "/api/guilds/equipment", "/api/guilds/join", "/api/guilds/join-free", "/api/guilds/leave", "/api/guilds/list", "/api/guilds/members", "/api/guilds/members/shadowed", "/api/guilds/petitions/raise", "/api/guilds/petitions/vote", "/api/guilds/petitions/withdraw", "/api/guilds/state", "/api/guilds/status", "/api/guilds/withdraw", "/api/identities", "/api/identities/delete", "/api/identities/delete/cancel", "/api/market/buy", "/api/market/buy-order", "/api/market/cancel", "/api/market/catalog", "/api/market/destroy", "/api/market/fulfill", "/api/market/listings", "/api/market/payout", "/api/market/search", "/api/market/sell", "/api/raids/activate", "/api/raids/assaults/abandon", "/api/raids/assaults/reserve", "/api/raids/assaults/settle", "/api/raids/cache", "/api/raids/cache/acknowledge", "/api/raids/state", "/api/register", "/api/trade/accept", "/api/trade/cancel", "/api/trade/counter", "/api/trade/decline", "/api/trade/offer", "/api/trade/resolve", "/api/transfers/get_contents"]);
export function diagnostic_route(url) {
	try {
		const path = new URL(url, 'https://diagnostic.invalid').pathname;
		return ROUTES.has(path) ? path : 'other';
	} catch { return 'other'; }
}
export function create_transport_diagnostics(now = Date.now) {
	const entries = [];
	function record(entry) {
		entries.push({ at: new Date(now()).toISOString(), route: diagnostic_route(entry.route),
			method: entry.method === 'GET' ? 'GET' : 'POST',
			session_state: entry.session_state === 'replaced' ? 'replaced' : null,
			status: Number.isInteger(entry.status) && entry.status >= 100 && entry.status <= 599 ? entry.status : null,
			duration_ms: Math.max(0, Math.min(60000, Math.round(entry.duration_ms) || 0)),
			outcome: ['ok', 'http_error', 'timeout', 'network_error', 'response_error'].includes(entry.outcome) ? entry.outcome : 'network_error' });
		if (entries.length > 50) entries.shift();
	}
	function report({ device, mod_version, connected, backend_version }) {
		return JSON.stringify({ format: 1, generated_at: new Date(now()).toISOString(),
			mod_version: typeof mod_version === 'string' && /^[0-9A-Za-z.-]{1,64}$/.test(mod_version) ? mod_version : 'development',
			connected: connected === true,
			backend_version: Number.isSafeInteger(backend_version) && backend_version > 0 ? backend_version : null,
			device: { installation_id: UUID.test(device?.installation_id) ? device.installation_id : null,
				platform: ['android', 'ios', 'steam', 'epic', 'browser', 'unknown'].includes(device?.platform) ? device.platform : 'unknown',
				engine: ['gecko', 'chromium', 'webkit', 'unknown'].includes(device?.engine) ? device.engine : 'unknown',
				...sanitize_app_details(device), details_source: 'player_reported' },
			requests: entries.map(entry => ({ ...entry })) }, null, 2);
	}
	return { record, report };
}

export function install_diagnostics_settings(ctx, { t, get_device, get_report, save_details }) {
	// A custom setting deliberately serializes no device data into Melvor's character save.
	ctx.settings.type('connection-diagnostics', {
		get: () => null, set: () => {},
		render() {
			const root = document.createElement('div');
			const open = document.createElement('button');
			open.type = 'button'; open.className = 'btn btn-primary'; open.textContent = t('OPEN');
			root.append(open);
			const panel = document.createElement('div'); panel.hidden = true; root.append(panel);
			open.addEventListener('click', () => {
				panel.replaceChildren(); panel.hidden = false;
				const hint = document.createElement('p'); hint.textContent = t('HINT'); panel.append(hint);
				const details = sanitize_app_details(get_device());
				const inputs = {};
				for (const [name, choices] of [['distribution', DISTRIBUTIONS], ['app_channel', CHANNELS], ['app_version', null], ['app_build', null]]) {
					const label = document.createElement('label'); label.className = 'd-block mt-2'; label.textContent = t(name.toUpperCase());
					const input = document.createElement(choices ? 'select' : 'input'); input.className = 'form-control';
					if (choices) for (const value of choices) {
						const option = document.createElement('option'); option.value = value; option.textContent = t(value.toUpperCase()); input.append(option);
					} else { input.type = 'text'; input.maxLength = 32; input.placeholder = t('UNKNOWN'); }
					input.value = details[name] ?? ''; inputs[name] = input; label.append(input); panel.append(label);
				}
				const save = document.createElement('button'); save.type = 'button'; save.className = 'btn btn-primary mt-2'; save.textContent = t('SAVE'); panel.append(save);
				const output = document.createElement('textarea'); output.readOnly = true; output.rows = 12; output.className = 'form-control mt-2';
				output.setAttribute('aria-label', t('REPORT')); output.value = get_report(); panel.append(output);
				const notice = document.createElement('p'); notice.setAttribute('role', 'status'); panel.append(notice);
				save.addEventListener('click', () => {
					const details = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]));
					if (['app_version', 'app_build'].some(key => details[key] !== '' && !VERSION.test(details[key]))) { notice.textContent = t('INVALID_VERSION'); return; }
					save_details(details); output.value = get_report(); notice.textContent = t('SAVED');
				});
				const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn btn-secondary mt-2'; copy.textContent = t('COPY'); panel.append(copy);
				copy.addEventListener('click', async () => {
					output.value = get_report();
					try { if (!navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText(output.value); notice.textContent = t('COPIED'); }
					catch { output.focus(); output.select(); notice.textContent = t('COPY_MANUALLY'); }
				});
			});
			return root;
		}
	});
	ctx.settings.section(t('SECTION')).add({ type: 'connection-diagnostics', name: 'connection-diagnostics', default: null });
}
