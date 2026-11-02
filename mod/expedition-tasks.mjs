export function equipment_activity_matches(task, activity) {
	return activity?.type === 'skill' && activity.skill_id === task?.skill_id &&
		(activity.action_id === task.action_id || task.skill_id === 'melvorD:Woodcutting' && task.action_id === 'multiplayer:Any_Woodcutting');
}

export function equipment_tasks(model) {
	return (model?.equipment_projects?.project?.stages ?? []).flat().map(task => ({ ...task,
		source: 'equipment', personal_ms: task.player_ms, evidence: { skill_ids: [task.skill_id] } }));
}
export function eligible_equipment_tasks(model, activities) {
	if (model?.tracking) return [];
	return equipment_tasks(model).filter(task => task.available && task.player_ms < task.target_ms &&
		activities.some(activity => equipment_activity_matches(task, activity)));
}
export function can_track_task(task, activities) {
	if (task?.source === 'equipment') return activities?.some(activity => equipment_activity_matches(task, activity)) ?? false;
	const skill_ids = task?.evidence?.skill_ids;
	return Array.isArray(skill_ids) && Array.isArray(activities) && activities.some(activity =>
		activity.type === 'skill' ? skill_ids.includes(activity.skill_id)
			: activity.type === 'combat' && skill_ids.includes('melvorD:Combat'));
}

export function tracked_skill_ids(expedition_state, activities) {
	const tracking = expedition_state?.tracking;
	if (tracking?.source === 'equipment') {
		const task = equipment_tasks(expedition_state).find(task => task.task_id === tracking.task_id);
		return task && can_track_task(task, activities) ? [task.skill_id] : [];
	}
	const chamber = expedition_state?.expedition?.chamber;
	if (!tracking || tracking.pending_boundary_at || tracking.claim || tracking.visit_id !== chamber?.visit_id)
		return [];
	const task = chamber.tasks?.find(task => task.task_id === tracking.task_id);
	if (!task || task.completed_at != null) return [];
	const accepted = task.evidence?.skill_ids ?? [];
	return [...new Set((activities ?? []).map(activity => activity.type === 'combat' ? 'melvorD:Combat'
		: activity.type === 'skill' ? activity.skill_id : null).filter(id => accepted.includes(id)))];
}

export function task_remaining(task) {
	const remaining_ms = Math.max(0, (task.target_ms ?? 0) - (task.player_ms ?? 0) - (task.system_ms ?? 0));
	if (remaining_ms === 0) return 'Complete';
	const minutes = Math.ceil(remaining_ms / 60_000);
	const hours = Math.floor(minutes / 60);
	const remainder = minutes % 60;
	return `${hours ? `${hours}h` : ''}${hours && remainder ? ' ' : ''}${remainder ? `${remainder}m` : ''} remaining`;
}

export function task_contribution_time(milliseconds) {
	const minutes = Math.round(Math.max(0, Number(milliseconds) || 0) / 60_000);
	if (minutes === 0) return null;
	return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}h`;
}

export function task_available_points_micros(task) {
	if (task.source === 'equipment') return 0;
	const remaining_ms = Math.max(0, (task.target_ms ?? 0) - (task.player_ms ?? 0) - (task.system_ms ?? 0));
	return Math.floor(remaining_ms * 1_000_000 / 3_600_000);
}

export function eligible_prompt_tasks(expedition_state, activities) {
	const personal = eligible_equipment_tasks(expedition_state, activities ?? []);
	const expedition = expedition_state?.expedition;
	const chamber = expedition?.chamber;
	const open = expedition?.status === 'active' || (expedition?.status === 'registration' &&
		chamber?.preparation === true && Date.now() < expedition.registration_ends_at);
	if (!open || !expedition.registered || expedition_state.tracking)
		return personal;
	const discovered = new Set((chamber?.exits ?? []).filter(exit => exit.label !== '???').map(exit => exit.id));
	return [...personal, ...(chamber?.tasks ?? []).filter(task => task.unlocked_at != null && task.completed_at == null &&
		(task.requirement !== 'conditional' || discovered.has(task.exit_id)) && can_track_task(task, activities))];
}

export function best_eligible_task(expedition_state, activities, { equipment_only = false } = {}) {
	return eligible_equipment_tasks(expedition_state, activities ?? [])[0] ?? (equipment_only ? null : eligible_prompt_tasks(expedition_state, activities)
		.filter(task => task_available_points_micros(task) > 0)
		.sort((a, b) => Number(b.requirement === 'required') - Number(a.requirement === 'required') ||
			task_available_points_micros(b) - task_available_points_micros(a))[0] ?? null);
}

export function work_activity_key(activities) {
	return [...new Set((activities ?? []).map(activity => activity.type === 'combat' ? 'combat'
		: activity.type === 'skill' ? `${activity.skill_id}:${activity.action_id ?? ''}` : null).filter(Boolean))].sort().join('|');
}

export function create_work_prompt_gate() {
	let generation = null;
	let activity_key = '';
	let due_at = null;
	return {
		observe({ session, activities, enabled, tracking, automatic = false, now }) {
			const next_key = work_activity_key(activities);
			const new_session = session !== generation;
			if (new_session || next_key !== activity_key) {
				due_at = next_key ? now + (new_session ? 8000 : 2500) : null;
				generation = session;
				activity_key = next_key;
			}
			if (!enabled || tracking) due_at = null;
			else if (automatic && next_key && due_at === null) due_at = now + 2500;
			return due_at !== null && now >= due_at;
		},
		defer(now, delay = 1500) { if (due_at !== null) due_at = now + delay; },
		consume() { due_at = null; },
		reset() { generation = null; activity_key = ''; due_at = null; }
	};
}
