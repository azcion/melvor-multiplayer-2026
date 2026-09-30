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
