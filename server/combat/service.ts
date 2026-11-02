import { create_snapshot_stream } from './snapshots';
import { create_run, step_run, run_command, valid_run, type RunMode } from './runs';
import type { ServerWebSocket } from 'bun';
import { SUPPORTED_ENCOUNTERS, STEP_MS, SNAPSHOT_MS, type Arena, type Encounter } from './engine';
import { connect_authority, type CombatAuthority } from './authority-client';
import { COMBAT_PROTOCOL, verify_ticket } from './tickets';

type Connection = {
	opened: number; heartbeat: number; user: number | null; arena: Arena | null; seq: number;
	window: number; count: number; start_after: number; busy: boolean; snapshots: ReturnType<typeof create_snapshot_stream> | null;
};
type Socket = ServerWebSocket<Connection>;

export function start_combat_service(options: { key: string; port?: number; hostname?: string; origins?: string[]; authority?: CombatAuthority; authority_url?: string; random?: () => number }) {
	const sockets = new Set<Socket>();
	const users = new Map<number, Socket>();
	const authority = options.authority ?? connect_authority(options.authority_url ?? 'ws://server:3003/authority',options.key,() => { for (const ws of sockets) ws.close(1012,'Combat authority unavailable'); });
	async function commit(ws: Socket, arena: Arena) {
		const changed = !ws.data.arena || arena.food_used !== ws.data.arena.food_used || arena.status !== ws.data.arena.status || arena.run?.completed !== ws.data.arena.run?.completed;
		if (changed && !await authority.progress(arena.id,arena.food_used,arena.status,arena.run?.completed)) { ws.close(1012,'Combat authority rejected progress'); return false; }
		if (!sockets.has(ws)) { if (arena.status === 'active') await authority.progress(arena.id,arena.food_used,'interrupted'); return false; }
		ws.data.arena = arena; return true;
	}
	const used_tickets = new Map<string, number>();
	// Match the public API: native/custom origins are supported; signed tickets authorize access.
	const origins = options.origins === undefined ? null : new Set(options.origins);
	const clock = () => performance.now();
	const send = (ws: Socket, value: unknown) => {
		if (ws.getBufferedAmount() > 64 * 1024) { ws.close(1008, 'Slow connection'); return; }
		ws.send(JSON.stringify(value));
	};
	const send_state = (ws: Socket, now: number) => send(ws, ws.data.snapshots?.next(ws.data.arena, now) ?? { type: 'state', arena: ws.data.arena });
	const server = Bun.serve<Connection>({
		port: options.port ?? 3002, hostname: options.hostname ?? '0.0.0.0',
		fetch(req, server) {
			const url = new URL(req.url);
			if (url.pathname === '/health' && req.method === 'GET') return new Response('OK');
			if (url.pathname !== '/combat/socket' || url.search || req.method !== 'GET') return new Response('Not found', { status: 404 });
			if (origins && !origins.has(req.headers.get('origin') ?? '')) return new Response('Forbidden', { status: 403 });
			if (sockets.size >= 128) return new Response('Combat capacity reached', { status: 503 });
			const now = clock();
			if (server.upgrade(req, { data: { opened: now, heartbeat: now, user: null, arena: null, seq: 0, window: now, count: 0, start_after: now, busy: false, snapshots: null } })) return;
			return new Response('WebSocket required', { status: 400 });
		},
		websocket: {
			maxPayloadLength: 2048, idleTimeout: 15, backpressureLimit: 64 * 1024, closeOnBackpressureLimit: true,
			open(ws) { sockets.add(ws); },
			async message(ws, raw) {
				const now = clock(), data = ws.data;
				if (now - data.window >= 1000) { data.window = now; data.count = 0; }
				if (++data.count > 20 || typeof raw !== 'string') { ws.close(1008, 'Message limit'); return; }
				let message: Record<string, unknown>;
				try {
					message = JSON.parse(raw);
					if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error();
				} catch { ws.close(1008, 'Invalid message'); return; }
				if (data.user === null) {
					const ticket = message.type === 'authenticate' && message.protocol === COMBAT_PROTOCOL ? verify_ticket(message.ticket, options.key) : null;
					if (!ticket || used_tickets.has(ticket.jti) || users.has(ticket.sub) || used_tickets.size >= 4096) {
						ws.close(1008, 'Admission rejected'); return;
					}
					used_tickets.set(ticket.jti, ticket.exp);
					data.user = ticket.sub;
					users.set(ticket.sub, ws);
					if (Array.isArray(message.capabilities) && message.capabilities.includes('state-delta-v1')) data.snapshots = create_snapshot_stream();
					send(ws, { type: 'ready', protocol: COMBAT_PROTOCOL, encounters: SUPPORTED_ENCOUNTERS, ...(data.snapshots ? { capabilities: ['state-delta-v1'] } : {}) });
					return;
				}
				if (message.type === 'heartbeat') { data.heartbeat = now; send(ws, { type: 'heartbeat' }); return; }
				if (!Number.isSafeInteger(message.seq) || (message.seq as number) <= 0) { ws.close(1008, 'Invalid sequence'); return; }
				const seq = message.seq as number;
				if (seq <= data.seq) { send(ws, { type: 'ack', seq, accepted: false }); return; }
				if (seq !== data.seq + 1) { ws.close(1008, 'Sequence gap'); return; }
				data.seq = seq;
				let accepted = false;
				if (data.busy) { send(ws,{ type:'ack',seq,accepted:false }); return; }
				data.busy = true;
				try {
				if (message.type === 'start' && data.arena?.status !== 'active' && now >= data.start_after && valid_run(message.encounter ?? 'golbin', message.mode ?? 'once') && (message.stance === undefined || ['accurate','aggressive','defensive'].includes(String(message.stance)))) {
					const id = crypto.randomUUID();
					const admission = await authority.reserve(data.user,id,String(message.encounter ?? 'golbin'),String(message.mode ?? 'once'));
					if (admission) {
						if (!sockets.has(ws)) { await authority.progress(id,0,'interrupted'); return; }
						data.arena = create_run(admission.registration,{ heal: admission.heal, auto_eat: admission.auto_eat },id,message.encounter === undefined ? 'golbin' : message.encounter as Encounter, (message.mode ?? 'once') as RunMode, admission.raid_endpoint);
						data.arena.food_id = admission.food_id;
						if (message.stance !== undefined) run_command(data.arena,'stance',message.stance);
						data.start_after = now + 2000; accepted = true;
					}
				} else if (message.type === 'command' && data.arena && message.encounter === data.arena.id) {
					const arena = structuredClone(data.arena);
					accepted = run_command(arena, message.action, message.target);
					if (accepted) accepted = await commit(ws,arena);
				}
				} catch { ws.close(1011,'Combat authority failure'); }
				finally { data.busy = false; }
				send(ws, { type: 'ack', seq, accepted });
				send_state(ws, now);
			},
			close(ws) {
				sockets.delete(ws);
				if (ws.data.user !== null && users.get(ws.data.user) === ws) users.delete(ws.data.user);
				const arena = ws.data.arena;
				if (arena?.status === 'active') void authority.progress(arena.id,arena.food_used,'interrupted');
				ws.data.arena = null;
			}
		}
	});
	let previous = clock(), accumulator = 0, next_broadcast = previous + SNAPSHOT_MS;
	const timer = setInterval(() => {
		const now = clock(), elapsed = now - previous;
		previous = now;
		// An overloaded/suspended process aborts rather than fast-forwarding a hidden fight.
		if (elapsed > 1000) {
			accumulator = 0;
			for (const ws of sockets) ws.close(1012, 'Combat interrupted');
			return;
		}
		accumulator += elapsed;
		for (const ws of sockets) {
			if ((ws.data.user === null && now - ws.data.opened > 5000) || now - ws.data.heartbeat > 10_000 || now - ws.data.opened > 15 * 60_000) {
				ws.close(1008, 'Session expired');
			}
		}
		while (accumulator >= STEP_MS) {
			accumulator -= STEP_MS;
			for (const ws of sockets) if (ws.data.arena?.status === 'active' && !ws.data.busy && now - ws.data.heartbeat <= 10_000) {
				const arena = structuredClone(ws.data.arena); step_run(arena, options.random);
				ws.data.busy = true;
				void commit(ws,arena).catch(() => ws.close(1011,'Combat authority failure')).finally(() => { ws.data.busy = false; });
			}
		}
		if (now >= next_broadcast) {
			next_broadcast += (Math.floor((now - next_broadcast) / SNAPSHOT_MS) + 1) * SNAPSHOT_MS;
			for (const ws of sockets) if (ws.data.arena) send_state(ws, now);
		}
		for (const [id, expires] of used_tickets) if (expires <= Date.now()) used_tickets.delete(id);
	}, STEP_MS);
	timer.unref();
	return { server, stop() { clearInterval(timer); for (const ws of sockets) ws.close(1001, 'Service stopped'); server.stop(true); authority.stop(); } };
}
