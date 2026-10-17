import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import {
	browser_origin_configuration,
	CHAT_SESSION_IDLE,
	CHAT_SESSION_LIFETIME,
	get_browser_session,
	get_browser,
	get_browser_record,
	list_browser_identities,
	revoke_browser,
	issue_browser_code,
	pair_browser,
	revoke_browser_session,
	secret_hash
} from '../../browser-chat-auth';
function fixture() {
	const db = create_test_database();
	db.query(
		"INSERT INTO clients(client_identifier,client_key,friend_code,display_name,icon_id) VALUES ('a','b','c','Test','x')"
	).run();
	return db;
}
test('pairing is hashed, normalized, one-use, expires, and issuance rate window is durable', () => {
	const db = fixture(),
		now = 1000000;
	const first = issue_browser_code(db, 1, now);
	expect(first.status).toBe(200);
	expect(db.query('SELECT code_hash FROM chat_pairing_codes').get()).toEqual({
		code_hash: secret_hash(first.code!.replaceAll('-', ''))
	});
	const pair = pair_browser(db, first.code!.toLowerCase(), now)!;
	expect(pair).not.toBeNull();
	expect(pair_browser(db, first.code, now)).toBeNull();
	expect(get_browser_session(db, pair.token, pair.id, now)?.client_id).toBe(1);
	expect(get_browser_session(db, pair.token, pair.id, now + CHAT_SESSION_IDLE)).toBeNull();
	db.query('UPDATE chat_browser_sessions SET last_browser_seen_at=? WHERE id=?').run(
		now + CHAT_SESSION_LIFETIME - 1,
		pair.id
	);
	expect(get_browser_session(db, pair.token, pair.id, now + CHAT_SESSION_LIFETIME)).toBeNull();
	issue_browser_code(db, 1, now);
	const third = issue_browser_code(db, 1, now);
	expect(pair_browser(db, third.code, now + 300000)).toBeNull();
	expect(issue_browser_code(db, 1, now).status).toBe(429);
	expect(issue_browser_code(db, 1, now + 600000).status).toBe(200);
	db.close();
});
test('disable and deletion permanently invalidate links; owner revocation is isolated', () => {
	for (const transition of ['disabled=1', 'deleted_at=123']) {
		const db = fixture(),
			now = 1000000;
		const pair = pair_browser(db, issue_browser_code(db, 1, now).code, now)!;
		const unused = issue_browser_code(db, 1, now).code;
		revoke_browser_session(db, 2, pair.id, now);
		expect(get_browser_session(db, pair.token, pair.id, now)).not.toBeNull();
		db.run(`UPDATE clients SET ${transition} WHERE id=1`);
		db.run('UPDATE clients SET disabled=0,deleted_at=NULL WHERE id=1');
		expect(get_browser_session(db, pair.token, pair.id, now)).toBeNull();
		expect(pair_browser(db, unused, now)).toBeNull();
		db.close();
	}
});
test('capacity is bounded and old unused code is replaced', () => {
	const db = fixture();
	let now = 1000000;
	const old = issue_browser_code(db, 1, now).code;
	const fresh = issue_browser_code(db, 1, now).code;
	expect(pair_browser(db, old, now)).toBeNull();
	expect(pair_browser(db, fresh, now)).not.toBeNull();
	for (let n = 1; n < 10; n++) {
		now += 600001;
		expect(pair_browser(db, issue_browser_code(db, 1, now).code, now)).not.toBeNull();
	}
	expect(issue_browser_code(db, 1, now).status).toBe(409);
	db.close();
});
test('origin configuration fails closed except explicitly configured loopback HTTP', () => {
	expect(browser_origin_configuration().secure).toBe(true);
	expect(browser_origin_configuration('http://127.0.0.1:3000').cookie_name).toBe('mp-chat-local');
	for (const origin of ['http://example.com', 'https://example.com/', 'https://user@example.com'])
		expect(() => browser_origin_configuration(origin)).toThrow();
});

test('file-backed reopen retains bearer, consumed codes, revocation and issuance window', async () => {
	const { mkdtempSync, rmSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');
	const { Database } = await import('bun:sqlite');
	const dir = mkdtempSync(`${tmpdir()}/chat-auth-`),
		path = `${dir}/db.sqlite`,
		now = 1000000;
	let db = create_test_database(path);
	try {
		db.query(
			"INSERT INTO clients(client_identifier,client_key,friend_code,display_name,icon_id) VALUES ('a','b','c','Test','x')"
		).run();
		const consumed = issue_browser_code(db, 1, now).code;
		const session = pair_browser(db, consumed, now)!;
		const revoked = pair_browser(db, issue_browser_code(db, 1, now).code, now)!;
		revoke_browser_session(db, 1, revoked.id, now);
		const unused = issue_browser_code(db, 1, now).code;
		db.close();
		db = new Database(path, { strict: true });
		db.run('PRAGMA foreign_keys=ON');
		expect(get_browser_session(db, session.token, session.id, now)?.client_id).toBe(1);
		expect(get_browser_session(db, revoked.token, revoked.id, now)).toBeNull();
		expect(pair_browser(db, consumed, now)).toBeNull();
		expect(issue_browser_code(db, 1, now).status).toBe(429);
		expect(pair_browser(db, unused, now)).not.toBeNull();
	} finally {
		db.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test('same-origin-style GET without Origin requires CSRF through the actual wrapper', async () => {
	const runtime = await import('../../app-runtime');
	const { authenticated_chat_browser } = await import('../../routes/browser-chat-auth');
	const result = runtime.db
		.query(
			"INSERT INTO clients(client_identifier,client_key,friend_code,display_name,icon_id) VALUES (?,?,?,'Wrapper','x')"
		)
		.run(crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID());
	const id = Number(result.lastInsertRowid);
	try {
		const pair = pair_browser(runtime.db, issue_browser_code(runtime.db, id).code)!;
		const { browser_csrf } = await import('../../browser-chat-auth');
		const handler = authenticated_chat_browser(() => ({ ok: true }));
		const headers = { Cookie: `__Secure-mp-chat=${pair.token}`, 'Sec-Fetch-Site': 'same-origin', 'X-Chat-Link-ID': String(pair.id) };
		const invoke = (extra: Record<string, string>) => {
			const req = new Request('https://melvor.azcn.io/chat/api/state', { headers: { ...headers, ...extra } });
			return handler(req, new URL(req.url));
		};
		expect(((await invoke({})) as Response).status).toBe(403);
		expect(((await invoke({ 'X-Chat-CSRF': 'wrong' })) as Response).status).toBe(403);
		expect(((await invoke({ 'X-Chat-CSRF': browser_csrf(pair.token) })) as Response).status).toBe(200);
		expect(
			((await invoke({ 'X-Chat-CSRF': browser_csrf(pair.token), Origin: 'null' })) as Response).status
		).toBe(403);
		expect(
			(
				(await invoke({
					'X-Chat-CSRF': browser_csrf(pair.token),
					'Sec-Fetch-Site': 'cross-site'
				})) as Response
			).status
		).toBe(403);
	} finally {
		runtime.db.query('DELETE FROM clients WHERE id=?').run(id);
	}
});

test('190 and additive 191 preserve populated legacy sessions, hashes, IDs, game rows and foreign keys', async () => {
	const { Database } = await import('bun:sqlite');
	const { migrations } = await import('../../db/schema');
	const db = new Database(':memory:', { strict: true });
	db.run('PRAGMA foreign_keys=ON');
	try {
		for (const migration of migrations.filter(m => m.version <= 190)) {
			if (migration.foreign_keys_disabled) db.run('PRAGMA foreign_keys=OFF');
			db.transaction(() => { db.run(migration.sql); db.run(`PRAGMA user_version=${migration.version}`); }).immediate();
			db.run('PRAGMA foreign_keys=ON');
		}
		db.query("INSERT INTO clients(client_identifier,client_key,friend_code,display_name,icon_id) VALUES ('legacy','key','friend','Legacy','x')").run();
		db.query("INSERT INTO client_sessions(session_token,client_id) VALUES ('existing-game-token',1)").run();
		const token = 'a'.repeat(64), revoked = 'b'.repeat(64), now = 1000000;
		for (const [secret, revocation] of [[token, null], [revoked, 99]] as const)
			db.query('INSERT INTO chat_browser_sessions(token_hash,client_id,created_at,expires_at,last_browser_seen_at,revoked_at) VALUES (?,1,?,?,?,?)')
				.run(secret_hash(secret), now, now + CHAT_SESSION_LIFETIME, now, revocation);
		const before = db.query('SELECT * FROM clients').all();
		const sessions = db.query('SELECT * FROM client_sessions').all();
		const links = db.query('SELECT * FROM chat_browser_sessions ORDER BY id').all();
		const migration = migrations.find(m => m.version === 191)!;
		db.transaction(() => { db.run(migration.sql); db.run('PRAGMA user_version=191'); }).immediate();
		expect(db.query('SELECT * FROM clients').all()).toEqual(before);
		expect(db.query('SELECT * FROM client_sessions').all()).toEqual(sessions);
		expect(db.query('SELECT id,token_hash,client_id,created_at,expires_at,last_browser_seen_at,revoked_at FROM chat_browser_sessions ORDER BY id').all()).toEqual(links);
		expect(get_browser_session(db, token, 1, now)?.client_id).toBe(1);
		expect(get_browser_record(db, revoked)).toBeNull();
		expect(get_browser_session(db, revoked, 2, now)).toBeNull();
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
		// Existing source can still insert its old shape; it grants no authority
		// through the new browser wrapper without an explicit container binding.
		db.query('INSERT INTO chat_browser_sessions(token_hash,client_id,created_at,expires_at,last_browser_seen_at) VALUES (?,1,?,?,?)')
			.run(secret_hash('c'.repeat(64)), now, now + CHAT_SESSION_LIFETIME, now);
		expect(get_browser_record(db, 'c'.repeat(64))).toBeNull();
		db.run('DELETE FROM clients WHERE id=1');
		expect(db.query('SELECT * FROM chat_browser_sessions').all()).toEqual([]);
		expect(get_browser(db, token, now)).toBeNull();
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { db.close(); }
});

test('exchange budgets use trusted source model, service cap and explicit process-local reset', async () => {
	const { create_browser_exchange_limits } = await import('../../browser-chat-auth');
	const limits = create_browser_exchange_limits(false);
	for (let i = 0; i < 5; i++)
		expect(
			limits.limit_source(
				new Request('https://melvor.azcn.io/chat/api/pair', {
					headers: { 'X-Forwarded-For': `192.0.2.${i}`, 'CF-Connecting-IP': `192.0.2.${i}` }
				})
			)
		).toBeNull();
	const throttled = limits.limit_source(new Request('https://melvor.azcn.io/chat/api/pair'))!;
	expect(throttled.status).toBe(429);
	expect(Number(throttled.headers.get('Retry-After'))).toBeGreaterThan(0);
	expect(
		create_browser_exchange_limits(false).limit_source(new Request('https://melvor.azcn.io/chat/api/pair'))
	).toBeNull();
	const service = create_browser_exchange_limits(true);
	for (let i = 0; i < 1000; i++)
		expect(
			service.limit_registration(
				new Request('https://melvor.azcn.io/chat/api/pair', {
					headers: { 'CF-Connecting-IP': `192.0.${Math.floor(i / 250)}.${(i % 250) + 1}` }
				})
			)
		).toBeNull();
	const serviceLimited = service.limit_registration(
		new Request('https://melvor.azcn.io/chat/api/pair', { headers: { 'CF-Connecting-IP': '198.51.100.1' } })
	)!;
	expect(serviceLimited.status).toBe(429);
	expect(Number(serviceLimited.headers.get('Retry-After'))).toBeGreaterThan(0);
});

function add_client(db: ReturnType<typeof fixture>, name = crypto.randomUUID()): number {
	return Number(db.query("INSERT INTO clients(client_identifier,client_key,friend_code,display_name,icon_id) VALUES (?,?,?,?,'x')")
		.run(crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), name).lastInsertRowid);
}
test('browser links have independent authority, clocks, revocation and fresh-code relinking', () => {
	const db = fixture(), now = 1000000;
	try {
		const b = add_client(db), c = add_client(db);
		const a_link = pair_browser(db, issue_browser_code(db, 1, now).code, now)!;
		const b_link = pair_browser(db, issue_browser_code(db, b, now).code, now, a_link.token)!;
		expect(b_link.token).toBe(a_link.token);
		expect(b_link.fresh).toBe(false);
		const browser = get_browser(db, a_link.token, now)!;
		expect(list_browser_identities(db, browser.id, now).map(link => link.client_id)).toEqual([1, b]);
		expect(get_browser_session(db, a_link.token, c, now)).toBeNull();
		expect(get_browser_session(db, '0'.repeat(64), b_link.id, now)).toBeNull();
		const duplicate_code = issue_browser_code(db, b, now).code;
		const duplicate = pair_browser(db, duplicate_code, now + 50, a_link.token)!;
		expect(duplicate.id).toBe(b_link.id);
		expect(duplicate.expires_at).toBe(b_link.expires_at);
		expect(pair_browser(db, duplicate_code, now + 50, a_link.token)).toBeNull();
		expect(list_browser_identities(db, browser.id, now)[1].last_browser_seen_at).toBe(now);
		revoke_browser_session(db, 1, a_link.id, now);
		expect(get_browser_session(db, a_link.token, a_link.id, now)).toBeNull();
		expect(get_browser_session(db, a_link.token, b_link.id, now)).not.toBeNull();
		const relink = pair_browser(db, issue_browser_code(db, 1, now + 100).code, now + 100, a_link.token)!;
		expect(relink.id).not.toBe(a_link.id);
		expect(get_browser_session(db, a_link.token, a_link.id, now + 100)).toBeNull();
		// Looking at the selector does not keep either identity alive.
		db.query('UPDATE chat_browser_sessions SET last_browser_seen_at=? WHERE id=?').run(now + CHAT_SESSION_IDLE, b_link.id);
		expect(get_browser_session(db, a_link.token, relink.id, now + 100 + CHAT_SESSION_IDLE)).toBeNull();
		expect(get_browser_session(db, a_link.token, b_link.id, now + 100 + CHAT_SESSION_IDLE)).not.toBeNull();
		db.query('UPDATE chat_browser_sessions SET expires_at=? WHERE id=?').run(now + CHAT_SESSION_IDLE, b_link.id);
		expect(get_browser(db, a_link.token, now + 100 + CHAT_SESSION_IDLE)).toBeNull();
		const code = issue_browser_code(db, c, now + 100 + CHAT_SESSION_IDLE).code;
		expect(pair_browser(db, code, now + 100 + CHAT_SESSION_IDLE, a_link.token)).toBeNull();
		expect(pair_browser(db, code, now + 100 + CHAT_SESSION_IDLE)).not.toBeNull();
	} finally { db.close(); }
});

test('browser capacity is transactional, duplicate pairing needs no extra capacity, logout-all blocks pending codes', () => {
	const db = fixture(), now = 1000000;
	try {
		const first = pair_browser(db, issue_browser_code(db, 1, now).code, now)!;
		for (let n = 1; n < 10; n++) {
			const client_id = add_client(db);
			expect(pair_browser(db, issue_browser_code(db, client_id, now).code, now, first.token)).not.toBeNull();
		}
		expect(list_browser_identities(db, get_browser(db, first.token, now)!.id, now)).toHaveLength(10);
		const duplicate = pair_browser(db, issue_browser_code(db, 1, now).code, now, first.token)!;
		expect(duplicate.id).toBe(first.id);
		const overflow = add_client(db), code = issue_browser_code(db, overflow, now).code;
		expect(pair_browser(db, code, now, first.token)).toBeNull();
		expect(revoke_browser(db, first.token, now)).toBe(true);
		expect(revoke_browser(db, first.token, now)).toBe(false);
		expect(get_browser_record(db, first.token)).toBeNull();
		expect(pair_browser(db, code, now, first.token)).toBeNull();
		expect(pair_browser(db, code, now)).not.toBeNull();
		expect(db.query('SELECT COUNT(*) n FROM chat_browser_sessions WHERE browser_id=1 AND revoked_at IS NULL').get()).toEqual({ n: 0 });
	} finally { db.close(); }
});

test('selected wrapper rejects ambiguous selection and rechecks revocation after asynchronous body parsing', async () => {
	const runtime = await import('../../app-runtime');
	const { authenticated_chat_browser } = await import('../../routes/browser-chat-auth');
	const { browser_csrf } = await import('../../browser-chat-auth');
	const client_id = add_client(runtime.db);
	try {
		const pair = pair_browser(runtime.db, issue_browser_code(runtime.db, client_id).code)!;
		let calls = 0;
		const handler = authenticated_chat_browser((_req, _url, session) => { calls++; return { client_id: session.client_id }; });
		const headers = { Cookie: `__Secure-mp-chat=${pair.token}`, Origin: 'https://melvor.azcn.io', 'X-Chat-CSRF': browser_csrf(pair.token) };
		for (const selector of [undefined, '', '0', '-1', '1, 2', '01', '9007199254740992']) {
			const req = new Request('https://melvor.azcn.io/chat/api/state', { headers: { ...headers, ...(selector === undefined ? {} : { 'X-Chat-Link-ID': selector }) } });
			expect(((await handler(req, new URL(req.url))) as Response).status).toBe(400);
		}
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
		const req = new Request('https://melvor.azcn.io/chat/api/mutation', {
			method: 'POST', headers: { ...headers, 'X-Chat-Link-ID': String(pair.id), 'Content-Type': 'application/json' }, body: stream
		});
		const pending = handler(req, new URL(req.url));
		revoke_browser(runtime.db, pair.token);
		controller.enqueue(new TextEncoder().encode('{}'));
		controller.close();
		expect(((await pending) as Response).status).toBe(401);
		expect(calls).toBe(0);
	} finally { runtime.db.query('DELETE FROM clients WHERE id=?').run(client_id); }
});

test('independent SQLite connections serialize concurrent additions, capacity and logout-all', async () => {
	const { mkdtempSync, rmSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');
	const dir = mkdtempSync(`${tmpdir()}/chat-links-race-`), path = `${dir}/db.sqlite`;
	const db = create_test_database(path), now = 1000000;
	const module_url = new URL('../../browser-chat-auth.ts', import.meta.url).href;
	const script = `
		import { Database } from 'bun:sqlite';
		const { pair_browser, revoke_browser } = await import(${JSON.stringify(module_url)});
		const input = JSON.parse(await Bun.stdin.text());
		const db = new Database(input.path, { strict: true });
		db.run('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
		try {
			const result = input.logout ? revoke_browser(db,input.token,input.now) : pair_browser(db,input.code,input.now,input.token);
			process.stdout.write(JSON.stringify(input.logout ? result : result?.id ?? null));
		} finally { db.close(); }
	`;
	async function concurrent(inputs: { token: string; code?: string; logout?: boolean }[]) {
		const children = inputs.map(input => {
			const child = Bun.spawn([process.execPath, '--eval', script], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
			child.stdin.write(JSON.stringify({ ...input, path, now }));
			child.stdin.end();
			return child;
		});
		return Promise.all(children.map(async child => {
			const output = await new Response(child.stdout).text();
			const error = await new Response(child.stderr).text();
			expect(await child.exited, error).toBe(0);
			return JSON.parse(output) as number | null | boolean;
		}));
	}
	try {
		const a = add_client(db), first = pair_browser(db, issue_browser_code(db, a, now).code, now)!;
		const b = add_client(db), c = add_client(db);
		const additions = await concurrent([b, c].map(client => ({ token: first.token, code: issue_browser_code(db, client, now).code })));
		expect(additions.every(id => typeof id === 'number')).toBe(true);
		const browser = get_browser(db, first.token, now)!;
		expect(list_browser_identities(db, browser.id, now)).toHaveLength(3);
		for (let n = 3; n < 9; n++) {
			const client = add_client(db);
			expect(pair_browser(db, issue_browser_code(db, client, now).code, now, first.token)).not.toBeNull();
		}
		const at_capacity = await concurrent([add_client(db), add_client(db)].map(client => ({ token: first.token, code: issue_browser_code(db, client, now).code })));
		expect(at_capacity.filter(id => typeof id === 'number')).toHaveLength(1);
		expect(at_capacity.filter(id => id === null)).toHaveLength(1);
		expect(list_browser_identities(db, browser.id, now)).toHaveLength(10);
		revoke_browser_session(db, a, first.id, now);
		const pending = add_client(db), pending_code = issue_browser_code(db, pending, now).code!;
		const [paired, logged_out] = await concurrent([{ token: first.token, code: pending_code }, { token: first.token, logout: true }]);
		expect(logged_out).toBe(true);
		expect(get_browser_record(db, first.token)).toBeNull();
		expect(db.query('SELECT COUNT(*) n FROM chat_browser_sessions WHERE browser_id=? AND revoked_at IS NULL').get(browser.id)).toEqual({ n: 0 });
		expect(db.query('SELECT consumed_at FROM chat_pairing_codes WHERE client_id=?').get(pending)).toEqual({ consumed_at: paired === null ? null : now });
		if (paired === null) expect(pair_browser(db, pending_code, now)).not.toBeNull();
	} finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('identity invalidation affects only that browser link and cannot resurrect on recovery', () => {
	for (const transition of ['disabled=1', 'deleted_at=123']) {
		const db = fixture(), now = 1000000;
		try {
			const b = add_client(db), first = pair_browser(db, issue_browser_code(db, 1, now).code, now)!;
			const second = pair_browser(db, issue_browser_code(db, b, now).code, now, first.token)!;
			const unused = issue_browser_code(db, 1, now).code;
			db.run(`UPDATE clients SET ${transition} WHERE id=1`);
			db.run('UPDATE clients SET disabled=0,deleted_at=NULL WHERE id=1');
			expect(get_browser_session(db, first.token, first.id, now)).toBeNull();
			expect(get_browser_session(db, first.token, second.id, now)?.client_id).toBe(b);
			expect(pair_browser(db, unused, now, first.token)).toBeNull();
		} finally { db.close(); }
	}
});
