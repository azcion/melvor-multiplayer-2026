// #region IMPORTS
import { format } from 'node:util';
import {
	db,
	db_get_single,
	db_execute,
	db_insert,
	db_exists,
	db_get_all,
	db_run,
	get_service_setting,
	register_client
} from './db';
import {
	CAMPAIGN_AUTO_ADVANCE_INTERVAL,
	CAMPAIGN_AUTO_CONTRIBUTION_CAP,
	CAMPAIGN_AUTO_PROGRESS_SQL,
	get_campaign_auto_advance,
	get_campaign_item_total,
	get_required_campaign_contributors
} from './campaign';
import {
	COUNCIL_HISTORY_PAGE_SIZE,
	COUNCIL_MAINTENANCE_INTERVAL,
	get_petition_conflict_subject,
	get_petition_resolution,
	is_petition_choice,
	is_petition_type,
	PETITION_FAILED_RETRY_AFTER,
	PETITION_LIFETIME,
	PETITION_RUNNING_STALE_AFTER
} from './council';
import {
	create_http_server,
	identify_request,
	read_json_request,
	status_response,
	validate_json_request
} from './http';
import type { HandlerReturnType, JsonObject, JsonSerializable, RequestHandler } from './http';
import { report_error, write_log } from './log';
import { load_request_limit_configuration, RequestLimitPolicy } from './security';
import { AVAILABLE_CAMPAIGNS } from './campaign_data';
import type { CampaignData, CampaignItemData } from './campaign_data';
import type * as db_row from './db/types/db_types';
import { BACKEND_VERSION } from './version';
import {
	CHAT_BUDGET_ERROR,
	CHAT_PRIVACY_ERROR,
	delete_conversation,
	delete_message,
	get_chat_state,
	get_unread_chat_count,
	list_conversations,
	list_messages,
	send_message,
	set_block,
	set_messaging_enabled,
	start_conversation
} from './chat';
import {
	acknowledge_deletion_return_claim,
	associate_client_with_melvor_account,
	cancel_deletion_on_authentication,
	cancel_scheduled_client_deletion,
	CLIENT_DELETION_MAINTENANCE_INTERVAL,
	create_deletion_return_claim,
	get_deletion_claim_view,
	has_deletion_returns,
	list_sibling_identities,
	parse_melvor_account,
	process_due_client_deletions,
	recover_deleted_client,
	schedule_client_deletion
} from './identity';
// #endregion

// #region TYPES
type SessionRequestHandler = (req: Request, url: URL, client_id: number, json: JsonObject) => HandlerReturnType;
type CachedSession = { client_id: number, last_access: number };

type ActiveTrade = {
	trade_id: number;
	state: number;
	attending_id: number;
}

type FriendRequest = {
	friend: ClientDisplayInfo,
	request_id: number;
}

enum GiftFlags {
	Returned = 1 << 0
}

type TransferItem = {
	id: string;
	qty: number;
}

type ClientDisplayInfo = {
	display_name: string;
	icon_id: string;
}

type EquipmentSnapshotSlot = {
	slot_id: string;
	item_id: string;
}

type PlayerStatusSkill = {
	skill_id: string;
	level: number;
}

type PlayerStatusActivity =
	| { type: 'idle' }
	| { type: 'skill'; skill_id: string; action_id: string }
	| { type: 'combat'; area_id: string | null };

type GuildMemberRow = {
	client_id: number;
	display_name: string;
	icon_id: string;
	equipment_visible: number;
	equipment_available: number;
	status_visible: number;
	status_available: number;
	status_activity_type: 'idle' | 'skill' | 'combat' | null;
	status_activity_skill_id: string | null;
	status_activity_action_id: string | null;
	status_activity_area_id: string | null;
};

type GuildSummary = {
	guild_id: number;
	name: string;
	icon_id: string;
	member_count: number;
	is_free_fellowship?: boolean;
}

type GuildType = 'private' | 'free_fellowship';

type GuildCapabilities = {
	roster: boolean;
	equipment_snapshots: boolean;
	status_snapshots: boolean;
	gifts: boolean;
	trades: boolean;
	marketplace: boolean;
	charitree: boolean;
	campaigns: boolean;
	council: boolean;
	member_search: boolean;
};

const FREE_FELLOWSHIP_TYPE: GuildType = 'free_fellowship';
const GUILD_MEMBER_PAGE_SIZE = 50;

const GUILD_CAPABILITIES: Record<GuildType, GuildCapabilities> = {
	private: {
		roster: true,
		equipment_snapshots: true,
		status_snapshots: true,
		gifts: true,
		trades: true,
		marketplace: true,
		charitree: true,
		campaigns: true,
		council: true,
		member_search: true
	},
	free_fellowship: {
		roster: true,
		equipment_snapshots: true,
		status_snapshots: true,
		gifts: true,
		trades: true,
		marketplace: true,
		charitree: true,
		campaigns: true,
		council: false,
		member_search: true
	}
};

function get_guild_capabilities(type: GuildType): GuildCapabilities {
	return { ...GUILD_CAPABILITIES[type] };
}

function guild_summary_from_row(row: GuildSummary & { type: GuildType }): GuildSummary {
	return row.type === FREE_FELLOWSHIP_TYPE
		? { guild_id: row.guild_id, name: row.name, icon_id: row.icon_id, member_count: row.member_count,
			is_free_fellowship: true }
		: { guild_id: row.guild_id, name: row.name, icon_id: row.icon_id, member_count: row.member_count };
}

type CouncilPetitionRow = db_row.guild_petitions & {
	eligible_count: number;
	aye_count: number;
	nay_count: number;
	current_vote: 'aye' | 'nay' | null;
	is_eligible: number;
	target_display_name: string | null;
	target_icon_id: string | null;
}

type GuildCampaign = {
	guild_id: number;
	active_id: number;
	campaign_id: string;
	item_id: string;
	item_total: number;
	item_current: number;
	required_contributors: number;
	auto_contribution: number;
	pct: number;
	next_active_timestamp: number;
	restart_timer: ReturnType<typeof setTimeout> | null;
}
// #endregion

// #region CONSTANTS
const DEFAULT_USER_ICON_ID = 'melvorD:Plant';
const DEFAULT_USER_DISPLAY_NAME = 'Unknown Idler';
const MAX_TRANSFER_ITEM_COUNT = 32;
const MAX_MARKET_ITEM_NAMESPACE_COUNT = 64;
const MAX_MARKET_ITEM_NAMESPACE_LENGTH = 64;
const MAX_ITEM_ID_LENGTH = 256;
const MAX_EQUIPMENT_SLOT_COUNT = 32;
const MAX_EQUIPMENT_ID_LENGTH = 256;
const MAX_STATUS_SKILL_COUNT = 64;
const MAX_STATUS_ID_LENGTH = 256;

// maximum cache life is X * 2, minimum is X.
const CACHE_SESSION_LIFETIME = 1000 * 60 * 60; // 1 hour

// time between data cache sweeps
const CACHE_RESET_INTERVAL = 1000 * 60 * 60 * 24; // 24 hours

// time between players taking charity items
const CHARITY_TIMEOUT = 1000 * 60 * 60 * 24; // 24 hours

const CAMPAIGN_RESTART_TIMER = 1000 * 60 * 60 * 12; // 12 hours

const MARKET_ITEMS_PER_PAGE = 30;

const CORS_ALLOWED_ORIGINS = new Set(
	(process.env.CORS_ALLOWED_ORIGINS ?? '')
		.split(',')
		.map(origin => origin.trim())
		.filter(origin => origin.length > 0)
);
// #endregion

// #region GLOBALS
const server = create_http_server(Number(process.env.SERVER_PORT));
const request_limits = new RequestLimitPolicy(load_request_limit_configuration());

const client_session_cache = new Map<string, CachedSession>();

const friend_request_cache = new Map<number, FriendRequest[]>();
const gift_cache = new Map<number, number[]>();
const display_name_cache = new Map<number, string>();
const display_icon_cache = new Map<number, string>();
const market_completed_cached = new Map<number, number[]>();

const trade_cache = new Map<number, ActiveTrade>(); // trade_id to ActiveTrade
const trade_player_cache = new Map<number, number[]>(); // client_id to trade_id[]
const resolved_trade_cache = new Map<number, number[]>(); // client_id to trade_id[]

const guild_campaigns = new Map<number, GuildCampaign>();
// #endregion

// #region COMMON FN
function log(prefix: string, message: string, ...args: unknown[]): void {
	let formatted_message = format('[{' + prefix + '}] ' + message, ...args);
	formatted_message = formatted_message.replace(/\{([^}]+)\}/g, '$1');

	write_log('info', `type=application message=${JSON.stringify(formatted_message)}`);
}

function default_handler(status_code: number): Response {
	return status_response(status_code);
}

function temporary_unavailable(): Response {
	return new Response('Service Unavailable', {
		status: 503,
		headers: { 'Retry-After': '300' }
	});
}

function require_service_available(handler: RequestHandler): RequestHandler {
	return (req, url) => {
		if (get_service_setting('maintenance') === '1')
			return temporary_unavailable();
		return handler(req, url);
	};
}

function require_source_capacity(handler: RequestHandler): RequestHandler {
	return (req, url) => request_limits.limit_source(req) ?? handler(req, url);
}

function require_registration_capacity(handler: RequestHandler): RequestHandler {
	return (req, url) => request_limits.limit_registration(req) ?? handler(req, url);
}

function browser_response(req: Request, result: unknown): Response {
	let response: Response;

	if (result instanceof Response) {
		response = result;
	} else if (result instanceof Blob) {
		response = new Response(result);
	} else if (typeof result === 'number') {
		response = default_handler(result);
	} else if (typeof result === 'object') {
		response = Response.json(result);
	} else {
		response = new Response(String(result), {
			headers: { 'Content-Type': 'text/html' }
		});
	}

	const origin = req.headers.get('Origin');
	if (origin === null)
		return response;

	const headers = new Headers(response.headers);
	headers.set('Access-Control-Allow-Origin', origin);
	headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
	headers.append('Vary', 'Origin');

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

function allow_browser_access(handler: RequestHandler): RequestHandler {
	return async (req: Request, url: URL) => {
		const origin = req.headers.get('Origin');
		if (origin !== null && !CORS_ALLOWED_ORIGINS.has(origin))
			return default_handler(403);

		if (req.method === 'OPTIONS')
			return browser_response(req, new Response(null, { status: 204 }));

		return browser_response(req, await handler(req, url));
	};
}

function is_valid_uuid(uuid: string): boolean {
	return uuid.length === 36 && /^[0-9a-f-]+$/.test(uuid);
}

function remove_player_cache_entry(cache: Map<number, number[]>, client_id: number, item_id: number) {
	const cached_entries = cache.get(client_id);
	if (cached_entries)
		cache.set(client_id, cached_entries.filter(e => e !== item_id));
}

function validate_item_array(items: unknown) {
	if (!Array.isArray(items))
		return false;

	for (const item of items) {
		if (typeof item !== 'object' || item === null || Array.isArray(item))
			return false;

		// @ts-ignore
		if (!is_valid_item_id(item.id) || typeof item.qty !== 'number')
			return false;

		if (item.qty <= 0 || !Number.isSafeInteger(Math.trunc(item.qty)))
			return false;

		item.qty = Math.trunc(item.qty);

	}

	return true;
}

function array_random(arr: Array<unknown>) {
	return arr[Math.floor(Math.random() * arr.length)];
}

function parse_guild_name(guild_name: unknown): string | null {
	if (typeof guild_name !== 'string')
		return null;

	const trimmed = guild_name.trim();
	return trimmed.length > 0 && trimmed.length <= 20 ? trimmed : null;
}

function is_valid_icon_id(icon_id: unknown): icon_id is string {
	return typeof icon_id === 'string' && (icon_id.startsWith('melvorF:') || icon_id.startsWith('melvorD:'));
}

function is_valid_equipment_id(id: unknown): id is string {
	return typeof id === 'string' && id.length > 0 && id.length <= MAX_EQUIPMENT_ID_LENGTH &&
		/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(id);
}

function is_valid_item_id(id: unknown): id is string {
	return typeof id === 'string' && id.length > 0 && id.length <= MAX_ITEM_ID_LENGTH &&
		/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(id);
}

function parse_equipment_snapshot(slots: unknown): EquipmentSnapshotSlot[] | null {
	if (!Array.isArray(slots) || slots.length > MAX_EQUIPMENT_SLOT_COUNT)
		return null;

	const parsed: EquipmentSnapshotSlot[] = [];
	const seen_slots = new Set<string>();
	for (const slot of slots) {
		if (typeof slot !== 'object' || slot === null || Array.isArray(slot))
			return null;
		const { slot_id, item_id } = slot as Record<string, unknown>;
		if (!is_valid_equipment_id(slot_id) || !is_valid_equipment_id(item_id) || seen_slots.has(slot_id))
			return null;
		seen_slots.add(slot_id);
		parsed.push({ slot_id, item_id });
	}

	return parsed;
}

function is_valid_status_id(id: unknown): id is string {
	return typeof id === 'string' && id.length > 0 && id.length <= MAX_STATUS_ID_LENGTH &&
		/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(id);
}

function is_valid_status_action_id(id: unknown): id is string {
	return typeof id === 'string' && id.length > 0 && id.length <= MAX_STATUS_ID_LENGTH &&
		/^[A-Za-z0-9_.:-]+$/.test(id);
}

function parse_player_status_activity(activity: unknown): PlayerStatusActivity | null {
	if (typeof activity !== 'object' || activity === null || Array.isArray(activity))
		return null;

	const value = activity as Record<string, unknown>;
	if (value.type === 'idle')
		return { type: 'idle' };
	if (value.type === 'skill') {
		const action_id = value.action_id ?? value.task_id;
		if (!is_valid_status_id(value.skill_id) || !is_valid_status_action_id(action_id))
			return null;
		return { type: 'skill', skill_id: value.skill_id, action_id };
	}
	if (value.type === 'combat') {
		if (value.area_id !== null && value.area_id !== undefined && !is_valid_status_id(value.area_id))
			return null;
		return { type: 'combat', area_id: value.area_id ?? null };
	}
	return null;
}

function parse_player_status_skills(skills: unknown): PlayerStatusSkill[] | null {
	if (!Array.isArray(skills) || skills.length > MAX_STATUS_SKILL_COUNT)
		return null;

	const parsed: PlayerStatusSkill[] = [];
	const seen_skills = new Set<string>();
	for (const skill of skills) {
		if (typeof skill !== 'object' || skill === null || Array.isArray(skill))
			return null;
		const { skill_id, level } = skill as Record<string, unknown>;
		if (!is_valid_status_id(skill_id) || !Number.isSafeInteger(level) || (level as number) < 0 ||
			seen_skills.has(skill_id))
			return null;
		seen_skills.add(skill_id);
		parsed.push({ skill_id, level: level as number });
	}

	return parsed;
}
// #endregion

// #region MAINTENANCE
function sweep_data_caches() {
	clear_data_caches();
	setTimeout(sweep_data_caches, CACHE_RESET_INTERVAL);
}

function clear_data_caches() {
	friend_request_cache.clear();
	gift_cache.clear();
	display_name_cache.clear();
	display_icon_cache.clear();
	market_completed_cached.clear();

	trade_cache.clear();
	trade_player_cache.clear();
	resolved_trade_cache.clear();
}

function invalidate_client_sessions(client_id: number) {
	for (const [token, session] of client_session_cache)
		if (session.client_id === client_id)
			client_session_cache.delete(token);
}

function sweep_client_session_cache() {
	const current_time = Date.now();

	for (const [session_token, session] of client_session_cache)
		if (current_time - session.last_access > CACHE_SESSION_LIFETIME)
			client_session_cache.delete(session_token);

	setTimeout(sweep_client_session_cache, CACHE_SESSION_LIFETIME);
}

function expire_petitions(now = Date.now()): number {
	return db.query(
		"UPDATE `guild_petitions` SET `lifecycle` = 'lapsed', `resolved_at` = `expires_at`, " +
		"`subject_locked` = 0 WHERE `lifecycle` = 'active' AND `expires_at` <= ?"
	).run(now).changes;
}

function claim_council_action(now = Date.now()): db_row.guild_petitions | null {
	const claim = db.transaction(() => {
		const petition = db.query(
			"SELECT * FROM `guild_petitions` WHERE `lifecycle` = 'granted' " +
			"AND `type` IN ('appellation', 'heraldry', 'banishment') AND (" +
			"`execution_state` = 'pending' OR " +
			"(`execution_state` = 'failed' AND `execution_last_attempt_at` <= ?) OR " +
			"(`execution_state` = 'running' AND `execution_last_attempt_at` <= ?)) " +
			'ORDER BY `id` LIMIT 1'
		).get(
			now - PETITION_FAILED_RETRY_AFTER,
			now - PETITION_RUNNING_STALE_AFTER
		) as db_row.guild_petitions;
		if (petition === null)
			return null;

		const updated = db.query(
			"UPDATE `guild_petitions` SET `execution_state` = 'running', " +
			'`execution_attempts` = `execution_attempts` + 1, `execution_last_attempt_at` = ?, ' +
			'`execution_failure_category` = NULL, `execution_failure_message` = NULL ' +
			'WHERE `id` = ? AND `execution_state` = ?'
		).run(now, petition.id, petition.execution_state);
		if (updated.changes !== 1)
			return null;
		return {
			...petition,
			execution_state: 'running' as const,
			execution_attempts: petition.execution_attempts + 1,
			execution_last_attempt_at: now
		};
	});
	return claim.immediate();
}

function ensure_banishment_return(
	petition: db_row.guild_petitions,
	client_id: number,
	notice_pending: boolean,
	now: number
): number {
	const result = db.query(
		'INSERT INTO `banishment_returns` (`petition_id`, `client_id`, `guild_id`, `guild_name`, ' +
		'`notice_pending`, `created_at`) VALUES(?, ?, ?, ?, ?, ?) ' +
		'ON CONFLICT (`petition_id`, `client_id`) DO UPDATE SET ' +
		'`notice_pending` = MAX(`notice_pending`, excluded.`notice_pending`) RETURNING `id`'
	).get(
		petition.id,
		client_id,
		petition.guild_id,
		petition.guild_name,
		notice_pending ? 1 : 0,
		now
	) as { id: number };
	return result.id;
}

function add_banishment_return_item(return_id: number, item_id: string, qty: number) {
	if (qty <= 0)
		return;
	db.query(
		'INSERT INTO `banishment_return_items` (`return_id`, `item_id`, `qty`) VALUES(?, ?, ?) ' +
		'ON CONFLICT (`return_id`, `item_id`) DO UPDATE SET `qty` = `qty` + excluded.`qty`'
	).run(return_id, item_id, qty);
}

function apply_banishment_action(petition: db_row.guild_petitions): string {
	const now = Date.now();
	const banish = db.transaction(() => {
		const membership = db.query(
			'SELECT `id` FROM `guild_memberships` WHERE `id` = ? AND `client_id` = ? AND `guild_id` = ? LIMIT 1'
		).get(
			petition.target_membership_id,
			petition.target_client_id,
			petition.guild_id
		) as { id: number } | null;
		if (membership === null)
			return { effect: 'already_absent', dissolved: false, trade_ids: [] as number[] };

		const target_client_id = petition.target_client_id as number;
		const target_return_id = ensure_banishment_return(petition, target_client_id, true, now);
		const market_items = db.query(
			'SELECT * FROM `market_items` WHERE `client_id` = ? AND `guild_id` = ?'
		).all(target_client_id, petition.guild_id) as db_row.market_items[];
		let gp = 0;
		for (const item of market_items) {
			add_banishment_return_item(target_return_id, item.item_id, item.available);
			gp += Math.max((item.qty - item.available) * item.price - item.payout, 0);
		}
		if (gp > 0)
			db.query('UPDATE `banishment_returns` SET `gp` = `gp` + ? WHERE `id` = ?').run(gp, target_return_id);
		db.query('DELETE FROM `market_items` WHERE `client_id` = ? AND `guild_id` = ?').run(
			target_client_id,
			petition.guild_id
		);

		const trades = db.query(
			'SELECT * FROM `trade_offers` WHERE `sender_id` = ? OR `recipient_id` = ?'
		).all(target_client_id, target_client_id) as db_row.trade_offers[];
		for (const trade of trades) {
			const items = db.query('SELECT * FROM `trade_items` WHERE `trade_id` = ?').all(
				trade.trade_id
			) as db_row.trade_items[];
			for (const item of items) {
				const owner_id = item.counter === 0 ? trade.sender_id : trade.recipient_id;
				const return_id = ensure_banishment_return(
					petition,
					owner_id,
					owner_id === target_client_id,
					now
				);
				add_banishment_return_item(return_id, item.item_id, item.qty);
			}
			db.query('DELETE FROM `trade_items` WHERE `trade_id` = ?').run(trade.trade_id);
			db.query('DELETE FROM `trade_offers` WHERE `trade_id` = ?').run(trade.trade_id);
		}

		db.query('DELETE FROM `guild_memberships` WHERE `id` = ?').run(membership.id);
		const remaining = db.query(
			'SELECT COUNT(*) AS `count` FROM `guild_memberships` WHERE `guild_id` = ?'
		).get(petition.guild_id) as { count: number };
		if (remaining.count === 0)
			db.query('DELETE FROM `guilds` WHERE `id` = ?').run(petition.guild_id);

		return {
			effect: 'banished',
			dissolved: remaining.count === 0,
			trade_ids: trades.map(trade => trade.trade_id),
			trade_clients: trades.flatMap(trade => [trade.sender_id, trade.recipient_id])
		};
	});

	const result = banish.immediate();
	for (const trade_id of result.trade_ids)
		trade_cache.delete(trade_id);
	if ('trade_clients' in result) {
		for (const client_id of result.trade_clients)
			trade_player_cache.delete(client_id);
	}
	market_completed_cached.delete(petition.target_client_id as number);
	if (result.dissolved)
		forget_guild_campaign(petition.guild_id);
	else if (result.effect === 'banished')
		void resize_unprogressed_campaign(petition.guild_id);
	return result.effect;
}

function apply_council_guild_action(petition: db_row.guild_petitions): string {
	if (petition.type === 'appellation') {
		const updated = db.query('UPDATE `guilds` SET `name` = ? WHERE `id` = ?').run(
			petition.proposed_name,
			petition.guild_id
		);
		return updated.changes === 1 ? 'updated' : 'guild_absent';
	}
	if (petition.type === 'heraldry') {
		const updated = db.query('UPDATE `guilds` SET `icon_id` = ? WHERE `id` = ?').run(
			petition.proposed_icon_id,
			petition.guild_id
		);
		return updated.changes === 1 ? 'updated' : 'guild_absent';
	}
	return apply_banishment_action(petition);
}

function process_council_actions(max_actions = 20): number {
	let processed = 0;
	while (processed < max_actions) {
		const petition = claim_council_action();
		if (petition === null)
			break;

		try {
			const effect = apply_council_guild_action(petition);
			db.query(
				"UPDATE `guild_petitions` SET `execution_state` = 'succeeded', `execution_effect` = ?, " +
				'`subject_locked` = 0 WHERE `id` = ? AND `execution_state` = \'running\''
			).run(effect, petition.id);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			db.query(
				"UPDATE `guild_petitions` SET `execution_state` = 'failed', " +
				'`execution_failure_category` = ?, `execution_failure_message` = ? ' +
				'WHERE `id` = ? AND `execution_state` = \'running\''
			).run('action_error', message.slice(0, 200), petition.id);
			report_error(`Council action ${petition.id} failed`, error);
		}
		processed++;
	}
	return processed;
}

function maintain_council() {
	try {
		expire_petitions();
		process_council_actions();
	} catch (error) {
		report_error('Council maintenance failed', error);
	}
	setTimeout(maintain_council, COUNCIL_MAINTENANCE_INTERVAL);
}

function execute_due_client_deletions(now = Date.now()) {
	const executions = process_due_client_deletions(now);
	if (executions.length === 0)
		return executions;
	clear_data_caches();
	for (const execution of executions) {
		invalidate_client_sessions(execution.target_client_id);
		if (execution.guild_id === null)
			continue;
		if (execution.dissolved)
			forget_guild_campaign(execution.guild_id);
		else
			void resize_unprogressed_campaign(execution.guild_id);
	}
	return executions;
}

function maintain_client_deletions() {
	try {
		execute_due_client_deletions();
	} catch (error) {
		report_error('Client deletion maintenance failed', error);
	}
	setTimeout(maintain_client_deletions, CLIENT_DELETION_MAINTENANCE_INTERVAL);
}

setTimeout(sweep_client_session_cache, CACHE_SESSION_LIFETIME);
setTimeout(sweep_data_caches, CACHE_RESET_INTERVAL);
maintain_council();
maintain_client_deletions();
// #endregion

// #region MARKET
async function market_list_item(guild_id: number, client_id: number, item_id: string, item_qty: number, item_sell_price: number) {
	const lot = await db_get_single(
		'INSERT INTO `market_items` (`guild_id`, `client_id`, `item_id`, `qty`, `price`, `available`) VALUES(?, ?, ?, ?, ?, ?) ' +
		'ON CONFLICT (`guild_id`, `client_id`, `item_id`, `price`) DO UPDATE SET `qty` = `qty` + excluded.`qty`, ' +
		'`available` = `available` + excluded.`available` RETURNING `id`',
		[guild_id, client_id, item_id, item_qty, item_sell_price, item_qty]
	) as db_row.market_items;

	if (lot !== null)
		remove_player_cache_entry(market_completed_cached, client_id, lot.id);
}

async function get_market_completed(client_id: number) {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return [];

	const cached = market_completed_cached.get(client_id);
	if (cached)
		return cached;

	const results = await db_get_all(
		'SELECT `id` FROM `market_items` WHERE `guild_id` = ? AND `client_id` = ? AND `available` = 0',
		[guild_id, client_id]
	) as db_row.market_items[];
	const completed = results.map(row => row.id);

	market_completed_cached.set(client_id, completed);
	return completed;
}
// #endregion

// #region CAMPAIGN
function empty_guild_campaign(guild_id: number): GuildCampaign {
	return {
		guild_id,
		active_id: 0,
		campaign_id: '',
		item_id: '',
		item_total: 0,
		item_current: 0,
		required_contributors: 1,
		auto_contribution: 0,
		pct: 0,
		next_active_timestamp: 0,
		restart_timer: null
	};
}

function forget_guild_campaign(guild_id: number) {
	const campaign = guild_campaigns.get(guild_id);
	if (campaign?.restart_timer !== null)
		clearTimeout(campaign.restart_timer);
	guild_campaigns.delete(guild_id);
}

async function start_new_campaign(guild_id: number): Promise<GuildCampaign | null> {
	if (!(await db_exists('SELECT 1 FROM `guilds` WHERE `id` = ? LIMIT 1', [guild_id]))) {
		forget_guild_campaign(guild_id);
		return null;
	}

	const guild = await get_guild_summary(guild_id);
	if (guild === null)
		return null;
	if (guild.is_free_fellowship === true && guild.member_count === 0) {
		const existing = guild_campaigns.get(guild_id);
		if (existing === undefined)
			return null;
		if (existing.restart_timer !== null)
			clearTimeout(existing.restart_timer);
			existing.restart_timer = null;
		return existing;
	}

	const campaign_data = array_random(AVAILABLE_CAMPAIGNS) as CampaignData;
	const campaign_item = array_random(campaign_data.items) as CampaignItemData;

	const campaign = guild_campaigns.get(guild_id) ?? empty_guild_campaign(guild_id);
	if (campaign.restart_timer !== null)
		clearTimeout(campaign.restart_timer);

	campaign.campaign_id = campaign_data.id;
	campaign.item_id = campaign_item.id;
	campaign.next_active_timestamp = 0;
	campaign.required_contributors = get_required_campaign_contributors(guild.member_count);
	campaign.item_total = get_campaign_item_total(
		campaign_item.estimated_12h_output,
		campaign.required_contributors
	);
	campaign.item_current = 0;
	campaign.auto_contribution = 0;
	campaign.pct = 0;
	campaign.restart_timer = null;
	campaign.active_id = await db_insert(
		'INSERT INTO `campaign_state` ' +
		'(`guild_id`, `campaign_id`, `item_id`, `item_amount`, `required_contributors`) VALUES(?, ?, ?, ?, ?)',
		[
			guild_id,
			campaign.campaign_id,
			campaign.item_id,
			campaign.item_total,
			campaign.required_contributors
		]
	);
	guild_campaigns.set(guild_id, campaign);

	log(
		'campaign',
		'started Guild {%d} campaign {%s} {%s} {%s}',
		guild_id,
		campaign.campaign_id,
		campaign.item_id,
		campaign.item_total
	);
	return campaign;
}

async function update_campaign_progress(campaign: GuildCampaign) {
	campaign.pct = campaign.item_current / campaign.item_total;

	if (campaign.item_current >= campaign.item_total)
		return finalize_campaign(campaign);
}

async function finalize_campaign(campaign: GuildCampaign) {
	const completed_id = campaign.active_id;
	campaign.active_id = 0;
	campaign.next_active_timestamp = Date.now() + CAMPAIGN_RESTART_TIMER;

	await db_execute(
		'UPDATE `campaign_state` SET `complete` = 1, `campaign_next` = ? WHERE `id` = ? AND `guild_id` = ?',
		[campaign.next_active_timestamp, completed_id, campaign.guild_id]
	);

	schedule_campaign_restart(campaign);
}

async function load_campaign_state(guild_id: number): Promise<GuildCampaign | null> {
	const state = await db_get_single(
		'SELECT * FROM `campaign_state` WHERE `guild_id` = ? ORDER BY `id` DESC LIMIT 1',
		[guild_id]
	) as db_row.campaign_state;
	if (state === null)
		return start_new_campaign(guild_id);

	const campaign = empty_guild_campaign(guild_id);
	campaign.campaign_id = state.campaign_id;
	campaign.item_id = state.item_id;
	campaign.item_total = state.item_amount;
	campaign.item_current = state.item_current;
	campaign.required_contributors = state.required_contributors;
	campaign.auto_contribution = state.auto_contribution;
	campaign.pct = state.item_amount === 0 ? 0 : state.item_current / state.item_amount;
	guild_campaigns.set(guild_id, campaign);

	if (state.complete === 1) {
		campaign.next_active_timestamp = state.campaign_next;
		schedule_campaign_restart(campaign);
		return campaign;
	}

	campaign.active_id = state.id;
	log(
		'campaign',
		'loaded Guild {%d} campaign {%s} {%s}/{%s}',
		guild_id,
		campaign.campaign_id,
		campaign.item_current,
		campaign.item_total
	);
	return campaign;
}

async function ensure_guild_campaign(guild_id: number): Promise<GuildCampaign | null> {
	const cached = guild_campaigns.get(guild_id);
	if (cached !== undefined) {
		if (cached.active_id === 0 && cached.next_active_timestamp <= Date.now())
			return start_new_campaign(guild_id);
		return cached;
	}
	return load_campaign_state(guild_id);
}

async function resize_unprogressed_campaign(guild_id: number) {
	const campaign = guild_campaigns.get(guild_id);
	if (campaign === undefined || campaign.active_id === 0 || campaign.item_current > 0)
		return;

	const guild = await get_guild_summary(guild_id);
	if (guild === null)
		return;

	const required_contributors = get_required_campaign_contributors(guild.member_count);
	if (required_contributors === campaign.required_contributors)
		return;

	const per_contributor_goal = campaign.item_total / campaign.required_contributors;
	const item_total = per_contributor_goal * required_contributors;
	const updated = await db_get_single(
		'UPDATE `campaign_state` SET `item_amount` = ?, `required_contributors` = ? ' +
		'WHERE `id` = ? AND `guild_id` = ? AND `item_current` = 0 RETURNING `item_amount`',
		[item_total, required_contributors, campaign.active_id, guild_id]
	);
	if (updated === null)
		return;

	campaign.item_total = item_total;
	campaign.required_contributors = required_contributors;
	log(
		'campaign',
		'resized unprogressed Guild {%d} campaign for {%d} required contributors',
		guild_id,
		required_contributors
	);
}

function schedule_campaign_restart(campaign: GuildCampaign) {
	const current_time = Date.now();
	if (current_time >= campaign.next_active_timestamp) {
		void start_new_campaign(campaign.guild_id);
		return;
	}

	if (campaign.restart_timer !== null)
		clearTimeout(campaign.restart_timer);
	campaign.restart_timer = setTimeout(
		() => void start_new_campaign(campaign.guild_id),
		campaign.next_active_timestamp - current_time
	);
	log(
		'campaign',
		'scheduled Guild {%d} campaign restart at {%s}',
		campaign.guild_id,
		new Date(campaign.next_active_timestamp).toUTCString()
	);
}

async function get_campaign_progress(client_id: number) {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { active: false, pct: 0 };

	const campaign = await ensure_guild_campaign(guild_id);
	return {
		active: (campaign?.active_id ?? 0) > 0,
		pct: campaign?.pct ?? 0
	};
}

async function add_campaign_progress(campaign: GuildCampaign, item_qty: number) {
	const updated = await db_get_single(
		'UPDATE `campaign_state` SET `item_current` = MIN(`item_amount`, `item_current` + ?) ' +
		'WHERE `id` = ? AND `guild_id` = ? RETURNING `item_current`',
		[item_qty, campaign.active_id, campaign.guild_id]
	);
	if (updated === null)
		return;

	campaign.item_current = updated.item_current;
	await update_campaign_progress(campaign);
}

async function add_campaign_auto_progress(campaign: GuildCampaign, item_qty: number) {
	const contribution_cap = Math.floor(campaign.item_total * CAMPAIGN_AUTO_CONTRIBUTION_CAP);
	const updated = await db_get_single(
		CAMPAIGN_AUTO_PROGRESS_SQL,
		[
			item_qty,
			contribution_cap,
			item_qty,
			contribution_cap,
			campaign.active_id,
			campaign.guild_id
		]
	);
	if (updated === null)
		return;

	campaign.item_current = updated.item_current;
	campaign.auto_contribution = updated.auto_contribution;
	await update_campaign_progress(campaign);
}

async function get_campaign_history(guild_id: number, client_id: number) {
	return await db_get_all(
		'SELECT a.`item_amount`, a.`taken`, b.`id`, b.`campaign_id`, b.`item_id` ' +
		'FROM `campaign_contributions` AS a JOIN `campaign_state` AS b ON a.`campaign_id` = b.`id` ' +
		'WHERE b.`guild_id` = ? AND a.`client_id` = ? AND b.`complete` = 1 ' +
		'ORDER BY a.`campaign_id` DESC LIMIT 15',
		[guild_id, client_id]
	);
}

async function get_campaign_rankings(guild_id: number, client_id: number) {
	const rankings_raw = await db_get_all(
		'SELECT b.`campaign_id`, COUNT(*) AS `completed` FROM `campaign_contributions` AS a ' +
		'JOIN `campaign_state` AS b ON a.`campaign_id` = b.`id` ' +
		'WHERE b.`guild_id` = ? AND a.`client_id` = ? AND b.`complete` = 1 GROUP BY b.`campaign_id`',
		[guild_id, client_id]
	);
	const rankings = {} as Record<string, number>;
	for (const row of rankings_raw)
		rankings[row.campaign_id] = row.completed;

	return rankings;
}

async function tick_campaign_baseline_advancement() {
	for (const campaign of guild_campaigns.values()) {
		if (campaign.active_id === 0)
			continue;
		const guild = await get_guild_summary(campaign.guild_id);
		if (guild?.is_free_fellowship === true && guild.member_count === 0)
			continue;

		const adv_value = get_campaign_auto_advance(
			campaign.item_total,
			campaign.auto_contribution,
			Math.random()
		);
		if (adv_value === 0)
			continue;

		log('campaign', 'Guild {%d} automatic contribution +{%d}', campaign.guild_id, adv_value);
		await add_campaign_auto_progress(campaign, adv_value);
	}

	schedule_campaign_baseline_advancement();
}

function schedule_campaign_baseline_advancement() {
	setTimeout(() => void tick_campaign_baseline_advancement(), CAMPAIGN_AUTO_ADVANCE_INTERVAL);
}

async function load_all_campaign_states() {
	const guilds = await db_get_all(
		' SELECT g.`id` FROM `guilds` AS g ' +
		"WHERE g.`type` != 'free_fellowship' OR EXISTS " +
		'(SELECT 1 FROM `guild_memberships` WHERE `guild_id` = g.`id`)'
	);
	for (const guild of guilds)
		await ensure_guild_campaign(guild.id);
}

void load_all_campaign_states();
schedule_campaign_baseline_advancement();
// #endregion

// #region FRIEND CODE
async function is_friend_code_taken(friend_code: string): Promise<boolean> {
	return db_exists('SELECT 1 FROM `clients` WHERE `friend_code` = ? LIMIT 1', [friend_code]);
}

function is_valid_friend_code(friend_code: string): boolean {
	return /^[0-9]{3}-[0-9]{3}-[0-9]{3}$/.test(friend_code);
}

async function generate_friend_code(): Promise<string> {
	const chunk = () => Math.floor(Math.random() * 900) + 100;
	const code = () => chunk() + '-' + chunk() + '-' + chunk();

	let generated_code = code();
	while (await is_friend_code_taken(generated_code))
		generated_code = code();

	return generated_code;
}

async function get_user_id_from_friend_code(friend_code: string): Promise<number> {
	const user_row = await db_get_single('SELECT `id` FROM `clients` WHERE `friend_code` = ?', [friend_code]) as db_row.clients;
	return user_row?.id ?? -1;
}
// #endregion

// #region DISPLAY NAME FN
function validate_display_name(display_name: unknown): string {
	return parse_display_name(display_name) ?? DEFAULT_USER_DISPLAY_NAME;
}

function parse_display_name(display_name: unknown): string | null {
	if (typeof display_name === 'string') {
		const trimmed = display_name.trim();
		if (trimmed.length > 0 && trimmed.length <= 20)
			return trimmed;
	}
	return null;
}

async function get_client_display(client_id: number): Promise<ClientDisplayInfo> {
	const result = { display_name: DEFAULT_USER_DISPLAY_NAME, icon_id: DEFAULT_USER_ICON_ID };

	const cached_display_name = display_name_cache.get(client_id);
	if (cached_display_name !== undefined)
		result.display_name = cached_display_name;

	const cached_display_icon = display_icon_cache.get(client_id);
	if (cached_display_icon !== undefined)
		result.icon_id = cached_display_icon;

	if (cached_display_name === undefined || cached_display_icon === undefined) {
		const client = await db_get_single('SELECT `display_name`, `icon_id` FROM `clients` WHERE `id` = ? LIMIT 1', [client_id]) as db_row.clients;

		if (client !== null) {
			display_name_cache.set(client_id, client.display_name);
			display_icon_cache.set(client_id, client.icon_id);

			result.display_name = client.display_name;
			result.icon_id = client.icon_id;
		}
	}

	return result;
}

async function get_client_display_icon(client_id: number): Promise<string> {
	const cached = display_icon_cache.get(client_id);
	if (cached !== undefined)
		return cached;

	const client = await db_get_single('SELECT `icon_id` FROM `clients` WHERE `id` = ? LIMIT 1', [client_id]) as db_row.clients;
	if (client !== null) {
		display_icon_cache.set(client_id, client.icon_id);
		return client.icon_id;
	}

	return DEFAULT_USER_ICON_ID;
}

async function get_client_display_name(client_id: number): Promise<string> {
	const cached = display_name_cache.get(client_id);
	if (cached !== undefined)
		return cached;

	const client = await db_get_single('SELECT `display_name` FROM `clients` WHERE `id` = ? LIMIT 1', [client_id]) as db_row.clients;
	if (client !== null) {
		display_name_cache.set(client_id, client.display_name);
		return client.display_name;
	}

	return DEFAULT_USER_DISPLAY_NAME;
}
// #endregion

// #region GUILDS
async function get_client_guild_id(client_id: number): Promise<number | null> {
	const membership = await db_get_single(
		'SELECT `guild_id` FROM `guild_memberships` WHERE `client_id` = ? LIMIT 1',
		[client_id]
	) as db_row.guild_memberships;
	return membership?.guild_id ?? null;
}

async function guild_membership_exists(client_id_a: number, client_id_b: number): Promise<boolean> {
	return db_exists(
		'SELECT 1 FROM `guild_memberships` AS a JOIN `guild_memberships` AS b ON b.`guild_id` = a.`guild_id` ' +
		'WHERE a.`client_id` = ? AND b.`client_id` = ? LIMIT 1',
		[client_id_a, client_id_b]
	);
}

async function get_guild_summary(guild_id: number): Promise<GuildSummary | null> {
	const guild = await db_get_single(
		'SELECT g.`id` AS `guild_id`, g.`type`, g.`name`, g.`icon_id`, COUNT(m.`client_id`) AS `member_count` ' +
		'FROM `guilds` AS g LEFT JOIN `guild_memberships` AS m ON m.`guild_id` = g.`id` ' +
		'WHERE g.`id` = ? GROUP BY g.`id`',
		[guild_id]
	) as GuildSummary & { type: GuildType };
	return guild === null ? null : guild_summary_from_row(guild);
}

function get_guild_member_status_activity(member: GuildMemberRow): PlayerStatusActivity | null {
	if (member.status_visible !== 1 || member.status_available !== 1)
		return null;

	if (member.status_activity_type === 'idle')
		return { type: 'idle' };
	if (member.status_activity_type === 'skill' && member.status_activity_skill_id !== null &&
		member.status_activity_action_id !== null)
		return {
			type: 'skill',
			skill_id: member.status_activity_skill_id,
			action_id: member.status_activity_action_id
		};
	if (member.status_activity_type === 'combat')
		return { type: 'combat', area_id: member.status_activity_area_id };

	return null;
}

function guild_member_from_row(member: GuildMemberRow) {
	return {
		client_id: member.client_id,
		display_name: member.display_name,
		icon_id: member.icon_id,
		equipment_visible: member.equipment_visible === 1,
		equipment_available: member.equipment_available === 1,
		status_visible: member.status_visible === 1,
		status_available: member.status_available === 1,
		status_activity: get_guild_member_status_activity(member)
	};
}

async function get_guild_members(guild_id: number) {
	const members = await db_get_all(
		'SELECT c.`id` AS `client_id`, c.`display_name`, c.`icon_id`, ' +
		'c.`equipment_visible`, ' +
		'EXISTS(SELECT 1 FROM `equipment_snapshots` AS es WHERE es.`client_id` = c.`id`) AS `equipment_available`, ' +
		'c.`status_visible`, ' +
		'EXISTS(SELECT 1 FROM `status_snapshots` AS available_ss WHERE available_ss.`client_id` = c.`id`) AS `status_available`, ' +
		'ss.`activity_type` AS `status_activity_type`, ss.`activity_skill_id` AS `status_activity_skill_id`, ' +
		'ss.`activity_action_id` AS `status_activity_action_id`, ss.`activity_area_id` AS `status_activity_area_id` ' +
		'FROM `guild_memberships` AS m ' +
		'JOIN `clients` AS c ON c.`id` = m.`client_id` ' +
		'LEFT JOIN `status_snapshots` AS ss ON ss.`client_id` = c.`id` ' +
		'WHERE m.`guild_id` = ? ORDER BY c.`display_name`, c.`id`',
		[guild_id]
	) as GuildMemberRow[];
	return members.map(guild_member_from_row);
}

async function get_guild_member_directory(guild_id: number, page: number, search: string) {
	const escaped_search = search.replace(/[\\%_]/g, '\\$&');
	const search_pattern = `%${escaped_search}%`;
	const [members, count] = await Promise.all([
			db_get_all(
				'SELECT c.`id` AS `client_id`, c.`display_name`, c.`icon_id`, ' +
				'c.`equipment_visible`, ' +
				'EXISTS(SELECT 1 FROM `equipment_snapshots` AS es WHERE es.`client_id` = c.`id`) AS `equipment_available`, ' +
				'c.`status_visible`, ' +
				'EXISTS(SELECT 1 FROM `status_snapshots` AS available_ss WHERE available_ss.`client_id` = c.`id`) AS `status_available`, ' +
				'ss.`activity_type` AS `status_activity_type`, ss.`activity_skill_id` AS `status_activity_skill_id`, ' +
				'ss.`activity_action_id` AS `status_activity_action_id`, ss.`activity_area_id` AS `status_activity_area_id` ' +
			'FROM `guild_memberships` AS m JOIN `clients` AS c ON c.`id` = m.`client_id` ' +
			'LEFT JOIN `status_snapshots` AS ss ON ss.`client_id` = c.`id` ' +
			'WHERE m.`guild_id` = ? AND LOWER(c.`display_name`) LIKE LOWER(?) ESCAPE \'\\\' ' +
			'ORDER BY c.`display_name` COLLATE NOCASE, c.`id` LIMIT ? OFFSET ?',
			[guild_id, search_pattern, GUILD_MEMBER_PAGE_SIZE, page * GUILD_MEMBER_PAGE_SIZE]
		),
		db_get_single(
			' SELECT COUNT(*) AS `count` FROM `guild_memberships` AS m ' +
			'JOIN `clients` AS c ON c.`id` = m.`client_id` ' +
			'WHERE m.`guild_id` = ? AND LOWER(c.`display_name`) LIKE LOWER(?) ESCAPE \'\\\'',
			[guild_id, search_pattern]
		)
	]);

	return {
		members: (members as GuildMemberRow[]).map(guild_member_from_row),
		page,
		page_size: GUILD_MEMBER_PAGE_SIZE,
		search,
		total: count?.count ?? 0,
		has_more: (page + 1) * GUILD_MEMBER_PAGE_SIZE < (count?.count ?? 0)
	};
}

async function get_guild_type(guild_id: number): Promise<GuildType | null> {
	const guild = await db_get_single('SELECT `type` FROM `guilds` WHERE `id` = ? LIMIT 1', [guild_id]) as {
		type: GuildType;
	} | null;
	return guild?.type ?? null;
}

async function get_guild_applicants(client_id: number) {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return [];

	return db_get_all(
		'SELECT a.`id` AS `application_id`, c.`id` AS `client_id`, c.`display_name`, c.`icon_id` ' +
		'FROM `guild_applications` AS a JOIN `clients` AS c ON c.`id` = a.`client_id` ' +
		'WHERE a.`guild_id` = ? ORDER BY a.`id`',
		[guild_id]
	);
}

async function has_guild_departure_blocker(client_id: number): Promise<boolean> {
	const blockers = await db_get_single(
		'SELECT ' +
		'EXISTS(SELECT 1 FROM `market_items` WHERE `client_id` = ?) OR ' +
		'EXISTS(SELECT 1 FROM `gifts` WHERE `client_id` = ? OR `sender_id` = ?) OR ' +
		'EXISTS(SELECT 1 FROM `trade_offers` WHERE `sender_id` = ? OR `recipient_id` = ?) OR ' +
		'EXISTS(SELECT 1 FROM `resolved_trade_offers` WHERE `client_id` = ?) AS `blocked`',
		[client_id, client_id, client_id, client_id, client_id, client_id]
	);
	return blockers?.blocked === 1;
}

function petition_to_player_view(row: CouncilPetitionRow, client_id: number) {
	const active = row.lifecycle === 'active';
	const tally_visible = !active || (row.is_eligible === 1 && row.current_vote !== null);
	let proposal: JsonSerializable;
	if (row.type === 'appellation')
		proposal = { name: row.proposed_name as string };
	else if (row.type === 'heraldry')
		proposal = { icon_id: row.proposed_icon_id as string };
	else
		proposal = {
			target: {
				client_id: row.target_client_id as number,
				display_name: row.target_display_name as string,
				icon_id: row.target_icon_id as string
			}
		};

	return {
		petition_id: row.id,
		type: row.type,
		proposal,
		created_at: row.created_at,
		expires_at: row.expires_at,
		resolved_at: row.resolved_at,
		lifecycle: row.lifecycle,
		execution_state: row.lifecycle === 'granted' ? row.execution_state : 'not_applicable',
		eligible: row.is_eligible === 1,
		current_vote: row.current_vote,
		can_vote: active && row.is_eligible === 1 && row.current_vote === null,
		can_withdraw: active && row.petitioner_id === client_id,
		tally_visible,
		...(tally_visible ? {
			tally: {
				eligible: row.eligible_count,
				aye: row.aye_count,
				nay: row.nay_count,
				uncast: row.eligible_count - row.aye_count - row.nay_count
			}
		} : {})
	};
}

async function get_council_petitions(guild_id: number, client_id: number, resolved_page: number) {
	const select =
		'SELECT p.*, target.`display_name` AS `target_display_name`, target.`icon_id` AS `target_icon_id`, ' +
		'(SELECT COUNT(*) FROM `guild_petition_voters` WHERE `petition_id` = p.`id`) AS `eligible_count`, ' +
		"(SELECT COUNT(*) FROM `guild_petition_votes` WHERE `petition_id` = p.`id` AND `choice` = 'aye') AS `aye_count`, " +
		"(SELECT COUNT(*) FROM `guild_petition_votes` WHERE `petition_id` = p.`id` AND `choice` = 'nay') AS `nay_count`, " +
		'(SELECT `choice` FROM `guild_petition_votes` WHERE `petition_id` = p.`id` AND `client_id` = ?) AS `current_vote`, ' +
		'EXISTS(SELECT 1 FROM `guild_petition_voters` WHERE `petition_id` = p.`id` AND `client_id` = ?) AS `is_eligible` ' +
		'FROM `guild_petitions` AS p LEFT JOIN `clients` AS target ON target.`id` = p.`target_client_id` ';
	const active = await db_get_all(
		select + "WHERE p.`guild_id` = ? AND p.`lifecycle` = 'active' ORDER BY p.`created_at` DESC, p.`id` DESC",
		[client_id, client_id, guild_id]
	) as CouncilPetitionRow[];
	const resolved = await db_get_all(
		select + "WHERE p.`guild_id` = ? AND p.`lifecycle` IN ('granted', 'denied', 'lapsed') " +
		'ORDER BY p.`resolved_at` DESC, p.`id` DESC LIMIT ? OFFSET ?',
		[
			client_id,
			client_id,
			guild_id,
			COUNCIL_HISTORY_PAGE_SIZE + 1,
			resolved_page * COUNCIL_HISTORY_PAGE_SIZE
		]
	) as CouncilPetitionRow[];

	return {
		petitions: [...active, ...resolved.slice(0, COUNCIL_HISTORY_PAGE_SIZE)].map(row =>
			petition_to_player_view(row, client_id)
		),
		resolved_page,
		has_more: resolved.length > COUNCIL_HISTORY_PAGE_SIZE
	};
}

function get_banishment_claim_view(claim_id: string, client_id: number) {
	const claim = db.query(
		'SELECT claim.*, returned.`guild_name` FROM `banishment_return_claims` AS claim ' +
		'JOIN `banishment_returns` AS returned ON returned.`id` = claim.`return_id` ' +
		'WHERE claim.`id` = ? AND claim.`client_id` = ? AND claim.`acknowledged_at` IS NULL LIMIT 1'
	).get(claim_id, client_id) as (db_row.banishment_return_claims & { guild_name: string }) | null;
	if (claim === null)
		return null;

	const items = db.query(
		'SELECT `item_id` AS `id`, `qty` FROM `banishment_return_claim_items` WHERE `claim_id` = ? ORDER BY `item_id`'
	).all(claim_id);
	return {
		claim_id: claim.id,
		items,
		gp: claim.gp,
		banished: claim.includes_notice === 1 ? { guild_name: claim.guild_name } : null
	};
}

function create_banishment_claim(
	client_id: number,
	existing_item_ids: string[],
	available_slots: number
): string | null {
	const create_claim = db.transaction(() => {
		const outstanding = db.query(
			'SELECT `id` FROM `banishment_return_claims` WHERE `client_id` = ? ' +
			'AND `acknowledged_at` IS NULL LIMIT 1'
		).get(client_id) as { id: string } | null;
		if (outstanding !== null)
			return outstanding.id;

		const returns = db.query(
			'SELECT * FROM `banishment_returns` WHERE `client_id` = ? AND `completed_at` IS NULL ORDER BY `id`'
		).all(client_id) as db_row.banishment_returns[];
		const existing = new Set(existing_item_ids);
		for (const returned of returns) {
			let remaining_slots = available_slots;
			let claimed_gp = 0;
			if (returned.gp > 0 && (existing.has('melvorD:GP') || remaining_slots > 0)) {
				claimed_gp = returned.gp;
				if (!existing.has('melvorD:GP'))
					remaining_slots--;
			}

			const available_items = db.query(
				'SELECT * FROM `banishment_return_items` WHERE `return_id` = ? ORDER BY `item_id`'
			).all(returned.id) as db_row.banishment_return_items[];
			const selected_items = [] as db_row.banishment_return_items[];
			for (const item of available_items) {
				if (existing.has(item.item_id)) {
					selected_items.push(item);
				} else if (remaining_slots > 0) {
					selected_items.push(item);
					remaining_slots--;
				}
			}

			if (claimed_gp === 0 && selected_items.length === 0 && returned.notice_pending === 0)
				continue;
			const claim_id = crypto.randomUUID();
			db.query(
				'INSERT INTO `banishment_return_claims` (`id`, `return_id`, `client_id`, `gp`, ' +
				'`includes_notice`, `created_at`) VALUES(?, ?, ?, ?, ?, ?)'
			).run(
				claim_id,
				returned.id,
				client_id,
				claimed_gp,
				returned.notice_pending,
				Date.now()
			);
			for (const item of selected_items) {
				db.query(
					'INSERT INTO `banishment_return_claim_items` (`claim_id`, `item_id`, `qty`) VALUES(?, ?, ?)'
				).run(claim_id, item.item_id, item.qty);
				db.query(
					'DELETE FROM `banishment_return_items` WHERE `return_id` = ? AND `item_id` = ?'
				).run(returned.id, item.item_id);
			}
			db.query(
				'UPDATE `banishment_returns` SET `gp` = `gp` - ?, `notice_pending` = 0 WHERE `id` = ?'
			).run(claimed_gp, returned.id);
			return claim_id;
		}
		return null;
	});
	return create_claim.immediate();
}
// #endregion

// #region FRIEND REQUESTS
async function get_friend_requests(client_id: number): Promise<FriendRequest[]> {
	const cached_entries = friend_request_cache.get(client_id);
	if (cached_entries)
		return cached_entries;

	const result = await db_get_all('SELECT `request_id`, `friend_id` FROM `friend_requests` WHERE `client_id` = ?', [client_id]) as db_row.friend_requests[];
	const requests = [];

	for (const row of result) {
		requests.push({
			friend: await get_client_display(row?.friend_id as number),
			request_id: row?.request_id ?? -1
		});
	}

	friend_request_cache.set(client_id, requests);

	return requests;
}

async function friend_request_exists(client_id: number, friend_id: number): Promise<boolean> {
	return await db_exists('SELECT 1 FROM `friend_requests` WHERE `client_id` = ? AND `friend_id` = ?', [client_id, friend_id]);
}

async function create_friend_request(client_id: number, friend_id: number) {
	const request = await db_get_single(
		'INSERT INTO `friend_requests` (`client_id`, `friend_id`) VALUES(?, ?) ' +
		'ON CONFLICT (`client_id`, `friend_id`) DO NOTHING RETURNING `request_id`',
		[client_id, friend_id]
	);
	if (request === null)
		return;

	friend_request_cache.get(client_id)?.push({
		friend: await get_client_display(friend_id),
		request_id: request.request_id,
	});
}

async function get_friend_request(request_id: number): Promise<db_row.friend_requests> {
	return await db_get_single('SELECT `request_id`, `client_id`, `friend_id` FROM `friend_requests` WHERE `request_id` = ?', [request_id]) as db_row.friend_requests;
}

async function delete_friend_request(request: db_row.friend_requests) {
	if (request === null)
		return;

	const cached = friend_request_cache.get(request.client_id);
	if (cached !== undefined) {
		const index = cached.findIndex(entry => entry.request_id === request.request_id);
		if (index !== -1)
			cached.splice(index, 1);
	}

	await db_execute('DELETE FROM `friend_requests` WHERE `request_id` = ?', [request.request_id]);
}
// #endregion

// #region FRIENDS
async function friendship_exists(client_id_a: number, client_id_b: number): Promise<boolean> {
	return await db_exists('SELECT 1 FROM `friends` WHERE (`client_id_a` = ? AND `client_id_b` = ?) OR (`client_id_a` = ? AND `client_id_b` = ?)', [client_id_a, client_id_b, client_id_b, client_id_a]);
}

async function create_friendship(client_id_a: number, client_id_b: number) {
	await db_execute('INSERT INTO `friends` (`client_id_a`, `client_id_b`) VALUES(?, ?)', [client_id_a, client_id_b]);
}

async function get_friends(client_id: number) {
	return await db_get_all('SELECT c.`id` AS `friend_id`, c.`display_name`, c.`icon_id` FROM `friends` JOIN `clients` AS c ON c.`id` = CASE WHEN `client_id_a` = ? THEN `client_id_b` ELSE `client_id_a` END WHERE `client_id_a` = ? OR `client_id_b` = ?', [client_id, client_id, client_id]);
}

async function delete_friend(client_id: number, friend_id: number) {
	await db_execute('DELETE FROM `friends` WHERE (`client_id_a` = ? AND `client_id_b` = ?) OR (`client_id_a` = ? AND `client_id_b` = ?)', [client_id, friend_id, friend_id, client_id]);
}
// #endregion

// #region GIFT FN
async function has_pending_gift(client_id: number, recipient_id: number) {
	return await db_exists('SELECT 1 FROM `gifts` WHERE `client_id` = ? AND `sender_id` = ? LIMIT 1', [recipient_id, client_id]);
}

async function send_gift(client_id: number, recipient_id: number, items: TransferItem[]) {
	const gift_id = await db_insert('INSERT INTO `gifts` (`client_id`, `sender_id`) VALUES(?, ?)', [recipient_id, client_id]);

	gift_cache.get(recipient_id)?.push(gift_id);

	for (const item of items) {
		if (item.qty >= 0)
			await db_execute('INSERT INTO `gift_items` (`gift_id`, `item_id`, `qty`) VALUES(?, ?, ?)', [gift_id, item.id, item.qty]);
	}
}

async function get_gift(gift_id: number) {
	return await db_get_single('SELECT * FROM `gifts` WHERE `gift_id` = ? LIMIT 1', [gift_id]) as db_row.gifts;
}

async function get_gift_items(gift_id: number) {
	return await db_get_all('SELECT `id`, `item_id`, `qty` FROM `gift_items` WHERE `gift_id` = ?', [gift_id]) as db_row.gift_items[];
}

async function get_client_gifts(client_id: number) {
	const cached_entries = gift_cache.get(client_id);
	if (cached_entries)
		return cached_entries;

	const result = await db_get_all('SELECT `gift_id` FROM `gifts` WHERE `client_id` = ?', [client_id]) as db_row.gifts[];
	const gift_ids = result.map(row => row?.gift_id) as number[];

	gift_cache.set(client_id, gift_ids);

	return gift_ids;
}

async function delete_gift(gift: db_row.gifts) {
	if (!gift)
		return;

	remove_player_cache_entry(gift_cache, gift.client_id, gift.gift_id);

	await db_execute('DELETE FROM `gifts` WHERE `gift_id` = ?', [gift.gift_id]);
	await db_execute('DELETE FROM `gift_items` WHERE `gift_id` = ?', [gift.gift_id]);
}

async function return_gift(gift: db_row.gifts) {
	if (!gift)
		return;

	remove_player_cache_entry(gift_cache, gift.client_id, gift.gift_id);
	gift_cache.get(gift.sender_id)?.push(gift.gift_id);

	await db_execute(
		'UPDATE `gifts` SET `client_id` = ?, `sender_id` = ?, `flags` = `flags` | ? WHERE `gift_id` = ?',
		[gift.sender_id, gift.client_id, GiftFlags.Returned, gift.gift_id]
	);
}
// #endregion

// #region TRADE FN
async function trade_exists(sender_id: number, recipient_id: number) {
	return await db_exists('SELECT 1 FROM `trade_offers` WHERE `sender_id` = ? AND `recipient_id` = ? LIMIT 1', [sender_id, recipient_id]);
}

async function get_client_trades(client_id: number) {
	const cached_entries = trade_player_cache.get(client_id);
	if (cached_entries)
		return cached_entries;

	const result = await db_get_all('SELECT `trade_id` FROM `trade_offers` WHERE `sender_id` = ? OR `recipient_id` = ?', [client_id, client_id]) as db_row.trade_offers[];
	const trade_ids = result.map(row => row?.trade_id) as number[];

	trade_player_cache.set(client_id, trade_ids);

	return trade_ids;
}

async function get_trade_offer_meta(trade_id: number) {
	const cached = trade_cache.get(trade_id);
	if (cached)
		return cached;

	const result = await db_get_single('SELECT `attending_id`, `state` FROM `trade_offers` WHERE `trade_id` = ?', [trade_id]) as db_row.trade_offers;

	if (result)
		trade_cache.set(trade_id, result as ActiveTrade);

	return result;
}

async function get_trade_offer(trade_id: number) {
	return await db_get_single('SELECT * FROM `trade_offers` WHERE `trade_id` = ? LIMIT 1', [trade_id]) as db_row.trade_offers;
}

async function get_resolved_trade_offer(trade_id: number) {
	return await db_get_single('SELECT * FROM `resolved_trade_offers` WHERE `trade_id` = ? LIMIT 1', [trade_id]) as db_row.resolved_trade_offers;
}

async function get_trade_items(trade_id: number) {
	return await db_get_all('SELECT `id`, `item_id`, `qty`, `counter` FROM `trade_items` WHERE `trade_id` = ?', [trade_id]) as db_row.gift_items[];
}

async function create_resolved_trade(trade_id: number, client_id: number, sender_id: number, declined: boolean) {
	await db_execute(
		'INSERT INTO `resolved_trade_offers` (trade_id, client_id, sender_id, declined) VALUES(?, ?, ?, ?)',
		[trade_id, client_id, sender_id, declined ? 1 : 0]
	);

	resolved_trade_cache.get(client_id)?.push(trade_id);
}

async function get_client_resolved_trades(client_id: number) {
	const cached_entries = resolved_trade_cache.get(client_id);
	if (cached_entries)
		return cached_entries;

	const result = await db_get_all('SELECT `trade_id` FROM `resolved_trade_offers` WHERE `client_id` = ?', [client_id]) as db_row.resolved_trade_offers[];
	const trade_ids = result.map(row => row?.trade_id) as number[];

	resolved_trade_cache.set(client_id, trade_ids);

	return trade_ids;
}
// #endregion

// #region SESSIONS
async function generate_session_token(client_id: number): Promise<string> {
	await db_execute('DELETE FROM `client_sessions` WHERE `client_id` = ?', [client_id]);
	for (const [session_token, session] of client_session_cache)
		if (session.client_id === client_id)
			client_session_cache.delete(session_token);

	const session_token = crypto.randomUUID();
	await db_execute('INSERT INTO `client_sessions` (`session_token`, `client_id`) VALUES(?, ?)', [session_token, client_id]);

	return session_token;
}

async function get_session_client_id(session_token: unknown): Promise<number> {
	if (typeof session_token !== 'string')
		return -1;

	const cached_session = client_session_cache.get(session_token);
	if (cached_session !== undefined) {
		if (!await db_exists(
			'SELECT 1 FROM `clients` WHERE `id` = ? AND `disabled` = 0 AND `deleted_at` IS NULL',
			[cached_session.client_id]
		)) {
			client_session_cache.delete(session_token);
			return -1;
		}

		cached_session.last_access = Date.now();
		return cached_session.client_id;
	}

	const session_row = await db_get_single(
		'SELECT session.`client_id` FROM `client_sessions` AS session ' +
		'JOIN `clients` AS client ON client.`id` = session.`client_id` ' +
		'WHERE session.`session_token` = ? AND client.`disabled` = 0 AND client.`deleted_at` IS NULL',
		[session_token]
	) as db_row.client_sessions;
	const client_id = session_row?.client_id ?? -1;

	if (client_id > -1) {
		client_session_cache.set(session_token, {
			client_id,
			last_access: Date.now()
		});
	}

	return client_id;
}

function validate_session_request(handler: SessionRequestHandler, json_body: boolean = false) {
	return async (req: Request, url: URL) => {
		let json = null;

		if (json_body) {
			const result = await read_json_request(req);
			if ('response' in result)
				return result.response;
			json = result.json;
		}

		const x_session_token = req.headers.get('X-Session-Token');
		const client_id = await get_session_client_id(x_session_token);

		if (client_id === -1)
			return 401; // Unauthorized

		identify_request(req, client_id);
		const limited = request_limits.limit_identity(client_id);
		if (limited !== null)
			return limited;

		return handler(req, url, client_id, json as JsonObject);
	};
}

function session_get_route(route: string, handler: SessionRequestHandler) {
	server.route(
		route,
		allow_browser_access(require_source_capacity(require_service_available(validate_session_request(handler)))),
		['GET', 'OPTIONS']
	);
}

function session_post_route(route: string, handler: SessionRequestHandler) {
	server.route(
		route,
		allow_browser_access(require_source_capacity(require_service_available(validate_session_request(handler, true)))),
		['POST', 'OPTIONS']
	);
}
// #endregion

// #region ROUTES MARKET
session_post_route('/api/market/sell', async (req, url, client_id, json) => {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

	const item_qty = json.item_qty;
	const item_sell_price = json.item_sell_price;

	if (typeof item_qty !== 'number' || typeof item_sell_price !== 'number')
		return 400; // Bad Request

	if (item_qty <= 0)
		return { error_lang: 'MOD_MP_MARKET_CANNOT_SELL_NOTHING' };

	if (item_sell_price <= 0)
		return { error_lang: 'MOD_MP_MARKET_CANNOT_SELL_FREE' };

	const item_id = json.item_id;
	if (!is_valid_item_id(item_id))
		return 400; // Bad Request

	await market_list_item(guild_id, client_id, item_id, Math.trunc(item_qty), item_sell_price);

	return { success: true } as JsonSerializable;
});

session_post_route('/api/market/buy', async (req, url, client_id, json) => {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

	const lot_id = json.id;
	if (typeof lot_id !== 'number')
		return 400; // Bad Request

	const buy_qty = json.qty;
	if (typeof buy_qty !== 'number' || buy_qty <= 0)
		return 400; // Bad Request

	const lot = await db_get_single(
		'SELECT * FROM `market_items` WHERE `id` = ? AND `guild_id` = ? LIMIT 1',
		[lot_id, guild_id]
	) as db_row.market_items;
	if (lot === null || lot.available <= 0)
		return { error_lang: 'MOD_MP_MARKET_BUY_ERROR_INVALID' };

	if (lot.client_id === client_id)
		return { error_lang: 'MOD_MP_MARKET_BUY_ERROR_SELF' };

	const final_qty = Math.min(lot.available, Math.trunc(buy_qty));
	const final_cost = final_qty * lot.price;

	const updated = await db_run(
		'UPDATE `market_items` SET `available` = `available` - ? WHERE `id` = ? AND `available` = ?',
		[final_qty, lot_id, lot.available]
	);
	if (updated.changes === 0)
		return { error_lang: 'MOD_MP_MARKET_BUY_ERROR_INVALID' };

	if (lot.available - final_qty <= 0)
		market_completed_cached.get(lot.client_id)?.push(lot.id);

	return {
		success: true,
		item_id: lot.item_id,
		item_qty: final_qty,
		gp_loss: final_cost,
		new_item_qty: Math.max(lot.available - final_qty, 0)
	} as JsonSerializable;
});

session_get_route('/api/market/listings', async (req, url, client_id) => {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

	const results = await db_get_all(
		'SELECT * FROM `market_items` WHERE `guild_id` = ? AND `client_id` = ?',
		[guild_id, client_id]
	);
	const items = Array(results.length);

	for (let i = 0; i < results.length; i++) {
		const row = results[i] as db_row.market_items;

		items[i] = {
			id: row.id,
			item_id: row.item_id,
			available: row.available,
			qty: row.qty,
			price: row.price,
			payout: row.payout
		};
	}

	return {
		success: true,
		items
	};
});

session_post_route('/api/market/payout', async (req, url, client_id, json) => {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

	const lot_id = json.id;
	if (typeof lot_id !== 'number')
		return 400; // Bad Request

	const lot = await db_get_single(
		'SELECT * FROM `market_items` WHERE `id` = ? AND `guild_id` = ? LIMIT 1',
		[lot_id, guild_id]
	) as db_row.market_items;
	if (lot?.client_id !== client_id)
		return 400; // Bad Request

	const lot_profit = (lot.qty - lot.available) * lot.price;
	const payout_available = lot_profit - lot.payout;
	let ended = false;

	if (lot.available === 0) {
		ended = true;
		await db_execute('DELETE FROM `market_items` WHERE `id` = ?', [lot.id]);
		remove_player_cache_entry(market_completed_cached, client_id, lot.id);
	} else {
		await db_execute('UPDATE `market_items` SET `payout` = `payout` + ? WHERE `id` = ?', [payout_available, lot.id]);
	}

	return { success: true, payout: payout_available, ended };
});

session_post_route('/api/market/cancel', async (req, url, client_id, json) => {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

	const lot_id = json.id;
	if (typeof lot_id !== 'number')
		return 400; // Bad Request

	const lot = await db_get_single(
		'DELETE FROM `market_items` WHERE `id` = ? AND `guild_id` = ? AND `client_id` = ? RETURNING *',
		[lot_id, guild_id, client_id]
	) as db_row.market_items;
	if (!lot)
		return 400; // Bad Request

	const lot_profit = (lot.qty - lot.available) * lot.price;
	const payout_available = lot_profit - lot.payout;

	remove_player_cache_entry(market_completed_cached, client_id, lot.id);

	return {
		success: true,
		item_id: lot.item_id,
		item_qty: lot.available,
		payout: payout_available
	};
});

session_post_route('/api/market/destroy', async (req, url, client_id, json) => {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

	const lot_id = json.id;
	if (typeof lot_id !== 'number')
		return 400; // Bad Request

	const lot = await db_get_single(
		'DELETE FROM `market_items` WHERE `id` = ? AND `guild_id` = ? AND `client_id` = ? RETURNING *',
		[lot_id, guild_id, client_id]
	) as db_row.market_items;
	if (!lot)
		return 400; // Bad Request

	const lot_profit = (lot.qty - lot.available) * lot.price;
	const payout_available = lot_profit - lot.payout;

	remove_player_cache_entry(market_completed_cached, client_id, lot.id);

	return {
		success: true,
		item_id: lot.item_id,
		item_qty: lot.available,
		payout: payout_available
	};
});

session_post_route('/api/market/search', async (req, url, client_id, json) => {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

	const query_parameters: Array<unknown> = [guild_id, client_id];

	let item_filter = '';
	if (json.item_id !== undefined && !is_valid_item_id(json.item_id))
		return 400; // Bad Request
	if (typeof json.item_id === 'string') {
		item_filter = ' AND `item_id` = ?'
		query_parameters.push(json.item_id);
	}
	let has_namespace_filter = false;
	if (json.item_namespaces !== undefined) {
		const item_namespaces = json.item_namespaces;
		if (!Array.isArray(item_namespaces) || item_namespaces.length > MAX_MARKET_ITEM_NAMESPACE_COUNT)
			return 400; // Bad Request

		const namespace_parameters: string[] = [];
		for (const namespace of item_namespaces) {
			if (typeof namespace !== 'string' || namespace.length === 0 ||
				namespace.length > MAX_MARKET_ITEM_NAMESPACE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(namespace))
				return 400; // Bad Request
			namespace_parameters.push(namespace.replaceAll('_', '\\_') + ':%');
		}

		if (namespace_parameters.length === 0)
			item_filter += ' AND 0';
		else {
			has_namespace_filter = true;
			item_filter += ' AND (' + namespace_parameters.map(() => '`item_id` LIKE ? ESCAPE \'\\\'').join(' OR ') + ')';
			query_parameters.push(...namespace_parameters);
		}
	}

	const sort = json.sort === 0 ? 'DESC' : 'ASC';
	const page_clause = has_namespace_filter
		? ''
		: typeof json.page === 'number'
			? ' LIMIT ' + MARKET_ITEMS_PER_PAGE + ' OFFSET ' + (Math.max(json.page - 1, 0) * MARKET_ITEMS_PER_PAGE)
			: '';
	const result = await db_get_all(
		'SELECT *, COUNT(*) OVER() as `total_items` FROM `market_items` WHERE `guild_id` = ? AND `client_id` != ? AND `available` > 0' + item_filter + ' ORDER BY `price` ' + sort + page_clause,
		query_parameters
	);

	const total_items = result[0]?.total_items ?? 0;

	const items = Array(result.length);
	for (let i = 0; i < result.length; i++) {
		const row = result[i] as db_row.market_items;

		items[i] = {
			id: row.id,
			item_id: row.item_id,
			available: row.available,
			price: row.price,
			seller: await get_client_display(row.client_id)
		};
	}

	return {
		success: true,
		total_items,
		items
	};
});
// #endregion

// #region ROUTES CAMPAIGN
session_get_route('/api/campaign/info', async (req, url, client_id) => {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

	const campaign = await ensure_guild_campaign(guild_id);
	if (campaign === null)
		return 400; // Bad Request

	const rankings = await get_campaign_rankings(guild_id, client_id);
	const history = await get_campaign_history(guild_id, client_id);

	if (campaign.active_id > 0) {
		const contribution = await db_get_single(
			'SELECT `item_amount` FROM `campaign_contributions` WHERE `client_id` = ? AND `campaign_id` = ?',
			[client_id, campaign.active_id]
		) as db_row.campaign_contributions;

		return {
			active: true,
			history, rankings,
			campaign_id: campaign.campaign_id,
			contribution: contribution?.item_amount ?? 0,
			item_id: campaign.item_id,
			item_total: campaign.item_total,
			max_contribution: campaign.item_total / campaign.required_contributors
		} as JsonSerializable;
	} else {
		return {
			active: false,
			history, rankings,
			next_campaign: campaign.next_active_timestamp
		} as JsonSerializable;
	}
});

session_post_route('/api/campaign/claim', async (req, url, client_id, json) => {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

	const campaign_id = json.campaign_id;
	if (typeof campaign_id !== 'number')
		return 400; // Bad Request

	const value = json.value;
	if (typeof value !== 'number')
		return 400; // Bad Request

	const contribution = await db_get_single(
		'SELECT a.`taken` FROM `campaign_contributions` AS a ' +
		'JOIN `campaign_state` AS b ON b.`id` = a.`campaign_id` ' +
		'WHERE b.`guild_id` = ? AND a.`client_id` = ? AND a.`campaign_id` = ? LIMIT 1',
		[guild_id, client_id, campaign_id]
	) as db_row.campaign_contributions;
	if (contribution === null || contribution.taken > 0)
		return 400; // Bad request

	await db_execute('UPDATE `campaign_contributions` SET `taken` = ? WHERE `client_id` = ? AND `campaign_id` = ?', [value, client_id, campaign_id]);

	return { success: true };
});

session_post_route('/api/campaign/contribute', async (req, url, client_id, json) => {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

	const campaign = await ensure_guild_campaign(guild_id);
	if (campaign === null)
		return 400; // Bad Request

	const item_amount = json.item_amount;
	if (typeof item_amount !== 'number')
		return 400; // Bad Request

	if (campaign.active_id === 0)
		return 400; // Bad Request

	if (item_amount <= 0)
		return 400; // Bad Request

	const max_solo_contrib = campaign.item_total / campaign.required_contributors;
	let contributing_amount = Math.min(Math.trunc(item_amount), max_solo_contrib);

	const contribution = await db_get_single(
		'SELECT `item_amount` FROM `campaign_contributions` WHERE `client_id` = ? AND `campaign_id` = ?',
		[client_id, campaign.active_id]
	) as db_row.campaign_contributions;
	if (contribution !== null) {
		const contributing_delta = Math.max(max_solo_contrib - contribution.item_amount, 0);
		contributing_amount = Math.min(contributing_amount, contributing_delta);
	}

	const remaining_needed = campaign.item_total - campaign.item_current;
	contributing_amount = Math.round(Math.min(contributing_amount, remaining_needed));

	if (contributing_amount > 0) {
		await db_execute(
			'INSERT INTO `campaign_contributions` (`client_id`, `campaign_id`, `item_amount`) VALUES(?, ?, ?) ' +
			'ON CONFLICT (`campaign_id`, `client_id`) DO UPDATE SET `item_amount` = `item_amount` + excluded.`item_amount`',
			[client_id, campaign.active_id, contributing_amount]
		);

		await add_campaign_progress(campaign, contributing_amount);
	}

	return {
		success: true,
		item_id: campaign.item_id,
		item_loss: contributing_amount,
		campaign_pct: campaign.pct
	};
});
// #endregion

// #region ROUTES CHARITY
session_get_route('/api/charity/contents', async (req, url, client_id) => {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

	return {
		items: await db_get_all(
			'SELECT `item_id` as `id`, `qty` FROM `charity_items` WHERE `guild_id` = ? LIMIT 156',
			[guild_id]
		)
	};
});

session_post_route('/api/charity/take', async (req, url, client_id, json) => {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

	const item_id = json.item_id;
	if (!is_valid_item_id(item_id))
		return 400; // Bad Request

	const current_time = Date.now();
	const client_row = await db_get_single('SELECT `last_charity`, `last_bonus_charity` FROM `clients` WHERE `id` = ?', [client_id]) as db_row.clients;
	if (client_row === null)
		return 400; // Bad Request

	const last_charity_cooling_down = client_row.last_charity + CHARITY_TIMEOUT > current_time;
	const last_charity_bonus_cooling_down = client_row.last_bonus_charity + CHARITY_TIMEOUT > current_time;

	if (last_charity_cooling_down && last_charity_bonus_cooling_down)
		return { error_lang: 'MOD_MP_CHARITY_TIMEOUT', timeout: client_row.last_charity, timeout_bonus: client_row.last_bonus_charity };

	const item_entry = await db_get_single(
		'DELETE FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = ? RETURNING `qty`',
		[guild_id, item_id]
	) as db_row.charity_items;
	if (item_entry === null)
		return { error_lang: 'MOD_MP_CHARITY_TAKEN' };

	if (last_charity_cooling_down) {
		await db_execute('UPDATE `clients` SET `last_bonus_charity` = ? WHERE `id` = ?', [current_time, client_id]);
		client_row.last_bonus_charity = current_time;
	} else {
		await db_execute('UPDATE `clients` SET `last_charity` = ? WHERE `id` = ?', [current_time, client_id]);
		client_row.last_charity = current_time;
	}

	return {
		success: true,
		item_qty: item_entry.qty,
		timeout: client_row.last_charity,
		timeout_bonus: client_row.last_bonus_charity
	} as JsonSerializable;
});

session_post_route('/api/charity/donate', async (req, url, client_id, json) => {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

	const items = json.items as TransferItem[];
	if (!validate_item_array(items))
		return 400; // Bad Request

	for (const item of items)
		await db_execute(
			'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`) VALUES(?, ?, ?) ' +
			'ON CONFLICT (`guild_id`, `item_id`) DO UPDATE SET `qty` = `qty` + excluded.`qty`',
			[guild_id, item.id, item.qty]
		);

	return { success: true };
});
// #endregion

// #region ROUTES BANISHMENT RETURNS
session_post_route('/api/banishment/returns/claim', async (req, url, client_id, json) => {
	if (!Array.isArray(json.existing_item_ids) || json.existing_item_ids.length > MAX_TRANSFER_ITEM_COUNT)
		return 400; // Bad Request
	const existing_item_ids = json.existing_item_ids;
	for (const item_id of existing_item_ids)
		if (typeof item_id !== 'string' || item_id.length === 0)
			return 400; // Bad Request
	if (new Set(existing_item_ids).size !== existing_item_ids.length)
		return 400; // Bad Request
	const available_slots = json.available_slots;
	if (typeof available_slots !== 'number' || !Number.isSafeInteger(available_slots) ||
		available_slots < 0 || available_slots > MAX_TRANSFER_ITEM_COUNT)
		return 400; // Bad Request

	const banishment_claim_id = create_banishment_claim(client_id, existing_item_ids as string[], available_slots);
	if (banishment_claim_id !== null)
		return { claim: get_banishment_claim_view(banishment_claim_id, client_id) };
	const deletion_claim_id = create_deletion_return_claim(client_id, existing_item_ids as string[], available_slots);
	return { claim: deletion_claim_id === null ? null : get_deletion_claim_view(deletion_claim_id, client_id) };
});

session_post_route('/api/banishment/returns/acknowledge', async (req, url, client_id, json) => {
	const claim_id = json.claim_id;
	if (typeof claim_id !== 'string' || !is_valid_uuid(claim_id))
		return 400; // Bad Request

	const acknowledge = db.transaction(() => {
		const claim = db.query(
			'SELECT * FROM `banishment_return_claims` WHERE `id` = ? AND `client_id` = ? LIMIT 1'
		).get(claim_id, client_id) as db_row.banishment_return_claims;
		if (claim === null)
			return 'missing';
		if (claim.acknowledged_at === null)
			db.query(
				'UPDATE `banishment_return_claims` SET `acknowledged_at` = ? WHERE `id` = ?'
			).run(Date.now(), claim_id);

		const pending = db.query(
			'SELECT returned.`gp`, returned.`notice_pending`, ' +
			'EXISTS(SELECT 1 FROM `banishment_return_items` WHERE `return_id` = returned.`id`) AS `has_items`, ' +
			'EXISTS(SELECT 1 FROM `banishment_return_claims` WHERE `return_id` = returned.`id` ' +
			'AND `acknowledged_at` IS NULL) AS `has_claims` ' +
			'FROM `banishment_returns` AS returned WHERE returned.`id` = ?'
		).get(claim.return_id) as { gp: number; notice_pending: number; has_items: number; has_claims: number };
		if (pending.gp === 0 && pending.notice_pending === 0 && pending.has_items === 0 && pending.has_claims === 0)
			db.query(
				'UPDATE `banishment_returns` SET `completed_at` = COALESCE(`completed_at`, ?) WHERE `id` = ?'
			).run(Date.now(), claim.return_id);
		return 'acknowledged';
	});

	if (acknowledge.immediate() !== 'missing')
		return { success: true };
	return acknowledge_deletion_return_claim(client_id, claim_id) === null
		? { error_lang: 'MOD_MP_BANISHMENT_CLAIM_MISSING' }
		: { success: true };
});
// #endregion

// #region ROUTES TRANSFER
session_post_route('/api/transfers/get_contents', async (req, url, client_id, json) => {
	const gift_ids = json.gift_ids;
	if (!Array.isArray(gift_ids))
		return 400; // Bad Request

	// check ids first, no point hitting db for an invalid request
	for (const gift_id of gift_ids)
		if (typeof gift_id !== 'number')
			return 400; // Bad request

	const gift_results = {} as Record<number, object>;
	for (const gift_id of gift_ids as number[]) {
		const gift = await get_gift(gift_id);
		if (!gift || gift.client_id !== client_id)
			continue;

		gift_results[gift_id] = {
			items: await get_gift_items(gift_id) ?? [],
			sender: await get_client_display(gift.sender_id),
			flags: gift.flags
		};
	}

	const trade_ids = json.trade_ids;
	if (!Array.isArray(trade_ids))
		return 400; // Bad Request

	// check ids first, no point hitting db for an invalid request
	for (const trade_id of trade_ids)
		if (typeof trade_id !== 'number')
			return 400; // Bad request

	const trade_results = {} as Record<number, object>;
	for (const trade_id of trade_ids as number[]) {
		const trade_offer = await get_trade_offer(trade_id);
		if (!trade_offer || (trade_offer.sender_id !== client_id && trade_offer.recipient_id !== client_id))
			continue;

		const other_player_id = trade_offer.sender_id === client_id ? trade_offer.recipient_id : trade_offer.sender_id;

		trade_results[trade_id] = {
			items: await get_trade_items(trade_id) ?? [],
			other_player: await get_client_display(other_player_id)
		};
	}

	const resolved_trade_ids = json.resolved_trade_ids;
	if (!Array.isArray(resolved_trade_ids))
		return 400; // Bad Request

	for (const trade_id of resolved_trade_ids)
		if (typeof trade_id !== 'number')
			return 400; // Bad Request

	const resolved_trade_results = {} as Record<number, object>;
	for (const trade_id of resolved_trade_ids as number[]) {
		const trade_offer = await get_resolved_trade_offer(trade_id);
		if (!trade_offer || trade_offer.client_id !== client_id)
			continue;

		resolved_trade_results[trade_id] = {
			items: await get_trade_items(trade_id) ?? [],
			declined: trade_offer.declined === 1,
			other_player: await get_client_display(trade_offer.sender_id)
		};
	}

	return {
		gifts: gift_results,
		trades: trade_results,
		resolved_trades: resolved_trade_results
	} as JsonSerializable;
});
// #endregion

// #region ROUTES TRADE
session_post_route('/api/trade/resolve', async (req, url, client_id, json) => {
	const trade_id = json.trade_id;
	if (typeof trade_id !== 'number')
		return 400; // Bad Request

	const trade = await get_resolved_trade_offer(trade_id);
	if (!trade || trade.client_id !== client_id)
		return 400; // Bad Request

	await db_execute('DELETE FROM `resolved_trade_offers` WHERE `trade_id` = ?', [trade_id]);
	await db_execute('DELETE FROM `trade_items` WHERE `trade_id` = ?', [trade_id]);

	remove_player_cache_entry(resolved_trade_cache, client_id, trade_id);

	return { success: true };
});

session_post_route('/api/trade/counter', async (req, url, client_id, json) => {
	const trade_id = json.trade_id;
	if (typeof trade_id !== 'number')
		return 400; // Bad Request

	const trade = await get_trade_offer(trade_id);
	if (!trade || trade.recipient_id !== client_id)
		return 400; // Bad Request

	const items = json.items as TransferItem[];
	if (!validate_item_array(items))
		return 400; // Bad Request;

	for (const item of items) {
		await db_execute(
			'INSERT INTO `trade_items` (trade_id, item_id, qty, counter) VALUES(?, ?, ?, 1)',
			[trade_id, item.id, item.qty]
		);
	}

	// sender becomes the attending player
	await db_execute('UPDATE `trade_offers` SET `state` = 1, `attending_id` = ? WHERE `trade_id` = ?', [trade.sender_id, trade_id]);

	const cached_meta = trade_cache.get(trade_id);
	if (cached_meta) {
		cached_meta.attending_id = trade.sender_id;
		cached_meta.state = 1;
	}

	return { success: true };
});

session_post_route('/api/trade/accept', async (req, url, client_id, json) => {
	const trade_id = json.trade_id;
	if (typeof trade_id !== 'number')
		return 400; // Bad Request

	const trade = await get_trade_offer(trade_id);
	if (!trade || trade.state !== 1 || trade.sender_id !== client_id)
		return 400; // Bad Request

	await db_execute('DELETE FROM `trade_items` WHERE `trade_id` = ? AND `counter` = 1', [trade_id]);
	await db_execute('DELETE FROM `trade_offers` WHERE `trade_id` = ?', [trade_id]);
	trade_cache.delete(trade_id);

	remove_player_cache_entry(trade_player_cache, trade.sender_id, trade_id);
	remove_player_cache_entry(trade_player_cache, trade.recipient_id, trade_id);

	await create_resolved_trade(trade_id, trade.recipient_id, trade.sender_id, false);

	return { success: true };
});

session_post_route('/api/trade/cancel', async (req, url, client_id, json) => {
	const trade_id = json.trade_id;
	if (typeof trade_id !== 'number')
		return 400; // Bad Request

	const trade = await get_trade_offer(trade_id);
	if (!trade)
		return 400; // Bad Request

	if (trade.state === 0 && trade.sender_id !== client_id)
		return 400; // Bad Request

	if (trade.state === 1 && trade.recipient_id !== client_id)
		return 400; // Bad Request

	if (trade.state === 1)
		await db_execute('DELETE FROM `trade_items` WHERE `trade_id` = ? AND `counter` = 1', [trade_id]);

	await create_resolved_trade(trade_id, trade.sender_id, trade.recipient_id, true);

	await db_execute('DELETE FROM `trade_offers` WHERE `trade_id` = ?', [trade_id]);

	trade_cache.delete(trade_id);

	remove_player_cache_entry(trade_player_cache, trade.sender_id, trade_id);
	remove_player_cache_entry(trade_player_cache, trade.recipient_id, trade_id);

	return { success: true };
});

session_post_route('/api/trade/decline', async (req, url, client_id, json) => {
	const trade_id = json.trade_id;
	if (typeof trade_id !== 'number')
		return 400; // Bad Request

	const trade = await get_trade_offer(trade_id);
	if (!trade || trade.recipient_id !== client_id)
		return 400; // Bad Request

	await db_execute('DELETE FROM `trade_offers` WHERE `trade_id` = ?', [trade_id]);
	trade_cache.delete(trade_id);

	remove_player_cache_entry(trade_player_cache, trade.recipient_id, trade_id);
	remove_player_cache_entry(trade_player_cache, trade.sender_id, trade_id);

	// return items to original sender
	await create_resolved_trade(trade_id, trade.sender_id, trade.recipient_id, true);

	return { success: true };
});

session_post_route('/api/trade/offer', async (req, url, client_id, json) => {
	const recipient_id = json.recipient_id;
	if (typeof recipient_id !== 'number')
		return 400; // Bad Request

	const items = json.items as TransferItem[];
	if (!validate_item_array(items))
		return 400; // Bad Request

	if (!(await guild_membership_exists(client_id, recipient_id)))
		return { error_lang: 'MOD_MP_GUILD_MEMBERSHIP_MISSING' };

	if (await trade_exists(client_id, recipient_id))
		return { error_lang: 'MOD_MP_TRADE_EXISTS' };

	const trade_id = await db_insert(
		'INSERT INTO `trade_offers` (sender_id, recipient_id, attending_id) VALUES(?, ?, ?)',
		[client_id, recipient_id, recipient_id]
	);

	for (const item of items) {
		await db_execute(
			'INSERT INTO `trade_items` (trade_id, item_id, qty, counter) VALUES(?, ?, ?, 0)',
			[trade_id, item.id, item.qty]
		);
	}

	const trade_entry: ActiveTrade = { trade_id, state: 0, attending_id: recipient_id };
	trade_cache.set(trade_id, trade_entry);

	trade_player_cache.get(client_id)?.push(trade_id);
	trade_player_cache.get(recipient_id)?.push(trade_id);
	
	return { success: true, trade_id } as JsonSerializable;
});
// #endregion

// #region ROUTES GIFTING
session_post_route('/api/gift/accept', async (req, url, client_id, json) => {
	const gift_id = json.gift_id;
	if (typeof gift_id !== 'number')
		return 400; // Bad Request

	const gift = await get_gift(gift_id);
	if (gift?.client_id !== client_id)
		return 400; // Bad Request

	await delete_gift(gift);

	return { success: true };
});

session_post_route('/api/gift/decline', async (req, url, client_id, json) => {
	const gift_id = json.gift_id;
	if (typeof gift_id !== 'number')
		return 400; // Bad Request

	const gift = await get_gift(gift_id);
	if (gift?.client_id !== client_id)
		return 400; // Bad Request

	// client shouldn't allow this, so no need for bespoke error
	if ((gift.flags & GiftFlags.Returned) === GiftFlags.Returned)
		return 400; // Bad Request

	await return_gift(gift);

	return { success: true };
});

session_post_route('/api/gift/send', async (req, url, client_id, json) => {
	const recipient_id = json.recipient_id;
	if (typeof recipient_id !== 'number')
		return 400; // Bad Request

	const items = json.items as TransferItem[];
	if (!validate_item_array(items))
		return 400; // Bad Request

	if (!(await guild_membership_exists(client_id, recipient_id)))
		return { error_lang: 'MOD_MP_GUILD_MEMBERSHIP_MISSING' };

	if (items.length >= MAX_TRANSFER_ITEM_COUNT)
		return { error_lang: 'MOD_MP_TOO_MANY_ITEMS' };

	if (await has_pending_gift(client_id, recipient_id))
		return { error_lang: 'MOD_MP_PENDING_GIFT' };

	await send_gift(client_id, recipient_id, items);


	return { success: true } as JsonSerializable;
});
// #endregion

// #region ROUTES GUILDS
session_get_route('/api/guilds/council', async (req, url, client_id) => {
	expire_petitions();
	process_council_actions();
	const membership = await db_get_single(
		'SELECT `guild_id` FROM `guild_memberships` WHERE `client_id` = ? LIMIT 1',
		[client_id]
	) as db_row.guild_memberships;
	if (membership === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
	if (await get_guild_type(membership.guild_id) === FREE_FELLOWSHIP_TYPE)
		return { error_lang: 'MOD_MP_GUILD_COUNCIL_UNAVAILABLE' };

	const raw_page = url.searchParams.get('page');
	const resolved_page = raw_page === null ? 0 : Number(raw_page);
	if (!Number.isSafeInteger(resolved_page) || resolved_page < 0)
		return 400; // Bad Request

	return await get_council_petitions(membership.guild_id, client_id, resolved_page);
});

session_post_route('/api/guilds/petitions/raise', async (req, url, client_id, json) => {
	if (!is_petition_type(json.type))
		return 400; // Bad Request

	const proposed_name = json.type === 'appellation' ? parse_guild_name(json.name) : null;
	const proposed_icon_id = json.type === 'heraldry' && is_valid_icon_id(json.icon_id) ? json.icon_id : null;
	const target_client_id = json.type === 'banishment' ? json.target_client_id : null;
	if (json.type === 'appellation' && proposed_name === null)
		return 400; // Bad Request
	if (json.type === 'heraldry' && proposed_icon_id === null)
		return 400; // Bad Request
	if (json.type === 'banishment' && (
		typeof target_client_id !== 'number' || !Number.isSafeInteger(target_client_id) || target_client_id < 1
	))
		return 400; // Bad Request

	const now = Date.now();
	const raise_petition = db.transaction(() => {
		expire_petitions(now);
		const membership = db.query(
			'SELECT `id`, `guild_id` FROM `guild_memberships` WHERE `client_id` = ? LIMIT 1'
		).get(client_id) as db_row.guild_memberships;
		if (membership === null)
			return { status: 'forbidden' as const };

		const guild = db.query('SELECT `type`, `name` FROM `guilds` WHERE `id` = ? LIMIT 1').get(
			membership.guild_id
		) as { type: GuildType; name: string } | null;
		if (guild === null)
			return { status: 'forbidden' as const };
		if (guild.type === FREE_FELLOWSHIP_TYPE)
			return { status: 'unavailable' as const };

		let target_membership_id: number | null = null;
		if (json.type === 'banishment') {
			const target_membership = db.query(
				'SELECT `id` FROM `guild_memberships` WHERE `client_id` = ? AND `guild_id` = ? LIMIT 1'
			).get(target_client_id, membership.guild_id) as { id: number } | null;
			if (target_membership === null)
				return { status: 'target_missing' as const };
			target_membership_id = target_membership.id;
		}

		const conflict_subject = get_petition_conflict_subject(json.type, target_membership_id ?? undefined);
		const conflict = db.query(
			'SELECT 1 FROM `guild_petitions` WHERE `guild_id` = ? AND `conflict_subject` = ? ' +
			'AND `subject_locked` = 1 LIMIT 1'
		).get(membership.guild_id, conflict_subject);
		if (conflict !== null)
			return { status: 'conflict' as const };

		const petition = db.query(
			'INSERT INTO `guild_petitions` (`guild_id`, `guild_name`, `type`, `conflict_subject`, ' +
			'`petitioner_id`, `proposed_name`, `proposed_icon_id`, `target_client_id`, `target_membership_id`, ' +
			'`created_at`, `expires_at`) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING `id`'
		).get(
			membership.guild_id,
			guild.name,
			json.type,
			conflict_subject,
			client_id,
			proposed_name,
			proposed_icon_id,
			target_client_id,
			target_membership_id,
			now,
			now + PETITION_LIFETIME
		) as { id: number };
		db.query(
			'INSERT INTO `guild_petition_voters` (`petition_id`, `client_id`) ' +
			'SELECT ?, `client_id` FROM `guild_memberships` WHERE `guild_id` = ?'
		).run(petition.id, membership.guild_id);
		return { status: 'created' as const, petition_id: petition.id };
	});

	const result = raise_petition.immediate();
	if (result.status === 'forbidden')
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
	if (result.status === 'target_missing')
		return { error_lang: 'MOD_MP_COUNCIL_TARGET_MISSING' };
	if (result.status === 'conflict')
		return { error_lang: 'MOD_MP_COUNCIL_CONFLICT' };
	if (result.status === 'unavailable')
		return { error_lang: 'MOD_MP_GUILD_COUNCIL_UNAVAILABLE' };
	return { success: true, petition_id: result.petition_id };
});

session_post_route('/api/guilds/petitions/vote', async (req, url, client_id, json) => {
	const petition_id = json.petition_id;
	if (typeof petition_id !== 'number' || !Number.isSafeInteger(petition_id) || petition_id < 1 ||
		!is_petition_choice(json.choice))
		return 400; // Bad Request

	const now = Date.now();
	const cast_vote = db.transaction(() => {
		const petition = db.query('SELECT * FROM `guild_petitions` WHERE `id` = ? LIMIT 1').get(
			petition_id
		) as db_row.guild_petitions;
		if (petition === null)
			return { status: 'missing' as const };
		const guild = db.query('SELECT `type` FROM `guilds` WHERE `id` = ? LIMIT 1').get(
			petition.guild_id
		) as { type: GuildType } | null;
		if (guild?.type === FREE_FELLOWSHIP_TYPE)
			return { status: 'unavailable' as const };
		if (petition.lifecycle === 'active' && petition.expires_at <= now) {
			db.query(
				"UPDATE `guild_petitions` SET `lifecycle` = 'lapsed', `resolved_at` = `expires_at`, " +
				"`subject_locked` = 0 WHERE `id` = ? AND `lifecycle` = 'active'"
			).run(petition_id);
			return { status: 'final' as const };
		}
		if (petition.lifecycle !== 'active')
			return { status: 'final' as const };

		const membership = db.query(
			'SELECT 1 FROM `guild_memberships` WHERE `client_id` = ? AND `guild_id` = ? LIMIT 1'
		).get(client_id, petition.guild_id);
		if (membership === null)
			return { status: 'forbidden' as const };
		const eligible = db.query(
			'SELECT 1 FROM `guild_petition_voters` WHERE `petition_id` = ? AND `client_id` = ? LIMIT 1'
		).get(petition_id, client_id);
		if (eligible === null)
			return { status: 'ineligible' as const };
		const existing = db.query(
			'SELECT 1 FROM `guild_petition_votes` WHERE `petition_id` = ? AND `client_id` = ? LIMIT 1'
		).get(petition_id, client_id);
		if (existing !== null)
			return { status: 'duplicate' as const };

		db.query(
			'INSERT INTO `guild_petition_votes` (`petition_id`, `client_id`, `choice`, `submitted_at`) ' +
			'VALUES(?, ?, ?, ?)'
		).run(petition_id, client_id, json.choice, now);
		const tally = db.query(
			'SELECT (SELECT COUNT(*) FROM `guild_petition_voters` WHERE `petition_id` = ?) AS `eligible`, ' +
			"SUM(CASE WHEN `choice` = 'aye' THEN 1 ELSE 0 END) AS `aye`, " +
			"SUM(CASE WHEN `choice` = 'nay' THEN 1 ELSE 0 END) AS `nay` " +
			'FROM `guild_petition_votes` WHERE `petition_id` = ?'
		).get(petition_id, petition_id) as { eligible: number; aye: number; nay: number };
		const lifecycle = get_petition_resolution(tally.eligible, tally.aye, tally.nay);
		if (lifecycle !== null) {
			db.query(
				'UPDATE `guild_petitions` SET `lifecycle` = ?, `resolved_at` = ?, `execution_state` = ?, ' +
				'`subject_locked` = ? WHERE `id` = ?'
			).run(
				lifecycle,
				now,
				lifecycle === 'granted' ? 'pending' : 'not_applicable',
				lifecycle === 'granted' ? 1 : 0,
				petition_id
			);
		}
		return { status: 'accepted' as const, lifecycle: lifecycle ?? 'active' };
	});

	const result = cast_vote.immediate();
	if (result.status === 'missing')
		return { error_lang: 'MOD_MP_COUNCIL_PETITION_MISSING' };
	if (result.status === 'final')
		return { error_lang: 'MOD_MP_COUNCIL_PETITION_FINAL' };
	if (result.status === 'unavailable')
		return { error_lang: 'MOD_MP_GUILD_COUNCIL_UNAVAILABLE' };
	if (result.status === 'forbidden')
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
	if (result.status === 'ineligible')
		return { error_lang: 'MOD_MP_COUNCIL_INELIGIBLE' };
	if (result.status === 'duplicate')
		return { error_lang: 'MOD_MP_COUNCIL_ALREADY_VOTED' };
	if (result.lifecycle === 'granted')
		process_council_actions();
	return { success: true, lifecycle: result.lifecycle };
});

session_post_route('/api/guilds/petitions/withdraw', async (req, url, client_id, json) => {
	const petition_id = json.petition_id;
	if (typeof petition_id !== 'number' || !Number.isSafeInteger(petition_id) || petition_id < 1)
		return 400; // Bad Request

	const now = Date.now();
	const withdraw_petition = db.transaction(() => {
		const petition = db.query('SELECT * FROM `guild_petitions` WHERE `id` = ? LIMIT 1').get(
			petition_id
		) as db_row.guild_petitions;
		if (petition === null)
			return 'missing';
		const guild = db.query('SELECT `type` FROM `guilds` WHERE `id` = ? LIMIT 1').get(
			petition.guild_id
		) as { type: GuildType } | null;
		if (guild?.type === FREE_FELLOWSHIP_TYPE)
			return 'unavailable';
		if (petition.lifecycle === 'active' && petition.expires_at <= now) {
			db.query(
				"UPDATE `guild_petitions` SET `lifecycle` = 'lapsed', `resolved_at` = `expires_at`, " +
				"`subject_locked` = 0 WHERE `id` = ? AND `lifecycle` = 'active'"
			).run(petition_id);
			return 'final';
		}
		if (petition.lifecycle !== 'active')
			return 'final';
		if (petition.petitioner_id !== client_id)
			return 'forbidden';
		const membership = db.query(
			'SELECT 1 FROM `guild_memberships` WHERE `client_id` = ? AND `guild_id` = ? LIMIT 1'
		).get(client_id, petition.guild_id);
		if (membership === null)
			return 'forbidden';
		db.query(
			"UPDATE `guild_petitions` SET `lifecycle` = 'withdrawn', `resolved_at` = ?, `subject_locked` = 0 " +
			"WHERE `id` = ? AND `lifecycle` = 'active'"
		).run(now, petition_id);
		return 'withdrawn';
	});

	const result = withdraw_petition.immediate();
	if (result === 'missing')
		return { error_lang: 'MOD_MP_COUNCIL_PETITION_MISSING' };
	if (result === 'final')
		return { error_lang: 'MOD_MP_COUNCIL_PETITION_FINAL' };
	if (result === 'unavailable')
		return { error_lang: 'MOD_MP_GUILD_COUNCIL_UNAVAILABLE' };
	if (result === 'forbidden')
		return { error_lang: 'MOD_MP_COUNCIL_WITHDRAW_FORBIDDEN' };
	return { success: true };
});

session_get_route('/api/guilds/list', async (req, url, client_id) => {
	const guild_id = await get_client_guild_id(client_id);
	const application = await db_get_single(
		'SELECT 1 FROM `guild_applications` WHERE `client_id` = ? LIMIT 1',
		[client_id]
	);
	if (guild_id !== null || application !== null)
		return { error_lang: 'MOD_MP_GUILD_AFFILIATION_EXISTS' };

	const guilds = await db_get_all(
		'SELECT g.`id` AS `guild_id`, g.`type`, g.`name`, g.`icon_id`, COUNT(m.`client_id`) AS `member_count` ' +
		'FROM `guilds` AS g LEFT JOIN `guild_memberships` AS m ON m.`guild_id` = g.`id` ' +
		"GROUP BY g.`id` ORDER BY CASE WHEN g.`type` = 'free_fellowship' THEN 0 ELSE 1 END, " +
		'g.`name` COLLATE NOCASE, g.`id`'
	) as Array<GuildSummary & { type: GuildType }>;
	return { guilds: guilds.map(guild_summary_from_row) };
});

session_get_route('/api/guilds/members', async (req, url, client_id) => {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

	const raw_page = url.searchParams.get('page');
	const page = raw_page === null ? 0 : Number(raw_page);
	const search = url.searchParams.get('search') ?? '';
	if (!Number.isSafeInteger(page) || page < 0 || search.length > 64)
		return 400; // Bad Request

	return await get_guild_member_directory(guild_id, page, search);
});

session_get_route('/api/guilds/state', async (req, url, client_id) => {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id !== null) {
		const guild = await get_guild_summary(guild_id);
		if (guild === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		const guild_type = guild.is_free_fellowship === true ? FREE_FELLOWSHIP_TYPE : 'private';
		const member_directory = guild_type === FREE_FELLOWSHIP_TYPE
			? await get_guild_member_directory(guild_id, 0, '')
			: null;
		return {
			affiliation: 'member',
			current_client_id: client_id,
			guild: { ...guild, capabilities: get_guild_capabilities(guild_type) },
			members: member_directory?.members ?? await get_guild_members(guild_id),
			...(member_directory === null ? {} : { member_directory }),
			applicants: await get_guild_applicants(client_id)
		};
	}

	const application = await db_get_single(
		'SELECT a.`id` AS `application_id`, g.`id` AS `guild_id`, g.`name`, g.`icon_id`, ' +
		'COUNT(m.`client_id`) AS `member_count` FROM `guild_applications` AS a ' +
		'JOIN `guilds` AS g ON g.`id` = a.`guild_id` ' +
		'LEFT JOIN `guild_memberships` AS m ON m.`guild_id` = g.`id` ' +
		'WHERE a.`client_id` = ? GROUP BY a.`id`',
		[client_id]
	);

	return application === null
		? { affiliation: 'none' }
		: { affiliation: 'applicant', application };
});

session_post_route('/api/guilds/create', async (req, url, client_id, json) => {
	const guild_name = parse_guild_name(json.name);
	if (guild_name === null || !is_valid_icon_id(json.icon_id))
		return 400; // Bad Request

	const create_guild = db.transaction(() => {
		const affiliation = db.query(
			'SELECT 1 FROM `guild_memberships` WHERE `client_id` = ? ' +
			'UNION ALL SELECT 1 FROM `guild_applications` WHERE `client_id` = ? LIMIT 1'
		).get(client_id, client_id);
		if (affiliation !== null)
			return null;

		const guild = db.query(
			'INSERT INTO `guilds` (`name`, `icon_id`) VALUES(?, ?) RETURNING `id`'
		).get(guild_name, json.icon_id) as { id: number };
		db.query(
			'INSERT INTO `guild_memberships` (`client_id`, `guild_id`) VALUES(?, ?)'
		).run(client_id, guild.id);
		return guild.id;
	});

	const guild_id = create_guild.immediate();
	if (guild_id === null)
		return { error_lang: 'MOD_MP_GUILD_AFFILIATION_EXISTS' };

	await ensure_guild_campaign(guild_id);
	return { success: true, guild: await get_guild_summary(guild_id) };
});

session_post_route('/api/guilds/apply', async (req, url, client_id, json) => {
	const guild_id = json.guild_id;
	if (typeof guild_id !== 'number' || !Number.isSafeInteger(guild_id))
		return 400; // Bad Request

	const create_application = db.transaction(() => {
		const affiliation = db.query(
			'SELECT 1 FROM `guild_memberships` WHERE `client_id` = ? ' +
			'UNION ALL SELECT 1 FROM `guild_applications` WHERE `client_id` = ? LIMIT 1'
		).get(client_id, client_id);
		if (affiliation !== null)
			return 'affiliated';

		const guild = db.query('SELECT `type` FROM `guilds` WHERE `id` = ? LIMIT 1').get(guild_id) as {
			type: GuildType;
		} | null;
		if (guild === null)
			return 'missing';
		if (guild.type === FREE_FELLOWSHIP_TYPE)
			return 'free_fellowship';

		db.query(
			'INSERT INTO `guild_applications` (`client_id`, `guild_id`) VALUES(?, ?)'
		).run(client_id, guild_id);
		return 'created';
	});

	const result = create_application.immediate();
	if (result === 'affiliated')
		return { error_lang: 'MOD_MP_GUILD_AFFILIATION_EXISTS' };
	if (result === 'missing')
		return { error_lang: 'MOD_MP_GUILD_NOT_FOUND' };
	if (result === 'free_fellowship')
		return { error_lang: 'MOD_MP_GUILD_APPLICATION_FORBIDDEN' };

	return { success: true };
});

session_post_route('/api/guilds/join-free', async (req, url, client_id) => {
	const join_fellowship = db.transaction(() => {
		const affiliation = db.query(
			' SELECT 1 FROM `guild_memberships` WHERE `client_id` = ? ' +
			'UNION ALL SELECT 1 FROM `guild_applications` WHERE `client_id` = ? LIMIT 1'
		).get(client_id, client_id);
		if (affiliation !== null)
			return { status: 'affiliated' as const };

		const fellowship = db.query(
			"SELECT `id` FROM `guilds` WHERE `type` = 'free_fellowship' LIMIT 1"
		).get() as { id: number } | null;
		if (fellowship === null)
			return { status: 'missing' as const };

		db.query(
			'INSERT INTO `guild_memberships` (`client_id`, `guild_id`) VALUES(?, ?)'
		).run(client_id, fellowship.id);
		return { status: 'joined' as const, guild_id: fellowship.id };
	});

	const result = join_fellowship.immediate();
	if (result.status === 'affiliated')
		return { error_lang: 'MOD_MP_GUILD_AFFILIATION_EXISTS' };
	if (result.status === 'missing')
		return { error_lang: 'MOD_MP_GUILD_NOT_FOUND' };

	await ensure_guild_campaign(result.guild_id);
	return { success: true, guild: await get_guild_summary(result.guild_id) };
});

session_post_route('/api/guilds/withdraw', async (req, url, client_id) => {
	const result = await db_run('DELETE FROM `guild_applications` WHERE `client_id` = ?', [client_id]);
	return result.changes === 1
		? { success: true }
		: { error_lang: 'MOD_MP_GUILD_APPLICATION_MISSING' };
});

session_post_route('/api/guilds/application/decide', async (req, url, client_id, json) => {
	const application_id = json.application_id;
	if (typeof application_id !== 'number' || !Number.isSafeInteger(application_id) || typeof json.approve !== 'boolean')
		return 400; // Bad Request

	const decide_application = db.transaction(() => {
		const membership = db.query(
			'SELECT m.`guild_id`, g.`type` FROM `guild_memberships` AS m ' +
			'JOIN `guilds` AS g ON g.`id` = m.`guild_id` WHERE m.`client_id` = ? LIMIT 1'
		).get(client_id) as db_row.guild_memberships;
		if (membership === null)
			return 'forbidden';

		const application = db.query(
			'DELETE FROM `guild_applications` WHERE `id` = ? AND `guild_id` = ? RETURNING `client_id`'
		).get(application_id, membership.guild_id) as { client_id: number } | null;
		if (application === null)
			return 'missing';

		if (json.approve)
			db.query(
				'INSERT INTO `guild_memberships` (`client_id`, `guild_id`) VALUES(?, ?)'
			).run(application.client_id, membership.guild_id);

		return application.client_id;
	});

	const applicant_id = decide_application.immediate();
	if (applicant_id === 'forbidden')
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
	if (applicant_id === 'missing')
		return { error_lang: 'MOD_MP_GUILD_APPLICATION_MISSING' };

	if (json.approve) {
		const guild_id = await get_client_guild_id(applicant_id as number);
		if (guild_id !== null)
			await resize_unprogressed_campaign(guild_id);
	}

	return {
		success: true,
		approved: json.approve,
		applicant: await get_client_display(applicant_id as number)
	};
});

session_post_route('/api/guilds/leave', async (req, url, client_id) => {
	const current_guild_id = await get_client_guild_id(client_id);
	if (await has_guild_departure_blocker(client_id))
		return { error_lang: 'MOD_MP_GUILD_DEPARTURE_BLOCKED' };

	const leave_guild = db.transaction(() => {
		const membership = db.query(
			'SELECT m.`guild_id`, g.`type` FROM `guild_memberships` AS m ' +
			'JOIN `guilds` AS g ON g.`id` = m.`guild_id` WHERE m.`client_id` = ? LIMIT 1'
		).get(client_id) as (db_row.guild_memberships & { type: GuildType }) | null;
		if (membership === null)
			return 'missing';

		const blocker = db.query(
			'SELECT ' +
			'EXISTS(SELECT 1 FROM `market_items` WHERE `client_id` = ?) OR ' +
			'EXISTS(SELECT 1 FROM `gifts` WHERE `client_id` = ? OR `sender_id` = ?) OR ' +
			'EXISTS(SELECT 1 FROM `trade_offers` WHERE `sender_id` = ? OR `recipient_id` = ?) OR ' +
			'EXISTS(SELECT 1 FROM `resolved_trade_offers` WHERE `client_id` = ?) AS `blocked`'
		).get(client_id, client_id, client_id, client_id, client_id, client_id) as { blocked: number };
		if (blocker.blocked === 1)
			return 'blocked';

		db.query('DELETE FROM `guild_memberships` WHERE `client_id` = ?').run(client_id);
		const remaining = db.query(
			'SELECT COUNT(*) AS `count` FROM `guild_memberships` WHERE `guild_id` = ?'
		).get(membership.guild_id) as { count: number };
		if (remaining.count === 0 && membership.type !== FREE_FELLOWSHIP_TYPE)
			db.query('DELETE FROM `guilds` WHERE `id` = ?').run(membership.guild_id);

		return remaining.count === 0 && membership.type !== FREE_FELLOWSHIP_TYPE ? 'dissolved' : 'left';
	});

	const result = leave_guild.immediate();
	if (result === 'missing')
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
	if (result === 'blocked')
		return { error_lang: 'MOD_MP_GUILD_DEPARTURE_BLOCKED' };

	if (result === 'dissolved' && current_guild_id !== null)
		forget_guild_campaign(current_guild_id);
	else if (result === 'left' && current_guild_id !== null)
		await resize_unprogressed_campaign(current_guild_id);

	return { success: true, dissolved: result === 'dissolved' };
});
// #endregion

// #region ROUTES EQUIPMENT
session_post_route('/api/client/equipment/sync', async (req, url, client_id, json) => {
	const slots = parse_equipment_snapshot(json.slots);
	if (slots === null)
		return 400; // Bad Request

	const save_snapshot = db.transaction(() => {
		const client = db.query(
			'SELECT `equipment_visible` FROM `clients` WHERE `id` = ? LIMIT 1'
		).get(client_id) as Pick<db_row.clients, 'equipment_visible'>;
		if (client.equipment_visible !== 1)
			return false;

		db.query('INSERT INTO `equipment_snapshots` (`client_id`) VALUES(?) ON CONFLICT DO NOTHING').run(client_id);
		db.query('DELETE FROM `equipment_snapshot_items` WHERE `client_id` = ?').run(client_id);
		const insert = db.query(
			'INSERT INTO `equipment_snapshot_items` (`client_id`, `slot_id`, `item_id`) VALUES(?, ?, ?)'
		);
		for (const slot of slots)
			insert.run(client_id, slot.slot_id, slot.item_id);
		return true;
	});

	if (!save_snapshot.immediate())
		return { error_lang: 'MOD_MP_EQUIPMENT_SHARING_DISABLED' };
	return { success: true };
});

session_post_route('/api/client/equipment/visibility', async (req, url, client_id, json) => {
	if (typeof json.visible !== 'boolean')
		return 400; // Bad Request

	const set_visibility = db.transaction(() => {
		db.query('UPDATE `clients` SET `equipment_visible` = ? WHERE `id` = ?').run(
			json.visible ? 1 : 0,
			client_id
		);
		if (!json.visible)
			db.query('DELETE FROM `equipment_snapshots` WHERE `client_id` = ?').run(client_id);
	});
	set_visibility.immediate();

	return { success: true, visible: json.visible };
});

session_get_route('/api/guilds/equipment', async (req, url, client_id) => {
	const subject_id = Number(url.searchParams.get('client_id'));
	if (!Number.isSafeInteger(subject_id) || subject_id < 1)
		return 400; // Bad Request

	if (!await guild_membership_exists(client_id, subject_id))
		return { error_lang: 'MOD_MP_GUILD_MEMBERSHIP_MISSING' };

	const subject = await db_get_single(
		'SELECT c.`equipment_visible`, EXISTS(' +
			'SELECT 1 FROM `equipment_snapshots` AS es WHERE es.`client_id` = c.`id`' +
		') AS `equipment_available` FROM `clients` AS c WHERE c.`id` = ? LIMIT 1',
		[subject_id]
	);
	if (subject?.equipment_visible !== 1)
		return { error_lang: 'MOD_MP_EQUIPMENT_SHARING_DISABLED' };
	if (subject.equipment_available !== 1)
		return { error_lang: 'MOD_MP_EQUIPMENT_NOT_AVAILABLE' };

	return {
		client_id: subject_id,
		slots: await db_get_all(
			'SELECT `slot_id`, `item_id` FROM `equipment_snapshot_items` WHERE `client_id` = ? ORDER BY `slot_id`',
			[subject_id]
		)
	};
});
// #endregion

// #region ROUTES PLAYER STATUS
session_post_route('/api/client/status/sync', async (req, url, client_id, json) => {
	const skills = parse_player_status_skills(json.skills);
	const activity = parse_player_status_activity(json.activity);
	if (skills === null || activity === null)
		return 400; // Bad Request

	const save_snapshot = db.transaction(() => {
		const client = db.query(
			'SELECT `status_visible` FROM `clients` WHERE `id` = ? LIMIT 1'
		).get(client_id) as Pick<db_row.clients, 'status_visible'>;
		if (client.status_visible !== 1)
			return false;

		db.query(
			'INSERT INTO `status_snapshots` ' +
			'(`client_id`, `activity_type`, `activity_skill_id`, `activity_action_id`, `activity_area_id`) ' +
			'VALUES(?, ?, ?, ?, ?) ' +
			'ON CONFLICT(`client_id`) DO UPDATE SET `activity_type` = excluded.`activity_type`, ' +
			'`activity_skill_id` = excluded.`activity_skill_id`, `activity_action_id` = excluded.`activity_action_id`, ' +
			'`activity_area_id` = excluded.`activity_area_id`'
		).run(
			client_id,
			activity.type,
			activity.type === 'skill' ? activity.skill_id : null,
			activity.type === 'skill' ? activity.action_id : null,
			activity.type === 'combat' ? activity.area_id : null
		);
		db.query('DELETE FROM `status_snapshot_skills` WHERE `client_id` = ?').run(client_id);
		const insert = db.query(
			'INSERT INTO `status_snapshot_skills` (`client_id`, `skill_id`, `level`) VALUES(?, ?, ?)'
		);
		for (const skill of skills)
			insert.run(client_id, skill.skill_id, skill.level);
		return true;
	});

	if (!save_snapshot.immediate())
		return { error_lang: 'MOD_MP_STATUS_SHARING_DISABLED' };
	return { success: true };
});

session_post_route('/api/client/status/visibility', async (req, url, client_id, json) => {
	if (typeof json.visible !== 'boolean')
		return 400; // Bad Request

	const set_visibility = db.transaction(() => {
		db.query('UPDATE `clients` SET `status_visible` = ? WHERE `id` = ?').run(
			json.visible ? 1 : 0,
			client_id
		);
		if (!json.visible)
			db.query('DELETE FROM `status_snapshots` WHERE `client_id` = ?').run(client_id);
	});
	set_visibility.immediate();

	return { success: true, visible: json.visible };
});

session_get_route('/api/guilds/status', async (req, url, client_id) => {
	const subject_id = Number(url.searchParams.get('client_id'));
	if (!Number.isSafeInteger(subject_id) || subject_id < 1)
		return 400; // Bad Request

	if (!await guild_membership_exists(client_id, subject_id))
		return { error_lang: 'MOD_MP_GUILD_MEMBERSHIP_MISSING' };

	const subject = await db_get_single(
		'SELECT c.`status_visible`, EXISTS(' +
			'SELECT 1 FROM `status_snapshots` AS ss WHERE ss.`client_id` = c.`id`' +
		') AS `status_available` FROM `clients` AS c WHERE c.`id` = ? LIMIT 1',
		[subject_id]
	);
	if (subject === null || subject.status_visible !== 1)
		return { error_lang: 'MOD_MP_STATUS_SHARING_DISABLED' };
	if (subject.status_available !== 1)
		return { error_lang: 'MOD_MP_STATUS_NOT_AVAILABLE' };

	const snapshot = await db_get_single(
		'SELECT `activity_type`, `activity_skill_id`, `activity_action_id`, `activity_area_id` ' +
		'FROM `status_snapshots` WHERE `client_id` = ? LIMIT 1',
		[subject_id]
	) as db_row.status_snapshots;
	if (snapshot === null)
		return { error_lang: 'MOD_MP_STATUS_NOT_AVAILABLE' };

	const activity: PlayerStatusActivity = snapshot.activity_type === 'idle'
		? { type: 'idle' }
		: snapshot.activity_type === 'skill'
			? { type: 'skill', skill_id: snapshot.activity_skill_id as string,
				action_id: snapshot.activity_action_id as string }
			: { type: 'combat', area_id: snapshot.activity_area_id };

	return {
		client_id: subject_id,
		skills: await db_get_all(
			'SELECT `skill_id`, `level` FROM `status_snapshot_skills` WHERE `client_id` = ? ORDER BY `skill_id`',
			[subject_id]
		),
		activity
	};
});
// #endregion

// #region ROUTES CHAT
function chat_error(status: 'bad_request' | 'missing' | 'privacy' | 'budget') {
	if (status === 'privacy')
		return { error_lang: CHAT_PRIVACY_ERROR };
	if (status === 'budget')
		return { error_lang: CHAT_BUDGET_ERROR };
	if (status === 'missing')
		return { error_lang: 'MOD_MP_CHAT_CONVERSATION_MISSING' };
	return 400;
}

session_get_route('/api/chat/state', async (req, url, client_id) => get_chat_state(client_id));

session_get_route('/api/chat/conversations', async (req, url, client_id) => ({
	conversations: list_conversations(client_id)
}));

session_post_route('/api/chat/conversations/start', async (req, url, client_id, json) => {
	const target_id = json.client_id;
	if (typeof target_id !== 'number')
		return 400;
	const result = start_conversation(client_id, target_id);
	return result.status === 'ok' ? { success: true, conversation: result.value } : chat_error(result.status);
});

session_get_route('/api/chat/messages', async (req, url, client_id) => {
	const conversation_id = Number(url.searchParams.get('conversation_id'));
	const before_parameter = url.searchParams.get('before');
	const after_parameter = url.searchParams.get('after');
	const before = before_parameter === null ? null : Number(before_parameter);
	const after = after_parameter === null ? null : Number(after_parameter);
	const result = list_messages(client_id, conversation_id, before, after);
	return result.status === 'ok' ? result.value : chat_error(result.status);
});

session_post_route('/api/chat/messages/send', async (req, url, client_id, json) => {
	if (typeof json.conversation_id !== 'number' || typeof json.idempotency_key !== 'string' ||
		typeof json.content !== 'string')
		return 400;
	const result = send_message(client_id, json.conversation_id, json.idempotency_key, json.content);
	return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
});

session_post_route('/api/chat/messages/delete', async (req, url, client_id, json) => {
	if (typeof json.message_id !== 'number')
		return 400;
	const result = delete_message(client_id, json.message_id);
	return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
});

session_post_route('/api/chat/conversations/delete', async (req, url, client_id, json) => {
	if (typeof json.conversation_id !== 'number')
		return 400;
	const result = delete_conversation(client_id, json.conversation_id);
	return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
});

session_post_route('/api/chat/block', async (req, url, client_id, json) => {
	if (typeof json.client_id !== 'number' || typeof json.blocked !== 'boolean')
		return 400;
	const result = set_block(client_id, json.client_id, json.blocked);
	return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
});

session_post_route('/api/chat/privacy', async (req, url, client_id, json) => {
	if (typeof json.messaging_enabled !== 'boolean')
		return 400;
	const result = set_messaging_enabled(client_id, json.messaging_enabled);
	return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
});
// #endregion

// #region ROUTES FRIENDS
session_post_route('/api/friends/remove', async (req, url, client_id, json) => {
	const friend_id = json.friend_id;
	if (typeof friend_id !== 'number')
		return 400; // Bad Request

	await delete_friend(client_id, friend_id);

	return { success: true };
});

session_get_route('/api/friends/get', async (req, url, client_id, json) => {
	return {
		friends: await get_friends(client_id)
	}
});

session_post_route('/api/friends/accept', async (req, url, client_id, json) => {
	const request_id = json.request_id;
	if (typeof request_id !== 'number')
		return 400; // Bad Request;

	const request = await get_friend_request(request_id);
	if (request !== null && request.client_id === client_id) {
		await create_friendship(request.client_id, request.friend_id);
		await delete_friend_request(request);

		return {
			success: true,
			friend: {
				friend_id: request.friend_id,
				display_name: await get_client_display_name(request.friend_id)
			}
		};
	}

	return { success: false } as JsonSerializable;
});

session_post_route('/api/friends/ignore', async (req, url, client_id, json) => {
	const request_id = json.request_id;
	if (typeof request_id !== 'number')
		return 400; // Bad Request

	const request = await get_friend_request(request_id);
	if (request !== null && request.client_id === client_id)
		await delete_friend_request(request);
	
	return { success: true };
});

session_post_route('/api/friends/add', async (req, url, client_id, json) => {
	const friend_code = json.friend_code;
	if (typeof friend_code !== 'string')
		return 400; // Bad Request

	if (!is_valid_friend_code(friend_code))
		return { error_lang: 'MOD_MP_INVALID_FRIEND_CODE_ERR' };

	const friend_user_id = await get_user_id_from_friend_code(friend_code);
	if (friend_user_id === -1)
		return { error_lang: 'MOD_MP_UNKNOWN_FRIEND_CODE_ERR' };

	if (friend_user_id === client_id)
		return { error_lang: 'MOD_MP_NO_SELF_LOVE_ERR' };

	if (await friendship_exists(client_id, friend_user_id))
		return { error_lang: 'MOD_MP_FRIENDSHIP_EXISTS' };

	// note: client_id and friend_id are swapped when inserting, as it makes logical sense to look up
	// client_id for requests, then add the friend_id, rather than looking up friend_id.
	if (!(await friend_request_exists(friend_user_id, client_id)))
		await create_friend_request(friend_user_id, client_id);

	return { success: true } as JsonSerializable;
});
// #endregion

// #region ROUTES IDENTITIES
session_get_route('/api/identities', async (req, url, client_id) => {
	execute_due_client_deletions();
	return { identities: list_sibling_identities(client_id) };
});

session_post_route('/api/identities/delete', async (req, url, client_id, json) => {
	const target_client_id = json.client_id;
	if (typeof target_client_id !== 'number')
		return 400; // Bad Request
	const result = schedule_client_deletion(client_id, target_client_id);
	if (result === 'bad_request')
		return 400; // Bad Request
	if (result === 'missing')
		return 404; // Not Found
	if (result === 'pending')
		return Response.json({ identity_status: 'deletion_pending' }, { status: 409 });
	return { success: true, deletion: result };
});

session_post_route('/api/identities/delete/cancel', async (req, url, client_id, json) => {
	const target_client_id = json.client_id;
	if (typeof target_client_id !== 'number')
		return 400; // Bad Request
	const result = cancel_scheduled_client_deletion(client_id, target_client_id);
	if (result === 'bad_request')
		return 400; // Bad Request
	if (result === 'missing')
		return 404; // Not Found
	return { success: true };
});
// #endregion

// #region ROUTES GENERAL
session_get_route('/api/events', async (req, url, client_id) => {
	const trade_ids = await get_client_trades(client_id);
	const trade_meta = [];

	for (const trade_id of trade_ids) {
		const meta = await get_trade_offer_meta(trade_id);
		if (!meta)
			continue;

		trade_meta.push({
			trade_id,
			attending: meta.attending_id === client_id,
			state: meta.state
		});
	}

	return {
		friend_requests: await get_friend_requests(client_id),
		guild_applicants: await get_guild_applicants(client_id),
		gifts: await get_client_gifts(client_id),
		trades: trade_meta,
		resolved_trades: await get_client_resolved_trades(client_id),
		campaign: await get_campaign_progress(client_id),
		market_completed: await get_market_completed(client_id),
		banishment_return_pending: await db_exists(
			'SELECT 1 FROM `banishment_returns` WHERE `client_id` = ? AND `completed_at` IS NULL LIMIT 1',
			[client_id]
		) || has_deletion_returns(client_id),
		chat_unread: get_unread_chat_count(client_id)
	};
});

session_post_route('/api/client/set_icon', async (req, url, client_id, json) => {
	const icon_id = json.icon_id;
	if (typeof icon_id !== 'string')
		return 400; // Bad Request

	if (!icon_id.startsWith('melvorF:') && !icon_id.startsWith('melvorD:'))
		return 400; // Bad Request

	await db_execute('UPDATE `clients` SET `icon_id` = ? WHERE `id` = ?', [icon_id, client_id]);

	return { success: true };
});

session_post_route('/api/client/set_display_name', async (req, url, client_id, json) => {
	const display_name = parse_display_name(json.display_name);
	if (display_name === null)
		return 400; // Bad Request

	await db_execute('UPDATE `clients` SET `display_name` = ? WHERE `id` = ?', [display_name, client_id]);
	display_name_cache.set(client_id, display_name);
	friend_request_cache.clear();

	return { success: true, display_name };
});
// #endregion

// #region ROUTES AUTH
server.route('/health', require_source_capacity(() => ({ status: 'ok', backend_version: BACKEND_VERSION })));

server.route('/api/authenticate', allow_browser_access(require_source_capacity(require_service_available(validate_json_request(async (req, url, json) => {
	await Bun.sleep(1000);
	execute_due_client_deletions();

	const client_identifier = json.client_identifier;
	const client_key = json.client_key;

	if (typeof client_identifier !== 'string' || typeof client_key !== 'string')
		return 400; // Bad Request

	if (!is_valid_uuid(client_identifier) || !is_valid_uuid(client_key))
		return 400; // Bad Request
	const melvor_account = parse_melvor_account(json);
	if (melvor_account === undefined)
		return 400; // Bad Request

	const client_row = await db_get_single(
		'SELECT `id`, `client_key`, `friend_code`, `display_name`, `icon_id`, `disabled`, `equipment_visible`, `status_visible`, ' +
		'`messaging_enabled`, `melvor_account_id`, `deleted_at` ' +
		'FROM `clients` WHERE `client_identifier` = ? LIMIT 1',
		[client_identifier]
	) as db_row.clients;
	if (client_row === null || client_row.client_key !== client_key)
		return 401; // Unauthorized
	if (client_row.disabled === 1)
		return 403; // Forbidden
	const association = associate_client_with_melvor_account(
		client_row.id,
		client_row.melvor_account_id,
		melvor_account
	);
	if (association === 'mismatch')
		return Response.json({ identity_status: 'melvor_account_mismatch' }, { status: 409 });
	if (association === 'required')
		return Response.json({ identity_status: 'melvor_account_required' }, { status: 409 });
	const deletion_cancelled = cancel_deletion_on_authentication(client_row.id);
	const identity_recovered = recover_deleted_client(client_row.id);

	identify_request(req, client_row.id);
	const session_token = await generate_session_token(client_row.id);
	log('client', 'authorized client session for identity {%d}', client_row.id);

	return { session_token, friend_code: client_row.friend_code, display_name: client_row.display_name,
		icon_id: client_row.icon_id, equipment_visible: client_row.equipment_visible === 1,
		status_visible: client_row.status_visible === 1, chat: get_chat_state(client_row.id),
		deletion_cancelled, identity_recovered };
})))), ['POST', 'OPTIONS']);

server.route('/api/register', allow_browser_access(require_source_capacity(require_registration_capacity(require_service_available(validate_json_request(async (req, url, json) => {
	await Bun.sleep(1000);

	const client_key = json.client_key;

	if (typeof client_key !== 'string' || !is_valid_uuid(client_key))
		return 400; // Bad Request
	const melvor_account = parse_melvor_account(json);
	if (melvor_account === undefined)
		return 400; // Bad Request
	const friend_code = await generate_friend_code();
	const display_name = validate_display_name(json.display_name);

	const client_identifier = crypto.randomUUID();
	const registration = register_client(
		client_identifier,
		client_key,
		friend_code,
		display_name,
		DEFAULT_USER_ICON_ID,
		melvor_account
	);

	if (registration.status !== 'created')
		return temporary_unavailable();

	const client_id = registration.client_id;
	identify_request(req, client_id);
	log('client', 'registered new identity {%d}', client_id);

	const session_token = await generate_session_token(client_id);
	return { session_token, client_identifier, friend_code, display_name, icon_id: DEFAULT_USER_ICON_ID,
		equipment_visible: true, status_visible: true, chat: get_chat_state(client_id) };
}))))), ['POST', 'OPTIONS']);
// #endregion

// #region SERVER CONTROL
// unhandled exceptions and rejections
server.error((err: Error) => {
	report_error('unhandled request error', err);
	return default_handler(500);
});

// unhandled response codes.
server.default((req, status_code) => default_handler(status_code));

server.start();
// #endregion
