export type ActiveMod = { id: number | null; name: string };

// Verified against public mod.io game 2869 metadata on 2026-10-11.
// These policy aliases are curated, never learned from player assertions.
export const KNOWN_MODS = [
	{ id: 2429395, name: 'Add Items', cheat: true },
	{ id: 5562948, name: 'God Mode', cheat: true },
	{ id: 2253095, name: 'dev.Console', cheat: true },
	{ id: 5377900, name: '[Creative Mode] God mode w/ Loot + XP Multipliers', cheat: true },
	{ id: 5964319, name: 'Melvor Cheat Suite', cheat: true },
	{ id: 6379230, name: 'Cheat Chest', cheat: true },
	{ id: 6419494, name: 'Universal Item Spawner', cheat: true },
	{ id: 2479713, name: 'Loot Chests', cheat: true },
	{ id: 5043199, name: 'SUPER AWESOME EXPANSION', aliases: ['Super Awesome Expansion!'], cheat: false }
];

export function known_mod_by_name(name: string) {
	return KNOWN_MODS.find(mod => mod.name === name || mod.aliases?.includes(name));
}

// Keep the legacy names authoritative for membership in the successfully loaded list.
// Optional/malformed ID metadata must never prevent authentication.
export function resolve_active_mods(names: string[], details: unknown, previous: ActiveMod[] = []): ActiveMod[] {
	const candidates = Array.isArray(details) && details.length <= 128 ? details : [];
	return names.map(name => {
		const matches = candidates.filter(value => value && value.name === name);
		if (matches.length > 0) {
			const ids = new Set(matches.map(value => value.id));
			const id = ids.size === 1 ? matches[0].id : null;
			// Explicit null means a local/ambiguous mod: do not invent a published ID.
			return { name, id: Number.isSafeInteger(id) && id > 0 ? id : null };
		}
		const prior = previous.filter(mod => mod.name === name && mod.id !== null);
		const ids = new Set(prior.map(mod => mod.id));
		return { name, id: ids.size === 1 ? prior[0].id : known_mod_by_name(name)?.id ?? null };
	});
}

export function matches_active_mod(mod: ActiveMod, id: number | null, name: string): boolean {
	if (id !== null && mod.id !== null) return mod.id === id;
	return mod.name === name || (id !== null && known_mod_by_name(mod.name)?.id === id);
}

export function stored_active_mods(names_json: string, details_json: string): ActiveMod[] {
	return resolve_active_mods(JSON.parse(names_json), JSON.parse(details_json));
}
