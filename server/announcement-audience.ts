import { db } from './db';
import { is_admin } from './admin_identity';
import { dev_tag_kind, type DevTagKind } from './account_tags';
import { matches_active_mod, stored_active_mods } from './active-mods';

// Stable audience IDs are stored on announcements; add future mod audiences here.
const audiences: Record<string, { mod_id: number; mod_name: string; author: DevTagKind }> = {
	sae: { mod_id: 5043199, mod_name: 'SUPER AWESOME EXPANSION', author: 'sae_dev' }
};

export function announcement_author_audiences(client_id: number): string[] {
	const client = db.query<{ melvor_account_id: number | null }, [number]>('SELECT melvor_account_id FROM clients WHERE id=?').get(client_id);
	const kind = dev_tag_kind(client?.melvor_account_id ?? null);
	return Object.entries(audiences).filter(([, audience]) => audience.author === kind).map(([id]) => id);
}

export function announcement_audience_sql(client_id: number, alias: string): string {
	if (is_admin(client_id)) return '1';
	const runtime = db.query<{ active_mods: string; active_mod_details: string }, [number]>(
		'SELECT active_mods,active_mod_details FROM client_runtime_snapshots WHERE client_id=?').get(client_id);
	const mods = runtime ? stored_active_mods(runtime.active_mods, runtime.active_mod_details) : [];
	const allowed = Object.entries(audiences).filter(([, audience]) =>
		mods.some(mod => matches_active_mod(mod, audience.mod_id, audience.mod_name))).map(([id]) => id);
	// IDs come solely from the static registry, serialized as a SQL string literal.
	return `(${alias}.audience='' OR ${alias}.audience IN (SELECT value FROM json_each('${JSON.stringify(allowed).replaceAll("'", "''")}')))`;
}

// Two client-id parameters: the historic public watermark and the audience-specific watermark.
export function announcement_read_watermark_sql(alias: string): string {
	return `COALESCE(CASE WHEN ${alias}.audience='' THEN
		(SELECT last_read_message_id FROM announcement_read_state WHERE client_id=?) ELSE
		(SELECT last_read_message_id FROM announcement_audience_read_state WHERE client_id=? AND audience=${alias}.audience)
		END,0)`;
}
