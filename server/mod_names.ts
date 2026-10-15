import { KNOWN_MODS, LEGACY_INTERDICT_MOD_IDS } from './active-mods';

// Translation preserves current and historical cheat-mod titles, independently of current enforcement.
export const CHEAT_MOD_NAMES = new Set(KNOWN_MODS.filter(mod => mod.cheat || LEGACY_INTERDICT_MOD_IDS.includes(mod.id)).map(mod => mod.name));
