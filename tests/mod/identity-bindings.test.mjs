import assert from 'node:assert/strict';
import test from 'node:test';
import {
	find_identity_binding,
	normalize_identity_bindings,
	read_melvor_account,
	upsert_identity_binding
} from '../../mod/identity-bindings.mjs';

const jared = { cloud_username: 'Jared', playfab_id: 'ABC123' };
const mary = { cloud_username: 'Mary', playfab_id: 'DEF456' };

test('reads the authenticated Melvor Cloud username and PlayFab ID as one pair', () => {
	const storage = { getItem: key => key === 'playFabID' ? ' ABC123 ' : null };
	assert.deepEqual(read_melvor_account({ cloudUsername: ' Jared ' }, storage), jared);
	assert.equal(read_melvor_account({}, storage), null);
	assert.equal(read_melvor_account({ cloudUsername: 'Jared' }, { getItem: () => null }), null);
});

test('keeps independent credentials for each PlayFab account on one save', () => {
	let bindings = normalize_identity_bindings(undefined);
	bindings = upsert_identity_binding(bindings, jared, {
		client_identifier: 'bob-id',
		client_key: 'bob-key',
		friend_code: '111-111-111'
	});
	bindings = upsert_identity_binding(bindings, mary, {
		client_identifier: 'mary-bob-id',
		client_key: 'mary-bob-key'
	});

	assert.equal(find_identity_binding(bindings, jared).client_identifier, 'bob-id');
	assert.equal(find_identity_binding(bindings, mary).client_identifier, 'mary-bob-id');
	assert.equal(bindings.entries.length, 2);

	bindings = upsert_identity_binding(bindings, { ...jared, cloud_username: 'jared' }, {
		client_identifier: 'bob-id',
		client_key: 'rotated-key'
	});
	const updated = find_identity_binding(bindings, { ...jared, cloud_username: 'Renamed Jared' });
	assert.equal(updated.client_key, 'rotated-key');
	assert.equal(updated.cloud_username, 'Jared');
	assert.equal(bindings.entries.length, 2);
});

test('discards malformed persisted entries without disturbing valid bindings', () => {
	const bindings = normalize_identity_bindings({
		version: 1,
		entries: [
			{ ...jared, client_identifier: 'bob-id', client_key: 'bob-key' },
			{ ...jared, cloud_username: 'jared', client_identifier: 'duplicate-id', client_key: 'duplicate-key' },
			{ cloud_username: 'broken' }
		]
	});
	assert.equal(bindings.entries.length, 1);
	assert.equal(find_identity_binding(bindings, jared).client_key, 'bob-key');
	assert.equal(bindings.entries[0].cloud_username, 'Jared');
});
