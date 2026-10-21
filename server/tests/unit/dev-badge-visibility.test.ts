import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create_test_database } from '../support/database';

test('preserves badge visibility across authentication and Guild reads in an isolated server', async () => {
	// Badge eligibility intentionally uses fixed account IDs. Never reserve or overwrite
	// those IDs in the shared API database, where unrelated fixtures allocate accounts.
	const directory = mkdtempSync(join(tmpdir(), 'melvor-dev-badge-'));
	const database_path = join(directory, 'database.sqlite');
	create_test_database(database_path).close();
	const env = { ...process.env, DB_PATH: database_path, TEST_DB_PATH: database_path,
		SERVER_PORT: '0', FILE_OPERATIONAL_LOGS: '0', AUTH_RESPONSE_DELAY_MS: '0',
		POLL_CREATOR_CLIENT_IDENTIFIERS_CONFIGURED: '1', POLL_CREATOR_CLIENT_IDENTIFIERS: '11111111-1111-4111-8111-111111111111',
		REGISTRATIONS_PER_SOURCE_HOUR: '100', REQUEST_SOURCE_BURST: '1000', REQUEST_IDENTITY_BURST: '1000' };
	const cwd = join(import.meta.dir, '../..');
	const server = Bun.spawn([process.execPath, 'run', 'index.ts'], {
		cwd, env, stdout: 'pipe', stderr: 'pipe'
	});
	let stdout = '';
	const stderr = new Response(server.stderr).text();
	let ready!: (port: string) => void;
	const started = new Promise<string>(resolve => { ready = resolve; });
	const output = (async () => {
		const decoder = new TextDecoder();
		for await (const chunk of server.stdout) {
			stdout += decoder.decode(chunk, { stream: true });
			const match = /event=started port=(\d+)/.exec(stdout);
			if (match) ready(match[1]);
		}
	})();
	let startup_timeout: ReturnType<typeof setTimeout> | undefined;
	let runner: ReturnType<typeof Bun.spawn> | undefined;
	try {
		const port = await Promise.race([
			started,
			server.exited.then(code => { throw new Error(`Badge fixture server exited (${code}): ${stdout}`); }),
			new Promise<never>((_, reject) => {
				startup_timeout = setTimeout(() => reject(new Error('Badge fixture server startup timed out')), 5000);
			})
		]);
		clearTimeout(startup_timeout);
		const test_process = Bun.spawn([process.execPath, 'test', '--timeout', '10000', './tests/support/dev-badge-visibility.fixture.ts'], {
			cwd, env: { ...env, TEST_SERVER_URL: `http://127.0.0.1:${port}` }, stdout: 'pipe', stderr: 'pipe'
		});
		runner = test_process;
		const [exit_code, test_stdout, test_stderr] = await Promise.all([
			test_process.exited, new Response(test_process.stdout).text(), new Response(test_process.stderr).text()
		]);
		expect({ exit_code, diagnostics: exit_code === 0 ? '' : test_stdout + test_stderr + stdout })
			.toEqual({ exit_code: 0, diagnostics: '' });
	} finally {
		clearTimeout(startup_timeout);
		runner?.kill();
		if (runner) await runner.exited;
		server.kill();
		await server.exited;
		await output;
		const server_stderr = await stderr;
		rmSync(directory, { recursive: true, force: true });
		expect(server_stderr).toBe('');
	}
}, 15000);
