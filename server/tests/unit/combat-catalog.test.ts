import { test, expect } from 'bun:test';
import { COMBAT_CATALOG, parse_registration, registration_stats } from '../../combat/catalog';
const levels = { attack: 99, strength: 99, defence: 99, hitpoints: 99 };
test('canonical admission rejects modded, effect-bearing, DLC and wrong-slot equipment', () => {
	for (const id of ['mod:Bronze_Sword', 'melvorD:Ancient_Sword', 'melvorF:Dragon_Sword', '__proto__'])
		expect(parse_registration({ levels, gear: { Weapon: id } })).toBeNull();
	expect(parse_registration({ levels, gear: { Helmet: 'melvorD:Bronze_Sword' } })).toBeNull();
	expect(parse_registration({ levels, gear: { Weapon: 'melvorD:Bronze_2H_Sword', Shield: 'melvorD:Bronze_Shield' } })).toBeNull();
	expect(parse_registration({ levels: { ...levels, attack: 1 }, gear: { Weapon: 'melvorD:Rune_Sword' } })).toBeNull();
});
test('levels cap at 99, canonical gear changes stats and food uses standard tenfold HP', () => {
	const registered = parse_registration({ levels: { ...levels, attack: 999 }, gear: { Weapon: 'melvorD:Bronze_Sword' }, max_hit: 999999 })!;
	expect(registered.levels.attack).toBe(99);
	expect(registration_stats(registered)).toEqual({
		attack_type: 'melee', interval: 2400, min_hit: 1, max_hit: 130, accuracy: 8322,
		evasion: { melee: 6912, ranged: 6912, magic: 2496 }, resistance: 0
	});
	expect(registration_stats(registered, 'aggressive').max_hit).toBe(136);
	expect(registration_stats(registered, 'defensive').evasion.melee).toBe(7296);
	expect(COMBAT_CATALOG.items['melvorD:Shrimp'].heal).toBe(30);
	expect(COMBAT_CATALOG.items['melvorD:Potatoes'].heal).toBe(3);
});

test('upgrading only Bronze Gloves to Iron preserves native one-point gear improvements', () => {
	const bronze = registration_stats({ levels, gear: { Weapon: 'melvorD:Bronze_Dagger', Gloves: 'melvorD:Bronze_Gloves' } });
	const iron = registration_stats({ levels, gear: { Weapon: 'melvorD:Bronze_Dagger', Gloves: 'melvorD:Iron_Gloves' } });
	// Only the gloves change: native +1 attack, strength and melee defence bonuses.
	expect(bronze.accuracy).toBe(8322);
	expect(iron.accuracy).toBe(8436);
	expect(bronze.max_hit).toBe(130);
	expect(iron.max_hit).toBe(131);
	expect(bronze.evasion.melee).toBe(7128);
	expect(iron.evasion.melee).toBe(7236);
});

test('every supported ordinary Bronze through Rune item admits at capped Online levels', () => {
	const equipment = Object.entries(COMBAT_CATALOG.items).filter(([, item]) => item.supported && item.slots && !item.name.startsWith('Wooden '));
	expect(equipment).toHaveLength(66);
	for (const [id, item] of equipment) {
		const registered = parse_registration({ levels, gear: { [item.slots![0]]: id } });
		expect(registered).not.toBeNull();
		const stats = registration_stats(registered!);
		expect(Number.isFinite(stats.accuracy)).toBe(true);
		expect(Number.isSafeInteger(stats.max_hit)).toBe(true);
	}
});
