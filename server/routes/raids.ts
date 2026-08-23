import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';
import type { RaidOutcome } from '../raid';

const { abandon_assault, acknowledge_victory_cache, activate_raid, get_raid_state, get_victory_cache, reserve_assault, session_get_route, session_post_route, settle_assault } = runtime;

export function register_raids_routes(): void {
	session_get_route('/api/raids/state', async (req, url, client_id) => get_raid_state(client_id) as HandlerResult);

	session_post_route('/api/raids/activate', async (req, url, client_id) => activate_raid(client_id) as HandlerResult);

	session_post_route('/api/raids/assaults/reserve', async (req, url, client_id, json) => {
		const result = reserve_assault(client_id, Number(json.tier), json.loaded_session_id as string);
		if (result === undefined)
			return 500;
		return ('status' in result ? result.status : result) as HandlerResult;
	});

	session_post_route('/api/raids/assaults/abandon', async (req, url, client_id) => {
		const result = abandon_assault(client_id);
		if ('error_lang' in result)
			return { error_lang: result.error_lang } as HandlerResult;
		return { success: true, abandoned: result.abandoned } as HandlerResult;
	});

	session_post_route('/api/raids/assaults/settle', async (req, url, client_id, json) => {
		const result = settle_assault(
			client_id,
			json.assault_id as string,
			json.settlement_key as string,
			json.outcome as RaidOutcome,
			Number(json.occurred_at)
		);
		if (result === undefined)
			return 500;
		return ('status' in result ? result.status : result) as HandlerResult;
	});

	session_get_route('/api/raids/cache', async (req, url, client_id) => get_victory_cache(client_id) as HandlerResult);

	session_post_route('/api/raids/cache/acknowledge', async (req, url, client_id, json) => {
		const result = acknowledge_victory_cache(client_id, json.cache_id as string);
		if (result === undefined)
			return 500;
		return ('status' in result ? result.status : result) as HandlerResult;
	});
}
