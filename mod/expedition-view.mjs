export const EXPEDITION_PREVIEW_LABEL_IDS = Object.freeze({
	"The Rift": "MOD_MP_EXPEDITION_CONTENT_THE_RIFT",
	"Chart The Rift": "MOD_MP_EXPEDITION_CONTENT_CHART_THE_RIFT",
	"Scout The Rift": "MOD_MP_EXPEDITION_CONTENT_SCOUT_THE_RIFT",
	"Build a camp": "MOD_MP_EXPEDITION_CONTENT_BUILD_A_CAMP",
	"Explore the chamber": "MOD_MP_EXPEDITION_CONTENT_EXPLORE_THE_CHAMBER",
	"Scout a passage": "MOD_MP_EXPEDITION_CONTENT_SCOUT_A_PASSAGE",
	"Clear the first passage": "MOD_MP_EXPEDITION_CONTENT_CLEAR_THE_FIRST_PASSAGE",
	"Gather supplies": "MOD_MP_EXPEDITION_CONTENT_GATHER_SUPPLIES",
	"Prismatic Descent": "MOD_MP_EXPEDITION_CONTENT_PRISMATIC_DESCENT",
	"Chart Prismatic Descent": "MOD_MP_EXPEDITION_CONTENT_CHART_PRISMATIC_DESCENT",
	"Scout Prismatic Descent": "MOD_MP_EXPEDITION_CONTENT_SCOUT_PRISMATIC_DESCENT",
	"Construct a hoist": "MOD_MP_EXPEDITION_CONTENT_CONSTRUCT_A_HOIST",
	"Trace the first passage": "MOD_MP_EXPEDITION_CONTENT_TRACE_THE_FIRST_PASSAGE",
	"Attune crystals": "MOD_MP_EXPEDITION_CONTENT_ATTUNE_CRYSTALS",
	"Glassroot Terraces": "MOD_MP_EXPEDITION_CONTENT_GLASSROOT_TERRACES",
	"Chart Glassroot Terraces": "MOD_MP_EXPEDITION_CONTENT_CHART_GLASSROOT_TERRACES",
	"Scout Glassroot Terraces": "MOD_MP_EXPEDITION_CONTENT_SCOUT_GLASSROOT_TERRACES",
	"Clear the path": "MOD_MP_EXPEDITION_CONTENT_CLEAR_THE_PATH",
	"Reveal the third passage": "MOD_MP_EXPEDITION_CONTENT_REVEAL_THE_THIRD_PASSAGE",
	"Clear the third passage": "MOD_MP_EXPEDITION_CONTENT_CLEAR_THE_THIRD_PASSAGE",
	"Study root crystal formations": "MOD_MP_EXPEDITION_CONTENT_STUDY_ROOT_CRYSTAL_FORMATIONS",
	"Buried Observatory": "MOD_MP_EXPEDITION_CONTENT_BURIED_OBSERVATORY",
	"Chart Buried Observatory": "MOD_MP_EXPEDITION_CONTENT_CHART_BURIED_OBSERVATORY",
	"Scout Buried Observatory": "MOD_MP_EXPEDITION_CONTENT_SCOUT_BURIED_OBSERVATORY",
	"Study and align the monument": "MOD_MP_EXPEDITION_CONTENT_STUDY_AND_ALIGN_THE_MONUMENT",
	"Reveal the passage": "MOD_MP_EXPEDITION_CONTENT_REVEAL_THE_PASSAGE",
	"Clear the passage": "MOD_MP_EXPEDITION_CONTENT_CLEAR_THE_PASSAGE",
	"Clear the rubble": "MOD_MP_EXPEDITION_CONTENT_CLEAR_THE_RUBBLE",
	"Prismatic Orrery": "MOD_MP_EXPEDITION_CONTENT_PRISMATIC_ORRERY",
	"Chart Prismatic Orrery": "MOD_MP_EXPEDITION_CONTENT_CHART_PRISMATIC_ORRERY",
	"Scout Prismatic Orrery": "MOD_MP_EXPEDITION_CONTENT_SCOUT_PRISMATIC_ORRERY",
	"Repair the mechanism": "MOD_MP_EXPEDITION_CONTENT_REPAIR_THE_MECHANISM",
	"Locate the third passage": "MOD_MP_EXPEDITION_CONTENT_LOCATE_THE_THIRD_PASSAGE",
	"Prepare the third passage": "MOD_MP_EXPEDITION_CONTENT_PREPARE_THE_THIRD_PASSAGE",
	"Secure the chamber": "MOD_MP_EXPEDITION_CONTENT_SECURE_THE_CHAMBER",
	"Voidwatch Threshold": "MOD_MP_EXPEDITION_CONTENT_VOIDWATCH_THRESHOLD",
	"Chart Voidwatch Threshold": "MOD_MP_EXPEDITION_CONTENT_CHART_VOIDWATCH_THRESHOLD",
	"Scout Voidwatch Threshold": "MOD_MP_EXPEDITION_CONTENT_SCOUT_VOIDWATCH_THRESHOLD",
	"Construct a bridge": "MOD_MP_EXPEDITION_CONTENT_CONSTRUCT_A_BRIDGE",
	"Discover the passage": "MOD_MP_EXPEDITION_CONTENT_DISCOVER_THE_PASSAGE",
	"Prepare the passage": "MOD_MP_EXPEDITION_CONTENT_PREPARE_THE_PASSAGE",
	"Light braziers": "MOD_MP_EXPEDITION_CONTENT_LIGHT_BRAZIERS",
	"Defend the passage": "MOD_MP_EXPEDITION_CONTENT_DEFEND_THE_PASSAGE",
	"The Hollow Star": "MOD_MP_EXPEDITION_CONTENT_THE_HOLLOW_STAR",
	"Chart The Hollow Star": "MOD_MP_EXPEDITION_CONTENT_CHART_THE_HOLLOW_STAR",
	"Scout The Hollow Star": "MOD_MP_EXPEDITION_CONTENT_SCOUT_THE_HOLLOW_STAR",
	"Light up the star": "MOD_MP_EXPEDITION_CONTENT_LIGHT_UP_THE_STAR",
	"Defend the star": "MOD_MP_EXPEDITION_CONTENT_DEFEND_THE_STAR",
	"Complete The Hollow Star": "MOD_MP_EXPEDITION_CONTENT_COMPLETE_THE_HOLLOW_STAR",
	"Vent the gases": "MOD_MP_EXPEDITION_CONTENT_VENT_THE_GASES",
	"Melt the star": "MOD_MP_EXPEDITION_CONTENT_MELT_THE_STAR"
});

export const EXPEDITION_PREVIEW_CHAMBER_IDS = Object.freeze([
	'entrance', 'prismatic_descent', 'glassroot_terraces', 'buried_observatory',
	'prismatic_orrery', 'voidwatch_threshold', 'hollow_star'
]);

export const EXPEDITION_PREVIEW_CHAMBER_LABELS = Object.freeze([
	'The Rift', 'Prismatic Descent', 'Glassroot Terraces', 'Buried Observatory',
	'Prismatic Orrery', 'Voidwatch Threshold', 'The Hollow Star'
]);

const PASSAGE_ORDINALS = ['First', 'Second', 'Third'];
const DEFAULT_PASSAGE_GATEWAYS = ['rocky-cave', 'ruined-stone', 'petrified-roots'];
// Each Chamber's entries follow the exit slot order in expedition-content-v1.json.
const PASSAGE_GATEWAYS = {
	entrance: ['rocky-cave', 'ruined-stone', 'petrified-roots'],
	prismatic_descent: ['petrified-roots', 'ruined-stone', 'rocky-cave'],
	drowned_cloister: ['ruined-stone', 'petrified-roots'],
	rootforge_passage: ['petrified-roots'],
	glassroot_terraces: ['rocky-cave', 'petrified-roots', 'ruined-stone'],
	tideworn_crypts: ['rocky-cave'],
	embervein_machinery: ['rocky-cave', 'ruined-stone'],
	mossbound_reliquary: ['ruined-stone', 'petrified-roots'],
	convergence_gallery: ['rocky-cave', 'ruined-stone', 'petrified-roots'],
	blackwater_nave: ['ruined-stone', 'petrified-roots'],
	ashen_foundry: ['rocky-cave', 'ruined-stone'],
	spore_cathedral: ['petrified-roots', 'rocky-cave'],
	buried_observatory: ['ruined-stone'],
	prismatic_orrery: ['ruined-stone', 'petrified-roots', 'rocky-cave'],
	drowned_basilica: ['ruined-stone'],
	cinder_engine: ['rocky-cave', 'ruined-stone'],
	mycelial_court: ['petrified-roots', 'ruined-stone'],
	gilded_catacombs: ['ruined-stone', 'rocky-cave'],
	starless_sanctum: ['rocky-cave', 'ruined-stone'],
	echoing_dais: ['ruined-stone'],
	everflame_anvil: ['rocky-cave'],
	sunken_bell_chamber: ['ruined-stone'],
	rootcrown_nexus: ['petrified-roots'],
	royal_treasury: ['ruined-stone'],
	voidwatch_threshold: ['rocky-cave']
};

export function passage_gateway(chamber_id, slot) {
	const index = Number.isSafeInteger(slot) && slot > 0 ? slot - 1 : 0;
	return (PASSAGE_GATEWAYS[chamber_id] ?? DEFAULT_PASSAGE_GATEWAYS)[index] ??
		DEFAULT_PASSAGE_GATEWAYS[index % DEFAULT_PASSAGE_GATEWAYS.length];
}

export function passage_name(slot, count) {
	if (count === 1) return 'The Passage';
	return PASSAGE_ORDINALS[slot - 1] ? `${PASSAGE_ORDINALS[slot - 1]} Passage` : `Passage ${slot}`;
}

export function display_expedition_label(label, passage_count = 0, get_lang_string = null, chamber_id = null) {
	const source = String(label ?? '');
	const key = EXPEDITION_PREVIEW_LABEL_IDS[source];
	if (key && get_lang_string && (EXPEDITION_PREVIEW_CHAMBER_LABELS.includes(source) ||
		EXPEDITION_PREVIEW_CHAMBER_IDS.includes(chamber_id))) return get_lang_string(key);
	return source.replace(/\bEntrance\b/g, 'The Rift')
		.replace(/\bexit ([1-3])\b/gi, (_, slot) => passage_name(Number(slot), passage_count));
}

export function visible_tasks(chamber) {
	const discovered = new Set((chamber?.exits ?? [])
		.filter(edge => edge.label !== '???').map(edge => edge.id));
	return (chamber?.tasks ?? []).filter(task => task.unlocked_at != null &&
		(task.requirement !== 'conditional' || discovered.has(task.exit_id)));
}

export function arrival_complete(chamber) {
	const arrival = visible_tasks(chamber).filter(task => task.phase === 'arrival' && task.requirement === 'required');
	return arrival.length > 0 && arrival.every(task => task.completed_at != null);
}

export function sync_phase_state(state, chamber) {
	const visit_id = chamber?.visit_id ?? null;
	if (state.expedition_phase_visit_id === visit_id) return;
	state.expedition_phase_visit_id = visit_id;
	state.expedition_phase_open = { arrival: true, exploration: true, departure: true };
}

export function work_skill_name(game, skill_id) {
	if (skill_id === 'melvorD:Combat') return 'Combat';
	if (skill_id === 'melvorD:AltMagic') return 'Alt. Magic';
	return game.skills?.getObjectByID(skill_id)?.name ?? skill_id;
}

export function work_skill_icon(game, skill_id) {
	if (skill_id === 'melvorD:Combat') return 'assets/media/skills/combat/combat.png';
	if (skill_id === 'melvorD:AltMagic') return game.altMagic?.media ?? 'assets/media/main/question.png';
	return game.skills?.getObjectByID(skill_id)?.media ?? 'assets/media/main/question.png';
}

export function tracked_task_ended(expedition_state) {
	const tracking = expedition_state?.tracking;
	const chamber = expedition_state?.expedition?.chamber;
	if (!tracking || !chamber) return false;
	if (tracking.visit_id !== chamber.visit_id) return true;
	return chamber.tasks?.some(task => task.task_id === tracking.task_id && task.completed_at != null) ?? false;
}

export function phase_tasks(chamber, phase, stage, tracking) {
	if (phase !== 'arrival' && !arrival_complete(chamber)) return [];
	return visible_tasks(chamber).filter(task => task.phase === phase &&
		(!stage || task_stage(task, tracking, chamber?.visit_id) === stage));
}

export function phase_summary(chamber, phase) {
	const tasks = phase_tasks(chamber, phase);
	const done = tasks.filter(task => task.completed_at != null).length;
	return `${done} of ${tasks.length} done`;
}

export function task_stage(task, tracking, visit_id) {
	if (task.completed_at != null) return 'done';
	if ((tracking?.visit_id === visit_id && tracking?.task_id === task.task_id) ||
		task.trackers?.length || (task.player_ms ?? 0) + (task.system_ms ?? 0) > 0)
		return 'active';
	return 'pending';
}

export function tracking_task_title(chamber, tracking, get_lang_string = null) {
	const task = chamber?.tasks?.find(item => item.task_id === tracking?.task_id);
	return task ? display_expedition_label(task.title, chamber.exits?.length, get_lang_string, chamber.id) :
		get_lang_string?.('MOD_MP_EXPEDITION_UI_CHAMBER_WORK') ?? 'Chamber work';
}
