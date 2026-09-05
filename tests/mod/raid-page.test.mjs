import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
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
	const charitree = data.data.pages.find(entry => entry.id === 'Charity_Tree');
	assert.equal(page.customName, 'MOD_MP_PAGE_RAID');
	assert.equal(language.MOD_MP_PAGE_CHARITREE, 'Charitree');
	assert.equal(language.MOD_MP_PAGE_RAID, 'Raid (preview)');
	assert.equal(language.MOD_MP_RAID_TITLE, 'Raid (preview)');
	assert.equal(page.containerID, 'mp-raid-page');
	assert.equal(page.sidebarItem.asideClass, 'badge mp-raid-nav');
	assert.equal(charitree.customName, 'MOD_MP_PAGE_CHARITREE');
	assert.equal(page.sidebarItem.aside, '0');
	assert.equal(page.sidebarItem.asideLangID, undefined);
	assert.equal(data.data.pages[data.data.pages.findIndex(entry => entry.id === 'Guild_Raid') + 1].id, 'Updates');
	assert.match(style, /\.mp-raid-nav[\s\S]*background-color: #5b4aa1/);
	assert.match(style, /\.mp-raid-nav:empty[\s\S]*display: none/);
	assert.match(style, /\.mp-raid-nav\.mp-raid-active[\s\S]*background-color: #8f3030/);
	assert.equal(language.MOD_MP_SIDEBAR_RAID_ACTIVE, 'active');
	assert.match(templates, /template-mp-raid-page/);
	assert.doesNotMatch(templates, /MOD_MP_RAID_GUILD_EVENT/);
	assert.doesNotMatch(templates, /template-mp-dropdown|state\.open_raid_page\(\)/);
	assert.doesNotMatch(templates, /MOD_MP_RAID_FELLOWSHIP_EXCLUDED/);
	assert.match(main, /on_page_toggle\('mp-raid-page'[\s\S]*Promise\.all\(\[get_client_events\(\), refresh_raid_state\(\)\]\)/);
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
	assert.equal(language.MOD_MP_RAID_FULL_HP_REQUIRED, 'Restore to 100% Hitpoints before beginning a Raid Assault.');
	assert.match(main, /runtime\.raid_combat\.has_active\(\)/);
	assert.match(main, /runtime\.raid_combat\.start\(reservation\)/);
	assert.match(main, /processed_raid_cache_ids/);
	assert.match(main, /api\/raids\/cache\/acknowledge/);
});

test('renders all placeholder combat tiers and cooperative Raid state', () => {
	assert.equal(data.data.monsters.filter(monster => monster.id.startsWith('Raid_Tier_')).length, 4);
	assert.match(templates, /v-for="tier in \[1, 2, 3, 4\]"/);
	assert.match(templates, /state\.raid\?\.remaining_health/);
	assert.match(templates, /state\.raid\?\.leaderboard/);
});

test('keeps Raid overview bindings safe before the server state arrives', () => {
	const raid_page = templates.slice(templates.indexOf('template-mp-raid-page'), templates.indexOf('template-mp-updates-page'));
	for (const property of ['remaining_health', 'max_health', 'secured', 'active', 'expires_at', 'member', 'contribution_cap', 'leaderboard'])
		assert.doesNotMatch(raid_page, new RegExp(`state\\.raid\\.${property}\\b`));
	assert.match(raid_page, /state\.raid\?\.remaining_health/);
	assert.match(raid_page, /state\.raid\?\.leaderboard/);
});

test('resolves the packaged Raid monster icon through the mod context', () => {
	const actions = install_transfer_actions({
		ctx: { getResourceUrl: path => `mod-resource://${path}` }
	});

	assert.equal(actions.get_raid_monster_icon(1), 'mod-resource://assets/raid_plant_t1.png');
});

test('gives every Raid boss 99% opening resistance and a six-second post-attack vulnerability', () => {
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
	assert.equal(fortified.templateID, 'melvorD:EndOfFightRemoval');
	assert.equal(fortified.target, 'Self');
	assert.equal(resistance_value(fortified), 99);
	assert.equal(vulnerable.templateID, 'melvorD:EndOfFightRemoval');
	assert.equal(vulnerable.target, 'Self');
	assert.equal(resistance_value(vulnerable), -66);
	assert.equal(resistance_value(fortified) + resistance_value(vulnerable), 33);
	assert.deepEqual(vulnerable.timers, [{ name: 'vulnerability' }]);
	assert.deepEqual(fortified.behaviours.find(behaviour => behaviour.type === 'ModifyStats'), {
		type: 'ModifyStats', statGroupName: 'fortification', newValue: 1,
		triggersOn: [{ type: 'EffectApplied' }]
	});
	assert.deepEqual(vulnerable.behaviours.find(behaviour => behaviour.type === 'ModifyStats'), {
		type: 'ModifyStats', statGroupName: 'vulnerability', newValue: 1,
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

test('uses the registered Full Version IDs for full-game raid materials', () => {
	const loot_ids = data.data.monsters
		.flatMap(monster => monster.lootTable)
		.map(loot => loot.itemID);
	assert.ok(loot_ids.includes('melvorF:Eyeball'));
	assert.ok(loot_ids.includes('melvorF:Large_Horn'));
	assert.ok(!loot_ids.includes('melvorD:Eyeball'));
	assert.ok(!loot_ids.includes('melvorD:Large_Horn'));
});
