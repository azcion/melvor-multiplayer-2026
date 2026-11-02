export const PRACTICE_CATEGORIES = ['duels', 'groups', 'circuits'];
export const PRACTICE_COPY = {
	categories: 'Practice categories', tiers_cleared: 'tiers cleared', asd: 'Attack, Strength, Defence', bout: 'Bout', duels: 'Duels', groups: 'Groups', circuits: 'Circuits', picker: 'Roster', selected: 'Selected', tier: 'Tier',
	focus: 'Practice focus', opponents: 'Opponents', order: 'Bout order', cleared: 'Cleared', uncleared: 'Not cleared',
	locked: 'Clear Dungeon tiers to unlock the recommended skill caps.', effects: 'Enemy effects', no_effects: 'No status effects.',
	carry: 'Health and eating cooldown carry between bouts. Temporary effects clear. No free healing.',
	rewards: 'Optional training. No EP, loot or progression unlocks.', recommendation: 'Recommended preparation',
	start: 'Start Practice', together: 'Fight together', graduated: 'Tutorial complete · 7 / 7', unavailable: 'Practice catalog unavailable. Refresh to try again.'
};
export function practice_copy(key, get_lang = null) {
	const id = `MOD_MP_COMBAT_PRACTICE_${String(key).toUpperCase()}`;
	const value = get_lang?.(id);
	return !value || value === id ? PRACTICE_COPY[key] ?? key : value;
}
export function practice_entry_name(entry, get_lang = null) {
	const id = entry ? `MOD_MP_COMBAT_PRACTICE_NAME_${String(entry.id).toUpperCase()}` : 'MOD_MP_COMBAT_PRACTICE_GENERIC_NAME';
	const value = get_lang?.(id);
	return !value || value === id ? entry?.name ?? 'Practice' : value;
}
export function practice_entry_focus(entry, get_lang = null) {
	const id = `MOD_MP_COMBAT_PRACTICE_FOCUS_${String(entry?.id ?? '').toUpperCase()}`, value = get_lang?.(id);
	return !value || value === id ? entry?.focus ?? '' : value;
}
export function localize_practice_entry(entry, get_lang = null) {
	if (!entry) return null;
	return { ...entry, name: practice_entry_name(entry, get_lang), focus: practice_entry_focus(entry, get_lang),
		tiers: (entry.tiers ?? []).map(tier => ({ ...tier, waves: (tier.waves ?? []).map(wave => wave.map(actor => ({ ...actor,
			name: practice_actor_name(actor, get_lang),
			effect_info: actor.effect ? (() => { const id = `MOD_MP_COMBAT_PRACTICE_EFFECT_${String(actor.effect).toUpperCase()}`, value = get_lang?.(id); return !value || value === id ? actor.effect_info : value; })() : actor.effect_info
		}))) })) };
}
export function practice_actor_name(actor, get_lang = null) {
	const match = /^human_([a-z]+)_\d+$/.exec(String(actor?.id ?? ''));
	const id = match ? `MOD_MP_COMBAT_PRACTICE_ACTOR_${match[1].toUpperCase()}` : '';
	const value = id ? get_lang?.(id) : '';
	return !value || value === id ? actor?.name ?? '' : value;
}
export function practice_selected(view) { return view.practice?.find(entry => entry.id === view.practice_selection) ?? view.practice?.[0] ?? null; }
export function practice_tier(view) { return practice_selected(view)?.tiers?.find(entry => entry.tier === view.practice_tier) ?? null; }
export function practice_sync(view) {
	if (view.tutorial?.complete !== true || view.mode === 'raid') return;
	const selected = practice_selected(view);
	if (!selected) { view.encounter = ''; return; }
	view.practice_selection = selected.id;
	view.practice_category = selected.category;
	if (!selected.tiers.some(tier => tier.tier === view.practice_tier)) view.practice_tier = 1;
	view.mode = 'once';
	view.encounter = practice_tier(view)?.encounter ?? '';
}
export function practice_choices(view, get_lang = null) {
	return (view.practice ?? []).filter(entry => entry.category === view.practice_category).map(entry => ({
		...entry, name: practice_entry_name(entry, get_lang), id: entry.tiers.find(tier => tier.tier === view.practice_tier)?.encounter ?? '', selection: entry.id,
		actors: [...new Set(entry.tiers[0]?.waves.flat().map(actor => actor.id) ?? [])]
	}));
}
export function practice_select(view, kind, value) {
	if (view.starting || view.pending || view.arena?.status === 'active' || view.tutorial?.complete !== true) return;
	if (kind === 'category' && PRACTICE_CATEGORIES.includes(value)) {
		view.practice_selection = view.practice.find(entry => entry.category === value)?.id;
	} else if (kind === 'encounter' && view.practice.some(entry => entry.id === value)) {
		view.practice_selection = value; view.practice_tab = 'selected';
	} else if (kind === 'tier' && practice_selected(view)?.tiers.some(tier => tier.tier === value)) view.practice_tier = value;
	practice_sync(view);
}
export function practice_actor(view, id, get_lang = null) {
	if (!String(id).startsWith('human_')) return null;
	const actor = (view.practice ?? []).flatMap(entry => entry.tiers[0]?.waves.flat() ?? []).find(actor => actor.id === id) ?? null;
	return actor ? { ...actor, name: practice_actor_name(actor, get_lang) } : null;
}
export function practice_title(view, arena, get_lang = null) {
	const match = /^practice_([a-z]+)_([1-9]\d?)$/.exec(arena?.run?.selection ?? arena?.encounter ?? '');
	const entry = view.practice?.find(item => item.id === match?.[1]);
	return match ? `${practice_entry_name(entry, get_lang)} · ${practice_copy('tier', get_lang)} ${roman(Number(match[2]))}` : null;
}
export function roman(number) { return ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][number - 1] ?? ''; }
