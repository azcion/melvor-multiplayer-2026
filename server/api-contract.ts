import { is_server_owned_pets_client } from './pet-compatibility';
import { create_http_server, get_request_mod_version, type JsonObject, type RequestHandler } from './http';

export type ApiMajor = 1 | 2;
export const API_VERSIONS: ApiMajor[] = [1, 2];
type RouteOptions = { versions?: ApiMajor[] };
type RouteContext = { api_major: ApiMajor; logical_path: string; explicit: boolean };
const contexts = new WeakMap<Request, RouteContext>();

export function api_context(req: Request): RouteContext {
	return contexts.get(req) ?? { api_major: 1, logical_path: new URL(req.url).pathname, explicit: false };
}

export function request_uses_server_owned_pets(req: Request, mod_version = get_request_mod_version(req)): boolean {
	return api_context(req).api_major === 2 || is_server_owned_pets_client(mod_version);
}

export const ECONOMY_COMMAND_KINDS: Readonly<Record<string, string>> = {
	'/api/campaign/claim': 'campaign-claim',
	'/api/campaign/contribute': 'campaign-contribute',
	'/api/charity/donate': 'charity-donate',
	'/api/charity/shuffle': 'charity-shuffle',
	'/api/charity/take': 'charity-take',
	'/api/gift/accept': 'gift-accept',
	'/api/gift/decline': 'gift-decline',
	'/api/gift/discard': 'gift-discard',
	'/api/gift/send': 'gift-send',
	'/api/market/buy': 'market-buy',
	'/api/market/buy-order': 'market-buy-order',
	'/api/market/cancel': 'market-cancel',
	'/api/market/claim-legacy-payouts': 'market-claim-legacy-payouts',
	'/api/market/destroy': 'market-destroy',
	'/api/market/fulfill': 'market-fulfill',
	'/api/market/haggle': 'market-haggle',
	'/api/market/haggle/accept': 'market-haggle-accept',
	'/api/market/haggle/claim': 'market-haggle-claim',
	'/api/market/haggle/counter': 'market-haggle-counter',
	'/api/market/haggle/terminate': 'market-haggle-terminate',
	'/api/market/payout': 'market-payout',
	'/api/market/sell': 'market-sell',
	'/api/social-mode/cancel': 'social-mode-cancel',
	'/api/social-mode/set': 'social-mode-set',
	'/api/trade/accept': 'trade-accept',
	'/api/trade/cancel': 'trade-cancel',
	'/api/trade/counter': 'trade-counter',
	'/api/trade/decline': 'trade-decline',
	'/api/trade/offer': 'trade-offer',
	'/api/trade/resolve': 'trade-resolve',
};
export const ECONOMY_COMMAND_PATHS = new Set(Object.keys(ECONOMY_COMMAND_KINDS));

export function validate_api_command(req: Request, json: JsonObject | null): boolean {
	const { api_major, logical_path } = api_context(req);
	if (api_major !== 2) return true;
	if (logical_path === '/api/client/status/sync' && json && Object.hasOwn(json, 'activity')) return false;
	if (!ECONOMY_COMMAND_PATHS.has(logical_path)) return true;
	return typeof json?.command_id === 'string' &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(json.command_id);
}

// Only removed wire aliases are filtered; persisted snapshots and receipt payloads are untouched.
function v2_response(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(v2_response);
	if (value === null || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value).filter(([key]) =>
		key !== 'status_visible' && key !== 'status_available' && key !== 'read_post_supported'
	).map(([key, entry]) => [key, key === 'receipt' || key === 'economy_receipts' ? entry : v2_response(entry)]));
}

// The original Request stays intact for session identity, diagnostics, and body consumption.
// Only the URL passed to the logical handler is canonicalized.
export function create_api_server(port: number) {
	const http = create_http_server(port);
	const manifest: Array<{ path: string; logical_path: string; method: Bun.Serve.HTTPMethod; api_major: ApiMajor }> = [];
	const registered = new Set<string>();
	return {
		...http,
		manifest,
		route(path: string, handler: RequestHandler, methods: Bun.Serve.HTTPMethod | Bun.Serve.HTTPMethod[] = 'GET', options: RouteOptions = {}) {
			if (!path.startsWith('/api/') || path === '/api/versions') {
				http.route(path, handler, methods);
				return;
			}
			const versions = options.versions ?? API_VERSIONS;
			for (const api_major of versions) {
				if (api_major === 2 && path === '/api/client/status/visibility') continue;
				const paths = api_major === 1 ? [path, `/api/v1/${path.slice(5)}`] : [`/api/v2/${path.slice(5)}`];
				for (const wire_path of paths) {
					for (const method of Array.isArray(methods) ? methods : [methods]) {
						const key = `${method} ${wire_path}`;
						if (registered.has(key)) {
							// GET and POST share one preflight route with identical outer guards.
							if (method === 'OPTIONS') continue;
							throw new Error(`Duplicate API registration: ${key}`);
						}
						registered.add(key);
						manifest.push({ path: wire_path, logical_path: path, method, api_major });
						http.route(wire_path, async (req, url) => {
							contexts.set(req, { api_major, logical_path: path, explicit: wire_path !== path });
							const logical_url = new URL(url);
							logical_url.pathname = path;
							const result = await handler(req, logical_url);
							const bootstrap = wire_path !== path && (path === '/api/register' || path === '/api/authenticate');
							if ((bootstrap || api_major === 2) && result instanceof Response && result.status === 200 &&
								result.headers.get('Content-Type')?.includes('application/json')) {
								const body = await result.json() as Record<string, unknown>;
								const adapted = bootstrap ? { ...body, api_version: api_major, api_versions: API_VERSIONS } : body;
								return Response.json(api_major === 2 ? v2_response(adapted) : adapted, { headers: result.headers });
							}
							return result;
						}, method);
					}
				}
			}
		}
	};
}
