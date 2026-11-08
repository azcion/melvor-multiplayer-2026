import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issue_ticket } from '../../combat/tickets';
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { prepare_combat } from '../../combat-progression';
import { reserve_combat, interrupt_combats, update_combat } from '../../combat-inventory';
import { create_run, step_run } from '../../combat/runs';
import { combat_available, combat_availability, combat_drain_status, wait_combat_drain, save_recovery, pause_recovery, resume_recovery, read_recovery, abandon_recovery, set_combat_drain, invalidate_recovery, RETENTION_MS } from '../../combat-recovery';
function fixture(path = ':memory:') {
	const db = create_test_database(path);
	db.query('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,?,?,?,?,?)').run(crypto.randomUUID(),'key','111-222-333','Recovery Test','melvorD:Plant');
	prepare_combat(db,101); db.run('UPDATE combat_tutorial SET victories=7 WHERE client_id=101');
	const admission = reserve_combat(db,101,'first','battle','golbin')!;
	const arena = create_run(admission.registration,{heal:admission.heal},'battle','golbin','once');
	return {db,arena};
}
test('intelligent drain counts legacy fights, blocks admission and returns as soon as the final fight finishes', async () => {
	const {db} = fixture();
	try {
		expect(combat_drain_status(db)).toMatchObject({ready:false,running_battles:1});
		await expect(wait_combat_drain(db,()=>{})).rejects.toThrow('Enable a combat drain');
		set_combat_drain(db,5);
		expect(combat_drain_status(db)).toMatchObject({ready:false,running_battles:1,paused_battles:0});
		const reports: boolean[] = [];
		await wait_combat_drain(db,status=>{
			reports.push(status.ready);
			if (!status.ready) expect(update_combat(db,'first','battle',0,'fled')).toBe(true);
		});
		expect(reports).toEqual([false,true]);
		expect(reserve_combat(db,101,'second','new','golbin')).toBeNull();
		set_combat_drain(db,null);
		expect(combat_drain_status(db).ready).toBe(false);
		expect(reserve_combat(db,101,'second','new','golbin')).not.toBeNull();
	} finally {db.close();}
});
test('compatible drain skips paused and delivered-result waiting; incompatible drain waits for invalidation', async () => {
	const {db,arena} = fixture();
	try {
		save_recovery(db,'first',arena,0,true);
		set_combat_drain(db,5);
		expect(combat_drain_status(db)).toMatchObject({running_battles:1,paused_battles:0,ready:false});
		pause_recovery(db);
		expect(combat_drain_status(db)).toMatchObject({running_battles:0,paused_battles:1,ready:true});
		await wait_combat_drain(db,()=>{});
		expect(resume_recovery(db,101,'second','battle')).toBeNull();
		set_combat_drain(db,5,true);
		expect(combat_drain_status(db).ready).toBe(false);
		invalidate_recovery(db);
		expect(combat_drain_status(db)).toMatchObject({running_battles:0,paused_battles:0,ready:true});
		await wait_combat_drain(db,()=>{});
		expect(read_recovery(db,101)?.state).toBe('terminal');
	} finally {db.close();}
});
test('drain waiter fails closed if the gate changes or the combat service misses its deadline', async () => {
	const {db} = fixture();
	try {
		set_combat_drain(db,5);
		await expect(wait_combat_drain(db,()=>set_combat_drain(db,null))).rejects.toThrow('changed while waiting');
		set_combat_drain(db,0,false,Date.now()-20_000);
		await expect(wait_combat_drain(db,()=>{})).rejects.toThrow('did not finish');
		expect(combat_drain_status(db)).toMatchObject({running_battles:1,ready:false});
		expect(combat_drain_status(db).drain_at).not.toBeNull();
	} finally {db.close();}
});
test('checkpoint survives interruption, resumes once, fences stale controller and preserves timers', () => {
	const {db,arena} = fixture();
	try {
		for (let i=0;i<12;i++) step_run(arena,()=>.5);
		expect(save_recovery(db,'first',arena,0,true)).toBe(1);
		pause_recovery(db,'first'); interrupt_combats(db);
		expect(read_recovery(db,101)).toMatchObject({state:'paused',arena:{elapsed_ms:1200},remaining_ms:RETENTION_MS});
		expect(reserve_combat(db,101,'other','another')).toBeNull();
		const restored = resume_recovery(db,101,'second','battle')!;
		expect(restored.arena).toEqual(arena);
		expect(resume_recovery(db,101,'third','battle')).toBeNull();
		expect(save_recovery(db,'first',arena,restored.revision)).toBeNull();
		expect(save_recovery(db,'second',arena,1)).toBeNull();
		expect(save_recovery(db,'second',arena,restored.revision)).toBe(restored.revision+1);
	} finally { db.close(); }
});
test('retention spends only healthy service time and freezes through long outages and drain', () => {
	const {db,arena} = fixture();
	try {
		save_recovery(db,'first',arena,0,true); pause_recovery(db);
		combat_available(db,100_000); combat_available(db,102_000);
		expect(read_recovery(db,101)!.remaining_ms).toBe(RETENTION_MS-2000);
		combat_available(db,10_000_000);
		expect(read_recovery(db,101)!.remaining_ms).toBe(RETENTION_MS-2000);
		set_combat_drain(db,5,false,10_000_000); combat_available(db,10_002_000);
		expect(read_recovery(db,101)!.remaining_ms).toBe(RETENTION_MS-2000);
		expect(resume_recovery(db,101,'second','battle')).toBeNull();
		set_combat_drain(db,null,false,10_002_000);
		for (let now=10_004_000;now<=11_804_000;now+=2000) combat_available(db,now);
		expect(read_recovery(db,101)).toMatchObject({state:'terminal',arena:{status:'expired'}});
		expect(abandon_recovery(db,102,'battle')).toBe(false);
		expect(abandon_recovery(db,101,'battle')).toBe(true);
		expect(read_recovery(db,101)).toBeNull();
	} finally {db.close();}
});
test('terminal checkpoints survive reconnect until acknowledged and incompatibility ends paused battles', () => {
	const {db,arena} = fixture();
	try {
		save_recovery(db,'first',arena,0,true);
		arena.status='fled';
		expect(save_recovery(db,'first',arena,1)).toBe(2);
		pause_recovery(db);
		expect(read_recovery(db,101)).toMatchObject({state:'terminal',arena:{status:'fled'}});
		expect(abandon_recovery(db,101,'wrong')).toBe(false);
		expect(abandon_recovery(db,101,'battle')).toBe(true);
	} finally {db.close();}
	const second=fixture();
	try {
		save_recovery(second.db,'first',second.arena,0,true); pause_recovery(second.db); invalidate_recovery(second.db);
		expect(read_recovery(second.db,101)).toMatchObject({state:'terminal',arena:{status:'expired'}});
	} finally {second.db.close();}
});

test('global maintenance freezes retention and outage recovery grants a five-minute minimum', () => {
	const {db,arena}=fixture();
	try {
		save_recovery(db,'first',arena,0,true); pause_recovery(db);
		combat_available(db,100_000);
		db.query("UPDATE combat_recovery SET expires=?").run(combat_availability(db).clock+60_000);
		db.query("INSERT INTO service_settings(key,value) VALUES('maintenance','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
		combat_available(db,102_000);
		expect(read_recovery(db,101)!.remaining_ms).toBe(60_000);
		expect(resume_recovery(db,101,'second','battle')).toBeNull();
		db.query("UPDATE service_settings SET value='0' WHERE key='maintenance'").run();
		combat_available(db,10_000_000);
		expect(read_recovery(db,101)!.remaining_ms).toBe(5*60_000);
		expect(read_recovery(db,101)!.remaining_ms).toBe(5*60_000);
		combat_available(db,10_002_000);
		expect(read_recovery(db,101)!.remaining_ms).toBe(5*60_000-2000);
	} finally {db.close();}
});
test('unsupported checkpoint format ends safely and a lost checkpoint acknowledgement cannot replay progress', () => {
	const {db,arena}=fixture();
	try {
		expect(save_recovery(db,'first',arena,0,true)).toBe(1);
		db.query("UPDATE combat_encounters SET food_id='melvorD:Shrimp' WHERE id='battle'").run();
		const changed=structuredClone(arena); changed.food_used=1;
		expect(save_recovery(db,'first',changed,1)).toBe(2);
		expect(save_recovery(db,'first',arena,1)).toBeNull();
		pause_recovery(db);
		expect(read_recovery(db,101)!.arena.food_used).toBe(1);
		db.query('UPDATE combat_recovery SET format=999').run();
		expect(read_recovery(db,101)).toMatchObject({state:'terminal',arena:{status:'expired'}});
		expect(resume_recovery(db,101,'second','battle')).toBeNull();
	} finally {db.close();}
});

async function until(check: () => boolean, timeout = 8000) {
	const deadline=Date.now()+timeout;
	while (!check()) { if (Date.now()>deadline) throw new Error('Recovery fixture timed out'); await Bun.sleep(20); }
}
test('real processes recover after combat SIGKILL, authority SIGKILL and graceful shutdown', async () => {
	const directory=mkdtempSync(join(tmpdir(),'combat-recovery-')), path=join(directory,'combat.sqlite'), key='ab'.repeat(32);
	const {db}=fixture(path); db.query("UPDATE combat_encounters SET status='fled'").run(); db.close();
	const children: ReturnType<typeof Bun.spawn>[]=[]; const sockets: WebSocket[]=[];
	async function launch(mode:string,address:string,port=0) {
		const child=Bun.spawn(['bun','./tests/support/combat-recovery-process.ts',mode,address,key,String(port)],{stdout:'pipe',stderr:'inherit'}); children.push(child);
		const reader=(child.stdout as ReadableStream<Uint8Array>).getReader();
		const {value}=await reader.read(); reader.releaseLock();
		const actual=Number(new TextDecoder().decode(value).trim()); if (!actual) throw new Error('Missing fixture port');
		return {child,port:actual};
	}
	async function open(port:number) {
		const ws=new WebSocket(`ws://127.0.0.1:${port}/combat/socket`); sockets.push(ws); const messages:any[]=[];
		ws.onmessage=event=>messages.push(JSON.parse(String(event.data)));
		await until(()=>ws.readyState===1);
		ws.send(JSON.stringify({type:'authenticate',protocol:4,ticket:issue_ticket(101,key),capabilities:['pve-recovery-v1']}));
		await until(()=>messages.some(m=>m.type==='ready'));
		let sequence=0;
		return {ws,messages,async command(payload:object) {const seq=++sequence;ws.send(JSON.stringify({...payload,seq})); await until(()=>messages.some(m=>m.type==='ack'&&m.seq===seq)); expect(messages.find(m=>m.type==='ack'&&m.seq===seq).accepted).toBe(true);}};
	}
	try {
		let authority=await launch('authority',path), service=await launch('service',`ws://127.0.0.1:${authority.port}/authority`);
		await Bun.sleep(200);
		let client=await open(service.port); await client.command({type:'start',encounter:'golbin',mode:'once'});
		await until(()=>client.messages.some(m=>m.arena));
		const id=client.messages.find(m=>m.arena).arena.id;
		const observer = new Database(path, { readonly:true });
		let confirmed_elapsed = 0;
		try {
			await until(() => {
				const row = observer.query<{checkpoint:string}, [string]>('SELECT checkpoint FROM combat_recovery WHERE encounter_id=?').get(id);
				confirmed_elapsed = row ? JSON.parse(row.checkpoint).elapsed_ms : 0;
				return confirmed_elapsed >= 2000;
			});
		} finally { observer.close(); }
		service.child.kill('SIGKILL'); await service.child.exited; await Bun.sleep(200);
		service=await launch('service',`ws://127.0.0.1:${authority.port}/authority`); await Bun.sleep(200);
		client=await open(service.port);await client.command({type:'recover'});
		const saved=client.messages.find(m=>m.type==='recovery').saved;
		expect(saved.state).toBe('paused'); expect(saved.arena.id).toBe(id);expect(saved.arena.elapsed_ms).toBeGreaterThanOrEqual(confirmed_elapsed);
		await Bun.sleep(250);expect(client.messages.some(m=>m.type==='state'&&m.arena?.status==='active')).toBe(false);
		await client.command({type:'resume',encounter:id});
		await until(()=>client.messages.some(m=>m.arena?.status==='active'));
		authority.child.kill('SIGKILL');await authority.child.exited;
		await until(()=>client.ws.readyState===3);
		authority=await launch('authority',path,authority.port);await Bun.sleep(2300);
		client=await open(service.port);await client.command({type:'recover'});
		expect(client.messages.find(m=>m.type==='recovery').saved.state).toBe('paused');
		await client.command({type:'resume',encounter:id});
		authority.child.kill('SIGTERM');expect(await authority.child.exited).toBe(0);
		authority=await launch('authority',path,authority.port);await Bun.sleep(2300);
		client=await open(service.port);await client.command({type:'recover'});
		expect(client.messages.find(m=>m.type==='recovery').saved.arena.id).toBe(id);
		await client.command({type:'abandon',encounter:id});
		await client.command({type:'recover'});expect(client.messages.filter(m=>m.type==='recovery').at(-1).saved).toBeNull();
	} finally {
		for (const ws of sockets) ws.close();
		for (const child of children) if (child.exitCode===null) child.kill('SIGKILL');
		await Promise.all(children.map(child=>child.exited)); rmSync(directory,{recursive:true,force:true});
	}
},30000);
