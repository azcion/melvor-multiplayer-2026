import type { Database } from 'bun:sqlite';
import type { ActiveMod } from './active-mods';

export const CHEAT_CATEGORY_ORDER = ['time', 'items', 'resources', 'multitasking', 'shops', 'loot_rng'] as const;
export type CheatCategoryId = typeof CHEAT_CATEGORY_ORDER[number];
export const CHEAT_OBSERVATION_WINDOW = 7 * 86400000;
export function recent_cheat_observation(timestamp: number | null, now: number): boolean {
	return timestamp !== null && Number.isSafeInteger(timestamp) && timestamp >= 0 &&
		timestamp <= now && now - timestamp <= CHEAT_OBSERVATION_WINDOW;
}
// Only the reviewed Item Cheats set determines Interdict; other categories remain informational.
export function legacy_interdict_applies(timestamp: number | null, now = Date.now()): boolean {
	return recent_cheat_observation(timestamp, now);
}

type Catalog = { id: number; mod_io_id: number; alias: string | null };
export function observe_category_mods(database: Database, client_id: number, names: string[],
	details: ActiveMod[] | undefined, now: number, resolved: ActiveMod[] = []): void {
	if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid observation timestamp');
	const catalog = database.query<Catalog, []>('SELECT m.id,m.mod_io_id,a.alias FROM mod_catalog m LEFT JOIN mod_catalog_aliases a ON a.mod_catalog_id=m.id').all();
	const save = database.query(`INSERT INTO client_mod_observations
		(client_id,mod_catalog_id,last_observed_at,reported_name,reported_mod_io_id,match_method,evidence_source)
		VALUES(?,?,?,?,?,?,'runtime') ON CONFLICT(client_id,mod_catalog_id) DO UPDATE SET
		last_observed_at=excluded.last_observed_at,reported_name=excluded.reported_name,
		reported_mod_io_id=excluded.reported_mod_io_id,match_method=excluded.match_method,evidence_source=excluded.evidence_source
		WHERE excluded.last_observed_at>=client_mod_observations.last_observed_at`);
	database.transaction(() => {
		for (const name of names) {
			const reported = details?.filter(mod => mod.name === name) ?? [];
			const ids = new Set(reported.map(mod => mod.id));
			const id = ids.size === 1 ? reported[0].id : null;
			const retained_id = !reported.length ? resolved.find(mod => mod.name === name)?.id : null;
			const effective_id = reported.length ? id : retained_id;
			const match = reported.length
				? (id === null ? undefined : catalog.find(mod => mod.mod_io_id === id))
				: (effective_id !== null && effective_id !== undefined
					? catalog.find(mod => mod.mod_io_id === effective_id)
					: catalog.find(mod => mod.alias === name));
			if (match) save.run(client_id, match.id, now, name, effective_id ?? null,
				effective_id === null || effective_id === undefined ? 'curated_name' : 'mod_io_id');
		}
	})();
}

export type CheatCategory = {
	id: CheatCategoryId; detected_at: number; expires_at: number; details_unavailable: boolean;
	mods: { id: number; name: string; explanation: string; detected_at: number; expires_at: number }[];
};
export type CheatMarking = { cheat_categories: CheatCategory[]; cheat_mods: string[] };
const expiry = (at: number) => Math.min(Number.MAX_SAFE_INTEGER, at + CHEAT_OBSERVATION_WINDOW);
// Call only after selecting authorized roster/applicant rows. Two set-based queries, independent of roster size.
export function read_cheat_markings(database: Database, members: { client_id: number; cheats_detected_at: number | null }[], now: number): Map<number, CheatMarking> {
	const result = new Map<number, CheatMarking>(members.map(m => [m.client_id, { cheat_categories: [], cheat_mods: [] }]));
	if (!members.length) return result;
	const ids = JSON.stringify(members.map(m => m.client_id));
	type Row = { client_id: number; category_id: CheatCategoryId; id: number; canonical_name: string; public_explanation: string; last_observed_at: number };
	const rows = database.query<Row, [string, number, number]>(`SELECT o.client_id,c.category_id,m.id,m.canonical_name,c.public_explanation,o.last_observed_at
		FROM client_mod_observations o JOIN mod_catalog m ON m.id=o.mod_catalog_id
		JOIN mod_category_classifications c ON c.mod_catalog_id=m.id JOIN mod_categories category ON category.id=c.category_id
		WHERE o.client_id IN (SELECT value FROM json_each(?)) AND o.last_observed_at BETWEEN ? AND ?
		AND category.active=1 AND c.superseded_at IS NULL AND c.publication_state='approved' AND c.confidence='high'
		ORDER BY category.sort_order,o.last_observed_at DESC,m.canonical_name COLLATE NOCASE`).all(ids, now - CHEAT_OBSERVATION_WINDOW, now);
	for (const row of rows) {
		const marking = result.get(row.client_id)!;
		let category = marking.cheat_categories.find(c => c.id === row.category_id);
		if (!category) {
			category = { id: row.category_id, detected_at: row.last_observed_at, expires_at: expiry(row.last_observed_at), details_unavailable: false, mods: [] };
			marking.cheat_categories.push(category);
		}
		category.mods.push({ id: row.id, name: row.canonical_name, explanation: row.public_explanation, detected_at: row.last_observed_at, expires_at: expiry(row.last_observed_at) });
	}
	type LegacyRow = { client_id: number; mod_name: string; detected_at: number; id: number | null; canonical_name: string | null; public_explanation: string | null; eligible: number | null };
	const legacy = database.query<LegacyRow, [string, number, number]>(`SELECT d.client_id,d.mod_name,d.detected_at,m.id,m.canonical_name,c.public_explanation,c.mod_catalog_id AS eligible
		FROM client_cheat_mod_detections d
		LEFT JOIN mod_catalog m ON (d.mod_id IS NOT NULL AND m.mod_io_id=d.mod_id)
			OR (d.mod_id IS NULL AND m.id=(SELECT mod_catalog_id FROM mod_catalog_aliases WHERE alias=d.mod_name))
		LEFT JOIN mod_category_classifications c ON c.mod_catalog_id=m.id AND c.category_id='items'
			AND c.superseded_at IS NULL AND c.publication_state='approved' AND c.confidence='high'
		WHERE d.client_id IN (SELECT value FROM json_each(?)) AND d.detected_at BETWEEN ? AND ?
		ORDER BY d.detected_at DESC,d.mod_name COLLATE NOCASE`).all(ids, now - CHEAT_OBSERVATION_WINDOW, now);
	for (const member of members) {
		if (!legacy_interdict_applies(member.cheats_detected_at, now)) continue;
		const marking = result.get(member.client_id)!;
		marking.cheat_mods = legacy.filter(row => row.client_id === member.client_id && (row.eligible !== null || row.id === null)).map(row => row.mod_name);
		let items = marking.cheat_categories.find(c => c.id === 'items');
		const timestamp = member.cheats_detected_at!;
		if (!items) {
			items = { id: 'items', detected_at: timestamp, expires_at: expiry(timestamp), details_unavailable: true, mods: [] };
			marking.cheat_categories.push(items);
		}
		else if (timestamp > items.detected_at) {
			items.detected_at = timestamp; items.expires_at = expiry(timestamp); items.details_unavailable = true;
		}
		for (const detection of legacy.filter(row => row.client_id === member.client_id)) {
			if (detection.eligible === null) continue;
			const existing = items.mods.find(mod => mod.id === detection.id);
			if (existing && existing.detected_at >= detection.detected_at) continue;
			const evidence = { id: detection.id!, name: detection.canonical_name!,
				explanation: detection.public_explanation!,
				detected_at: detection.detected_at, expires_at: expiry(detection.detected_at) };
			if (existing) Object.assign(existing, evidence); else items.mods.push(evidence);
		}
		items.details_unavailable = !items.mods.some(mod => mod.detected_at >= timestamp);
		marking.cheat_categories.sort((a, b) => CHEAT_CATEGORY_ORDER.indexOf(a.id) - CHEAT_CATEGORY_ORDER.indexOf(b.id));
	}
	for (const marking of result.values()) {
		const items = marking.cheat_categories.find(c => c.id === 'items');
		for (const mod of items?.mods ?? []) if (!marking.cheat_mods.includes(mod.name)) marking.cheat_mods.push(mod.name);
	}
	return result;
}
