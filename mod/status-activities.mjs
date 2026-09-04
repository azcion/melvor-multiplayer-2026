export const MAX_STATUS_ACTIVITY_COUNT = 16;

function get_registered_game_objects(collection) {
	return [...collection?.registeredObjects ?? []]
		.map(entry => Array.isArray(entry) ? entry[1] : entry)
		.filter(Boolean);
}

function get_game_object_id(value) {
	return typeof value === 'string' ? value : value?.id ?? value?.localID ?? null;
}

function get_first_game_object(value) {
	if (value instanceof Set || Array.isArray(value))
		return value.values().next().value ?? null;
	return value ?? null;
}

function is_status_id(id) {
	return typeof id === 'string' && /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(id);
}

function is_status_action_id(id) {
	return typeof id === 'string' && /^[A-Za-z0-9_.:-]+$/.test(id);
}

function capture_skill_action_id(skill) {
	let action_id = null;
	try {
		action_id = get_game_object_id(skill.masteryAction);
	} catch (e) {
		// Some skills throw while their current selection is incomplete.
	}
	if (is_status_action_id(action_id))
		return action_id;

	for (const property of [
		'activeTree', 'activeTrees', 'activeRecipe', 'activeFish', 'currentNPC',
		'selectedRock', 'selectedRecipe', 'studiedConstellation', 'activeObstacle', 'activeMap'
	]) {
		let action = null;
		try {
			action = get_first_game_object(skill[property]);
		} catch (e) {
			// Some skills throw while their current selection is incomplete.
		}
		action_id = get_game_object_id(action);
		if (is_status_action_id(action_id))
			return action_id;
	}
	return null;
}

function capture_skill_status_activity(skill) {
	if (skill?.isActive !== true)
		return null;
	const skill_id = get_game_object_id(skill);
	const action_id = capture_skill_action_id(skill);
	if (!is_status_id(skill_id) || !is_status_action_id(action_id))
		return null;
	return { type: 'skill', skill_id, action_id };
}

function combat_is_active(combat) {
	return combat?.isActive === true || combat?.isInCombat === true || combat?.player?.isInCombat === true;
}

function capture_combat_status_activity(combat, assume_active = false) {
	if (!assume_active && !combat_is_active(combat))
		return null;
	const area_id = get_game_object_id(combat?.selectedArea ?? combat?.combatArea ?? combat?.area ?? combat?.player?.combatArea);
	return is_status_id(area_id) ? { type: 'combat', area_id } : { type: 'combat', area_id: null };
}

export function status_activity_key(activity) {
	if (activity?.type === 'skill' && is_status_id(activity.skill_id) && is_status_action_id(activity.action_id))
		return `skill:${activity.skill_id}:${activity.action_id}`;
	if (activity?.type === 'combat' && (activity.area_id === null || is_status_id(activity.area_id)))
		return `combat:${activity.area_id ?? ''}`;
	return null;
}

export function normalize_status_activities(activities, maximum = MAX_STATUS_ACTIVITY_COUNT) {
	if (!Array.isArray(activities) || !Number.isSafeInteger(maximum) || maximum < 1)
		return [];

	const normalized = [];
	const seen = new Set();
	for (const activity of activities) {
		const key = status_activity_key(activity);
		if (key === null || seen.has(key))
			continue;
		seen.add(key);
		normalized.push(activity.type === 'skill'
			? { type: 'skill', skill_id: activity.skill_id, action_id: activity.action_id }
			: { type: 'combat', area_id: activity.area_id });
		if (normalized.length === maximum)
			break;
	}
	return normalized;
}

export function status_activity_sync_signature(activity) {
	if (activity?.type === 'skill')
		return JSON.stringify({ type: 'skill', skill_id: activity.skill_id });
	return JSON.stringify(activity);
}

export function status_activities_sync_signature(activities) {
	return JSON.stringify(activities.map(activity => activity?.type === 'skill'
		? { type: 'skill', skill_id: activity.skill_id }
		: activity));
}

export function capture_status_activities(game) {
	const activities = get_registered_game_objects(game?.skills)
		.map(capture_skill_status_activity)
		.filter(activity => activity !== null);
	const active_action = game?.activeAction;
	const is_alt_magic = active_action === game?.altMagic;
	const active_action_is_combat = !is_alt_magic && active_action !== null && active_action !== undefined &&
		(active_action === game?.combat || active_action?.isCombat === true);
	const combat = capture_combat_status_activity(
		active_action_is_combat ? active_action : game?.combat,
		active_action_is_combat
	);
	if (combat !== null)
		activities.push(combat);
	return normalize_status_activities(activities);
}

export function capture_primary_status_activity(game, activities = capture_status_activities(game)) {
	const active_action = game?.activeAction;
	const is_alt_magic = active_action === game?.altMagic;
	const activity = !is_alt_magic && (active_action === game?.combat || active_action?.isCombat === true)
		? capture_combat_status_activity(active_action, true)
		: capture_skill_status_activity(active_action);
	const key = status_activity_key(activity);
	return key !== null && activities.some(candidate => status_activity_key(candidate) === key)
		? activity
		: { type: 'idle' };
}
