import { KNOWN_MODS } from './active-mods';

// Shared exact title registry for translation; detection also recognizes stable IDs.
export const CHEAT_MOD_NAMES = new Set(KNOWN_MODS.filter(mod => mod.cheat).map(mod => mod.name));
