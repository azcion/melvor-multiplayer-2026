import { readFile } from 'node:fs/promises';

const source_files = [
	'mod/main.mjs',
	'mod/client-actions-common.mjs',
	'mod/client-actions-chat.mjs',
	'mod/client-actions-market-campaign-charity.mjs',
	'mod/client-actions-trading.mjs',
	'mod/client-actions-transfer.mjs',
	'mod/client-actions-social.mjs',
	'mod/client-components.mjs',
	'mod/status-statistics.mjs',
	'mod/changelog.mjs',
	'mod/updates.mjs'
];

export async function read_client_source(root = new URL('../../', import.meta.url)) {
	const sources = await Promise.all(source_files.map(file =>
		readFile(new URL(file, root), 'utf8')
	));
	return sources.join('\n');
}

export async function read_release_changelog(root = new URL('../../', import.meta.url)) {
	try {
		return await readFile(new URL('CHANGELOG.md', root), 'utf8');
	} catch (error) {
		if (error?.code !== 'ENOENT')
			throw error;
		return readFile(new URL('public-release/replacements/changelog.md', root), 'utf8');
	}
}

export function load_sidebar_function(main, function_name, parameters) {
	const function_start = main.indexOf(`function ${function_name}`);
	const function_end_marker = function_name === 'update_charitree_nav'
		? 'function update_multiplayer_nav'
		: '\n// #endregion';
	const function_end = main.indexOf(function_end_marker, function_start);
	if (function_start < 0 || function_end < 0)
		throw new Error(`Unable to extract sidebar function: ${function_name}`);

	return new Function(...parameters, `
		function set_nav_ready(aside, ready) {
			aside.classList.toggle('mp-nav-ready', ready);
		}
		${main.slice(function_start, function_end)}; return ${function_name};
	`);
}
