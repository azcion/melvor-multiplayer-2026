import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve_active_mod_details, capture_active_mod_details, make_client_runtime_report } from '../../mod/client-runtime.mjs';

test('maps only unique loaded names in the active profile and preserves local/name fallback', () => {
	const installed = [{ id: 12, name: 'Renamed' }, { id: 13, name: 'Disabled' }, { id: 14, name: 'Collision' }, { id: 15, name: 'Collision' }];
	assert.deepEqual(resolve_active_mod_details(['Renamed', 'Disabled', 'Local', 'Collision'], [12, 14, 15], installed, [{ name: 'Local' }]), [
		{ name: 'Renamed', id: 12 }, { name: 'Disabled', id: null }, { name: 'Local', id: null }, { name: 'Collision', id: null }
	]);
	assert.deepEqual(resolve_active_mod_details(['Renamed'], [12], installed, [{ name: 'Renamed' }]), [{ name: 'Renamed', id: null }]);
	assert.deepEqual(resolve_active_mod_details(['Renamed', 'Renamed'], [12], installed), [{ name: 'Renamed', id: null }]);
	assert.deepEqual(resolve_active_mod_details(['Local'], [-1, 0], [{ id: -1, name: 'Local' }]), [{ name: 'Local', id: null }]);
});

test('ID metadata is additive and copied without changing the legacy name report', () => {
	const details = [{ name: 'Name', id: 42 }];
	const report = make_client_runtime_report('1.6.10', ['Name'], null, null, null, [], details);
	details[0].id = 100;
	assert.deepEqual(report.active_mods, ['Name']);
	assert.deepEqual(report.active_mod_details, [{ name: 'Name', id: 42 }]);
});

test('storage denial, missing profiles and blocked metadata preserve the loaded name list', async () => {
	const expected = [{ name: 'Local', id: null }];
	assert.deepEqual(await capture_active_mod_details(['Local'], [1], null), expected);
	assert.deepEqual(await capture_active_mod_details(['Local'], undefined, { open() { throw Error('Must not open'); } }), expected);
	assert.deepEqual(await capture_active_mod_details(['Local'], [1], { open() { throw Error('Denied'); } }), expected);
	assert.deepEqual(await capture_active_mod_details(['Local'], [1], {
		open() { const request = {}; queueMicrotask(() => request.onblocked()); return request; }
	}), expected);
});

test('uses existing stores in a read-only transaction, then closes the database', async () => {
	let closed = false;
	const database = {
		close() { closed = true; },
		transaction(stores, mode) {
			assert.deepEqual(stores, ['mods', 'localMods']);
			assert.equal(mode, 'readonly');
			const transaction = {
				objectStore(name) {
					if (name === 'mods') return { get(id) {
						assert.equal(id, 42);
						const request = { result: { id, name: 'Name' } };
						queueMicrotask(() => request.onsuccess());
						return request;
					} };
					return { openCursor() {
						const request = { result: null };
						queueMicrotask(() => { request.onsuccess(); transaction.oncomplete(); });
						return request;
					} };
				}
			};
			return transaction;
		}
	};
	const indexed_db = { open(name) {
		assert.equal(name, 'melvordb');
		const request = { result: database };
		queueMicrotask(() => request.onsuccess());
		return request;
	} };
	assert.deepEqual(await capture_active_mod_details(['Name'], [42], indexed_db), [{ name: 'Name', id: 42 }]);
	assert.equal(closed, true);
});

test('aborts creation or upgrades and falls back without writing a database', async () => {
	let aborted = false;
	const indexed_db = { open() {
		const request = { transaction: { abort() { aborted = true; queueMicrotask(() => request.onerror()); } } };
		queueMicrotask(() => request.onupgradeneeded());
		return request;
	} };
	assert.deepEqual(await capture_active_mod_details(['Name'], [42], indexed_db), [{ name: 'Name', id: null }]);
	assert.equal(aborted, true);
});


test('a stalled lookup times out and closes a late connection', async () => {
	const request = {};
	assert.deepEqual(await capture_active_mod_details(['Name'], [42], { open() { return request; } }), [{ name: 'Name', id: null }]);
	let closed = false;
	request.result = { close() { closed = true; } };
	request.onsuccess();
	assert.equal(closed, true);
});
