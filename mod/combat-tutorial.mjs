export const tutorial_names = ['Training Partner', 'Sparring Partner', 'Armoured Squire', 'Practice Partner', 'Endurance Bout', 'Heavy Hitter', 'Final Assessment'];
export const tutorial_prepare_text = "Let's get started! Create your fighter below.";
function tutorial_text(get_lang, key, fallback, ...values) {
	const id = `MOD_MP_COMBAT_TUTORIAL_${key}`, translated = get_lang?.(id);
	const template = !translated || translated === id ? fallback : translated;
	const args = values[0] && typeof values[0] === 'object' ? values[0] : {};
	return template.replace(/\{([a-z_]+)\}/gi, (_, name) => String(args[name] ?? `{${name}}`));
}
function tutorial_value(get_lang, key, fallback) {
	const id = `MOD_MP_COMBAT_TUTORIAL_${key}`, value = get_lang?.(id);
	return !value || value === id ? fallback : value;
}
export function tutorial_name(id, get_lang = null) {
	const match = /^tutorial_([1-7])(?:_[12])?$/.exec(String(id));
	return match ? tutorial_text(get_lang, `NAME_${match[1]}`, tutorial_names[Number(match[1]) - 1]) : null;
}
export function tutorial_guide(tutorial, model, get_lang = null, get_item_name = null, get_slot_name = null) {
	if (!tutorial || tutorial.complete || !tutorial.trial) return null;
	const trial = tutorial.trial;
	const slot = model?.slots?.find(slot => slot.slot === trial.slot);
	const unlocked = model?.unlocked?.includes(trial.item);
	let action = !slot ? trial.slot === 'Food' ? 'unlock-tier' : 'unlock-slot' : slot.tier < trial.tier ? 'unlock-tier' :
		!unlocked ? model?.project?.item_id === trial.item ? 'work' : model?.project ? 'finish-project' : 'start-project' : slot.equipped_item !== trial.item ? 'equip' : 'battle';
	if (action === 'battle' && !tutorial.ready) action = tutorial.next === 'restore-loadout' ? 'restore-loadout' : 'battle';
	const label = trial.slot;
	const name = get_item_name?.(trial.item) ?? trial.item.split(':')[1].replaceAll('_', ' ');
	const path = trial.slot === 'Food' ? `${tutorial_value(get_lang, 'CONSUMABLES', 'Consumables')} → ${tutorial_value(get_lang, 'FOOD', 'Food')}` : `${tutorial_value(get_lang, 'EQUIPMENT', 'Equipment')} → ${get_slot_name?.(trial.slot) ?? label}`;
	const instructions = {
		'unlock-slot': tutorial_text(get_lang, 'UNLOCK_SLOT', 'Open {path} and unlock the slot.{bonus}', { path, bonus: trial.tier === 0 ? ` ${tutorial_text(get_lang, 'UNLOCK_SLOT_BONUS', 'Your {item} comes with it!', { item: name })}` : '' }),
		'unlock-tier': tutorial_text(get_lang, 'UNLOCK_TIER', 'Open {path} and upgrade to {tier}.', { path, tier: trial.slot === 'Food' ? tutorial_value(get_lang, 'SHRIMP', 'Shrimp') : trial.tier === 2 ? tutorial_value(get_lang, 'IRON', 'Iron') : tutorial_value(get_lang, 'BRONZE', 'Bronze') }),
		'start-project': tutorial_text(get_lang, 'START_PROJECT', "Let's make your {item}! Open Projects in Expedition.", { item: name }),
		'work': tutorial_text(get_lang, 'WORK', 'Follow your project tasks. Progress tracks automatically while you play.'),
		'finish-project': tutorial_text(get_lang, 'FINISH_PROJECT', 'Finish or cancel your current project to make room for this one.'),
		'equip': tutorial_text(get_lang, 'EQUIP', 'Open {path} and equip your {item}.', { path, item: name }),
		'restore-loadout': tutorial_text(get_lang, 'RESTORE_LOADOUT', 'Put your training gear back on and remove any extra equipment.'),
		'battle': tutorial_text(get_lang, 'BATTLE', "You're ready! Win your battle against {opponent}.", { opponent: tutorial_name(trial.id, get_lang) ?? trial.name })
	};
	return { trial, action, text: instructions[action], tab: trial.slot === 'Food' ? 'consumables' : 'equipment' };
}

export const tutorial_lessons = [
	'Watch the attack bars. Your partner won’t attack yet.',
	'This one hits back! Try a different melee stance.',
	'Armour makes this opponent harder to hit. Try your stances.',
	'Check your defence to see how your helmet helps.',
	'Getting low on HP? Try eating. It heals you and restarts your attack.',
	'Watch out for slow, heavy hits. Try the defensive stance.',
	'Two bouts to go! Keep an eye on your HP and use your food.'
];
export function tutorial_lesson(index, get_lang = null) {
	return tutorial_text(get_lang, `LESSON_${index + 1}`, tutorial_lessons[index] ?? '');
}

const tutorial_steps = [
	['Weapon', 0, 'multiplayer:Wooden_Sword'], ['Shield', 0, 'multiplayer:Wooden_Shield'],
	['Weapon', 1, 'melvorD:Bronze_Sword'], ['Helmet', 1, 'melvorD:Bronze_Helmet'],
	['Food', 1, 'melvorD:Shrimp'], ['Shield', 1, 'melvorD:Bronze_Shield'], ['Shield', 2, 'melvorD:Iron_Shield']
];

// Review the same copy as gameplay, without replacing the live fighter or sending mutations.
export function tutorial_review_steps(get_lang = null, get_item_name = null, get_slot_name = null) {
	const steps = [{ title: tutorial_text(get_lang, 'REVIEW_START', 'Start · Create fighter'), text: tutorial_text(get_lang, 'PREPARE', tutorial_prepare_text) }];
	for (const [victories, [slot, tier, item]] of tutorial_steps.entries()) {
		const trial = { id: `tutorial_${victories + 1}`, slot, tier, item, name: tutorial_name(`tutorial_${victories + 1}`, get_lang) };
		const tutorial = { complete: false, victories, trial, ready: false };
		const access = { slot, tier, equipped_item: null };
		const add = (label, key, model, extra = {}) => steps.push({ title: `${victories + 1} · ${trial.name} · ${tutorial_text(get_lang, `REVIEW_${key.toUpperCase()}`, label)}`, text: tutorial_guide({ ...tutorial, ...extra }, model, get_lang, get_item_name, get_slot_name).text });
		if (slot !== 'Food') add('Unlock slot', 'unlock_slot', { slots: [] });
		if (tier > 0) {
			add('Upgrade', 'upgrade', { slots: [{ ...access, tier: tier - 1 }] });
			add('Start project', 'start_project', { slots: [access] });
			add('Finish another project', 'finish_project', { slots: [access], project: { item_id: 'other' } });
			add('Project tasks', 'project_tasks', { slots: [access], project: { item_id: item } });
		}
		add('Equip', 'equip', { slots: [access], unlocked: [item] });
		const equipped = { slots: [{ ...access, equipped_item: item }], unlocked: [item] };
		add('Restore equipment', 'restore_equipment', equipped, { next: 'restore-loadout' });
		add('Ready', 'ready', equipped, { ready: true });
		steps.push({ title: `${victories + 1} · ${trial.name} · ${tutorial_text(get_lang, 'REVIEW_BATTLE', 'Battle')}`, text: tutorial_lesson(victories, get_lang) });
	}
	return steps;
}

export function install_tutorial_review_actions(state, get_lang = null, get_item_name = null, get_slot_name = null) {
	state.combat_tutorial_review_index = 0;
	state.combat_tutorial_review_steps = () => state.chat_is_admin ? tutorial_review_steps(get_lang, get_item_name, get_slot_name) : [];
	state.combat_tutorial_review_current = () => state.chat_is_admin ? tutorial_review_steps(get_lang, get_item_name, get_slot_name)[state.combat_tutorial_review_index] : null;
	state.combat_tutorial_review_select = value => {
		const index = Number(value);
		if (state.chat_is_admin && Number.isInteger(index) && index >= 0 && index < tutorial_review_steps(get_lang, get_item_name, get_slot_name).length) state.combat_tutorial_review_index = index;
	};
	state.combat_tutorial_review_move = offset => {
		if (Number.isInteger(offset)) state.combat_tutorial_review_select(Math.max(0, Math.min(tutorial_review_steps(get_lang, get_item_name, get_slot_name).length - 1, state.combat_tutorial_review_index + offset)));
	};
}
export function tutorial_access(view, kind, id) {
	if (kind === 'page') {
		if (view.arena?.status !== 'active' && id === 'character') return true;
		if (view.arena?.status === 'active' && view.combat_tab) return id === view.combat_tab;
		if (id === 'raid') return !!view.character && view.tutorial?.complete === true;
		return false;
	}
	if (kind === 'tab' && id === 'levels') return true;
	if (!view.character || !view.tutorial) return false;
	if (view.tutorial.complete) return true;
	const steps = tutorial_steps.slice(0, view.tutorial.victories + 1);
	if (kind === 'tab') return id === 'equipment' || (id === 'consumables' && steps.some(([slot]) => slot === 'Food'));
	if (kind === 'slot') return steps.some(([slot]) => slot === id);
	if (kind === 'project') return id === view.tutorial.trial?.item;
	if (kind === 'item') return steps.some(([, , item]) => item === id);
	if (kind === 'purchase') return id === view.tutorial.trial?.slot && ['unlock-slot', 'unlock-tier'].includes(view.tutorial.next);
	return false;
}

export function equipment_set_available(view, type, admin) {
	return type === 'melee' || (type === 'ranged' && admin === true && view.tutorial?.complete === true);
}

// Base-game Thieving targets keep portraits available without optional expansions.
const tutorial_portraits = ['MAN', 'WOMAN', 'SQUIRE', 'BANDIT_THUG', 'CHEF', 'MARAUDER', 'KNIGHT'];
export function tutorial_portrait(id, targets) {
	const match = /^tutorial_([1-7])(?:_[12])?$/.exec(String(id));
	return match ? targets?.getObjectByID?.('melvorF:' + tutorial_portraits[Number(match[1]) - 1])?.media ?? null : null;
}
