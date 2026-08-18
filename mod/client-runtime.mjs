export const MAX_ACTIVE_MOD_COUNT = 128;
export const MAX_ACTIVE_MOD_NAME_LENGTH = 128;
export const MAX_GAME_MODE_ID_LENGTH = 256;

export function normalize_active_mod_names(loaded) {
	if (!Array.isArray(loaded))
		return [];

	const names = [];
	const seen = new Set();
	for (const value of loaded) {
		if (typeof value !== 'string')
			continue;
		const name = value.trim().slice(0, MAX_ACTIVE_MOD_NAME_LENGTH);
		if (name.length === 0 || seen.has(name))
			continue;
		seen.add(name);
		names.push(name);
		if (names.length === MAX_ACTIVE_MOD_COUNT)
			break;
	}
	return names;
}

export function get_game_mode_id(gamemode) {
	const id = gamemode?.id;
	return typeof id === 'string' && id.length <= MAX_GAME_MODE_ID_LENGTH &&
		/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(id)
		? id
		: null;
}

export function make_client_runtime_report(mod_version, active_mods, game_mode_id) {
	const report = {
		mod_version,
		active_mods: [...active_mods]
	};
	if (game_mode_id !== null && game_mode_id !== undefined)
		report.game_mode_id = game_mode_id;
	return report;
}

function parse_release_version(version) {
	if (typeof version !== 'string')
		return null;
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (match === null)
		return null;
	const parts = match.slice(1).map(Number);
	return parts.every(Number.isSafeInteger) ? parts : null;
}

export function is_mod_version_outdated(current_version, released_version) {
	const current = parse_release_version(current_version);
	const released = parse_release_version(released_version);
	if (current === null || released === null)
		return false;
	for (let index = 0; index < current.length; index++) {
		if (current[index] !== released[index])
			return current[index] < released[index];
	}
	return false;
}
