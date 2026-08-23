import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';

const { AUTH_RESPONSE_DELAY_MS, BACKEND_VERSION, DEFAULT_USER_ICON_ID, allow_browser_access, associate_client_with_melvor_account, cancel_deletion_on_authentication, db_get_single, execute_due_client_deletions, generate_friend_code, generate_session_token, get_chat_state, get_released_mod_version, identify_request, is_valid_uuid, log, parse_client_runtime, parse_melvor_account, persist_client_runtime, recover_deleted_client, register_client, require_registration_capacity, require_service_available, require_source_capacity, server, temporary_unavailable, validate_display_name, validate_json_request } = runtime;

export function register_auth_routes(): void {
	server.route('/health', require_source_capacity(() => ({ status: 'ok', backend_version: BACKEND_VERSION })));

	server.route('/api/authenticate', allow_browser_access(require_source_capacity(require_service_available(validate_json_request(async (req, url, json) => {
		await Bun.sleep(AUTH_RESPONSE_DELAY_MS);
		execute_due_client_deletions();

		const client_identifier = json.client_identifier;
		const client_key = json.client_key;

		if (typeof client_identifier !== 'string' || typeof client_key !== 'string')
			return 400; // Bad Request

		if (!is_valid_uuid(client_identifier) || !is_valid_uuid(client_key))
			return 400; // Bad Request
		const melvor_account = parse_melvor_account(json);
		if (melvor_account === undefined)
			return 400; // Bad Request
		const client_runtime = parse_client_runtime(json.client_runtime);
		if (client_runtime === null)
			return 400; // Bad Request

		const client_row = await db_get_single(
			'SELECT `id`, `client_key`, `friend_code`, `display_name`, `icon_id`, `disabled`, `equipment_visible`, `status_visible`, `gp_visible`, `game_mode_visible`, `active_mods_visible`, ' +
			'`messaging_enabled`, `melvor_account_id`, `deleted_at` ' +
			'FROM `clients` WHERE `client_identifier` = ? LIMIT 1',
			[client_identifier]
		) as db_row.clients;
		if (client_row === null || client_row.client_key !== client_key)
			return 401; // Unauthorized
		if (client_row.disabled === 1)
			return 403; // Forbidden
		const association = associate_client_with_melvor_account(
			client_row.id,
			client_row.melvor_account_id,
			melvor_account
		);
		if (association === 'mismatch')
			return Response.json({ identity_status: 'melvor_account_mismatch' }, { status: 409 });
		if (association === 'required')
			return Response.json({ identity_status: 'melvor_account_required' }, { status: 409 });
		const deletion_cancelled = cancel_deletion_on_authentication(client_row.id);
		const identity_recovered = recover_deleted_client(client_row.id);
		persist_client_runtime(client_row.id, client_runtime);

		identify_request(req, client_row.id, client_runtime?.mod_version);
		const session_token = await generate_session_token(client_row.id, client_runtime?.mod_version ?? null);
		log('client', 'authorized client session for identity {%d}', client_row.id);

		return { session_token, friend_code: client_row.friend_code, display_name: client_row.display_name,
			icon_id: client_row.icon_id, equipment_visible: client_row.equipment_visible === 1,
			status_visible: client_row.status_visible === 1, gp_visible: client_row.gp_visible === 1,
			game_mode_visible: client_row.game_mode_visible === 1,
			active_mods_visible: client_row.active_mods_visible === 1,
			chat: get_chat_state(client_row.id),
			released_mod_version: get_released_mod_version(),
			deletion_cancelled, identity_recovered };
	})))), ['POST', 'OPTIONS']);

	server.route('/api/register', allow_browser_access(require_source_capacity(require_registration_capacity(require_service_available(validate_json_request(async (req, url, json) => {
		await Bun.sleep(AUTH_RESPONSE_DELAY_MS);

		const client_key = json.client_key;

		if (typeof client_key !== 'string' || !is_valid_uuid(client_key))
			return 400; // Bad Request
		const melvor_account = parse_melvor_account(json);
		if (melvor_account === undefined)
			return 400; // Bad Request
		const client_runtime = parse_client_runtime(json.client_runtime);
		if (client_runtime === null)
			return 400; // Bad Request
		const friend_code = await generate_friend_code();
		const display_name = validate_display_name(json.display_name);

		const client_identifier = crypto.randomUUID();
		const registration = register_client(
			client_identifier,
			client_key,
			friend_code,
			display_name,
			DEFAULT_USER_ICON_ID,
			melvor_account
		);

		if (registration.status !== 'created')
			return temporary_unavailable();

		const client_id = registration.client_id;
		persist_client_runtime(client_id, client_runtime);
		identify_request(req, client_id, client_runtime?.mod_version);
		log('client', 'registered new identity {%d}', client_id);

		const session_token = await generate_session_token(client_id, client_runtime?.mod_version ?? null);
		return { session_token, client_identifier, friend_code, display_name, icon_id: DEFAULT_USER_ICON_ID,
			equipment_visible: true, status_visible: true, gp_visible: true, game_mode_visible: true,
			active_mods_visible: true,
			chat: get_chat_state(client_id),
			released_mod_version: get_released_mod_version() };
	}))))), ['POST', 'OPTIONS']);
}
