import { matches_mod } from './mod-filter.mjs';
const lookup = document.querySelector('#mod-lookup');
if (lookup) {
	const form = lookup.querySelector('form');
	const query = lookup.querySelector('#mod-query');
	const category = lookup.querySelector('#mod-category');
	const cards = [...lookup.querySelectorAll('.mod-card')];
	const status = lookup.querySelector('#mod-status');
	const empty = lookup.querySelector('#mod-empty');
	function update() {
		let count = 0;
		for (const card of cards) {
			const match = matches_mod(card.dataset.search,card.dataset.tags.split(' '),query.value,category.value);
			card.hidden = !match; count += Number(match);
		}
		status.textContent = `${count} of ${cards.length} listed mods shown.`;
		empty.hidden = count !== 0;
		const url = new URL(location.href);
		for (const [key,value] of [['mod',query.value.trim()],['tag',category.value]]) {
			if (value) url.searchParams.set(key,value); else url.searchParams.delete(key);
		}
		history.replaceState(null,'',url);
	}
	function restore() {
		const url = new URL(location.href);
		query.value = (url.searchParams.get('mod') ?? '').slice(0,160);
		category.value = [...category.options].some(o => o.value === url.searchParams.get('tag')) ? url.searchParams.get('tag') : '';
		update();
	}
	form.hidden = false;
	query.addEventListener('input',update); category.addEventListener('change',update);
	form.addEventListener('submit',event => { event.preventDefault(); update(); });
	form.addEventListener('reset',event => { event.preventDefault(); query.value = ''; category.value = ''; update(); query.focus(); });
	window.addEventListener('popstate',restore);
	restore();
}
