import { invalidate_recovery, combat_available, combat_availability, pause_recovery, save_recovery, read_recovery, resume_recovery, abandon_recovery } from './combat-recovery';
import type { ServerWebSocket } from 'bun';
import type { Database } from 'bun:sqlite';
import { reserve_combat, update_combat, interrupt_combats } from './combat-inventory';
export function start_combat_authority(options: { database: Database; key: string; port?: number; hostname?: string; admitted: (client: number) => boolean }) {
	const { database } = options;
	// Recover opted-in PvE; old clients retain interruption semantics.
	pause_recovery(database);
	interrupt_combats(database);
	const controllers = new Set<string>();
	const sockets = new Set<ServerWebSocket<{ controller: string }>>();
	let stopping = false, stopped = false;
	const server = Bun.serve<{ controller: string }>({ port: options.port ?? 3003, hostname: options.hostname ?? '0.0.0.0',
		fetch(req, server) {
			if (new URL(req.url).pathname !== '/authority' || req.headers.get('authorization') !== `Bearer ${options.key}` || stopping || controllers.size >= 2) return new Response('Forbidden',{ status: 403 });
			if (server.upgrade(req,{ data: { controller: crypto.randomUUID() } })) return;
			return new Response('WebSocket required',{ status: 400 });
		},
		websocket: { maxPayloadLength: 262144, idleTimeout: 10, backpressureLimit: 1048576, closeOnBackpressureLimit: true,
			open(ws) { controllers.add(ws.data.controller); sockets.add(ws); },
			message(ws, raw) {
				try {
					const message = JSON.parse(String(raw));
					if (message.type === 'drained') { ws.close(1001,'Shutdown saved'); return; }
					if (message.type === 'heartbeat') { ws.send('{"type":"heartbeat"}'); return; }
					if (typeof message.id !== 'string' || message.id.length > 100) throw new Error('Invalid request');
					let result: unknown = null;
					if (!stopping && combat_availability(database).drain_at === null && message.type === 'reserve' && Number.isSafeInteger(message.client) && typeof message.encounter === 'string' && /^[a-f0-9-]{36}$/.test(message.encounter) && options.admitted(message.client))
						result = reserve_combat(database,message.client,ws.data.controller,message.encounter,message.selection,message.mode);
					if (message.type === 'progress' && typeof message.encounter === 'string')
						result = update_combat(database,ws.data.controller,message.encounter,message.used,message.status,message.completed);
					if (message.type === 'recovery') {
						const client = message.client;
						if (message.action === 'invalidate' && combat_availability(database).incompatible && (combat_availability(database).drain_at ?? Infinity) <= Date.now()) { invalidate_recovery(database); result = true; }
						if (message.action === 'available' && !stopping) result = combat_available(database);
						if (message.action === 'save' && message.arena && Number.isSafeInteger(message.revision)) result = save_recovery(database,ws.data.controller,message.arena,message.revision,message.initial === true);
						if (message.action === 'pause') { pause_recovery(database,ws.data.controller,message.encounter); result = true; }
						if (Number.isSafeInteger(client) && options.admitted(client)) {
							if (message.action === 'read') result = read_recovery(database,client);
							if (message.action === 'resume' && !stopping) result = resume_recovery(database,client,ws.data.controller,message.encounter);
							if (message.action === 'abandon') result = abandon_recovery(database,client,message.encounter);
						}
					}
					ws.send(JSON.stringify({ id: message.id, result }));
				} catch { ws.close(1011,'Authority failure'); }
			},
			close(ws) { controllers.delete(ws.data.controller); sockets.delete(ws); if (stopped) return; pause_recovery(database,ws.data.controller); interrupt_combats(database,ws.data.controller); }
		}
	});
	return { server, async stop() {
		stopping = true;
		for (const ws of sockets) ws.send(JSON.stringify({type:'shutdown'}));
		const deadline = Date.now()+4000;
		while (sockets.size && Date.now()<deadline) await new Promise(resolve => setTimeout(resolve,20));
		pause_recovery(database); interrupt_combats(database); stopped = true; await server.stop(true);
	} };
}
