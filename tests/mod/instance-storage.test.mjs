import assert from 'node:assert/strict';
import test from 'node:test';
import { read_client_source } from './source.mjs';

import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

import {
	migrate_unscoped_server_storage,
	prune_legacy_local_character_storage,
	read_instance_storage_item
} from '../../mod/instance-storage.mjs';

const root = new URL('../../', import.meta.url);

test('development storage starts without a shared identity or seeded character values', async () => {
	const main = await read_client_source(root);
	const declaration = main.match(/const DEV_CHARACTER_STORAGE = ([\s\S]*?);\n/);
	assert.ok(declaration, 'development storage declaration must be present');
	const storage = runInNewContext(declaration[1]);
	assert.deepEqual(Object.keys(storage), []);
});

test('prunes only matching legacy identity copies in the selected character and instance', () => {
	const legacy = 'kru-melvor-multiplayer:local-character:0:instance:release:';
	const current = 'mp:local-character:0:instance:release:';
	const values = new Map();
	for (const key of ['client_identifier', 'client_key', 'friend_code', 'identity_bindings',
		'pending_economy_command:8', 'transfer_delivery_state', 'unknown_future_key']) {
		values.set(legacy + key, JSON.stringify({ value: key }));
		values.set(current + key, JSON.stringify({ value: key }));
	}
	const foreign = [legacy.replace(':0:', ':7:') + 'client_key',
		legacy.replace('instance:release:', 'instance:custom:') + 'client_key'];
	for (const key of foreign) values.set(key, '"keep"');
	const storage = { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key) };
	assert.equal(prune_legacy_local_character_storage(storage, legacy, current), 4);
	for (const key of ['client_identifier', 'client_key', 'friend_code', 'identity_bindings']) {
		assert.equal(values.has(legacy + key), false);
		assert.equal(values.has(current + key), true);
	}
	for (const key of ['pending_economy_command:8', 'transfer_delivery_state', 'unknown_future_key'])
		assert.equal(values.has(legacy + key), true);
	for (const key of foreign) assert.equal(values.has(key), true);
	assert.equal(prune_legacy_local_character_storage(storage, legacy, current), 0);
});

test('preserves conflicts, unmatched, malformed and null legacy records without writing', () => {
	const values = new Map([
		['old:client_identifier', '"old"'], ['new:client_identifier', '"new"'],
		['old:client_key', '"only-copy"'],
		['old:friend_code', 'invalid'], ['new:friend_code', 'invalid'],
		['old:identity_bindings', 'null'], ['new:identity_bindings', 'null']
	]);
	const before = [...values];
	assert.equal(prune_legacy_local_character_storage({
		getItem: key => values.get(key) ?? null,
		removeItem: () => assert.fail('must preserve source')
	}, 'old:', 'new:'), 0);
	assert.deepEqual([...values], before);
});

test('storage denial and a changed counterpart prevent cleanup without blocking load', () => {
	assert.equal(prune_legacy_local_character_storage({ getItem() { throw Error('denied'); } }, 'old:', 'new:'), 0);
	let current_reads = 0;
	assert.equal(prune_legacy_local_character_storage({
		getItem(key) {
			if (key === 'old:client_key') return '"same"';
			if (key === 'new:client_key') return ++current_reads === 1 ? '"same"' : '"changed"';
			return null;
		},
		removeItem: () => assert.fail('must preserve source')
	}, 'old:', 'new:'), 0);
});

test('character setup scopes cleanup to the selected Toolkit slot and server', async () => {
	const main = await read_client_source(root);
	assert.match(main, /!IS_DEV_MODE && is_creator_toolkit_local_mod\(\) &&[\s\S]*Number\.isInteger\(currentCharacter\)/);
	assert.match(main, /prune_legacy_local_character_storage\([\s\S]*get_local_character_storage_key\(server_instance_storage_prefix, LEGACY_LOCAL_MOD_CHARACTER_STORAGE_PREFIX\),[\s\S]*get_local_character_storage_key\(server_instance_storage_prefix\)/);
	assert.match(main, /localStorage\.getItem\(storage_key\) === stored_value &&[\s\S]*localStorage\.getItem\(legacy_storage_key\) === stored_value/);
});

test('Toolkit migration retains its source unless the destination write is verified', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const source = main.slice(main.indexOf('function get_character_storage_item('), main.indexOf('\nfunction set_character_storage_item('));
	for (const persist of [false, true]) {
		const values = new Map([['old:client_key', '"credential"']]);
		const context = {
			IS_DEV_MODE: false, LEGACY_LOCAL_MOD_CHARACTER_STORAGE_PREFIX: 'old:',
			is_creator_toolkit_local_mod: () => true,
			get_local_character_storage_key: (key, prefix = 'new:') => prefix + key,
			error: () => assert.fail('read should succeed'),
			localStorage: {
				getItem: key => values.get(key) ?? null,
				setItem: (key, value) => { if (persist) values.set(key, value); },
				removeItem: key => values.delete(key)
			}
		};
		runInNewContext(source, context);
		assert.equal(context.get_character_storage_item('client_key'), 'credential');
		assert.equal(values.has('old:client_key'), !persist);
		assert.equal(values.has('new:client_key'), persist);
	}
});

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
		'pending_banishment_guild_name',
		'processed_banishment_claim_ids',
		'processed_inbox_claim_ids',
		'transfer_delivery_state',
		'inbox_delivery_state',
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
