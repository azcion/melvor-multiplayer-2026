import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { create_combat_view, create_combat_controller, combat_socket_url, combat_elapsed_ms, combat_attack_progress, combat_max_hit_marker, combat_player_thresholds, create_combat_animator, combat_effect_space, combat_effect_remaining, combat_effect_icon, combat_feedback, combat_tick, combat_eat_remaining, combat_eat_progress, combat_eat_overlay, combat_eat_opacity } from '../../mod/combat-arena.mjs';

test('max hit notch shows the one-hit HP threshold independently of current HP', () => {
	assert.equal(combat_max_hit_marker(36, 240), 15);
	assert.equal(combat_max_hit_marker(36, 160), 22.5);
	assert.equal(combat_max_hit_marker(300, 160), 100);
	assert.equal(combat_max_hit_marker(-1, 160), 0);
	for (const hp of [0, -1, NaN, Infinity]) assert.equal(combat_max_hit_marker(36, hp), 0);
});

test('player thresholds use one highest living enemy and the rounded server auto eat boundary', () => {
	const arena = { player: { max_hp: 111 }, food_policy: { auto_eat_percent: 40 },
		enemies: [{ hp: 0, stats: { max_hit: 99 } }, { hp: 20, stats: { max_hit: 19 } }, { hp: 1, stats: { max_hit: 30 } }] };
	assert.deepEqual(combat_player_thresholds(arena), { max_hit: 30, auto_eat_hp: 44 });
	arena.enemies[2].hp = 0;
	assert.equal(combat_player_thresholds(arena).max_hit, 19);
	arena.enemies[1].hp = 0;
	assert.equal(combat_player_thresholds(arena).max_hit, 0);
	assert.deepEqual(combat_player_thresholds(null), { max_hit: 0, auto_eat_hp: 0 });
});

function harness(overrides = {}) {
	const sockets = [], tasks = new Map(); let id = 0, clock = 0;
	class Socket {
		constructor(url) { this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.sent = []; sockets.push(this); }
		send(value) { this.sent.push(JSON.parse(value)); }
		close() { this.readyState = 3; this.closed = true; }
		open() { this.readyState = 1; this.onopen(); }
		message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
	}
	const timers = {
		setTimeout: (fn, delay) => { tasks.set(++id, { fn, delay }); return id; },
		setInterval: (fn, delay) => { tasks.set(++id, { fn, delay }); return id; },
		clearTimeout: id => tasks.delete(id), clearInterval: id => tasks.delete(id)
	};
	const view = { ...create_combat_view(), mode: 'repeat', encounter: 'golbin' }; let tickets = 0;
	const controller = create_combat_controller({ view, Socket, timers, now: () => clock,
		get_scope: () => 'server-a:session-1', get_origin: () => 'https://example.test', can_connect: () => true,
		ticket: async () => { tickets++; return { available: true, ticket: 'admission', protocol: 4, socket_path: '/combat/socket' }; },
		get_build: () => ({ attack: 120, strength: 50, defence: 40, hitpoints: 60 }), ...overrides });
	return { view, controller, sockets, tasks, tickets: () => tickets, advance: ms => { clock += ms; } };
}

test('socket URL always belongs to the selected server and carries no credentials', () => {
	assert.equal(combat_socket_url('https://custom.example'), 'wss://custom.example/combat/socket');
	assert.equal(combat_socket_url('http://127.0.0.1:3000'), 'ws://127.0.0.1:3000/combat/socket');
	for (const origin of ['http://public.example', 'https://user:secret@example.test', 'https://example.test/other', 'https://example.test/?token=x'])
		assert.throws(() => combat_socket_url(origin));
});

test('one ticket admits socket; combat actions use it and have a single in-flight guard', async () => {
	const h = harness(); await h.controller.connect();
	const ws = h.sockets[0]; ws.open(); ws.message({ type: 'ready', protocol: 4, encounters: ['golbin', 'plants'] });
	assert.equal(h.view.status, 'ready');
	assert.equal(ws.sent[0].type, 'authenticate');
	assert.equal(h.view.encounter, 'golbin');
	h.view.encounter = 'plants';
	assert.equal(h.controller.start(), true);
	assert.equal(ws.sent[1].encounter, 'plants');
	assert.equal(h.controller.start(), false);
	ws.message({ type: 'ack', seq: 1, accepted: true });
	ws.message({ type: 'state', arena: { id: 'fight-1', status: 'active' } });
	assert.equal(h.controller.act('target', 'scout'), true);
	assert.deepEqual(ws.sent[2], { type: 'command', encounter: 'fight-1', action: 'target', target: 'scout', seq: 2 });
	assert.equal(h.tickets(), 1);
	h.controller.close(); assert.equal(ws.closed, true); assert.equal(h.tasks.size, 0);
	assert.equal(h.view.arena, null);
});

test('one action connects and starts, retaining repeat runs until their terminal result', async () => {
	const states = []; const h = harness({ on_state: arena => states.push(arena) });
	h.view.page_tab = 'test_combat'; h.view.starting = true;
	await h.controller.connect(true);
	const ws = h.sockets[0]; ws.open(); ws.message({ type: 'ready', protocol: 4, encounters: ['golbin'] });
	assert.equal(ws.sent[1].type, 'start'); assert.equal(ws.sent[1].mode, 'repeat');
	ws.message({ type: 'ack', seq: 1, accepted: true });
	ws.message({ type: 'state', arena: { id: 'fight', status: 'active', run: { phase: 'respawning' } } });
	assert.equal(h.view.starting, false); assert.equal(ws.closed, undefined);
	ws.message({ type: 'state', arena: { id: 'fight', status: 'active', run: { phase: 'fighting' } } });
	assert.equal(ws.closed, undefined);
	const result = { id: 'fight', status: 'fled' }; ws.message({ type: 'state', arena: result });
	assert.equal(ws.closed, true); assert.equal(h.view.status, 'idle'); assert.deepEqual(h.view.arena, result);
	assert.deepEqual(states.at(-1), result); assert.equal(h.tasks.size, 0);
	await h.controller.connect(true); assert.equal(h.sockets.length, 2);
});

test('Raid tab connects and starts its selected finite run after admission', async () => {
	const h = harness(); h.view.page_tab = 'raid'; h.view.mode = 'raid'; h.view.encounter = 'golbins';
	await h.controller.connect(true);
	const ws = h.sockets[0]; ws.open(); ws.message({ type: 'ready', protocol: 4, encounters: ['golbins'] });
	assert.deepEqual(ws.sent[1], { type: 'start', encounter: 'golbins', mode: 'raid', stance: 'accurate', seq: 1 });
	assert.equal(h.view.combat_tab, 'raid'); assert.equal(ws.closed, undefined);
	ws.message({ type: 'ack', seq: 1, accepted: true });
	ws.message({ type: 'state', arena: { id: 'raid', status: 'active', run: { mode: 'raid', phase: 'respawning' } } });
	assert.equal(h.view.page_tab, 'raid'); assert.equal(h.view.starting, false);
	assert.equal(h.controller.act('flee', null), true);
	ws.message({ type: 'ack', seq: 2, accepted: true });
	ws.message({ type: 'state', arena: { id: 'raid', status: 'fled' } });
	assert.equal(ws.closed, true); assert.equal(h.view.status, 'idle');
});

test('automatic start handles unavailable targets, rejection and navigation while connecting', async () => {
	const unsupported = harness(); unsupported.view.page_tab = 'test_combat'; await unsupported.controller.connect(true);
	const a = unsupported.sockets[0]; a.open(); a.message({ type: 'ready', protocol: 4, encounters: [] });
	assert.equal(a.closed, true); assert.equal(unsupported.view.error, 'target_unavailable'); assert.equal(unsupported.view.starting, false);
	const rejected = harness(); rejected.view.page_tab = 'test_combat'; await rejected.controller.connect(true);
	const b = rejected.sockets[0]; b.open(); b.message({ type: 'ready', protocol: 4, encounters: ['golbin'] });
	b.message({ type: 'ack', seq: 1, accepted: false });
	assert.equal(b.closed, true); assert.equal(rejected.view.error, 'rejected'); assert.equal(rejected.view.starting, false);
	const navigated = harness(); navigated.view.page_tab = 'test_combat'; await navigated.controller.connect(true);
	const c = navigated.sockets[0]; c.open(); navigated.view.page_tab = 'character'; c.message({ type: 'ready', protocol: 4, encounters: ['golbin'] });
	assert.equal(c.closed, true); assert.equal(c.sent.length, 1); assert.equal(navigated.view.starting, false);
});

test('leaving while admission is pending cannot open a stale socket', async () => {
	let resolve; const h = harness({ ticket: () => new Promise(r => resolve = r) });
	const request = h.controller.connect(); h.controller.close();
	resolve({ available: true, ticket: 'old', protocol: 4, socket_path: '/combat/socket' }); await request;
	assert.equal(h.sockets.length, 0);
	assert.equal(h.view.status, 'closed');
});

test('disabled backend is clear, failures have no retry loop and manual retries are paced', async () => {
	const h = harness({ ticket: async () => ({ available: false }) }); await h.controller.connect();
	assert.equal(h.view.status, 'unavailable'); assert.equal(h.sockets.length, 0); assert.equal(h.tasks.size, 0);
	const active = harness(); await active.controller.connect(); const ws = active.sockets[0]; ws.open();
	ws.message({ type: 'ready', protocol: 4, encounters: ['golbin', 'plants'] }); active.controller.start();
	[...active.tasks.values()].find(t => t.delay === 5000).fn();
	assert.equal(active.view.status, 'error'); assert.equal(active.tasks.size, 0);
	await active.controller.connect(); assert.equal(active.tickets(), 1);
	active.advance(5001); await active.controller.connect(); assert.equal(active.tickets(), 2);
	active.controller.close();
});

test('heartbeat loss aborts instead of running offline; stale callbacks cannot update a closed view', async () => {
	const h = harness(); await h.controller.connect(); const ws = h.sockets[0]; ws.open();
	ws.message({ type: 'ready', protocol: 4, encounters: ['golbin', 'plants'] });
	const stale = ws.onmessage;
	h.advance(9000); [...h.tasks.values()].find(t => t.delay === 2000).fn();
	assert.equal(ws.closed, true); assert.equal(h.tasks.size, 0);
	stale({ data: JSON.stringify({ type: 'state', arena: { id: 'old' } }) });
	assert.equal(h.view.arena, null);
});

test('Colosseum page is between Raid and Updates, scoped independently and isolated from native mutations', async () => {
	const data = JSON.parse(await readFile(new URL('../../mod/data.json', import.meta.url), 'utf8'));
	const colosseum = data.data.pages.find(page => page.id === 'Combat');
	assert.equal(colosseum.media, 'assets/colosseum.png');
	assert.equal(colosseum.sidebarItem.icon, colosseum.media);
	const pages = data.data.pages.map(page => page.id);
	assert.equal(pages.indexOf('Combat'), pages.indexOf('Guild_Raid') + 1);
	assert.equal(pages.indexOf('Updates'), pages.indexOf('Combat') + 1);
	const source = await readFile(new URL('../../mod/combat-arena.mjs', import.meta.url), 'utf8');
	assert.doesNotMatch(source, /game\.(combat|bank)|localStorage|fetch\(/);
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	assert.match(main, /on_page_toggle\('mp-combat-page'/);
	assert.match(main, /'raid', 'combat', 'expedition'/);
	assert.doesNotMatch(main, /state\.combat_encounters =/);
	assert.match(main, /combat_module\.combat_run_title\(state\.combat\.arena\)/);
	assert.doesNotMatch(main, /state\.combat_encounters = \[[^\]]*mossbound/);
});


test('animation interpolates between snapshots, snaps resets, bounds stalls and cleans up frames', () => {
	let clock = 0, serial = 0;
	const callbacks = new Map();
	const bar = { dataset: { combatActor: 'player' }, style: {} };
	const frames = { requestAnimationFrame: callback => { callbacks.set(++serial, callback); return serial; }, cancelAnimationFrame: id => callbacks.delete(id) };
	const animator = create_combat_animator({ get_root: () => ({ querySelectorAll: selector => selector === '[data-combat-actor]' ? [bar] : [] }), now: () => clock, frames, reduced_motion: () => false });
	const arena = { status: 'active', elapsed_ms: 1000, player: { id: 'player', hp: 100, interval: 2000, next_attack: 2000 }, enemies: [] };
	const paint = () => { const [id, callback] = callbacks.entries().next().value; callbacks.delete(id); callback(); };
	animator.update(arena); paint(); assert.equal(bar.style.transform, 'scaleX(0.5)');
	clock = 100; paint(); assert.equal(bar.style.transform, 'scaleX(0.55)');
	clock = 200; animator.update({ ...arena, elapsed_ms: 1200 }); paint(); assert.equal(bar.style.transform, 'scaleX(0.6)');
	animator.update({ ...arena, elapsed_ms: 2000, player: { ...arena.player, next_attack: 4000 } }); paint();
	assert.equal(bar.style.transform, 'scaleX(0)');
	clock = 1000; paint(); assert.ok(Math.abs(Number(bar.style.transform.slice(7, -1)) - 0.2) < 1e-9); assert.equal(callbacks.size, 0);
	animator.update({ ...arena, status: 'fled' }); paint(); assert.equal(bar.style.transform, 'scaleX(0.5)'); assert.equal(callbacks.size, 0);
	animator.update(arena); animator.update(null); assert.equal(callbacks.size, 0);
	assert.equal(combat_elapsed_ms(null), 0);
	assert.equal(combat_elapsed_ms({ elapsed_ms: 2000 }), 2000);
	assert.equal(combat_attack_progress(arena.player, 99999), 1);
});

test('jittered and command snapshots do not rewind an unchanged cosmetic clock', () => {
	let clock = 0, serial = 0;
	const callbacks = new Map();
	const bar = { dataset: { combatActor: 'player' }, style: {} }, fill = { style: {} };
	const animator = create_combat_animator({ now: () => clock, reduced_motion: () => false,
		get_root: () => ({ querySelectorAll: selector => selector === '[data-combat-actor]' ? [bar] : [fill] }),
		frames: { requestAnimationFrame: callback => { callbacks.set(++serial, callback); return serial; }, cancelAnimationFrame: id => callbacks.delete(id) } });
	const arena = { id: 'fight', status: 'active', elapsed_ms: 1000, step_ms: 100, next_eat: 20,
		food_policy: { cooldown_ticks: 10 }, player: { id: 'player', hp: 100, interval: 2000, next_attack: 2000 }, enemies: [] };
	const paint = () => { const [id, callback] = callbacks.entries().next().value; callbacks.delete(id); callback(); };
	const progress = () => [Number(bar.style.transform.slice(7, -1)), Number(fill.style.transform.slice(7, -1))];
	animator.update(arena); paint();
	clock = 240; paint();
	const before_packet = progress();
	// The 200ms snapshot arrives after 240ms; its age must not rewind the last painted frame.
	animator.update({ ...arena, elapsed_ms: 1200 }); paint();
	assert.deepEqual(progress(), before_packet);
	clock = 280; paint();
	for (const [index, value] of progress().entries()) assert.ok(value >= before_packet[index]);
	// Target/command responses may repeat the same combat time between periodic snapshots.
	const before_command = progress();
	animator.update({ ...arena, elapsed_ms: 1200 }); paint();
	assert.deepEqual(progress(), before_command);
	clock = 4000; paint();
	assert.deepEqual(progress(), [.8, .6]); // Still bounded to 400ms beyond confirmed combat time.
	assert.equal(callbacks.size, 0);
	// A newly confirmed attack and food use reset their own progress normally.
	animator.update({ ...arena, elapsed_ms: 1600, next_eat: 26, player: { ...arena.player, next_attack: 3600 } }); paint();
	assert.deepEqual(progress(), [0, 0]);
	// Reused actor IDs in another fight cannot retain the previous presentation clock.
	animator.update({ ...arena, id: 'next' }); paint();
	assert.deepEqual(progress(), [.5, 0]);
	animator.update(null);
	assert.equal(callbacks.size, 0);
});

test('frame animator owns food fill styles without reactive snapshot rewinds', async () => {
	const html = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const css = await readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8');
	const fill = html.match(/<span[^>]*data-combat-eat-fill[^>]*>/)?.[0];
	assert.ok(fill);
	assert.doesNotMatch(fill, /:style=/);
	assert.match(css, /\.mp-combat-eat-fill \{[^}]*opacity: 0;/);
});

test('defeated actors keep an empty attack bar across later snapshots and frames', () => {
	let clock = 0, paint;
	const bar = { dataset: { combatActor: 'plant' }, style: {} };
	const animator = create_combat_animator({ get_root: () => ({ querySelectorAll: selector => selector === '[data-combat-actor]' ? [bar] : [] }), now: () => clock,
		frames: { requestAnimationFrame: fn => { paint = fn; return 1; }, cancelAnimationFrame() {} }, reduced_motion: () => false });
	const enemy = { id: 'plant', hp: 0, interval: 2000, next_attack: 2000 };
	for (const elapsed_ms of [1000, 2200, 5000]) {
		animator.update({ status: 'active', elapsed_ms, player: { id: 'player' }, enemies: [enemy] });
		paint(); assert.equal(bar.style.transform, 'scaleX(0)');
		clock += 100; paint(); assert.equal(bar.style.transform, 'scaleX(0)');
	}
	assert.equal(combat_attack_progress(enemy, 99999), 0);
});

test('reduced motion renders authoritative snapshots without a continuous frame loop', () => {
	const callbacks = new Map(); let id = 0;
	const bar = { dataset: { combatActor: 'player' }, style: {} };
	const animator = create_combat_animator({ get_root: () => ({ querySelectorAll: selector => selector === '[data-combat-actor]' ? [bar] : [] }), now: () => 1000,
		frames: { requestAnimationFrame: fn => { callbacks.set(++id, fn); return id; }, cancelAnimationFrame: id => callbacks.delete(id) }, reduced_motion: () => true });
	animator.update({ status: 'active', elapsed_ms: 1000, player: { id: 'player', hp: 100, interval: 2000, next_attack: 2000 }, enemies: [] });
	const fn = callbacks.get(id); callbacks.delete(id); fn();
	assert.equal(bar.style.transform, 'scaleX(0.5)'); assert.equal(callbacks.size, 0);
});

test('socket state and teardown notify the cosmetic animator without issuing extra commands', async () => {
	const states = []; const h = harness({ on_state: arena => states.push(arena) });
	await h.controller.connect(); const ws = h.sockets[0]; ws.open(); ws.message({ type: 'ready', protocol: 4, encounters: ['golbin', 'plants'] });
	const arena = { id: 'fight', elapsed_ms: 1000 };
	ws.message({ type: 'state', arena }); assert.deepEqual(states.at(-1), arena);
	assert.equal(ws.sent.length, 1);
	h.controller.close(); assert.equal(states.at(-1), null);
});


test('effect indicators use authoritative tick/attack lifetimes and feedback never predicts hits', () => {
	const arena = { elapsed_ms: 1200, step_ms: 100, log: [
		{ id: 1, elapsed_ms: 300, target: 'player', kind: 'attack', amount: 20 },
		{ id: 2, elapsed_ms: 600, target: 'player', kind: 'apply_poison', amount: 0 },
		{ id: 3, elapsed_ms: 800, target: 'player', kind: 'poison', amount: 5 },
		{ id: 4, elapsed_ms: 900, target: 'vine', kind: 'attack', amount: 10 },
		{ id: 5, elapsed_ms: 1000, target: 'player', kind: 'heal', amount: 30 },
		{ id: 6, elapsed_ms: 1100, target: 'player', kind: 'attack', amount: 0 }
	] };
	assert.equal(combat_tick(arena), 12);
	assert.equal(combat_effect_remaining({ remaining_attacks: null, expires_tick: 50 }, arena), 38);
	assert.equal(combat_effect_remaining({ remaining_attacks: null, expires_tick: 10 }, arena), 0);
	assert.equal(combat_effect_remaining({ remaining_attacks: 2 }, arena), 2);
	assert.equal(combat_effect_icon('freeze'), 'fa-snowflake');
	assert.deepEqual(combat_feedback(arena, 'player').map(event => event.id), [3, 5, 6]);
	assert.deepEqual(combat_feedback(null, 'player'), []);
});


test('eating display handles both tick-based rules and a pre-rollout server snapshot', () => {
	assert.equal(combat_eat_remaining({ elapsed_ms: 1000, step_ms: 100, next_eat: 17, food_policy: { cooldown_ticks: 10 } }), 7);
	assert.equal(combat_eat_remaining({ elapsed_ms: 1000, step_ms: 100, next_eat: 1700, food_policy: {} }), 7);
	assert.equal(combat_eat_remaining(null), 0);
});

test('start delegates food authority to the server and never sends a balance or healing value',async()=>{
	const h=harness();await h.controller.connect();const ws=h.sockets[0];ws.open();ws.message({type:'ready',protocol:4,encounters:['golbin']});
	h.view.food_id='melvorD:Carp';h.view.stance='aggressive';h.controller.start();
	assert.equal(ws.sent.at(-1).stance,'aggressive');
	assert.equal(ws.sent.at(-1).food_id,undefined);assert.equal(ws.sent.at(-1).budget,undefined);
	assert.equal(ws.sent.at(-1).heal,undefined);h.controller.close();
});

test('display seconds are derived without changing tick lifetimes or cooldown calculations', async () => {
	const { combat_time, combat_duration } = await import('../../mod/combat-arena.mjs');
	assert.equal(combat_time(2400), '2.4s'); assert.equal(combat_time(0), '0.0s');
	assert.equal(combat_duration(1, { step_ms: 100 }), '0.1s');
	assert.equal(combat_duration(5, { step_ms: 100 }), '0.5s');
	assert.equal(combat_duration(50, { step_ms: 100 }), '5.0s');
	assert.equal(combat_duration(5, { step_ms: 200 }), '1.0s');
});


test('retired Mossbound is filtered from server encounters and never sent as a start target', async () => {
	const h = harness(); await h.controller.connect();
	const ws = h.sockets[0]; ws.open(); ws.message({ type: 'ready', protocol: 4, encounters: ['golbin', 'plants', 'mossbound'] });
	assert.deepEqual(h.view.supported_encounters, ['golbin', 'plants']);
	h.view.encounter = 'mossbound';
	assert.equal(h.controller.start(), false);
	assert.equal(h.view.error, 'target_unavailable');
	assert.equal(ws.sent.length, 1);
	h.view.encounter = 'golbin';
	assert.equal(h.controller.start(), true);
	assert.equal(ws.sent.at(-1).encounter, 'golbin');
	h.controller.close();
	assert.deepEqual(h.view.supported_encounters, []);
});

test('a ready message without an encounter list cannot silently start a legacy boss', async () => {
	const h = harness(); await h.controller.connect();
	const ws = h.sockets[0]; ws.open(); ws.message({ type: 'ready', protocol: 4 });
	assert.deepEqual(h.view.supported_encounters, []);
	assert.equal(h.view.encounter, 'golbin');
	assert.equal(h.controller.start(), false);
	assert.equal(h.view.error, 'target_unavailable');
	assert.equal(ws.sent.length, 1);
	h.controller.close();
});

test('page navigation preserves admission, heartbeat, snapshots and commands; only presentation is paused', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const eligibility = main.match(/can_connect: \(\) => ([^\n]+),/)[1];
	const toggle_body = main.match(/on_page_toggle\('mp-combat-page', visible => \{([\s\S]*?)\n\t\t\t\}\);/)[1];
	const state = { is_connected: true, is_social_only: false };
	const document = { visibilityState: 'visible' };
	const frames = []; let refreshes = 0, admin_refreshes = 0;
	const wiring = new Function('state', 'document', 'combat_animation', 'combat_inventory', 'refresh_chat_state', `
		let combat_page_visible = true;
		return { can_connect: () => ${eligibility}, toggle: visible => { ${toggle_body} } };
	`)(state, document, { update: value => frames.push(value) }, { refresh: () => refreshes++ }, () => admin_refreshes++);
	let admit, tickets = 0;
	const h = harness({ can_connect: wiring.can_connect, ticket: () => { tickets++; return new Promise(resolve => admit = resolve); } });
	state.combat = h.view;
	const connecting = h.controller.connect();
	wiring.toggle(false);
	admit({ available: true, ticket: 'admission', protocol: 4, socket_path: '/combat/socket' });
	await connecting;
	const ws = h.sockets[0]; ws.open(); ws.message({ type: 'ready', protocol: 4, encounters: ['golbin'] });
	const arena = { id: 'same-fight', status: 'active', elapsed_ms: 2000 };
	ws.message({ type: 'state', arena });
	[...h.tasks.values()].find(t => t.delay === 2000).fn();
	assert.equal(ws.sent.at(-1).type, 'heartbeat');
	assert.equal(ws.closed, undefined);
	wiring.toggle(true);
	assert.deepEqual(frames.at(-1), arena);
	assert.equal(refreshes, 1);
	assert.equal(admin_refreshes, 1);
	assert.equal(h.controller.act('surrender'), true);
	assert.equal(ws.sent.at(-1).encounter, 'same-fight');
	assert.equal(tickets, 1);
	assert.match(main, /addEventListener\('pagehide', \(\) => combat_arena\?\.close\(\)\)/);
	document.visibilityState = 'hidden';
	[...h.tasks.values()].find(t => t.delay === 2000).fn();
	assert.equal(ws.closed, true);
	assert.equal(h.tasks.size, 0);
});

test('combat sidebar follows active, terminal and disconnected states with a seeded accessible badge', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const body = main.match(/function update_combat_nav\(\) \{([\s\S]*?)\n\}/)[1];
	const aside = { hidden: false, textContent: '0' };
	const state = {};
	const update = new Function('state', 'document', 'set_nav_ready', 'getLangString', body)
		.bind(null, state, { querySelector: () => aside }, () => {}, () => 'active');
	update(); assert.equal(aside.hidden, true);
	state.combat = { status: 'ready', arena: { status: 'active' } };
	update(); assert.equal(aside.hidden, false); assert.equal(aside.textContent, 'active');
	state.combat.arena.status = 'victory';
	update(); assert.equal(aside.hidden, true); assert.equal(aside.textContent, '');
	state.combat.arena.status = 'active'; state.combat.status = 'closed';
	update(); assert.equal(aside.hidden, true);
	const data = JSON.parse(await readFile(new URL('../../mod/data.json', import.meta.url), 'utf8'));
	const badge = data.data.pages.find(page => page.id === 'Combat').sidebarItem;
	assert.equal(badge.aside, '0'); assert.match(badge.asideClass, /mp-combat-nav/);
	assert.match(main, /on_state: arena => \{[^}]*update_combat_nav\(\)/);
	const css = await readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8');
	assert.match(css, /\.mp-combat-nav\[hidden\]/);
	assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.mp-combat-nav \{ animation: none;/);
});

test('Practice removes legacy choices while the transport retains run compatibility', async () => {
	const { combat_choices } = await import('../../mod/combat-arena.mjs');
	for (const mode of ['once', 'repeat', 'playlist']) assert.deepEqual(combat_choices(mode), []);
	assert.deepEqual(combat_choices('raid').map(choice => choice.id), ['golbins', 'tidal', 'mire', 'quarry']);
	for (const mode of ['once','repeat','playlist']) {
		const h = harness(); await h.controller.connect(); const ws=h.sockets[0];
		ws.open(); ws.message({type:'ready',protocol:4,encounters:['plants']});
		h.view.encounter='plants'; h.view.mode=mode; h.controller.start();
		assert.equal(ws.sent.at(-1).mode,mode); h.controller.close();
	}
	const template=await readFile(new URL('../../mod/ui/templates.html',import.meta.url),'utf8');
	assert.doesNotMatch(template, /<select id="mp-combat-encounter"/);
	assert.match(template, /mp-combat-choice-grid/);
	assert.match(template, /state\.combat_respawning\(\)/);
});

test('respawning clears attack bars without scheduling a cosmetic attack loop', () => {
	const callbacks=new Map(); let id=0;
	const bar={dataset:{combatActor:'player'},style:{}};
	const animator=create_combat_animator({get_root:()=>({querySelectorAll:selector=>selector === '[data-combat-actor]' ? [bar] : []}),
		frames:{requestAnimationFrame:fn=>{callbacks.set(++id,fn);return id;},cancelAnimationFrame:id=>callbacks.delete(id)}});
	animator.update({status:'active',run:{phase:'respawning'},elapsed_ms:2900,player:{id:'player',hp:10,interval:2400,next_attack:2400},enemies:[]});
	const callback=callbacks.get(id);callbacks.delete(id);callback();
	assert.equal(bar.style.transform,'scaleX(0)');assert.equal(callbacks.size,0);
});

test('food readiness fill advances across the shared cooldown and clamps at readiness', () => {
	const arena = { elapsed_ms: 1000, step_ms: 100, next_eat: 20, food_policy: { cooldown_ticks: 10 } };
	assert.equal(combat_eat_progress(arena), 0);
	assert.equal(combat_eat_progress(arena, 1250), .25);
	assert.equal(combat_eat_progress(arena, 1700), .7);
	assert.equal(combat_eat_progress(arena, 2000), 1);
	assert.equal(combat_eat_progress(arena, 5000), 1);
	assert.equal(combat_eat_progress({ ...arena, next_eat: 2000, food_policy: {} }, 1500), .5);
	assert.equal(combat_eat_progress(null), 1);
});

test('food background uses bounded interpolation and holds on a stalled connection', () => {
	let clock = 0, paint;
	const fill = { style: {} };
	const animator = create_combat_animator({ get_root: () => ({ querySelectorAll: selector => selector === '[data-combat-eat-fill]' ? [fill] : [] }),
		now: () => clock, frames: { requestAnimationFrame: fn => { paint = fn; return 1; }, cancelAnimationFrame() {} }, reduced_motion: () => false });
	const arena = { status: 'active', elapsed_ms: 1000, step_ms: 100, next_eat: 20,
		food_policy: { cooldown_ticks: 10 }, player: {}, enemies: [] };
	animator.update(arena); paint(); assert.equal(fill.style.transform, 'scaleY(0)');
	clock = 250; paint(); assert.equal(fill.style.transform, 'scaleY(0.25)');
	clock = 5000; paint(); assert.equal(fill.style.transform, 'scaleY(0.4)');
	animator.update({ ...arena, elapsed_ms: 2000 }); paint(); assert.equal(fill.style.transform, 'scaleY(1)');
	assert.equal(fill.style.opacity, '1');
	clock += 50; paint(); assert.equal(fill.style.opacity, '0.5');
	clock += 50; paint(); assert.equal(fill.style.opacity, '0');
	animator.update({ ...arena, elapsed_ms: 2000, player: { hp: 100, max_hp: 100 } }); paint(); assert.equal(fill.style.transform, 'scaleY(1)');
	assert.equal(combat_eat_overlay({ ...arena, player: { hp: 100, max_hp: 100 } }, 1500), .5);
	assert.equal(combat_eat_opacity({ ...arena, next_eat: 0 }), 0);
	assert.equal(combat_eat_opacity(arena, 1000), 1);
	assert.equal(combat_eat_opacity(arena, 2100), 0);
});


test('combat keeps its originating tab and scrolls only when a run becomes active', async () => {
	let starts = 0;
	const h = harness({on_start: () => starts++});
	assert.equal(h.view.page_tab, 'character');
	await h.controller.connect();
	const ws = h.sockets[0]; ws.open();
	ws.message({type:'ready',protocol:4,encounters:['golbin']});
	h.view.page_tab = 'test_combat';
	assert.equal(h.controller.start(), true);
	h.view.page_tab = 'character';
	ws.message({type:'state',arena:{status:'active',id:'one'}});
	assert.equal(h.view.page_tab, 'test_combat');
	assert.equal(h.view.combat_tab, 'test_combat');
	assert.equal(starts, 1);
	ws.message({type:'state',arena:{status:'active',id:'one'}});
	assert.equal(starts, 1);
	ws.message({type:'state',arena:{status:'victory',id:'one'}});
	assert.equal(h.view.page_tab, 'test_combat');
	assert.equal(starts, 1);
	h.controller.close();
	assert.equal(h.view.arena, null);
});

test('combat sticky toolbar shares Chat’s measured host header offset', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const body = main.match(/function update_chat_header_offset\(\) \{([\s\S]*?)\n\}/)[1];
	const values = {};
	const header = { getBoundingClientRect: () => ({ height: 74 }) };
	const document = { getElementById: id => id === 'page-header' ? header : { style: { setProperty: (_key, value) => { values[id] = value; } } } };
	const update = new Function('document', 'getComputedStyle', body);
	update(document, () => ({ position: 'fixed', top: '0px' }));
	assert.deepEqual(values, { 'mp-chat-page': '74px', 'mp-combat-page': '74px' });
	update(document, () => ({ position: 'static', top: 'auto' }));
	assert.equal(values['mp-combat-page'], '0px');
	const css = await readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8');
	assert.match(css, /header\.mp-combat-toolbar \{ position: sticky; top: var\(--mp-chat-header-top, 0px\)/);
});

test('negotiated deltas update the arena, preserve old snapshots and fail closed on gaps', async () => {
	const h = harness(); await h.controller.connect(); const ws = h.sockets[0]; ws.open();
	assert.deepEqual(ws.sent[0].capabilities, ['state-delta-v1']);
	ws.message({ type: 'ready', protocol: 4, capabilities: ['state-delta-v1'], encounters: ['golbin'] });
	const arena = { id: 'fight', status: 'active', elapsed_ms: 0, player: { hp: 10 }, enemies: [{ id: 'golbin', hp: 20 }], log: [] };
	ws.message({ type: 'state', seq: 1, arena });
	const prior = h.view.arena;
	ws.message({ type: 'state_delta', seq: 2, base: 1, id: 'fight', changes: [[['elapsed_ms'], 200], [['enemies','0','hp'], 17], [['log'], [{ amount: 3 }]]] });
	assert.equal(h.view.arena.enemies[0].hp, 17); assert.equal(prior.enemies[0].hp, 20);
	assert.equal(h.view.arena.elapsed_ms, 200);
	ws.message({ type: 'state_delta', seq: 4, base: 3, id: 'fight', changes: [] });
	assert.equal(h.view.status, 'error'); assert.equal(ws.closed, true);
});

test('snapshot reconstruction preserves null values, keyframes, removals and terminal outcomes', async () => {
	const { create_combat_snapshot_reader } = await import('../../mod/combat-arena.mjs');
	const reader = create_combat_snapshot_reader();
	reader.read({ type: 'state', seq: 1, arena: { id: 'a', status: 'active', obsolete: true, player: { hp: 9 } } });
	const next = reader.read({ type: 'state_delta', seq: 2, base: 1, id: 'a', changes: [[['obsolete']], [['optional'], null], [['player','hp'], 0], [['status'], 'defeat']] });
	assert.deepEqual(next, { id: 'a', status: 'defeat', optional: null, player: { hp: 0 } });
	assert.deepEqual(reader.read({ type: 'state', seq: 5, arena: { id: 'b', status: 'active' } }), { id: 'b', status: 'active' });
	assert.throws(() => reader.read({ type:'state_delta', seq:6, base:5, id:'b', changes:[[['__proto__','polluted'],true]] }));
	assert.equal({}.polluted, undefined);
});

test('terminal combat outcomes include forfeits but exclude expiry', async () => {
	for (const status of ['victory', 'defeat', 'draw', 'fled', 'expired']) {
		const results = [];
		const h = harness({ on_result: arena => results.push(arena) });
		await h.controller.connect();
		const ws = h.sockets[0]; ws.open(); ws.message({ type: 'ready', protocol: 4 });
		ws.message({ type: 'state', arena: { id: 'fight', status: 'active' } });
		ws.message({ type: 'state', arena: { id: 'fight', status } });
		ws.message({ type: 'state', arena: { id: 'fight', status } });
		assert.equal(results.length, ['victory', 'defeat', 'draw', 'fled'].includes(status) ? 1 : 0);
		assert.equal(h.view.arena.status, status);
		assert.equal(ws.closed, true);
	}
});

test('result popup waits for settled unlocks and preserves the localized title and dismissal', async () => {
	const combat_module = await import('../../mod/combat-arena.mjs');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const callback = main.match(/on_result: (async arena => \{[\s\S]*?\n\t\t\}),\n\t\ton_start:/)?.[1];
	assert.ok(callback);
	const calls = [], state = { combat: { arena: { id: 'fight' }, unlocks: { skill_caps: { attack: 3, hitpoints: 3 } } } };
	let finish;
	const combat_inventory = { settle: () => new Promise(resolve => { finish = resolve; }) };
	const show = new Function('queue_modal', 'getLangString', 'state', 'combat_module', 'combat_inventory',
		'server_host', 'session_generation', 'combat_start_caps', 'combat_start_unlocks', `return (${callback});`)(
		(...args) => calls.push(args), key => ({ MOD_MP_COMBAT_VICTORY: 'Victory', MOD_MP_COMBAT_DEFEAT: 'Defeat', MOD_MP_COMBAT_DRAW: 'Draw', MOD_MP_COMBAT_FORFEIT: 'Forfeit' })[key],
		state, combat_module, combat_inventory, 'server', 1, { attack: 1, hitpoints: 3 }, null);
	for (const status of ['victory', 'defeat', 'draw', 'fled']) {
		const work = show({ id: 'fight', status, elapsed_ms: 123400 });
		const count = calls.length;
		await Promise.resolve();
		assert.equal(calls.length, count);
		finish(true); await work;
		assert.equal(state.combat.result.time, status === 'defeat' ? null : '123.4s');
		assert.deepEqual(state.combat.result.unlocks, status === 'victory' ? [{ skill: 'attack', cap: 3 }] : []);
	}
	assert.deepEqual(calls.map(call => call[0]), ['VICTORY', 'DEFEAT', 'DRAW', 'FORFEIT']);
	for (const [, template, icon, options, localize] of calls) {
		assert.equal(template, 'combat-result-modal');
		assert.equal(icon, 'assets/colosseum.png');
		assert.equal(localize, false);
		assert.deepEqual(options, { showConfirmButton: false, showCloseButton: true, allowOutsideClick: true,
			allowEscapeKey: false, customClass: { popup: 'mp-combat-result-popup' } });
	}
	const stale = show({ id: 'fight', status: 'victory' });
	state.combat.arena = { id: 'next' }; finish(true); await stale;
	assert.equal(calls.length, 4);
});

test('result details show total raid seconds and only newly confirmed skill caps', async () => {
	const { combat_result_details } = await import('../../mod/combat-arena.mjs');
	const before = { attack: 1, strength: 1, defence: 1, hitpoints: 3 };
	const after = { attack: 3, strength: 3, defence: 3, hitpoints: 3 };
	assert.deepEqual(combat_result_details({ status: 'victory', elapsed_ms: 4400, run: { total_ms: 123400 } }, before, after), {
		time: '123.4s', unlocks: ['attack', 'strength', 'defence'].map(skill => ({ skill, cap: 3 })) });
	assert.deepEqual(combat_result_details({ status: 'victory', elapsed_ms: 1250 }, after, after), { time: '1.3s', unlocks: [] });
	assert.deepEqual(combat_result_details({ status: 'draw', elapsed_ms: 0 }, before, after), { time: '0.0s', unlocks: [] });
	assert.deepEqual(combat_result_details({ status: 'victory', elapsed_ms: 123400 }, before, null), { time: '123.4s', unlocks: [] });
});

test('raid picker keeps rules implicit and dates use viewer-local formatting', async () => {
	const { combat_choices, combat_local_date } = await import('../../mod/combat-arena.mjs');
	assert.equal(combat_choices('raid',1)[0].description,'');
	assert.equal(combat_choices('raid',2)[0].description,'');
	assert.equal(combat_choices('raid',3)[0].description,'');
	const timestamp = Date.UTC(2026,9,31,23,30);
	assert.equal(combat_local_date(timestamp),new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric'}).format(new Date(timestamp)));
	const template=await readFile(new URL('../../mod/ui/templates.html',import.meta.url),'utf8');
	assert.match(template, /state.combat_local_date\(player.achieved_at\)/);
	assert.match(template, /state.combat_attack_icon\(group.type\)/);
	assert.match(template, /state.combat_name\(group.type\)/);
 });


test('effect rows reserve space for possible incoming or self effects, with legacy and active-effect fallbacks', () => {
	assert.equal(combat_effect_space(null), false);
	assert.equal(combat_effect_space({ possible_effects: [], effects: [] }), false);
	assert.equal(combat_effect_space({ possible_effects: ['poison'], effects: [] }), true);
	assert.equal(combat_effect_space({ possible_effects: [], effects: [{ id: 'burn' }] }), true);
	assert.equal(combat_effect_space({ effects: [] }), true);
});


test('dungeon tier badges use dungeon progress independently of shared caps', async () => {
 const { combat_raid_tiers } = await import('../../mod/combat-arena.mjs');
 const dungeon = { tiers: [{cap:12,complete:true,food_cap:2},{cap:15,complete:false}] };
 const food = {slot:'Food',tier:2,item_id:'melvorD:Herring',heal:50};
 const tiers = combat_raid_tiers({skill_caps:{attack:99}},2,dungeon,[food]);
 assert.deepEqual(tiers.map(tier => tier.complete),[true,false]);
 assert.deepEqual(tiers.map(tier => tier.selected),[false,true]);
 assert.deepEqual(tiers[0].food,food);
 assert.equal(tiers[1].food,null);
 assert.equal(tiers.length,2);
});

test('opponent image treatments follow numbered raid actors and permit individual overrides', async () => {
	const { combat_actor_image_style } = await import('../../mod/combat-arena.mjs');
	assert.deepEqual(combat_actor_image_style('golbin_3'), combat_actor_image_style('golbin'));
	assert.deepEqual(combat_actor_image_style('mind_golbin_2'), combat_actor_image_style('mind_golbin'));
	assert.notDeepEqual(combat_actor_image_style('golbin'), combat_actor_image_style('mind_golbin'));
	assert.deepEqual(combat_actor_image_style('golbin_scout_2'), combat_actor_image_style('golbin_scout'));
	assert.deepEqual(combat_actor_image_style('tutorial_1'), {});
	assert.deepEqual(combat_actor_image_style('golbin_2', { golbin: 'brightness(.8)', golbin_2: 'sepia(1)' }), { '--mp-combat-image-filter': 'sepia(1)' });
});


test('opponent view cycles locally with a delay and resets only for a new fight', async () => {
	const { combat_opponents_compact } = await import('../../mod/combat-arena.mjs');
	const h = harness();
	assert.equal(h.view.opponents_view, 'auto');
	h.view.arena = { enemies: Array.from({ length: 5 }, () => ({ hp: 10 })) };
	assert.equal(combat_opponents_compact(h.view), true);
	h.view.arena.enemies[0].hp = 0;
	assert.equal(combat_opponents_compact(h.view), true);
	h.view.arena.enemies.forEach(enemy => { enemy.hp = 0; });
	assert.equal(combat_opponents_compact(h.view), true);
	h.view.arena.enemies.pop();
	assert.equal(combat_opponents_compact(h.view), false);
	assert.equal(h.controller.cycle_opponents_view(), true);
	assert.equal(h.view.opponents_view, 'full');
	assert.equal(h.controller.cycle_opponents_view(), false);
	h.advance(400);
	h.controller.cycle_opponents_view();
	assert.equal(h.view.opponents_view, 'compact');
	assert.equal(combat_opponents_compact(h.view), true);
	h.advance(400); h.controller.cycle_opponents_view();
	assert.equal(h.view.opponents_view, 'auto');
	await h.controller.connect();
	const ws = h.sockets[0]; ws.open(); ws.message({ type: 'ready', protocol: 4 });
	ws.message({ type: 'state', arena: { id: 'fight', status: 'active', enemies: [] } });
	h.controller.cycle_opponents_view();
	assert.equal(h.view.opponents_view, 'full');
	ws.message({ type: 'state', arena: { id: 'fight', status: 'active', run: { phase: 'respawning' }, enemies: [] } });
	assert.equal(h.view.opponents_view, 'full');
	ws.message({ type: 'state', arena: { id: 'fight', status: 'victory', enemies: [] } });
	await h.controller.connect();
	const next = h.sockets[1]; next.open(); next.message({ type: 'ready', protocol: 4 });
	next.message({ type: 'state', arena: { id: 'next', status: 'active', enemies: [] } });
	assert.equal(h.view.opponents_view, 'auto');
});


test('feedback attack icons follow the source rather than the damaged actor', async () => {
	const { combat_feedback_attack_type } = await import('../../mod/combat-arena.mjs');
	const arena = { player: { stats: { attack_type: 'melee' } }, enemies: [
		{ id: 'archer', stats: { attack_type: 'ranged' } }, { id: 'mage', stats: { attack_type: 'magic' } }
	] };
	assert.equal(combat_feedback_attack_type(arena, { actor: 'archer', target: 'player' }), 'ranged');
	assert.equal(combat_feedback_attack_type(arena, { actor: 'mage', target: 'player' }), 'magic');
	assert.equal(combat_feedback_attack_type(arena, { actor: 'player', target: 'mage' }), 'melee');
	assert.equal(combat_feedback_attack_type(arena, { actor: 'previous-wave', target: 'player' }), 'melee');
	assert.equal(combat_feedback_attack_type(null, { actor: 'player' }), 'melee');
});


test('max-hit markers use each opponent triangle even when the selected-target value changes', async () => {
	const { combat_opponent_max_hit } = await import('../../mod/combat-arena.mjs');
	const arena = { registration: {}, player: { base_damage: { max_hit: 19 }, stats: { max_hit: 20 } } };
	const melee = { hp: 10, stats: { attack_type: 'melee' } };
	const ranged = { hp: 10, stats: { attack_type: 'ranged' } };
	const magic = { hp: 10, stats: { attack_type: 'magic' } };
	for (const selected_max of [20, 16, 19]) {
		arena.player.stats.max_hit = selected_max;
		assert.deepEqual([melee, ranged, magic].map(enemy => combat_opponent_max_hit(arena, enemy)), [19, 20, 16]);
	}
	ranged.hp = 0;
	assert.equal(combat_opponent_max_hit(arena, ranged), 0);
	assert.equal(combat_opponent_max_hit(null, melee), 0);
	assert.equal(combat_opponent_max_hit({ player: { stats: { max_hit: 12 } } }, melee), 12);
});

test('background forfeits preserve elapsed combat and show exactly one result after closing', async () => {
	const results = [], states = [];
	const h = harness({ on_result: arena => results.push(arena), on_state: arena => states.push(arena) });
	await h.controller.connect();
	const ws = h.sockets[0]; ws.open(); ws.message({ type: 'ready', protocol: 4 });
	ws.message({ type: 'state', arena: { id: 'fight', status: 'active', elapsed_ms: 1200, run: { total_ms: 4500 } } });
	assert.equal(h.controller.forfeit(), true);
	assert.equal(ws.closed, true);
	assert.equal(h.tasks.size, 0);
	assert.equal(h.view.arena.status, 'fled');
	assert.equal(h.view.arena.run.total_ms, 4500);
	assert.equal(h.view.arena.elapsed_ms, 1200);
	assert.equal(states.at(-1), h.view.arena);
	assert.equal(results.length, 1);
	assert.equal(h.controller.forfeit(), false);
	assert.equal(results.length, 1);
	assert.equal(h.view.arena.status, 'fled');
	await h.controller.connect();
	assert.equal(h.sockets.length, 2);
});


test('raid status bindings remain safe during queued arena teardown', async () => {
	const html = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const row = html.match(/<p v-show="state.combat.arena\?\.run\?\.mode === 'raid'"[^>]*>([^\n]+)<\/p>/)?.[1];
	assert.ok(row);
	const state = { combat: { arena: null }, combat_raid_copy: String, combat_roman: String, combat_time: String };
	for (const [, expression] of row.matchAll(/\{\{(.*?)\}\}/g))
		assert.doesNotThrow(() => new Function('state', `return (${expression});`)(state));
});


test('Tidal is a two-tier dungeon and compact mode retains all twelve or eight selectable actors', async () => {
 const {combat_choices,combat_opponents_compact,combat_raid_tiers,create_combat_snapshot_reader}=await import('../../mod/combat-arena.mjs');
 assert.deepEqual(combat_choices('raid').map(d=>d.name),['Golbin Horde','Tidal Caverns','Sinking Mire','Cinder Quarry']);
 for(const count of [8,9,11,12]) {
  const enemies=Array.from({length:count},(_,i)=>({id:'saltwing_'+i,hp:14,max_hp:14}));
  const arena={id:'tidal',enemies};
  const read=create_combat_snapshot_reader().read({type:'state',seq:1,arena});
  assert.equal(read.enemies.length,count);
  assert.equal(combat_opponents_compact({opponents_view:'auto',arena:read}),true);
 }
 assert.equal(combat_raid_tiers(null,1,{tiers:[{cap:12,complete:false},{cap:15,complete:false}]}).length,2);
});


test('dungeon personal-best bindings tolerate switching to a dungeon with no record', async () => {
	const html = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const row = html.split('\n').find(line => line.includes('v-if="state.combat_dungeon()?.best"'));
	assert.ok(row);
	for (const dungeon of [null, {best:null}, {best:{elapsed_ms:1234,achieved_at:0}}]) {
		const state = {combat_dungeon: () => dungeon, combat_raid_copy: String, combat_time: String, combat_local_date: String};
		for (const [, expression] of row.matchAll(/\{\{(.*?)\}\}/g))
			assert.doesNotThrow(() => new Function('state', `return (${expression});`)(state));
	}
});

test('Mire uses server-adjusted per-target max-hit markers and the exact portrait orientations', async () => {
	const {combat_opponent_max_hit,combat_actor_image_style,combat_raid_tiers}=await import('../../mod/combat-arena.mjs');
	const arena={registration:{},player:{base_damage:{max_hit:50},stats:{max_hit:1}}};
	const blob={id:'blob_1',hp:75,player_max_hit:1,stats:{attack_type:'melee'}};
	const toad={id:'bittertoad_1',hp:65,player_max_hit:50,stats:{attack_type:'melee'}};
	assert.equal(combat_opponent_max_hit(arena,blob),1);
	assert.equal(combat_opponent_max_hit(arena,toad),50);
	arena.player.stats.max_hit=50;
	assert.equal(combat_opponent_max_hit(arena,blob),1);
	for(const id of ['blob','blob_2','drowned_root','drowned_root_1']) assert.equal(combat_actor_image_style(id)['--mp-combat-image-scale-x'],-1);
	for(const id of ['bittertoad','bittertoad_2','bogmaw','bogmaw_1']) assert.equal(combat_actor_image_style(id)['--mp-combat-image-scale-x'],undefined);
	assert.deepEqual(combat_raid_tiers(null,2,{tiers:[{cap:17,complete:true},{cap:19,complete:false},{cap:21,complete:false}]}).map(t=>({cap:t.cap,locked:t.locked})),[{cap:17,locked:false},{cap:19,locked:false},{cap:21,locked:true}]);
});
