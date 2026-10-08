import type { SessionRequestHandler } from './app-runtime';
import type { JsonObject } from './http';

// Fixed read models only. Never accept a caller-supplied route or invoke session middleware twice.
export const PAGE_READS: Record<string, string[]> = {
	transfers: ['/api/inbox', '/api/market/haggles', ...['inbox', 'outbox', 'pending'].map(pane => `/api/transfers/history?pane=${pane}`)],
	guild: ['/api/guilds/state', '/api/alliances', '/api/guilds/council?page=0', '/api/guilds/members/shadowed?page=0&search=', '/api/guilds/activity', '/api/guilds/list'],
	decisions: ['/api/guilds/state', '/api/alliances', '/api/guilds/council?page=0']
};
const paths = new Set(Object.values(PAGE_READS).flat().map(route => route.split('?')[0]));
const readers = new Map<string, SessionRequestHandler>();
export function register_page_read(route: string, handler: SessionRequestHandler): void {
	if (paths.has(route)) readers.set(route, handler);
}
export async function read_page(page: string, req: Request, url: URL, client_id: number): Promise<JsonObject | null> {
	if (!Object.hasOwn(PAGE_READS, page)) return null;
	const data: JsonObject = {};
	// Keep maintenance/permission checks in the existing domain readers and execute in order.
	for (const route of PAGE_READS[page]!) {
		const state = data['/api/guilds/state'];
		const member = typeof state === 'object' && state !== null && 'affiliation' in state && state.affiliation === 'member';
		if (page !== 'transfers' && route !== '/api/guilds/state') {
			if (route === '/api/guilds/list' ? member : !member) continue;
		}
		const read = readers.get(route.split('?')[0]!);
		if (!read) throw new Error('Missing page reader');
		const result = await read(req, new URL(route, url), client_id, {});
		data[route] = result instanceof Response ? { status: result.status } : typeof result === 'number' ? { status: result } : result;
	}
	return data;
}
