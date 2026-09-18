import { readFileSync } from 'node:fs';
import { db } from './db';
import { list_charity_contributor_client_ids } from './charity-contributors';
import type { Database } from 'bun:sqlite';
import type { JsonObject } from './http';
import type * as db_row from './db/types/db_types';

export const CHARITY_WISH_MATURING_MS = 20 * 60 * 60 * 1000;
export const CHARITY_WISH_AUTO_CLAIM_MS = 96 * 60 * 60 * 1000;
export const CHARITY_SHUFFLE_BONUS_LIMIT = 20;
export const CHARITY_WISH_SHUFFLE_PENALTY = 10;
const CHARITY_SHUFFLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const WEIRD_GLOOP_ID = 'melvorD:Weird_Gloop';
const WEIRD_GLOOP_GP_VALUE = 1000n;

type WishCommandKind = 'make' | 'forsake' | 'pick';
type CatalogEntry = { id: string; max_item_value: number };

export function get_charity_wish_maturing_ms(): number {
	return CHARITY_WISH_MATURING_MS;
}

const catalog_data = JSON.parse(readFileSync(new URL('./openable-wish-values.json', import.meta.url), 'utf8')) as unknown;
if (!Array.isArray(catalog_data))
	throw new Error('Invalid Charitree Wish catalog.');
export const CHARITY_WISH_VALUES = new Map<string, number>();
for (const raw of catalog_data) {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
		throw new Error('Invalid Charitree Wish catalog entry.');
	const entry = raw as CatalogEntry;
	if (typeof entry.id !== 'string' || !Number.isSafeInteger(entry.max_item_value) || entry.max_item_value <= 0)
		throw new Error('Invalid Charitree Wish catalog value.');
	CHARITY_WISH_VALUES.set(entry.id, entry.max_item_value);
}

export function get_charity_wish_account(client_id: number, database: Database = db): number | null {
	return (database.query<{ melvor_account_id: number | null }, [number]>(
		'SELECT `melvor_account_id` FROM `clients` WHERE `id` = ?'
	).get(client_id)?.melvor_account_id ?? null);
}

export function get_charity_shuffle_owner_key(client_id: number, database: Database = db): string {
	const account_id = get_charity_wish_account(client_id, database);
	return account_id === null ? `client:${client_id}` : `account:${account_id}`;
}

export function normalize_charity_shuffle_events(
	owner_key: string,
	active_wish: boolean,
	now = Date.now(),
	database: Database = db
): number {
	const shuffle_cutoff = now - CHARITY_SHUFFLE_WINDOW_MS;
	database.query('DELETE FROM `charity_shuffle_events` WHERE `owner_key` = ? AND `shuffled_at` <= ?')
		.run(owner_key, shuffle_cutoff);
	const max_event_count = CHARITY_SHUFFLE_BONUS_LIMIT +
		(active_wish ? CHARITY_WISH_SHUFFLE_PENALTY : 0);
	const event_count = (database.query<{ count: number }, [string]>(
		'SELECT COUNT(*) AS `count` FROM `charity_shuffle_events` WHERE `owner_key` = ?'
	).get(owner_key) as { count: number }).count;
	const overflow = event_count - max_event_count;
	if (overflow > 0)
		database.query(
			'DELETE FROM `charity_shuffle_events` WHERE `owner_key` = ? AND `id` IN (' +
				'SELECT `id` FROM `charity_shuffle_events` WHERE `owner_key` = ? ' +
				'ORDER BY `shuffled_at`, `id` LIMIT ?)'
		).run(owner_key, owner_key, overflow);
	return Math.min(event_count, max_event_count);
}

export function run_charity_wish_command(
	client_id: number,
	command_id: string,
	kind: WishCommandKind,
	command: () => JsonObject
): JsonObject | null {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(command_id))
		return null;
	const replay = db.query<{ client_id: number; kind: WishCommandKind; response_json: string }, [string]>(
		'SELECT `client_id`, `kind`, `response_json` FROM `charity_wish_commands` WHERE `id` = ?'
	).get(command_id);
	if (replay !== null)
		return replay.client_id === client_id && replay.kind === kind ? JSON.parse(replay.response_json) as JsonObject : null;
	const transact = db.transaction(() => {
		const concurrent = db.query<{ client_id: number; kind: WishCommandKind; response_json: string }, [string]>(
			'SELECT `client_id`, `kind`, `response_json` FROM `charity_wish_commands` WHERE `id` = ?'
		).get(command_id);
		if (concurrent !== null)
			return concurrent.client_id === client_id && concurrent.kind === kind
				? JSON.parse(concurrent.response_json) as JsonObject : null;
		const response = command();
		db.query('INSERT INTO `charity_wish_commands` (`id`, `client_id`, `kind`, `response_json`, `created_at`) VALUES(?, ?, ?, ?, ?)')
			.run(command_id, client_id, kind, JSON.stringify(response), Date.now());
		return response;
	});
	return transact.immediate();
}

export function list_charity_wishes(guild_id: number, client_id: number, now: number): JsonObject[] {
	return db.query<db_row.charity_wishes & { display_name: string; icon_id: string }, [number, number, number]>(
		'SELECT wish.*, owner.`display_name`, owner.`icon_id` FROM `charity_wishes` AS wish ' +
		'JOIN `clients` AS owner ON owner.`id` = wish.`owner_client_id` WHERE wish.`guild_id` = ? ' +
		'ORDER BY CASE WHEN wish.`progress_gp` >= wish.`required_gp` THEN 0 WHEN wish.`matures_at` <= ? THEN 1 ELSE 2 END, ' +
		'CASE WHEN wish.`matures_at` > ? THEN wish.`matures_at` ELSE wish.`id` END, wish.`id`'
	).all(guild_id, now, now).map(wish => ({
		id: wish.id,
		item_id: wish.item_id,
		qty: wish.qty,
		required_gp: wish.required_gp,
		progress_gp: wish.progress_gp,
		matures_at: wish.matures_at,
		phase: wish.progress_gp >= wish.required_gp ? 'ripe' : wish.matures_at <= now ? 'ripening' : 'maturing',
		wisher: wish.display_name,
		contributors: [{ client_id: wish.owner_client_id, icon_id: wish.icon_id }],
		owned: wish.owner_client_id === client_id
	}));
}

export function distribute_charity_wish_progress(guild_id: number, total_gp: bigint, now: number, database: Database = db): bigint {
	return distribute_charity_wish_progress_filtered(guild_id, total_gp, now, database);
}

type WishDistributionFilter = {
	allowed_client_ids?: ReadonlySet<number>;
	excluded_client_ids?: ReadonlySet<number>;
};

function distribute_charity_wish_progress_filtered(guild_id: number, total_gp: bigint, now: number,
	database: Database = db, filter: WishDistributionFilter = {}): bigint {
	let remaining = total_gp;
	while (remaining > 0n) {
		const wishes = get_charity_wish_distribution_candidates(guild_id, now, database, filter);
		if (wishes.length === 0) break;
		const share = (remaining + BigInt(wishes.length - 1)) / BigInt(wishes.length);
		let granted = 0n;
		for (const wish of wishes) {
			const amount = share < BigInt(wish.required_gp - wish.progress_gp)
				? share : BigInt(wish.required_gp - wish.progress_gp);
			if (amount <= 0n) continue;
			const amount_number = Number(amount);
			database.query(
				'UPDATE `charity_wishes` SET `progress_gp` = `progress_gp` + ?, ' +
				'`ripe_at` = CASE WHEN `progress_gp` + ? >= `required_gp` THEN COALESCE(`ripe_at`, ?) ELSE `ripe_at` END ' +
				'WHERE `id` = ?'
			).run(amount_number, amount_number, now, wish.id);
			granted += amount;
		}
		if (granted === 0n) break;
		remaining = granted >= remaining ? 0n : remaining - granted;
	}
	return remaining;
}

function get_charity_wish_distribution_candidates(guild_id: number, now: number, database: Database,
	filter: WishDistributionFilter): Array<Pick<db_row.charity_wishes, 'id' | 'owner_client_id' | 'required_gp' | 'progress_gp'>> {
	return database.query<Pick<db_row.charity_wishes, 'id' | 'owner_client_id' | 'required_gp' | 'progress_gp'>, [number, number]>(
		'SELECT `id`, `owner_client_id`, `required_gp`, `progress_gp` FROM `charity_wishes` WHERE `guild_id` = ? ' +
		'AND `matures_at` <= ? AND `progress_gp` < `required_gp` ORDER BY `id`'
	).all(guild_id, now).filter(wish =>
		(filter.allowed_client_ids === undefined || filter.allowed_client_ids.has(wish.owner_client_id)) &&
		(filter.excluded_client_ids === undefined || !filter.excluded_client_ids.has(wish.owner_client_id)));
}

function distribute_charity_wish_progress_once(guild_id: number, total_gp: bigint, now: number,
	database: Database, filter: WishDistributionFilter): bigint {
	if (total_gp <= 0n) return 0n;
	const wishes = get_charity_wish_distribution_candidates(guild_id, now, database, filter);
	if (wishes.length === 0) return total_gp;
	const share = (total_gp + BigInt(wishes.length - 1)) / BigInt(wishes.length);
	let granted = 0n;
	for (const wish of wishes) {
		const amount = share < BigInt(wish.required_gp - wish.progress_gp)
			? share : BigInt(wish.required_gp - wish.progress_gp);
		if (amount <= 0n) continue;
		const amount_number = Number(amount);
		database.query(
			'UPDATE `charity_wishes` SET `progress_gp` = `progress_gp` + ?, ' +
			'`ripe_at` = CASE WHEN `progress_gp` + ? >= `required_gp` THEN COALESCE(`ripe_at`, ?) ELSE `ripe_at` END ' +
			'WHERE `id` = ?'
		).run(amount_number, amount_number, now, wish.id);
		granted += amount;
	}
	return granted >= total_gp ? 0n : total_gp - granted;
}

export function distribute_charity_wish_progress_from_stack(guild_id: number, item_id: string, total_gp: bigint,
	now: number, database: Database = db): bigint {
	const contributor_client_ids = list_charity_contributor_client_ids(guild_id, item_id, database);
	const overflow = distribute_charity_wish_progress_once(guild_id, total_gp, now, database, {
		allowed_client_ids: contributor_client_ids
	});
	return distribute_charity_wish_progress_filtered(guild_id, overflow, now, database, {
		excluded_client_ids: contributor_client_ids
	});
}

export function add_charity_gloop(guild_id: number, gp_value: bigint, database: Database = db): void {
	if (gp_value <= 0n) return;
	const qty = (gp_value + WEIRD_GLOOP_GP_VALUE - 1n) / WEIRD_GLOOP_GP_VALUE;
	if (qty > BigInt(Number.MAX_SAFE_INTEGER))
		throw new Error(`Charitree Gloop conversion exceeds the safe integer range for guild ${guild_id}.`);
	database.query(
		'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`, `donated_at`, `value_currency_id`, `value_per_item`) ' +
		'VALUES(?, ?, ?, 0, 0, NULL, NULL) ON CONFLICT (`guild_id`, `item_id`) DO UPDATE SET ' +
		'`qty` = `qty` + excluded.`qty`, `expires_at` = 0, `donated_at` = 0'
	).run(guild_id, WEIRD_GLOOP_ID, Number(qty));
}

export function grant_charity_wish_to_inbox(
	wish: Pick<db_row.charity_wishes, 'owner_client_id' | 'item_id' | 'qty'>,
	now = Date.now(),
	database: Database = db
): void {
	database.query(
		'INSERT INTO `inbox_items` (`client_id`, `source_type`, `source_name`, `item_id`, `qty`, `created_at`, `updated_at`) ' +
		"VALUES(?, 'wish_granted', '', ?, ?, ?, ?) ON CONFLICT (`client_id`, `source_type`, `source_name`, `item_id`) " +
		'DO UPDATE SET `qty` = `qty` + excluded.`qty`, `updated_at` = excluded.`updated_at`'
	).run(wish.owner_client_id, wish.item_id, wish.qty, now, now);
	database.query('UPDATE `clients` SET `event_revision` = `event_revision` + 1 WHERE `id` = ?')
		.run(wish.owner_client_id);
}

export function auto_claim_due_charity_wishes(now = Date.now(), guild_id?: number, database: Database = db): number {
	const ripe_cutoff = now - CHARITY_WISH_AUTO_CLAIM_MS;
	const wishes = guild_id === undefined
		? database.query<db_row.charity_wishes, [number]>(
				' SELECT * FROM `charity_wishes` WHERE `ripe_at` IS NOT NULL AND `ripe_at` <= ? ORDER BY `ripe_at`, `id`'
			).all(ripe_cutoff)
		: database.query<db_row.charity_wishes, [number, number]>(
				' SELECT * FROM `charity_wishes` WHERE `guild_id` = ? AND `ripe_at` IS NOT NULL AND `ripe_at` <= ? ' +
				'ORDER BY `ripe_at`, `id`'
			).all(guild_id, ripe_cutoff);
	let claimed = 0;
	for (const wish of wishes) {
		const removed = database.query<db_row.charity_wishes, [number, number]>(
			' DELETE FROM `charity_wishes` WHERE `id` = ? AND `ripe_at` IS NOT NULL AND `ripe_at` <= ? RETURNING *'
		).get(wish.id, ripe_cutoff);
		if (removed === null)
			continue;
		grant_charity_wish_to_inbox(removed, now, database);
		normalize_charity_shuffle_events(get_charity_shuffle_owner_key(removed.owner_client_id, database), false, now, database);
		claimed++;
	}
	return claimed;
}

export function settle_departing_charity_wish(
	client_id: number,
	guild_id: number,
	now = Date.now(),
	database: Database = db
): void {
	const wish = database.query<db_row.charity_wishes, [number, number]>(
		'SELECT wish.* FROM `charity_wishes` AS wish WHERE wish.`owner_client_id` = ? AND wish.`guild_id` = ?'
	).get(client_id, guild_id);
	if (wish === null) return;
	if (wish.progress_gp >= wish.required_gp) {
		grant_charity_wish_to_inbox(wish, now, database);
	}
	database.query('DELETE FROM `charity_wishes` WHERE `id` = ?').run(wish.id);
	normalize_charity_shuffle_events(get_charity_shuffle_owner_key(client_id, database), false, now, database);
	if (wish.matures_at <= now && wish.progress_gp < wish.required_gp) {
		const remainder = distribute_charity_wish_progress(guild_id, BigInt(wish.progress_gp), now, database);
		add_charity_gloop(guild_id, remainder, database);
	}
}
