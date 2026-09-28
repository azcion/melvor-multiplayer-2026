import { db } from './db';

const MAX_CLIENT_IDENTIFIER_LENGTH = 128;

export function parse_admin_client_identifiers(raw: string | undefined): Set<string> | undefined {
	if (raw === undefined)
		return undefined;
	const values = raw.split(',').map(value => value.trim());
	if (values.some(value => value.length > MAX_CLIENT_IDENTIFIER_LENGTH ||
		(value.length === 0 && raw.trim().length > 0)))
		throw new Error('ADMIN_CLIENT_IDENTIFIERS must be a comma-separated list of Client identifiers');
	return new Set(values.filter(Boolean));
}

// The former Chat moderator setting remains a fallback for existing deployments.
export function configured_admin_client_identifiers(admin_raw: string | undefined, legacy_raw: string | undefined): Set<string> | undefined {
	return parse_admin_client_identifiers(admin_raw === undefined ? legacy_raw : admin_raw);
}

const configured_client_identifiers = configured_admin_client_identifiers(
	process.env.ADMIN_CLIENT_IDENTIFIERS_CONFIGURED === '1' ? process.env.ADMIN_CLIENT_IDENTIFIERS ?? '' : undefined,
	process.env.CHAT_MODERATOR_CLIENT_IDENTIFIERS_CONFIGURED === '1'
		? process.env.CHAT_MODERATOR_CLIENT_IDENTIFIERS ?? '' : undefined
);

export function is_admin(client_id: number): boolean {
	if (configured_client_identifiers === undefined || configured_client_identifiers.size === 0)
		return false;
	const client = db.query<{ client_identifier: string }, [number]>(
		'SELECT `client_identifier` FROM `clients` WHERE `id` = ? AND `deleted_at` IS NULL LIMIT 1'
	).get(client_id);
	return client !== null && configured_client_identifiers.has(client.client_identifier);
}
