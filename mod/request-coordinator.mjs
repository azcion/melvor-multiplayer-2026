// One budget for page reads, polling, commands and durable acknowledgements.
export function create_request_scheduler({ now = () => Date.now(), capacity = 16,
	refill_per_second = 0.9, read_reserve = 3, concurrency = 2 } = {}) {
	let tokens = capacity, updated_at = now(), cooldown_until = 0, active = 0, timer = null;
	const queue = [];
	function pump() {
		clearTimeout(timer);
		timer = null;
		const time = now();
		tokens = Math.min(capacity, tokens + Math.max(0, time - updated_at) * refill_per_second / 1000);
		updated_at = time;
		for (let i = queue.length - 1; i >= 0; i--)
			if (!queue[i].valid()) queue.splice(i, 1)[0].reject(new DOMException('Stale request', 'AbortError'));
		queue.sort((a, b) => b.priority - a.priority || a.order - b.order);
		while (queue.length && active < concurrency && time >= cooldown_until) {
			const next = queue[0];
			if (tokens < (next.priority > 0 ? 1 : read_reserve + 1)) break;
			queue.shift();
			tokens--;
			active++;
			Promise.resolve().then(next.run).then(next.resolve, next.reject).finally(() => { active--; pump(); });
		}
		if (queue.length && active < concurrency) {
			const required = queue[0].priority > 0 ? 1 : read_reserve + 1;
			const delay = Math.max(1, cooldown_until - time, (required - tokens) * 1000 / refill_per_second);
			timer = setTimeout(pump, Math.ceil(delay));
		}
	}
	let sequence = 0;
	return {
		run(priority, run, valid = () => true) {
			return new Promise((resolve, reject) => { queue.push({ priority, run, valid, resolve, reject, order: sequence++ }); pump(); });
		},
		observe(response) {
			if (response.status !== 429) return;
			const raw = response.headers.get('Retry-After');
			const seconds = raw === null ? NaN : Number(raw);
			const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(raw) - now();
			cooldown_until = Math.max(cooldown_until, now() + Math.max(1000, Number.isFinite(delay) ? delay : 2000) + 100 + Math.floor(Math.random() * 200));
			// A shared server bucket was exhausted; keep a conservative local budget on resume.
			tokens = 0; updated_at = now();
			pump();
		}
	};
}

export function create_read_cache({ scope, now = () => Date.now(), ttl = 15_000 }) {
	const values = new Map(), pending = new Map();
	let current_scope = scope();
	function check_scope() {
		if (scope() === current_scope) return;
		current_scope = scope(); values.clear();
		for (const entry of pending.values()) entry.invalidated = true;
		pending.clear();
	}
	const copy = value => structuredClone(value);
	return {
		read,
		prime(key, value) { check_scope(); values.set(key, { value: copy(value), at: now() }); },
		invalidate(predicate = () => true) {
			check_scope();
			for (const key of values.keys()) if (predicate(key)) values.delete(key);
			for (const [key, entry] of pending) if (predicate(key)) {
				entry.invalidated = true; pending.delete(key);
			}
		}
	};
	async function read(key, load, cache = true, retries = 2) {
		check_scope();
		const cached = values.get(key);
		if (cache && cached && now() - cached.at < ttl) return copy(cached.value);
		const request_scope = current_scope;
		if (pending.has(key)) {
			const entry = pending.get(key);
			const value = await entry.promise;
			return entry.invalidated && scope() === request_scope && retries > 0
				? read(key, load, cache, retries - 1) : copy(value);
		}
		const entry = { invalidated: false, promise: null };
		const valid = () => !entry.invalidated && scope() === request_scope;
		entry.promise = Promise.resolve().then(() => load(valid)).then(value => {
			if (!valid()) return null;
			if (cache && value !== null) values.set(key, { value: copy(value), at: now() });
			return value;
		}).finally(() => { if (pending.get(key) === entry) pending.delete(key); });
		pending.set(key, entry);
		const value = await entry.promise;
		// A newer revision can invalidate a queued or active read. Join its fresh
		// replacement instead of turning cancellation into a page-load failure.
		return entry.invalidated && scope() === request_scope && retries > 0
			? read(key, load, cache, retries - 1) : copy(value);
	}
}
