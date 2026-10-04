export function can_track_task(task, activities) {
	const skill_ids = task?.evidence?.skill_ids;
	return Array.isArray(skill_ids) && Array.isArray(activities) && activities.some(activity =>
		activity.type === 'skill' ? skill_ids.includes(activity.skill_id)
			: activity.type === 'combat' && skill_ids.includes('melvorD:Combat'));
}

export function tracked_skill_ids(expedition_state, activities) {
	const tracking = expedition_state?.tracking;
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
	const remaining_ms = Math.max(0, (task.target_ms ?? 0) - (task.player_ms ?? 0) - (task.system_ms ?? 0));
	return Math.floor(remaining_ms * 1_000_000 / 3_600_000);
}

export function eligible_prompt_tasks(expedition_state, activities) {
	const expedition = expedition_state?.expedition;
	if (expedition?.status !== 'active' || !expedition.registered || expedition_state.tracking)
		return [];
	const chamber = expedition.chamber;
	const discovered = new Set((chamber?.exits ?? []).filter(exit => exit.label !== '???').map(exit => exit.id));
	return (chamber?.tasks ?? []).filter(task => task.unlocked_at != null && task.completed_at == null &&
		(task.requirement !== 'conditional' || discovered.has(task.exit_id)) && can_track_task(task, activities));
}

export function work_activity_key(activities) {
	return [...new Set((activities ?? []).map(activity => activity.type === 'combat' ? 'combat'
		: activity.type === 'skill' ? activity.skill_id : null).filter(Boolean))].sort().join('|');
}

export function create_work_prompt_gate() {
	let generation = null;
	let activity_key = '';
	let due_at = null;
	return {
		observe({ session, activities, enabled, tracking, now }) {
			const next_key = work_activity_key(activities);
			const new_session = session !== generation;
			if (new_session || next_key !== activity_key) {
				due_at = next_key ? now + (new_session ? 8000 : 2500) : null;
				generation = session;
				activity_key = next_key;
			}
			if (!enabled || tracking) due_at = null;
			return due_at !== null && now >= due_at;
		},
		defer(now) { if (due_at !== null) due_at = now + 1500; },
		consume() { due_at = null; },
		reset() { generation = null; activity_key = ''; due_at = null; }
	};
}
