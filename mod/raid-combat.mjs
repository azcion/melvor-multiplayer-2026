export const RAID_AREA_ID = 'multiplayer:Guild_Raid';
export const RAID_MONSTER_IDS = Object.freeze({
	1: 'multiplayer:Raid_Tier_1',
	2: 'multiplayer:Raid_Tier_2',
	3: 'multiplayer:Raid_Tier_3',
	4: 'multiplayer:Raid_Tier_4'
});

const TERMINAL_OUTCOMES = new Set(['success', 'death', 'flee', 'abandoned']);

function monster_id(value) {
	return value?.id ?? value?.localID ?? null;
}

export function is_raid_monster(value) {
	return Object.values(RAID_MONSTER_IDS).includes(monster_id(value));
}

export function has_full_hitpoints(player) {
	const current = player?.hitpoints;
	const maximum = player?.stats?.maxHitpoints;
	return Number.isFinite(current) && Number.isFinite(maximum) && current === maximum;
}

export class RaidCombatController {
	constructor({ now = Date.now, storage, settle, on_terminal = () => {} }) {
		this.now = now;
		this.storage = storage;
		this.settle = settle;
		this.on_terminal = on_terminal;
		this.active = null;
		this.expiry_timer = null;
	}

	begin(reservation) {
		if (this.active !== null) {
			if (this.active.assault_id === reservation?.assault_id &&
				this.active.settlement_key === reservation?.settlement_key)
				return this.active;
			throw new Error('A Raid Assault is already active.');
		}
		if (!Number.isSafeInteger(reservation?.tier) || RAID_MONSTER_IDS[reservation.tier] === undefined)
			throw new Error('Invalid Raid Assault tier.');
		if (typeof reservation?.assault_id !== 'string' || reservation.assault_id.length === 0)
			throw new Error('Invalid Raid Assault identifier.');
		if (!Number.isSafeInteger(reservation?.combat_deadline) || reservation.combat_deadline <= this.now())
			throw new Error('Raid Assault reservation has expired.');

		this.active = { ...reservation, monster_id: RAID_MONSTER_IDS[reservation.tier] };
		this.schedule_expiry();
		return this.active;
	}

	can_enter(monster) {
		return this.active !== null && monster_id(monster) === this.active.monster_id && this.now() < this.active.combat_deadline;
	}

	schedule_expiry() {
		this.clear_expiry();
		const delay = Math.max(0, this.active.combat_deadline - this.now());
		this.expiry_timer = setTimeout(() => this.finish('abandoned'), delay);
	}

	clear_expiry() {
		if (this.expiry_timer !== null)
			clearTimeout(this.expiry_timer);
		this.expiry_timer = null;
	}

	finish(outcome) {
		if (!TERMINAL_OUTCOMES.has(outcome))
			throw new Error('Invalid Raid Assault outcome.');
		if (this.active === null)
			return null;

		const terminal = {
			assault_id: this.active.assault_id,
			settlement_key: this.active.settlement_key,
			outcome,
			occurred_at: this.now()
		};
		this.clear_expiry();
		this.active = null;
		this.storage.set(terminal);
		this.on_terminal(terminal);
		void this.flush();
		return terminal;
	}

	abandon_loaded_combat() {
		return this.finish('abandoned');
	}

	has_active() {
		return this.active !== null;
	}

	async flush() {
		const terminal = this.storage.get();
		if (terminal === null)
			return true;

		try {
			const result = await this.settle(terminal);
			if (result?.success !== true)
				return false;
			this.storage.remove();
			return true;
		} catch {
			return false;
		}
	}
}

export function install_raid_combat_hooks(ctx, controller, combat_manager_class, game) {
	let lethal_hit = false;

	ctx.patch(combat_manager_class, 'selectMonster').replace(function(original, monster, area) {
		if (!is_raid_monster(monster))
			return original(monster, area);
		if (!controller.can_enter(monster))
			return;
		return original(monster, area);
	});

	game.combat.on('monsterKilled', event => {
		if (controller.active === null || monster_id(event.monster) !== controller.active.monster_id)
			return;
		if (lethal_hit) {
			controller.finish('death');
			lethal_hit = false;
			return;
		}
		lethal_hit = false;
		controller.finish(controller.now() <= controller.active.combat_deadline ? 'success' : 'abandoned');
	});

	game.combat.player.on('hitpointsChanged', event => {
		if (controller.active === null)
			return;
		if (event.newCurrent <= 0)
			lethal_hit = true;
		else if (event.oldCurrent <= 0)
			lethal_hit = false;
	});

	game.combat.on('endOfFight', () => {
		if (controller.active === null || !is_raid_monster(game.combat.selectedMonster))
			return;
		controller.finish(lethal_hit ? 'death' : 'flee');
		lethal_hit = false;
	});

	const abandon = () => {
		if (controller.active !== null)
			controller.abandon_loaded_combat();
	};
	globalThis.addEventListener?.('beforeunload', abandon);

	return {
		has_full_hitpoints: player => has_full_hitpoints(player),
		start(reservation) {
			lethal_hit = false;
			const active = controller.begin(reservation);
			const monster = game.monsters.getObjectByID(active.monster_id);
			const area = game.combatAreas.getObjectByID(RAID_AREA_ID);
			if (monster === undefined || area === undefined) {
				controller.finish('abandoned');
				throw new Error('Raid combat content is unavailable.');
			}
			game.combat.selectMonster(monster, area);
			changePage(game.pages.getObjectByID('melvorD:Combat'));
		},
		flush: () => controller.flush(),
		has_active: () => controller.has_active(),
		clear_loaded_combat() {
			if (is_raid_monster(game.combat.selectedMonster))
				game.combat.resetActionState();
		},
		abandon
	};
}
