import { request_uses_server_owned_pets } from '../api-contract';
import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';
import { record_guild_activity } from '../guild-activity';
import { add_inbox_items } from '../inbox';

const { CHARITY_ITEM_LIFETIME, CHARITY_TIMEOUT, CHARITY_WEIRD_GLOOP_ID, charity_state_from_values, db, db_get_all, db_get_single, economy_item_effects, expire_charity_items, expire_charity_items_now, get_charity_known_valuation, get_client_guild_id, get_request_mod_version, grant_charity_pet_if_rolled, is_server_owned_pets_client, is_social_only_client, is_valid_item_id, parse_transfer_items, run_economy_command, session_get_route, session_post_route } = runtime;

const SHUFFLE_CURRENCIES = new Set(['melvorD:GP', 'melvorD:SlayerCoins', 'melvorItA:AbyssalPieces', 'melvorItA:AbyssalSlayerCoins']);
const SHUFFLE_LOCK_MS = 4 * 60 * 60 * 1000;
const SHUFFLE_BONUS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type CharityDonationItem = {
	id: string;
	qty: number;
	value_currency_id: string | null;
	value_per_item: number | null;
};

type CharityDonationSource = 'transfer' | 'bank';

function parse_charity_donation_items(items: unknown): CharityDonationItem[] | null {
	const parsed = parse_transfer_items(items);
	if (parsed === null || !Array.isArray(items))
		return null;
	const donation_items: CharityDonationItem[] = [];
	for (let index = 0; index < parsed.length; index++) {
		const raw = items[index];
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
			return null;
		const record = raw as Record<string, unknown>;
		const has_currency = Object.hasOwn(record, 'value_currency_id');
		const has_value = Object.hasOwn(record, 'value_per_item');
		if (has_currency !== has_value)
			return null;
		if (!has_value) {
			donation_items.push({ ...parsed[index], value_currency_id: null, value_per_item: null });
			continue;
		}
		const value_currency_id = record.value_currency_id;
		const value_per_item = record.value_per_item;
		if ((value_currency_id !== null && !is_valid_item_id(value_currency_id)) ||
			(value_per_item !== null && (typeof value_per_item !== 'number' ||
				!Number.isSafeInteger(value_per_item) || value_per_item < 0)) ||
			(value_per_item === null && value_currency_id !== null) ||
			(typeof value_per_item === 'number' && value_per_item > 0 && value_currency_id === null))
			return null;
		donation_items.push({ ...parsed[index], value_currency_id, value_per_item });
	}
	return donation_items;
}

function charity_owner_key(client_id: number): string {
	const row = db.query('SELECT melvor_account_id FROM clients WHERE id = ?').get(client_id) as { melvor_account_id: number | null };
	return row.melvor_account_id === null ? `client:${client_id}` : `account:${row.melvor_account_id}`;
}

function charity_shuffle_state(guild_id: number, client_id: number, now: number) {
	// Discard a shuffle only when it is older than every remaining donation (or the tree is empty).
	db.query('DELETE FROM charity_shuffles WHERE guild_id = ? AND NOT EXISTS ' +
		'(SELECT 1 FROM charity_items WHERE guild_id = ? AND donated_at <= charity_shuffles.shuffled_at)')
		.run(guild_id, guild_id);
	db.query('DELETE FROM charity_currency_locks WHERE locked_until <= ?').run(now);
	const owner = charity_owner_key(client_id);
	const shuffle_cutoff = now - SHUFFLE_BONUS_WINDOW_MS;
	db.query('DELETE FROM charity_shuffle_events WHERE owner_key = ? AND shuffled_at <= ?').run(owner, shuffle_cutoff);
	const shuffle = db.query('SELECT shuffled_at FROM charity_shuffles WHERE guild_id = ? AND owner_key = ?')
		.get(guild_id, owner) as { shuffled_at: number } | null;
	const shuffle_count = (db.query('SELECT COUNT(*) AS count FROM charity_shuffle_events WHERE owner_key = ? AND shuffled_at > ?')
		.get(owner, shuffle_cutoff) as { count: number }).count;
	const locks = db.query('SELECT currency_id, locked_until FROM charity_currency_locks WHERE guild_id = ? AND owner_key = ?')
		.all(guild_id, owner) as Array<{ currency_id: string; locked_until: number }>;
	return { shuffled_at: shuffle?.shuffled_at ?? null, shuffle_count, currency_locks: locks };
}

export function register_charity_routes(): void {
	session_get_route('/api/charity/contents', async (req, url, client_id): Promise<HandlerResult> => {
		if (is_social_only_client(client_id))
			return { enabled: false, items: [] };
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		expire_charity_items(Date.now(), guild_id);
		const guild = await db_get_single('SELECT `charitree_enabled` FROM `guilds` WHERE `id` = ? LIMIT 1', [guild_id]) as {
			charitree_enabled: number;
		} | null;
		if (guild?.charitree_enabled !== 1)
			return { enabled: false, items: [] };

		return {
			enabled: true,
			...charity_shuffle_state(guild_id, client_id, Date.now()),
			items: await db_get_all(
				'SELECT `item_id` as `id`, `qty`, `expires_at`, `donated_at` FROM `charity_items` ' +
				'WHERE `guild_id` = ? AND `qty` > 0 ORDER BY CASE WHEN `item_id` = ? THEN 0 ELSE 1 END, `expires_at`, `item_id` LIMIT 156',
				[guild_id, CHARITY_WEIRD_GLOOP_ID]
			)
		};
	});

	session_post_route('/api/charity/take', async (req, url, client_id, json): Promise<HandlerResult> => {
		const membership = await db_get_single(
			'SELECT `guild_id`, `charitree_take_available_at` FROM `guild_memberships` WHERE `client_id` = ? LIMIT 1',
			[client_id]
		) as Pick<db_row.guild_memberships, 'guild_id' | 'charitree_take_available_at'> | null;
		if (membership === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		const guild_id = membership.guild_id;

		const item_id = json.item_id;
		if (!is_valid_item_id(item_id))
			return 400; // Bad Request
		const requested_qty = json.qty;
		if (requested_qty !== undefined && (typeof requested_qty !== 'number' ||
			!Number.isSafeInteger(requested_qty) || requested_qty <= 0))
			return 400; // Bad Request

		const current_time = Date.now();
		if (membership.charitree_take_available_at > current_time)
			return {
				error_lang: 'MOD_MP_CHARITY_JOIN_LOCK',
				available_at: membership.charitree_take_available_at,
				charity: {
					enabled: true,
					eligible: false,
					next_opportunity_at: membership.charitree_take_available_at
				}
			};
		expire_charity_items(current_time, guild_id);
		const guild = await db_get_single('SELECT `charitree_enabled` FROM `guilds` WHERE `id` = ? LIMIT 1', [guild_id]) as {
			charitree_enabled: number;
		} | null;
		if (guild?.charitree_enabled !== 1)
			return { error_lang: 'MOD_MP_CHARITY_DISABLED' };
		const client_row = await db_get_single('SELECT `last_charity`, `last_bonus_charity` FROM `clients` WHERE `id` = ?', [client_id]) as db_row.clients;
		if (client_row === null)
			return 400; // Bad Request

		const server_owned_pets = request_uses_server_owned_pets(req);
		const charity = charity_state_from_values({
			charitree_enabled: guild?.charitree_enabled === 1,
			social_only: is_social_only_client(client_id),
			charitree_take_available_at: membership.charitree_take_available_at,
			last_charity: client_row.last_charity,
			last_bonus_charity: client_row.last_bonus_charity,
			server_owned_pets,
			now: current_time
		});
		if (is_social_only_client(client_id))
			return { error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED', charity };
		const last_charity_cooling_down = client_row.last_charity + CHARITY_TIMEOUT > current_time;

		if (!charity.eligible)
			return {
				error_lang: 'MOD_MP_CHARITY_TIMEOUT',
				timeout: client_row.last_charity,
				timeout_bonus: server_owned_pets ? 0 : client_row.last_bonus_charity,
				charity
			};

		const result = run_economy_command(client_id, json.command_id, 'charity-take', () => {
			if (is_social_only_client(client_id))
				return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const lock = db.query('SELECT locked_until FROM charity_currency_locks WHERE guild_id = ? AND owner_key = ? AND currency_id = ?')
				.get(guild_id, charity_owner_key(client_id), item_id) as { locked_until: number } | null;
			if (lock !== null && lock.locked_until > current_time)
				return { success: false, error_lang: 'MOD_MP_CHARITY_SHUFFLE_LOCK', locked_until: lock.locked_until };
			const item_entry = db.query(
				'SELECT `qty` FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = ? LIMIT 1'
			).get(guild_id, item_id) as Pick<db_row.charity_items, 'qty'> | null;
			if (item_entry === null || (requested_qty !== undefined && requested_qty > item_entry.qty))
				return { success: false, error_lang: 'MOD_MP_CHARITY_TAKEN' };

			const item_qty = requested_qty ?? item_entry.qty;
			const item_remaining_qty = item_entry.qty - item_qty;
			let item_expires_at = 0;
			if (item_remaining_qty === 0) {
				db.query('DELETE FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = ?').run(guild_id, item_id);
			} else {
				if (item_id !== CHARITY_WEIRD_GLOOP_ID) {
					const active_clearing = db.query(
						'SELECT MAX(`charitree_expires_before`) AS `cutoff` FROM `guild_petitions` ' +
						"WHERE `guild_id` = ? AND `type` = 'charitree_ingratitude' AND `subject_locked` = 1"
					).get(guild_id) as { cutoff: number | null };
					item_expires_at = Math.max(
						current_time + CHARITY_ITEM_LIFETIME,
						(active_clearing.cutoff ?? -1) + 1
					);
				}
				db.query(
					'UPDATE `charity_items` SET `qty` = ?, `expires_at` = ? WHERE `guild_id` = ? AND `item_id` = ?'
				).run(item_remaining_qty, item_expires_at, guild_id, item_id);
			}

			if (last_charity_cooling_down && !server_owned_pets) {
				db.query('UPDATE `clients` SET `last_bonus_charity` = ? WHERE `id` = ?').run(current_time, client_id);
				client_row.last_bonus_charity = current_time;
			} else {
				db.query('UPDATE `clients` SET `last_charity` = ? WHERE `id` = ?').run(current_time, client_id);
				client_row.last_charity = current_time;
			}

			add_inbox_items(client_id, [{ item_id, qty: item_qty }], { type: 'charitree' });
			return {
				success: true,
				item_qty,
				item_remaining_qty,
				item_expires_at,
				timeout: client_row.last_charity,
				timeout_bonus: server_owned_pets ? 0 : client_row.last_bonus_charity,
				charity: charity_state_from_values({
					charitree_enabled: true,
					social_only: false,
					charitree_take_available_at: membership.charitree_take_available_at,
					last_charity: client_row.last_charity,
					last_bonus_charity: client_row.last_bonus_charity,
					server_owned_pets,
					now: current_time
				}),
				effects: []
			};
		});
		return result ?? 400;
	});

	session_post_route('/api/charity/donate', async (req, url, client_id, json): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

		const items = parse_charity_donation_items(json.items);
		if (items === null || items.length === 0)
			return 400; // Bad Request
		const donation_source = json.source === undefined ? 'transfer' : json.source;
		if (donation_source !== 'transfer' && donation_source !== 'bank')
			return 400; // Bad Request
		const server_owned_pets = request_uses_server_owned_pets(req);
		const donation_value = json.donation_value;
		if (server_owned_pets && (typeof donation_value !== 'number' || !Number.isSafeInteger(donation_value) || donation_value < 0))
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'charity-donate', () => {
			if (is_social_only_client(client_id))
				return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const now = Date.now();
			expire_charity_items_now(now, guild_id);
			const guild = db.query('SELECT `charitree_enabled` FROM `guilds` WHERE `id` = ? LIMIT 1').get(
				guild_id
			) as { charitree_enabled: number } | null;
			if (guild?.charitree_enabled !== 1)
				return { success: false, error_lang: 'MOD_MP_CHARITY_DISABLED' };
			const active_clearing = db.query(
				'SELECT MAX(`charitree_expires_before`) AS `cutoff` FROM `guild_petitions` ' +
				"WHERE `guild_id` = ? AND `type` = 'charitree_ingratitude' AND `subject_locked` = 1"
			).get(guild_id) as { cutoff: number | null };
			const expires_at = Math.max(now + CHARITY_ITEM_LIFETIME, (active_clearing.cutoff ?? -1) + 1);
			for (const item of items) {
				const existing = db.query<{ qty: number }, [number, string]>(
					'SELECT `qty` FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = ? LIMIT 1'
				).get(guild_id, item.id);
				if (!Number.isSafeInteger((existing?.qty ?? 0) + item.qty))
					return { success: false, error_lang: 'MOD_MP_GENERIC_ERR' };
				const known_valuation = get_charity_known_valuation(item.id);
				db.query(
					'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`, `donated_at`, `value_currency_id`, `value_per_item`) ' +
					'VALUES(?, ?, ?, ?, ?, ?, ?) ' +
					'ON CONFLICT (`guild_id`, `item_id`) DO UPDATE SET ' +
					'`qty` = `qty` + excluded.`qty`, `expires_at` = excluded.`expires_at`, `donated_at` = excluded.`donated_at`, ' +
					'`value_currency_id` = CASE WHEN `value_per_item` IS NULL THEN excluded.`value_currency_id` ELSE `value_currency_id` END, ' +
					'`value_per_item` = COALESCE(`value_per_item`, excluded.`value_per_item`)'
				).run(guild_id, item.id, item.qty, item.id === CHARITY_WEIRD_GLOOP_ID ? 0 : expires_at, now,
					known_valuation?.value_currency_id ?? item.value_currency_id,
					known_valuation?.value_per_item ?? item.value_per_item);
			}
			record_guild_activity({ guild_id, event_type: 'charitree_donated', actor_client_id: client_id,
				source_key: `charitree-donation:${json.command_id}`, created_at: now, throttled: true });
			const pet_granted = server_owned_pets && grant_charity_pet_if_rolled(client_id, donation_value as number, Math.random(), now);
			return {
				success: true,
				...(pet_granted ? { pet_id: 'Multiplayer_Pet_Charity' } : {}),
				effects: economy_item_effects(items, donation_source as CharityDonationSource, -1)
			};
		});
		return result ?? 400;
	});

	session_post_route('/api/charity/shuffle', async (req, url, client_id, json): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null) return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		const currency_id = json.currency_id;
		const balance = json.balance;
		// Character balances are client-authoritative, as with ordinary donation value.
		if (typeof currency_id !== 'string' || !SHUFFLE_CURRENCIES.has(currency_id) ||
			typeof balance !== 'number' || !Number.isFinite(balance) || balance <= 1000 || balance > Number.MAX_SAFE_INTEGER)
			return 400;
		const qty = Math.floor(balance / 1000);
		return run_economy_command(client_id, json.command_id, 'charity-shuffle', () => {
			if (is_social_only_client(client_id)) return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const guild = db.query('SELECT charitree_enabled FROM guilds WHERE id = ?').get(guild_id) as { charitree_enabled: number } | null;
			if (guild?.charitree_enabled !== 1) return { success: false, error_lang: 'MOD_MP_CHARITY_DISABLED' };
			const now = Date.now();
			expire_charity_items_now(now, guild_id);
			const existing = db.query('SELECT qty FROM charity_items WHERE guild_id = ? AND item_id = ?')
				.get(guild_id, currency_id) as { qty: number } | null;
			if (!Number.isSafeInteger((existing?.qty ?? 0) + qty)) return { success: false, error_lang: 'MOD_MP_GENERIC_ERR' };
			const clearing = db.query("SELECT MAX(charitree_expires_before) AS cutoff FROM guild_petitions WHERE guild_id = ? AND type = 'charitree_ingratitude' AND subject_locked = 1")
				.get(guild_id) as { cutoff: number | null };
			const expires_at = Math.max(now + CHARITY_ITEM_LIFETIME, (clearing.cutoff ?? -1) + 1);
			const known_valuation = get_charity_known_valuation(currency_id);
			db.query('INSERT INTO charity_items (guild_id, item_id, qty, expires_at, donated_at, value_currency_id, value_per_item) ' +
				'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (guild_id, item_id) DO UPDATE SET ' +
				'qty = qty + excluded.qty, expires_at = excluded.expires_at, donated_at = excluded.donated_at, ' +
				'value_currency_id = CASE WHEN value_per_item IS NULL THEN excluded.value_currency_id ELSE value_currency_id END, ' +
				'value_per_item = COALESCE(value_per_item, excluded.value_per_item)')
				.run(guild_id, currency_id, qty, expires_at, now,
					known_valuation?.value_currency_id ?? currency_id,
					known_valuation?.value_per_item ?? 1);
			const owner = charity_owner_key(client_id);
			db.query('INSERT INTO charity_shuffles (guild_id, owner_key, shuffled_at) VALUES (?, ?, ?) ' +
				'ON CONFLICT (guild_id, owner_key) DO UPDATE SET shuffled_at = excluded.shuffled_at').run(guild_id, owner, now);
			db.query('INSERT INTO charity_shuffle_events (owner_key, shuffled_at) VALUES (?, ?)').run(owner, now);
			db.query('INSERT INTO charity_currency_locks (guild_id, owner_key, currency_id, locked_until) VALUES (?, ?, ?, ?) ' +
				'ON CONFLICT (guild_id, owner_key, currency_id) DO UPDATE SET locked_until = excluded.locked_until')
				.run(guild_id, owner, currency_id, now + SHUFFLE_LOCK_MS);
			record_guild_activity({ guild_id, event_type: 'charitree_donated', actor_client_id: client_id,
				source_key: `charitree-shuffle:${json.command_id}`, created_at: now, throttled: true });
			const pet_granted = grant_charity_pet_if_rolled(client_id, qty, Math.random(), now);
			return { success: true, ...charity_shuffle_state(guild_id, client_id, now),
				...(pet_granted ? { pet_id: 'Multiplayer_Pet_Charity' } : {}),
				effects: economy_item_effects([{ id: currency_id, qty }], 'bank', -1) };
		}) ?? 400;
	});
}
