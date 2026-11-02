import { create_run, step_run, run_command, valid_run, RESPAWN_MS } from '../../combat/runs';
import { favorable_damage_order } from '../../combat/damage';
import { expect, test } from 'bun:test';
import { create_arena, create_registered_arena, parse_build, command, step, STEP_MS, resolve_player_damage, ENCOUNTERS, SUPPORTED_ENCOUNTERS } from '../../combat/engine';
import { issue_ticket, verify_ticket } from '../../combat/tickets';
import type { CombatAuthority } from '../../combat/authority-client';
import { start_combat_service } from '../../combat/service';

const key = 'a'.repeat(64);
const authority: CombatAuthority = { reserve: async () => ({ registration: { levels: { attack:99,strength:99,defence:99,hitpoints:99 },gear: {} }, food_id:'melvorD:Shrimp', heal:30 }), progress: async () => true, stop() {} };
const build = { loadout: 'sword' as const, attack: 99, strength: 99, defence: 99, hitpoints: 99 };

test('builds cap levels and ignore forged derived stats; reject invalid levels and unknown gear', () => {
	expect(parse_build({ ...build, attack: 9999, hp: 99999, damage: 99999 })).toEqual(build);
	for (const level of [NaN, Infinity, -1, 0, 1.5, '99']) expect(parse_build({ ...build, attack: level })).toBeNull();
	expect(parse_build({ ...build, loadout: '__proto__' })).toBeNull();
});

test('only server ticks advance combat; target commands do not grant attacks', () => {
	const arena = create_arena(parse_build(build)!);
	for (let i = 0; i < 100; i++) command(arena, 'target', 'scout');
	expect(arena.enemies[1].hp).toBe(160);
	expect(command(arena, 'damage', 99999)).toBe(false);
	for (let i = 0; i < 24; i++) step(arena, () => 0);
	expect(arena.elapsed_ms).toBe(2400);
	expect(arena.enemies[1].hp).toBe(159);
	expect(arena.target).toBe('scout');
});

test('published hit statistics are the same values used to resolve attacks', () => {
	for (const loadout of ['sword', 'bow', 'staff'] as const) {
		const arena = create_arena(parse_build({ ...build, loadout, stats: { max_hit: 99999 } })!);
		expect(arena.player.stats.max_hit).toBe(({ sword: 36, bow: 33, staff: 42 })[loadout]);
		expect(arena.player.stats.hit_chance).toBeCloseTo(.95);
		arena.player.next_attack = 100;
		const rolls = [0, .999999];
		step(arena, () => rolls.shift() ?? .999999);
		expect(arena.log[0].amount).toBe(arena.player.stats.max_hit);
		const miss = create_arena(parse_build({ ...build, loadout })!);
		miss.player.next_attack = 100;
		step(miss, () => miss.player.stats.hit_chance);
		expect(miss.log[0].amount).toBe(0);
	}
	const arena = create_arena(parse_build(build)!);
	arena.enemies[0].next_attack = 100;
	const rolls = [0, .999999];
	step(arena, () => rolls.shift() ?? .999999);
	expect(arena.log[0].amount).toBe(arena.enemies[0].stats.max_hit);
	expect(arena.food_policy.heal).toBe(45);
});

test('food heals once per activation, manual eating interrupts, and lethal damage bypasses auto eat', () => {
	const arena = create_arena(parse_build(build)!);
	arena.player.hp = 200;
	arena.elapsed_ms = 500;
	expect(command(arena, 'eat', null)).toBe(true);
	expect(arena.food_used).toBe(1);
	expect(arena.player.next_attack).toBe(2900);
	expect(command(arena, 'eat', null)).toBe(false);
	arena.player.hp = 1;
	arena.enemies[0].next_attack = 600;
	step(arena, () => 0);
	expect(arena.status).toBe('defeat');
	expect(arena.food_used).toBe(1);
	const elapsed = arena.elapsed_ms;
	step(arena);
	expect(arena.elapsed_ms).toBe(elapsed);
});

test('manual eating at full HP counts a portion, interrupts attacks and shares the cooldown', () => {
	const arena = create_arena(parse_build(build)!);
	arena.elapsed_ms = 500;
	const hp = arena.player.max_hp;
	expect(command(arena, 'eat', null)).toBe(true);
	expect(arena.player.hp).toBe(hp);
	expect(arena.food_used).toBe(1);
	expect(arena.player.next_attack).toBe(500 + arena.player.interval);
	expect(arena.next_eat).toBe(15);
	expect(command(arena, 'eat', null)).toBe(false);
	arena.elapsed_ms = 1500;
	expect(command(arena, 'eat', null)).toBe(true);
	expect(arena.food_used).toBe(2);
	arena.elapsed_ms = 2500;
	arena.food = 0;
	expect(command(arena, 'eat', null)).toBe(false);
});

test('server auto eat consumes one unlimited portion and terminal fights cannot be manipulated', () => {
	const arena = create_arena(parse_build(build)!);
	arena.player.hp = 100;
	arena.enemies[0].next_attack = 50;
	step(arena, () => 0);
	expect(arena.food_used).toBe(1);
	expect(arena.player.hp).toBe(140);
	expect(command(arena, 'flee', null)).toBe(true);
	expect(command(arena, 'target', 'scout')).toBe(false);
	expect(command(arena, 'eat', null)).toBe(false);
});

test('tickets reject tampering, wrong service key and expiry', () => {
	const token = issue_ticket(1, key, 1000);
	expect(verify_ticket(token, key, 1000)?.sub).toBe(1);
	expect(verify_ticket(token, 'b'.repeat(64), 1000)).toBeNull();
	expect(verify_ticket(token + 'x', key, 1000)).toBeNull();
	expect(verify_ticket(token, key, 31000)).toBeNull();
});

function client(port: number, origin: string | null = 'https://melvoridle.com') {
	const ws = new WebSocket(`ws://127.0.0.1:${port}/combat/socket`, { headers: origin === null ? {} : { Origin: origin } });
	const messages: any[] = [];
	let wake: (() => void) | null = null;
	ws.addEventListener('message', event => { messages.push(JSON.parse(String(event.data))); wake?.(); });
	const opened = new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = reject; });
	const closed = new Promise<number>(resolve => ws.onclose = event => resolve(event.code));
	async function next(type: string): Promise<any> {
		const deadline = Date.now() + 3000;
		while (true) {
			const index = messages.findIndex(message => message.type === type);
			if (index >= 0) return messages.splice(index, 1)[0];
			if (Date.now() > deadline) throw new Error(`Missing ${type}`);
			await new Promise<void>(resolve => { const timer = setTimeout(resolve, 100); wake = () => { clearTimeout(timer); resolve(); }; });
		}
	}
	return { ws, opened, closed, next, send: (value: unknown) => ws.send(JSON.stringify(value)) };
}

test('real socket authenticates once, streams states, deduplicates actions and rejects ticket replay', async () => {
	const service = start_combat_service({ key, authority, port: 0, hostname: '127.0.0.1' });
	const a = client(service.server.port!);
	try {
		await a.opened;
		const ticket = issue_ticket(12, key);
		a.send({ type: 'authenticate', protocol: 4, ticket });
		await a.next('ready');
		a.send({ type: 'start', seq: 1, encounter: 'golbins', food_id: 'melvorD:Shrimp', budget: 8, build: { ...build, attack: 1000 } });
		expect((await a.next('ack')).accepted).toBe(true);
		const state = (await a.next('state')).arena;
		expect(state.build.attack).toBe(99);
		let streamed = (await a.next('state')).arena;
		while (streamed.run.phase === 'respawning') streamed = (await a.next('state')).arena;
		expect(streamed.elapsed_ms).toBeGreaterThan(0);
		expect(streamed.id).toBe(state.id);
		a.send({ type: 'command', seq: 2, encounter: state.id, action: 'target', target: 'golbin_scout' });
		expect((await a.next('ack')).accepted).toBe(true);
		a.send({ type: 'command', seq: 2, encounter: state.id, action: 'flee' });
		expect((await a.next('ack')).accepted).toBe(false);
		a.send({ type: 'command', seq: 3, encounter: 'another-fight', action: 'flee' });
		expect((await a.next('ack')).accepted).toBe(false);
		const b = client(service.server.port!);
		await b.opened;
		b.send({ type: 'authenticate', protocol: 4, ticket });
		expect(await b.closed).toBe(1008);
		a.ws.close(); await a.closed;
		const c = client(service.server.port!); await c.opened;
		c.send({ type: 'authenticate', protocol: 4, ticket: issue_ticket(12, key) });
		await c.next('ready');
		c.send({ type: 'command', seq: 1, encounter: state.id, action: 'eat' });
		expect((await c.next('ack')).accepted).toBe(false);
		expect((await c.next('state')).arena).toBeNull();
		c.ws.close(); await c.closed;
	} finally { a.ws.close(); service.stop(); }
});

test('socket supports web, Steam, native and custom origins while requiring signed tickets', async () => {
	const service = start_combat_service({ key, authority, port: 0, hostname: '127.0.0.1' });
	try {
		for (const origin of ['https://melvoridle.com', 'https://www.melvoridle.com', 'https://play.melvoridle.com',
			'https://steam.melvoridle.com', 'https://android.melvoridle.com', 'https://ios.melvoridle.com',
			'null', 'capacitor://localhost', 'http://localhost:8080', 'https://example.invalid', null]) {
			const a = client(service.server.port!, origin);
			try {
				await a.opened;
				a.send({ type: 'authenticate', protocol: 4, ticket: 'forged' });
				expect(await a.closed).toBe(1008);
			} finally { a.ws.close(); }
			const b = client(service.server.port!, origin);
			try {
				await b.opened;
				b.send({ type: 'authenticate', protocol: 4, ticket: issue_ticket(42, key) });
				expect((await b.next('ready')).protocol).toBe(4);
			} finally { b.ws.close(); await b.closed; }
		}
	} finally { service.stop(); }
});

test('explicit socket origin restrictions remain available for self-hosting', async () => {
	const service = start_combat_service({ key, authority, port: 0, hostname: '127.0.0.1', origins: ['https://melvoridle.com'] });
	try {
		const url = `http://127.0.0.1:${service.server.port}/combat/socket`;
		expect((await fetch(url, { headers: { Origin: 'https://example.invalid' } })).status).toBe(403);
		expect((await fetch(url)).status).toBe(403);
		expect((await fetch(url, { headers: { Origin: 'https://melvoridle.com' } })).status).toBe(400);
	} finally { service.stop(); }
});

test('socket refuses invalid tickets, sequence gaps and excessive messages', async () => {
	const service = start_combat_service({ key, authority, port: 0, hostname: '127.0.0.1' });
	try {
		for (const mode of ['ticket', 'protocol', 'sequence', 'flood']) {
			const a = client(service.server.port!); await a.opened;
			a.send({ type: 'authenticate', protocol: mode === 'protocol' ? 3 : 4, ticket: mode === 'ticket' ? 'forged' : issue_ticket(42, key) });
			if (mode !== 'ticket' && mode !== 'protocol') {
				await a.next('ready');
				if (mode === 'sequence') a.send({ type: 'start', seq: 9, build });
				else for (let i = 0; i < 25; i++) a.send({ type: 'heartbeat' });
			}
			expect(await a.closed).toBe(1008);
		}
	} finally { service.stop(); }
});


test('10 Hz advances milliseconds without changing attack intervals', () => {
	expect(STEP_MS).toBe(100);
	const arena = create_arena(build);
	for (let i = 0; i < 17; i++) step(arena, () => 0);
	expect(arena.elapsed_ms).toBe(1700);
	expect(arena.log).toHaveLength(0);
	step(arena, () => 0);
	expect(arena.elapsed_ms).toBe(1800);
	expect(arena.log[0].actor).toBe('scout');
	expect(arena.log[0].elapsed_ms).toBe(1800);
	expect(arena.step_ms).toBe(100);
	for (let i = 0; i < 6; i++) step(arena, () => 0);
	expect(arena.player.next_attack).toBe(4800);
	command(arena, 'flee', null);
	step(arena);
	expect(arena.elapsed_ms).toBe(2400);
});


test('favorable damage order preserves packets and shares a ten-tick eating cooldown', () => {
	const arena = create_arena(build);
	arena.player.max_hp = 100; arena.player.hp = 60; arena.food_policy.heal = 45;
	resolve_player_damage(arena, [{ kind: 'attack', actor: 'a', amount: 70 }, { kind: 'poison', actor: 'b', amount: 30 }]);
	expect(arena.player.hp).toBe(5);
	expect(arena.log.filter(event => event.kind !== 'heal').map(event => event.amount)).toEqual([30, 70]);
	expect(arena.next_eat).toBe(10);
	expect(arena.food_used).toBe(1);
	arena.elapsed_ms = 900;
	resolve_player_damage(arena, []);
	expect(arena.food_used).toBe(1);
	arena.elapsed_ms = 1000;
	resolve_player_damage(arena, []);
	expect(arena.food_used).toBe(2);
	const lethal = create_arena(build);
	lethal.player.max_hp = 100; lethal.player.hp = 60;
	resolve_player_damage(lethal, [{ kind: 'attack', actor: 'a', amount: 70 }]);
	expect(lethal.status).toBe('defeat');
	expect(lethal.food_used).toBe(0);
});


test('damage planner finds every survivable ordering against an exhaustive small-HP oracle', () => {
	const permutations = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
	function survives(hp: number, amounts: number[], order: number[]) {
		let food = 2, used = false;
		for (const index of order) {
			if (!used && hp > 0 && hp <= 4) {
				while (hp <= 4 && food > 0) { hp = Math.min(10, hp + 4); food--; }
				used = true;
			}
			hp -= amounts[index];
			if (hp <= 0) return false;
		}
		return true;
	}
	for (let hp = 1; hp <= 10; hp++) for (let a = 0; a <= 10; a++) for (let b = 0; b <= 10; b++) {
		const amounts = [a, b, 2];
		expect(survives(hp, amounts, favorable_damage_order(hp, 10, amounts, 2, 4, true)))
			.toBe(permutations.some(order => survives(hp, amounts, order)));
	}
});


test('training encounters use attack-type ratings and refresh hit chance for target and native stance changes', () => {
	const registration = { levels: { attack: 1, strength: 1, defence: 1, hitpoints: 1 }, gear: {} };
	const arena = create_registered_arena(registration, { heal: 0 }, 'ratings', 'golbins');
	expect(arena.player.stats.max_hit).toBe(23);
	expect(arena.player.stats.hit_chance).toBeCloseTo(.6875);
	expect(arena.enemies.map(enemy => enemy.stats.attack_type)).toEqual(['melee', 'ranged', 'magic']);
	expect(arena.enemies[0].stats.hit_chance).toBeCloseTo(6 / 11);
	expect(arena.enemies[1].stats.hit_chance).toBeCloseTo(7 / 12);
	expect(arena.enemies[2].stats.hit_chance).toBeCloseTo(8 / 13);
	expect(command(arena, 'target', 'golbin_scout')).toBe(true);
	expect(arena.player.stats.hit_chance).toBeCloseTo(.625);
	expect(command(arena, 'stance', 'aggressive')).toBe(true);
	// The raw aggressive maximum is 29; against ranged it displays after the 1.1 triangle multiplier.
	expect(arena.player.stats.max_hit).toBe(31);
	expect(arena.player.base_damage?.max_hit).toBe(29);
	expect(arena.player.stats.hit_chance).toBeCloseTo(5 / 12);
	expect(command(arena, 'stance', 'defensive')).toBe(true);
	expect(arena.player.stats.max_hit).toBe(25);
	expect(arena.enemies[0].stats.hit_chance).toBeCloseTo(11 / 32);
	expect(arena.enemies[1].stats.hit_chance).toBeCloseTo(3 / 8);
	expect(arena.enemies[2].stats.hit_chance).toBeCloseTo(15 / 26);
	expect(arena.player.stats.hit_chance).toBeCloseTo(5 / 12);

	const specs = [
		['golbin', 'melee', 24, [1,1,1,1,2,2]],
		['golbin_scout', 'ranged', 26, [3,1,3,1,1,2]],
		['mind_golbin', 'magic', 28, [3,1,1,4,1,2]]
	] as const;
	for (const [id, style, ticks, levels] of specs) {
		const arena = create_registered_arena(registration, { heal: 0 }, id, id);
		expect(arena.enemies).toHaveLength(1);
		const enemy = arena.enemies[0];
		expect(Object.values(enemy.levels!)).toEqual([...levels]);
		expect(enemy.stats.attack_type).toBe(style);
		expect(enemy.hp).toBe(20);
		expect(enemy.interval).toBe(ticks * STEP_MS);
		arena.player.next_attack = 999999;
		for (let i = 1; i < ticks; i++) step(arena, () => 0);
		expect(arena.log).toHaveLength(0);
		step(arena, () => 0);
		expect(arena.log[0].actor).toBe(id);
		expect(arena.player.effects).toHaveLength(0);
	}
	const group = create_registered_arena(registration, { heal: 0 }, 'group', 'golbins');
	expect(group.enemies.map(enemy => enemy.id)).toEqual(specs.map(spec => spec[0]));
	expect(command(group, 'target', 'mind_golbin')).toBe(true);
	const plants = create_registered_arena(registration, { heal: 0 }, 'plants', 'plants');
	expect(new Set(plants.enemies.map(enemy => enemy.id)).size).toBe(6);
	for (const plant of plants.enemies) {
		expect(Object.values(plant.levels!)).toEqual([1,1,1,1,1,1]);
		expect(plant.hp).toBe(10);
		expect(plant.interval).toBe(10000);
	}
	plants.player.stats.hit_chance = 1;
	plants.player.base_damage = { min_hit: 10, max_hit: 10 };
	plants.player.next_attack = STEP_MS;
	plants.player.interval = STEP_MS;
	plants.player.base_interval_ticks = 1;
	plants.enemies.forEach(enemy => enemy.next_attack = Number.MAX_SAFE_INTEGER);
	for (let i = 0; i < 150 && plants.status === 'active'; i++) step(plants, () => 0);
	expect(plants.status).toBe('victory');
});

test('Bronze and Iron daggers with matching gloves produce distinct native raw ratings', () => {
	const levels = { attack: 99, strength: 99, defence: 99, hitpoints: 99 };
	const bronze = create_registered_arena({ levels, gear: {
		Weapon: 'melvorD:Bronze_Dagger', Gloves: 'melvorD:Bronze_Gloves'
	} }, { heal: 0 }, 'bronze');
	const iron = create_registered_arena({ levels, gear: {
		Weapon: 'melvorD:Iron_Dagger', Gloves: 'melvorD:Iron_Gloves'
	} }, { heal: 0 }, 'iron');
	expect(bronze.player.interval).toBe(2200);
	expect(iron.player.interval).toBe(2200);
	expect(bronze.player.base_damage).toEqual({ min_hit: 1, max_hit: 130 });
	expect(iron.player.base_damage).toEqual({ min_hit: 1, max_hit: 133 });
	expect(bronze.player.stats.max_hit).toBe(130);
	expect(iron.player.stats.max_hit).toBe(133);
	expect(bronze.player.stats.hit_chance).toBeCloseTo(1 - 320 / 8322);
	expect(iron.player.stats.hit_chance).toBeCloseTo(1 - 320 / 8550);
});

test('player rolls raw damage before applying the melee-versus-ranged triangle', () => {
	const arena = create_registered_arena({ levels: { attack: 99, strength: 99, defence: 99, hitpoints: 99 }, gear: {
		Weapon: 'melvorD:Bronze_Dagger', Gloves: 'melvorD:Bronze_Gloves'
	} }, { heal: 0 }, 'raw-triangle', 'golbin_scout');
	const target = arena.enemies[0];
	target.hp = target.max_hp = 200;
	arena.player.next_attack = STEP_MS;
	expect(arena.player.base_damage).toEqual({ min_hit: 1, max_hit: 130 });
	expect(arena.player.stats.max_hit).toBe(143);
	const rolls = [0, .3];
	step(arena, () => rolls.shift() ?? .999);
	// Raw 40 is rolled from 1..130, then 1.1x triangle damage gives 44.
	// Rolling uniformly from the displayed 1..143 would instead produce 43.
	expect(arena.log.find(event => event.actor === 'player')?.amount).toBe(44);
});

test('socket rejects retired and unknown encounters before reserve and advertises only training encounters', async () => {
	let reservations = 0;
	const service = start_combat_service({ key, authority: { ...authority, reserve: async (...args) => { reservations++; return authority.reserve(...args); } }, port: 0, hostname: '127.0.0.1' });
	const a = client(service.server.port!);
	try {
		await a.opened;
		a.send({ type: 'authenticate', protocol: 4, ticket: issue_ticket(89, key) });
		const ready = await a.next('ready');
		expect(ready.encounters).toEqual([...SUPPORTED_ENCOUNTERS]);
		expect(ready.encounters).not.toContain('mossbound');
		a.send({ type: 'start', seq: 1, encounter: 'mossbound', food_id: 'melvorD:Shrimp', budget: 8 });
		expect((await a.next('ack')).accepted).toBe(false);
		expect((await a.next('state')).arena).toBeNull();
		expect(reservations).toBe(0);
		a.send({ type: 'start', seq: 2, encounter: '__proto__', food_id: 'melvorD:Shrimp', budget: 8 });
		expect((await a.next('ack')).accepted).toBe(false);
		expect((await a.next('state')).arena).toBeNull();
		expect(reservations).toBe(0);
		a.send({ type: 'start', seq: 3, encounter: 'plants', food_id: 'melvorD:Shrimp', budget: 8, enemies: [{ hp: 1 }] });
		expect((await a.next('ack')).accepted).toBe(true);
		const arena = (await a.next('state')).arena;
		expect(arena.encounter).toBe('plants');
		expect(arena.enemies).toHaveLength(6);
		expect(arena.enemies[0].hp).toBe(10);
		expect(reservations).toBe(1);
	} finally { a.ws.close(); service.stop(); }
});

test('socket defaults an omitted encounter to Golbin', async () => {
	const service = start_combat_service({ key, authority, port: 0, hostname: '127.0.0.1' });
	const a = client(service.server.port!);
	try {
		await a.opened;
		a.send({ type: 'authenticate', protocol: 4, ticket: issue_ticket(90, key) });
		const ready = await a.next('ready');
		expect(ready.encounters).toEqual([...SUPPORTED_ENCOUNTERS]);
		a.send({ type: 'start', seq: 1, food_id: 'melvorD:Shrimp', budget: 8 });
		expect((await a.next('ack')).accepted).toBe(true);
		const arena = (await a.next('state')).arena;
		expect(arena.encounter).toBe('golbin');
		expect(arena.enemies.map((enemy: { id: string }) => enemy.id)).toEqual(['golbin']);
	} finally { a.ws.close(); service.stop(); }
});

const run_registration = { levels: { attack:99, strength:99, defence:99, hitpoints:99 }, gear: {} };
function spawn_run(arena: ReturnType<typeof create_run>) {
	for (let i = 0; i < RESPAWN_MS / STEP_MS; i++) step_run(arena, () => .5);
	expect(arena.run?.phase).toBe('fighting');
}
function win_run_wave(arena: ReturnType<typeof create_run>) {
	for (const enemy of arena.enemies) enemy.hp = 0;
	step_run(arena, () => .5);
}

test('all run modes wait before the first fight and attacks receive full intervals after spawning', () => {
	for (const mode of ['once','repeat','playlist'] as const) {
		const arena = create_run(run_registration,{ heal: 30 },'run','plants',mode);
		for (let i = 1; i < RESPAWN_MS / STEP_MS; i++) step_run(arena);
		expect(arena.run?.phase).toBe('respawning'); expect(arena.log).toHaveLength(0);
		expect(arena.food_used).toBe(0); expect(arena.player.hp).toBe(990);
		step_run(arena);
		expect(arena.run?.phase).toBe('fighting');
		for (const actor of [arena.player,...arena.enemies]) expect(actor.next_attack).toBe(arena.elapsed_ms + actor.interval);
	}
});

test('playlists wrap in authored order and carry HP, stance and cumulative eating count', () => {
	for (const selection of ['plants','golbins'] as const) {
		const arena = create_run(run_registration,{ heal: 30 },'same-reservation',selection,'playlist');
		const expected = selection === 'plants' ? [1,2,3,4,5,6,1] : [1,1,1,3,1];
		const types = ['melee','ranged','magic','melee','melee'] as const;
		arena.player.hp = 700; arena.food_used = 2;
		run_command(arena,'stance','aggressive');
		for (let i = 0; i < expected.length; i++) {
			spawn_run(arena);
			expect(arena.enemies).toHaveLength(expected[i]);
			if (selection === 'golbins') expect(arena.enemies[0].stats.attack_type).toBe(types[i]);
			expect(arena.food_used).toBe(2);
			expect(arena.player.hp).toBe(700); expect(arena.stance).toBe('aggressive');
			expect(arena.id).toBe('same-reservation');
			win_run_wave(arena);
			expect(arena.status).toBe('active'); expect(arena.run?.phase).toBe('respawning');
			expect(arena.run?.completed).toBe(i+1);
		}
	}
});

test('one-off wins terminate; repeat wins queue the same enemy; defeat expiry and stop never repeat', () => {
	const once = create_run(run_registration,{ heal: 0 },'once','golbin','once');
	spawn_run(once); win_run_wave(once); expect(once.status).toBe('victory');
	const repeated = create_run(run_registration,{ heal: 0 },'repeat','plants','repeat');
	spawn_run(repeated); win_run_wave(repeated); spawn_run(repeated);
	expect(repeated.enemies).toHaveLength(1); expect(repeated.run?.completed).toBe(1);
	for (const phase of ['initial','between','fighting']) {
		const arena = create_run(run_registration,{ heal: 0 },'stop','golbin','repeat');
		if (phase !== 'initial') spawn_run(arena);
		if (phase === 'between') win_run_wave(arena);
		expect(run_command(arena,'flee',null)).toBe(true);
		const before = structuredClone(arena); step_run(arena); expect(arena).toEqual(before);
	}
	for (const outcome of ['defeat','expired'] as const) {
		const arena = create_run(run_registration,{ heal: 0 },outcome,'golbin','repeat'); spawn_run(arena);
		if (outcome === 'defeat') { arena.player.hp = 1; arena.player.next_attack = 999999; arena.enemies[0].next_attack = arena.elapsed_ms + STEP_MS; }
		else arena.elapsed_ms = 299900;
		step_run(arena,()=>0); expect(arena.status).toBe(outcome);
		step_run(arena); expect(arena.run?.completed).toBe(0);
	}
	for (const [target,mode] of [['plants','invalid'],['golbin','playlist'],['unknown','repeat']]) expect(valid_run(target,mode)).toBe(false);
});

test('socket retains one food selection across a repeat and closes authority state only when stopped', async () => {
	let reserves = 0;
	const progress: Array<{ id:string; used:number; status:string }> = [];
	const service = start_combat_service({ key, port:0, hostname:'127.0.0.1', random:()=>.5,
		authority: { reserve: async()=>{ reserves++; return {registration:run_registration,food_id:'melvorD:Shrimp',heal:30}; },
			progress: async(id,used,status)=>{ progress.push({id,used,status}); return true; }, stop(){} } });
	const a = client(service.server.port!);
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	try {
		await a.opened; a.send({type:'authenticate',protocol:4,ticket:issue_ticket(893,key)}); await a.next('ready');
		heartbeat=setInterval(()=>a.send({type:'heartbeat'}),2000);
		a.send({type:'start',seq:1,encounter:'plants',mode:'repeat',food_id:'melvorD:Shrimp',budget:8});
		expect((await a.next('ack')).accepted).toBe(true);
		let arena=(await a.next('state')).arena; const id=arena.id;
		expect(arena.run.phase).toBe('respawning');
		while (arena.run.completed < 1) arena=(await a.next('state')).arena;
		expect(arena.id).toBe(id); expect(arena.status).toBe('active');
		expect(reserves).toBe(1); expect(progress.every(row=>row.status==='active')).toBe(true);
		a.send({type:'command',seq:2,encounter:id,action:'flee'});
		expect((await a.next('ack')).accepted).toBe(true);
		expect(progress.at(-1)).toEqual({id,used:0,status:'fled'});
	} finally { clearInterval(heartbeat); a.ws.close(); service.stop(); }
},20000);

test('unlimited low-tier food heals once even below threshold and shares manual/auto cooldown', () => {
	const arena = create_arena(build);
	arena.player.max_hp = 990; arena.player.hp = 100; arena.food_policy.heal = 30;
	resolve_player_damage(arena, []);
	expect(arena.player.hp).toBe(130); expect(arena.food_used).toBe(1); expect(arena.food).toBe(1);
	expect(command(arena, 'eat', null)).toBe(false);
	arena.elapsed_ms = 9 * STEP_MS; resolve_player_damage(arena, []);
	expect(arena.player.hp).toBe(130);
	arena.elapsed_ms = 10 * STEP_MS;
	expect(command(arena, 'eat', null)).toBe(true);
	expect(arena.player.hp).toBe(160); expect(arena.food_used).toBe(2);
	resolve_player_damage(arena, []); expect(arena.player.hp).toBe(160);
	for (let tick = 20; tick <= 200; tick += 10) { arena.elapsed_ms = tick * STEP_MS; arena.player.hp = 100; resolve_player_damage(arena, []); }
	expect(arena.food_used).toBe(21); expect(arena.food).toBe(1);
});

test('delta capability is negotiated per socket and streams baseline then compact changes', async () => {
	const service = start_combat_service({ key, authority, port:0, hostname:'127.0.0.1' });
	const a = client(service.server.port!);
	try {
		await a.opened;
		a.send({ type:'authenticate',protocol:4,ticket:issue_ticket(87,key),capabilities:['state-delta-v1'] });
		expect((await a.next('ready')).capabilities).toEqual(['state-delta-v1']);
		a.send({ type:'start',seq:1,encounter:'golbin' });
		expect((await a.next('ack')).accepted).toBe(true);
		const baseline = await a.next('state'); expect(baseline.seq).toBe(1);
		const delta = await a.next('state_delta');
		expect(delta.base).toBe(1); expect(delta.seq).toBe(2); expect(delta.id).toBe(baseline.arena.id);
		expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(baseline).length / 3);
	} finally { a.ws.close(); service.stop(); }
});

test('living actors land same-tick lethal attacks before resolving a draw', () => {
	for (const offset of [0, STEP_MS]) {
		const arena = create_arena(build);
		arena.enemies = [arena.enemies[0]];
		arena.player.hp = arena.enemies[0].hp = 1;
		arena.food = 0;
		arena.player.next_attack = STEP_MS;
		arena.enemies[0].next_attack = STEP_MS + offset;
		step(arena, () => 0);
		expect(arena.status).toBe(offset === 0 ? 'draw' : 'victory');
		expect(arena.player.hp).toBe(offset === 0 ? 0 : 1);
		expect(arena.enemies[0].hp).toBe(0);
		const elapsed = arena.elapsed_ms;
		step(arena, () => 0);
		expect(arena.elapsed_ms).toBe(elapsed);
	}
});

test('same-tick effect deaths draw; a surviving opponent still means defeat', () => {
	for (const remaining of [0, 1]) {
		const arena = create_arena(build);
		arena.food = 0;
		arena.player.hp = arena.enemies[0].hp = 1;
		arena.player.next_attack = 99999;
		arena.enemies = arena.enemies.slice(0, 1 + remaining);
		for (const actor of [arena.player, arena.enemies[0]]) actor.effects.push({
			id: 'poison', source: 'other', expires_tick: 50, remaining_attacks: null, next_pulse_tick: 1, remainder: 0
		});
		step(arena, () => 0);
		expect(arena.status).toBe(remaining ? 'defeat' : 'draw');
	}
});

test('draw ends repeat and playlist runs without counting a victory or respawning', () => {
	for (const mode of ['repeat', 'playlist'] as const) {
		const arena = create_run(run_registration, { heal: 0 }, 'draw', 'plants', mode);
		spawn_run(arena);
		arena.player.hp = arena.enemies[0].hp = 1;
		arena.player.next_attack = arena.enemies[0].next_attack = arena.elapsed_ms + STEP_MS;
		step_run(arena, () => 0);
		expect(arena.status).toBe('draw');
		expect(arena.run?.completed).toBe(0);
		expect(arena.run?.phase).toBe('fighting');
	}
});


test('real socket advertises and freezes a finite Practice circuit; commands cannot apply player effects', async () => {
	const reservations: unknown[][]=[];
	const practice_authority: CombatAuthority={...authority,reserve:async(...args)=>{
		reservations.push(args);
		return authority.reserve(...args);
	}};
	const service=start_combat_service({key,authority:practice_authority,port:0,hostname:'127.0.0.1'});
	const a=client(service.server.port!);
	try {
		await a.opened;a.send({type:'authenticate',protocol:4,ticket:issue_ticket(121,key)});
		const ready=await a.next('ready');expect(ready.encounters).toContain('practice_circuit_1');
		a.send({type:'start',seq:1,encounter:'practice_circuit_1',mode:'once',stats:{damage:999999}});
		expect((await a.next('ack')).accepted).toBe(true);
		const arena=(await a.next('state')).arena;
		expect(reservations[0].slice(2)).toEqual(['practice_circuit_1','once']);
		expect(arena.run.stages).toBe(4);expect(arena.enemies[0].id).toBe('human_recruit_1');
		a.send({type:'command',seq:2,encounter:arena.id,action:'apply_effect',target:'poison'});
		expect((await a.next('ack')).accepted).toBe(false);
		a.send({type:'start',seq:3,encounter:'practice_circuit_2',mode:'once'});
		expect((await a.next('ack')).accepted).toBe(false);
	} finally {a.ws.close();service.stop();}
});
