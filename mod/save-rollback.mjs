export const ROLLBACK_CAPABILITY = 'save-rollback-v1';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0;

// Construct inside the scheduler's dispatched operation, immediately around fetch.
export function create_handshake_timer(fetch_impl, { now = Date.now, monotonic = () => performance.now() } = {}) {
	let timing = null;
	return {
		async fetch(...args) {
			const sent = now(), started = monotonic();
			const response = await fetch_impl(...args);
			timing = { client_sent_at: sent, client_received_at: now(), elapsed_ms: Math.round(monotonic() - started) };
			return response;
		},
		snapshot: () => timing && { ...timing }
	};
}
export function valid_rollback_status(status) {
	return status?.protocol === ROLLBACK_CAPABILITY && ['waiting','review','ready','released'].includes(status.admission) &&
		typeof status.economy_review_pending === 'boolean' && typeof status.upgrade_required === 'boolean' &&
		Array.isArray(status.retired_command_ids) && status.retired_command_ids.length <= 64 && status.retired_command_ids.every(uuid) &&
		(status.notice === null || (status.notice?.kind === 'older_save' && uuid(status.notice.notice_id)));
}
export const transient_rollback_failure = result => ['economy_review_pending','economy_upgrade_required'].includes(result?.error);
export const retired_rollback_command = result => result?.error === 'economy_command_retired' && result.receipt === null && uuid(result.retired_command_id)
	? result.retired_command_id : null;

export function create_rollback_client({ supported, origin, client_id, load_id, handshake_generation, current,
	read, write, keys = () => [], remove = () => {}, post, retire = () => {}, changed = () => {}, ui_ready = () => false, queue, close,
	text = key => key }) {
	let enabled = supported, initialized = !supported, safe = !supported, needs_full = true;
	let status = null, clock_sample = null, clock_running = null, clock_recorded = false;
	let notice_queued = null, ack_running = false;
	const shown_notices = new Set();
	const retired_key = `retired_economy_commands:${client_id}`;
	const remembered = read(retired_key);
	const retired = new Set(Array.isArray(remembered) ? remembered.filter(uuid) : []);
	const valid = () => current();
	const admitted = () => valid() && initialized && safe;
	function retire_ids(ids) {
		for (const id of ids) { retired.add(id); retire(id); }
		if (ids.length) write(retired_key, [...retired].slice(-256));
	}
	function consume(next) {
		if (!valid()) return false;
		if (next?.protocol === ROLLBACK_CAPABILITY) enabled = true;
		if (!enabled) return true;
		const before = safe;
		status = valid_rollback_status(next) ? next : null;
		safe = status !== null && ['ready','released'].includes(status.admission) &&
			!status.economy_review_pending && !status.upgrade_required;
		if (safe !== before || !safe) needs_full = true;
		if (status) retire_ids(status.retired_command_ids);
		if (!safe || safe !== before) changed();
		void pump_notice();
		return safe;
	}
	async function acknowledge_notice(id) {
		if (ack_running || !valid()) return;
		ack_running = true;
		try {
			const result = await post('/api/save-rollback/notice/acknowledge', { notice_id: id });
			if (!valid() || result?.response?.status !== 200 || result.json?.success !== true) return;
			const next = await post(null); // Owner status fetch also advances to the next pending notice.
			if (valid() && next) consume(next);
		} finally { ack_running = false; }
	}
	function persist_notice_delivery(id, key) {
		try {
			if (read(key) === true) return true;
			if (!shown_notices.has(id)) return false;
			write(key, true);
			return read(key) === true;
		} catch { return false; }
	}
	async function pump_notice() {
		if (!valid() || !ui_ready() || !status?.notice) return;
		const id = status.notice.notice_id, delivered_key = `rollback_notice_delivered:${client_id}:${id}`;
		if (persist_notice_delivery(id, delivered_key)) { await acknowledge_notice(id); return; }
		if (shown_notices.has(id) || notice_queued !== null) return;
		notice_queued = id;
		try {
			queue({ title: text('MOD_MP_OLDER_SAVE_TITLE'), text: text('MOD_MP_OLDER_SAVE_MESSAGE'), icon: 'info',
				timer:0,timerProgressBar:false,showConfirmButton:true,showCloseButton:false,
				allowOutsideClick:false,allowEscapeKey:false,
				willOpen() { if (!valid()) close(); },
				didOpen() {
					if (!valid()) { close(); return; }
					shown_notices.add(id);
					if (persist_notice_delivery(id, delivered_key)) void acknowledge_notice(id);
				},
				didClose() { notice_queued = null; if (valid()) void pump_notice(); }
			});
		} catch { notice_queued = null; }
	}
	function bind_clock(response, timing) {
		if (!valid()) return;
		const sample = response.rollback_clock_sample;
		if (!sample || !uuid(load_id) || sample.load_id !== load_id || !time(sample.server_admitted_at)) return;
		const key = `rollback_clock:${client_id}:${load_id}`;
		const stored = read(key);
		const matches = value => value?.origin === origin && value.client_id === client_id && value.load_id === load_id &&
			value.server_admitted_at === sample.server_admitted_at &&
			[value.client_sent_at,value.client_received_at,value.elapsed_ms].every(time) &&
			value.client_received_at >= value.client_sent_at && value.elapsed_ms <= 30000 &&
			Math.abs(value.client_received_at-value.client_sent_at-value.elapsed_ms) <= 50;
		// Only this running load can reconnect using its original timing. Historical
		// evidence belongs on the server; retaining every load fills Melvor's save quota.
		const prune_previous_loads = () => {
			const prefix = `rollback_clock:${client_id}:`;
			for (const old_key of keys()) {
				if (!old_key.startsWith(prefix) || old_key === key) continue;
				const old_load = old_key.slice(prefix.length), old = read(old_key);
				if (uuid(old_load) && old?.origin === origin && old.client_id === client_id && old.load_id === old_load)
					remove(old_key);
			}
		};
		if (matches(stored)) { prune_previous_loads(); clock_sample = stored; return; }
		if (sample.original_handshake !== true || timing?.origin !== origin || timing.generation !== handshake_generation || timing.load_id !== load_id) return;
		const original = { ...timing, origin, client_id, load_id, server_admitted_at: sample.server_admitted_at };
		if (!matches(original)) return;
		prune_previous_loads(); // Make room before saving, including migration from a full quota.
		write(key, original);
		if (matches(read(key))) clock_sample = original;
	}
	async function calibrate() {
		if (!enabled || !valid() || !clock_sample || clock_recorded) return;
		if (clock_running) return clock_running;
		clock_running = (async () => {
			const result = await post('/api/save-load/clock', clock_sample);
			if (valid() && result?.response?.status === 200) { clock_recorded = true; consume(result.json?.rollback); }
		})().finally(() => { clock_running = null; });
		return clock_running;
	}
	return {
		async bootstrap(response, timing) {
			consume(response.rollback);
			if (enabled) {
				initialized = false;
				bind_clock(response, timing);
				await calibrate();
			}
			if (!valid()) return;
			initialized = true;
			needs_full = true;
			changed();
		},
		consume, calibrate, pump_notice,
		admitted,
		needs_full: () => needs_full,
		complete_snapshot(complete) { if (admitted() && complete) needs_full = false; return admitted() && !needs_full; },
		is_retired: id => retired.has(id),
		retire(id) { if (valid() && uuid(id)) retire_ids([id]); },
		block() { if (valid()) { enabled = true; safe = false; needs_full = true; changed(); } },
		allows_receipt: receipt => !retired.has(receipt?.id) && (admitted() || !receipt?.effects?.some(effect => effect.qty < 0))
	};
}

// Claims may recover an already-issued server snapshot; the server gates new issuance.
export function protected_rollback_recovery_route(path) {
 return ['/api/market/haggle/claim','/api/market/payout','/api/market/claim-legacy-payouts','/api/trade/resolve',
  '/api/inbox/claim','/api/banishment/returns/claim'].includes(path);
}
export function unsafe_rollback_client_request(path) {
 if (protected_rollback_recovery_route(path)) return false;
 return path.startsWith('/api/crucible/') || path.startsWith('/api/gift/') || path.startsWith('/api/trade/') ||
  path.startsWith('/api/social-mode/') || path.startsWith('/api/campaign/') || path.startsWith('/api/identities/delete') ||
  path.startsWith('/api/expedition/supply/') || path.startsWith('/api/expedition/debug/') ||
  (path.startsWith('/api/market/') && !['/api/market/search','/api/market/catalog'].includes(path)) ||
  ['/api/guilds/create','/api/guilds/join','/api/guilds/join-free','/api/guilds/application/decide','/api/guilds/leave'].includes(path) ||
  path.startsWith('/api/guilds/petitions/');
}

// Legacy records did not identify their Client. Keep uncertain work and block new Wish commands;
// migrating it to whichever identity happens to connect could create a second command.
export function retain_legacy_wish_commands({read,write,remove,origin}) {
 let review=false;
 for (const kind of ['make','cancel','claim']) {
  const key=`pending_crucible_wish:${kind}`, pending=read(key);
  if (pending===undefined) continue;
  if (!Number.isSafeInteger(pending?.client_id) || pending.client_id<1 ||
   (pending.origin!==undefined && pending.origin!==origin) || pending.endpoint!==`/api/crucible/wish/${kind}` || !uuid(pending.payload?.command_id)) { review=true;continue; }
  const scoped=`pending_crucible_wish:${pending.client_id}:${kind}`, existing=read(scoped);
  if (existing!==undefined && JSON.stringify(existing)!==JSON.stringify(pending)) {review=true;continue;}
  write(scoped,pending);
  if (JSON.stringify(read(scoped))===JSON.stringify(pending)) remove(key); else review=true;
 }
 return review;
}
