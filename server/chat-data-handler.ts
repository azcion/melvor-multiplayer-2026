import { type RequestHandler, type HandlerResult } from './http';
// The supplied authorization factory owns the scoped browser boundary and synchronous transaction.
export function create_chat_data_handler(authorize: (handler: () => HandlerResult) => RequestHandler, load: (locale: string) => Promise<HandlerResult>): RequestHandler {
	return async (req, url) => {
		const admission = await authorize(() => ({ ok: true }))(req, url);
		if (!(admission instanceof Response) || !admission.ok)
			return admission;
		let data: HandlerResult;
		try {
			data = await load(url.searchParams.get('locale') ?? 'en');
		}
		catch {
			data = new Response('Official demo data unavailable; browser linking remains available.', { status: 502 });
		}
		// Includes failure responses: revocation during upstream I/O wins over data results.
		return authorize(() => data)(req, url);
	};
}
