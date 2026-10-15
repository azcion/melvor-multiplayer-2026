import type { Database } from 'bun:sqlite';
import catalog from './cheat-mod-catalog.json';
import { LEGACY_INTERDICT_MOD_IDS, is_item_cheat } from './active-mods';
import { CHEAT_CATEGORY_ORDER } from './cheat-categories';

export type CheatCatalog = typeof catalog;
// Editable reviewed catalog; the frozen schema migration remains historical evidence.
// Reconcile metadata transactionally, retaining superseded classifications and every observation clock.
export function reconcile_cheat_catalog(database: Database, definitions: CheatCatalog = catalog, now = Date.now()): void {
	const ids = new Set<number>();
	const aliases = new Set<string>();
	for (const mod of definitions) {
		if (!Number.isSafeInteger(mod.id) || mod.id <= 0 || mod.id !== mod.mod_io_id || ids.has(mod.id)) throw new Error('Invalid catalog ID');
		ids.add(mod.id);
		if (mod.legacy_interdict_member !== Number(LEGACY_INTERDICT_MOD_IDS.includes(mod.id))) throw new Error('Historical Interdict membership is fixed');
		const categories = new Set<string>();
		for (const mapping of mod.classifications) {
			if (!CHEAT_CATEGORY_ORDER.some(c => c === mapping.category_id) || categories.has(mapping.category_id)) throw new Error('Invalid category mapping');
			categories.add(mapping.category_id);
			if (typeof mapping.public_explanation !== 'string') throw new Error('Invalid public capability explanation');
		}
		for (const alias of mod.aliases) {
			if (!alias || aliases.has(alias)) throw new Error('Ambiguous catalog alias');
			aliases.add(alias);
		}
	}
	if (LEGACY_INTERDICT_MOD_IDS.some(id => !ids.has(id))) throw new Error('Missing historical Interdict member');
	database.transaction(() => {
		let changed = false;
		const current = database.query<{ id: number; mod_catalog_id: number; category_id: string; confidence: string; publication_state: string; rationale: string; public_explanation: string; evidence_reference: string }, []>(
			'SELECT * FROM mod_category_classifications WHERE superseded_at IS NULL').all();
		const previous_items = current.filter(c => c.category_id === 'items' && c.confidence === 'high' && c.publication_state === 'approved').map(c => c.mod_catalog_id).sort((a, b) => a - b);
		const next_items = definitions.filter(is_item_cheat).map(m => m.id).sort((a, b) => a - b);
		for (const old of current) {
			const next = definitions.find(m => m.id === old.mod_catalog_id)?.classifications.find(c => c.category_id === old.category_id);
			if (!next || ['confidence', 'publication_state', 'rationale', 'public_explanation', 'evidence_reference'].some(k => next[k as keyof typeof next] !== old[k as keyof typeof old])) {
				database.query('UPDATE mod_category_classifications SET superseded_at=? WHERE id=?').run(now, old.id); changed = true;
			}
		}
		database.query('DELETE FROM mod_catalog_aliases').run();
		for (const mod of definitions) {
			database.query(`INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(?,?,?,?)
				ON CONFLICT(id) DO UPDATE SET canonical_name=excluded.canonical_name`).run(mod.id, mod.mod_io_id, mod.canonical_name, mod.legacy_interdict_member);
			for (const alias of mod.aliases) database.query('INSERT INTO mod_catalog_aliases VALUES(?,?,?)').run(alias, mod.id, 'reviewed cheat-mod-catalog.json');
			for (const mapping of mod.classifications) {
				const exists = database.query('SELECT 1 FROM mod_category_classifications WHERE mod_catalog_id=? AND category_id=? AND superseded_at IS NULL').get(mod.id, mapping.category_id);
				if (!exists) {
					database.query(`INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(?,?,?,?,?,?,?)`)
						.run(mod.id, mapping.category_id, mapping.confidence, mapping.publication_state, mapping.rationale, mapping.public_explanation, mapping.evidence_reference);
					changed = true;
				}
			}
		}
		if (JSON.stringify(previous_items) !== JSON.stringify(next_items)) reconcile_interdict_observations(database, previous_items, now);
		if (changed) database.query('UPDATE clients SET event_revision=event_revision+1').run();
	}).immediate();
}

// Apply current policy to existing positive evidence without renewing observations or deleting history.
// Keep timestamp-only/unknown legacy evidence unless its latest clock is entirely attributable to known mods.
function reconcile_interdict_observations(database: Database, previous_items: number[], now: number): void {
	database.query(`WITH legacy AS (
		SELECT d.client_id,d.detected_at,m.id AS catalog_id,c.mod_catalog_id AS eligible
		FROM client_cheat_mod_detections d
		LEFT JOIN mod_catalog m ON (d.mod_id IS NOT NULL AND m.mod_io_id=d.mod_id)
			OR (d.mod_id IS NULL AND m.id=(SELECT mod_catalog_id FROM mod_catalog_aliases WHERE alias=d.mod_name))
		LEFT JOIN mod_category_classifications c ON c.mod_catalog_id=m.id AND c.category_id='items'
			AND c.superseded_at IS NULL AND c.publication_state='approved' AND c.confidence='high'
	), eligible_times AS (
		SELECT o.client_id,o.last_observed_at AS observed_at FROM client_mod_observations o
		JOIN mod_category_classifications c ON c.mod_catalog_id=o.mod_catalog_id AND c.category_id='items'
			AND c.superseded_at IS NULL AND c.publication_state='approved' AND c.confidence='high'
		UNION ALL SELECT client_id,detected_at FROM legacy WHERE eligible IS NOT NULL OR catalog_id IS NULL
	), retained_times AS (
		SELECT id AS client_id,cheats_detected_at AS observed_at FROM clients
		WHERE cheats_detected_at IS NOT NULL AND (
			(NOT EXISTS(SELECT 1 FROM legacy WHERE client_id=clients.id AND detected_at=clients.cheats_detected_at)
				AND NOT EXISTS(SELECT 1 FROM client_mod_observations o WHERE o.client_id=clients.id
					AND o.last_observed_at=clients.cheats_detected_at AND o.mod_catalog_id IN (SELECT value FROM json_each(?))))
			OR EXISTS(SELECT 1 FROM legacy WHERE client_id=clients.id AND detected_at=clients.cheats_detected_at AND catalog_id IS NULL)
		)
		UNION ALL SELECT client_id,observed_at FROM eligible_times WHERE observed_at BETWEEN 0 AND ?
	), clocks AS (SELECT client_id,MAX(observed_at) AS detected_at FROM retained_times GROUP BY client_id)
	UPDATE clients SET cheats_detected_at=(SELECT detected_at FROM clocks WHERE client_id=clients.id)
	WHERE cheats_detected_at IS NOT (SELECT detected_at FROM clocks WHERE client_id=clients.id)`).run(JSON.stringify(previous_items), now);
}
