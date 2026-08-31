function updates_endpoint(server_host) {
	return server_host.replace(/\/$/, '') + '/api/updates';
}

export function normalize_updates(payload) {
	if (!Array.isArray(payload?.sections))
		return [];

	return payload.sections
		.map(section => ({
			id: typeof section?.id === 'string' ? section.id.trim() : '',
			title: typeof section?.title === 'string' ? section.title.trim() : '',
			paragraphs: Array.isArray(section?.paragraphs)
				? section.paragraphs.filter(paragraph => typeof paragraph === 'string').map(paragraph => paragraph.trim()).filter(Boolean)
				: []
		}))
		.filter(section => section.id.length > 0 && section.title.length > 0 && section.paragraphs.length > 0);
}

export async function load_updates(fetch_impl = (...args) => fetch(...args), server_host = '') {
	const response = await fetch_impl(updates_endpoint(server_host), {
		headers: { Accept: 'application/json' }
	});
	if (!response?.ok)
		throw new Error(`updates request failed (${response?.status ?? 'unknown'})`);

	return normalize_updates(await response.json());
}
