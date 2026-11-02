import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Only the same approved, high-confidence mappings used by the server are public.
// Never copy review rationale, evidence references, or pending classifications into the site.
const tag_order = ['time','items','resources','multitasking','shops','loot_rng'];
export function public_catalog(catalog) {
	return catalog.map(mod => ({
		id: mod.mod_io_id, name: mod.canonical_name, aliases: mod.aliases,
		tags: mod.classifications.filter(c => c.publication_state === 'approved' && c.confidence === 'high' && c.superseded_at == null)
			.map(c => ({id:c.category_id, explanation:c.public_explanation.trim()}))
			.sort((a,b) => tag_order.indexOf(a.id)-tag_order.indexOf(b.id))
	})).filter(mod => mod.tags.length).sort((a,b) => a.name.localeCompare(b.name,'en') || a.id-b.id);
}
export async function load_mod_catalog() {
	const source = JSON.parse(await readFile(new URL('../../server/cheat-mod-catalog.json',import.meta.url),'utf8'));
	const mods = public_catalog(source);
	return {mods, revision:createHash('sha256').update(JSON.stringify(mods)).digest('hex').slice(0,12)};
}
