import * as runtime from '../app-runtime';
import { authenticated_chat_browser } from './browser-chat-auth';
import { create_chat_data_handler } from '../chat-data-handler';
import { create_demo_adapter } from '../chat-demo-data';
const headers = {
	'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
	'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https://cdn2-main.melvor.net; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};
export function register_browser_chat_shell_routes(): void {
	const files = { '/chat': ['index.html', 'text/html'], '/chat/assets/chat.css': ['chat.css', 'text/css'],
		'/chat/assets/chat.mjs': ['chat.mjs', 'text/javascript'],
		'/chat/assets/controller.mjs': ['controller.mjs', 'text/javascript'], '/chat/assets/render.mjs': ['render.mjs', 'text/javascript'], '/chat/assets/transport.mjs': ['transport.mjs', 'text/javascript'] };
	for (const [path, [file, type]] of Object.entries(files))
		runtime.server.route(path, () => new Response(Bun.file(new URL(`../chat-assets/${file}`, import.meta.url)), {
			headers: { ...headers, 'Content-Type': `${type}; charset=utf-8` }
		}));
	runtime.server.route('/chat/', () => new Response(null, { status: 308, headers: { ...headers, Location: '/chat' } }));
	// Exact routes only: no arbitrary filesystem or upstream asset proxy.
	const shared = { '/mod/chat-items.mjs': ['chat-items.mjs', 'text/javascript'],
		'/chat/assets/multiplayer.svg': ['assets/multiplayer.svg', 'image/svg+xml'], '/chat/assets/transfer_bag.svg': ['assets/transfer_bag.svg', 'image/svg+xml'],
		'/chat/assets/market.svg': ['assets/market.svg', 'image/svg+xml'], '/chat/assets/crucible.png': ['assets/crucible.png', 'image/png'],
		'/chat/assets/expedition-nav.png': ['assets/expedition-nav.png', 'image/png'], '/chat/assets/raid-nav.png': ['assets/raid-nav.png', 'image/png'] };
	for (const [name, [file, type]] of Object.entries(shared))
		runtime.server.route(name, () => new Response(Bun.file(new URL(`../../mod/${file}`, import.meta.url)), {
			headers: { ...headers, 'Content-Type': type }
		}));
	const adapter = create_demo_adapter();
	runtime.server.route('/chat/api/data', create_chat_data_handler(authenticated_chat_browser, locale => adapter.load(locale)));
}
