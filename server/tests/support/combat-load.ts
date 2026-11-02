// Isolated, reward-free loopback benchmark. Never connects to the deployed combat service or database.
import { start_combat_service } from '../../combat/service';
import { COMBAT_PROTOCOL, issue_ticket } from '../../combat/tickets';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create_test_database } from './database';
import { prepare_combat } from '../../combat-progression';
import { debug_dungeon } from '../../combat-dungeon-debug';
import { combat_state, combat_inventory_response, reserve_combat, update_combat } from '../../combat-inventory';
import { equipment_catalog_response } from '../../equipment-projects';

const seconds = Number(process.env.COMBAT_LOAD_STAGE_SECONDS ?? 15);
if (!Number.isInteger(seconds) || seconds < 5 || seconds > 60) throw new Error('Stage duration must be 5–60 seconds');
const deltas = process.env.COMBAT_LOAD_DELTA === '1';
const durable = process.env.COMBAT_LOAD_DATABASE === '1';
const key = crypto.randomUUID().replaceAll('-', '').repeat(2);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values: number[], fraction: number) => values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)] : 0;
const registration = { levels: { attack:99, strength:99, defence:99, hitpoints:99 }, gear: { Weapon:'melvorD:Bronze_Sword' } };
// The default adapter measures simulation/streaming; opt in to real disposable database work below.
const authority = { reserve: async () => ({registration,food_id:'melvorD:Shrimp',heal:30}), progress: async () => true, stop() {} };
for (const clients of [25, 50, 100]) {
	const directory = durable ? mkdtempSync(join(tmpdir(), 'combat-load-')) : null;
	const database = directory ? create_test_database(join(directory, 'combat.sqlite')) : null;
	let writes = 0, reads = 0, inventory_bytes = 0;
	if (database) {
		database.run('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
		for (let client=1;client<=clients;client++) {
			database.query('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(?,?,?,?,?,?)').run(client,String(client),'test',String(client),'Load Test','melvorD:Plant');
			prepare_combat(database,client);
			const result = debug_dungeon(database,client,crypto.randomUUID(),{target:'quarry:2',confirm:true,revision:0,
				levels:{attack:21,strength:21,defence:21,hitpoints:21},food:'melvorD:Herring',gear:Object.fromEntries(
				['Sword','Shield','Helmet','Platebody','Platelegs','Boots','Gloves'].map((item,i)=>[i===0?'Weapon':item,`melvorD:Steel_${item}`]))});
			if (!result.success) throw new Error('Load fixture rejected');
			inventory_bytes += JSON.stringify(combat_state(database,client)).length; reads++;
		}
	}
	const durable_authority = database ? {
		reserve: async (client:number,id:string,selection?:string,mode?:string) => reserve_combat(database,client,'benchmark',id,selection,mode),
		progress: async (id:string,used:number,status:string,completed?:number) => { writes++; return update_combat(database,'benchmark',id,used,status,completed); },
		stop() {}
	} : authority;
	const service = start_combat_service({ key, hostname: '127.0.0.1', port: 0, authority: durable_authority });
	const sockets: WebSocket[] = [], heartbeats: ReturnType<typeof setInterval>[] = [];
	let snapshots = 0, bytes = 0, failures = 0, started = 0, measuring = false, rss = 0;
	const gaps: number[] = [], drift: number[] = [];
	try {
		await Promise.all(Array.from({ length: clients }, (_, index) => new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${service.server.port}/combat/socket`, { headers: { Origin: 'https://melvoridle.com' } });
			sockets.push(ws);
			let sequence = 0, start_sequence = 0, last = 0, anchor = 0, arena_id = '';
			let snapshot: any = null;
			const timeout = setTimeout(() => reject(new Error('Admission timed out')), 5000);
			ws.onopen = () => ws.send(JSON.stringify({ type: 'authenticate', protocol: COMBAT_PROTOCOL, ticket: issue_ticket(index + 1, key), ...(deltas ? { capabilities:['state-delta-v1'] } : {}) }));
			ws.onerror = () => reject(new Error('Socket failed'));
			ws.onclose = () => { if (measuring) failures++; };
			const start = () => { start_sequence = ++sequence; ws.send(JSON.stringify({ type: 'start', seq: start_sequence, ...(durable ? {encounter:'quarry',mode:'raid'} : {}) })); };
			ws.onmessage = event => {
				const message = JSON.parse(String(event.data));
				if (measuring) bytes += Buffer.byteLength(String(event.data));
				if (message.type === 'ready') {
					clearTimeout(timeout); start();
					heartbeats.push(setInterval(() => {
						if (ws.readyState !== 1) return;
						ws.send(JSON.stringify({ type: 'heartbeat' }));
						if (durable && snapshot?.status === 'active' && snapshot.player.hp < snapshot.player.max_hp)
							ws.send(JSON.stringify({type:'command',seq:++sequence,encounter:snapshot.id,action:'eat'}));
					}, 2000));
				}
				// Cooldown-rejected eat commands are expected; a rejected start is not.
				if (message.type === 'ack' && !message.accepted && (!durable || message.seq === start_sequence)) failures++;
				if (message.type === 'state') snapshot = message.arena;
				else if (message.type === 'state_delta' && snapshot) {
					for (const [path, ...value] of message.changes) {
						let target = snapshot;
						for (const key of path.slice(0, -1)) target = target[key];
						if (value.length) target[path.at(-1)] = value[0]; else delete target[path.at(-1)];
					}
				} else return;
				if (!snapshot) return;
				const now = performance.now(), arena = snapshot;
				if (arena.id !== arena_id) { arena_id = arena.id; anchor = now - arena.elapsed_ms; last = 0; started++; resolve(); }
				if (measuring) { snapshots++; if (last) gaps.push(now - last); drift.push(now - anchor - arena.elapsed_ms); }
				last = now;
				if (arena.status !== 'active') {
					if (database) { inventory_bytes += JSON.stringify(combat_state(database,index+1)).length; reads++; }
					start();
				}
			};
		})));
		await sleep(1000);
		const cpu = process.cpuUsage(), begin = performance.now();
		measuring = true;
		const sample = setInterval(() => { rss = Math.max(rss, process.memoryUsage().rss); }, 250);
		const read_times: number[] = [];
		const inventory_burst = database ? setInterval(() => {
			for (let client=1;client<=clients;client++) {
				const before = performance.now(), state = combat_state(database,client);
				const url = new URL(`http://localhost/api/combat/inventory?practice_catalog=${state.practice_catalog_revision}&equipment_catalog=${state.equipment_projects.catalog_revision}`);
				inventory_bytes += JSON.stringify(combat_inventory_response(equipment_catalog_response(state,url),url)).length;
				reads++; read_times.push(performance.now()-before);
			}
		},5000) : null;
		await sleep(seconds * 1000);
		clearInterval(sample); if (inventory_burst) clearInterval(inventory_burst); measuring = false;
		const duration = performance.now() - begin, used = process.cpuUsage(cpu);
		const result = { deltas, durable, clients, seconds, started, failures, writes, inventory_reads:reads, inventory_bytes,
			inventory_read_p95_ms:percentile(read_times,.95), snapshots, snapshots_per_client_sec: snapshots / clients / (duration / 1000),
			outbound_kib_sec: bytes / 1024 / (duration / 1000), combined_cpu_one_core_percent: (used.user + used.system) / (duration * 10),
			combined_peak_rss_mib: rss / 1024 / 1024, snapshot_gap_p95_ms: percentile(gaps, .95), snapshot_gap_max_ms: Math.max(0, ...gaps),
			clock_drift_p95_ms: percentile(drift, .95), clock_drift_max_ms: Math.max(0, ...drift) };
		console.log(JSON.stringify(result));
		if (failures || snapshots < clients * seconds * 3 || result.clock_drift_max_ms > 1000) throw new Error('Load acceptance bounds failed');
	} finally {
		measuring = false;
		for (const timer of heartbeats) clearInterval(timer);
		for (const ws of sockets) ws.close();
		service.stop();
		// Allow close handlers to settle active fights before closing the file-backed database.
		if (database) await sleep(100);
		database?.close();
		if (directory) rmSync(directory,{recursive:true,force:true});
	}
}
