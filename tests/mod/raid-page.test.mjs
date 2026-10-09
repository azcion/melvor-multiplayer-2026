import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { format_raid_attack_description, raid_resistance_from_defeats } from '../../mod/raid-combat.mjs';
import { install_transfer_actions } from '../../mod/client-actions-transfer.mjs';
import { read_client_source } from './source.mjs';

const main = await read_client_source();
const templates = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
const style = await readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8');
const data = JSON.parse(await readFile(new URL('../../mod/data.json', import.meta.url), 'utf8'));
const language = JSON.parse(await readFile(new URL('../../mod/data/lang/en.json', import.meta.url), 'utf8'));

function comparison_is_met(left, operator, right) {
	switch (operator) {
		case '==': return left === right;
		case '<': return left < right;
		default: throw new Error(`Unsupported test comparison: ${operator}`);
	}
}

function condition_is_met(condition, attacker) {
	assert.equal(condition.type, 'Hitpoints');
	const character = condition.character === 'Player' ? attacker : attacker.target;
	const hitpoints_percent = (character.hitpoints / character.max_hitpoints) * 100;
	return comparison_is_met(hitpoints_percent, condition.operator, condition.value);
}

function effect_timer_damage(effect, target) {
	const proc_count = effect.parameters.find(parameter => parameter.name === 'procs').initialValue;
	const proc_interval = effect.parameters.find(parameter => parameter.name === 'interval').initialValue;
	const damage_behaviour = effect.behaviours.find(behaviour => behaviour.type === 'DamageCharacter');
	assert.deepEqual(damage_behaviour.triggersOn, [{ type: 'TimerFired', timerName: 'proc' }]);
	assert.ok(proc_interval > 0);

	const damage_group = effect.damageGroups.find(group => group.name === 'total');
	const damage = damage_group.damage.reduce((total, roll) => {
		assert.equal(roll.character, 'Target');
		assert.equal(roll.roll, false);
		assert.equal(roll.maxRoll, 'MaxHP');
		return total + Math.floor((target.max_hitpoints * roll.maxPercent) / 100);
	}, 0);
	return damage * proc_count;
}

function resolve_raid_attack(tier, player, { landed = true, barrier = false, immune = false } = {}) {
	const attack = data.data.attacks.find(entry => entry.id === `Raid_Tier_${tier}_Assault`);
	if (!landed || barrier || immune)
		return 0;

	const effects = new Map(data.data.combatEffects.map(effect => [`multiplayer:${effect.id}`, effect]));
	const attacker = { target: player };
	let damage = 0;
	for (const applicator of attack.onhitEffects) {
		const effect = effects.get(applicator.effectID);
		if (effect === undefined || (applicator.condition !== undefined && !condition_is_met(applicator.condition, attacker)))
			continue;
		damage += effect_timer_damage(effect, player);
	}
	player.hitpoints = Math.max(0, player.hitpoints - damage);
	return damage;
}

test('registers and mounts the Guild Raid page as a first-class multiplayer view', () => {
	const page = data.data.pages.find(entry => entry.id === 'Guild_Raid');
	const crucible = data.data.pages.find(entry => entry.id === 'Crucible');
	assert.equal(page.customName, 'MOD_MP_PAGE_RAID');
	assert.equal(language.MOD_MP_PAGE_CRUCIBLE, 'Crucible');
	assert.equal(language.MOD_MP_PAGE_RAID, 'Raid');
	assert.equal(language.MOD_MP_PAGE_RAID_HEADER, 'Raid (beta)');
	assert.equal(language.MOD_MP_RAID_TITLE, 'Raid (preview)');
	assert.equal(language.MOD_MP_RAID_READY_TITLE, "It's time.");
	assert.equal(page.containerID, 'mp-raid-page');
	assert.equal(page.sidebarItem.asideClass, 'badge mp-raid-nav');
	assert.equal(crucible.customName, 'MOD_MP_PAGE_CRUCIBLE');
	assert.equal(page.sidebarItem.aside, '0');
	assert.equal(page.media, 'assets/raid-nav.png');
	assert.equal(page.sidebarItem.icon, 'assets/raid-nav.png');
	assert.equal(page.sidebarItem.asideLangID, undefined);
	assert.equal(data.data.pages[data.data.pages.findIndex(entry => entry.id === 'Guild_Raid') + 1].id, 'Updates');
	assert.match(style, /\.mp-raid-nav[\s\S]*background-color: #5b4aa1/);
	assert.match(style, /\.mp-raid-nav:empty[\s\S]*display: none/);
	assert.match(style, /\.mp-raid-nav\.mp-raid-active[\s\S]*background-color: #8f3030/);
	assert.equal(language.MOD_MP_SIDEBAR_RAID_ACTIVE, 'active');
	assert.match(templates, /template-mp-raid-page/);
	assert.match(templates, /lang-id="MOD_MP_RAID_READY_INFO"/);
	assert.doesNotMatch(templates, /MOD_MP_RAID_GUILD_EVENT/);
	assert.doesNotMatch(templates, /template-mp-dropdown|state\.open_raid_page\(\)/);
	assert.doesNotMatch(templates, /MOD_MP_RAID_FELLOWSHIP_EXCLUDED/);
	assert.match(main, /on_page_toggle\('mp-raid-page', set_raid_page_visible\)/);
	assert.match(main, /function set_raid_page_visible[\s\S]*Promise\.all\(\[get_client_events\(\), refresh_raid_state\(\)\]\)/);
	assert.match(main, /aside\.textContent = active \? getLangString\('MOD_MP_SIDEBAR_RAID_ACTIVE'\) : ''/);
	assert.match(main, /aside\.hidden = !active/);
	assert.match(main, /update_raid_nav\(\)/);
});

test('keeps the Raid aside element mounted while hiding inactive state', async () => {
	const function_start = main.indexOf('function update_raid_nav');
	const function_source = main.slice(function_start, main.indexOf('\nasync function refresh_changelog', function_start));
	const aside = { textContent: '0', hidden: false, classList: {
		toggle(class_name, enabled) {
			this[class_name] = enabled;
		}
	} };
	const state = { raid: null };
	const update_raid_nav = new Function('state', 'document', 'getLangString', `
		function set_nav_ready(aside, ready) {
			aside.classList.toggle('mp-nav-ready', ready);
		}
		${function_source}
		return update_raid_nav;
	`)(
		state,
		{ querySelector: selector => selector === '.mp-raid-nav' ? aside : null },
		() => 'active'
	);

	update_raid_nav();
	assert.equal(aside.textContent, '');
	assert.equal(aside.hidden, true);
	assert.equal(aside.classList['mp-nav-ready'], true);
	assert.equal(aside.classList['mp-raid-active'], false);

	state.raid = { active: true };
	update_raid_nav();
	assert.equal(aside.textContent, 'active');
	assert.equal(aside.hidden, false);
	assert.equal(aside.classList['mp-raid-active'], true);
});

test('namespaces the formatted-language custom element', () => {
	assert.match(main, /\['mp-lang-string-f', LangStringFormattedElement\]/);
	assert.doesNotMatch(main, /customElements\.define\('lang-string-f'/);
	assert.match(templates, /<mp-lang-string-f/);
	assert.doesNotMatch(templates, /<lang-string-f/);
});

test('wires reservation before combat and durable victory-cache reconciliation', () => {
	assert.match(main, /api\/raids\/assaults\/reserve/);
	assert.match(main, /api\/raids\/assaults\/abandon/);
	assert.match(main, /!runtime\.raid_combat\.has_full_hitpoints\(game\.combat\.player\)/);
	assert.doesNotMatch(main, /!raid_module\.has_full_hitpoints\(game\.combat\.player\)/);
	assert.equal(language.MOD_MP_RAID_FULL_HP_REQUIRED, 'Restore to 100% HP before beginning an Assault.');
	assert.match(main, /runtime\.raid_combat\.has_active\(\)/);
	assert.match(main, /runtime\.raid_combat\.start\(reservation\)/);
	assert.match(main, /processed_raid_cache_ids/);
	assert.match(main, /api\/raids\/cache\/acknowledge/);
});

test('confirms a selected Raid tier before reserving its Assault', async () => {
	const calls = [];
	let dismiss_modal;
	const state = { raid_can_assault: true, raid_action_pending: false, raid_error: '',
		raid_state: { unlocked_tiers: [2] } };
	const runtime = {
		state,
		ctx: { getResourceUrl: path => `mod-resource://${path}` },
		queue_modal: (...args) => {
			calls.push(['modal', args[1], args[2]]);
			dismiss_modal = args[3].didClose;
			return true;
		},
		close_modal_and_wait: async template => { calls.push(['close', template]); },
		api_post: async (path, body) => {
			calls.push(['reserve', path, body.tier]);
			return { assault_id: 'assault-1' };
		},
		refresh_raid_state: async () => { calls.push(['refresh']); },
		raid_combat: {
			has_full_hitpoints: () => true,
			start: reservation => { calls.push(['combat', reservation.assault_id]); }
		},
		game: { combat: { player: {} } },
		getLangString: key => key,
		raid_loaded_session_id: 'session-1'
	};
	Object.assign(state, install_transfer_actions(runtime));
	state.show_raid_assault_confirmation(3);
	assert.deepEqual(calls, [['modal', 'raid-assault-confirm-modal', 'mod-resource://assets/raid-nav.png']]);
	dismiss_modal();
	await state.confirm_raid_assault();
	assert.equal(calls.length, 1);
	state.show_raid_assault_confirmation(3);
	await state.confirm_raid_assault();
	assert.deepEqual(calls, [
		['modal', 'raid-assault-confirm-modal', 'mod-resource://assets/raid-nav.png'],
		['modal', 'raid-assault-confirm-modal', 'mod-resource://assets/raid-nav.png'],
		['close', 'raid-assault-confirm-modal'],
		['reserve', '/api/raids/assaults/reserve', 3],
		['combat', 'assault-1'],
		['refresh']
	]);
	await state.confirm_raid_assault();
	assert.equal(calls.length, 6);
	assert.match(templates, /@click="state\.show_raid_assault_confirmation\(tier\)"/);
	assert.match(templates, /template-mp-raid-assault-confirm-modal[\s\S]*MOD_MP_RAID_ASSAULT_WARNING[\s\S]*state\.confirm_raid_assault\(\)[\s\S]*MOD_MP_BUTTON_CANCEL/);
});

test('locks Raid tiers per character and blocks confirmation below full HP', async () => {
	let modal_count = 0;
	let reserve_count = 0;
	const state = { raid_can_assault: true, raid_state: { unlocked_tiers: [1] } };
	const runtime = {
		state,
		ctx: { getResourceUrl: path => path },
		queue_modal: () => { modal_count++; return true; },
		api_post: async () => { reserve_count++; return {}; },
		raid_combat: { has_full_hitpoints: () => false },
		game: { combat: { player: {} } }
	};
	Object.assign(state, install_transfer_actions(runtime));
	assert.equal(state.is_raid_tier_unlocked(1), true);
	assert.equal(state.is_raid_tier_unlocked(2), true);
	assert.equal(state.is_raid_tier_unlocked(3), false);
	state.show_raid_assault_confirmation(3);
	assert.equal(modal_count, 0);
	state.show_raid_assault_confirmation(2);
	assert.equal(modal_count, 1);
	assert.equal(state.raid_confirmation_full_hp, false);
	await state.confirm_raid_assault();
	assert.equal(reserve_count, 0);
	assert.match(templates, /mp-raid-tier-locked/);
	assert.match(templates, /:disabled="!state\.can_assault_raid_tier\(tier\)"/);
	assert.match(templates, /v-if="!state\.raid_confirmation_full_hp"[^>]*>.*MOD_MP_RAID_FULL_HP_REQUIRED/);
	assert.match(templates, /:disabled="!state\.raid_confirmation_full_hp"[^>]*@click="state\.confirm_raid_assault\(\)"/);
	assert.match(templates, /class="mp-raid-tier-image"><img :src="state\.is_raid_tier_unlocked\(tier\) \? state\.get_raid_monster_icon\(tier\) : state\.get_raid_nav_icon\(\)"/);
	assert.match(style, /\.mp-raid-tier-image\s*\{[^}]*aspect-ratio: 1;[^}]*place-items: center;/);
	assert.match(style, /\.mp-raid-tier-locked \.mp-raid-tier-image > img\s*\{\s*filter: brightness\(\.15\);\s*max-width: 144px;/);
	assert.match(style, /\.mp-raid-tier\s*\{[^}]*grid-template-rows: auto 1fr auto auto;/);
	assert.match(style, /\.mp-raid-tier\s*\{[^}]*overflow: hidden;/);
});

test('Raid HP bar shows remaining health and shrinks with damage', () => {
	const getter = main.match(/get raid_progress_pct\(\) \{([\s\S]*?)\n\t\},/)?.[1];
	assert.ok(getter);
	const remaining_percent = new Function(`return function() {${getter}}`)();
	assert.equal(remaining_percent.call({ raid: { remaining_health: 7500, max_health: 7500 } }), 100);
	assert.equal(remaining_percent.call({ raid: { remaining_health: 2250, max_health: 7500 } }), 30);
	assert.equal(remaining_percent.call({ raid: { remaining_health: 0, max_health: 7500 } }), 0);
	assert.match(style, /\.mp-raid-health \.progress-bar\s*\{\s*background: #8f3030;/);
	assert.match(templates, /class="progress mp-raid-health"><div class="progress-bar" :style="\{ width: state\.raid_progress_pct \+ '%' \}"/);
});

test('renders all four combat tiers and cooperative Raid state', () => {
	assert.equal(data.data.monsters.filter(monster => monster.id.startsWith('Raid_Tier_')).length, 4);
	assert.match(templates, /v-for="tier in \[1, 2, 3, 4\]"/);
	assert.match(templates, /state\.raid\?\.remaining_health/);
	assert.match(templates, /state\.raid\?\.leaderboard/);
	assert.match(templates, /state\.raid\?\.member\?\.next_assault_grant_at/);
	assert.match(templates, /MOD_MP_RAID_NEXT_ASSAULTS/);
	assert.doesNotMatch(templates, /state\.raid\?\.contribution_cap/);
	assert.match(main, /state\.raid_tier_progress = response\.raid_tier_progress/);
	assert.match(main, /return this\.raid_tier_progress\[tier\] \?\? 0/);
});

test('keeps Raid overview bindings safe before the server state arrives', () => {
	const raid_page = templates.slice(templates.indexOf('template-mp-raid-page'), templates.indexOf('template-mp-updates-page'));
	for (const property of ['remaining_health', 'max_health', 'secured', 'active', 'expires_at', 'member', 'leaderboard'])
		assert.doesNotMatch(raid_page, new RegExp(`state\\.raid\\.${property}\\b`));
	assert.match(raid_page, /state\.raid\?\.remaining_health/);
	assert.match(raid_page, /state\.raid\?\.leaderboard/);
});

test('resolves the packaged Raid monster icon through the mod context', () => {
	const actions = install_transfer_actions({
		ctx: { getResourceUrl: path => `mod-resource://${path}` }
	});

	for (const tier of [1, 2, 3, 4]) {
		const asset = `assets/raid-boss-t${tier}.png`;
		assert.equal(data.data.monsters.find(monster => monster.id === `Raid_Tier_${tier}`).media, asset);
		assert.equal(actions.get_raid_monster_icon(tier), `mod-resource://${asset}`);
	}
	assert.equal(data.data.combatAreas.find(area => area.id === 'Guild_Raid').media, 'assets/raid-nav.png');
	assert.equal(actions.get_raid_nav_icon(), 'mod-resource://assets/raid-nav.png');
	assert.match(templates, /class="mp-raid-hero" :src="state\.get_raid_nav_icon\(\)"/);
});

test('shows the renamed Raid bosses from the registered Monsters', () => {
	const names = ['The Mossbound Hollow', 'The Entwined Hollow', 'The Lithic Hollow', 'The Reliquary Hollow'];
	const monsters = data.data.monsters.filter(monster => monster.id.startsWith('Raid_Tier_'));
	assert.deepEqual(monsters.map(monster => monster.name), names);
	const actions = install_transfer_actions({
		game: { monsters: { getObjectByID: id => monsters.find(monster => `multiplayer:${monster.id}` === id) } },
		getLangString: () => 'Tier %s'
	});
	assert.equal(actions.get_raid_monster_name(2), names[1]);
	assert.equal(actions.get_raid_monster_name(5), 'Tier 5');
	assert.match(templates, /state\.get_raid_monster_name\(tier\)/);
});

test('gives every Raid boss 95% opening resistance and a six-second post-attack vulnerability', () => {
	const raid_bosses = data.data.monsters.filter(monster => monster.id.startsWith('Raid_Tier_'));
	const fortified = data.data.combatEffects.find(effect => effect.id === 'Raid_Boss_Fortified');
	const vulnerable = data.data.combatEffects.find(effect => effect.id === 'Raid_Boss_Vulnerable');
	const resistance_value = effect => effect.statGroups[0].modifiers.flatResistance.find(entry =>
		entry.damageTypeID === 'melvorD:Normal'
	).value;

	assert.equal(raid_bosses.length, 4);
	assert.ok(raid_bosses.every(monster => monster.isBoss === true));
	assert.ok(raid_bosses.every(monster => monster.combatEffects?.map(effect => effect.effectID).join(',') ===
		'multiplayer:Raid_Boss_Fortified,multiplayer:Raid_Boss_Vulnerable'));
	assert.equal(fortified.media, 'assets/raid-nav.png');
	assert.equal(vulnerable.media, 'assets/raid-nav.png');
	assert.equal(fortified.templateID, 'melvorD:EndOfFightRemoval');
	assert.equal(fortified.target, 'Self');
	assert.equal(resistance_value(fortified), 1);
	assert.equal(vulnerable.templateID, 'melvorD:EndOfFightRemoval');
	assert.equal(vulnerable.target, 'Self');
	assert.equal(resistance_value(vulnerable), -1);
	assert.equal(resistance_value(fortified) * 95 + resistance_value(vulnerable) * 62, 33);
	assert.deepEqual(vulnerable.timers, [{ name: 'vulnerability' }]);
	assert.deepEqual(fortified.behaviours.find(behaviour => behaviour.type === 'ModifyStats'), {
		type: 'ModifyStats', statGroupName: 'fortification', newValue: 95,
		triggersOn: [{ type: 'EffectApplied' }]
	});
	assert.deepEqual(vulnerable.behaviours.find(behaviour => behaviour.type === 'ModifyStats'), {
		type: 'ModifyStats', statGroupName: 'vulnerability', newValue: 62,
		triggersOn: [{ type: 'EffectApplied' }]
	});
	assert.deepEqual(vulnerable.behaviours.find(behaviour => behaviour.type === 'StartTimer'), {
		type: 'StartTimer', timerName: 'vulnerability', value: 6000,
		triggersOn: [{ type: 'EffectApplied' }, { type: 'EffectReapplied' }]
	});
	assert.deepEqual(vulnerable.behaviours.find(behaviour => behaviour.type === 'RemoveEffect'), {
		type: 'RemoveEffect',
		triggersOn: [{ type: 'TimerFired', timerName: 'vulnerability' }]
	});
});

test('configures every tier with its requested health, speed, and special-only Toxic Dread', () => {
	const expected = {
		1: { hitpoints: 500, reduced_percent: 15, statuses: ['melvorD:Fear', 'melvorD:Poison'] },
		2: { hitpoints: 1500, reduced_percent: 25, statuses: ['melvorD:Fear', 'melvorD:DeadlyPoison'] },
		3: { hitpoints: 9000, reduced_percent: 33, statuses: ['melvorD:Fear', 'melvorD:DeadlyPoison'] },
		4: { hitpoints: 15000, reduced_percent: 40, statuses: ['melvorD:Fear', 'melvorD:DeadlyPoison'] }
	};

	for (const [tier_text, tier_expected] of Object.entries(expected)) {
		const tier = Number(tier_text);
		const monster = data.data.monsters.find(entry => entry.id === `Raid_Tier_${tier}`);
		const attack = data.data.attacks.find(entry => entry.id === `Raid_Tier_${tier}_Assault`);
		const full_damage = data.data.combatEffects.find(entry => entry.id === `Raid_Tier_${tier}_FullDamage`);
		const reduced_damage = data.data.combatEffects.find(entry => entry.id === `Raid_Tier_${tier}_ReducedDamage`);

		assert.equal(monster.levels.Hitpoints * 10, tier_expected.hitpoints);
		assert.equal(monster.equipmentStats.find(stat => stat.key === 'attackSpeed').value, 8000);
		assert.deepEqual(monster.specialAttacks, [`multiplayer:Raid_Tier_${tier}_Assault`]);
		assert.deepEqual(monster.overrideSpecialChances, [100]);
		assert.deepEqual(attack.damage, []);
		assert.equal(attack.cantMiss, true);
		assert.equal(attack.name, 'Toxic Dread');
		assert.deepEqual(attack.onhitEffects.map(effect => effect.effectID), [
			`multiplayer:Raid_Tier_${tier}_FullDamage`,
			`multiplayer:Raid_Tier_${tier}_ReducedDamage`,
			...tier_expected.statuses
		]);
		assert.deepEqual(attack.onhitEffects[0].condition, {
			type: 'Hitpoints', character: 'Enemy', operator: '==', value: 100
		});
		assert.deepEqual(attack.onhitEffects[1].condition, {
			type: 'Hitpoints', character: 'Enemy', operator: '<', value: 100
		});
		for (const effect of [full_damage, reduced_damage]) {
			assert.equal(effect.templateID, 'melvorD:DOT');
			assert.deepEqual(effect.parameters, [
				{ name: 'procs', initialValue: 1 },
				{ name: 'interval', initialValue: 50 }
			]);
			assert.deepEqual(effect.behaviours, [{
				type: 'DamageCharacter',
				value: 'p.damagePerProc',
				triggersOn: [{ type: 'TimerFired', timerName: 'proc' }]
			}]);
			assert.equal(effect.damageGroups[0].applyDamageModifiers, false);
			assert.equal(effect.damageGroups[0].applyResistance, false);
		}
		assert.equal(full_damage.damageGroups[0].damage[0].maxPercent, 50);
		assert.equal(reduced_damage.damageGroups[0].damage[0].maxPercent, tier_expected.reduced_percent);
	}
});

test('adds Into the Abyss statuses to the upper-tier Toxic Dread attacks when available', () => {
	const ita = data.dependentData.find(entry => entry.namespace === 'melvorItA');
	const tier_3 = ita.data.attacks.find(entry => entry.id === 'Raid_Tier_3_Assault_ItA');
	const tier_4 = ita.data.attacks.find(entry => entry.id === 'Raid_Tier_4_Assault_ItA');

	assert.deepEqual(tier_3.onhitEffects.map(effect => effect.effectID), [
		'multiplayer:Raid_Tier_3_FullDamage',
		'multiplayer:Raid_Tier_3_ReducedDamage',
		'melvorD:Fear',
		'melvorD:DeadlyPoison',
		'melvorItA:Laceration'
	]);
	assert.deepEqual(tier_4.onhitEffects.map(effect => effect.effectID), [
		'multiplayer:Raid_Tier_4_FullDamage',
		'multiplayer:Raid_Tier_4_ReducedDamage',
		'melvorD:Fear',
		'melvorD:DeadlyPoison',
		'melvorItA:Laceration',
		'melvorItA:EldritchCurse'
	]);
	assert.deepEqual(ita.modifications.monsters, [
		{
			id: 'multiplayer:Raid_Tier_3',
			specialAttacks: {
				remove: ['multiplayer:Raid_Tier_3_Assault'],
				add: [{ attackID: 'multiplayer:Raid_Tier_3_Assault_ItA', chance: 100 }]
			}
		},
		{
			id: 'multiplayer:Raid_Tier_4',
			specialAttacks: {
				remove: ['multiplayer:Raid_Tier_4_Assault'],
				add: [{ attackID: 'multiplayer:Raid_Tier_4_Assault_ItA', chance: 100 }]
			}
		}
	]);
});

test('resolves every Toxic Dread damage tier from player HP and reapplies its timer damage', () => {
	for (const [tier, reduced_damage] of [[1, 15], [2, 25], [3, 33], [4, 40]]) {
		const player = { hitpoints: 100, max_hitpoints: 100 };
		assert.equal(resolve_raid_attack(tier, player), 50);
		assert.equal(player.hitpoints, 50);
		assert.equal(resolve_raid_attack(tier, player), reduced_damage);
		assert.equal(player.hitpoints, 50 - reduced_damage);
	}

	const scaled_player = { hitpoints: 137, max_hitpoints: 137 };
	assert.equal(resolve_raid_attack(1, scaled_player), 68);
	scaled_player.hitpoints = 136;
	assert.equal(resolve_raid_attack(1, scaled_player), 20);
});

test('keeps the accepted on-hit protection behavior for Tier 1 fixed damage', () => {
	for (const protection of [{ landed: false }, { barrier: true }, { immune: true }]) {
		const player = { hitpoints: 100, max_hitpoints: 100 };
		assert.equal(resolve_raid_attack(1, player, protection), 0);
		assert.equal(player.hitpoints, 100);
	}
});

test('allows a minimum-HP player with Auto Eat I and enough food to survive repeated fixed strikes', () => {
	const player = { hitpoints: 100, max_hitpoints: 100 };
	let food = 100;
	for (let attack_count = 0; attack_count < 20; attack_count++) {
		resolve_raid_attack(1, player);
		assert.ok(player.hitpoints > 0);
		if (player.hitpoints <= 20) {
			const food_needed = Math.ceil((40 - player.hitpoints) / 10);
			assert.ok(food >= food_needed);
			food -= food_needed;
			player.hitpoints += food_needed * 10;
		}
	}
	assert.ok(food < 100);
});

test('leaves Raid Monsters without native loot for server Inbox delivery', () => {
	for (const monster of data.data.monsters) {
		assert.equal(monster.lootChance, 0);
		assert.deepEqual(monster.lootTable, []);
	}
	assert.equal(data.dependentData.some(entry => entry.namespace === 'melvorTotH' &&
		entry.modifications?.monsters?.some(monster => monster.id.startsWith('multiplayer:Raid_Tier_'))), false);
});

test('opens boss drops with the Raid navigation icon and exact odds', () => {
	const table = [{ item_id: 'melvorD:Bird_Nest', min: 30, max: 60, weight: 8, total_weight: 10 }];
	const calls = [];
	const state = { raid_monster_drops: { 1: table }, raid_drop_entries: [] };
	Object.assign(state, install_transfer_actions({
		state,
		ctx: { getResourceUrl: path => `mod-resource://${path}` },
		game: { monsters: { getObjectByID: id => ({ name: `Boss ${id}` }) } },
		queue_modal: (...args) => { calls.push(args); return true; }
	}));
	state.show_raid_drops(1);
	assert.deepEqual(calls[0], ['Boss multiplayer:Raid_Tier_1', 'raid-drops-modal', 'mod-resource://assets/raid-nav.png', {}, false, false]);
	assert.equal(state.raid_drop_entries, table);
	assert.equal(state.get_raid_drop_odds(table[0]), '4/5, 80%');
	assert.equal(state.get_raid_drop_odds({ weight: 1, total_weight: 3 }), '1/3, 33.33%');
	state.show_raid_drops(4);
	assert.equal(calls.length, 1);
	assert.match(templates, /state\.show_raid_assault_confirmation\(tier\)[\s\S]*state\.show_raid_drops\(tier\)[\s\S]*MOD_MP_RAID_TIER_PROGRESS/);
	assert.match(templates, /MOD_MP_RAID_DROPS_INTRO/);
	assert.match(templates, /MOD_MP_RAID_DROPS_INBOX/);
	assert.match(templates, /drop\.min }} - {{ drop\.max }} ×/);
	assert.doesNotMatch(style, /\.mp-raid-boss-info\s*\{[^}]*(?:max-height|overflow-y)/);
});

test('previews registered boss stats and attacks with current Guild resistance', () => {
	const calls = [];
	const state = { raid_state: { tier_defeats: { 1: 6, 4: 500 } }, raid_boss_info: null };
	const monsters = data.data.monsters.filter(monster => monster.id.startsWith('Raid_Tier_'));
	const lookup = id => {
		const monster = monsters.find(monster => `multiplayer:${monster.id}` === id);
		if (!monster) return undefined;
		return { ...monster, specialAttacks: monster.specialAttacks.map(id => ({
			chance: 100,
			attack: data.data.attacks.find(attack => `multiplayer:${attack.id}` === id)
		})) };
	};
	Object.assign(state, install_transfer_actions({
		state,
		ctx: { getResourceUrl: path => `mod-resource://${path}` },
		game: { monsters: { getObjectByID: lookup } },
		get_number_multiplier: () => 10,
		numberWithCommas: number => number.toLocaleString('en-US'),
		format_raid_attack_description: attack => format_raid_attack_description(attack, { combatEffects: { getObjectByID: () => undefined } }),
		get_game_asset_url: path => `game-asset://${path}`,
		raid_resistance_from_defeats,
		queue_modal: (...args) => { calls.push(args); return true; }
	}));
	for (const tier of [1, 2, 3, 4]) {
		state.show_raid_boss_info(tier);
		assert.equal(state.raid_boss_info.hitpoints, (monsters[tier - 1].levels.Hitpoints * 10).toLocaleString('en-US'));
		assert.equal(state.raid_boss_info.attack_interval, 8);
		assert.equal(state.raid_boss_info.attacks[0].name, 'Toxic Dread');
		assert.match(state.raid_boss_info.attacks[0].description, /50% of your maximum Hitpoints/);
		assert.equal(calls[tier - 1][1], 'raid-boss-info-modal');
		assert.equal(calls[tier - 1][2], 'mod-resource://assets/raid-nav.png');
	}
	assert.equal(state.raid_boss_info.fortified_resistance, 75);
	state.show_raid_boss_info(1);
	assert.equal(state.raid_boss_info.fortified_resistance, 94);
	state.show_raid_boss_info(5);
	assert.equal(calls.length, 5);
	assert.equal(state.get_raid_info_icon('drops'), 'game-asset://assets/media/main/bank_header.png');
	assert.equal(state.get_raid_info_icon('boss'), 'game-asset://assets/media/status/stunned.png');
	assert.match(templates, /class="btn btn-danger mb-2"[^>]*state\.can_assault_raid_tier/);
	assert.match(templates, /class="mp-raid-info-buttons"/);
	assert.match(templates, /class="mp-raid-drop-row-label"/);
	assert.match(templates, /MOD_MP_RAID_WEAK_DESCRIPTION/);
});

test('requires entry each cycle and hides all Raid results at the closing boundary', () => {
	const start = main.indexOf('\tget raid_visible()');
	const end = main.indexOf('\tget raid_progress_pct()', start);
	const view = new Function(`return { ${main.slice(start, end)} };`)();
	const expires_at = Date.parse('2026-10-19T12:00:00Z');
	Object.assign(view, {
		raid: { raid_id: 1, active: true, expires_at },
		raid_state: { entered: false, can_activate: true },
		raid_update_time: expires_at - 1
	});
	assert.equal(view.raid_visible, false);
	assert.equal(view.raid_entry_available, true);
	view.raid_state.entered = true;
	assert.equal(view.raid_visible, true);
	view.raid.secured = true;
	assert.equal(view.raid_visible, true);
	view.raid_update_time = expires_at;
	assert.equal(view.raid_visible, false);
	assert.equal(view.raid_entry_available, false);
	view.raid = { raid_id: 2, active: true, expires_at: expires_at + 604800000 };
	view.raid_state.entered = false;
	assert.equal(view.raid_visible, false);
	assert.equal(view.raid_entry_available, true);
	assert.match(templates, /mp-raid-activation" v-show="[^\"]*!state\.raid_visible/);
	assert.match(templates, /block block-rounded" v-show="state\.raid_visible && state\.raid\?\.member"/);
	assert.match(templates, /block block-rounded" v-show="state\.raid_visible"/);
});

test('formats the server-provided schedule in the player’s local time', () => {
	const state = { raid_state: { schedule: {
		starts_at: Date.parse('2026-10-16T12:00:00Z'), ends_at: Date.parse('2026-10-19T12:00:00Z')
	} } };
	Object.assign(state, install_transfer_actions({ state }));
	assert.equal(state.format_raid_schedule_local().split(' – ').length, 2);
	state.raid_state = {};
	assert.equal(state.format_raid_schedule_local(), '');
});

test('a stale refresh cannot undo a later successful Raid entry', async () => {
	const start = main.indexOf('async function refresh_raid_state()');
	const end = main.indexOf('\nfunction set_raid_page_visible', start);
	const replies = [];
	const state = { raid_time_offset: 0, raid_loaded: false };
	const refresh = new Function('state', 'api_get', 'update_raid_nav', 'reconcile_raid_cache', `
		let raid_refresh_generation = 0;
		${main.slice(start, end)}
		return refresh_raid_state;
	`)(state, () => new Promise(resolve => replies.push(resolve)), () => {}, () => {});
	const older = refresh();
	const newer = refresh();
	replies[1]({ entered: true, server_now: Date.now() });
	await newer;
	replies[0]({ entered: false, server_now: Date.now() });
	await older;
	assert.equal(state.raid_state.entered, true);
	assert.equal(state.raid_loaded, true);
	assert.equal(state.raid_loading, false);
});

test('allows the last reserved Assault to resume only in its loaded session before expiry', () => {
	const start = main.indexOf('\tget raid_can_assault()');
	const end = main.indexOf('\n\tget ', start + 1);
	const view = new Function('raid_loaded_session_id', 'raid_combat', `return { ${main.slice(start, end)} };`)(
		'loaded-session', { has_active: () => false }
	);
	Object.assign(view, { raid_visible: true, raid_update_time: 1000, raid_action_pending: false,
		raid: { member: { eligible: true, assaults: 0, pending_assault: {
			loaded_session_id: 'loaded-session', combat_deadline: 2000
		} } } });
	assert.equal(view.raid_can_assault, true);
	view.raid.member.pending_assault.loaded_session_id = 'old-session';
	assert.equal(view.raid_can_assault, false);
	view.raid.member.pending_assault.loaded_session_id = 'loaded-session';
	view.raid_update_time = 2000;
	assert.equal(view.raid_can_assault, false);
	view.raid.member.assaults = 1;
	assert.equal(view.raid_can_assault, true);
	view.raid_action_pending = true;
	assert.equal(view.raid_can_assault, false);
});

test('abandons a stale reservation and retries once, including an expired same-session reply', async () => {
	for (const reply of [{ error_lang: 'MOD_MP_RAID_ASSAULT_PENDING' }, {
		assault_id: 'expired', combat_deadline: Date.now() - 1000
	}]) {
		const calls = [];
		let reservations = 0;
		const state = { raid_can_assault: true, raid_state: {}, raid_time_offset: 0 };
		const runtime = { state, game: { combat: { player: {} } }, getLangString: key => key, error: () => {},
			raid_loaded_session_id: 'new-session', refresh_raid_state: async () => calls.push('refresh'),
			raid_combat: { has_full_hitpoints: () => true, has_active: () => false,
				start: reservation => calls.push(reservation.assault_id) },
			api_post: async path => {
				calls.push(path);
				if (path.endsWith('/abandon')) return { success: true };
				return reservations++ === 0 ? reply : { assault_id: 'replacement', combat_deadline: Date.now() + 60000 };
			} };
		Object.assign(state, install_transfer_actions(runtime));
		await state.begin_raid_assault(1);
		assert.deepEqual(calls, ['/api/raids/assaults/reserve', '/api/raids/assaults/abandon',
			'/api/raids/assaults/reserve', 'replacement', 'refresh']);
		assert.equal(state.raid_action_pending, false);
	}
});

test('failed Raid start logs through runtime and releases the action guard even when refresh fails', async () => {
	const logs = [];
	const state = { raid_can_assault: true, raid_state: {} };
	const runtime = { state, game: { combat: { player: {} } }, getLangString: key => key,
		error: (...args) => logs.push(args), raid_loaded_session_id: 'session',
		raid_combat: { has_full_hitpoints: () => true, has_active: () => false },
		api_post: async () => null,
		refresh_raid_state: async () => { throw new Error('refresh failed'); } };
	Object.assign(state, install_transfer_actions(runtime));
	await assert.rejects(state.begin_raid_assault(1), /refresh failed/);
	assert.equal(state.raid_error, 'MOD_MP_RAID_START_FAILED');
	assert.equal(logs.length, 1);
	assert.equal(state.raid_action_pending, false);
	runtime.api_post = async () => ({ success: true });
	Object.assign(state, install_transfer_actions(runtime));
	await assert.rejects(state.activate_raid(), /refresh failed/);
	assert.equal(state.raid_action_pending, false);
});

test('a recovered reservation only enables its originally reserved tier', () => {
	const state = { raid_can_assault: true, raid_update_time: 1000, raid_state: { unlocked_tiers: [1, 2, 3] },
		raid: { member: { pending_assault: { loaded_session_id: 'current-session', combat_deadline: 2000, tier: 2 } } } };
	Object.assign(state, install_transfer_actions({ state, raid_loaded_session_id: 'current-session' }));
	assert.equal(state.can_assault_raid_tier(2), true);
	assert.equal(state.can_assault_raid_tier(1), false);
	assert.equal(state.can_assault_raid_tier(4), false);
	state.raid.member.pending_assault.loaded_session_id = 'previous-session';
	assert.equal(state.can_assault_raid_tier(4), true);
});
