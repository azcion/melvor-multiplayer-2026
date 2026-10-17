import { discover_media_root, resolve_items } from './resolve.mjs';
const upstream = 'https://steam.melvoridle.com/';
const paths = { items: 'assets/data/melvorDemo.json', assets: 'assets/js/built/assets.js', en: 'lang/en.json', de: 'lang/de.json', 'zh-CN': 'lang/zh-CN.json' };
const $ = id => document.getElementById(id);
let items = [], selected = null, data_package, media_root, mode;
let language_generation = 0;
let loaded_images = 0, failed_images = 0;

async function read_source(key, direct = false) {
	const url = direct ? new URL(paths[key], upstream) : `/source?key=${encodeURIComponent(key)}`;
	const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(25_000) });
	if (!response.ok) throw new Error(`${key}: HTTP ${response.status}`);
	return key === 'assets' ? response.text() : response.json();
}
function image(item) {
	const img = document.createElement('img');
	img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
	const report = () => { $('image-status').textContent = `Artwork requests: ${loaded_images} loaded · ${failed_images} failed (includes repeated previews).`; };
	img.addEventListener('load', () => { loaded_images++; report(); });
	img.addEventListener('error', () => { failed_images++; img.hidden = true; report(); });
	if (item.media) img.src = item.media;
	return img;
}
function chip(item) {
	const tag = document.createElement('span'); tag.className = 'chip'; tag.title = item.id;
	tag.append(image(item), document.createTextNode(item.name)); return tag;
}
function message(author, text, item) {
	const row = document.createElement('div'); row.className = 'message';
	const name = document.createElement('div'); name.className = 'author'; name.textContent = author;
	const body = document.createElement('div'); body.className = 'body'; body.textContent = text;
	if (item) body.append(' ', chip(item));
	row.append(name, body); $('messages').append(row); row.scrollIntoView({ block: 'nearest' });
}
function choose(item) { selected = item; $('selection').replaceChildren(chip(item)); }
function render_results() {
	const query = $('search').value.trim().toLocaleLowerCase();
	const matches = items.filter(item => `${item.name} ${item.id}`.toLocaleLowerCase().includes(query));
	$('results-status').textContent = `${matches.length} matching items · showing ${Math.min(60, matches.length)}`;
	$('results').replaceChildren(...matches.slice(0, 60).map(item => {
		const button = document.createElement('button'); button.type = 'button'; button.className = 'item';
		const text = document.createElement('span'); text.textContent = item.name;
		const type = document.createElement('small'); type.textContent = item.type; text.append(type);
		button.append(image(item), text); button.title = item.id; button.addEventListener('click', () => choose(item)); return button;
	}));
}
async function load_language() {
	const generation = ++language_generation;
	$('results-status').textContent = 'Loading item labels…';
	const language = await read_source($('language').value, mode === 'direct');
	if (generation !== language_generation) return;
	items = resolve_items(data_package, language, media_root);
	for (const tag of document.querySelectorAll('.message .chip')) {
		const item = items.find(item => item.id === tag.title);
		if (item) tag.replaceWith(chip(item));
	}
	$('count').textContent = items.length.toLocaleString(); render_results();
	if (selected) choose(items.find(item => item.id === selected.id) ?? selected);
}
$('search').addEventListener('input', render_results);
$('language').addEventListener('change', () => load_language().catch(error => { $('explanation').textContent = error.message; }));
$('compose').addEventListener('submit', event => {
	event.preventDefault(); const text = $('draft').value.trim();
	if (!text && !selected) return;
	message('You · local preview', text, selected); $('draft').value = ''; selected = null; $('selection').replaceChildren();
});
async function start() {
	for (const [key, path] of Object.entries(paths)) {
		const row = document.createElement('li'), link = document.createElement('a');
		link.href = new URL(path, upstream); link.textContent = `${key}: ${path}`; link.target = '_blank'; link.rel = 'noreferrer';
		row.append(link); $('sources').append(row);
	}
	try {
		data_package = await read_source('items', true); mode = 'direct';
		$('transport').textContent = 'Direct browser access';
		$('explanation').textContent = 'The official item package was readable directly. Checking language data and artwork next.';
	} catch {
		mode = 'relay'; $('transport').textContent = 'Localhost relay';
		$('explanation').textContent = 'Direct browser fetch failed (CORS or network restriction). Reading the same official files through the local relay; artwork still loads directly from Melvor.';
		data_package = await read_source('items');
	}
	media_root = discover_media_root(await read_source('assets', mode === 'direct'));
	await load_language();
	const logs = items.find(item => item.id === 'melvorD:Normal_Logs');
	message('Guildmate · sample', 'Looking for some', logs);
	message('You · sample', 'These names and images came from Melvor, without loading a save.');
	if (logs) choose(logs);
	$('search').disabled = false; $('send').disabled = false;
}
start().catch(error => {
	$('transport').textContent = 'Source check failed'; $('transport').classList.add('error');
	$('explanation').textContent = error.message;
});
