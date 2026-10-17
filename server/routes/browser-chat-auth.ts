import * as runtime from '../app-runtime';
import {
	browser_csrf,
	create_browser_exchange_limits,
	browser_origin_configuration,
	CHAT_SESSION_LIFETIME,
	get_browser_session,
	get_browser,
	get_browser_record,
	list_browser_identities,
	revoke_browser,
	issue_browser_code,
	list_browser_sessions,
	pair_browser,
	revoke_browser_session,
	type BrowserSession
} from '../browser-chat-auth';
import { read_json_request, status_response, type RequestHandler, type HandlerResult, type JsonObject } from '../http';

const config = browser_origin_configuration();
// Exchange buckets deliberately reset on process restart; issuance and credentials are durable.
const exchange_limits = create_browser_exchange_limits();
function cookie(token: string, seconds: number): string {
	return `${config.cookie_name}=${token}; Path=/chat; Max-Age=${seconds}; HttpOnly; SameSite=Strict${config.secure ? '; Secure' : ''}`;
}
function stale_cookie(): Response {
	return new Response('Unauthorized', { status: 401, headers: { 'Set-Cookie': cookie('', 0) } });
}
function token_from_request(req: Request): string | null {
	const values = (req.headers.get('Cookie') ?? '')
		.split(';')
		.map(v => v.trim())
		.filter(v => v.startsWith(`${config.cookie_name}=`));
	return values.length === 0 ? null : values.length === 1 ? values[0].slice(config.cookie_name.length + 1) : '';
}
export function chat_browser_response(result: unknown): Response {
	const response =
		result instanceof Response
			? result
			: typeof result === 'number'
				? status_response(result)
				: Response.json(result);
	response.headers.set('Cache-Control', 'private, no-store');
	response.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'no-referrer');
	return response;
}
function browser_boundary(handler: RequestHandler): RequestHandler {
	const guarded = runtime.require_source_capacity(runtime.require_service_available(handler));
	return async (req, url) => chat_browser_response(await guarded(req, url));
}
function valid_origin(req: Request): boolean {
	const origin = req.headers.get('Origin');
	return (origin === null ? req.method === 'GET' : origin === config.origin) &&
		req.headers.get('Sec-Fetch-Site') !== 'cross-site';
}
function selected_link(req: Request): number | null {
	const value = req.headers.get('X-Chat-Link-ID');
	if (value === null || !/^[1-9][0-9]{0,15}$/.test(value)) return null;
	const id = Number(value);
	return Number.isSafeInteger(id) ? id : null;
}
// Explicit adapters use this wrapper; never install it as an API/cookie fallback.
// Handlers are synchronous: parse JSON before final authorization, then perform
// domain checks/writes without yielding across revocation. Async integrations must
// finish before dispatch or explicitly reauthorize before committing a mutation.
export function authenticated_chat_browser(
	handler: (req: Request, url: URL, session: BrowserSession, json: JsonObject) => HandlerResult
): RequestHandler {
	return browser_boundary(async (req, url) => {
		if (!valid_origin(req)) return 403;
		const token = token_from_request(req) ?? '';
		const link_id = selected_link(req);
		if (link_id === null) return 400;
		if (!get_browser_session(runtime.db, token, link_id)) return 401;
		if (req.headers.get('X-Chat-CSRF') !== browser_csrf(token)) return 403;
		let json: JsonObject = {};
		if (req.method !== 'GET') {
			const body = await read_json_request(req);
			if ('response' in body) return body.response;
			json = body.json;
		}
		return runtime.db.transaction(() => {
			const session = get_browser_session(runtime.db, token, link_id);
			if (!session) return 401;
			const limited = runtime.request_limits.limit_identity(session.client_id);
			if (limited) return limited;
			runtime.identify_request(req, session.client_id);
			runtime.db.query('UPDATE chat_browser_sessions SET last_browser_seen_at=? WHERE id=?').run(Date.now(), session.id);
			return handler(req, url, session, json);
		}).immediate();
	});
}
export function register_browser_chat_auth_routes(): void {
	// Game credentials only; standard game wrapper and existing behavior remain unchanged.
	runtime.session_post_route('/api/chat/browser-links/issue', (_req, _url, client_id) => {
		const result = issue_browser_code(runtime.db, client_id);
		return result.status === 429
			? new Response('Too Many Requests', {
					status: 429,
					headers: { 'Retry-After': String(result.retry_after) }
				})
			: result.status === 200
				? Response.json(
						{ code: result.code!, expires_at: result.expires_at! },
						{ headers: { 'Cache-Control': 'private, no-store' } }
					)
				: result.status;
	});
	runtime.session_get_route('/api/chat/browser-links/list', (_req, _url, client_id) => ({
		sessions: list_browser_sessions(runtime.db, client_id)
	}));
	runtime.session_post_route('/api/chat/browser-links/revoke', (_req, _url, client_id, json) => {
		if (typeof json.session_id !== 'number' || !Number.isSafeInteger(json.session_id) || json.session_id < 1)
			return 400;
		revoke_browser_session(runtime.db, client_id, json.session_id);
		return { ok: true };
	});
	runtime.server.route(
		'/chat/api/pair',
		browser_boundary(async req => {
			if (req.headers.get('Origin') !== config.origin || req.headers.get('Sec-Fetch-Site') === 'cross-site')
				return 403;
			const body = await read_json_request(req);
			if ('response' in body) return body.response;
			const token = token_from_request(req);
			if (token !== null) {
				if (!get_browser(runtime.db, token)) return stale_cookie();
				if (req.headers.get('X-Chat-CSRF') !== browser_csrf(token)) return 403;
			}
			const limited = exchange_limits.limit_source(req) ?? exchange_limits.limit_registration(req);
			if (limited) return limited;
			const paired = pair_browser(runtime.db, body.json.code, undefined, token ?? undefined);
			if (!paired) return 401;
			return Response.json(
				{ ok: true, link_id: paired.id },
				{ headers: { 'Set-Cookie': cookie(paired.token, CHAT_SESSION_LIFETIME / 1000) } }
			);
		}),
		'POST'
	);
	runtime.server.route(
		'/chat/api/session',
		browser_boundary(req => {
			if (!valid_origin(req)) return 403;
			const token = token_from_request(req) ?? '';
			const browser = get_browser(runtime.db, token);
			if (!browser) return stale_cookie();
			return {
				links: list_browser_identities(runtime.db, browser.id).map(link => ({
					link_id: link.id, client_id: link.client_id, display_name: link.display_name, expires_at: link.expires_at
				})),
				csrf_token: browser_csrf(token)
			};
		}),
		'GET'
	);
	runtime.server.route(
		'/chat/api/logout',
		authenticated_chat_browser((req, _url, session) => {
			revoke_browser_session(runtime.db, session.client_id, session.id);
			const browser = get_browser(runtime.db, token_from_request(req) ?? '');
			return Response.json({ ok: true }, browser ? undefined : { headers: { 'Set-Cookie': cookie('', 0) } });
		}),
		'POST'
	);
	runtime.server.route(
		'/chat/api/logout-all',
		browser_boundary(async req => {
			if (!valid_origin(req)) return 403;
			const token = token_from_request(req) ?? '';
			if (!get_browser_record(runtime.db, token)) return 401;
			if (req.headers.get('X-Chat-CSRF') !== browser_csrf(token)) return 403;
			const body = await read_json_request(req);
			if ('response' in body) return body.response;
			if (!revoke_browser(runtime.db, token)) return 401;
			return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie('', 0) } });
		}),
		'POST'
	);
}
