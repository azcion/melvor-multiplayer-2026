const COMBAT_PROTOCOL = 4;
export function combat_elapsed_ms(value) {
	return value?.elapsed_ms ?? 0;
}

export function combat_attack_progress(actor, elapsed_ms) {
	if (!actor || actor.hp <= 0 || !(actor.interval > 0)) return 0;
	return Math.max(0, Math.min(1, 1 - (actor.next_attack - elapsed_ms) / actor.interval));
}

// A one-max-hit HP threshold, not a prediction of the next hit or its success.
export function combat_max_hit_marker(max_hit, max_hp) {
	if (!Number.isFinite(max_hit) || !Number.isFinite(max_hp) || max_hp <= 0) return 0;
	return Math.max(0, Math.min(100, 100 * max_hit / max_hp));
}

// Cosmetic projection of the server's Standard melee triangle, from unmodified snapshot damage.
// Never reuse player.stats.max_hit here: that value has already been adjusted for the selected target.
export function combat_opponent_max_hit(arena, enemy) {
	if (!enemy || enemy.hp <= 0) return 0;
	if (Number.isFinite(enemy.player_max_hit)) return enemy.player_max_hit;
	const base = arena?.player?.base_damage?.max_hit;
	if (arena?.registration && Number.isFinite(base))
		return Math.floor(base * ({ melee: 1, ranged: 1.1, magic: .85 }[enemy.stats?.attack_type] ?? 1));
	return arena?.player?.stats?.max_hit ?? 0;
}

// One danger threshold for the strongest living enemy, not combined burst damage.
export function combat_player_thresholds(arena) {
	const max_hit = (arena?.enemies ?? []).reduce((highest, enemy) =>
		enemy.hp > 0 && Number.isFinite(enemy.stats?.max_hit) ? Math.max(highest, enemy.stats.max_hit) : highest, 0);
	const max_hp = arena?.player?.max_hp;
	const percent = arena?.food_policy?.auto_eat_percent;
	const auto_eat_hp = Number.isFinite(max_hp) && max_hp > 0 && Number.isFinite(percent)
		? Math.floor(max_hp * Math.max(0, Math.min(100, percent)) / 100) : 0;
	return { max_hit, auto_eat_hp };
}

// Keep the row stable for possible incoming/self effects, even between applications.
// Older servers lack capability metadata: retain their reserved space conservatively.
export function combat_effect_space(actor) {
	return !!actor && (actor.possible_effects === undefined || actor.possible_effects.length > 0 || (actor.effects?.length ?? 0) > 0);
}

// Cosmetic only: never predicts damage, food, attack outcomes or another attack cycle.
export function create_combat_animator({ get_root, now = () => performance.now(), frames = globalThis,
	reduced_motion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false }) {
	let arena = null, received_at = 0, projected_at = 0, frame = null;
	function projected_elapsed(time) {
		const elapsed = combat_elapsed_ms(arena);
		if (arena?.status !== 'active' || arena.run?.phase === 'respawning' || reduced_motion()) return elapsed;
		// Bound cosmetic lead to 400ms; each actor fill still clamps at its confirmed next attack.
		return Math.min(elapsed + 400, projected_at + Math.max(0, time - received_at));
	}
	function paint() {
		frame = null;
		if (!arena) return;
		const active = arena.status === 'active' && arena.run?.phase !== 'respawning';
		// Hold after two missed snapshots rather than animate indefinitely on a stalled connection.
		const elapsed = projected_elapsed(now());
		const actors = [arena.player, ...arena.enemies];
		for (const bar of get_root()?.querySelectorAll('[data-combat-actor]') ?? []) {
			const actor = actors.find(actor => actor.id === bar.dataset.combatActor);
			if (actor) bar.style.transform = `scaleX(${arena.run?.phase === 'respawning' ? 0 : combat_attack_progress(actor, elapsed)})`;
		}
		for (const fill of get_root()?.querySelectorAll('[data-combat-eat-fill]') ?? []) {
			fill.style.transform = `scaleY(${combat_eat_overlay(arena, elapsed)})`;
			fill.style.opacity = String(combat_eat_opacity(arena, elapsed));
		}
		if (active && elapsed < combat_elapsed_ms(arena) + 400 && !reduced_motion()) frame = frames.requestAnimationFrame(paint);
	}
	return {
		update(value) {
			if (frame !== null) frames.cancelAnimationFrame(frame);
			const time = now();
			const continuing = arena && value && arena.id === value.id && arena.status === 'active' && value.status === 'active'
				&& arena.run?.phase === value.run?.phase && arena.run?.stage === value.run?.stage
				&& combat_elapsed_ms(value) >= combat_elapsed_ms(arena);
			// Packet jitter and command replies can repeat or trail the projected clock. Preserve its
			// position while retaining the new snapshot's authoritative attack/cooldown reset times.
			projected_at = continuing ? Math.max(combat_elapsed_ms(value), projected_elapsed(time)) : combat_elapsed_ms(value);
			frame = null; arena = value; received_at = time;
			// Wait until Petite Vue has mounted any new actor elements.
			if (arena) frame = frames.requestAnimationFrame(paint);
		}
	};
}

// Presentation state is local to the entire run, including repeat respawns and raid waves.
export function combat_opponents_compact(view) {
	return view.opponents_view === 'compact' || (view.opponents_view === 'auto' &&
		(view.arena?.enemies?.length ?? 0) > 4);
}

export function create_combat_view() {
	return { recovery_notice: '', recovery: null, recovery_supported: false, maintenance: null, dungeon_debug_options: null, dungeon_debug_target: 'tidal:2', dungeon_debug_levels: {attack:12,strength:12,defence:12,hitpoints:12}, dungeon_debug_gear: {Weapon:'melvorD:Iron_Sword',Shield:'melvorD:Iron_Shield',Helmet:'melvorD:Iron_Helmet'}, dungeon_debug_food: 'melvorD:Herring', dungeon_debug_confirm: false, test_profile: false, practice: [], practice_category: 'duels', practice_selection: 'recruit', practice_tier: 1, practice_tab: 'picker', opponents_view: 'auto', result: null, raid_tab: 'raids', raid_selection: 'golbins', raid_page: 0, raid_loading: false, dungeons: [], raid: null, unlocks: null, tutorial_debug_targets: [], tutorial_debug_confirm: false, tutorial_debug_target: 'start', tutorial: null, mode: 'once', encounter: '', supported_encounters: [], status: 'idle', arena: null, pending: false, starting: false, error: '', latency: 0, foods: [], character: null, ep_micros: 0, level_quantities: {}, reset_confirm: false, equipment_set: 'melee', equipment_reset_confirm: false, consumables_reset_confirm: false, page_tab: 'character', combat_tab: 'test_combat', preparation_tab: 'levels', history: [], debug_enabled: false, inventory_busy: false, inventory_error: '', food_id: '', stance: 'accurate' };
}

export function combat_socket_url(origin) {
	const url = new URL(origin);
	if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
		(url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))))
		throw new Error('Invalid combat origin');
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	url.pathname = '/combat/socket';
	return url.href;
}

export function create_combat_controller({ view, get_scope, get_origin, can_connect, ticket,
	Socket = WebSocket, now = () => performance.now(), timers = globalThis, on_state = () => {}, on_start = () => {}, on_result = () => {} }) {
	let socket = null, generation = 0, sequence = 0, pending_sequence = 0;
	let snapshots = create_combat_snapshot_reader(), deltas = false;
	let next_view_change = 0;
	let heartbeat = null, deadline = null, command_deadline = null;
	const delivered_results = new Set();
	let delivering = null, acknowledging_result = false;
	let recovery_intent = null, recovery_result = undefined, recovering = false;
	let last_received = 0, ping_sent = 0, next_connection = 0, auto_start = false;
	function close(status = 'closed', preserve_arena = false) {
		generation++;
		timers.clearInterval(heartbeat); timers.clearTimeout(deadline); timers.clearTimeout(command_deadline);
		heartbeat = deadline = command_deadline = null;
		const old = socket;
		socket = null;
		if (old) { old.onopen = old.onmessage = old.onclose = old.onerror = null; old.close(); }
		view.supported_encounters = [];
		view.status = status; view.pending = false; view.starting = false; view.latency = 0; auto_start = false;
		if (!preserve_arena) { if (view.recovery_supported && view.arena?.status === 'active') view.recovery = {id:view.arena.id,state:'unknown',remaining_ms:0}; view.arena = null; on_state(null); }
	}
	async function connect(start_after_connect = false, intent = null) {
		if (socket && view.status === 'ready' && !view.pending && start_after_connect && view.recovery_supported) {
			auto_start = true; recovering = true; recovery_result = undefined; send({type:'recover'}); return;
		}
		if (socket || view.status === 'connecting' || !can_connect() || now() < next_connection) { if (start_after_connect) { view.starting = false; view.status = 'error'; } return; }
		next_connection = now() + 5000;
		close('connecting'); delivering = null; acknowledging_result = false; view.recovery_notice = ''; recovery_intent = intent; recovery_result = undefined; recovering = false; view.starting = start_after_connect; auto_start = start_after_connect; view.error = '';
		const current = generation, scope = get_scope();
		const valid = () => current === generation && scope === get_scope() && can_connect();
		try {
			const result = await ticket();
			if (!valid()) { if (current === generation) close('closed'); return; }
			if (!result?.available || result.protocol !== COMBAT_PROTOCOL || result.socket_path !== '/combat/socket' || typeof result.ticket !== 'string') {
				close('unavailable'); return;
			}
			const ws = socket = new Socket(combat_socket_url(get_origin()));
			sequence = pending_sequence = 0;
			snapshots = create_combat_snapshot_reader(); deltas = false;
			deadline = timers.setTimeout(() => { if (valid()) close('error'); }, 8000);
			ws.onopen = () => {
				if (!valid()) { close(); return; }
				ws.send(JSON.stringify({ type: 'authenticate', protocol: COMBAT_PROTOCOL, ticket: result.ticket, capabilities: ['state-delta-v1', 'pve-recovery-v1'] }));
			};
			ws.onmessage = event => {
				if (!valid()) { close(); return; }
				let message;
				try { message = JSON.parse(event.data); } catch { close('error'); return; }
				last_received = now();
				if (message.type === 'ready' && message.protocol === COMBAT_PROTOCOL && view.status === 'connecting') {
					timers.clearTimeout(deadline); view.status = 'ready';
					deltas = message.capabilities?.includes('state-delta-v1') === true;
					view.supported_encounters = Array.isArray(message.encounters)
						? message.encounters.filter(id => typeof id === 'string' && id !== 'mossbound')
						: [];
					view.recovery_supported = message.capabilities?.includes('pve-recovery-v1') === true;
					view.maintenance = message.maintenance ?? null;
					if (view.recovery_supported) { recovering = true; send({type:'recover'}); }
					if (!view.recovery_supported && auto_start && (!['test_combat', 'raid'].includes(view.page_tab) || !start())) {
						if (['test_combat', 'raid'].includes(view.page_tab) && !view.error) view.error = 'rejected';
						close('idle', true); return;
					}
					heartbeat = timers.setInterval(() => {
						if (!valid() || now() - last_received > 8000) { close('closed'); return; }
						if (ws.readyState !== 1 || ws.bufferedAmount > 8192) { close('error'); return; }
						ping_sent = now(); ws.send(JSON.stringify({ type: 'heartbeat' }));
					}, 2000);
				} else if (message.type === 'maintenance') {
					view.maintenance = message;
				} else if (message.type === 'recovery') {
					recovery_result = message.saved;
					view.maintenance = message.maintenance ?? view.maintenance;
					view.recovery = message.saved ? {id:message.saved.arena.id,state:message.saved.state,remaining_ms:message.saved.remaining_ms} : null;
				} else if (message.type === 'state' || message.type === 'state_delta') {
					try { if (deltas) message = { ...message, arena: snapshots.read(message) };
						else if (message.type !== 'state') throw new Error('Unnegotiated delta');
					} catch { close('error'); return; }
					if (!message.arena && recovering) return;
					if (message.arena?.status === 'active') view.recovery = null;
					const starting = message.arena?.status === 'active' && view.arena?.status !== 'active';
					if (starting) { view.page_tab = view.combat_tab; view.opponents_view = 'auto'; next_view_change = 0; }
					view.arena = message.arena;
					if (COMBAT_STANCES.includes(message.arena?.stance)) view.stance = message.arena.stance;
					if (starting) { view.starting = false; auto_start = false; on_start(); }
					on_state(message.arena);
					if (message.arena && message.arena.status !== 'active') {
						if (view.recovery_supported) { void deliver_result(message.arena); }
						else { next_connection = 0; close('idle', true); if (['victory','defeat','draw','fled'].includes(message.arena.status)) on_result(message.arena); }
					}
				} else if (message.type === 'heartbeat') {
					view.latency = Math.max(0, Math.round(now() - ping_sent));
				} else if (message.type === 'ack' && message.seq === pending_sequence) {
					timers.clearTimeout(command_deadline); view.pending = false;
					if (acknowledging_result) { acknowledging_result = false; if (message.accepted) view.recovery = null; next_connection = 0; close('idle',true); return; }
					if (recovering && recovery_result !== undefined) {
						recovering = false;
						const saved = recovery_result; recovery_result = undefined;
						if (saved?.state === 'terminal') {
							view.arena = saved.arena; on_state(saved.arena); auto_start = false; view.starting = false;
							void deliver_result(saved.arena); return;
						}
						if (saved?.state === 'paused' && ['resume','abandon'].includes(recovery_intent)) {
							const action = recovery_intent; recovery_intent = null; auto_start = false;
							view.encounter = saved.arena.run?.selection ?? saved.arena.encounter; view.mode = saved.arena.run?.mode ?? 'once';
							view.combat_tab = view.mode === 'raid' ? 'raid' : 'test_combat';
							send({type:action,encounter:saved.arena.id}); return;
						}
						if (!saved && auto_start) { start(); return; }
						auto_start = false; view.starting = false;
					}

					view.error = message.accepted ? '' : 'rejected';
					if (!message.accepted && auto_start) close('idle', true);
				}
			};
			ws.onclose = () => { if (current === generation) close('closed'); };
			ws.onerror = () => { if (current === generation) close('error'); };
		} catch { if (current === generation) close('error'); }
	}
	async function deliver_result(arena) {
		if (delivering === arena.id) return;
		delivering = arena.id;
		const current = generation, scope = get_scope(), key = `${scope}:${arena.id}`;
		view.recovery = {id:arena.id,state:'terminal',remaining_ms:0};
		try {
			if (!delivered_results.has(key) && ['victory','defeat','draw','fled'].includes(arena.status)) await on_result(arena);
			if (current !== generation || scope !== get_scope()) return;
			delivered_results.add(key);
			if (arena.status === 'expired') view.recovery_notice = 'expired';
			acknowledging_result = send({type:'abandon',encounter:arena.id});
			if (!acknowledging_result) close('closed',true);
		} catch { if (current === generation) close('error',true); }
	}

	function send(payload) {
		if (view.status !== 'ready' || view.pending || !can_connect() || socket?.readyState !== 1) return false;
		if (socket.bufferedAmount > 8192) { close('error'); return false; }
		view.pending = true; view.error = '';
		pending_sequence = ++sequence;
		try { socket.send(JSON.stringify({ ...payload, seq: sequence })); }
		catch { close('error'); return false; }
		command_deadline = timers.setTimeout(() => close('error'), 5000);
		return true;
	}
	function start() {
		if (view.status === 'ready' && !view.supported_encounters.includes(view.encounter)) { view.error = 'target_unavailable'; return false; }
		const sent = send({ type: 'start', encounter: view.encounter, mode: view.mode, stance: view.stance });
		if (sent) view.combat_tab = view.page_tab;
		return sent;
	}
	return {
		connect, close, start,
		recover(intent = null) { if (socket && view.status === 'ready') { recovery_intent = intent; recovering = true; recovery_result = undefined; return send({type:'recover'}); } return connect(false,intent); },
		forfeit() {
			if (view.recovery_supported) return send({type:'command',encounter:view.arena?.id,action:'flee'});
			const arena = view.arena?.status === 'active' ? { ...view.arena, status: 'fled' } : null;
			close('idle', true);
			if (!arena) return false;
			next_connection = 0;
			view.arena = arena;
			on_state(arena);
			on_result(arena);
			return true;
		},
		cycle_opponents_view() {
			if (now() < next_view_change) return false;
			next_view_change = now() + 400;
			view.opponents_view = ({ auto: 'full', full: 'compact', compact: 'auto' })[view.opponents_view];
			return true;
		},
		act: (action, target) => send({ type: 'command', encounter: view.arena?.id, action, target })
	};
}


export const COMBAT_EFFECTS = ['poison', 'bleed', 'burn', 'slow', 'freeze'];
export const COMBAT_STANCES = ['accurate', 'aggressive', 'defensive'];
export function combat_effect_icon(id) {
	return ({ poison: 'fa-leaf', bleed: 'fa-tint', burn: 'fa-fire', slow: 'fa-hourglass-half', freeze: 'fa-snowflake' })[id] ?? 'fa-circle';
}
export function combat_tick(arena) { return Math.floor((arena?.elapsed_ms ?? 0) / (arena?.step_ms || 100)); }
export function combat_effect_remaining(effect, arena) {
	if (effect.lifetime === 'persistent') return null;
	return effect.remaining_attacks === null ? Math.max(0, effect.expires_tick - combat_tick(arena)) : effect.remaining_attacks;
}
// Feedback belongs to the receiving actor; its damage icon belongs to the attacker.
export function combat_feedback_attack_type(arena, event) {
	return (event.actor === 'player' ? arena?.player : arena?.enemies?.find(actor => actor.id === event.actor))?.stats?.attack_type ?? 'melee';
}

export function combat_feedback(arena, actor_id) {
	// Several hits between snapshots remain individually visible; no client damage prediction.
	return (arena?.log ?? []).filter(event => event.target === actor_id && !event.kind.startsWith('apply_') &&
		(event.amount > 0 || event.kind === 'attack') && event.elapsed_ms >= (arena.elapsed_ms - 8 * (arena.step_ms || 100))).slice(-3);
}

export function combat_eat_remaining(arena) {
	if (!arena) return 0;
	// Compatible display while the new client precedes the combat-service rollout.
	return Math.max(0, arena.food_policy?.cooldown_ticks === undefined
		? Math.ceil(((arena.next_eat ?? 0) - arena.elapsed_ms) / (arena.step_ms || 100))
		: (arena.next_eat ?? 0) - combat_tick(arena));
}

// Cosmetic readiness fill; button availability still follows the authoritative cooldown.
export function combat_eat_progress(arena, elapsed_ms = combat_elapsed_ms(arena)) {
	if (!arena) return 1;
	const step = arena.step_ms || 100;
	const duration = (arena.food_policy?.cooldown_ticks ?? 10) * step;
	const ready_at = (arena.next_eat ?? 0) * (arena.food_policy?.cooldown_ticks === undefined ? 1 : step);
	return duration > 0 ? Math.max(0, Math.min(1, 1 - (ready_at - elapsed_ms) / duration)) : 1;
}

export function combat_eat_overlay(arena, elapsed_ms = combat_elapsed_ms(arena)) {
	return combat_eat_progress(arena, elapsed_ms);
}

// Fade the completed fill over 100 ms; initial readiness has no overlay.
export function combat_eat_opacity(arena, elapsed_ms = combat_elapsed_ms(arena)) {
	if (!arena?.next_eat) return 0;
	const ready_at = arena.next_eat * (arena.food_policy?.cooldown_ticks === undefined ? 1 : (arena.step_ms || 100));
	return Math.max(0, Math.min(1, 1 - (elapsed_ms - ready_at) / 100));
}

export function combat_time(ms) { return (Math.max(0, ms ?? 0) / 1000).toFixed(1) + 's'; }
export function combat_duration(ticks, arena) { return combat_time(ticks * (arena?.step_ms || 100)); }

// Practice currently contains only the server-owned tutorial.
export function combat_choices(mode) {
	if (mode === 'raid') return [{ id: 'golbins', name: 'Golbin Horde', actors: ['golbin','golbin_scout','mind_golbin'], description: '', groups: [] }, { id: 'tidal', name: 'Tidal Caverns', actors: ['undertide'], description: '', groups: [] }, { id: 'mire', name: 'Sinking Mire', actors: ['blob','bittertoad','bogmaw','drowned_root'], description: '', groups: [] }, { id: 'quarry', name: 'Cinder Quarry', actors: ['cinder_snail','kiln_wisp','embercoil','slagheart'], description: '', groups: [] }];
	return [];
}
export function combat_run_title(arena) {
	return combat_choices(arena?.run?.mode ?? 'once').find(choice => choice.id === (arena?.run?.selection ?? arena?.encounter))?.name ?? '';
}

export const COMBAT_RUN_COPY = {
	choose: 'Choose your encounter', mode: 'Encounter mode', targets: 'Combat targets',
	respawning: 'Respawning…', countdown: 'Respawn countdown', stage: 'Stage', completed: 'Fights won',
	start: 'Start Battle', stop: 'Stop Battle'
};

// Reconstruct immutable snapshots before exposing them to the view. A gap closes the fight safely.
export function create_combat_snapshot_reader() {
	let arena = null, sequence = 0;
	const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
	function apply(previous, changes) {
		if (!Array.isArray(changes)) throw new Error('Invalid combat changes');
		const result = structuredClone(previous);
		for (const change of changes) {
			if (!Array.isArray(change) || change.length < 1 || change.length > 2 || !Array.isArray(change[0]) || !change[0].length)
				throw new Error('Invalid combat change');
			const path = change[0];
			if (path.some(key => typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('Invalid combat field');
			let target = result;
			for (const key of path.slice(0, -1)) {
				if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) throw new Error('Invalid combat path');
				target = target[key];
			}
			if (!target || typeof target !== 'object') throw new Error('Invalid combat target');
			const key = path.at(-1);
			if (Array.isArray(target) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= target.length || change.length !== 2)) throw new Error('Invalid combat index');
			if (change.length === 1) delete target[key];
			else target[key] = change[1];
		}
		return result;
	}
	return {
		read(message) {
			if (!Number.isSafeInteger(message.seq) || message.seq <= sequence) throw new Error('Invalid combat sequence');
			if (message.type === 'state') {
				if (message.arena !== null && !object(message.arena)) throw new Error('Invalid combat state');
				arena = message.arena;
			} else {
				if (!arena || message.type !== 'state_delta' || message.base !== sequence || message.seq !== sequence + 1 || message.id !== arena.id)
					throw new Error('Combat snapshot gap');
				const next = apply(arena, message.changes);
				if (next.id !== arena.id) throw new Error('Combat identity changed');
				arena = next;
			}
			sequence = message.seq;
			return arena;
		}
	};
}

export function combat_local_date(timestamp) {
	return Number.isSafeInteger(timestamp) && timestamp >= 0 ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(timestamp)) : '';
}

export function combat_raid_tiers(unlocks, endpoint = 1, dungeon, catalog = []) {
	return (dungeon?.tiers ?? [3,6,9].map(cap => ({cap, complete: false}))).map((definition, index) => ({
		name: definition.name, tier: index + 1, numeral: ['I', 'II', 'III'][index], cap: definition.cap,
		material_cap: definition.material_cap ?? null, chamber_effects: definition.chamber_effects ?? [],
		gains: (definition.material_cap ? [] : ['attack','strength','defence','hitpoints']).map(skill => ({skill, cap: definition.cap})),
		food: catalog.find(item => item.slot === 'Food' && item.tier === definition.food_cap) ?? null,
		selected: index + 1 === endpoint, locked: index + 1 > endpoint, complete: definition.complete
	}));
}

export const COMBAT_RAID_COPY = {
	tier: 'Tier', tiers: 'Tiers', wave: 'Wave', raids: 'Dungeons', unlocks: 'Tier unlocks', cap: 'Level cap',
	best: 'Personal best', leaderboard: 'Leaderboard', completed: 'Completed', selected: 'Selected', locked: 'Locked', start: 'Start Dungeon',
	description: 'Fight your way through the Golbin horde. Defeat each tier to unlock higher skill levels for your fighter.',
	qualification: 'Finish all tiers to qualify for leaderboards.',
	empty: 'No times yet.', rank: 'Rank', player: 'Player', time: 'Time', achieved: 'Achieved', previous: 'Previous', next: 'Next'
};

// Only announce access confirmed by the post-fight inventory; never infer rewards from a win.
export function combat_result_details(arena, before, after) {
	const elapsed = arena.run?.total_ms ?? arena.elapsed_ms ?? 0;
	return { time: !String(arena.run?.selection ?? arena.encounter).startsWith('practice_') && ['victory', 'draw', 'fled'].includes(arena.status) ? (Math.max(0, elapsed) / 1000).toFixed(1) + 's' : null,
		unlocks: arena.status === 'victory' && before && after ? Object.entries(after)
			.filter(([skill, cap]) => Number.isFinite(before[skill]) && cap > before[skill])
			.map(([skill, cap]) => ({ skill, cap })) : [] };
}

// Per-opponent portrait treatments, shared by selection tiles and in-battle artwork.
export const COMBAT_ACTOR_IMAGE_EFFECTS = {
	golbin: 'hue-rotate(15deg) saturate(.4) brightness(.75)',
	golbin_scout: 'hue-rotate(60deg) saturate(.45) brightness(.75)',
	saltwing: 'hue-rotate(-60deg) saturate(.6) brightness(.8)',
	reefbreaker: 'hue-rotate(-30deg) saturate(.8) brightness(.8)',
	undertide: 'hue-rotate(-150deg) saturate(.6) brightness(.9)',
	undertide_tendril: 'saturate(.5) hue-rotate(15deg)',
	mind_golbin: 'hue-rotate(175deg) saturate(.5) brightness(.75)',
	blob: 'hue-rotate(-220deg) saturate(.5) brightness(.8)',
	bittertoad: 'hue-rotate(90deg) saturate(.5) brightness(.75)',
	bogmaw: 'hue-rotate(30deg) saturate(.9) brightness(.8)',
	drowned_root: 'hue-rotate(60deg) saturate(.3) brightness(.5)',
	kiln_wisp: 'hue-rotate(-10deg)',
	embercoil: 'hue-rotate(-20deg)'
};
export function combat_actor_image_style(id, effects = COMBAT_ACTOR_IMAGE_EFFECTS) {
	const actor = String(id).replace(/_\d+$/, '');
	const filter = effects[id] ?? effects[actor];
	return { ...(filter ? { '--mp-combat-image-filter': filter } : {}),
		...(['blob','drowned_root'].includes(actor) ? { '--mp-combat-image-scale-x': -1 } : {}) };
}

// Material access is confirmed by settlement, independently of skill-cap rewards.
export function combat_material_gains(before, after) {
	const groups = new Map();
	for (const [slot, tier] of Object.entries(after?.material_caps ?? {})) {
		if (!Number.isFinite(before?.material_caps?.[slot]) || tier <= before.material_caps[slot]) continue;
		if (!groups.has(tier)) groups.set(tier, []);
		groups.get(tier).push(slot);
	}
	return [...groups].map(([tier, slots]) => ({ tier, slots }));
}
