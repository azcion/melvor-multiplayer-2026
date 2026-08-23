import { readFile } from 'node:fs/promises';

const source_files = [
	'mod/main.mjs',
	'mod/client-actions-common.mjs',
	'mod/client-actions-chat.mjs',
	'mod/client-actions-market-campaign-charity.mjs',
	'mod/client-actions-trading.mjs',
	'mod/client-actions-transfer.mjs',
	'mod/client-actions-social.mjs',
	'mod/client-components.mjs'
];

export async function read_client_source(root = new URL('../../', import.meta.url)) {
	const sources = await Promise.all(source_files.map(file =>
		readFile(new URL(file, root), 'utf8')
	));
	return sources.join('\n');
}
