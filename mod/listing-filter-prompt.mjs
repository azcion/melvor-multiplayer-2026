// Wait for two idle startup ticks, then check the account again before opening.
export function create_listing_filter_prompt({ current, idle, pending, show, acknowledge,
	schedule = callback => setTimeout(callback, 1000), cancel = clearTimeout }) {
	let stopped = false;
	let timer = null;
	let quiet = false;
	let opened = false;
	const active = () => !stopped && current();
	const later = callback => { if (active()) timer = schedule(callback); };
	async function mark_seen() {
		if (!active()) return;
		try { if (await acknowledge()) return; } catch { /* Retry while this session remains current. */ }
		later(mark_seen);
	}
	async function tick() {
		if (!active() || opened) return;
		if (!idle()) { quiet = false; later(tick); return; }
		if (!quiet) { quiet = true; later(tick); return; }
		try {
			const remaining = await pending();
			if (!active()) return;
			if (remaining === false) return;
			if (remaining === true && idle()) {
				const queued = show(() => {
					if (!active() || opened) return;
					opened = true;
					void mark_seen();
				});
				if (queued) return;
			}
		} catch { /* A failed status read must not consume the prompt. */ }
		quiet = false;
		later(tick);
	}
	later(tick);
	return { stop() { stopped = true; cancel(timer); } };
}
