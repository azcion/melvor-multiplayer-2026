const transient_rollback_failure = result => ['economy_review_pending','economy_upgrade_required'].includes(result?.error);
const retired_rollback_command = result => result?.error === 'economy_command_retired' && result.receipt === null && typeof result.retired_command_id === 'string' ? result.retired_command_id : null;
// One unresolved outgoing command per identity. A timeout is not permission to spend again.
export function create_economy_command_journal({ read, write, remove, send, reconcile, current, can_submit, can_recover = _pending => true, is_retired = _id => false }) {
	let running = null;
	const failed = () => ({ response: null, json: null });
	function same_payload(a, b) {
		const without_id = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'command_id'));
		return JSON.stringify(without_id(a)) === JSON.stringify(without_id(b));
	}
	function retire(id) { if (current() && read()?.payload?.command_id === id) remove(); }
	const retired_result = id => ({ response: null, json: { success: false, error: 'economy_command_retired', retired_command_id: id, receipt: null } });
	async function dispatch(pending) {
		if (!current() || !can_recover(pending)) return failed();
		if (is_retired(pending.payload.command_id)) { retire(pending.payload.command_id); return retired_result(pending.payload.command_id); }
		const result = await send(pending.endpoint, pending.payload, pending.major);
		if (!current()) return failed();
		const retired_id = retired_rollback_command(result.json);
		if (retired_id !== null) {
			if (retired_id !== pending.payload.command_id) return failed();
			retire(retired_id); return result;
		}
		if (transient_rollback_failure(result.json)) return result;
		if (result.json?.success === true && (result.json.receipt === null || (pending.major === 1 && result.json.receipt === undefined)))
			retire(pending.payload.command_id); // Acknowledged replay has no effects, even after local processed-ID eviction.
		else if (result.json?.success === false || typeof result.json?.error_lang === 'string' ||
			[400, 403, 404, 409].includes(result.response?.status))
			retire(pending.payload.command_id);
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
				if (!can_recover(pending ?? {endpoint,payload,major})) return Promise.resolve(failed());
				// Event acknowledgement may retire a command while its HTTP response is still in flight.
				if (running && pending === undefined) return Promise.resolve(failed());
				if (pending !== undefined) {
					if (pending?.endpoint !== endpoint || !same_payload(pending.payload, payload))
						return Promise.resolve(failed());
				} else {
					if (!can_submit({endpoint,payload,major})) return Promise.resolve(failed());
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
		acknowledge: retire,
		retire,
		async recover() {
			let pending;
			try { pending = read(); } catch { return false; }
			if (pending === undefined || !current()) return true;
			if (is_retired(pending?.payload?.command_id)) { retire(pending.payload.command_id); return true; }
			if (!can_recover(pending)) return false;
			if (typeof pending?.endpoint !== 'string' || typeof pending.payload?.command_id !== 'string' ||
				![1, 2].includes(pending.major)) return Promise.resolve(false);
			if (pending.major === 1) {
				pending = { ...pending, major: 2 };
				try {
					write(pending);
					if (JSON.stringify(read()) !== JSON.stringify(pending)) return false;
				} catch { return false; }
			}
			return locked(() => dispatch(pending)).then(async result => {
				if (result.json?.success === true && await reconcile([result.json.receipt])) return true;
				return read() === undefined;
			}).catch(() => false);
		}
	};
}
