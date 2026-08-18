export const MULTIPLAYER_PAGE_LANG_IDS = Object.freeze({
	Chat: 'MOD_MP_PAGE_CHAT',
	Guild: 'MOD_MP_PAGE_GUILD',
	Transfer_Items: 'MOD_MP_PAGE_TRANSFER_ITEMS',
	Multiplayer_Market: 'MOD_MP_PAGE_MARKET',
	Charity_Tree: 'MOD_MP_PAGE_CHARITREE',
	Campaign_Effort: 'MOD_MP_PAGE_CAMPAIGN',
	Guild_Raid: 'MOD_MP_PAGE_RAID'
});

export const MULTIPLAYER_SUPPORTED_LANGUAGES = Object.freeze(['en', 'zh-CN']);

export function resolve_multiplayer_language(lang) {
	return MULTIPLAYER_SUPPORTED_LANGUAGES.includes(lang) ? lang : 'en';
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
		await load_mod_language(lang, language);
		return language;
	};
}
