import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';
import { record_guild_activity } from '../guild-activity';
import { add_inbox_items } from '../inbox';
import { cap_transfer_items, get_transfer_currency_cap, get_transfer_currency_overage } from '../transfer-caps';
import { add_charity_contribution, consume_charity_contributions, list_charity_contributors } from '../charity-contributors';
import { audit_command_source, audit_position_key, move_audit_value_with_fallback,
	record_audit_event } from '../audit';

const { CHARITY_ITEM_LIFETIME, CHARITY_SHUFFLE_BONUS_LIMIT, CHARITY_TIMEOUT, CHARITY_WEIRD_GLOOP_ID, CHARITY_WISH_SHUFFLE_PENALTY, CHARITY_WISH_VALUES, charity_state_from_values, db, db_get_all, db_get_single, economy_item_effects, expire_charity_items, expire_charity_items_now, get_charity_decay_context, get_effective_charity_expiry, get_charity_known_valuation, get_charity_shuffle_owner_key, get_charity_wish_account, get_charity_wish_maturing_ms, get_client_guild_id, grant_charity_pet_if_rolled, grant_charity_wish_to_inbox, is_social_only_client, is_valid_item_id, list_charity_wishes, normalize_charity_shuffle_events, parse_transfer_items, run_charity_wish_command, run_economy_command, session_get_route, session_post_route } = runtime;

const SHUFFLE_CURRENCIES = new Set(['melvorD:GP', 'melvorD:SlayerCoins', 'melvorItA:AbyssalPieces', 'melvorItA:AbyssalSlayerCoins']);
const SHUFFLE_LOCK_MS = 4 * 60 * 60 * 1000;

type CharityDonationItem = {
	id: string;
	qty: number;
	value_currency_id: string | null;
	value_per_item: number | null;
};

type CharityDonationSource = 'transfer' | 'bank';

type CharityShuffleOffer = { currency_id: string; balance: number; qty: number };

function parse_charity_shuffle_offer(value: unknown): CharityShuffleOffer | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const { currency_id, balance } = value as Record<string, unknown>;
	// Character balances are client-authoritative, as with ordinary donation value.
	if (typeof currency_id !== 'string' || !SHUFFLE_CURRENCIES.has(currency_id) ||
		typeof balance !== 'number' || !Number.isFinite(balance) || balance <= 1000 || balance > Number.MAX_SAFE_INTEGER)
		return null;
	return { currency_id, balance,
		qty: Math.min(Math.floor(balance / 1000), get_transfer_currency_cap(currency_id) as number) };
}

function parse_charity_shuffle_offers(json: JsonObject): { offers: CharityShuffleOffer[]; max: boolean } | null {
	if (!Array.isArray(json.offers)) {
		const offer = parse_charity_shuffle_offer(json);
		return offer === null ? null : { offers: [offer], max: false };
	}
	if (json.offers.length === 0 || json.offers.length > CHARITY_SHUFFLE_BONUS_LIMIT + CHARITY_WISH_SHUFFLE_PENALTY)
		return null;
	const offers = json.offers.map(parse_charity_shuffle_offer);
	if (offers.some(offer => offer === null)) return null;
	const prior_balances = new Map<string, number>();
	for (const offer of offers as CharityShuffleOffer[]) {
		const expected_balance = prior_balances.get(offer.currency_id);
		if (expected_balance !== undefined && offer.balance !== expected_balance) return null;
		prior_balances.set(offer.currency_id, offer.balance - offer.qty);
	}
	return { offers: offers as CharityShuffleOffer[], max: true };
}

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

function charity_shuffle_state(guild_id: number, client_id: number, now: number) {
	// Discard a shuffle only when it is older than every remaining donation (or the tree is empty).
	db.query('DELETE FROM charity_shuffles WHERE guild_id = ? AND NOT EXISTS ' +
		'(SELECT 1 FROM charity_items WHERE guild_id = ? AND donated_at <= charity_shuffles.shuffled_at)')
		.run(guild_id, guild_id);
	db.query('DELETE FROM charity_currency_locks WHERE locked_until <= ?').run(now);
	const owner = get_charity_shuffle_owner_key(client_id);
	const shuffle = db.query('SELECT shuffled_at FROM charity_shuffles WHERE guild_id = ? AND owner_key = ?')
		.get(guild_id, owner) as { shuffled_at: number } | null;
	const account_id = get_charity_wish_account(client_id);
	const active_wish = account_id !== null && db.query('SELECT 1 FROM `charity_wishes` WHERE `melvor_account_id` = ?').get(account_id) !== null;
	const shuffle_count = normalize_charity_shuffle_events(owner, active_wish, now) -
		(active_wish ? CHARITY_WISH_SHUFFLE_PENALTY : 0);
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

		const now = Date.now();
		const decay_context = get_charity_decay_context(guild_id, db, now);
		const contributors = list_charity_contributors(guild_id);
		return {
			enabled: true,
			...charity_shuffle_state(guild_id, client_id, now),
			items: (await db_get_all(
				'SELECT `item_id` as `id`, `qty`, `expires_at`, `donated_at` FROM `charity_items` ' +
				'WHERE `guild_id` = ? AND `qty` > 0 ORDER BY CASE WHEN `item_id` = ? THEN 0 ELSE 1 END, `expires_at`, `item_id` LIMIT 156',
				[guild_id, CHARITY_WEIRD_GLOOP_ID]
			)).map(item => ({
				...item,
				...(contributors.has(String(item.id))
					? { contributors: contributors.get(String(item.id)) }
					: {}),
				expires_at: get_effective_charity_expiry(item.expires_at, decay_context)
			})),
			wishes: list_charity_wishes(guild_id, client_id, now),
			wish_catalog: [...CHARITY_WISH_VALUES].map(([id, max_item_value]) => ({ id, max_item_value })),
			active_wish: get_charity_wish_account(client_id) !== null &&
				db.query('SELECT 1 FROM `charity_wishes` WHERE `melvor_account_id` = ?')
					.get(get_charity_wish_account(client_id) as number) !== null
		};
	});

	session_post_route('/api/charity/wish/make', async (req, url, client_id, json): Promise<HandlerResult> => {
		const item_id = json.item_id;
		const qty = json.qty;
		const command_id = json.command_id;
		if (typeof command_id !== 'string' || !is_valid_item_id(item_id) || typeof qty !== 'number' ||
			!Number.isSafeInteger(qty) || qty < 1 || qty > 100)
			return 400;
		const result = run_charity_wish_command(client_id, command_id, 'make', (): JsonObject => {
			if (is_social_only_client(client_id)) return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const membership = db.query<{ guild_id: number; charitree_enabled: number }, [number]>(
				'SELECT membership.`guild_id`, guild.`charitree_enabled` FROM `guild_memberships` AS membership ' +
				'JOIN `guilds` AS guild ON guild.`id` = membership.`guild_id` WHERE membership.`client_id` = ?'
			).get(client_id);
			if (membership === null) return { success: false, error_lang: 'MOD_MP_GUILD_REQUIRED' };
			if (membership.charitree_enabled !== 1) return { success: false, error_lang: 'MOD_MP_CHARITY_DISABLED' };
			const account_id = get_charity_wish_account(client_id);
			if (account_id === null) return { success: false, error_lang: 'MOD_MP_CHARITY_WISH_ACCOUNT_REQUIRED' };
			if (db.query('SELECT 1 FROM `charity_wishes` WHERE `melvor_account_id` = ?').get(account_id) !== null)
				return { success: false, error_lang: 'MOD_MP_CHARITY_WISH_ACTIVE' };
			const max_value = CHARITY_WISH_VALUES.get(item_id);
			if (max_value === undefined) return { success: false, error_lang: 'MOD_MP_CHARITY_WISH_INVALID' };
			const required_gp = max_value * qty * 5;
			if (!Number.isSafeInteger(required_gp)) return { success: false, error_lang: 'MOD_MP_GENERIC_ERR' };
			const now = Date.now();
			normalize_charity_shuffle_events(get_charity_shuffle_owner_key(client_id), false, now);
			const wish = db.query<{ id: number }, [number, number, number, string, number, number, number, number]>(
				'INSERT INTO `charity_wishes` (`guild_id`, `owner_client_id`, `melvor_account_id`, `item_id`, `qty`, ' +
				'`required_gp`, `created_at`, `matures_at`) VALUES(?, ?, ?, ?, ?, ?, ?, ?) RETURNING `id`'
			).get(membership.guild_id, client_id, account_id, item_id, qty, required_gp, now, now + get_charity_wish_maturing_ms(now)) as { id: number };
			return { success: true, wish_id: wish.id };
		});
		return result ?? 400;
	});

	session_post_route('/api/charity/wish/forsake', async (req, url, client_id, json): Promise<HandlerResult> => {
		if (typeof json.command_id !== 'string') return 400;
		const result = run_charity_wish_command(client_id, json.command_id, 'forsake', (): JsonObject => {
			if (is_social_only_client(client_id)) return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const wish = db.query<{ id: number; matures_at: number }, [number]>(
				'SELECT `id`, `matures_at` FROM `charity_wishes` WHERE `owner_client_id` = ?'
			).get(client_id);
			if (wish === null) return { success: false, error_lang: 'MOD_MP_CHARITY_WISH_MISSING' };
			if (wish.matures_at <= Date.now()) return { success: false, error_lang: 'MOD_MP_CHARITY_WISH_CANNOT_FORSAKE' };
			db.query('DELETE FROM `charity_wishes` WHERE `id` = ?').run(wish.id);
			normalize_charity_shuffle_events(get_charity_shuffle_owner_key(client_id), false);
			return { success: true };
		});
		return result ?? 400;
	});

	session_post_route('/api/charity/wish/pick', async (req, url, client_id, json): Promise<HandlerResult> => {
		if (typeof json.command_id !== 'string') return 400;
		const result = run_charity_wish_command(client_id, json.command_id, 'pick', (): JsonObject => {
			if (is_social_only_client(client_id)) return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const wish = db.query<db_row.charity_wishes, [number]>(
				'SELECT * FROM `charity_wishes` WHERE `owner_client_id` = ?'
			).get(client_id);
			if (wish === null) return { success: false, error_lang: 'MOD_MP_CHARITY_WISH_MISSING' };
			if (wish.progress_gp < wish.required_gp) return { success: false, error_lang: 'MOD_MP_CHARITY_WISH_NOT_RIPE' };
			grant_charity_wish_to_inbox(wish);
			db.query('DELETE FROM `charity_wishes` WHERE `id` = ?').run(wish.id);
			normalize_charity_shuffle_events(get_charity_shuffle_owner_key(client_id), false);
			return { success: true };
		});
		return result ?? 400;
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

		const charity = charity_state_from_values({
			charitree_enabled: guild?.charitree_enabled === 1,
			social_only: is_social_only_client(client_id),
			charitree_take_available_at: membership.charitree_take_available_at,
			last_charity: client_row.last_charity,
			last_bonus_charity: client_row.last_bonus_charity,
			server_owned_pets: true,
			now: current_time
		});
		if (is_social_only_client(client_id))
			return { error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED', charity };
		const last_charity_cooling_down = client_row.last_charity + CHARITY_TIMEOUT > current_time;

		if (!charity.eligible)
			return {
				error_lang: 'MOD_MP_CHARITY_TIMEOUT',
				timeout: client_row.last_charity,
				timeout_bonus: 0,
				charity
			};

		const result = run_economy_command(client_id, json.command_id, 'charity-take', () => {
			if (is_social_only_client(client_id))
				return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const lock = db.query('SELECT locked_until FROM charity_currency_locks WHERE guild_id = ? AND owner_key = ? AND currency_id = ?')
				.get(guild_id, get_charity_shuffle_owner_key(client_id), item_id) as { locked_until: number } | null;
			if (lock !== null && lock.locked_until > current_time)
				return { success: false, error_lang: 'MOD_MP_CHARITY_SHUFFLE_LOCK', locked_until: lock.locked_until };
			const item_entry = db.query(
				'SELECT `qty` FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = ? LIMIT 1'
			).get(guild_id, item_id) as Pick<db_row.charity_items, 'qty'> | null;
			if (item_entry === null || (requested_qty !== undefined && requested_qty > item_entry.qty))
				return { success: false, error_lang: 'MOD_MP_CHARITY_TAKEN' };

			const item_qty = requested_qty ?? item_entry.qty;
			const item_remaining_qty = item_entry.qty - item_qty;
			consume_charity_contributions(guild_id, item_id, item_entry.qty, item_qty);
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
				item_expires_at = get_effective_charity_expiry(item_expires_at,
					get_charity_decay_context(guild_id, db, current_time));
			}

			db.query('UPDATE `clients` SET `last_charity` = ? WHERE `id` = ?').run(current_time, client_id);
			client_row.last_charity = current_time;

			const event_id = record_audit_event({
				event_type: 'charitree.taken',
				source_key: audit_command_source('charity-take', client_id, json.command_id),
				command_id: typeof json.command_id === 'string' ? json.command_id : undefined,
				actor: { kind: 'client', client_id, request: req },
				guild_id,
				occurred_at: current_time,
				values: [{ object_id: item_id, quantity: item_qty, direction: 'move' }]
			});
			move_audit_value_with_fallback(event_id, item_id, item_qty, 'charitree',
				audit_position_key('charitree', guild_id), 'inbox', audit_position_key('inbox', client_id, 'charitree', ''));
			add_inbox_items(client_id, [{ item_id, qty: item_qty }], { type: 'charitree' });
			return {
				success: true,
				item_qty,
				item_remaining_qty,
				item_expires_at,
				timeout: client_row.last_charity,
				timeout_bonus: 0,
				charity: charity_state_from_values({
					charitree_enabled: true,
					social_only: false,
					charitree_take_available_at: membership.charitree_take_available_at,
					last_charity: client_row.last_charity,
					last_bonus_charity: client_row.last_bonus_charity,
					server_owned_pets: true,
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

		const parsed_items = parse_charity_donation_items(json.items);
		if (parsed_items === null || parsed_items.length === 0)
			return 400; // Bad Request
		const items = cap_transfer_items(parsed_items);
		if (items.length === 0)
			return 400; // Bad Request
		const donation_source = json.source === undefined ? 'transfer' : json.source;
		if (donation_source !== 'transfer' && donation_source !== 'bank')
			return 400; // Bad Request
		const donation_value = json.donation_value;
		if (donation_value !== undefined && (typeof donation_value !== 'number' || !Number.isSafeInteger(donation_value) || donation_value < 0))
			return 400; // Bad Request
		const capped_donation_value = typeof donation_value === 'number'
			? Math.max(0, donation_value - get_transfer_currency_overage(parsed_items))
			: donation_value;

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
				if (item.id !== CHARITY_WEIRD_GLOOP_ID)
					add_charity_contribution(guild_id, item.id, client_id, item.qty, now);
			}
			const event_id = record_audit_event({
				event_type: 'charitree.donated',
				source_key: audit_command_source('charity-donate', client_id, json.command_id),
				command_id: typeof json.command_id === 'string' ? json.command_id : undefined,
				actor: { kind: 'client', client_id, request: req },
				guild_id,
				occurred_at: now,
				values: items.map(item => ({ object_id: item.id, quantity: item.qty, direction: 'move' })),
				details: { donation_source }
			});
			for (const item of items) {
				move_audit_value_with_fallback(event_id, item.id, item.qty, 'client',
					audit_position_key('client', client_id), 'charitree', audit_position_key('charitree', guild_id));
			}
			record_guild_activity({ guild_id, event_type: 'charitree_donated', actor_client_id: client_id,
				source_key: `charitree-donation:${json.command_id}`, created_at: now, throttled: true });
			const pet_granted = grant_charity_pet_if_rolled(client_id, capped_donation_value as number, Math.random(), now);
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
		const parsed = parse_charity_shuffle_offers(json);
		if (parsed === null) return 400;
		return run_economy_command(client_id, json.command_id, 'charity-shuffle', () => {
			if (is_social_only_client(client_id)) return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const guild = db.query('SELECT charitree_enabled FROM guilds WHERE id = ?').get(guild_id) as { charitree_enabled: number } | null;
			if (guild?.charitree_enabled !== 1) return { success: false, error_lang: 'MOD_MP_CHARITY_DISABLED' };
			const now = Date.now();
			expire_charity_items_now(now, guild_id);
			const owner = get_charity_shuffle_owner_key(client_id);
			const account_id = get_charity_wish_account(client_id);
			const active_wish = account_id !== null && db.query('SELECT 1 FROM `charity_wishes` WHERE `melvor_account_id` = ?').get(account_id) !== null;
			const shuffle_event_count = normalize_charity_shuffle_events(owner, active_wish, now);
			const active_shuffle_count = shuffle_event_count - (active_wish ? CHARITY_WISH_SHUFFLE_PENALTY : 0);
			if (parsed.max && parsed.offers.length !== CHARITY_SHUFFLE_BONUS_LIMIT - active_shuffle_count)
				return { success: false, error_lang: 'MOD_MP_CHARITY_SHUFFLE_MAX_CHANGED' };
			const totals = new Map<string, number>();
			for (const offer of parsed.offers)
				totals.set(offer.currency_id, (totals.get(offer.currency_id) ?? 0) + offer.qty);
			for (const [currency_id, qty] of totals) {
				const existing = db.query('SELECT qty FROM charity_items WHERE guild_id = ? AND item_id = ?')
					.get(guild_id, currency_id) as { qty: number } | null;
				if (!Number.isSafeInteger(qty) || !Number.isSafeInteger((existing?.qty ?? 0) + qty))
					return { success: false, error_lang: 'MOD_MP_GENERIC_ERR' };
			}
			const event_id = record_audit_event({
				event_type: 'charitree.shuffled',
				source_key: audit_command_source('charity-shuffle', client_id, json.command_id),
				command_id: typeof json.command_id === 'string' ? json.command_id : undefined,
				actor: { kind: 'client', client_id, request: req },
				guild_id,
				occurred_at: now,
				values: [...totals].map(([object_id, quantity]) => ({ object_id, quantity, direction: 'move' })),
				details: { max: parsed.max, offer_count: parsed.offers.length }
			});
			for (const [currency_id, qty] of totals) {
				move_audit_value_with_fallback(event_id, currency_id, qty, 'client',
					audit_position_key('client', client_id), 'charitree', audit_position_key('charitree', guild_id));
			}
			const clearing = db.query("SELECT MAX(charitree_expires_before) AS cutoff FROM guild_petitions WHERE guild_id = ? AND type = 'charitree_ingratitude' AND subject_locked = 1")
				.get(guild_id) as { cutoff: number | null };
			const expires_at = Math.max(now + CHARITY_ITEM_LIFETIME, (clearing.cutoff ?? -1) + 1);
			for (const [currency_id, qty] of totals) {
				const known_valuation = get_charity_known_valuation(currency_id);
				db.query('INSERT INTO charity_items (guild_id, item_id, qty, expires_at, donated_at, value_currency_id, value_per_item) ' +
					'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (guild_id, item_id) DO UPDATE SET ' +
					'qty = qty + excluded.qty, expires_at = excluded.expires_at, donated_at = excluded.donated_at, ' +
					'value_currency_id = CASE WHEN value_per_item IS NULL THEN excluded.value_currency_id ELSE value_currency_id END, ' +
					'value_per_item = COALESCE(value_per_item, excluded.value_per_item)')
					.run(guild_id, currency_id, qty, expires_at, now,
						known_valuation?.value_currency_id ?? currency_id,
						known_valuation?.value_per_item ?? 1);
				add_charity_contribution(guild_id, currency_id, client_id, qty, now);
			}
			db.query('INSERT INTO charity_shuffles (guild_id, owner_key, shuffled_at) VALUES (?, ?, ?) ' +
				'ON CONFLICT (guild_id, owner_key) DO UPDATE SET shuffled_at = excluded.shuffled_at').run(guild_id, owner, now);
			const bonus_room = Math.max(0, CHARITY_SHUFFLE_BONUS_LIMIT + (active_wish ? CHARITY_WISH_SHUFFLE_PENALTY : 0) - shuffle_event_count);
			for (let index = 0; index < Math.min(parsed.offers.length, bonus_room); index++)
				db.query('INSERT INTO charity_shuffle_events (owner_key, shuffled_at) VALUES (?, ?)').run(owner, now + index);
			for (const currency_id of totals.keys())
				db.query('INSERT INTO charity_currency_locks (guild_id, owner_key, currency_id, locked_until) VALUES (?, ?, ?, ?) ' +
					'ON CONFLICT (guild_id, owner_key, currency_id) DO UPDATE SET locked_until = excluded.locked_until')
					.run(guild_id, owner, currency_id, now + SHUFFLE_LOCK_MS);
			record_guild_activity({ guild_id, event_type: 'charitree_donated', actor_client_id: client_id,
				source_key: `charitree-shuffle:${json.command_id}`, created_at: now, throttled: true });
			let pet_granted = false;
			for (const offer of parsed.offers)
				pet_granted = grant_charity_pet_if_rolled(client_id, offer.qty, Math.random(), now) || pet_granted;
			return { success: true, ...charity_shuffle_state(guild_id, client_id, now),
				...(pet_granted ? { pet_id: 'Multiplayer_Pet_Charity' } : {}),
				effects: economy_item_effects([...totals].map(([id, qty]) => ({ id, qty })), 'bank', -1) };
		}) ?? 400;
	});
}
