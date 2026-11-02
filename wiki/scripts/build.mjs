import { realpathSync } from 'node:fs';
import { mkdir, rm, writeFile, copyFile, readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { load_content, wiki_root, render_page, search_documents } from './site.mjs';

import { load_game_reference } from './game-reference.mjs';
import { load_mod_catalog } from './mod-catalog.mjs';

// Output is fixed and disposable. Never remove a caller-supplied path.
export const output_root = join(wiki_root,'dist');
export async function build() {
	const categories = await load_content();
	const catalog = await load_mod_catalog();
	const referenceData = await load_game_reference();
	await rm(output_root,{recursive:true,force:true});
	async function write(path,content) {
		const target = join(output_root,path);
		await mkdir(dirname(target),{recursive:true});
		await writeFile(target,content);
	}
	await write('wiki/index.html',render_page(categories));
	await write('wiki/404.html',render_page(categories,{missing:true}));
	for (const category of categories) {
		await write(`wiki/category/${category.id}/index.html`,render_page(categories,{category}));
		for (const article of category.articles)
			await write(`wiki/${article.id}/index.html`,render_page(categories,{article,category,catalog,referenceData}));
	}
	await write('wiki/expedition-art-preview/index.html',await readFile(join(wiki_root,'helpers/expedition-art-preview.html'),'utf8'));
	const documents = search_documents(categories);
	documents.find(d => d.id === 'crucible').body += ' '+referenceData.wishes.map(w => w.name+' '+w.id).join(' ');
	documents.find(d => d.id === 'cheat-tags').body += ' '+catalog.mods.map(m => [m.name,m.id,...m.aliases].join(' ')).join(' ');
	await write('wiki/assets/search-index.json',JSON.stringify(documents));
	const assets = {
		'logo.png': '../assets/melvor_multiplayer_remastered_logo.png',
		'multiplayer.svg': '../mod/assets/multiplayer.svg', 'market.svg': '../mod/assets/market.svg',
		'crucible.png': '../mod/assets/crucible.png', 'raid-nav.png': '../mod/assets/raid-nav.png',
		'expedition-nav.png': '../mod/assets/expedition-nav.png', 'transfer_bag.svg': '../mod/assets/transfer_bag.svg',
		'calculators.mjs':'assets/calculators.mjs', 'supply-math.mjs':'assets/supply-math.mjs',
		'crucible-rules.mjs':'../mod/crucible-rules.mjs',
		'mod-filter.mjs':'assets/mod-filter.mjs', 'mod-lookup.mjs':'assets/mod-lookup.mjs',
		'expedition-art-preview.css':'assets/expedition-art-preview.css',
		'expedition-art-preview.mjs':'assets/expedition-art-preview.mjs',
		'wiki.css': 'assets/wiki.css', 'wiki.mjs': 'assets/wiki.mjs', 'search.mjs': 'assets/search.mjs'
	};
	for (const [name,source] of Object.entries(assets))
		await copyFile(resolve(wiki_root,source),join(output_root,'wiki/assets',name));
	await mkdir(join(output_root,'wiki/assets/material'),{recursive:true});
	for (const name of await readdir(join(wiki_root,'assets/material'))) {
		if (name.endsWith('.svg') || name === 'LICENSE.txt')
			await copyFile(join(wiki_root,'assets/material',name),join(output_root,'wiki/assets/material',name));
	}
	const digest = createHash('sha256');
	for (const path of (await readdir(output_root,{recursive:true})).sort()) {
		if ((await stat(join(output_root,path))).isFile())
			digest.update(path).update('\0').update(await readFile(join(output_root,path))).update('\0');
	}
	const revision = digest.digest('hex');
	await write('wiki/revision.txt',`${revision}\n`);
	return {categories:categories.length,articles:categories.flatMap(c => c.articles).length,revision,output:output_root};
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
	console.log(JSON.stringify(await build(),null,2));
