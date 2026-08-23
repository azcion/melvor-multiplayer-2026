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

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
	return fetch(new URL(path, server_url), init);
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
	melvor_account?: MelvorAccountFixture
): Promise<RegisteredClient> {
	const client_key = crypto.randomUUID();
	const { response, json } = await post_json<Omit<RegisteredClient, 'client_key' | 'client_id'> & {
		chat: { client_id: number };
	}>('/api/register', {
		client_key,
		display_name,
		...melvor_account
	});

	if (!response.ok)
		throw new Error(`Client registration failed with ${response.status}: ${JSON.stringify(json)}`);

	return { ...json, client_id: json.chat.client_id, client_key };
}
