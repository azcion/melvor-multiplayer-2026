// Retain review markers across reloads: even a stale response must never reapply quarantined effects.
// The caller supplies storage and transport bound to one server, Client and session generation.
export function create_economy_receipt_reviews({ read, write, report, current = () => true }) {
	let running = null;
	const entries = () => {
		const value = read();
		return Array.isArray(value) ? value : [];
	};
	return {
		has(id) {
			return current() && typeof id === 'string' && entries().some(entry => entry.id === id);
		},
		defer(id, reason) {
			if (!current() || typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return false;
			try {
				const reviews = entries();
				if (!reviews.some(entry => entry.id === id)) write([...reviews, { id, reason, reported: false }]);
				return entries().some(entry => entry.id === id);
			} catch { return false; }
		},
		flush() {
			if (running) return running;
			running = Promise.resolve().then(async () => {
				for (const entry of entries().filter(entry => entry.reported !== true).slice(0, 64)) {
					if (!current()) return;
					const result = await report({ receipt_id: entry.id, reason: entry.reason });
					if (!current()) return;
					if (result?.success !== true) return;
					write(entries().map(value => value.id === entry.id ? { ...value, reported: true } : value));
				}
			}).catch(() => {}).finally(() => { running = null; });
			return running;
		}
	};
}
