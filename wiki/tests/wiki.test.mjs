import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { load_content, validate_content, search_documents, render_page, escape_html } from '../scripts/site.mjs';
import { build, output_root } from '../scripts/build.mjs';
import { preview_server } from '../scripts/preview.mjs';
import { public_catalog, load_mod_catalog } from '../scripts/mod-catalog.mjs';
import { matches_mod } from '../assets/mod-filter.mjs';
import { tag_labels } from '../scripts/site.mjs';
import { search } from '../assets/search.mjs';

const categories = await load_content();
const documents = search_documents(categories);
const built = await build();

test('content is internally consistent; invalid IDs, sections, and related links fail the build boundary', () => {
	assert.equal(built.articles,16); assert.equal(built.categories,8);
	for (const mutate of [
		c => c[0].articles[0].related.push('missing'),
		c => c[0].articles[0].id = '../outside',
		c => delete c[0].articles[0].id,
		c => c[0].articles[0].sections[0].id = 'main',
		c => c[0].articles[0].sections[1].id = 'heading-'+c[0].articles[0].sections[0].id,
		c => c[0].articles[1].id = c[0].articles[0].id,
		c => c[0].articles[0].sections[1].id = c[0].articles[0].sections[0].id,
		c => c[0].articles[0].sections[0].paragraphs = [''],
		c => c[0].articles[0].related.push(c[0].articles[0].id),
		c => c[0].icon = '../outside.png',
		c => c[0].articles[0].sections[0].reference = 'unsafe',
		c => c[0].articles[0].sections[0].formulas = ['']
	]) {
		const copy = structuredClone(categories); mutate(copy);
		assert.throws(() => validate_content(copy),/Invalid wiki content/);
	}
});

test('search ranks titles and aliases, covers body text, requires all terms, and normalizes punctuation', () => {
	assert.equal(search(documents,'Crucible')[0].id,'crucible');
	assert.equal(search(documents,'one-use code')[0].id,'browser-chat');
	assert.ok(search(documents,'20 hours').some(doc => doc.id === 'council'));
	assert.ok(search(documents,'ＡＬＬＩＡＮＣＥ').some(doc => doc.id === 'alliances'));
	assert.ok(search(documents,'crucible heat').some(doc => doc.id === 'crucible'));
	assert.deepEqual(search(documents,'Crucible utterlyunknownword'),[]);
	assert.deepEqual(search(documents,'  -- '),[]);
	assert.equal(search(documents,'GP')[0].id,'marketplace');
});

test('Crucible, Raid and Expedition open directly from the sidebar and homepage', () => {
	const home = render_page(categories);
	assert.ok(!categories.some(c => c.id === 'adventures'));
	for (const [id,category_id,label] of [['crucible','crucible','Crucible'],['raids','raid','Raid'],['expedition','expedition','Expedition']]) {
		const category = categories.find(c => c.id === category_id);
		const article = category.articles.find(a => a.id === id);
		const html = render_page(categories,{category,article});
		const feature_links = [...html.matchAll(/<a class="feature-link"[^]*?<\/a>/g)].map(m => m[0]);
		assert.ok(feature_links.some(link => link.includes(`href="/wiki/${id}/" aria-current="page"`) && link.includes(label)));
		assert.ok(home.includes(`<h3><a href="/wiki/${id}/">${label}</a></h3>`));
		assert.equal(documents.find(doc => doc.id === id).category,label);
	}
});

test('authored text is escaped in body, attributes, metadata and navigation', () => {
	const copy = structuredClone(categories), a = copy[0].articles[0];
	a.title = '<img src=x onerror="alert(1)">';
	a.summary = '\"><script>alert(2)</script>';
	a.sections[0].paragraphs = ['<script>alert(3)</script>'];
	const html = render_page(copy,{category:copy[0],article:a});
	assert.ok(html.includes(escape_html(a.title)));
	assert.ok(html.includes(escape_html(a.summary)));
	assert.ok(!html.includes('<script>alert('));
	assert.ok(!html.includes('<img src=x'));
	assert.match(html,/aria-label="On this page"/);
});

async function html_files(dir) {
	const result = [];
	for (const entry of await readdir(dir,{withFileTypes:true})) {
		const path = join(dir,entry.name);
		if (entry.isDirectory()) result.push(...await html_files(path));
		else if (entry.name.endsWith('.html')) result.push(path);
	}
	return result;
}

test('every generated internal link, section target and bundled asset resolves without the backend', async () => {
	const pages = await html_files(output_root);
	assert.equal(pages.length,27);
	for (const file of pages) {
		const html = await readFile(file,'utf8');
		// Keep every page compatible with the strict CSP: browser-injected code is not a site dependency.
		assert.doesNotMatch(html, /<style\b|\sstyle\s*=|\son[a-z]+\s*=|file:\/\//i, file);
		for (const [,attributes,body] of html.matchAll(/<script\b([^>]*)>([^]*?)<\/script>/gi)) {
			assert.match(attributes, /\bsrc="\/wiki\/assets\/[^"\s]+\.mjs"/);
			assert.equal(body.trim(), '', `inline script in ${file}`);
		}
		const reading = html.replace(/<section id="search-view"[^]*?<\/section>/,'');
		assert.equal((reading.match(/<h1[ >]/g) ?? []).length,1,file);
		const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
		assert.equal(new Set(ids).size,ids.length,`duplicate ID in ${file}`);
		for (const [,link] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
			if (link === '/chat') continue; // Deliberately external to the independent static server.
			if (link.startsWith('#')) { assert.ok(ids.includes(link.slice(1)),`${file}: ${link}`); continue; }
			assert.ok(link.startsWith('/wiki/'),link);
			const target = join(output_root,link.endsWith('/') ? link+'index.html' : link);
			assert.ok((await stat(target)).isFile(),`${file}: ${link}`);
		}
	}
	assert.match(await readFile(join(output_root,'wiki/revision.txt'),'utf8'),/^[a-f0-9]{64}\n$/);
});

test('content and assets produce repeatable revision IDs', async () => {
	assert.equal((await build()).revision,built.revision);
});

test('preview handles direct article routes, redirects, missing files, methods, and traversal', async t => {
	const server = preview_server(); server.listen(0,'127.0.0.1'); await once(server,'listening');
	t.after(() => new Promise(resolve => server.close(resolve)));
	const origin = `http://127.0.0.1:${server.address().port}`;
	for (const path of ['/wiki/','/wiki/council/','/wiki/category/economy/','/wiki/assets/wiki.mjs','/wiki/assets/search-index.json','/wiki/assets/logo.png']) {
		const response = await fetch(origin+path);
		assert.equal(response.status,200,path);
		assert.equal(response.headers.get('x-content-type-options'),'nosniff');
		assert.equal(response.headers.get('cache-control'),'no-cache');
		assert.ok(!response.headers.get('content-security-policy').includes('unsafe-inline'));
		assert.ok((await response.arrayBuffer()).byteLength > 0);
	}
	for (const [path,destination] of [['/wiki?q=test','/wiki/?q=test'],['/wiki/council','/wiki/council/']]) {
		const response = await fetch(origin+path,{redirect:'manual'});
		assert.equal(response.status,308); assert.equal(response.headers.get('location'),destination);
	}
	for (const path of ['/wiki/missing/','/wiki/assets/missing.js','/wiki/%2e%2e%2fpackage.json','/wiki/%2f..%2fpackage.json','/chat','/api/versions'])
		assert.equal((await fetch(origin+path)).status,404,path);
	assert.equal((await fetch(origin+'/wiki/',{method:'POST'})).status,405);
	const head = await fetch(origin+'/wiki/',{method:'HEAD'});
	assert.equal(head.status,200); assert.equal(await head.text(),'');
});

test('mod lookup publishes only approved high-confidence tags and public fields', async () => {
	const fixture = [{id:42,mod_io_id:42,canonical_name:'A <mod>',aliases:['Old name'],rationale:'PRIVATE',classifications:[
		{category_id:'items',confidence:'high',publication_state:'approved',public_explanation:'Adds <items>',rationale:'PRIVATE'},
		{category_id:'time',confidence:'high',publication_state:'pending',public_explanation:'UNPUBLISHED'},
		{category_id:'shops',confidence:'low',publication_state:'approved',public_explanation:'UNREVIEWED'},
		{category_id:'resources',confidence:'high',publication_state:'approved',superseded_at:1,public_explanation:'OLD'}
	]}];
	const projected = public_catalog(fixture);
	assert.deepEqual(projected,[{id:42,name:'A <mod>',aliases:['Old name'],tags:[{id:'items',explanation:'Adds <items>'}]}]);
	const category = categories.find(c => c.id === 'cheat-tags');
	const html = render_page(categories,{category,article:category.articles[0],catalog:{mods:projected,revision:'test'}});
	assert.ok(html.includes('A &lt;mod&gt;')); assert.ok(html.includes('Adds &lt;items&gt;'));
	assert.doesNotMatch(html,/PRIVATE|UNPUBLISHED|UNREVIEWED/);
	const catalog = await load_mod_catalog();
	const raw = JSON.parse(await readFile(new URL('../../server/cheat-mod-catalog.json',import.meta.url),'utf8'));
	assert.equal(catalog.mods.length,raw.filter(m => m.classifications.some(c => c.publication_state === 'approved' && c.confidence === 'high')).length);
	assert.deepEqual(new Set(catalog.mods.flatMap(m => m.tags.map(t => t.id))),new Set(Object.keys(tag_labels)));
	const labels = JSON.parse(await readFile(new URL('../../mod/data/lang/en.json',import.meta.url),'utf8'));
	for (const [id,label] of Object.entries(tag_labels)) assert.equal(label,labels['MOD_MP_CHEAT_CATEGORY_'+id.toUpperCase()]);
	const page = await readFile(join(output_root,'wiki/cheat-tags/index.html'),'utf8');
	assert.equal((page.match(/class="mod-card"/g) ?? []).length,catalog.mods.length);
	const index = JSON.parse(await readFile(join(output_root,'wiki/assets/search-index.json'),'utf8'));
	assert.equal(search(index,'2429395')[0].id,'cheat-tags');
	assert.equal(search(index,'dev.Console')[0].id,'cheat-tags');
});

test('mod filtering combines names, IDs, aliases, Unicode text and category without approving missing mods', () => {
	const text = 'Free Farming 1234 旧名 Resource Cheats';
	assert.ok(matches_mod(text,['resources'],'ＦＲＥＥ farming','resources'));
	assert.ok(matches_mod(text,['resources'],'1234'));
	assert.ok(matches_mod(text,['resources'],'旧名'));
	assert.ok(!matches_mod(text,['resources'],'free','items'));
	assert.ok(!matches_mod(text,['resources'],'free unknown'));
	assert.ok(matches_mod(text,['resources'],''));
});

test('only the six vendored Material Symbols are shipped and their CSS assets resolve', async () => {
	const directory = join(output_root,'wiki/assets/material');
	const names = (await readdir(directory)).filter(n => n.endsWith('.svg'));
	assert.deepEqual(names.sort(),['arrow_forward.svg','expand_more.svg','home.svg','open_in_new.svg','search.svg','shield.svg']);
	const css = await readFile(join(output_root,'wiki/assets/wiki.css'),'utf8');
	for (const name of names) {
		assert.ok(css.includes('/wiki/assets/material/'+name));
		const svg = await readFile(join(directory,name),'utf8');
		assert.match(svg,/<svg/); assert.doesNotMatch(svg,/<script|<style|(?:href|src)=/);
	}
	assert.ok((await readFile(join(directory,'LICENSE.txt'),'utf8')).includes('Apache License'));
	assert.ok((await Promise.all(names.map(n => stat(join(directory,n))))).reduce((sum,s) => sum+s.size,0)<10000);
});

test('Wish catalogue publishes every item with exact GP and funding quotes and searchable names', async () => {
	const {load_game_reference} = await import('../scripts/game-reference.mjs');
	const {wishes} = await load_game_reference();
	assert.equal(wishes.find(w => w.id === 'melvorAoD:Torn_Parchment').max_item_value,100,'Keep the authored Torn Parchment worked example in sync');
	const html = await readFile(join(output_root,'wiki/crucible/index.html'),'utf8');
	const rows = [...html.matchAll(/<tr data-value="(\d+)">([^]*?)<\/tr>/g)];
	assert.equal(rows.length,wishes.length);
	for (const item of wishes) {
		const row = rows.find(([,v,body]) => Number(v) === item.max_item_value && body.includes(escape_html(item.id)));
		assert.ok(row,item.id);
		const format = n => new Intl.NumberFormat('en-US').format(n);
		assert.ok(row[2].includes(`data-cost="gp">${format(Math.ceil(item.max_item_value*100*5/2))}</td>`));
		assert.ok(row[2].includes(`data-cost="funding">${format(item.max_item_value*100*5)}</td>`));
	}
	const index = JSON.parse(await readFile(join(output_root,'wiki/assets/search-index.json'),'utf8'));
	assert.equal(search(index,'Torn Parchment')[0].id,'crucible');
	assert.equal(search(index,'melvorAoD:Golden_Flute')[0].id,'crucible');
	assert.match(html,/50,000 GP equivalent/);
	assert.match(html,/GP payment becomes a normal GP Offering/);
});

test('browser Wish quotes agree with the server for all quantities and capacities, including rounding boundaries', async () => {
	const client = await import('../dist/wiki/assets/crucible-rules.mjs');
	const server = await import('../../server/wish-capacity.ts');
	for (const base of [100,200,300,400,500])
		for (let qty=1;qty<=1000;qty++) assert.equal(client.wish_price_micros(qty,base),server.wish_price_micros(qty,base));
	for (const [qty,base,micros] of [[1,100,10000],[1,300,4000],[100,300,334000],[101,100,1020000],[201,100,3030000],[350,100,8000000],[1000,100,55000000],[1000,500,21000000]])
		assert.equal(client.wish_price_micros(qty,base),micros);
	assert.equal(client.wish_gp_cost(3445),1723); // Odd requirement rounds upward.
	assert.equal(client.wish_price_micros(1001),0);
});

test('Rift food and potion examples use catalogue values and cumulative six-decimal EP without batch bonuses', async () => {
	const {load_game_reference} = await import('../scripts/game-reference.mjs');
	const supplies = JSON.parse(await readFile(new URL('../../server/tests/fixtures/expedition-supply-catalog-v1.json', import.meta.url), 'utf8'));
	const {supply_unit_value,supply_quote,supply_score_micros} = await import('../assets/supply-math.mjs');
	for (const [id,value] of [['melvorD:Shrimp',2],['melvorD:Lobster',108],['melvorF:Bird_Nest_Potion_IV',4],['melvorItA:Crimson_Biter',1]])
		assert.equal(supply_unit_value(supplies.items[id]),value);
	assert.equal(supply_unit_value({value_currency_id:'melvorD:GP',value_per_item:0}),1);
	assert.equal(supply_quote(0,2,500).earned,3010299);
	assert.equal(supply_quote(1000,2,500).earned,1760913);
	assert.equal(supply_quote(0,2,1000).earned,4771212);
	assert.equal(supply_score_micros(9000),10000000);
	assert.equal(supply_score_micros(99000),20000000);
	let prior = 0, earned = 0;
	for (const qty of [1,499,237,263]) { const quote = supply_quote(prior,2,qty); prior = quote.total; earned += quote.earned; }
	assert.equal(earned,supply_quote(0,2,1000).earned);
	for (const args of [[-1,2,1],[0,2,1.5],[0,2,0],[NaN,2,1],[Number.MAX_SAFE_INTEGER,2,1]]) assert.equal(supply_quote(...args),null);
	const html = await readFile(join(output_root,'wiki/expedition/index.html'),'utf8');
	assert.match(html,/Personal Rift Preparations/); assert.match(html,/20 verified hours|20 EP/);
	assert.doesNotMatch(html,/supply-calculator|donation score/);
});

test('EP reference includes all five capacity columns without a donation calculator', async () => {
	const crucible = await readFile(join(output_root,'wiki/crucible/index.html'),'utf8');
	const table = crucible.match(/<table><caption>EP examples: exact charges<\/caption>([^]*?)<\/table>/)[1];
	for (const base of [100,200,300,400,500]) assert.ok(table.includes(`Base ${base}</th>`));
	assert.match(table, /<th scope="row">1<\/th><td>0\.010 EP<\/td><td>0\.005 EP<\/td><td>0\.004 EP<\/td><td>0\.003 EP<\/td><td>0\.002 EP<\/td>/);
	const expedition = await readFile(join(output_root,'wiki/expedition/index.html'),'utf8');
	assert.match(expedition, /Late registrants/);
	assert.match(expedition, /0\.5 EP/);
});

test('Raid guide explains shared HP scaling separately from Assault boss HP and fixed tier contributions', async () => {
	const html = await readFile(join(output_root,'wiki/raids/index.html'),'utf8');
	assert.match(html,/<title>Raid \(old\) · Multiplayer Wiki<\/title>/);
	assert.match(html,/ceil\(20 × √\(N ÷ 2\)\)/);
	assert.match(html,/27,500 shared Raid HP/);
	assert.match(html,/four days/);
	assert.match(html,/Hitpoints level × game number multiplier/);
	const game = JSON.parse(await readFile(new URL('../../mod/data.json',import.meta.url),'utf8'));
	for (const [tier,contribution] of [[1,'1,000'],[2,'1,800'],[3,'3,000'],[4,'4,500']]) {
		const boss = game.data.monsters.find(m => m.id === `Raid_Tier_${tier}`);
		assert.ok(html.includes(boss.name));
		assert.ok(html.includes(`${new Intl.NumberFormat('en-US').format(boss.levels.Hitpoints*10)} base HP at 10×. A win removes ${contribution} shared Raid HP.`));
	}
});


test('art helper stays unlisted and uses only immutable R2 artwork', async () => {
 const page = await readFile(join(output_root,'wiki/expedition-art-preview/index.html'),'utf8');
 assert.match(page, /name="robots" content="noindex, nofollow"/);
 const home = await readFile(join(output_root,'wiki/index.html'),'utf8');
 const search = await readFile(join(output_root,'wiki/assets/search-index.json'),'utf8');
 assert.doesNotMatch(home+search, /expedition-art-preview/);
 const script = await readFile(join(output_root,'wiki/assets/expedition-art-preview.mjs'),'utf8');
 assert.doesNotMatch(script, /\.\.\/|file:\/\//);
 const artwork = [...script.matchAll(/"(?:art|originalArt)": "([^"]+)"/g)];
 assert.equal(artwork.length,18);
 for (const [,url] of artwork) assert.match(url, /^https:\/\/cdn\.melvor\.azcn\.io\/assets\/[a-f0-9]{16}\/[a-z-]+\.png$/);
});
