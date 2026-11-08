export const is_food_slot = slot => slot === 'Food' || slot === 'Food2';
// Catalog visibility follows slot access and the completed previous material in the same item family.
export function equipment_project_visible(model, item) {
	if (model?.project?.item_id === item.item_id) return true;
	const cap = item.slot === 'Food' ? model?.caps?.food_cap : model?.caps?.material_caps?.[item.slot];
	if (cap !== undefined && item.tier > cap) return false;
	if (!model || !(model.slots ?? []).some(slot => (item.slot === 'Food' ? is_food_slot(slot.slot) : slot.slot === item.slot) && slot.tier >= item.tier)) return false;
	if (item.tier <= 1 || model.unlocked?.includes(item.item_id) || model.project?.item_id === item.item_id) return true;
	if (item.slot === 'Food') return model.unlocked?.includes(model.catalog?.find(candidate => candidate.slot === 'Food' && candidate.tier === item.tier - 1)?.item_id) === true;
	const family = item.item_id.replace(/^[^:]+:[^_]+_/, '');
	const previous = model.catalog?.find(candidate => candidate.slot === item.slot && candidate.tier === item.tier - 1 &&
		candidate.item_id.replace(/^[^:]+:[^_]+_/, '') === family);
	return !!previous && model.unlocked?.includes(previous.item_id) === true;
}

// Discovery in the native save is independent of Colosseum project access.
export function equipment_project_startable(model, item) {
	return !model?.project && !model?.unlocked?.includes(item.item_id) && equipment_project_visible(model, item);
}

export function equipment_project_stage_name(item, index, skill_name, fallback) {
	const skills = [...new Set((item.stages?.[index] ?? []).map(task => task.skill_id).filter(Boolean))];
	return skills.map(id => skill_name(id) ?? id.split(':').at(-1)).join(' / ') || fallback;
}

export function equipment_slot_purchase(model, slot_id, ep_micros = 0) {
	const access = model?.access?.find(entry => entry.slot === slot_id);
	if (!access) return null;
	const slot = model?.slots?.find(entry => entry.slot === slot_id);
	const next = access.tiers.find(tier => tier.tier === (slot?.tier ?? 0) + 1);
	if (slot && !next) return null;
	const cap = is_food_slot(slot_id) ? model?.caps?.food_cap : model?.caps?.material_caps?.[slot_id];
	if (cap !== undefined && (is_food_slot(slot_id) || slot) && next?.tier > cap) return null;
	if (is_food_slot(slot_id)) return next ? { action: 'unlock-tier', tier: next.tier, cost_micros: next.cost_micros, affordable: ep_micros >= next.cost_micros, eligible: !slot || slot.upgrade_ready === true } : null;
	const cost = slot ? next.cost_micros : access.unlock_cost_micros;
	return { action: slot ? 'unlock-tier' : 'unlock-slot', tier: slot ? next?.tier ?? 0 : 0, cost_micros: cost, affordable: ep_micros >= cost, eligible: !slot || slot.tier === 0 || slot.upgrade_ready === true };
}

// Only completed, permanently unlocked projects belong in Quick Equip; access gates remain separate.
export function equipment_slot_items(model, slot) {
	return (model?.catalog ?? []).filter(item => item.slot === (is_food_slot(slot) ? 'Food' : slot) && model.unlocked?.includes(item.item_id))
		.sort((a, b) => b.tier - a.tier || a.item_id.localeCompare(b.item_id));
}

export function equipment_stat_groups(item, label) {
	const stats = new Map((item?.stats ?? []).map(stat => [stat.key, stat.value]));
	return [
		{ id: 'offence', keys: ['attackSpeed', 'stabAttackBonus', 'slashAttackBonus', 'blockAttackBonus', 'meleeStrengthBonus', 'rangedAttackBonus', 'rangedStrengthBonus', 'magicAttackBonus', 'magicDamageBonus'] },
		{ id: 'defence', keys: ['meleeDefenceBonus', 'rangedDefenceBonus', 'magicDefenceBonus', 'damageReduction'] }
	].map(group => ({ id: group.id, rows: group.keys.filter(key => key !== 'attackSpeed' || stats.has(key)).map(key => {
		const value = stats.get(key) ?? 0;
		return { key, label: label(key), value, text: key === 'attackSpeed' ? `${value / 1000}s` : `${value}${key === 'damageReduction' || key === 'magicDamageBonus' ? '%' : ''}`,
			tone: key === 'attackSpeed' || value === 0 ? '' : value > 0 ? 'text-success' : 'text-danger' };
	}) }));
}

export const pilot_action_keys = [
	'melvorD:Mining|melvorD:Copper_Ore', 'melvorD:Mining|melvorD:Tin_Ore',
	'melvorD:Smithing|melvorD:Bronze_Bar', 'melvorD:Smithing|melvorD:Bronze_Dagger'
];

const valid_action_key = /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+\|[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/;
export function equipment_catalog_action_keys(catalog = []) {
	return [...new Set(catalog.flatMap(project => project.stages ?? []).flatMap(stage => stage.map(task =>
		task.task_id ?? `${task.skill_id}|${task.action_id}`)).filter(key => valid_action_key.test(key)))];
}

// Disk format groups recipes by skill and elides the common native namespace.
// IDs remain self-describing: no catalog indexes that can change across releases.
const short_id = id => id.startsWith('melvorD:') ? id.slice(8) : id;
const full_id = id => id.includes(':') ? id : `melvorD:${id}`;
export function pack_equipment_evidence(value) {
	const groups = Object.create(null);
	for (const [key, ms] of Object.entries(value.time_ms)) {
		const [skill, action] = key.split('|');
		(groups[short_id(skill)] ??= Object.create(null))[short_id(action)] = ms;
	}
	return { v: 1, e: value.epoch, t: groups };
}
export function unpack_equipment_evidence(value) {
	if (value?.v !== 1) return value; // Read the original expanded format during migration.
	const time_ms = {};
	if (!value.t || typeof value.t !== 'object' || Array.isArray(value.t)) return null;
	for (const [skill, actions] of Object.entries(value.t)) {
		if (!actions || typeof actions !== 'object' || Array.isArray(actions)) return null;
		for (const [action, ms] of Object.entries(actions)) time_ms[`${full_id(skill)}|${full_id(action)}`] = ms;
	}
	return { epoch: value.e, time_ms };
}

// Native action-event intervals count actual completed actions, including native offline loops.
// Selected activity and skill-wide statistics alone never increment these counters.
export function create_equipment_evidence({ read, write, scope, is_skill_active, uuid = () => crypto.randomUUID(), now = () => Date.now(), on_error = () => {}, action_id = (_skill, action) => action?.id }) {
	let counters = null, owner = null, last_write = 0, running_game = null, last_error = -Infinity;
	const action_keys = new Set(pilot_action_keys);
	const tracking_keys = new Set(pilot_action_keys);
	const listeners = new Map();
	function load() {
		if (counters && owner === scope()) return;
		owner = scope();
		const saved = unpack_equipment_evidence(read());
		const valid_saved = saved && typeof saved.epoch === 'string' && /^[0-9a-f-]{36}$/.test(saved.epoch) &&
			saved.time_ms && typeof saved.time_ms === 'object' && !Array.isArray(saved.time_ms) &&
			Object.entries(saved.time_ms).every(([key, value]) => valid_action_key.test(key) && Number.isSafeInteger(value) && value >= 0);
		counters = valid_saved
			? { epoch: saved.epoch, time_ms: { ...saved.time_ms } }
			: { epoch: uuid(), time_ms: Object.fromEntries(pilot_action_keys.map(key => [key, 0])) };
		// Restore this instance's project before native offline action events can fire.
		action_keys.clear(); tracking_keys.clear();
		for (const key of Object.keys(counters.time_ms)) { action_keys.add(key); tracking_keys.add(key); }
	}
	function configure(catalog = []) {
		load();
		const keys = equipment_catalog_action_keys(catalog);
		if (keys.length === action_keys.size && keys.every(key => action_keys.has(key)) &&
			Object.keys(counters.time_ms).length === keys.length) return;
		action_keys.clear(); tracking_keys.clear();
		for (const key of keys) {
			action_keys.add(key);
			tracking_keys.add(key);
			if (counters && owner === scope()) counters.time_ms[key] ??= 0;
		}
		if (counters && owner === scope()) {
			counters.time_ms = Object.fromEntries(keys.map(key => [key, counters.time_ms[key] ?? 0]));
			snapshot();
		}
		sync_subscriptions();
	}
	function snapshot(task_id = null) {
		load();
		for (const key of tracking_keys) counters.time_ms[key] ??= 0;
		try {
			write(pack_equipment_evidence(counters)); last_write = now();
		} catch (e) {
			if (now() - last_error >= 30000) { last_error = now(); on_error(e); }
			return null;
		}
		return { epoch: counters.epoch, time_ms: Object.fromEntries((task_id === null ? [...action_keys] : [task_id]).map(key => [key, counters.time_ms[key] ?? 0])) };
	}
	function sync_subscriptions() {
		if (!running_game) return;
		const skill_ids = new Set([...tracking_keys].map(key => key.split('|')[0]));
		const skills = [...running_game.skills?.registeredObjects?.values?.() ?? []];
		for (const skill_id of skill_ids) {
			const skill = running_game.skills?.getObjectByID?.(skill_id) ?? skills.find(candidate => candidate.id === skill_id);
			if (!skill?.on || !skill?.off || listeners.has(skill)) continue;
			const handler = event => {
				load();
				const key = event.skill?.id === 'melvorD:Woodcutting' && event.actions?.size > 0
					? 'melvorD:Woodcutting|multiplayer:Any_Woodcutting' : `${event.skill?.id}|${action_id(event.skill, event.action)}`;
				const food_work = event.skill?.id === 'melvorD:Fishing' || event.skill?.id === 'melvorD:Cooking';
				if (event.skill?.id === 'melvorD:Cooking' && (!is_skill_active(event.skill) ||
					(event.skill.masteryAction && action_id(event.skill, event.skill.masteryAction) !== action_id(event.skill, event.action)))) return;
				if (!tracking_keys.has(key) || (!food_work && event.successful === false) || !Number.isFinite(event.interval) || event.interval <= 0) return;
				const value = counters.time_ms[key] + Math.floor(event.interval);
				if (!Number.isSafeInteger(value)) return;
				counters.time_ms[key] = value;
				// Avoid synchronous storage on every simulated offline action. Capture always flushes.
				if (now() - last_write >= 1000) snapshot();
			};
			skill.on('action', handler);
			listeners.set(skill, () => skill.off('action', handler));
		}
		for (const [skill, remove] of listeners) {
			if (!skill_ids.has(skill.id)) { remove(); listeners.delete(skill); }
		}
	}
	function stop() {
		for (const remove of listeners.values()) remove();
		listeners.clear(); counters = null; owner = null; running_game = null;
		action_keys.clear();
		for (const key of pilot_action_keys) action_keys.add(key);
		tracking_keys.clear();
		for (const key of pilot_action_keys) tracking_keys.add(key);
	}
	function start(game) {
		stop();
		running_game = game;
		load();
		sync_subscriptions();
	}
	return { start, stop, snapshot, configure };
}
