import { db } from './db';

export const EXPEDITION_TESTER_TAG = 'expedition-tester';

export function get_account_tags(client_id: number): string[] {
	return db.query<{ tag: string }, [number]>(
		'SELECT tag.tag FROM melvor_account_tags AS tag ' +
		'JOIN clients AS client ON client.melvor_account_id = tag.account_id ' +
		'WHERE client.id = ? ORDER BY tag.tag'
	).all(client_id).map(row => row.tag);
}

export function is_expedition_tester(client_id: number): boolean {
	return db.query<{ eligible: number }, [number, string]>(
		'SELECT EXISTS(SELECT 1 FROM melvor_account_tags AS tag ' +
		'JOIN clients AS client ON client.melvor_account_id = tag.account_id ' +
		'WHERE client.id = ? AND tag.tag = ?) AS eligible'
	).get(client_id, EXPEDITION_TESTER_TAG)?.eligible === 1;
}

export function dev_tag_kind(account_id: number | null): 'dev' | 'sae_dev' | null {
	if (account_id === 1 || account_id === 15) return 'dev';
	if (account_id === 12) return 'sae_dev';
	return null;
}

export function get_dev_tag_visibility(client_id: number): { eligible: boolean; visible: boolean } {
	const client = db.query<{ melvor_account_id: number | null; dev_tag_visible: number }, [number]>(
		'SELECT melvor_account_id, dev_tag_visible FROM clients WHERE id = ?'
	).get(client_id);
	return { eligible: dev_tag_kind(client?.melvor_account_id ?? null) !== null, visible: client?.dev_tag_visible !== 0 };
}
