import * as runtime from '../app-runtime';
import { get_updates } from '../updates';

const { allow_browser_access, require_service_available, require_source_capacity, server } = runtime;

export function register_updates_routes(): void {
	server.route(
		'/api/updates',
		allow_browser_access(require_source_capacity(require_service_available(() => get_updates()))),
		['GET', 'OPTIONS']
	);
}
