import { listing_filters_from_url, parse_listing_filters } from '../listing-filters';
import { db } from '../db';
import { purchase_wish_capacity, set_wish_capacity_renewal, wish_capacity_state } from '../wish-capacity';
import * as runtime from '../app-runtime';
import type { HandlerResult, JsonObject } from '../http';
import { is_client_version_at_least } from '../client-version-policy';
import { cap_transfer_items, get_transfer_currency_cap, get_transfer_currency_overage } from '../transfer-caps';
import { cast_crucible_items, claim_crucible_wish, clear_crucible_slag, crucible_actor,
	get_crucible_state, make_crucible_wish, reclaim_crucible_offering, run_crucible_wish_command,
	cancel_crucible_wish, type CastItem, type CrucibleActor } from '../crucible-actions';
import { economy_item_effects } from '../economy';

const { is_social_only_client, is_valid_item_id, parse_transfer_items, run_economy_command,
	session_get_route, session_post_route } = runtime;

function supports_crucible(req: Request): boolean {
	const version = runtime.get_request_mod_version(req);
	return version === 'development' || is_client_version_at_least(version, '1.6.0');
}

function actor_for(req: Request, client_id: number): { error: HandlerResult } | { actor: CrucibleActor } {
	if (!supports_crucible(req)) return { error: 426 as HandlerResult };
	const actor = crucible_actor(client_id);
	if (actor === null) return { error: { error_lang: 'MOD_MP_GUILD_REQUIRED' } as HandlerResult };
	if (is_social_only_client(client_id)) return { error: { error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' } as HandlerResult };
	return { actor };
}

function parse_cast_items(raw: unknown): CastItem[] | null {
	const parsed = parse_transfer_items(raw);
	if (parsed === null || !Array.isArray(raw) || parsed.length === 0) return null;
	const items: CastItem[] = [];
	for (let index = 0; index < parsed.length; index++) {
		const input = raw[index];
		if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
		const record = input as Record<string, unknown>;
		const has_currency = Object.hasOwn(record, 'value_currency_id');
		const has_value = Object.hasOwn(record, 'value_per_item');
		if (has_currency !== has_value) return null;
		const value_currency_id = has_currency ? record.value_currency_id : null;
		const value_per_item = has_value ? record.value_per_item : null;
		if ((value_currency_id !== null && !is_valid_item_id(value_currency_id)) ||
			(value_per_item !== null && (typeof value_per_item !== 'number' ||
				!Number.isSafeInteger(value_per_item) || value_per_item < 0)) ||
			(value_per_item === null && value_currency_id !== null) ||
			(typeof value_per_item === 'number' && value_per_item > 0 && value_currency_id === null))
			return null;
		items.push({ ...parsed[index]!, value_currency_id: value_currency_id as string | null,
			value_per_item: value_per_item as number | null });
	}
	return items;
}

function parse_clear_offer(value: unknown): { currency_id: string; qty: number } | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const cap = get_transfer_currency_cap(record.currency_id as string);
	if (cap === null || !Number.isSafeInteger(record.balance) || (record.balance as number) <= 1_000)
		return null;
	return { currency_id: record.currency_id as string,
		qty: Math.min(Math.floor((record.balance as number) / 1_000), cap) };
}

function parse_clear_offers(json: JsonObject): Array<{ currency_id: string; qty: number }> | null {
	if (!Array.isArray(json.offers)) {
		const offer = parse_clear_offer(json);
		return offer === null ? null : [offer];
	}
	if (json.offers.length < 1 || json.offers.length > 30) return null;
	const balances = new Map<string, number>();
	const offers: Array<{ currency_id: string; qty: number }> = [];
	for (const raw of json.offers) {
		const offer = parse_clear_offer(raw);
		if (offer === null) return null;
		const balance = (raw as { balance: number }).balance;
		const expected = balances.get(offer.currency_id);
		if (expected !== undefined && expected !== balance) return null;
		balances.set(offer.currency_id, balance - offer.qty);
		offers.push(offer);
	}
	return offers;
}

export function register_crucible_routes(): void {
	session_get_route('/api/crucible/contents', async (req, url, client_id): Promise<HandlerResult> => {
		const result = actor_for(req, client_id);
		if ('error' in result) return result.error;
		const filters = listing_filters_from_url(url);
		if (filters === null) return 400;
		return get_crucible_state(result.actor!, Date.now(), filters) ?? { enabled: false };
	});

	session_post_route('/api/crucible/cast', async (req, url, client_id, json): Promise<HandlerResult> => {
		const result = actor_for(req, client_id);
		if ('error' in result) return result.error;
		const parsed = parse_cast_items(json.items);
		if (parsed === null || (json.source !== 'bank' && json.source !== 'transfer')) return 400;
		const items = cap_transfer_items(parsed);
		if (items.length === 0) return 400;
		const donation_value = json.donation_value === undefined ? 0 : json.donation_value;
		if (!Number.isSafeInteger(donation_value) || (donation_value as number) < 0) return 400;
		try {
			return run_economy_command(client_id, json.command_id, 'crucible-cast', () => {
				const response = cast_crucible_items(result.actor!, items, String(json.command_id), Date.now(),
					Math.max(0, (donation_value as number) - get_transfer_currency_overage(parsed)));
				return response.success === true ? { ...response,
					effects: economy_item_effects(items, json.source as 'bank' | 'transfer', -1) } : response;
			}) ?? 400;
		} catch (error) { return error instanceof RangeError ? 400 : 500; }
	});

	session_post_route('/api/crucible/reclaim', async (req, url, client_id, json): Promise<HandlerResult> => {
		const result = actor_for(req, client_id);
		if ('error' in result) return result.error;
		if (!is_valid_item_id(json.item_id) || !Number.isSafeInteger(json.qty) || (json.qty as number) <= 0)
			return 400;
		const filters = parse_listing_filters(json.listing_filters);
		if (filters === null) return 400;
		try {
			return run_economy_command(client_id, json.command_id, 'crucible-reclaim', () => {
				const response = reclaim_crucible_offering(result.actor!, json.item_id as string, json.qty as number,
					Date.now(), String(json.command_id), filters);
				return response.success === true ? { ...response, effects: [] } : response;
			}) ?? 400;
		} catch (error) { return error instanceof RangeError ? 400 : 500; }
	});

	session_post_route('/api/crucible/clear', async (req, url, client_id, json): Promise<HandlerResult> => {
		const result = actor_for(req, client_id);
		if ('error' in result) return result.error;
		const offers = parse_clear_offers(json);
		if (offers === null) return 400;
		try {
			return run_economy_command(client_id, json.command_id, 'crucible-clear', () => {
				const response = clear_crucible_slag(result.actor!, offers, String(json.command_id));
				return response.success === true ? { ...response, effects: economy_item_effects(
					offers.map(offer => ({ id: offer.currency_id, qty: offer.qty })), 'bank', -1) } : response;
			}) ?? 400;
		} catch (error) { return error instanceof RangeError ? 400 : 500; }
	});

	session_post_route('/api/crucible/wish/make', async (req, url, client_id, json): Promise<HandlerResult> => {
		// Historical server-only Make commands remain recoverable without imposing new payments.
		const legacy = db.query<{ response_json: string }, [number, string]>(
			"SELECT response_json FROM crucible_commands WHERE client_id=? AND id=? AND kind='make'")
			.get(client_id, String(json.command_id));
		if (legacy) return JSON.parse(legacy.response_json) as JsonObject;
		const result = actor_for(req, client_id);
		if ('error' in result) return result.error;
		const version = runtime.get_request_mod_version(req);
		if (version !== 'development' && !is_client_version_at_least(version, '1.6.11')) {
			// Released clients use the server-only journal and cannot apply upfront payment receipts.
			if (!is_valid_item_id(json.item_id) || !Number.isSafeInteger(json.qty) ||
				(json.qty as number) < 1 || (json.qty as number) > 100 ||
				json.ep_micros !== undefined || json.gp !== undefined || json.gp_balance !== undefined) return 400;
			return run_crucible_wish_command(client_id, json.command_id, 'make', () =>
				make_crucible_wish(result.actor!, json.item_id as string, json.qty as number, null)) ?? 400;
		}
		if (!is_valid_item_id(json.item_id) || !Number.isSafeInteger(json.qty) ||
			(json.qty as number) < 1 || (json.qty as number) > 1000 ||
			!Number.isSafeInteger(json.ep_micros) || !Number.isSafeInteger(json.gp) ||
			!Number.isSafeInteger(json.gp_balance)) return 400;
		try {
			return run_economy_command(client_id, json.command_id, 'crucible-wish-make', () => {
				const response = make_crucible_wish(result.actor!, json.item_id as string, json.qty as number,
					{ command_id: String(json.command_id), ep_micros: json.ep_micros as number,
						gp: json.gp as number, gp_balance: json.gp_balance as number });
				return response.success === true ? { ...response,
					effects: economy_item_effects([{ id: 'melvorD:GP', qty: response.paid_gp as number }], 'bank', -1) } : response;
			}) ?? 400;
		} catch (error) { return error instanceof RangeError ? 400 : 500; }
	});
	for (const kind of ['capacity', 'renewal'] as const) {
		session_post_route(`/api/crucible/wish/${kind}`, async (req, url, client_id, json): Promise<HandlerResult> => {
			const result = actor_for(req, client_id);
			if ('error' in result) return result.error;
			const version = runtime.get_request_mod_version(req);
			if (version !== 'development' && !is_client_version_at_least(version, '1.6.11'))
				return { success: false, error_lang: 'MOD_MP_UNSUPPORTED_VERSION_MESSAGE' };
			if (typeof json.auto_renew !== 'boolean' || !Number.isSafeInteger(json.ep_micros) ||
				(kind === 'capacity' && !Number.isSafeInteger(json.base))) return 400;
			if (result.actor!.account_id === null) return { success: false, error: 'Melvor account is required.' };
			return run_economy_command(client_id, json.command_id, `crucible-wish-${kind}`, () => {
				if (kind === 'capacity') return purchase_wish_capacity(db, client_id, json.base as number,
					json.auto_renew as boolean, json.ep_micros as number, String(json.command_id));
				if (wish_capacity_state(db, client_id).renewal_micros !== json.ep_micros)
					return { success: false, error: 'wish_quote_changed' };
				return set_wish_capacity_renewal(db, client_id, json.auto_renew as boolean);
			}) ?? 400;
		});
	}

	for (const [path, kind, operation] of [
		['/api/crucible/wish/cancel', 'cancel', cancel_crucible_wish],
		['/api/crucible/wish/claim', 'claim', claim_crucible_wish]
	] as const) {
		session_post_route(path, async (req, url, client_id, json): Promise<HandlerResult> => {
			const result = actor_for(req, client_id);
			if ('error' in result) return result.error;
			return run_crucible_wish_command(client_id, json.command_id, kind,
				() => operation(result.actor!)) ?? 400;
		});
	}
}
