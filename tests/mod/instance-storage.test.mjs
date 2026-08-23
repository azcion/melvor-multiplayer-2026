import assert from 'node:assert/strict';
import test from 'node:test';
import { read_client_source } from './source.mjs';

import { readFile } from 'node:fs/promises';

import {
	migrate_unscoped_server_storage,
	read_instance_storage_item
} from '../../mod/instance-storage.mjs';

const root = new URL('../../', import.meta.url);

function storage_fixture(entries = []) {
	const values = new Map(entries);
	const writes = [];
	return {
		get_item: key => values.get(key),
		set_item(key, value) {
			writes.push([key, value]);
			values.set(key, value);
		},
		values,
		writes
	};
}

test('prefers the canonical instance value without consulting a legacy namespace', () => {
	const storage = storage_fixture([
		['instance:release:identity_bindings', { source: 'release' }],
		['instance:public-test:identity_bindings', { source: 'public-test' }]
	]);

	const value = read_instance_storage_item(
		storage.get_item,
		storage.set_item,
		'instance:release:',
		['instance:public-test:'],
		'identity_bindings'
	);

	assert.deepEqual(value, { source: 'release' });
	assert.deepEqual(storage.writes, []);
});

test('copies a legacy instance value into the canonical namespace and preserves the source', () => {
	const legacy_value = { source: 'public-test' };
	const storage = storage_fixture([
		['instance:public-test:identity_bindings', legacy_value]
	]);

	const value = read_instance_storage_item(
		storage.get_item,
		storage.set_item,
		'instance:release:',
		['instance:public-test:'],
		'identity_bindings'
	);

	assert.equal(value, legacy_value);
	assert.equal(storage.values.get('instance:release:identity_bindings'), legacy_value);
	assert.equal(storage.values.get('instance:public-test:identity_bindings'), legacy_value);
	assert.deepEqual(storage.writes, [['instance:release:identity_bindings', legacy_value]]);
});

test('returns undefined without writing when no instance namespace contains the key', () => {
	const storage = storage_fixture();

	const value = read_instance_storage_item(
		storage.get_item,
		storage.set_item,
		'instance:release:',
		['instance:public-test:'],
		'client_identifier'
	);

	assert.equal(value, undefined);
	assert.deepEqual(storage.writes, []);
});

test('ignores a legacy alias that matches the canonical namespace', () => {
	const storage = storage_fixture();

	read_instance_storage_item(
		storage.get_item,
		storage.set_item,
		'instance:release:',
		['instance:release:'],
		'client_key'
	);

	assert.deepEqual(storage.writes, []);
});

test('migrates unscoped server state into the packaged server namespace once', () => {
	const existing_scoped_value = [{ id: 'scoped:item', qty: 1 }];
	const legacy_transfer_value = [{ id: 'legacy:item', qty: 2 }];
	const legacy_terminal = { assault_id: 'legacy-assault' };
	const storage = storage_fixture([
		['transfer_inventory', legacy_transfer_value],
		['raid_terminal_result', legacy_terminal],
		['instance:release:transfer_inventory', existing_scoped_value]
	]);
	const keys = ['transfer_inventory', 'raid_terminal_result'];

	assert.equal(migrate_unscoped_server_storage(
		storage.get_item,
		storage.set_item,
		'instance:release:',
		keys
	), true);
	assert.equal(storage.values.get('instance:release:transfer_inventory'), existing_scoped_value);
	assert.equal(storage.values.get('instance:release:raid_terminal_result'), legacy_terminal);
	assert.equal(storage.values.get('instance:release:server_storage_isolation_migrated'), true);

	storage.values.set('raid_terminal_result', { assault_id: 'later-legacy-assault' });
	assert.equal(migrate_unscoped_server_storage(
		storage.get_item,
		storage.set_item,
		'instance:release:',
		keys
	), false);
	assert.equal(storage.values.get('instance:release:raid_terminal_result'), legacy_terminal);
});

test('keeps every server-coupled character value behind instance storage', async () => {
	const main = await read_client_source(root);
	const server_scoped_keys = [
		'charity_timeout',
		'charity_bonus_timeout',
		'pending_banishment_guild_name',
		'processed_banishment_claim_ids',
		'transfer_delivery_state',
		'processed_raid_cache_ids',
		'raid_terminal_result',
		'transfer_inventory'
	];

	for (const key of server_scoped_keys) {
		assert.doesNotMatch(
			main,
			new RegExp(`(?:get|set|remove)_character_storage_item\\('${key}'`)
		);
	}
	assert.match(main, /if \(!config\.is_custom\)[\s\S]*migrate_unscoped_server_storage/);
	assert.match(main, /get: \(\) => get_instance_storage_item\('raid_terminal_result'\)/);
	assert.match(main, /set: terminal => set_instance_storage_item\('raid_terminal_result', terminal\)/);
	assert.match(main, /remove: \(\) => remove_instance_storage_item\('raid_terminal_result'\)/);
});
