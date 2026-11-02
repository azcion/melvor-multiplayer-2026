import { search } from './search.mjs';
const navigation = document.querySelector('.mobile-navigation');
const desktop = window.matchMedia('(min-width: 801px)');
navigation.open = desktop.matches;
desktop.addEventListener('change', event => { navigation.open = event.matches; });
navigation.addEventListener('click', event => {
	if (!desktop.matches && event.target.closest('a')) navigation.open = false;
});
navigation.addEventListener('keydown', event => {
	if (event.key === 'Escape' && !desktop.matches && navigation.open) {
		event.preventDefault(); navigation.open = false; navigation.querySelector('summary').focus();
	}
});
const input = document.querySelector('#wiki-search');
const form = input.form;
const clear = document.querySelector('#clear-search');
const view = document.querySelector('#search-view');
const content = document.querySelector('#page-content');
const results = document.querySelector('#search-results');
const status = document.querySelector('#search-status');
let index, generation = 0;
function element(tag, class_name, text) {
	const node = document.createElement(tag);
	if (class_name) node.className = class_name;
	if (text) node.textContent = text;
	return node;
}
async function update({history = true} = {}) {
	const current = ++generation, query = input.value.trim();
	if (history) {
		const url = new URL(location.href);
		if (query) url.searchParams.set('q',query); else url.searchParams.delete('q');
		window.history.replaceState(null,'',url);
	}
	clear.hidden = !query; view.hidden = !query; content.hidden = !!query;
	results.replaceChildren();
	if (!query) { status.textContent = ''; return; }
	status.textContent = 'Searching the handbook…';
	try {
		index ??= fetch('/wiki/assets/search-index.json').then(response => {
			if (!response.ok) throw new Error('Search unavailable');
			return response.json();
		}).catch(error => { index = undefined; throw error; });
		const documents = await index;
		if (current !== generation) return;
		const matches = search(documents,query);
		status.textContent = matches.length ? `${matches.length} ${matches.length === 1 ? 'guide' : 'guides'} found.` : 'No guides found. Try a feature name, a shorter phrase, or browse the categories.';
		for (const document of matches) {
			const card = element('a','article-card'); card.href = document.url;
			card.append(element('span','eyebrow',document.category),element('h2','',document.title),element('p','',document.summary));
			results.append(card);
		}
	} catch {
		if (current === generation) status.textContent = 'Search could not load. Try again or clear search to browse the handbook.';
	}
}
input.addEventListener('input',() => update());
form.addEventListener('submit',event => { event.preventDefault(); update(); });
form.addEventListener('reset',event => { event.preventDefault(); input.value = ''; update(); input.focus(); });
document.addEventListener('keydown',event => {
	if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) {
		event.preventDefault(); input.focus();
	}
	if (event.key === 'Escape' && document.activeElement === input && input.value) {
		event.preventDefault(); input.value = ''; update();
	}
});
window.addEventListener('popstate',() => { input.value = (new URL(location.href).searchParams.get('q') ?? '').slice(0,160); update({history:false}); });
input.value = (new URL(location.href).searchParams.get('q') ?? '').slice(0,160);
if (input.value) update({history:false});
