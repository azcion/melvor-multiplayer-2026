import { readFileSync } from 'node:fs';
import { db } from './db';
import { economy_item_effects, run_economy_command } from './economy';
import { get_charity_shuffle_owner_key } from './charity-wishes';
import { is_social_only_client } from './app-runtime';
import type { JsonObject } from './http';

const catalog = JSON.parse(readFileSync(new URL('./expedition-supply-catalog-v1.json', import.meta.url), 'utf8')) as {
	version: number; items: Record<string, { kind: 'food' | 'potion'; value_currency_id: string; value_per_item: number }>;
};
const MICROS = 1_000_000;

export function expedition_supply_catalog() {
	return { version: catalog.version, items: catalog.items };
}

export function get_expedition_supply_score(client_id: number, expedition_id: number | null) {
	const score = expedition_id === null ? null : db.query<
		{ value_gp_equiv: number; score_micros: number }, [number, number]>(
		'SELECT value_gp_equiv, score_micros FROM expedition_supply_scores WHERE client_id = ? AND expedition_id = ?'
	).get(client_id, expedition_id);
	return { value_gp_equiv: score?.value_gp_equiv ?? 0, score_micros: score?.score_micros ?? 0 };
}

export function donate_expedition_supply(client_id: number, command_id: unknown, payload: JsonObject) {
	return run_economy_command(client_id, command_id, 'expedition-supply-donate', () => {
		const { expedition_id, item_id, qty, source, value_currency_id, value_per_item } = payload;
		if (!Number.isSafeInteger(expedition_id) || typeof item_id !== 'string' ||
			!Number.isSafeInteger(qty) || (qty as number) < 1 ||
			(source !== 'bank' && source !== 'transfer') ||
			typeof value_currency_id !== 'string' || !Number.isSafeInteger(value_per_item))
			return { success: false, error: 'invalid_supply' };
		const item = catalog.items[item_id];
		if (!item) return { success: false, error: 'ineligible_supply' };
		if (item.value_currency_id !== value_currency_id || item.value_per_item !== value_per_item)
			return { success: false, error: 'catalog_mismatch', catalog_version: catalog.version };
		if (is_social_only_client(client_id))
			return { success: false, error: 'social_only' };
		const expedition = db.query<{ guild_id: number; status: string; registration_ends_at: number }, [number]>(
			'SELECT guild_id, status, registration_ends_at FROM expeditions WHERE id = ?'
		).get(expedition_id as number);
		const now = Date.now();
		if (!expedition || expedition.status !== 'registration' || now >= expedition.registration_ends_at)
			return { success: false, error: 'registration_closed' };
		const membership = db.query<{ found: number }, [number, number, number]>(
			'SELECT 1 AS found FROM expedition_registrations AS registration JOIN guild_memberships AS membership ON membership.client_id = registration.client_id WHERE registration.expedition_id = ? AND registration.client_id = ? AND membership.guild_id = ?'
		).get(expedition_id as number, client_id, expedition.guild_id);
		if (!membership) return { success: false, error: 'not_registered' };
		const existing = db.query<{ qty: number }, [number, string]>(
			'SELECT qty FROM expedition_supplies WHERE expedition_id = ? AND item_id = ?'
		).get(expedition_id as number, item_id);
		if (!Number.isSafeInteger((existing?.qty ?? 0) + (qty as number)))
			return { success: false, error: 'supply_limit' };
		const value_each = item.value_currency_id === 'melvorD:GP' && item.value_per_item > 0
			? item.value_per_item : 1;
		const added_value = value_each * (qty as number);
		const old_score = get_expedition_supply_score(client_id, expedition_id as number);
		const new_value = old_score.value_gp_equiv + added_value;
		if (!Number.isSafeInteger(added_value) || !Number.isSafeInteger(new_value))
			return { success: false, error: 'supply_limit' };
		const score_micros = Math.floor(10 * Math.log10(1 + new_value / 1000) * MICROS);
		const delta_micros = Math.max(0, score_micros - old_score.score_micros);
		db.query('INSERT INTO expedition_supplies (expedition_id, item_id, qty, value_currency_id, value_per_item) VALUES (?, ?, ?, ?, ?) ' +
			'ON CONFLICT (expedition_id, item_id) DO UPDATE SET qty = qty + excluded.qty')
			.run(expedition_id as number, item_id, qty as number, item.value_currency_id, item.value_per_item);
		const lot = db.query<{ id: number }, [number, string, number, string, number, number]>(
			'INSERT INTO expedition_supply_lots (expedition_id, item_id, client_id, owner_key, qty, contributed_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'
		).get(expedition_id as number, item_id, client_id, get_charity_shuffle_owner_key(client_id), qty as number, now);
		if (!lot) throw new Error('Expedition supply lot was not created');
		db.query('INSERT INTO expedition_supply_scores (client_id, expedition_id, value_gp_equiv, score_micros) VALUES (?, ?, ?, ?) ' +
			'ON CONFLICT (client_id, expedition_id) DO UPDATE SET value_gp_equiv = excluded.value_gp_equiv, score_micros = excluded.score_micros')
			.run(client_id, expedition_id as number, new_value, score_micros);
		if (delta_micros > 0) {
			db.query("INSERT INTO expedition_ep_ledger (client_id, source_kind, source_id, expedition_id, points_micros, created_at) VALUES (?, 'supply', ?, ?, ?, ?)")
				.run(client_id, lot.id, expedition_id as number, delta_micros, now);
			db.query('INSERT INTO expedition_ep_balances (client_id, points_micros) VALUES (?, ?) ' +
				'ON CONFLICT (client_id) DO UPDATE SET points_micros = points_micros + excluded.points_micros')
				.run(client_id, delta_micros);
		}
		db.query('UPDATE expeditions SET revision = revision + 1 WHERE id = ?').run(expedition_id as number);
		return { success: true, expedition_id, item_id, qty, added_value, value_gp_equiv: new_value,
			points_micros: score_micros, delta_micros,
			effects: economy_item_effects([{ id: item_id, qty: qty as number }], source as 'bank' | 'transfer', -1) };
	});
}
