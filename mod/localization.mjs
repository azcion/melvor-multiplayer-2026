export const MULTIPLAYER_PAGE_LANG_IDS = Object.freeze({
	Chat: 'MOD_MP_PAGE_CHAT',
	Guild: 'MOD_MP_PAGE_GUILD',
	Transfer_Items: 'MOD_MP_PAGE_TRANSFER_ITEMS',
	Multiplayer_Market: 'MOD_MP_PAGE_MARKET',
	Crucible: 'MOD_MP_PAGE_CRUCIBLE',
	Expedition: 'MOD_MP_PAGE_EXPEDITION',
	Guild_Raid: 'MOD_MP_PAGE_RAID',
	Updates: 'MOD_MP_PAGE_UPDATES'
});

export const MULTIPLAYER_SUPPORTED_LANGUAGES = Object.freeze(['en', 'zh-CN', 'zh-TW', 'fr', 'de', 'pt', 'pt-br', 'it', 'ko', 'ja', 'es', 'ru', 'tr']);

export function resolve_multiplayer_language(lang) {
	return MULTIPLAYER_SUPPORTED_LANGUAGES.includes(lang) ? lang : 'en';
}

export function localize_raid_content({ game, getLangString }) {
	const localize = (object, property, value) => {
		if (object)
			Object.defineProperty(object, property, { configurable: true, get: value });
	};
	const format = (key, ...args) => {
		let index = 0;
		return getLangString('MOD_MP_RAID_' + key).replace(/%s/g, () => String(args[index++]));
	};
	localize(game.combatAreas.getObjectByID('multiplayer:Guild_Raid'), 'name', () => getLangString('MOD_MP_PAGE_RAID'));
	for (const tier of [1, 2, 3, 4]) {
		localize(game.monsters.getObjectByID(`multiplayer:Raid_Tier_${tier}`), 'name', () => format('BOSS_' + tier));
		for (const [suffix, key] of [['FullDamage', 'FULL_HEALTH_STRIKE'], ['ReducedDamage', 'FOLLOW_UP_STRIKE']])
			localize(game.combatEffects.getObjectByID(`multiplayer:Raid_Tier_${tier}_${suffix}`), 'name', () => format(key, tier));
		for (const suffix of ['', '_ItA']) {
			const attack = game.specialAttacks.getObjectByID(`multiplayer:Raid_Tier_${tier}_Assault${suffix}`);
			if (!attack)
				continue;
			localize(attack, 'name', () => format('ATTACK_NAME'));
			localize(attack, 'description', () => {
				const effects = attack.onhitEffects
					.filter(applicator => !applicator.effect.id.startsWith('multiplayer:'))
					.map(applicator => applicator.effect.name);
				let description = format('ATTACK_DESCRIPTION', [15, 25, 33, 40][tier - 1], effects.join(', '));
				if (tier >= 3 && suffix === '') {
					const laceration = game.combatEffects.getObjectByID('melvorItA:Laceration');
					const curse = game.combatEffects.getObjectByID('melvorItA:EldritchCurse');
					if (laceration && (tier === 3 || curse))
						description += ' ' + (tier === 3 ? format('ABYSS_LACERATION', laceration.name)
							: format('ABYSS_CURSE', laceration.name, curse.name));
				}
				return description;
			});
			localize(attack, 'modifiedDescription', () => attack.description);
		}
	}
	for (const [id, key] of [['Fortified', 'FORTIFICATION'], ['Vulnerable', 'VULNERABILITY']])
		localize(game.combatEffects.getObjectByID('multiplayer:Raid_Boss_' + id), 'name', () => format(key));
}

export function localize_multiplayer_page_names({ game, sidebar, getLangString, createElement }) {
	const multiplayer_category = sidebar.category('Multiplayer');
	for (const [page_id, lang_id] of Object.entries(MULTIPLAYER_PAGE_LANG_IDS)) {
		const page = game.pages.getObjectByID('multiplayer:' + page_id);
		if (!page)
			continue;

		Object.defineProperty(page, 'name', {
			configurable: true,
			get: () => getLangString(lang_id)
		});

		const nav_item = multiplayer_category.item(page.id);
		if (nav_item.nameEl)
			nav_item.nameEl.replaceChildren(createElement('lang-string', {
				attributes: [['lang-id', lang_id]]
			}));
	}
}

export function create_localized_language_fetch(base_fetch, load_mod_language) {
	return async lang => {
		const language = await base_fetch(lang);
		await load_mod_language('en', language);
		if (lang !== 'en')
			await load_mod_language(lang, language);
		return language;
	};
}
