import { db } from './db';
import { is_client_version_at_least } from './client-version-policy';

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

export function has_expedition_access(client_id: number, mod_version: unknown): boolean {
	return mod_version === 'development' || is_client_version_at_least(mod_version, '1.6.2') ||
		is_expedition_tester(client_id);
}

// Stable IDs keep saved Chat parts valid when the operator changes a label.
export const DEV_BADGES = {
	dev: { feature_id: 'multiplayer:Badge_Dev', label: 'Dev' },
	sae_dev: { feature_id: 'multiplayer:Badge_SAE_Dev', label: 'SAE Dev' },
	osrs_overhaul_dev: { feature_id: 'multiplayer:Badge_OSRS_Overhaul_Dev', label: 'OSRS Overhaul Dev' }
} as const;
export type DevTagKind = keyof typeof DEV_BADGES;

export function valid_dev_badge_label(value: unknown): value is string {
	return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 60 &&
		!/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

export function get_dev_badge_labels(): Record<string, string> {
	const settings = new Map(db.query<{ key: string; value: string }, []>(
		"SELECT key, value FROM service_settings WHERE key IN ('dev-badge-label:dev', 'dev-badge-label:sae_dev', 'dev-badge-label:osrs_overhaul_dev')"
	).all().map(row => [row.key, row.value]));
	return Object.fromEntries(Object.entries(DEV_BADGES).map(([kind, badge]) => {
		const label = settings.get('dev-badge-label:' + kind);
		return [badge.feature_id, valid_dev_badge_label(label) ? label : badge.label];
	}));
}

export function get_dev_badge_label(account_id: number | null, labels = get_dev_badge_labels()): string | null {
	const kind = dev_tag_kind(account_id);
	return kind === null ? null : labels[DEV_BADGES[kind].feature_id] ?? DEV_BADGES[kind].label;
}

export function dev_tag_kind(account_id: number | null): DevTagKind | null {
	if (account_id === 1 || account_id === 15) return 'dev';
	if (account_id === 12) return 'sae_dev';
	if (account_id === 819) return 'osrs_overhaul_dev';
	return null;
}

export function get_dev_tag_visibility(client_id: number): { eligible: boolean; visible: boolean } {
	const client = db.query<{ melvor_account_id: number | null; dev_tag_visible: number }, [number]>(
		'SELECT melvor_account_id, dev_tag_visible FROM clients WHERE id = ?'
	).get(client_id);
	return { eligible: dev_tag_kind(client?.melvor_account_id ?? null) !== null, visible: client?.dev_tag_visible !== 0 };
}
