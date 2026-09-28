import { expect, test } from 'bun:test';
import { configured_admin_client_identifiers, parse_admin_client_identifiers } from '../../admin_identity';

test('validates and normalizes the configured admin Client list', () => {
	expect(parse_admin_client_identifiers(undefined)).toBeUndefined();
	expect(parse_admin_client_identifiers('')).toEqual(new Set());
	expect(parse_admin_client_identifiers(' CLIENT-FIRST,CLIENT-SECOND,CLIENT-FIRST '))
		.toEqual(new Set(['CLIENT-FIRST', 'CLIENT-SECOND']));
	expect(() => parse_admin_client_identifiers('CLIENT-FIRST,,CLIENT-SECOND')).toThrow(
		'ADMIN_CLIENT_IDENTIFIERS must be a comma-separated list of Client identifiers'
	);
	expect(() => parse_admin_client_identifiers('x'.repeat(129))).toThrow(
		'ADMIN_CLIENT_IDENTIFIERS must be a comma-separated list of Client identifiers'
	);
});

test('uses the legacy moderator list only when the admin list is unset', () => {
	expect(configured_admin_client_identifiers(undefined, 'LEGACY')).toEqual(new Set(['LEGACY']));
	expect(configured_admin_client_identifiers('ADMIN', 'LEGACY')).toEqual(new Set(['ADMIN']));
	expect(configured_admin_client_identifiers('', 'LEGACY')).toEqual(new Set());
});
