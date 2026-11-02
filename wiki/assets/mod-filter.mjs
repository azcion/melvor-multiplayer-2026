import { normalize } from './search.mjs';

export function matches_mod(text, tags, query, category = '') {
	const words = normalize(query.slice(0,160)).split(/\s+/).filter(Boolean);
	return (!category || tags.includes(category)) && words.every(word => normalize(text).includes(word));
}
