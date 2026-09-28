#!/usr/bin/env node
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { EXPEDITION_BASE_SKILLS, EXPEDITION_CONTENT_PREVIEW, EXPEDITION_DLC_SKILLS,
	validate_expedition_content } from '../server/expedition-content.ts';

const content_path = fileURLToPath(new URL('../server/expedition-content-v1.json', import.meta.url));
const assets = new Map([
	['/', ['index.html', 'text/html; charset=utf-8']],
	['/editor.css', ['editor.css', 'text/css; charset=utf-8']],
	['/editor.mjs', ['editor.mjs', 'text/javascript; charset=utf-8']]
]);
const skill_names = new Map([
	['melvorD:AltMagic', 'Alt. Magic'], ['melvorD:Combat', 'Combat']
]);
const icon_names = new Map([['melvorD:AltMagic', 'magic']]);

function revision(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function send(response, code, body, content_type = 'application/json; charset=utf-8') {
	response.writeHead(code, {
		'Content-Type': content_type,
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
		'Referrer-Policy': 'no-referrer',
		'Content-Security-Policy': "default-src 'self'; img-src 'self' https://melvoridle.com data:; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'"
	});
	response.end(content_type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function graph_only(content) {
	return JSON.stringify({ version: content.version, status: content.status,
		chambers: content.chambers?.map(({ tasks, ...chamber }) => chamber) });
}

async function read_request(request) {
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > 2_000_000) throw new Error('Request is too large');
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function write_content(path, bytes) {
	const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
	let file;
	try {
		file = await open(temp, 'wx', 0o600);
		await file.writeFile(bytes);
		await file.sync();
		await file.close();
		file = null;
		await rename(temp, path);
	} finally {
		if (file) await file.close();
		await unlink(temp).catch(() => {});
	}
}

export function create_editor_server({ path = content_path } = {}) {
	return createServer(async (request, response) => {
		const address = request.socket.localAddress;
		const expected_host = `127.0.0.1:${request.socket.localPort}`;
		if (address !== '127.0.0.1' || request.headers.host !== expected_host) {
			send(response, 403, { error: 'Localhost access only' });
			return;
		}
		const url = new URL(request.url ?? '/', `http://${expected_host}`);
		try {
			if (request.method === 'GET' && url.pathname === '/api/content') {
				const bytes = await readFile(path);
				send(response, 200, { revision: revision(bytes), content: JSON.parse(bytes.toString('utf8')),
					preview_route: EXPEDITION_CONTENT_PREVIEW.preview_route });
				return;
			}
			if (request.method === 'GET' && url.pathname === '/api/skills') {
				const skills = [...EXPEDITION_BASE_SKILLS, ...EXPEDITION_DLC_SKILLS].map(id => {
					const name = skill_names.get(id) ?? id.split(':')[1];
					const icon = icon_names.get(id) ?? id.split(':')[1].toLowerCase();
					return { id, name, group: EXPEDITION_BASE_SKILLS.has(id) ? 'Base game' : 'Official DLC',
						icon: `https://melvoridle.com/assets/media/skills/${icon}/${icon}.svg` };
				});
				send(response, 200, { skills });
				return;
			}
			if (request.method === 'PUT' && url.pathname === '/api/content') {
				if (request.headers.origin !== `http://${expected_host}` ||
					!request.headers['content-type']?.startsWith('application/json')) {
					send(response, 403, { error: 'Invalid editor request' });
					return;
				}
				const input = await read_request(request);
				const current_bytes = await readFile(path);
				if (input?.revision !== revision(current_bytes)) {
					send(response, 409, { error: 'The source file changed outside this editor. Reload before saving.' });
					return;
				}
				const current = JSON.parse(current_bytes.toString('utf8'));
				if (graph_only(input.content) !== graph_only(current)) {
					send(response, 400, { error: 'Chamber graph and content version cannot be edited here.' });
					return;
				}
				validate_expedition_content(input.content);
				const bytes = Buffer.from(JSON.stringify(input.content, null, 2) + '\n');
				await write_content(path, bytes);
				send(response, 200, { revision: revision(bytes) });
				return;
			}
			const asset = request.method === 'GET' ? assets.get(url.pathname) : null;
			if (asset) {
				send(response, 200, await readFile(new URL(`./expedition-editor/${asset[0]}`, import.meta.url)), asset[1]);
				return;
			}
			send(response, 404, { error: 'Not found' });
		} catch (error) {
			const invalid = error instanceof SyntaxError || error.message?.startsWith('Invalid Expedition content:') ||
				error.message === 'Request is too large' || error instanceof TypeError;
			send(response, invalid ? 400 : 500, { error: invalid ? error.message : 'Editor failed to read or save the source file.' });
		}
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const port = Number(process.env.EXPEDITION_EDITOR_PORT ?? 4173);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid EXPEDITION_EDITOR_PORT');
	create_editor_server().listen(port, '127.0.0.1', () => {
		process.stdout.write(`Expedition editor: http://127.0.0.1:${port}/\n`);
	});
}
