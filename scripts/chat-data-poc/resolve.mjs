export function discover_media_root(source) {
	// Read the production CDN literal as data; never evaluate upstream JavaScript.
	const match = source.match(/return\s+[`'"](https:\/\/cdn2-main\.melvor\.net)\$\{getPathWithoutFile\(\)\}\/[`'"]/);
	if (!match) throw new Error('Official asset resolver changed; cannot establish the image origin');
	return `${match[1]}/`;
}

export function resolve_items(data_package, language, media_root) {
	if (data_package?.namespace !== 'melvorD' || !Array.isArray(data_package.data?.items))
		throw new Error('Unexpected official demo package format');
	return data_package.data.items.map(item => {
		const path = item.mediaAnimation ?? item.media;
		const media = typeof path === 'string' && /^assets\/media\/[A-Za-z0-9_./?=-]+$/.test(path)
			&& !path.includes('..') ? new URL(path, media_root).href : null;
		return {
			id: `${data_package.namespace}:${item.id}`,
			name: language[`ITEM_NAME_${item.id}`] ?? item.name ?? item.id,
			media, type: item.type ?? item.itemType, source_path: path
		};
	});
}
