// Summary and wiki slug for each Multiplayer page that has a guide.
const guide = (page_id, icon, title_lang, lang_prefix, wiki_slug) => ({
	page_id, icon, title_lang, wiki_slug,
	summary_lang: `MOD_MP_GUIDE_${lang_prefix}_SUMMARY`,
	how_to_lang: `MOD_MP_GUIDE_${lang_prefix}_HOW_TO`
});

export const PAGE_GUIDES = Object.freeze([
	guide('mp-guild-page', 'assets/multiplayer.svg', 'MOD_MP_PAGE_GUILD', 'GUILD', 'guild-life'),
	guide('mp-transfer-page', 'assets/transfer_bag.svg', 'MOD_MP_PAGE_TRANSFER_ITEMS', 'TRANSFERS', 'transfers'),
	guide('mp-market-page', 'assets/market.svg', 'MOD_MP_PAGE_MARKET', 'MARKET', 'marketplace'),
	guide('mp-crucible-page', 'assets/crucible.png', 'MOD_MP_PAGE_CRUCIBLE', 'CRUCIBLE', 'crucible'),
	guide('mp-expedition-page', 'assets/expedition-nav.png', 'MOD_MP_PAGE_EXPEDITION', 'EXPEDITION', 'expedition'),
	guide('mp-raid-page', 'assets/raid-nav.png', 'MOD_MP_PAGE_RAID', 'RAID', 'raids'),
	guide('mp-combat-page', 'assets/colosseum.png', 'MOD_MP_PAGE_COMBAT', 'COMBAT', '')
]);

export function get_wiki_page_url(wiki_url, wiki_slug) {
	try {
		const url = new URL(wiki_url);
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !wiki_slug) return null;
		// Append within the advertised base path, retaining its query and fragment.
		url.pathname = `${url.pathname.replace(/\/+$/, '')}/${wiki_slug}/`;
		return url.href;
	} catch { return null; }
}

export function find_visible_page_guide(get_element) {
	return PAGE_GUIDES.find(entry => {
		const page = get_element(entry.page_id);
		return page && !page.classList.contains('d-none');
	}) ?? null;
}

export function install_page_guide_actions({ state, queue_modal, get_element = id => document.getElementById(id),
	openLink = globalThis.openLink }) {
	return {
		page_guide: null,
		show_page_guide() {
			const entry = find_visible_page_guide(get_element);
			if (!entry) return;
			state.page_guide = entry;
			queue_modal(entry.title_lang, 'page-guide-modal', entry.icon, { showConfirmButton: false },
				true, !entry.icon.startsWith('https:'));
		},
		open_page_guide_wiki() {
			const url = state.page_guide && get_wiki_page_url(state.wiki_url, state.page_guide.wiki_slug);
			if (url && typeof openLink === 'function') openLink(url);
		}
	};
}

// Clone the game's header link once; CSS controls which pages expose it.
export function setup_page_guide_button({ document, state, getLangString }) {
	const existing = document.getElementById('mp-page-guide-link');
	if (existing) {
		(existing.querySelector('.mp-page-guide-label') ?? existing).textContent = getLangString('MOD_MP_GUIDE_BUTTON');
		return;
	}
	const native_link = document.getElementById('game-guide-header-link');
	if (!native_link) return;
	const link = native_link.cloneNode(true);
	const label = link.querySelector('#game-guide-header-span') ?? link;
	label.textContent = getLangString('MOD_MP_GUIDE_BUTTON');
	label.classList.add('mp-page-guide-label');
	for (const child of link.querySelectorAll('[id]')) child.removeAttribute('id');
	link.id = 'mp-page-guide-link';
	link.classList.remove('d-none');
	link.classList.add('mp-page-guide-link');
	link.removeAttribute('onclick');
	link.addEventListener('click', event => {
		event.preventDefault();
		state.show_page_guide();
	});
	native_link.after(link);
}
