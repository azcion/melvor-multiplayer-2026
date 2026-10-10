// Load the actual pure transport functions without importing SQLite or starting a worker.
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';

const root = new URL('../../server/', import.meta.url);
const files = ['mod_names.ts', 'translation_terms.ts', 'chat_parts.ts'];
const urls = new Map();
const hashes = {};
for (const file of files) {
	let source = await readFile(new URL(file, root), 'utf8');
	hashes[file] = createHash('sha256').update(source).digest('hex');
	if (file === 'chat_parts.ts') {
		const db_import = "import { db } from './db';";
		if (!source.startsWith(db_import)) throw Error('Database isolation seam changed; review loader');
		source = source.replace(db_import, 'const db = new Proxy({}, { get() { throw Error("Database forbidden in evaluation"); } });');
	}
	for (const [dependency, url] of urls) source = source.replaceAll(`'./${dependency.slice(0, -3)}'`, `'${url}'`);
	if (/\bimport\s.*\bfrom\s+['"]\.\//.test(source)) throw Error('Unexpected source dependency');
	urls.set(file, `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
}
export const source_hashes = hashes;
const module = await import(urls.get('chat_parts.ts'));
export const { translation_document, translated_parts, parts_text } = module;
