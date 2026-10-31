import { db_all } from './persistence';

// Commit the former donation shape to the isolated test database, simulating an upgrade.
// This does not expose a donation bypass in the running API.
export async function legacy_supply<T = any>(path: string, payload: Record<string, unknown>, token: string): Promise<{ json: T }> {
	const client = (await db_all<{ client_id: number }>('SELECT client_id FROM client_sessions WHERE session_token = ?', [token]))[0];
	if (!client) throw new Error('Legacy fixture requires a test session');
	const child = Bun.spawn([process.execPath, '-e', `
		const { donate_expedition_supply } = await import('./tests/support/legacy-expedition-supplies.ts');
		console.log(JSON.stringify(donate_expedition_supply(${client.client_id}, ${JSON.stringify(payload.command_id)}, ${JSON.stringify(payload)})));
	`], { env: { ...process.env, DB_PATH: process.env.TEST_DB_PATH }, stdout: 'pipe', stderr: 'pipe' });
	const output = await new Response(child.stdout).text();
	const error = await new Response(child.stderr).text();
	if (await child.exited) throw new Error(error);
	return { json: JSON.parse(output.trim().split('\n').at(-1)!) as T };
}
