import { expect, test } from 'bun:test';
import { parse_chat_moderator_client_identifiers } from '../../chat_moderation';

test('validates and normalizes the configured chat moderator Client list', () => {
	expect(parse_chat_moderator_client_identifiers(undefined)).toBeUndefined();
	expect(parse_chat_moderator_client_identifiers('')).toEqual(new Set());
	expect(parse_chat_moderator_client_identifiers(' CLIENT-FIRST,CLIENT-SECOND,CLIENT-FIRST '))
		.toEqual(new Set(['CLIENT-FIRST', 'CLIENT-SECOND']));
	expect(() => parse_chat_moderator_client_identifiers('CLIENT-FIRST,,CLIENT-SECOND')).toThrow(
		'CHAT_MODERATOR_CLIENT_IDENTIFIERS must be a comma-separated list of Client identifiers'
	);
	expect(() => parse_chat_moderator_client_identifiers('x'.repeat(129))).toThrow(
		'CHAT_MODERATOR_CLIENT_IDENTIFIERS must be a comma-separated list of Client identifiers'
	);
});
