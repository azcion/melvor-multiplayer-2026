const QUESTION_MEDIA = 'assets/media/main/question.png';

const BASE_GAME_MODES = Object.freeze({
	'melvorD:Standard': Object.freeze({
		name: 'Standard Mode',
		media: 'assets/media/skills/combat/combat.png'
	}),
	'melvorF:Hardcore': Object.freeze({
		name: 'Hardcore Mode',
		media: 'assets/media/main/hardcore.png'
	}),
	'melvorF:Adventure': Object.freeze({
		name: 'Adventure Mode',
		media: 'assets/media/main/adventure.png'
	}),
	'melvorAoD:AncientRelics': Object.freeze({
		name: 'Ancient Relics Mode',
		media: 'assets/media/main/gamemode_ancient_relic.png'
	})
});

export function get_base_game_mode(game_mode_id) {
	return Object.hasOwn(BASE_GAME_MODES, game_mode_id) ? BASE_GAME_MODES[game_mode_id] : null;
}

// Fallbacks work even when the viewer has not installed the other player's mod.
const MODDED_GAME_MODES = Object.freeze({
	'hcco:hcco': { name: 'Hardcore Combat Only', asset: 'gamemode_hcco.png' },
	'hcco:mcco': { name: 'Mediumcore Combat Only', asset: 'gamemode_mcco.png' },
	'hcco:rehcco': { name: 'Rebalance Hardcore Combat Only', asset: 'gamemode_hrco.png' },
	'hcco:remcco': { name: 'Rebalance Mediumcore Combat Only', asset: 'gamemode_rmco.png' },
	'RandomAdventure:RandomAdventure': { name: 'Randomized Adventure Mode', asset: 'gamemode_randomized_adventure.png' },
	'taskman:Taskman': { name: 'Taskman', asset: 'gamemode_taskman.svg' },
	'gamemodesbyphoenix:adventurenoxpcap': { name: 'Phoenix Adventure Mode', asset: 'gamemode_phoenix.png' },
	'phoenixgamemodemanager:BirthdayMode': { name: 'Phoenix Birthday Mode', asset: 'gamemode_phoenix.png' }
});

export function get_known_game_mode(game_mode_id, get_resource_url = path => path) {
	const base_mode = get_base_game_mode(game_mode_id);
	if (base_mode !== null)
		return { ...base_mode, is_modded: false };
	const modded_mode = Object.hasOwn(MODDED_GAME_MODES, game_mode_id) ? MODDED_GAME_MODES[game_mode_id] : null;
	return modded_mode === null ? null : {
		name: modded_mode.name,
		media: get_resource_url('assets/' + modded_mode.asset),
		is_modded: true
	};
}

export function resolve_game_mode(game_mode_id, find_game_mode, unknown_name = 'Unknown Mode', get_resource_url) {
	const known_mode = get_known_game_mode(game_mode_id, get_resource_url);
	if (known_mode !== null)
		return known_mode;

	const local_mode = typeof game_mode_id === 'string' && typeof find_game_mode === 'function'
		? find_game_mode(game_mode_id)
		: null;
	const local_name = typeof local_mode?.name === 'string' ? local_mode.name.trim() : '';
	const local_media = typeof local_mode?.media === 'string' ? local_mode.media.trim() : '';
	return {
		name: local_name || unknown_name,
		media: local_media || QUESTION_MEDIA,
		is_modded: true
	};
}

// Send matching IDs so the server can filter before pagination using viewer-known names.
export function search_game_mode_ids(search, installed_modes = []) {
	const query = search.toLowerCase();
	if (!query) return [];
	const matches = new Set();
	for (const [id, mode] of [...Object.entries(BASE_GAME_MODES), ...Object.entries(MODDED_GAME_MODES)]) {
		if (mode.name.toLowerCase().includes(query)) matches.add(id);
	}
	for (const mode of installed_modes) {
		if (typeof mode?.id === 'string' && typeof mode?.name === 'string' && mode.name.toLowerCase().includes(query))
			matches.add(mode.id);
	}
	return [...matches].slice(0, 128);
}
