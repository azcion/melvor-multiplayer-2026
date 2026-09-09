// A pending action owns its exact payload until a definitive failure or receipt acknowledgement.
// Storage is supplied by the character's selected server/identity namespace.
export function create_pending_economy_actions({ read, write, remove, post, reconcile, uuid, scope = () => null, can_start = () => true }) {
	const running = new Map();
	return {
		run(key, endpoint, payload) {
			const action_key = `${scope()}:${key}`;
			if (running.has(action_key))
				return running.get(action_key);
			const storage_key = `pending_economy_action:${key}`;
			const generation = scope();
			const execute = async () => {
				let pending = read(storage_key);
				if (pending === undefined) {
					if (!can_start()) return null;
					pending = JSON.parse(JSON.stringify({ endpoint, payload: { ...payload, command_id: uuid() } }));
					write(storage_key, pending);
					// Never send an action whose recovery record could not be saved.
					if (JSON.stringify(read(storage_key)) !== JSON.stringify(pending))
						return null;
				}
				if (pending?.endpoint !== endpoint || typeof pending?.payload?.command_id !== 'string')
					return null;
				const result = await post(pending.endpoint, pending.payload);
				if (scope() !== generation) return null;
				if (result?.success === true) {
					if (!await reconcile([result.receipt]))
						return null;
					if (scope() !== generation) return null;
					remove(storage_key);
				} else if (result?.success === false || typeof result?.error_lang === 'string') {
					if (scope() !== generation) return null;
					remove(storage_key);
				}
				return result;
			};
			// Start after publishing the lock, including synchronous storage/transport failures.
			const promise = Promise.resolve().then(execute).catch(() => null).finally(() => running.delete(action_key));
			running.set(action_key, promise);
			return promise;
		}
	};
}
