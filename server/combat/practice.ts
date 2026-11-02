import type { EffectID } from './effects';

export const PRACTICE_RULESET = 'practice-1';
export const PRACTICE_TIERS = [1,3,6,9,12,15,20,30,40,60,80,99].map((level,i) => ({
	tier: i + 1, level, hitpoints: Math.max(3, level),
	material: level < 6 ? 'Bronze' : level < 23 ? 'Iron' : level < 30 ? 'Steel' : level < 50 ? 'Mithril' : level < 70 ? 'Adamant' : 'Rune'
}));
type Role = { name: string; portrait: string; type: 'melee' | 'ranged' | 'magic'; hp: number; damage: number; accuracy: number; defence: number; interval: number; effect?: EffectID };
export const PRACTICE_ROLES = {
	recruit: { name: 'Guard Recruit', portrait: 'SQUIRE', type: 'melee', hp: 1, damage: 1, accuracy: 1, defence: 1, interval: 3800 },
	veteran: { name: 'Shield Veteran', portrait: 'KNIGHT', type: 'melee', hp: 1.3, damage: .75, accuracy: 1, defence: 3, interval: 4200 },
	mauler: { name: 'Heavy Mauler', portrait: 'MARAUDER', type: 'melee', hp: 1.2, damage: 2.2, accuracy: 1.2, defence: .8, interval: 5800 },
	quickblade: { name: 'Quickblade', portrait: 'BANDIT_THUG', type: 'melee', hp: .9, damage: .65, accuracy: 1.1, defence: 1, interval: 2200 },
	serrated: { name: 'Serrated Duelist', portrait: 'BANDIT_THUG', type: 'melee', hp: 1, damage: .8, accuracy: 1, defence: 1, interval: 3600, effect: 'bleed' },
	venom: { name: 'Venom Sparrer', portrait: 'WOMAN', type: 'melee', hp: .9, damage: .7, accuracy: 1, defence: 1, interval: 4000, effect: 'poison' },
	hammer: { name: 'Hammer Veteran', portrait: 'KNIGHT', type: 'melee', hp: 1.2, damage: 1, accuracy: 1, defence: 1.3, interval: 4600, effect: 'slow' },
	apprentice: { name: 'Apprentice Duelist', portrait: 'MAN', type: 'melee', hp: .45, damage: 1.4, accuracy: 1.2, defence: .6, interval: 3200 },
	archer: { name: 'Patrol Archer', portrait: 'SQUIRE', type: 'ranged', hp: .65, damage: .8, accuracy: 1, defence: .7, interval: 3600 },
	caster: { name: 'Patrol Spellcaster', portrait: 'MAN', type: 'magic', hp: .5, damage: .8, accuracy: 1, defence: .6, interval: 4400 }
} satisfies Record<string, Role>;
export type PracticeRole = keyof typeof PRACTICE_ROLES;
type Definition = { id: string; name: string; category: 'duels' | 'groups' | 'circuits'; focus: string; waves: PracticeRole[][] };
export const PRACTICE_DEFINITIONS: Definition[] = [
	{ id:'recruit', name:'Guard Recruit', category:'duels', focus:'Test a new loadout against a forgiving, familiar opponent.', waves:[['recruit']] },
	{ id:'veteran', name:'Shield Veteran', category:'duels', focus:'Compare accuracy, weapon choice and stance against a difficult target.', waves:[['veteran']] },
	{ id:'mauler', name:'Heavy Mauler', category:'duels', focus:'Watch attack bars and eat with enough health to survive the next heavy hit.', waves:[['mauler']] },
	{ id:'quickblade', name:'Quickblade', category:'duels', focus:'Test defence and manage steady pressure through the eating cooldown.', waves:[['quickblade']] },
	{ id:'serrated', name:'Serrated Duelist', category:'duels', focus:'Account for bleeding damage when your fighter attacks. Effects begin at Tier II.', waves:[['serrated']] },
	{ id:'venom', name:'Venom Sparrer', category:'duels', focus:'Keep a health buffer while poison deals damage between attacks. Effects begin at Tier II.', waves:[['venom']] },
	{ id:'hammer', name:'Hammer Veteran', category:'duels', focus:'Manage reduced attack speed while continuing to eat normally. Effects begin at Tier II.', waves:[['hammer']] },
	{ id:'recruits', name:'Two Recruits', category:'groups', focus:'Finish one opponent to reduce the number of incoming attacks.', waves:[['recruit','recruit']] },
	{ id:'partners', name:'Veteran and Apprentice', category:'groups', focus:'Try removing the fragile attacker before the durable defender.', waves:[['veteran','apprentice']] },
	{ id:'patrol', name:'Mixed Patrol', category:'groups', focus:'Prioritise threats across melee, ranged and magic opponents.', waves:[['recruit','archer','caster']] },
	{ id:'circuit', name:'The Proving Circuit', category:'circuits', focus:'Bring one loadout through four bouts while managing carried health and eating cooldown.', waves:[['recruit'],['veteran'],['mauler'],['recruit','recruit']] }
];
export type PracticeEncounter = `practice_${string}_${number}`;
export function practice_selection(value: unknown) {
	if (typeof value !== 'string') return null;
	const match = /^practice_([a-z]+)_([1-9]\d?)$/.exec(value);
	if (!match) return null;
	const definition = PRACTICE_DEFINITIONS.find(entry => entry.id === match[1]);
	const tier = PRACTICE_TIERS.find(entry => entry.tier === Number(match[2]));
	return definition && tier ? { definition, tier } : null;
}
export const PRACTICE_ENCOUNTERS = PRACTICE_DEFINITIONS.flatMap(entry => PRACTICE_TIERS.map(tier => `practice_${entry.id}_${tier.tier}` as PracticeEncounter));
export function practice_available(caps: Record<string, number>, tier: typeof PRACTICE_TIERS[number]) {
	return ['attack','strength','defence'].every(skill => (caps[skill] ?? 1) >= tier.level) && (caps.hitpoints ?? 1) >= tier.hitpoints;
}
export function practice_wave(selection: NonNullable<ReturnType<typeof practice_selection>>, stage: number) {
	const level = selection.tier.level;
	return selection.definition.waves[stage].map((id,index) => {
		const role: Role = PRACTICE_ROLES[id];
		return { id: `human_${id}_${index+1}`, name: role.name, portrait: role.portrait, type: role.type,
			hp: Math.round((85 + level * 8) * role.hp), max_hit: Math.max(1, Math.round(Math.max(3, level * 1.1) * role.damage)),
			attack: Math.max(1, Math.round(level * role.accuracy)), defence: Math.max(1, Math.round(level * role.defence)),
			interval: role.interval, effect: selection.tier.tier >= 2 ? role.effect : undefined };
	});
}
export const PRACTICE_EFFECT_COPY: Partial<Record<EffectID, string>> = {
	poison: 'On a successful hit: 35% chance to poison. Deals 1% of maximum HP every 0.5 seconds for 5 seconds.',
	bleed: 'On a successful hit: 35% chance to bleed. Your next two attacks each cause damage equal to 10% of your current maximum hit.',
	slow: 'On a successful hit: 35% chance to slow. Attack speed is reduced by 25% for your next two attacks. Eating remains available.'
};
