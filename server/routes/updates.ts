import * as runtime from '../app-runtime';
import { get_updates } from '../updates';

const { allow_browser_access, db, get_client_session, require_service_available, require_source_capacity, server } = runtime;

export function register_updates_routes(): void {
	server.route(
		'/api/updates',
		allow_browser_access(require_source_capacity(require_service_available(async req => {
			const session = await get_client_session(req.headers.get('X-Session-Token'));
			const language = session === null ? null : db.query<{ language: string | null }, [number]>(
				'SELECT `language` FROM `client_runtime_snapshots` WHERE `client_id` = ?'
			).get(session.client_id)?.language ?? null;
			return get_updates(language);
		}))),
		['GET', 'OPTIONS']
	);
}
