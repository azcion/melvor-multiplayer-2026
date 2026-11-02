import { render_game_reference } from './game-reference.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const wiki_root = fileURLToPath(new URL('../', import.meta.url));
export const escape_html = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const article_url = id => `/wiki/${id}/`;
export const category_url = id => `/wiki/category/${id}/`;
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const references = ['heat-table','wish-gp','wish-ep','capacity','wish-catalog','supply-curve','supply-examples'];
const valid_id = value => typeof value === 'string' && slug.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;

export async function load_content(root = join(wiki_root, 'content')) {
	const files = (await readdir(root)).filter(file => file.endsWith('.json')).sort();
	const categories = await Promise.all(files.map(async file => JSON.parse(await readFile(join(root, file), 'utf8'))));
	// Explicit ordering is part of the handbook's learning path.
	const order = ['getting-started', 'guilds', 'economy', 'crucible', 'raid', 'expedition', 'cheat-tags', 'chat-support'];
	categories.sort((a,b) => order.indexOf(a.id) - order.indexOf(b.id));
	validate_content(categories);
	return categories;
}

export function validate_content(categories) {
	const category_ids = new Set(), article_ids = new Set();
	const fail = message => { throw new Error(`Invalid wiki content: ${message}`); };
	if (!Array.isArray(categories) || !categories.length) fail('categories are required');
	for (const category of categories) {
		if (!valid_id(category.id) || category_ids.has(category.id)) fail(`category ID ${category.id}`);
		category_ids.add(category.id);
		if (!text(category.title) || !text(category.description) || !['multiplayer.svg','market.svg','crucible.png','raid-nav.png','expedition-nav.png','transfer_bag.svg','shield'].includes(category.icon)) fail(`category fields ${category.id}`);
		if (!Array.isArray(category.articles) || !category.articles.length) fail(`empty category ${category.id}`);
		for (const article of category.articles) {
			if (!valid_id(article.id) || ['category','assets','404','index'].includes(article.id) || article_ids.has(article.id)) fail(`article ID ${article.id}`);
			article_ids.add(article.id);
			if (!text(article.title) || !text(article.summary)) fail(`article fields ${article.id}`);
			if (!Array.isArray(article.aliases) || !article.aliases.every(text)) fail(`aliases ${article.id}`);
			if (!Array.isArray(article.related) || new Set(article.related).size !== article.related.length) fail(`related links ${article.id}`);
			if (!Array.isArray(article.sections) || !article.sections.length) fail(`sections ${article.id}`);
			const sections = new Set(['main','wiki-search','clear-search','search-view','search-title','search-status','search-results','page-content','related-title','mod-lookup','mod-query','mod-category','mod-status','mod-empty','mod-results','wish-calculator','wish-item','wish-quantity','wish-base','wish-quote','wish-cost-table','wish-table-caption','supply-calculator','supply-item','supply-quantity','supply-prior','supply-quote']);
			for (const section of article.sections) {
				if (!valid_id(section.id) || sections.has(section.id) || sections.has(`heading-${section.id}`) || !text(section.title)) fail(`section ID/title ${article.id}`);
				sections.add(section.id); sections.add(`heading-${section.id}`);
				if (section.reference !== undefined && !references.includes(section.reference)) fail(`reference ${article.id}`);
				let count = 0;
				for (const key of ['paragraphs','bullets','steps','formulas']) {
					if (section[key] !== undefined && (!Array.isArray(section[key]) || !section[key].length || !section[key].every(text))) fail(`${key} ${article.id}`);
					count += section[key]?.length ?? 0;
				}
				if (!count || (section.note !== undefined && !text(section.note))) fail(`section body ${article.id}`);
			}
		}
	}
	for (const article of categories.flatMap(c => c.articles)) {
		for (const id of article.related)
			if (!article_ids.has(id) || id === article.id) fail(`broken related link ${article.id} → ${id}`);
	}
}

export function search_documents(categories) {
	return categories.flatMap(category => category.articles.map(article => ({
		id: article.id, title: article.title, summary: article.summary, category: category.title,
		url: article_url(article.id), aliases: article.aliases.join(' '),
		body: article.sections.map(section => [section.title, ...(section.paragraphs ?? []), ...(section.bullets ?? []), ...(section.steps ?? []), ...(section.formulas ?? []), section.note ?? ''].join(' ')).join(' ')
	})));
}

const e = escape_html;
export function symbol(name) {
	if (!['search','home','arrow_forward','open_in_new','expand_more','shield'].includes(name)) throw new Error('Unknown Material Symbol');
	return `<span class="ui-symbol symbol-${name}" aria-hidden="true"></span>`;
}
function icon(category) { if (category.icon === 'shield') return symbol('shield'); return `<img src="/wiki/assets/${e(category.icon)}" alt="" width="40" height="40">`; }
function article_card(article, category) {
	return `<a class="article-card" href="${article_url(article.id)}"><span class="eyebrow">${e(category.title)}</span><h3>${e(article.title)} ${symbol('open_in_new')}</h3><p>${e(article.summary)}</p></a>`;
}
function side_navigation(categories, active, category) {
	return `<a class="home-link" href="/wiki/"${active === 'home' ? ' aria-current="page"' : ''}>${symbol('home')} Wiki home</a>${categories.map(c => {
		if (c.articles.length === 1) return `<a class="feature-link" href="${article_url(c.articles[0].id)}"${category?.id === c.id ? ' aria-current="page"' : ''}>${icon(c)}<span>${e(c.title)}</span></a>`;
		return `<details${active === 'home' || category?.id === c.id ? ' open' : ''}><summary>${icon(c)}<span>${e(c.title)}</span><span class="nav-count">${c.articles.length}</span></summary><div class="nav-group"><a class="category-link" href="${category_url(c.id)}"${active === c.id ? ' aria-current="page"' : ''}>Category overview</a>${c.articles.map(a => `<a href="${article_url(a.id)}"${active === a.id ? ' aria-current="page"' : ''}>${e(a.title)}</a>`).join('')}</div></details>`;
	}).join('')}`;
}

export function render_page(categories, {article, category, missing = false, catalog, referenceData} = {}) {
	const all = categories.flatMap(c => c.articles);
	const title = article?.title ?? category?.title ?? (missing ? 'Page not found' : 'The Multiplayer handbook');
	const description = article?.summary ?? category?.description ?? 'Guides to Guilds, the Marketplace, the Crucible, Expeditions, Raids, and Chat in Melvor Multiplayer Remastered.';
	const active = article?.id ?? category?.id ?? (missing ? '' : 'home');
	const home = !article && !category && !missing;
	const find = id => all.find(a => a.id === id);
	const find_category = id => categories.find(c => c.articles.some(a => a.id === id));
	const count = all.length;
	let body;
	if (missing) {
		body = `<div class="page-heading"><p class="eyebrow">Lost in the Rift · 404</p><h1>That page isn’t here.</h1><p>The link may have changed. Try searching for what you need, or head back to the wiki.</p><a class="button primary" href="/wiki/">Return to the wiki</a></div>`;
	} else if (article) {
		body = `<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/wiki/">Wiki</a><span aria-hidden="true">/</span>${category.articles.length === 1 ? `<span>${e(category.title)}</span>` : `<a href="${category_url(category.id)}">${e(category.title)}</a>`}</nav>
		<header class="page-heading"><p class="eyebrow">${category.articles.length === 1 ? 'Player guide' : e(category.title)}</p><h1>${e(article.title)}</h1><p class="lead">${e(article.summary)}</p></header>
		<div class="reading-layout"><article class="article-body">${article.sections.map(s => `<section id="${e(s.id)}" aria-labelledby="heading-${e(s.id)}"><h2 id="heading-${e(s.id)}"><a href="#${e(s.id)}">${e(s.title)}</a></h2>${(s.paragraphs ?? []).map(p => `<p>${e(p)}</p>`).join('')}${s.bullets ? `<ul>${s.bullets.map(p => `<li>${e(p)}</li>`).join('')}</ul>` : ''}${s.steps ? `<ol class="steps">${s.steps.map(p => `<li>${e(p)}</li>`).join('')}</ol>` : ''}${s.formulas ? `<div class="formulas">${s.formulas.map(f => `<p><code>${e(f)}</code></p>`).join('')}</div>` : ''}${s.reference && referenceData ? render_game_reference(s.reference,referenceData,e) : ''}${s.note ? `<p class="notice">${e(s.note)}</p>` : ''}${article.id === 'cheat-tags' && s.id === 'find-a-mod' && catalog ? render_mod_lookup(catalog) : ''}</section>`).join('')}
		<section class="related" aria-labelledby="related-title"><p class="eyebrow">What next?</p><h2 id="related-title">Related guides</h2><div class="related-links">${article.related.map(id => `<a href="${article_url(id)}">${e(find(id).title)} ${symbol('arrow_forward')}</a>`).join('')}</div></section></article>
		<aside class="contents"><nav aria-label="On this page"><p class="eyebrow">On this page</p>${article.sections.map(s => `<a href="#${e(s.id)}">${e(s.title)}</a>`).join('')}</nav><div class="help-card"><strong>Need a hand?</strong><p>Ask the community in Chat.</p><a href="/chat">Open Chat ${symbol('open_in_new')}</a></div></aside></div>`;
	} else if (category) {
		body = `<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/wiki/">Wiki</a><span aria-hidden="true">/</span><span>${e(category.title)}</span></nav><header class="page-heading category-heading">${icon(category)}<p class="eyebrow">${category.articles.length} guides</p><h1>${e(category.title)}</h1><p class="lead">${e(category.description)}</p></header><div class="article-grid">${category.articles.map(a => article_card(a,category)).join('')}</div>`;
	} else {
		body = `<header class="hero"><div class="hero-copy"><p class="eyebrow"><span class="status-dot" aria-hidden="true"></span> Melvor Multiplayer Remastered · Wiki</p><h1>A shared world.<br>A little guidance.</h1><p class="lead">New to Multiplayer, or trying something for the first time?<br class="desktop-break"> Find a guide and get back to playing.</p><div class="hero-actions"><a class="button primary" href="${article_url('first-steps')}">Get started ${symbol('arrow_forward')}</a><a class="text-link" href="${article_url('glossary')}">Look up a term</a></div></div><div class="hero-art" aria-hidden="true"><img src="/wiki/assets/expedition-nav.png" width="256" height="256"><span>Beyond the idle</span></div></header>
		<section class="start-path" aria-labelledby="start-title"><div><p class="eyebrow">New around here?</p><h2 id="start-title">Your first session</h2></div><ol>${['first-steps','joining-a-guild','transfers'].map((id,i) => `<li><a href="${article_url(id)}"><span class="step-number">0${i+1}</span><span>${e(find(id).title)}</span>${symbol('arrow_forward')}</a></li>`).join('')}</ol></section>
		<section class="browse" aria-labelledby="browse-title"><div class="section-heading"><div><p class="eyebrow">Find a guide</p><h2 id="browse-title">Explore the handbook</h2></div><span class="muted">${categories.length} categories · ${count} guides</span></div><div class="category-grid">${categories.map(c => `<section class="category-card"><div class="category-card-top">${icon(c)}<span class="guide-count">${c.articles.length} guides</span></div><h3><a href="${c.articles.length === 1 ? article_url(c.articles[0].id) : category_url(c.id)}">${e(c.title)}</a></h3><p>${e(c.description)}</p><ul>${c.articles.map(a => `<li><a href="${article_url(a.id)}">${c.articles.length === 1 ? 'Read the guide' : e(a.title)}${symbol('arrow_forward')}</a></li>`).join('')}</ul></section>`).join('')}</div></section>
		<section class="community-banner"><div><p class="eyebrow">Better with company</p><h2>Still have a question?</h2><p>Ask other players in Chat. If something has gone wrong, our Support guide can help you explain what happened.</p></div><div class="hero-actions"><a class="button" href="/chat">Open Chat ${symbol('open_in_new')}</a><a class="text-link" href="${article_url('support')}">Getting help</a></div></section>`;
	}
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${e(description)}"><meta name="theme-color" content="#182732"><title>${e(title)} · Multiplayer Wiki</title><link rel="icon" href="/wiki/assets/multiplayer.svg" type="image/svg+xml"><link rel="stylesheet" href="/wiki/assets/wiki.css"><script type="module" src="/wiki/assets/wiki.mjs"></script>${article?.id === 'cheat-tags' ? '<script type="module" src="/wiki/assets/mod-lookup.mjs"></script>' : ''}${['crucible','expedition'].includes(article?.id) ? '<script type="module" src="/wiki/assets/calculators.mjs"></script>' : ''}</head>
<body><a class="skip-link" href="#main">Skip to content</a><div class="site-shell"><header class="site-header"><a class="brand" href="/wiki/" aria-label="Melvor Multiplayer Wiki home"><img src="/wiki/assets/logo.png" alt="Melvor Multiplayer Remastered" width="1536" height="636"><span>Wiki</span></a><nav aria-label="Site navigation"><a href="/wiki/" aria-current="true">Wiki</a><a href="/chat">Chat ${symbol('open_in_new')}</a></nav></header>
<div class="wiki-layout"><aside class="sidebar"><details class="mobile-navigation" open><summary>Browse the wiki ${symbol('expand_more')}</summary><nav aria-label="Wiki categories">${side_navigation(categories,active,category)}</nav></details></aside>
<main id="main" tabindex="-1"><form class="search" role="search" action="/wiki/" method="get"><label for="wiki-search">${symbol('search')}<span class="sr-only">Search the wiki</span></label><input type="search" id="wiki-search" name="q" maxlength="160" autocomplete="off" placeholder="Search guides, features, and terms…" aria-controls="search-view"><kbd aria-hidden="true">/</kbd><button type="reset" id="clear-search" hidden>Clear</button></form><noscript><p class="notice">Search needs JavaScript. All guides are available through category navigation.</p></noscript>
<section id="search-view" hidden aria-labelledby="search-title"><p class="eyebrow">Search the handbook</p><h1 id="search-title">Search results</h1><p id="search-status" role="status" aria-live="polite"></p><div id="search-results" class="article-grid"></div></section><div id="page-content"${home ? ' class="home-content"' : ''}>${body}</div>
<footer><span>Melvor Multiplayer Remastered</span><p>Written for players. What you see in the game can vary with your server and mod version.</p><a href="${article_url('support')}">Found something unclear? Get help ${symbol('arrow_forward')}</a><p class="fine-print">Unofficial community project. Not affiliated with Games by Malcs or Jagex.</p></footer></main></div></div></body></html>`;
}

export const tag_labels = {time:'Time Cheats', items:'Item Cheats', resources:'Resource Cheats', multitasking:'Multitasking', shops:'Shop Cheats', loot_rng:'Loot Cheats'};
export function render_mod_lookup({mods,revision}) {
	return `<div id="mod-lookup"><p class="catalog-version">Catalog ${e(revision)} · ${mods.length} listed mods</p>
	<form class="mod-controls" hidden role="search" aria-label="Look up a mod"><div><label for="mod-query">Mod name or mod.io ID</label><input id="mod-query" type="search" maxlength="160" placeholder="Try Add Items or 2429395" autocomplete="off" aria-controls="mod-results"></div><div><label for="mod-category">Tag</label><select id="mod-category" aria-controls="mod-results"><option value="">All tags</option>${Object.entries(tag_labels).map(([id,label]) => `<option value="${id}">${e(label)}</option>`).join('')}</select></div><button type="reset">Clear filters</button></form>
	<p id="mod-status" role="status" aria-live="polite">${mods.length} listed mods.</p><p id="mod-empty" class="notice" hidden>No listed mods match these filters. Try the mod.io ID or clear the filters. An absent result is not an approval; ask in Support if you’re unsure.</p>
	<div id="mod-results">${mods.map(mod => `<section class="mod-card" data-search="${e([mod.name,mod.id,...mod.aliases].join(' '))}" data-tags="${e(mod.tags.map(t => t.id).join(' '))}"><h3>${e(mod.name)}</h3><p class="mod-id">mod.io ID: ${mod.id}</p><div class="mod-tags">${mod.tags.map(t => `<span class="mod-tag${t.id === 'items' ? ' item-tag' : ''}">${e(tag_labels[t.id])}</span>`).join('')}</div>${mod.tags.map(t => `<p><strong>${e(tag_labels[t.id])}:</strong> ${e(t.explanation || 'This mod is included in the reviewed list for this tag. No further explanation has been published.')}</p>`).join('')}</section>`).join('')}</div></div>`;
}
