import type { Database, SQLQueryBindings } from 'bun:sqlite';
import { CHEAT_CATEGORY_ORDER, CHEAT_OBSERVATION_WINDOW, type CheatCategoryId } from './cheat-categories';

export function parse_listing_filters(raw: unknown): CheatCategoryId[] | null {
	if (raw === undefined) return [];
	if (!Array.isArray(raw) || raw.length > CHEAT_CATEGORY_ORDER.length ||
		raw.some(id => !CHEAT_CATEGORY_ORDER.includes(id as CheatCategoryId))) return null;
	return [...new Set(raw)] as CheatCategoryId[];
}

export function listing_filters_from_url(url: URL): CheatCategoryId[] | null {
	const raw = url.searchParams.get('listing_filters');
	return raw === null || raw === '' ? [] : parse_listing_filters(raw.split(','));
}

// client_ref is an internal SQL column expression, never request input.
export function filtered_contributor_sql(client_ref: string, categories: CheatCategoryId[], now: number): { sql: string; values: SQLQueryBindings[] } {
	if (!categories.length) return { sql: '0', values: [] };
	return { sql: `EXISTS (SELECT 1 FROM clients filter_owner WHERE filter_owner.id = ${client_ref} AND (
		(? = 1 AND filter_owner.cheats_detected_at BETWEEN ? AND ?) OR EXISTS (
			SELECT 1 FROM client_mod_observations observation
			JOIN mod_category_classifications classification ON classification.mod_catalog_id = observation.mod_catalog_id
			JOIN mod_categories category ON category.id = classification.category_id
			WHERE observation.client_id = filter_owner.id AND observation.last_observed_at BETWEEN ? AND ?
			AND category.active = 1 AND classification.superseded_at IS NULL
			AND classification.publication_state = 'approved' AND classification.confidence = 'high'
			AND classification.category_id IN (SELECT value FROM json_each(?)))))`,
		values: [categories.includes('items') ? 1 : 0, Math.max(0, now - CHEAT_OBSERVATION_WINDOW), now,
			Math.max(0, now - CHEAT_OBSERVATION_WINDOW), now, JSON.stringify(categories)] };
}

export function filtered_crucible_quantities(database: Database, guild_id: number, categories: CheatCategoryId[], now: number): Map<number, number> {
	if (!categories.length) return new Map();
	const filter = filtered_contributor_sql('lot.client_id', categories, now);
	const rows = database.query<{ offering_id: number; qty: number }, SQLQueryBindings[]>(
		'SELECT lot.offering_id, SUM(lot.qty) AS qty FROM crucible_contribution_lots lot ' +
		'JOIN crucible_offerings offering ON offering.id = lot.offering_id WHERE offering.guild_id = ? AND ' +
		filter.sql + ' GROUP BY lot.offering_id').all(guild_id, ...filter.values);
	return new Map(rows.map(row => [row.offering_id, row.qty]));
}

// Retain identity attribution so a later account association also retains the viewed state.
export function listing_filter_prompt_pending(database: Database, client_id: number): boolean {
	return !database.query(`SELECT 1 FROM listing_filter_prompt_views view
		JOIN clients viewer ON viewer.id = view.client_id
		JOIN clients current ON current.id = ?
		WHERE viewer.id = current.id OR viewer.melvor_account_id = current.melvor_account_id LIMIT 1`).get(client_id);
}

export function acknowledge_listing_filter_prompt(database: Database, client_id: number): void {
	database.query('INSERT OR IGNORE INTO listing_filter_prompt_views(client_id, viewed_at) VALUES (?, ?)')
		.run(client_id, Date.now());
}
