import { db } from '../db';
import { is_admin } from '../admin_identity';
import * as runtime from '../app-runtime';

const { add_poll_options, chat_translation_worker, create_poll, delete_poll, get_request_mod_version, has_polls_capability, list_polls, session_get_route, session_post_route,
	set_poll_open, set_poll_vote } = runtime;

function result_response(result: ReturnType<typeof list_polls>) {
	if (result.status === 'ok') return result.value;
	if (result.status === 'forbidden') return 403;
	if (result.status === 'missing') return 404;
	if (result.status === 'throttled') return { success: false, retry_after_ms: result.retry_after_ms };
	return 400;
}

export function register_poll_routes(): void {
	session_get_route('/api/polls', async (req, url, client_id) => {
		if (!has_polls_capability(url)) return 404;
		const after = url.searchParams.get('after');
		return result_response(list_polls(client_id, get_request_mod_version(req), after === null ? null : Number(after)));
	});
	session_get_route('/api/polls/responses', async (req, url, client_id) => {
		if (!is_admin(client_id)) return 403;
		if (!has_polls_capability(url) || !runtime.can_view_polls(get_request_mod_version(req))) return 404;
		const poll_id = Number(url.searchParams.get('poll_id'));
		if (!Number.isSafeInteger(poll_id) || poll_id < 1) return 400;
		if (!db.query('SELECT id FROM polls WHERE id = ?').get(poll_id)) return 404;
		const options = db.query<{ option_id: number; content: string }, [number]>(
			'SELECT id AS option_id, content FROM poll_options WHERE poll_id = ? ORDER BY id').all(poll_id);
		const votes = db.query<{ option_id: number; client_id: number; display_name: string; icon_id: string }, [number]>(
			`SELECT vote.option_id, client.id AS client_id, client.display_name, client.icon_id FROM poll_votes vote
			JOIN clients client ON client.id = vote.client_id WHERE vote.poll_id = ? ORDER BY vote.created_at, client.id`).all(poll_id);
		return { options: options.map(option => ({ ...option, characters: votes.filter(vote => vote.option_id === option.option_id) })) };
	});
	session_post_route('/api/polls/create', async (req, url, client_id, json) => {
		if (!has_polls_capability(url)) return 404;
		if (typeof json.idempotency_key !== 'string' || typeof json.content !== 'string' || !Array.isArray(json.options)) return 400;
		const result = create_poll(client_id, get_request_mod_version(req), json.idempotency_key as string, json.content as string, json.options, json.choice_mode ?? 'multi');
		if (result.status === 'ok') chat_translation_worker.wake();
		return result.status === 'ok' ? { success: true, ...result.value } : result_response(result as never);
	});
	session_post_route('/api/polls/options', async (req, url, client_id, json) => {
		if (!has_polls_capability(url)) return 404;
		if (typeof json.poll_id !== 'number' || !Array.isArray(json.options)) return 400;
		const result = add_poll_options(client_id, get_request_mod_version(req), json.poll_id as number, json.options);
		if (result.status === 'ok') chat_translation_worker.wake();
		return result.status === 'ok' ? { success: true, ...result.value } : result_response(result as never);
	});
	session_post_route('/api/polls/delete', async (req, url, client_id, json) => {
		if (!has_polls_capability(url)) return 404;
		if (typeof json.poll_id !== 'number') return 400;
		const result = delete_poll(client_id, get_request_mod_version(req), json.poll_id as number);
		return result.status === 'ok' ? { success: true, ...result.value } : result_response(result as never);
	});
	session_post_route('/api/polls/vote', async (req, url, client_id, json) => {
		if (!has_polls_capability(url)) return 404;
		if (typeof json.poll_id !== 'number' || typeof json.option_id !== 'number' || typeof json.selected !== 'boolean') return 400;
		const result = set_poll_vote(client_id, get_request_mod_version(req), json.poll_id as number, json.option_id as number, json.selected as boolean);
		return result.status === 'ok' ? { success: true, ...result.value } : result_response(result as never);
	});
	session_post_route('/api/polls/status', async (req, url, client_id, json) => {
		if (!has_polls_capability(url)) return 404;
		if (typeof json.poll_id !== 'number' || typeof json.open !== 'boolean') return 400;
		const result = set_poll_open(client_id, get_request_mod_version(req), json.poll_id as number, json.open as boolean);
		return result.status === 'ok' ? { success: true, ...result.value } : result_response(result as never);
	});
}
