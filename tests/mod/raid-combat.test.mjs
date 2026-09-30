import assert from 'node:assert/strict';
import test from 'node:test';
import {
	format_raid_attack_description,
	install_raid_attack_description_hook,
	RaidCombatController,
	RAID_MONSTER_IDS,
	has_full_hitpoints,
	install_raid_combat_hooks,
	is_raid_monster,
	apply_raid_resistance,
	raid_resistance_from_defeats
} from '../../mod/raid-combat.mjs';

function memory_storage(initial = null) {
	let value = initial;
	return {
		get: () => value,
		set: next => value = next,
		remove: () => value = null
	};
}

function reservation(overrides = {}) {
	return {
		assault_id: 'assault-1',
		settlement_key: 'settlement-1',
		tier: 1,
		combat_deadline: 31_000,
		...overrides
	};
}

function event_source(properties = {}) {
	const handlers = new Map();
	return {
		...properties,
		on(name, handler) {
			const listeners = handlers.get(name) ?? [];
			listeners.push(handler);
			handlers.set(name, listeners);
		},
		emit(name, event = {}) {
			for (const handler of handlers.get(name) ?? [])
				handler(event);
		}
	};
}

function combat_harness() {
	class CombatManager {}
	const patches = new Map();
	const ctx = {
		patch(_class, method) {
			const entry = patches.get(method) ?? {};
			patches.set(method, entry);
			return { replace: fn => entry.replace = fn };
		}
	};
	const storage = memory_storage();
	const controller = new RaidCombatController({
		now: () => 1_000,
		storage,
		settle: async () => ({ success: false })
	});
	const combat = event_source({
		player: event_source(),
		enemy: event_source({ activeEffects: new Map() }),
		selectedMonster: undefined,
		resetActionState() {
			this.selectedMonster = undefined;
		}
	});
	const game = { combat, monsters: {}, combatAreas: {} };
	const integration = install_raid_combat_hooks(ctx, controller, CombatManager, game);
	return { combat, controller, integration, patches, storage };
}

test('only treats a finite current/max HP pair at equality as full health', () => {
	assert.equal(has_full_hitpoints({ hitpoints: 100, stats: { maxHitpoints: 100 } }), true);
	assert.equal(has_full_hitpoints({ hitpoints: 99, stats: { maxHitpoints: 100 } }), false);
	assert.equal(has_full_hitpoints({ hitpoints: 100, stats: { maxHitpoints: 101 } }), false);
	assert.equal(has_full_hitpoints({ hitpoints: 100 }), false);
});

test('lowers fortified resistance at every sixth Guild defeat while preserving 33 weak resistance', () => {
	assert.deepEqual([0, 5, 6, 18, 24, 30, 119, 120, 999].map(raid_resistance_from_defeats),
		[95, 95, 94, 92, 91, 90, 76, 75, 75]);
	const groups = new Map();
	const monster = { activeEffects: new Map([
		[{ id: 'multiplayer:Raid_Boss_Fortified' }, { setStats: (name, value) => groups.set(name, value) }],
		[{ id: 'multiplayer:Raid_Boss_Vulnerable' }, { setStats: (name, value) => groups.set(name, value) }]
	]) };
	apply_raid_resistance(monster, 75);
	assert.equal(groups.get('fortification'), 75);
	assert.equal(groups.get('vulnerability'), 42);
	assert.equal(groups.get('fortification') - groups.get('vulnerability'), 33);
});

test('applies reserved resistance when native Raid effects appear during combat', async () => {
	const { combat, controller } = combat_harness();
	const values = new Map();
	combat.enemy.activeEffects = new Map([
		[{ id: 'multiplayer:Raid_Boss_Fortified' }, { setStats: (name, value) => values.set(name, value) }],
		[{ id: 'multiplayer:Raid_Boss_Vulnerable' }, { setStats: (name, value) => values.set(name, value) }]
	]);
	controller.begin(reservation({ fortified_resistance: 98 }));
	combat.selectedMonster = { id: RAID_MONSTER_IDS[1] };
	combat.enemy.emit('effectApplied');
	await Promise.resolve();
	assert.deepEqual([...values.entries()], [['fortification', 98], ['vulnerability', 65]]);
	controller.abandon_loaded_combat();
});

test('exposes the full-health gate through the installed combat integration', () => {
	const { integration } = combat_harness();
	assert.equal(integration.has_full_hitpoints({ hitpoints: 100, stats: { maxHitpoints: 100 } }), true);
	assert.equal(integration.has_full_hitpoints({ hitpoints: 99, stats: { maxHitpoints: 100 } }), false);
});

test('authorizes only the reserved tier during its loaded-session deadline', () => {
	let now = 1_000;
	const controller = new RaidCombatController({
		now: () => now,
		storage: memory_storage(),
		settle: async () => ({ success: true })
	});

	controller.begin(reservation());
	assert.equal(controller.can_enter({ id: RAID_MONSTER_IDS[1] }), true);
	assert.equal(controller.can_enter({ id: RAID_MONSTER_IDS[2] }), false);
	now = 31_000;
	assert.equal(controller.can_enter({ id: RAID_MONSTER_IDS[1] }), false);
	controller.abandon_loaded_combat();
});

test('reuses the active reservation when the same reservation is replayed', () => {
	const controller = new RaidCombatController({
		now: () => 1_000,
		storage: memory_storage(),
		settle: async () => ({ success: true })
	});

	const active = controller.begin(reservation());
	assert.equal(controller.begin({ ...reservation(), tier: 4 }), active);
	controller.abandon_loaded_combat();
});

test('records one immutable terminal result and retries it durably', async () => {
	const storage = memory_storage();
	let succeeds = false;
	const submitted = [];
	const controller = new RaidCombatController({
		now: () => 2_000,
		storage,
		settle: async terminal => {
			submitted.push(terminal);
			return { success: succeeds };
		}
	});

	controller.begin(reservation());
	const terminal = controller.finish('success');
	assert.equal(controller.finish('death'), null);
	assert.deepEqual(storage.get(), terminal);
	assert.equal(await controller.flush(), false);
	assert.deepEqual(storage.get(), terminal);

	succeeds = true;
	assert.equal(await controller.flush(), true);
	assert.equal(storage.get(), null);
	assert.ok(submitted.length >= 2);
});

test('serializes settlement and preserves a newer terminal result', async () => {
	const storage = memory_storage();
	const submitted = [];
	const resolvers = [];
	const controller = new RaidCombatController({
		now: () => 2_000,
		storage,
		settle: terminal => {
			submitted.push(terminal);
			return new Promise(resolve => resolvers.push(resolve));
		}
	});

	controller.begin(reservation());
	controller.finish('success');
	const flush = controller.flush();
	controller.begin(reservation({ assault_id: 'assault-2', settlement_key: 'settlement-2' }));
	const newer = controller.finish('death');
	assert.deepEqual(storage.get(), newer);
	assert.equal(submitted.length, 1);

	resolvers.shift()({ success: true });
	await Promise.resolve();
	assert.deepEqual(storage.get(), newer);
	assert.equal(submitted.length, 2);

	resolvers.shift()({ success: true });
	assert.equal(await flush, true);
	assert.equal(storage.get(), null);
	assert.deepEqual(submitted.map(terminal => terminal.assault_id), ['assault-1', 'assault-2']);
});

test('combat integration retains only the guarded selection patch', () => {
	const { controller, patches } = combat_harness();
	assert.deepEqual([...patches.keys()], ['selectMonster']);
	let normal_entries = 0;
	const original = () => normal_entries++;
	patches.get('selectMonster').replace(original, { id: RAID_MONSTER_IDS[1] }, {});
	assert.equal(normal_entries, 0);
	patches.get('selectMonster').replace(original, { id: 'melvorD:Plant' }, {});
	assert.equal(normal_entries, 1);

	controller.begin(reservation());
	patches.get('selectMonster').replace(original, { id: RAID_MONSTER_IDS[1] }, {});
	assert.equal(normal_entries, 2);
	assert.equal(is_raid_monster({ id: 'melvorD:Plant' }), false);
	controller.abandon_loaded_combat();
});

test('combat events record success and stop the active Assault', () => {
	const { combat, controller, storage } = combat_harness();
	controller.begin(reservation());
	combat.selectedMonster = { id: RAID_MONSTER_IDS[1] };
	combat.emit('monsterKilled', { monster: combat.selectedMonster });
	assert.equal(controller.active, null);
	assert.equal(storage.get().outcome, 'success');
});

test('combat events distinguish player death from a rebirth followed by fleeing', () => {
	const death = combat_harness();
	death.controller.begin(reservation());
	death.combat.selectedMonster = { id: RAID_MONSTER_IDS[1] };
	death.combat.player.emit('hitpointsChanged', { oldCurrent: 10, newCurrent: 0 });
	death.combat.emit('endOfFight');
	assert.equal(death.storage.get().outcome, 'death');

	const rebirth = combat_harness();
	rebirth.controller.begin(reservation());
	rebirth.combat.selectedMonster = { id: RAID_MONSTER_IDS[1] };
	rebirth.combat.player.emit('hitpointsChanged', { oldCurrent: 10, newCurrent: 0 });
	rebirth.combat.player.emit('hitpointsChanged', { oldCurrent: 0, newCurrent: 10 });
	rebirth.combat.emit('endOfFight');
	assert.equal(rebirth.storage.get().outcome, 'flee');
});

test('player death wins when player and Raid Monster die together', () => {
	const simultaneous = combat_harness();
	simultaneous.controller.begin(reservation());
	simultaneous.combat.selectedMonster = { id: RAID_MONSTER_IDS[1] };
	simultaneous.combat.player.emit('hitpointsChanged', { oldCurrent: 10, newCurrent: 0 });
	simultaneous.combat.emit('monsterKilled', { monster: simultaneous.combat.selectedMonster });
	assert.equal(simultaneous.storage.get().outcome, 'death');
});

test('character-load cleanup clears decoded Raid combat without patching deserialization', () => {
	const { combat, integration } = combat_harness();
	combat.selectedMonster = { id: RAID_MONSTER_IDS[2] };
	integration.clear_loaded_combat();
	assert.equal(combat.selectedMonster, undefined);

	combat.selectedMonster = { id: 'melvorD:Plant' };
	integration.clear_loaded_combat();
	assert.deepEqual(combat.selectedMonster, { id: 'melvorD:Plant' });
	assert.equal(is_raid_monster(combat.selectedMonster), false);
	assert.equal(is_raid_monster({ id: RAID_MONSTER_IDS[4] }), true);
});


test('formats every Raid status with registered icons without changing non-Raid attack text', () => {
	const names = { 'melvorD:Fear': 'Fear', 'melvorD:Poison': 'Poison', 'melvorD:DeadlyPoison': 'Deadly Poison',
		'melvorItA:Laceration': 'Laceration', 'melvorItA:EldritchCurse': 'Eldritch Curse' };
	const game = { combatEffects: { getObjectByID: id => names[id]
		? { name: names[id], media: `effect://${id}` } : undefined } };
	const attack = { id: 'multiplayer:Raid_Tier_4_Assault_ItA',
		description: 'Applies Fear, Poison, Deadly Poison, Laceration, and Eldritch Curse.' };
	const formatted = format_raid_attack_description(attack, game);
	assert.equal((formatted.match(/<img /g) ?? []).length, 5);
	for (const name of Object.values(names)) assert.ok(formatted.includes(`>${name}</span>`));
	assert.ok(formatted.includes('effect://melvorD:DeadlyPoison'));
	assert.equal(format_raid_attack_description({ description: '<script>Fear</script>' }, game).includes('<script>'), false);
	let after;
	class AttackSpan {}
	install_raid_attack_description_hook({ patch: (klass, method) => {
		assert.equal(klass, AttackSpan);
		assert.equal(method, 'setAttack');
		return { after: callback => { after = callback; } };
	} }, AttackSpan, game);
	const span = { description: { innerHTML: 'native' } };
	after.call(span, undefined, { attack: { id: 'melvorD:Normal' } });
	assert.equal(span.description.innerHTML, 'native');
	after.call(span, undefined, { attack });
	assert.equal(span.description.innerHTML, formatted);
	assert.equal(format_raid_attack_description({ description: 'Laceration' },
		{ combatEffects: { getObjectByID: () => undefined } }), '<span class="text-danger font-w600">Laceration</span>');
});

test('adds Raid status icons to translated names without English word boundaries', () => {
	const effects = {
		'melvorD:Fear': { name: '恐惧', media: 'fear.png' },
		'melvorD:Poison': { name: '中毒', media: 'poison.png' }
	};
	const result = format_raid_attack_description({ description: '施加：恐惧、中毒。' },
		{ combatEffects: { getObjectByID: id => effects[id] } });
	assert.match(result, /src="fear.png"[^>]*>恐惧/);
	assert.match(result, /src="poison.png"[^>]*>中毒/);
	assert.doesNotMatch(result, /Fear|Poison/);
});
