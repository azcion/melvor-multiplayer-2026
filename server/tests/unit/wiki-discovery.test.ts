import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create_test_database } from '../support/database';

test('advertises configured wiki URLs and falls back for invalid configuration', async () => {
	for (const [configured, expected] of [
		['https://wiki.example/custom', 'https://wiki.example/custom'],
		['javascript:alert(1)', 'https://melvor.azcn.io/wiki'],
		['https://user:pass@example.com/', 'https://melvor.azcn.io/wiki']
	]) {
		const directory = mkdtempSync(join(tmpdir(), 'melvor-wiki-'));
		const database_path = join(directory, 'database.sqlite');
		create_test_database(database_path).close();
		const server = Bun.spawn([process.execPath, 'run', 'index.ts'], {
			cwd: join(import.meta.dir, '../..'),
			env: { ...process.env, DB_PATH: database_path, SERVER_PORT: '0', FILE_OPERATIONAL_LOGS: '0', WIKI_URL: configured },
			stdout: 'pipe', stderr: 'pipe'
		});
		let stdout = '';
		let ready!: (port: string) => void;
		const started = new Promise<string>(resolve => { ready = resolve; });
		const output = (async () => {
			for await (const chunk of server.stdout) {
				stdout += new TextDecoder().decode(chunk);
				const match = /event=started port=(\d+)/.exec(stdout);
				if (match) ready(match[1]);
			}
		})();
		const stderr = new Response(server.stderr).text();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			const port = await Promise.race([
				started,
				server.exited.then(code => { throw new Error(`Wiki fixture server exited (${code}): ${stdout}`); }),
				new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Wiki fixture startup timed out')), 5000); })
			]);
			const response = await fetch(`http://127.0.0.1:${port}/api/versions`);
			expect(response.status).toBe(200);
			expect((await response.json() as { wiki_url: string }).wiki_url).toBe(expected);
		} finally {
			clearTimeout(timeout);
			server.kill();
			await server.exited;
			await output;
			const errors = await stderr;
			rmSync(directory, { recursive: true, force: true });
			expect(errors).toBe('');
		}
	}
}, 20000);
