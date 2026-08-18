import assert from 'node:assert/strict';
import test from 'node:test';
import {
	RaidCombatController,
	RAID_MONSTER_IDS,
	has_full_hitpoints,
	install_raid_combat_hooks,
	is_raid_monster
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
