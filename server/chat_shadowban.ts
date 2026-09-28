import { db } from './db';

export function is_chat_shadowbanned(client_id: number): boolean {
	return db.query<{ shadowbanned: number }, [number]>(
		'SELECT (COALESCE(account.`chat_shadowbanned`, 0) = 1) AS `shadowbanned` ' +
		'FROM `clients` AS client LEFT JOIN `melvor_accounts` AS account ON account.`id` = client.`melvor_account_id` ' +
		'WHERE client.`id` = ? LIMIT 1'
	).get(client_id)?.shadowbanned === 1;
}

export function chat_shadow_visibility(message_alias = 'message', sender_alias = 'sender'): string {
	return `(\`${message_alias}\`.\`shadow_hidden\` = 0 OR \`${sender_alias}\`.\`melvor_account_id\` = ` +
		'(SELECT `melvor_account_id` FROM `clients` WHERE `id` = ?) OR EXISTS (' +
		'SELECT 1 FROM `chat_shadow_observers` WHERE `observer_account_id` = ' +
		'(SELECT `melvor_account_id` FROM `clients` WHERE `id` = ?)))';
}
