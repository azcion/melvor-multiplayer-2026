// One unresolved outgoing command per identity. A timeout is not permission to spend again.
export function create_economy_command_journal({ read, write, remove, send, reconcile, current, can_submit }) {
	let running = null;
	const failed = () => ({ response: null, json: null });
	function same_payload(a, b) {
		const without_id = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'command_id'));
		return JSON.stringify(without_id(a)) === JSON.stringify(without_id(b));
	}
	async function dispatch(pending) {
		const result = await send(pending.endpoint, pending.payload, pending.major);
		if (!current()) return failed();
		if (result.json?.success === true && (result.json.receipt === null || (pending.major === 1 && result.json.receipt === undefined)))
			remove(); // Acknowledged replay has no effects, even after local processed-ID eviction.
		else if (result.json?.success === false || typeof result.json?.error_lang === 'string' ||
			[400, 403, 404, 409].includes(result.response?.status))
			remove();
		return result;
	}
	function locked(operation) {
		if (running) return running;
		running = Promise.resolve().then(operation).catch(failed).finally(() => { running = null; });
		return running;
	}
	return {
		run(endpoint, payload, major) {
			try {
				if (!current()) return Promise.resolve(failed());
				let pending = read();
				// Event acknowledgement may retire a command while its HTTP response is still in flight.
				if (running && pending === undefined) return Promise.resolve(failed());
				if (pending !== undefined) {
					if (pending?.endpoint !== endpoint || !same_payload(pending.payload, payload))
						return Promise.resolve(failed());
				} else {
					if (!can_submit()) return Promise.resolve(failed());
					pending = JSON.parse(JSON.stringify({ endpoint, payload, major }));
					write(pending);
					if (JSON.stringify(read()) !== JSON.stringify(pending)) return Promise.resolve(failed());
				}
				return locked(() => dispatch(pending));
			} catch { return Promise.resolve(failed()); }
		},
		has_pending() {
			try { return running !== null || read() !== undefined; } catch { return true; }
		},
		acknowledge(id) {
			if (current() && read()?.payload?.command_id === id) remove();
		},
		async recover() {
			let pending;
			try { pending = read(); } catch { return false; }
			if (pending === undefined || !current()) return true;
			if (typeof pending?.endpoint !== 'string' || typeof pending.payload?.command_id !== 'string' ||
				![1, 2].includes(pending.major)) return Promise.resolve(false);
			return locked(() => dispatch(pending)).then(async result => {
				if (result.json?.success === true && await reconcile([result.json.receipt])) return true;
				return read() === undefined;
			}).catch(() => false);
		}
	};
}
