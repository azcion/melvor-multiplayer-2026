import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { create_identity_recovery_service, verify_melvor_account, type AccountVerifier } from '../../identity-recovery';
import { verified_identity_accounts_migration } from '../../db/schema/migrations/verified-identity-accounts';
import { identity_recovery_state_migration } from '../../db/schema/migrations/identity-recovery-state';

const token = 'test.payload.signature'; // Synthetic fixture, never a real login credential.
const verified = { playfab_id: 'ACCOUNT-A', username: 'Unchanging Username' };
function fixture(verifier: AccountVerifier = async () => verified) {
	const db = new Database(':memory:');
	db.exec(`PRAGMA foreign_keys=ON;
		CREATE TABLE melvor_accounts(id INTEGER PRIMARY KEY,playfab_id TEXT);
		CREATE TABLE clients(id INTEGER PRIMARY KEY,melvor_account_id INTEGER,display_name TEXT,disabled INTEGER DEFAULT 0,
		deleted_at INTEGER,last_multiplayer_active_at INTEGER DEFAULT 0,client_identifier TEXT,client_key TEXT);
		INSERT INTO melvor_accounts VALUES(1,'account-a'),(2,'ACCOUNT-B');
		INSERT INTO clients(id,melvor_account_id,display_name,last_multiplayer_active_at,client_identifier,client_key)
		VALUES(1,1,'Renamed Profile',100,'client-one','proof-one'),(2,1,'Another Profile',200,'client-two','proof-two'),
		(3,2,'Same Name',300,'client-three','proof-three'),(4,1,'Same Name',400,'client-four','proof-four');`);
	db.exec(verified_identity_accounts_migration.sql);
	db.exec(identity_recovery_state_migration.sql);
	return { db, service: create_identity_recovery_service(db, verifier) };
}
const input = { melvor_token: token, character_name: 'Same Name' };

test('migration preserves old profiles without inferring native names or recovery authority', () => {
	const { db } = fixture();
	try {
		expect(db.query('SELECT registration_character_name,account_recovery_revocation FROM clients WHERE id=1').get())
			.toEqual({ registration_character_name: null, account_recovery_revocation: '' });
		expect(db.query('SELECT * FROM verified_identity_accounts').all()).toEqual([]);
	} finally { db.close(); }
});

test('disable invalidates pending first enrollment and refresh but allows a later explicit enrollment', async () => {
	for (const already_enabled of [false, true]) {
		const { db, service } = fixture();
		try {
			if (already_enabled) await service.enroll(1, input, () => true);
			let finish!: (value: typeof verified) => void;
			const delayed = create_identity_recovery_service(db, () => new Promise(resolve => { finish = resolve; }));
			const pending = delayed.enroll(1, input, () => true);
			const disabled = service.disable(1);
			expect(disabled.status).toBe(200);
			expect(disabled.headers.get('Cache-Control')).toBe('no-store');
			finish(verified);
			expect((await pending).status).toBe(409);
			expect(await (await service.list(input)).json()).toEqual({ identities: [] });
			expect((await service.connect({ ...input, client_id: 1 })).status).toBe(404);
			expect((await service.enroll(1, input, () => true)).status).toBe(200);
			expect((await (await service.list(input)).json() as { identities: unknown[] }).identities).toHaveLength(1);
		} finally { db.close(); }
	}
});

test('account recovery requires verified ownership established by both login proof and an authenticated Client', async () => {
	const { db, service } = fixture();
	try {
		expect(await (await service.list(input)).json()).toEqual({ identities: [] });
		expect((await service.connect({ ...input, client_id: 4 })).status).toBe(404);
		expect((await service.enroll(3, input, () => true)).status).toBe(403);
		expect((await service.enroll(1, input, () => false)).status).toBe(401);
		expect((await service.enroll(1, input, () => true)).status).toBe(200);
		expect((await service.enroll(2, input, () => true)).status).toBe(200);
		const listed = await service.list(input);
		expect(listed.headers.get('Cache-Control')).toBe('no-store');
		expect(await listed.json()).toEqual({ identities: [
			{ client_id: 2, display_name: 'Another Profile', last_active_at: 200 },
			{ client_id: 1, display_name: 'Renamed Profile', last_active_at: 100 }
		] });
		const connected = await service.connect({ ...input, client_id: 1 });
		expect(connected.headers.get('Cache-Control')).toBe('no-store');
		expect(await connected.json()).toEqual({ credentials: { client_identifier: 'client-one', client_key: 'proof-one' } });
		expect(db.query('SELECT * FROM verified_identity_accounts').all()).toHaveLength(2);
		expect(JSON.stringify(db.query('SELECT * FROM verified_identity_accounts').all())).not.toContain(token);
	} finally { db.close(); }
});

test('candidate matching is exact, case-sensitive, account-scoped and cannot be replaced by claimed account fields', async () => {
	const { db, service } = fixture();
	try {
		await service.enroll(1, input, () => true);
		for (const character_name of ['same name', ' Same Name', 'Same Name ', 'Ｓａｍｅ Name', 'Same  Name']) {
			expect(await (await service.list({ ...input, character_name })).json()).toEqual({ identities: [] });
			expect((await service.connect({ ...input, character_name, client_id: 1 })).status).toBe(404);
		}
		const other = create_identity_recovery_service(db, async () => ({ ...verified, playfab_id: 'ACCOUNT-B' }));
		expect((await other.connect({ ...input, client_id: 1, playfab_id: 'ACCOUNT-A', cloud_username: verified.username })).status).toBe(404);
		expect((await service.connect({ ...input, client_id: 3 })).status).toBe(404);
		for (const client_id of [null, -1, 0, 1.1, '1']) expect((await service.connect({ ...input, client_id })).status).toBe(400);
	} finally { db.close(); }
});

test('selection rechecks disablement, deletion, ownership and recovery revocation without changing identity data', async () => {
	const { db, service } = fixture();
	try {
		await service.enroll(1, input, () => true);
		for (const column of ['disabled', 'deleted_at']) {
			db.query(`UPDATE clients SET ${column}=1 WHERE id=1`).run();
			expect(await (await service.list(input)).json()).toEqual({ identities: [] });
			expect((await service.connect({ ...input, client_id: 1 })).status).toBe(404);
			expect((await service.enroll(1, input, () => true)).status).toBe(403);
			db.query(`UPDATE clients SET ${column}=? WHERE id=1`).run(column === 'disabled' ? 0 : null);
		}
		db.query('UPDATE clients SET melvor_account_id=2 WHERE id=1').run();
		expect((await service.connect({ ...input, client_id: 1 })).status).toBe(404);
		db.query('UPDATE clients SET melvor_account_id=1 WHERE id=1').run();
		db.query('DELETE FROM verified_identity_accounts WHERE client_id=1').run();
		expect((await service.connect({ ...input, client_id: 1 })).status).toBe(404);
		expect(db.query('SELECT client_key,display_name FROM clients WHERE id=1').get()).toEqual({ client_key: 'proof-one', display_name: 'Renamed Profile' });
	} finally { db.close(); }
});

test('invalid/expired proofs and unavailable verification never list, enroll or connect', async () => {
	for (const result of ['invalid', 'unavailable'] as const) {
		const { db, service } = fixture(async () => result);
		try {
			for (const response of [await service.list(input), await service.enroll(1, input, () => true), await service.connect({ ...input, client_id: 1 })]) {
				expect(response.status).toBe(result === 'invalid' ? 422 : 503);
				expect(await response.json()).toEqual({ error: 'account_recovery_failed' });
			}
			expect(db.query('SELECT * FROM verified_identity_accounts').all()).toEqual([]);
		} finally { db.close(); }
	}
});

test('verification uses a fixed official HTTPS endpoint with a bounded request and derives ownership only from its response', async () => {
	let calls = 0;
	const request = (async (url: string | URL | Request, options?: RequestInit) => {
		calls++;
		expect(url).toBe('https://melvoridle.com/cloud/api/validateToken.php');
		expect(options?.redirect).toBe('error');
		expect(options?.signal).toBeInstanceOf(AbortSignal);
		expect(JSON.parse(String(options?.body))).toEqual({ jwt: token });
		return Response.json({ data: { playfabID: ' account-a ', username: verified.username, email: 'ignored@example.test' } });
	});
	for (const invalid of [null, '', 'forged', 'x'.repeat(20000)]) expect(await verify_melvor_account(invalid, request)).toBe('invalid');
	expect(calls).toBe(0);
	expect(await verify_melvor_account(token, request)).toEqual(verified);
	for (const response of [Response.json({ error: 'expired' }), Response.json({ data: { username: 'test' } }), Response.json({ data: { playfabID: '   ', username: 'test' } })]) {
		expect(await verify_melvor_account(token, (async () => response))).toBe('invalid');
	}
	for (const response of [new Response('upstream credentials must never escape', { status: 500 }), new Response('not json'), new Response('x'.repeat(65537))]) {
		expect(await verify_melvor_account(token, (async () => response))).toBe('unavailable');
	}
	expect(await verify_melvor_account(token, (async () => { throw Error('sensitive upstream failure'); }))).toBe('unavailable');
});
