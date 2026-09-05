export const EVENT_ACTIVE_INTERVAL = 20 * 1000;
export const EVENT_WARMUP_STEP_INTERVAL = 20 * 1000;
export const EVENT_MAX_INTERVAL = 3 * 60 * 1000;
export const EVENT_WARMUP_CHECK_GROUP = 4;
export const CHAT_INTERVAL = 5 * 1000;
export const RETRY_INITIAL_INTERVAL = 2 * 1000;
export const RETRY_MAX_INTERVAL = 30 * 1000;
export const API_REQUEST_TIMEOUT = 15 * 1000;
export const JITTER_RATIO = 0.1;

export function jittered_delay(base_delay, random = Math.random) {
	const offset = (random() * 2 - 1) * JITTER_RATIO;
	return Math.max(1, Math.round(base_delay * (1 + offset)));
}

export function has_pending_events(events) {
	if (!events || events.unchanged === true)
		return false;
	return (events.friend_requests?.length ?? 0) > 0 ||
		(events.guild_applicants?.length ?? 0) > 0 ||
		(events.gifts?.length ?? 0) > 0 ||
		(events.trades?.length ?? 0) > 0 ||
		(events.resolved_trades?.length ?? 0) > 0 ||
		(events.economy_receipts?.length ?? 0) > 0 ||
		(events.market_completed?.length ?? 0) > 0 ||
		(events.haggle_pending ?? 0) > 0 ||
		events.banishment_return_pending === true ||
		events.inbox_pending === true ||
		(events.chat_unread ?? 0) > 0;
}

export function ramped_poll_interval(successful_checks) {
	const checks = Number.isSafeInteger(successful_checks) && successful_checks > 0 ? successful_checks : 0;
	const group = Math.floor(checks / EVENT_WARMUP_CHECK_GROUP);
	return Math.min(EVENT_WARMUP_STEP_INTERVAL * (group + 1), EVENT_MAX_INTERVAL);
}

export function event_poll_delay(has_pending, successful_checks = 0, random = Math.random) {
	if (typeof successful_checks === 'function') {
		random = successful_checks;
		successful_checks = 0;
	}
	return jittered_delay(has_pending ? EVENT_ACTIVE_INTERVAL : ramped_poll_interval(successful_checks), random);
}

export function chat_poll_delay(random = Math.random) {
	return jittered_delay(CHAT_INTERVAL, random);
}

export function retry_poll_delay(consecutive_failures, random = Math.random) {
	const exponent = Math.max(0, Math.min(4, consecutive_failures - 1));
	return jittered_delay(
		Math.min(RETRY_INITIAL_INTERVAL * (2 ** exponent), RETRY_MAX_INTERVAL),
		random
	);
}

export async function fetch_with_timeout(fetch_impl, url, options = {}, request = {}) {
	const timeout = request.timeout ?? API_REQUEST_TIMEOUT;
	const consume = request.consume ?? (response => response);
	const controller = new AbortController();
	const timeout_id = setTimeout(() => controller.abort(), timeout);
	const started_at = Date.now();
	let response_status = null;
	let session_state = null;
	const observe = outcome => {
		try { request.observe?.({ route: url, method: options.method, status: response_status,
			duration_ms: Date.now() - started_at, outcome, session_state }); } catch { /* Diagnostics cannot break requests. */ }
	};
	try {
		const response = await fetch_impl(url, { ...options, signal: controller.signal });
		response_status = response.status;
		session_state = response.headers?.get?.('X-Multiplayer-Session-State') === 'replaced' ? 'replaced' : null;
		const result = await consume(response);
		observe(response.status >= 400 ? 'http_error' : 'ok');
		return result;
	} catch (error) {
		observe(controller.signal.aborted ? 'timeout' : response_status === null ? 'network_error' : 'response_error');
		throw error;
	} finally {
		clearTimeout(timeout_id);
	}
}

export function is_foreground(document) {
	return document.visibilityState !== 'hidden';
}
