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
	return BASE_GAME_MODES[game_mode_id] ?? null;
}

export function resolve_game_mode(game_mode_id, find_game_mode, unknown_name = 'Unknown Mode') {
	const base_mode = get_base_game_mode(game_mode_id);
	if (base_mode !== null)
		return { ...base_mode, is_modded: false };

	const local_mode = typeof game_mode_id === 'string' && typeof find_game_mode === 'function'
		? find_game_mode(game_mode_id)
		: null;
	const local_name = typeof local_mode?.name === 'string' ? local_mode.name.trim() : '';
	return {
		name: local_name || unknown_name,
		media: QUESTION_MEDIA,
		is_modded: true
	};
}
