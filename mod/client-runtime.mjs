export const MAX_ACTIVE_MOD_COUNT = 128;
export const MAX_ACTIVE_MOD_NAME_LENGTH = 128;
export const MAX_GAME_MODE_ID_LENGTH = 256;
export const MAX_LANGUAGE_LENGTH = 64;
export const OWNED_DLC_NAMESPACES = Object.freeze(['melvorTotH', 'melvorAoD', 'melvorItA']);

const LANGUAGE_LANG_IDS = Object.freeze({
	en: 'MOD_MP_LANGUAGE_EN',
	'zh-CN': 'MOD_MP_LANGUAGE_ZH_CN',
	'zh-TW': 'MOD_MP_LANGUAGE_ZH_TW',
	fr: 'MOD_MP_LANGUAGE_FR',
	de: 'MOD_MP_LANGUAGE_DE',
	pt: 'MOD_MP_LANGUAGE_PT',
	'pt-br': 'MOD_MP_LANGUAGE_PT_BR',
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

// Check the complete loaded list, independently of the bounded server report or mod privacy.
export function queue_mod_conflict_notice(loaded, text, queue, document, own_name) {
	const others = Array.isArray(loaded) ? [...loaded] : [];
	// Melvor preserves duplicate names in loadedList; exclude exactly our own entry.
	const own_index = others.indexOf(own_name);
	if (own_index !== -1) others.splice(own_index, 1);
	const names = new Set(others.filter(name => typeof name === 'string').map(name => name.trim()));
	const conflicts = ['Melvor Multiplayer', '[Galy] Melvor Multiplayer Fixes'].filter(name => names.has(name));
	if (conflicts.length === 0) return false;
	const content = document.createElement('div');
	content.style.marginBottom = '1rem';
	const message = document.createElement('p');
	message.textContent = text(conflicts.length === 1 ? 'MOD_MP_MOD_CONFLICT_SINGLE' : 'MOD_MP_MOD_CONFLICT_MULTIPLE');
	const list = document.createElement('ul');
	list.style.textAlign = 'left';
	for (const name of conflicts) {
		const item = document.createElement('li');
		item.textContent = name;
		list.append(item);
	}
	content.append(message, list);
	queue({ titleText: text('MOD_MP_MOD_CONFLICT_TITLE'), html: content, icon: 'warning',
		confirmButtonText: text('MOD_MP_MOD_CONFLICT_OKAY'), showConfirmButton: true,
		allowOutsideClick: false, allowEscapeKey: false });
	return true;
}

// Resolve only successfully loaded names against the active profile's installed records.
// Local imports and collisions deliberately keep their name-only identity.
export function resolve_active_mod_details(loaded, profile_ids, installed = [], local = []) {
	const names = normalize_active_mod_names(loaded);
	const ids = new Set(Array.isArray(profile_ids) ? profile_ids.filter(id => Number.isSafeInteger(id) && id > 0) : []);
	const local_names = new Set(local.map(mod => mod?.name?.trim()));
	return names.map(name => {
		const matches = installed.filter(mod => ids.has(mod.id) && mod.name?.trim() === name);
		const repeated = loaded.filter(value => typeof value === 'string' && value.trim() === name).length > 1;
		return { name, id: !repeated && !local_names.has(name) && matches.length === 1 ? matches[0].id : null };
	});
}

// Melvor ?12097 stores published mods in melvordb.mods and Toolkit imports in localMods.
// Read existing stores only; abort any attempted creation/upgrade. No network or storage writes.
export async function capture_active_mod_details(loaded, profile_ids, indexed_db = undefined) {
	const fallback = () => resolve_active_mod_details(loaded, []);
	try {
		if (indexed_db === undefined) indexed_db = globalThis.indexedDB;
		if (!indexed_db || !Array.isArray(profile_ids) || profile_ids.length > 128) return fallback();
		const metadata = await new Promise((resolve, reject) => {
			let database;
			let transaction;
			let finished = false;
			const finish = (error, value) => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				if (error) { try { transaction?.abort(); } catch {} }
				database?.close();
				error ? reject(error) : resolve(value);
			};
			const timer = setTimeout(() => finish(new Error('Mod metadata timed out')), 1500);
			let request;
			try { request = indexed_db.open('melvordb'); }
			catch (error) { finish(error); return; }
			request.onupgradeneeded = () => request.transaction.abort();
			request.onerror = () => finish(new Error('Mod metadata unavailable'));
			request.onblocked = () => finish(new Error('Mod metadata blocked'));
			request.onsuccess = () => {
				database = request.result;
				if (finished) { database.close(); return; }
				try {
					transaction = database.transaction(['mods', 'localMods'], 'readonly');
					const installed = [];
					const local = [];
					for (const id of new Set(profile_ids.filter(id => Number.isSafeInteger(id) && id > 0))) {
						const get = transaction.objectStore('mods').get(id);
						get.onsuccess = () => { if (get.result) installed.push({ id: get.result.id, name: get.result.name }); };
					}
					const cursor = transaction.objectStore('localMods').openCursor();
					cursor.onsuccess = () => {
						const entry = cursor.result;
						if (!entry) return;
						if (local.length >= 512) { finish(new Error('Too many local mods')); return; }
						local.push({ name: entry.value.name });
						entry.continue();
					};
					transaction.oncomplete = () => finish(null, { installed, local });
					transaction.onerror = transaction.onabort = () => finish(new Error('Mod metadata read failed'));
				} catch (error) { finish(error); }
			};
		});
		return resolve_active_mod_details(loaded, profile_ids, metadata.installed, metadata.local);
	} catch { return fallback(); }
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

export function get_owned_dlc(cloud_manager) {
	const owned_dlc = [];
	if (cloud_manager?.hasTotHEntitlementAndIsEnabled === true)
		owned_dlc.push('melvorTotH');
	if (cloud_manager?.hasAoDEntitlementAndIsEnabled === true)
		owned_dlc.push('melvorAoD');
	if (cloud_manager?.hasItAEntitlementAndIsEnabled === true)
		owned_dlc.push('melvorItA');
	return owned_dlc;
}

export function make_client_runtime_report(mod_version, active_mods, game_mode_id, language = null, device = null, owned_dlc = [], active_mod_details = undefined) {
	const report = {
		mod_version,
		active_mods: [...active_mods],
		owned_dlc: [...owned_dlc],
		capabilities: ['save-rollback-v1']
	};
	if (active_mod_details !== undefined)
		report.active_mod_details = active_mod_details.map(mod => ({ ...mod }));
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

export function is_mod_version_unsupported(current_version, minimum_supported_version) {
	const feature_version = parse_release_version('1.5.10');
	const current = parse_release_version(current_version);
	const minimum = parse_release_version(minimum_supported_version);
	if (current === null || minimum === null)
		return false;
	const compare = (left, right) => {
		for (let index = 0; index < left.length; index++) {
			if (left[index] !== right[index]) return left[index] - right[index];
		}
		return 0;
	};
	return compare(current, feature_version) >= 0 && compare(current, minimum) < 0;
}
