import type { Registration } from './catalog';
export type CombatAdmission = { registration: Registration; food_id: string; heal: number; auto_eat?: boolean; raid_endpoint?: number };
export type CombatAuthority = { reserve(client: number, encounter: string, selection?: string, mode?: string): Promise<CombatAdmission | null>; progress(encounter: string, used: number, status: string, completed?: number): Promise<boolean>; recovery?: (action: string, payload?: Record<string, unknown>) => Promise<any>; on_shutdown?: (callback: () => Promise<void>) => void; stop(): void };
export function connect_authority(url: string, key: string, lost: () => void): CombatAuthority {
	let socket: WebSocket | null = null, stopped = false, heartbeat: ReturnType<typeof setInterval> | undefined;
	let shutdown_callback: (() => Promise<void>) | undefined;
	let retry: ReturnType<typeof setTimeout> | undefined, last_received = 0;
	const pending = new Map<string, { resolve(value: any): void; timer: ReturnType<typeof setTimeout> }>();
	function failed() {
		if (!socket) return;
		const old = socket; socket = null; old.close();
		clearInterval(heartbeat);
		for (const request of pending.values()) { clearTimeout(request.timer); request.resolve(null); }
		pending.clear(); lost();
		if (!stopped) retry = setTimeout(connect,2000);
	}
	function connect() {
		const ws = socket = new WebSocket(url,{ headers: { Authorization: `Bearer ${key}` } });
		last_received = performance.now();
		ws.onopen = () => { heartbeat = setInterval(() => {
			if (performance.now()-last_received > 6000) { failed(); return; }
			ws.send('{"type":"heartbeat"}');
		},2000); };
		ws.onmessage = event => {
			if (socket !== ws) return;
			last_received = performance.now();
			try {
				const response = JSON.parse(String(event.data));
				if (response.type === 'shutdown') { void shutdown_callback?.().finally(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'drained'})); }); return; }
				const request = pending.get(response.id);
				if (request) { pending.delete(response.id); clearTimeout(request.timer); request.resolve(response.result); }
			} catch { failed(); }
		};
		ws.onclose = ws.onerror = () => { if (socket === ws) failed(); };
	}
	function request(payload: Record<string, unknown>): Promise<any> {
		if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 65536 || pending.size >= 256) return Promise.resolve(null);
		const id = crypto.randomUUID();
		return new Promise(resolve => {
			const timer = setTimeout(failed,3000); pending.set(id,{ resolve,timer });
			try { socket!.send(JSON.stringify({ ...payload,id })); } catch { failed(); }
		});
	}
	connect();
	return { recovery: (action,payload = {}) => request({type:'recovery',action,...payload}),
		on_shutdown: callback => { shutdown_callback = callback; }, reserve: (client,encounter,selection,mode) => request({ type:'reserve',client,encounter,selection,mode }),
		progress: async (encounter,used,status,completed) => await request({ type:'progress',encounter,used,status,completed }) === true,
		stop() { stopped = true; clearTimeout(retry); failed(); } };
}
