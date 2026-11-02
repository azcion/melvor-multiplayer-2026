import type { Database } from 'bun:sqlite';
import { reserve_combat, update_combat, interrupt_combats } from './combat-inventory';
export function start_combat_authority(options: { database: Database; key: string; port?: number; hostname?: string; admitted: (client: number) => boolean }) {
	const { database } = options;
	// A main-backend restart never resumes a previously hidden encounter.
	interrupt_combats(database);
	const controllers = new Set<string>();
	const server = Bun.serve<{ controller: string }>({ port: options.port ?? 3003, hostname: options.hostname ?? '0.0.0.0',
		fetch(req, server) {
			if (new URL(req.url).pathname !== '/authority' || req.headers.get('authorization') !== `Bearer ${options.key}` || controllers.size >= 2) return new Response('Forbidden',{ status: 403 });
			if (server.upgrade(req,{ data: { controller: crypto.randomUUID() } })) return;
			return new Response('WebSocket required',{ status: 400 });
		},
		websocket: { maxPayloadLength: 8192, idleTimeout: 10, backpressureLimit: 65536, closeOnBackpressureLimit: true,
			open(ws) { controllers.add(ws.data.controller); },
			message(ws, raw) {
				try {
					const message = JSON.parse(String(raw));
					if (message.type === 'heartbeat') { ws.send('{"type":"heartbeat"}'); return; }
					if (typeof message.id !== 'string' || message.id.length > 100) throw new Error('Invalid request');
					let result: unknown = null;
					if (message.type === 'reserve' && Number.isSafeInteger(message.client) && typeof message.encounter === 'string' && /^[a-f0-9-]{36}$/.test(message.encounter) && options.admitted(message.client))
						result = reserve_combat(database,message.client,ws.data.controller,message.encounter,message.selection,message.mode);
					if (message.type === 'progress' && typeof message.encounter === 'string')
						result = update_combat(database,ws.data.controller,message.encounter,message.used,message.status,message.completed);
					ws.send(JSON.stringify({ id: message.id, result }));
				} catch { ws.close(1011,'Authority failure'); }
			},
			close(ws) { controllers.delete(ws.data.controller); interrupt_combats(database,ws.data.controller); }
		}
	});
	return { server, stop() { interrupt_combats(database); server.stop(true); } };
}
