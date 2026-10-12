const transient_rollback_failure = result => ['economy_review_pending','economy_upgrade_required'].includes(result?.error);
const retired_rollback_command = result => result?.error === 'economy_command_retired' && result.receipt === null && typeof result.retired_command_id === 'string' ? result.retired_command_id : null;
// A pending action owns its exact payload until a definitive failure or receipt acknowledgement.
// Storage is supplied by the character's selected server/identity namespace.
export function create_pending_economy_actions({ read, write, remove, post, reconcile, uuid, scope = () => null, can_start = () => true, is_retired = _id => false, can_recover = _pending => true }) {
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
				if (is_retired(pending.payload.command_id)) {
					remove(storage_key);
					return { success:false,error:'economy_command_retired',retired_command_id:pending.payload.command_id,receipt:null };
				}
				if (!can_recover(pending)) return null;
				const result = await post(pending.endpoint, pending.payload);
				if (scope() !== generation) return null;
				if (transient_rollback_failure(result)) return result;
				const retired_id = retired_rollback_command(result);
				if (retired_id !== null) {
					if (retired_id !== pending.payload.command_id) return null;
					remove(storage_key); return result;
				}
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
