import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Read an unmodified official Demo JSON download, never a modded game's registry.
export function build_combat_catalog(bytes) {
	const data = JSON.parse(bytes);
	if (data.namespace !== 'melvorD' || !Array.isArray(data.data?.items) || data.modifications?.items?.length)
		throw new Error('Expected official Demo item data without unresolved item modifications');
	const tiers = ['Bronze', 'Iron', 'Steel', 'Mithril', 'Adamant', 'Rune'];
	const pieces = ['Dagger', 'Sword', 'Scimitar', 'Battleaxe', '2H_Sword', 'Helmet', 'Boots', 'Platelegs', 'Platebody', 'Shield', 'Gloves'];
	const items = {};
	for (const item of data.data.items) {
		const effect = ['modifiers', 'conditionalModifiers', 'specialAttacks', 'combatEffects', 'consumesOn', 'consumesChargesOn', 'consumesItemOn', 'providedRunes'].some(key => item[key] && Object.keys(item[key]).length);
		const arrows = tiers.some(tier => item.id === `${tier}_Arrows`);
		const equipment = tiers.some(tier => pieces.some(piece => item.id === `${tier}_${piece}`));
		const supported = !item.golbinRaidExclusive && !effect && (item.itemType === 'Food' && item.healsFor > 0 || equipment);
		items[`melvorD:${item.id}`] = { name: item.name, kind: item.itemType, supported,
			...(supported && item.itemType === 'Food' ? { heal: Math.round(item.healsFor * 10) } : {}),
			...(arrows && !effect && !item.golbinRaidExclusive ? { project_supported: true } : {}),
			...((equipment && supported || arrows) ? { slots: item.validSlots, occupies: item.occupiesSlots ?? [],
				requirements: item.equipRequirements ?? [], stats: item.equipmentStats ?? [] } : {}) };
	}
	return { version: 1, source: 'https://melvoridle.com/assets/data/melvorDemo.json',
		sha256: createHash('sha256').update(bytes).digest('hex'), hp_multiplier: 10, items };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
	const [input, output] = process.argv.slice(2);
	if (!input || !output) throw new Error('Usage: node scripts/build-combat-catalog.mjs official-demo.json catalog.json');
	writeFileSync(output, JSON.stringify(build_combat_catalog(readFileSync(input)), null, '\t') + '\n');
}
