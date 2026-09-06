import { db } from './db';

const MAX_CLIENT_IDENTIFIER_LENGTH = 128;

export function parse_chat_moderator_client_identifiers(raw: string | undefined): Set<string> | undefined {
	if (raw === undefined)
		return undefined;
	const values = raw.split(',').map(value => value.trim());
	if (values.some(value => value.length > MAX_CLIENT_IDENTIFIER_LENGTH ||
		(value.length === 0 && raw.trim().length > 0)))
		throw new Error(
			'CHAT_MODERATOR_CLIENT_IDENTIFIERS must be a comma-separated list of Client identifiers'
		);
	return new Set(values.filter(Boolean));
}

const configured_client_identifiers = parse_chat_moderator_client_identifiers(
	process.env.CHAT_MODERATOR_CLIENT_IDENTIFIERS_CONFIGURED === '1'
		? process.env.CHAT_MODERATOR_CLIENT_IDENTIFIERS ?? ''
		: undefined
);

export function is_chat_moderator(client_id: number): boolean {
	if (configured_client_identifiers === undefined || configured_client_identifiers.size === 0)
		return false;
	const client = db.query<{ client_identifier: string }, [number]>(
		' SELECT `client_identifier` FROM `clients` WHERE `id` = ? AND `deleted_at` IS NULL LIMIT 1'
	).get(client_id);
	return client !== null && configured_client_identifiers.has(client.client_identifier);
}
