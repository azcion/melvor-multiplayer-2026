import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CUSTOM_SERVER_MAX_LENGTH,
	get_custom_server_validation_error,
	normalize_server_origin,
	resolve_server_config
} from '../../mod/server-config.mjs';

test('normalizes HTTPS and loopback server origins', () => {
	assert.equal(normalize_server_origin(' https://Example.COM:443/ '), 'https://example.com');
	assert.equal(normalize_server_origin('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
	assert.equal(normalize_server_origin('http://[::1]:3000'), 'http://[::1]:3000');
	assert.equal(normalize_server_origin('   '), '');
});

test('rejects insecure remote servers and values that are not origins', () => {
	assert.match(get_custom_server_validation_error('example.com'), /complete server origin/);
	assert.match(get_custom_server_validation_error('http://192.168.1.10:3000'), /must use HTTPS/);
	assert.match(get_custom_server_validation_error('https://example.com/multiplayer'), /only the server origin/);
	assert.match(get_custom_server_validation_error('https://user:secret@example.com'), /only the server origin/);
	assert.match(get_custom_server_validation_error('https://example.com?instance=test'), /only the server origin/);
	assert.match(
		get_custom_server_validation_error(`https://${'a'.repeat(CUSTOM_SERVER_MAX_LENGTH)}.example.com`),
		/complete server origin/
	);
});

test('uses the packaged server and namespace when the custom setting is empty', () => {
	assert.deepEqual(
		resolve_server_config('https://melvor.example.com', 'instance:public-test:', ''),
		{
			host: 'https://melvor.example.com',
			storage_prefix: 'instance:public-test:',
			is_custom: false
		}
	);
});

test('uses the packaged namespace when the custom setting resolves to the packaged server', () => {
	assert.deepEqual(
		resolve_server_config('https://melvor.example.com', 'instance:public-test:', ' HTTPS://MELVOR.EXAMPLE.COM/ '),
		{
			host: 'https://melvor.example.com',
			storage_prefix: 'instance:public-test:',
			is_custom: false
		}
	);
});

test('isolates identities by normalized custom server origin', () => {
	const first = resolve_server_config(
		'https://melvor.example.com',
		'instance:public-test:',
		'https://custom.example.com/'
	);
	const same = resolve_server_config(
		'https://melvor.example.com',
		'instance:public-test:',
		' HTTPS://CUSTOM.EXAMPLE.COM:443 '
	);
	const other = resolve_server_config(
		'https://melvor.example.com',
		'instance:public-test:',
		'https://other.example.com'
	);

	assert.deepEqual(first, {
		host: 'https://custom.example.com',
		storage_prefix: 'instance:custom:https%3A%2F%2Fcustom.example.com:',
		is_custom: true
	});
	assert.deepEqual(same, first);
	assert.notEqual(other.storage_prefix, first.storage_prefix);
});
