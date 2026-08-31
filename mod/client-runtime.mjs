export const MAX_ACTIVE_MOD_COUNT = 128;
export const MAX_ACTIVE_MOD_NAME_LENGTH = 128;
export const MAX_GAME_MODE_ID_LENGTH = 256;
export const MAX_LANGUAGE_LENGTH = 64;

const LANGUAGE_LANG_IDS = Object.freeze({
	en: 'MOD_MP_LANGUAGE_EN',
	'zh-CN': 'MOD_MP_LANGUAGE_ZH_CN',
	'zh-TW': 'MOD_MP_LANGUAGE_ZH_TW',
	fr: 'MOD_MP_LANGUAGE_FR',
	de: 'MOD_MP_LANGUAGE_DE',
	pt: 'MOD_MP_LANGUAGE_PT',
	'pt-BR': 'MOD_MP_LANGUAGE_PT_BR',
	it: 'MOD_MP_LANGUAGE_IT',
	ko: 'MOD_MP_LANGUAGE_KO',
	ja: 'MOD_MP_LANGUAGE_JA',
	es: 'MOD_MP_LANGUAGE_ES',
	ru: 'MOD_MP_LANGUAGE_RU',
	tr: 'MOD_MP_LANGUAGE_TR'
});

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

export function get_language_code(language) {
	return typeof language === 'string' && language.length <= MAX_LANGUAGE_LENGTH ? language : null;
}

export function get_language_lang_id(language) {
	return typeof language === 'string' && Object.hasOwn(LANGUAGE_LANG_IDS, language)
		? LANGUAGE_LANG_IDS[language]
		: null;
}

export function make_client_runtime_report(mod_version, active_mods, game_mode_id, language = null, device = null) {
	const report = {
		mod_version,
		active_mods: [...active_mods]
	};
	if (game_mode_id !== null && game_mode_id !== undefined)
		report.game_mode_id = game_mode_id;
	if (language !== null && language !== undefined)
		report.language = language;
	if (device !== null)
		report.device = device;
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
