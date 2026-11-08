// Login tokens live only in the active request's closure, never in reactive or durable state.
export function create_account_recovery({ state, scope, read_login, post, reconnect, translate }) {
	let generation = 0;
	const reset = () => {
		state.account_recovery_consent = false;
		state.account_recovery_busy = false;
		state.account_recovery_candidates = [];
		state.account_recovery_selected = null;
		state.account_recovery_loaded = false;
		state.account_recovery_message = '';
	};
	return {
		open(enrolling) { generation++; reset(); state.account_recovery_enrolling = enrolling; },
		close() { generation++; reset(); },
		async run(action, client_id) {
			if (state.account_recovery_busy || (action !== 'disable' && !state.account_recovery_consent)) return;
			if (action === 'connect' && !state.account_recovery_candidates.some(candidate => candidate.client_id === client_id)) return;
			if ((action === 'enroll' || action === 'disable') !== state.account_recovery_enrolling) return;
			const current_generation = generation, current_scope = scope();
			const current = () => generation === current_generation && scope() === current_scope;
			state.account_recovery_busy = true;
			state.account_recovery_message = '';
			try {
				const login = action === 'disable' ? {} : read_login();
				if (!login || (action !== 'disable' && !login.melvor_token)) throw Error('login');
				const result = await post('/api/identity-recovery/' + action, { ...login, ...(client_id ? { client_id } : {}) });
				if (!current()) return;
				if (result.response?.status !== 200) throw Error('verification');
				if (action === 'list') {
					if (!Array.isArray(result.json?.identities)) throw Error('response');
					state.account_recovery_candidates = result.json.identities;
					state.account_recovery_selected = null;
					state.account_recovery_loaded = true;
				} else if (action === 'connect') {
					state.account_recovery_busy = false;
					await reconnect(result.json?.credentials);
				} else {
					state.account_recovery_message = translate(action === 'enroll' ? 'MOD_MP_ACCOUNT_RECOVERY_ENABLED' : 'MOD_MP_ACCOUNT_RECOVERY_DISABLED');
				}
			} catch {
				if (current()) state.account_recovery_message = translate('MOD_MP_ACCOUNT_RECOVERY_FAILED');
			} finally { if (generation === current_generation) state.account_recovery_busy = false; }
		}
	};
}
