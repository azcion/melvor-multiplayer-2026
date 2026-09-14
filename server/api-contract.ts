import { create_http_server, type JsonObject, type RequestHandler } from './http';

export type ApiMajor = 2;
export const API_VERSIONS: ApiMajor[] = [2];
type RouteOptions = Record<string, never>;
type RouteContext = { api_major: ApiMajor; logical_path: string; explicit: boolean };
const contexts = new WeakMap<Request, RouteContext>();

export function api_context(req: Request): RouteContext {
	return contexts.get(req) ?? { api_major: 2, logical_path: new URL(req.url).pathname, explicit: false };
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
export const REPLAY_COMMAND_PATHS = new Set([
	...ECONOMY_COMMAND_PATHS,
	'/api/charity/wish/make',
	'/api/charity/wish/forsake',
	'/api/charity/wish/pick'
]);

export function validate_api_command(req: Request, json: JsonObject | null): boolean {
	const { logical_path } = api_context(req);
	if (!REPLAY_COMMAND_PATHS.has(logical_path)) return true;
	return typeof json?.command_id === 'string' &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(json.command_id);
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
			const api_major: ApiMajor = 2;
			{
				const paths = [`/api/v2/${path.slice(5)}`];
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
							const bootstrap = path === '/api/register' || path === '/api/authenticate';
							if (result instanceof Response && result.status === 200 &&
								result.headers.get('Content-Type')?.includes('application/json')) {
								const body = await result.json() as Record<string, unknown>;
								const adapted = bootstrap ? { ...body, api_version: api_major, api_versions: API_VERSIONS } : body;
								return Response.json(adapted, { headers: result.headers });
							}
							return result;
						}, method);
					}
				}
			}
		}
	};
}
