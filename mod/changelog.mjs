const MOD_IO_GAME_ID = 2869;
const MOD_IO_MOD_ID = 6267659;
const MOD_IO_API_KEY = '18d577bc8c3b77469850cf15d56cc97d';
const MOD_IO_FILES_URL = `https://g-${MOD_IO_GAME_ID}.modapi.io/v1/games/${MOD_IO_GAME_ID}/mods/${MOD_IO_MOD_ID}/files`;

function decode_changelog_text(value) {
	return value
		.replaceAll('&amp;', '&')
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'");
}

export function normalize_changelog_entries(payload) {
	const files = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
	const seen_versions = new Set();

	return files
		.map(file => {
			const version = typeof file?.version === 'string' ? file.version.trim() : '';
			const changelog = typeof file?.changelog === 'string' ? decode_changelog_text(file.changelog.trim()) : '';
			return {
				version,
				changelog,
				lines: changelog.split(/\n+/).map(line => line.trim()).filter(Boolean)
			};
		})
		.filter(entry => /^\d+\.\d+\.\d+$/.test(entry.version) && entry.changelog.length > 0)
		.filter(entry => {
			if (seen_versions.has(entry.version))
				return false;
			seen_versions.add(entry.version);
			return true;
		});
}

export async function load_changelog(fetch_impl = (...args) => fetch(...args)) {
	const url = new URL(MOD_IO_FILES_URL);
	url.search = new URLSearchParams({
		_sort: '-id',
		_limit: '100',
		api_key: MOD_IO_API_KEY
	}).toString();

	const response = await fetch_impl(url.toString(), {
		headers: { Accept: 'application/json' }
	});
	if (!response?.ok)
		throw new Error(`mod.io changelog request failed (${response?.status ?? 'unknown'})`);

	return normalize_changelog_entries(await response.json());
}
