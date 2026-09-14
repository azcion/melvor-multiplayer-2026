const server_url = process.env.TEST_SERVER_URL;

if (!server_url)
	throw new Error('TEST_SERVER_URL is required');

export type JsonResponse<T> = {
	response: Response;
	json: T;
};

export type RegisteredClient = {
	client_id: number;
	client_identifier: string;
	client_key: string;
	friend_code: string;
	display_name: string;
	icon_id: string;
	session_token: string;
};

export type MelvorAccountFixture = {
	cloud_username: string;
	playfab_id: string;
};

type RequestHeaders = NonNullable<RequestInit['headers']>;

// Existing API fixtures use logical mutation payloads and predate the v2 command journal.
// Give those fixtures the same stable command identity as a current client; tests that
// exercise rejection pass an explicit /api/v2 path and command_id value.
const journaled_mutations = new Set([
	'/api/campaign/claim', '/api/campaign/contribute', '/api/charity/donate', '/api/charity/shuffle', '/api/charity/take',
	'/api/charity/wish/make', '/api/charity/wish/forsake', '/api/charity/wish/pick',
	'/api/gift/accept', '/api/gift/decline', '/api/gift/discard', '/api/gift/send',
	'/api/market/buy', '/api/market/buy-order', '/api/market/cancel', '/api/market/claim-legacy-payouts', '/api/market/destroy',
	'/api/market/fulfill', '/api/market/haggle', '/api/market/haggle/accept', '/api/market/haggle/claim',
	'/api/market/haggle/counter', '/api/market/haggle/terminate', '/api/market/payout', '/api/market/sell',
	'/api/social-mode/cancel', '/api/social-mode/set', '/api/trade/accept', '/api/trade/cancel', '/api/trade/counter',
	'/api/trade/decline', '/api/trade/offer', '/api/trade/resolve'
]);

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
	const wire_path = path.startsWith('/api/') && !path.startsWith('/api/v2/') && path !== '/api/versions'
		? `/api/v2/${path.slice('/api/'.length)}` : path;
	return fetch(new URL(wire_path, server_url), init);
}

async function read_json_response<T>(response: Response): Promise<T> {
	const body = await response.text();
	const content_type = response.headers.get('Content-Type') ?? '';
	if (!content_type.toLowerCase().startsWith('application/json')) {
		throw new Error(
			`Expected JSON response, got HTTP ${response.status} ${response.statusText}; ` +
			`Content-Type=${content_type || '<missing>'}; body=${body.slice(0, 512)}`
		);
	}

	try {
		return JSON.parse(body) as T;
	} catch (error) {
		throw new Error(
			`Invalid JSON response from HTTP ${response.status} ${response.statusText}; ` +
			`body=${body.slice(0, 512)}`,
			{ cause: error }
		);
	}
}

export async function request_json<T>(path: string, init: RequestInit = {}): Promise<JsonResponse<T>> {
	const response = await request(path, init);
	const json = await read_json_response<T>(response);

	return { response, json };
}

export async function post(
	path: string,
	body: unknown,
	session_token?: string,
	headers: RequestHeaders = {}
): Promise<Response> {
	const request_headers = new Headers(headers);
	request_headers.set('Content-Type', 'application/json');

	if (session_token)
		request_headers.set('X-Session-Token', session_token);
	if (path === '/api/client/status/sync' && !path.startsWith('/api/v2/') &&
		typeof body === 'object' && body !== null && !Array.isArray(body) && Object.hasOwn(body, 'activity') && !Object.hasOwn(body, 'activities')) {
		const legacy_activity = (body as Record<string, any>).activity;
		body = { ...(body as Record<string, unknown>), activities: legacy_activity?.type === 'idle' ? [] : [legacy_activity] };
		delete (body as Record<string, unknown>).activity;
	}
	if (path.startsWith('/api/') && !path.startsWith('/api/v2/') && journaled_mutations.has(path.split('?')[0]) &&
		typeof body === 'object' && body !== null && !Array.isArray(body) && !Object.hasOwn(body, 'command_id'))
		body = { ...(body as Record<string, unknown>), command_id: crypto.randomUUID() };

	return request(path, {
		method: 'POST',
		headers: request_headers,
		body: JSON.stringify(body)
	});
}

export async function post_json<T>(
	path: string,
	body: unknown,
	session_token?: string,
	headers: RequestHeaders = {}
): Promise<JsonResponse<T>> {
	const response = await post(path, body, session_token, headers);
	const json = await read_json_response<T>(response);

	return { response, json };
}

export async function post_binary(
	path: string,
	body: Uint8Array,
	session_token?: string,
	headers: RequestHeaders = {}
): Promise<Response> {
	const request_headers = new Headers(headers);
	if (session_token)
		request_headers.set('X-Session-Token', session_token);

	return request(path, {
		method: 'POST',
		headers: request_headers,
		body
	});
}

export async function get_with_session(path: string, session_token: string): Promise<Response> {
	return request(path, {
		headers: {
			'X-Session-Token': session_token
		}
	});
}

export async function get_json_with_session<T>(path: string, session_token: string): Promise<JsonResponse<T>> {
	const response = await get_with_session(path, session_token);
	const json = await read_json_response<T>(response);

	return { response, json };
}

export async function register_client(
	display_name = 'Test Idler',
	melvor_account?: MelvorAccountFixture,
	mod_version?: string
): Promise<RegisteredClient> {
	const client_key = crypto.randomUUID();
	const { response, json } = await post_json<Omit<RegisteredClient, 'client_key' | 'client_id'> & {
		chat: { client_id: number };
	}>('/api/register', {
		client_key,
		display_name,
		...melvor_account,
		...(mod_version === undefined ? {} : { client_runtime: { mod_version, active_mods: [] } })
	});

	if (!response.ok)
		throw new Error(`Client registration failed with ${response.status}: ${JSON.stringify(json)}`);

	return { ...json, client_id: json.chat.client_id, client_key };
}
