import { expect, test } from 'bun:test';

test('settles Campaigns once and keeps returned items behind the 1.6.0 Inbox boundary', async () => {
	const subprocess = Bun.spawn(['bun', 'run', 'tests/support/campaign-retirement-fixture.ts'], {
		cwd: new URL('../..', import.meta.url).pathname,
		env: { ...process.env, DB_PATH: `/tmp/campaign-retirement-${crypto.randomUUID()}.sqlite` },
		stdout: 'pipe', stderr: 'pipe'
	});
	const exit_code = await subprocess.exited;
	const stderr = await new Response(subprocess.stderr).text();
	expect(stderr).toBe('');
	expect(exit_code).toBe(0);
});
