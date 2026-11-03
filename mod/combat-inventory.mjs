export const available_combat_skills = ['attack', 'strength', 'defence', 'hitpoints'];
export function combat_level_quote(character, skill, quantity) {
	const start = character?.levels?.[skill] ?? 1;
	const count = Math.max(0, Math.min((character?.caps?.[skill] ?? 99) - start, Math.trunc(Number(quantity)) || 0));
	let cost = 0;
	for (let level = start + 1; level <= start + count; level++) cost += (Math.floor(level / 10) + 1) * 1000000;
	return { count, target: start + count, cost };
}

export function combat_levels_quote(character, quantities) {
	const upgrades = {};
	let count = 0, cost = 0;
	for (const skill of available_combat_skills) {
		const quote = combat_level_quote(character, skill, quantities[skill]);
		if (quote.count) upgrades[skill] = quote.count;
		count += quote.count; cost += quote.cost;
	}
	return { upgrades, count, cost };
}

export function combat_food_choices(foods, item_name = food => food) {
	return foods.map(food => ({ ...food, name: item_name(food.id) })).sort((a,b) => b.heal - a.heal || a.name.localeCompare(b.name));
}

export function create_combat_inventory({ view, scope, request, reconcile, can_mutate,
	access = () => true, practice_sync = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
	let loading = null, epoch = 0, settlement = null, practice_cache = null;
	const current_scope = () => `${scope()}:${epoch}`;
	async function refresh({ fresh = false } = {}) {
		const current = current_scope();
		if (loading) {
			if (!fresh) return loading;
			// A read begun before settlement may still contain the pre-fight history.
			await loading;
			if (current !== current_scope()) return false;
			if (loading) return loading;
		}
		const work = (async () => {
			try {
				const known = practice_cache?.scope === current ? practice_cache : null;
				const params = new URLSearchParams({ recovery: '1' });
				if (view.raid_page) params.set('raid_page', view.raid_page);
				if (known) params.set('practice_catalog', known.revision);
				const result = await request('/api/combat/inventory' + (params.size ? '?' + params : ''));
				if (current !== current_scope()) return false;
				if (!Array.isArray(result?.foods)) { view.inventory_error = 'rejected'; return false; }
				let practice = Array.isArray(result.practice) ? result.practice : [];
				const revision = result.practice_catalog_revision;
				if (practice.length && typeof revision === 'string') {
					const waves = {};
					practice = practice.map(entry => ({ ...entry, tiers: entry.tiers.map(tier => {
						const full = Array.isArray(tier.waves) ? tier.waves : known?.revision === revision ? known.waves[tier.encounter] : null;
						if (!Array.isArray(full)) throw new Error('Missing Practice definitions');
						// Cache plain definitions separately from reactive view objects.
						waves[tier.encounter] = full;
						return { ...tier, waves: structuredClone(full) };
					}) }));
					practice_cache = { scope: current, revision, waves };
				}
				view.recovery = result.recovery ?? null; view.maintenance = result.combat_maintenance ?? null;
				view.foods = result.foods; view.food_id = result.food_id;
				if (view.character?.revision !== result.character?.revision) {
					const pending = {};
					if (view.character && result.character) for (const skill of available_combat_skills) {
						const quote = combat_level_quote(view.character, skill, view.level_quantities[skill]);
						if (quote.count) pending[skill] = combat_level_quote(result.character, skill, quote.target - (result.character.levels?.[skill] ?? 1)).count;
					}
					view.level_quantities = pending;
					view.equipment_reset_confirm = false; view.consumables_reset_confirm = false;
				}
				view.equipment_projects = result.equipment_projects;
				view.character = result.character; view.ep_micros = result.ep_micros;
				view.history = result.history; view.dungeons = result.dungeons ?? []; view.raid = result.raid ?? null; view.unlocks = result.unlocks ?? null;
				view.practice = practice;
				view.tutorial = result.tutorial ?? null;
				if (view.tutorial && !view.tutorial.complete) { view.mode = 'once'; view.encounter = view.tutorial.trial.id; }
				else if (view.encounter?.startsWith('tutorial_')) { view.mode = 'once'; view.encounter = ''; }
				practice_sync(view);
				if (!access(view, 'page', view.page_tab)) view.page_tab = view.arena?.status === 'active' ? 'test_combat' : 'character';
				if (!access(view, 'tab', view.preparation_tab)) view.preparation_tab = 'levels';
				view.debug_enabled = result.debug_enabled === true;
				view.tutorial_debug_targets = result.tutorial_debug_targets ?? [];
				view.dungeon_debug_options = result.dungeon_debug_options ?? null; view.test_profile = result.test_profile === true;
				view.inventory_error = '';
				return true;
			} catch { if (current === current_scope()) view.inventory_error = 'rejected'; return false; }
			finally { if (current === current_scope()) loading = null; }
		})();
		loading = work;
		return loading;
	}
	function settle(arena) {
		if (!arena || arena.status === 'active') return;
		const current = current_scope();
		if (settlement?.id === arena.id && settlement.scope === current) return settlement.work;
		const entry = { id: arena.id, scope: current, work: null };
		settlement = entry;
		entry.work = (async () => {
			// Retry transient failures without turning socket snapshots into HTTP polling.
			for (let attempt = 0; attempt < 3; attempt++) {
				if (attempt) await wait(attempt * 500);
				if (current !== current_scope() || settlement !== entry) return false;
				if (await refresh({ fresh: true })) return true;
			}
			return false;
		})();
		return entry.work;
	}
	async function submit(action, payload) {
		if (view.inventory_busy || !can_mutate() || view.arena?.status === 'active') return false;
		const current = current_scope(); view.inventory_busy = true; view.inventory_error = '';
		try {
			const result = await request(`/api/combat/${action}`,{ ...payload, command_id: crypto.randomUUID() });
			if (current !== current_scope()) return false;
			const reconciled = result?.success === true && await reconcile([result.receipt]);
			if (current !== current_scope()) return false;
			if (!reconciled) {
				await refresh();
				if (current === current_scope()) view.inventory_error = result?.error ?? 'rejected';
				return false;
			}
			await refresh(); return current === current_scope();
		} catch { if (current === current_scope()) view.inventory_error = 'rejected'; return false; }
		finally { if (current === current_scope()) view.inventory_busy = false; }
	}
	return {
		refresh, settle,
		async raid_page(page) {
			if (view.raid_loading || !Number.isSafeInteger(page) || page < 0) return false;
			const current = current_scope(); view.raid_loading = true; view.raid_page = page;
			try { return await refresh({ fresh: true }); }
			finally { if (current === current_scope()) view.raid_loading = false; }
		},
		equipment: (action, payload = {}) => submit(action, { ...payload, revision: view.character?.revision }),
		debug_dungeon: payload => view.dungeon_debug_options ? submit('debug-dungeon', { ...payload, revision: view.character?.revision ?? null }) : Promise.resolve(false),
		debug_tutorial: payload => view.tutorial_debug_targets?.some(target => target.id === payload.target) ? submit('debug-tutorial', { ...payload, revision: view.character?.revision ?? null }) : Promise.resolve(false),
		debug_equipment: payload => view.debug_enabled ? submit('debug-project', payload) : Promise.resolve(false),
		prepare: () => submit('prepare', {}),
		async level(skill) {
			if (skill !== undefined && !available_combat_skills.includes(skill)) return false;
			const quote = combat_levels_quote(view.character, skill === undefined ? view.level_quantities : { [skill]: view.level_quantities[skill] });
			if (!view.character || !quote.count || quote.cost > view.ep_micros) return false;
			return submit('level', { upgrades: quote.upgrades, revision: view.character.revision });
		},
		async reset_equipment(group = 'equipment') {
			if (!['equipment', 'consumables'].includes(group)) return false;
			const confirmation = group + '_reset_confirm';
			if (!view[confirmation] || !view.equipment_projects?.resets?.[group]?.invested_micros) return false;
			const result = await submit('reset-equipment', { revision: view.character?.revision, group });
			if (result) view[confirmation] = false;
			return result;
		},
		async reset_levels() {
			const result = await submit('reset-levels', { revision: view.character?.revision });
			if (result) { view.reset_confirm = false; view.level_quantities = {}; }
			return result;
		},
		reset() { view.recovery = null; view.maintenance = null; view.recovery_notice = ''; view.recovery_supported = false; view.dungeon_debug_options = null; view.dungeon_debug_confirm = false; view.test_profile = false; epoch++; loading = null; settlement = null; practice_cache = null; view.foods = []; view.food_id = ''; view.level_quantities = {}; view.reset_confirm = false; view.equipment_reset_confirm = false; view.consumables_reset_confirm = false; view.equipment_set = 'melee'; view.preparation_tab = 'levels'; view.raid_page = 0; view.raid_loading = false; view.dungeons = []; view.raid = null; view.unlocks = null; view.tutorial = null; view.character = null; view.equipment_projects = null; view.ep_micros = 0; view.history = []; view.inventory_busy = false; view.debug_enabled = false; view.tutorial_debug_targets = []; view.tutorial_debug_confirm = false; view.tutorial_debug_target = 'start'; }
	};
}
