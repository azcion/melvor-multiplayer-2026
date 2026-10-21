// One transient, origin-scoped outage notice. Never replay user mutations here.
export function create_service_availability({ probe, changed, now = Date.now,
	schedule = setTimeout, cancel = clearTimeout, random = Math.random }) {
	let status = null, revision = 0, timer = null, failures = 0, retry_at = 0;
	function arm() {
		if (!status || timer !== null) return;
		const expected = revision;
		timer = schedule(async () => {
			timer = null;
			try {
				if (await probe() && expected === revision) {
					status = null; failures = 0; revision++;
					changed('resolved');
					return;
				}
			} catch { /* A failed probe keeps the same notice and schedules another check. */ }
			if (expected !== revision) return;
			failures++;
			retry_at = now() + (status === 'maintenance' ? 300_000 : Math.min(30_000, 2000 * 2 ** Math.min(failures, 4)));
			arm();
		}, Math.max(1, retry_at - now()) + Math.floor(random() * 200));
	}
	return {
		active: () => status !== null,
		ticket: () => revision,
		fail(kind, retry_after = null, ticket = revision) {
			if (ticket !== revision) return;
			const next = kind === 'maintenance' ? 'maintenance' : kind === 'unreachable' ? 'unreachable' : 'unavailable';
			const seconds = retry_after === null ? NaN : Number(retry_after);
			const date_delay = Date.parse(retry_after) - now();
			const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : date_delay;
			retry_at = now() + Math.max(1000, Number.isFinite(delay) ? Math.min(delay, 86400_000) : next === 'maintenance' ? 300_000 : 2000);
			const different = status !== next;
			failures = different ? 0 : Math.min(failures + 1, 4);
			if (!Number.isFinite(delay) && next !== 'maintenance')
				retry_at = now() + Math.min(30_000, 2000 * 2 ** failures);
			status = next; revision++;
			if (timer !== null) cancel(timer);
			timer = null;
			if (different) changed(status);
			arm();
		},
		reset() {
			revision++; status = null; failures = 0;
			if (timer !== null) cancel(timer);
			timer = null;
		}
	};
}

export function service_conversation(kind, translate, previous = null, now = Date.now()) {
	const content = translate('MOD_MP_SERVICE_' + kind.toUpperCase());
	const created_at = previous?.latest_message?.content === content ? previous.created_at : now;
	const message = { message_id: -2, conversation_id: -2, sender_id: null,
		sender: { display_name: translate('MOD_MP_CHAT_CATEGORY_SUPPORT'), icon_id: 'multiplayer' },
		content, created_at, author_side: 'team', sent_by_viewer: false };
	return { conversation_kind: 'support', conversation_id: -2, support_team_id: -2,
		synthetic_service: true, service_status: kind, viewer_side: 'player',
		participant: { client_id: null, display_name: translate('MOD_MP_SERVICE_TITLE'), icon_id: 'multiplayer' },
		created_at, latest_message: message, unread_count: kind === 'resolved' ? 0 : 1, blocked: false };
}
