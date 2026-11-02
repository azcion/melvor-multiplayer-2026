import { realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { output_root } from './build.mjs';

export const headers = {
	'Cache-Control': 'no-cache', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
	'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.melvor.azcn.io; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain; charset=utf-8'};
export function preview_server(root = output_root) {
	return createServer(async (req,res) => {
		try {
			const url = new URL(req.url,'http://localhost');
			const path = decodeURIComponent(url.pathname);
			if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405,{...headers,Allow:'GET, HEAD'}); res.end(); return; }
			if (path === '/wiki') { res.writeHead(308,{...headers,Location:'/wiki/'+url.search}); res.end(); return; }
			if (!path.startsWith('/wiki/') || path.includes('\\') || path.includes('\0')) throw new Error('Not found');
			let file = resolve(root,'.'+path);
			if (!file.startsWith(resolve(root)+sep)) throw new Error('Not found');
			const entry = await stat(file);
			if (entry.isDirectory()) {
				if (!path.endsWith('/')) { res.writeHead(308,{...headers,Location:path+'/'+url.search}); res.end(); return; }
				file = join(file,'index.html');
			}
			const content = await readFile(file);
			res.writeHead(200,{...headers,'Content-Type':types[extname(file)] ?? 'application/octet-stream'});
			res.end(req.method === 'HEAD' ? undefined : content);
		} catch {
			res.writeHead(404,{...headers,'Content-Type':'text/html; charset=utf-8'});
			const page = await readFile(join(root,'wiki/404.html')).catch(() => 'Build the wiki first.');
			res.end(req.method === 'HEAD' ? undefined : page);
		}
	});
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
	const port = Number(process.env.WIKI_PORT ?? 3080);
	preview_server().listen(port,'127.0.0.1',() => console.log(`Wiki preview: http://127.0.0.1:${port}/wiki/`));
}
