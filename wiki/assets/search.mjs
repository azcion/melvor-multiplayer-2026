export function normalize(value) {
	return String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function search(documents, query) {
	const normalized = normalize(query.slice(0,160));
	if (!normalized) return [];
	const words = normalized.split(/\s+/);
	return documents.map(document => {
		const title = normalize(document.title), aliases = normalize(document.aliases);
		const summary = normalize(document.summary), body = normalize(document.body), category = normalize(document.category);
		if (!words.every(word => `${title} ${aliases} ${summary} ${body} ${category}`.includes(word))) return null;
		const score = (title === normalized ? 100 : 0) + words.reduce((sum,word) => sum + (title.includes(word) ? 12 : 0) + (aliases.includes(word) ? 8 : 0) + (summary.includes(word) ? 4 : 0) + (category.includes(word) ? 2 : 0),0);
		return {document,score};
	}).filter(Boolean).sort((a,b) => b.score - a.score || a.document.title.localeCompare(b.document.title,'en')).map(result => result.document);
}
