import { STATUS_CODES } from 'node:http';
import { report_error, write_log } from './log';

export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonSerializable[];
export type JsonObject = {
	[key: string]: JsonSerializable;
};

interface ToJson {
	toJSON(): any;
}

export type JsonSerializable = JsonPrimitive | JsonObject | JsonArray | ToJson;
export type HandlerResult = string | number | Response | JsonSerializable;
export type HandlerReturnType = HandlerResult | Promise<HandlerResult>;
export type RequestHandler = (req: Request, url: URL) => HandlerReturnType;
type JsonReadResult = { json: JsonObject } | { response: Response };
type BinaryReadResult = { bytes: Uint8Array } | { response: Response };

type HTTPMethod = Bun.Serve.HTTPMethod;
type NativeHandler = (req: Request) => Response | Promise<Response>;
type NativeRoutes = Record<string, Partial<Record<HTTPMethod, NativeHandler>>>;
type ErrorHandler = (error: Error) => HandlerReturnType;
type DefaultHandler = (req: Request, status_code: number) => HandlerReturnType;

export function status_response(status_code: number): Response {
	return new Response(STATUS_CODES[status_code] ?? '', { status: status_code });
}

function body_too_large_response(): Response {
	return new Response(STATUS_CODES[413] ?? '', {
		status: 413,
		headers: { Connection: 'close' }
	});
}

type RequestIdentity = {
	client_id: number;
	mod_version?: string;
};

const request_identities = new WeakMap<Request, RequestIdentity>();

function positive_body_limit(): number {
	const raw = process.env.MAX_JSON_BODY_BYTES ?? '32768';
	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed) || parsed < 1)
		throw new Error('MAX_JSON_BODY_BYTES must be a positive integer');
	return parsed;
}

const MAX_JSON_BODY_BYTES = positive_body_limit();

export function identify_request(req: Request, client_id: number, mod_version?: string): void {
	request_identities.set(req, { client_id, mod_version });
}

export async function read_json_request(req: Request): Promise<JsonReadResult> {
	if (req.headers.get('Content-Type') !== 'application/json')
		return { response: status_response(400) };

	const declared_length = req.headers.get('Content-Length');
	if (declared_length !== null && Number(declared_length) > MAX_JSON_BODY_BYTES)
		return { response: body_too_large_response() };

	try {
		const reader = req.body?.getReader();
		if (reader === undefined)
			return { response: status_response(400) };

		const chunks: Uint8Array[] = [];
		let length = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done)
				break;

			length += value.byteLength;
			if (length > MAX_JSON_BODY_BYTES) {
				await reader.cancel();
				return { response: body_too_large_response() };
			}
			chunks.push(value);
		}

		const body = new Uint8Array(length);
		let offset = 0;
		for (const chunk of chunks) {
			body.set(chunk, offset);
			offset += chunk.byteLength;
		}

		const json = JSON.parse(new TextDecoder().decode(body));
		if (json === null || typeof json !== 'object' || Array.isArray(json))
			return { response: status_response(400) };

		return { json: json as JsonObject };
	} catch {
		return { response: status_response(400) };
	}
}

export async function read_binary_request(req: Request, maximum_bytes: number): Promise<BinaryReadResult> {
	const declared_length = req.headers.get('Content-Length');
	if (declared_length !== null) {
		const length = Number(declared_length);
		if (!Number.isSafeInteger(length) || length < 0)
			return { response: status_response(400) };
		if (length > maximum_bytes)
			return { response: body_too_large_response() };
	}

	try {
		const reader = req.body?.getReader();
		if (reader === undefined)
			return { response: status_response(400) };

		const chunks: Uint8Array[] = [];
		let length = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done)
				break;

			length += value.byteLength;
			if (length > maximum_bytes) {
				await reader.cancel();
				return { response: body_too_large_response() };
			}
			chunks.push(value);
		}

		const bytes = new Uint8Array(length);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}

		return { bytes };
	} catch {
		return { response: status_response(400) };
	}
}

async function resolve_response(result: HandlerReturnType): Promise<Response> {
	const resolved = await result;

	if (resolved === undefined || resolved === null)
		throw new Error('Request handler cannot resolve to undefined or null');

	if (resolved instanceof Response)
		return resolved;

	if (typeof resolved === 'number')
		return status_response(resolved);

	if (typeof resolved === 'object')
		return Response.json(resolved);

	return new Response(String(resolved), {
		headers: { 'Content-Type': 'text/html' }
	});
}

export function should_log_request(path: string, status: number): boolean {
	return path !== '/health' || status >= 400;
}

function log_request(req: Request, response: Response, started_at: number): Response {
	const url = new URL(req.url);
	if (!should_log_request(url.pathname, response.status))
		return response;
	const elapsed_ms = Date.now() - started_at;
	const request_identity = request_identities.get(req);
	const identity = request_identity === undefined ? '' : ` identity=${request_identity.client_id}`;
	const mod_version = request_identity?.mod_version === undefined
		? ''
		: ` mod_version=${JSON.stringify(request_identity.mod_version)}`;
	write_log(
		'info',
		`type=http method=${req.method} path=${url.pathname} status=${response.status} ` +
		`duration_ms=${elapsed_ms}${identity}${mod_version}`
	);
	return response;
}

export function validate_json_request(handler: (req: Request, url: URL, json: JsonObject) => HandlerReturnType | Promise<HandlerReturnType>): RequestHandler {
	return async (req, url) => {
		const result = await read_json_request(req);
		if ('response' in result)
			return result.response;
		return handler(req, url, result.json);
	};
}

export function create_http_server(port: number) {
	const routes: NativeRoutes = {};
	const known_paths = new Set<string>();

	let error_handler: ErrorHandler | undefined;
	let default_handler: DefaultHandler | undefined;
	let runtime_server: Bun.Server<undefined> | undefined;

	function wrap_handler(handler: RequestHandler): NativeHandler {
		return async req => {
			const started_at = Date.now();
			const response = await resolve_response(handler(req, new URL(req.url)));
			return log_request(req, response, started_at);
		};
	}

	return {
		route(path: string, handler: RequestHandler, methods: HTTPMethod | HTTPMethod[] = 'GET'): void {
			const route_methods = routes[path] ??= {};
			known_paths.add(path);

			for (const method of Array.isArray(methods) ? methods : [methods])
				route_methods[method] = wrap_handler(handler);
		},

		error(handler: ErrorHandler): void {
			error_handler = handler;
		},

		default(handler: DefaultHandler): void {
			default_handler = handler;
		},

		start(): void {
			if (runtime_server)
				throw new Error('HTTP server has already started');

			runtime_server = Bun.serve({
				port,
				development: false,
				routes,
				async fetch(req) {
					const started_at = Date.now();
					const status_code = known_paths.has(new URL(req.url).pathname) ? 405 : 404;
					const response = default_handler
						? await resolve_response(default_handler(req, status_code))
						: status_response(status_code);
					return log_request(req, response, started_at);
				},
				async error(error) {
					if (error_handler)
						return resolve_response(error_handler(error));

					report_error('unhandled request error', error);
					return status_response(500);
				}
			});

			write_log('info', `type=server event=started port=${runtime_server.port}`);
		},

		async stop(close_active_connections = false): Promise<void> {
			if (runtime_server === undefined)
				return;
			await runtime_server.stop(close_active_connections);
			runtime_server = undefined;
		}
	};
}
