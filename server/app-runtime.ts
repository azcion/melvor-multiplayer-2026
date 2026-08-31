import { createHash } from 'node:crypto';
import { parse_device_diagnostics, mark_rejection, type DeviceDiagnostics } from './diagnostics';
// #region IMPORTS
import { format } from 'node:util';
import type { SQLQueryBindings } from 'bun:sqlite';
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
import type { PetitionType } from './council';
import {
	create_http_server,
	identify_request,
	read_json_request,
	status_response,
	validate_json_request
} from './http';
import type { HandlerResult, HandlerReturnType, JsonObject, JsonSerializable, RequestHandler } from './http';
import { flush_logs, report_error, write_log } from './log';
import { load_auth_response_delay, load_request_limit_configuration, RequestLimitPolicy } from './security';
import { create_shutdown_handler } from './shutdown';
import { is_shadowed, shadowed_cutoff } from './shadowed';
import { AVAILABLE_CAMPAIGNS } from './campaign_data';
import type { CampaignData, CampaignItemData } from './campaign_data';
import { record_guild_activity } from './guild-activity';
import type * as db_row from './db/types/db_types';
import { BACKEND_VERSION } from './version';
import {
	CHAT_BUDGET_ENABLED,
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
	get_support_unread_count,
	list_support_conversations,
	list_support_messages,
	reconcile_support_memberships,
	reconcile_support_team_memberships,
	send_support_message
} from './support_chat';
import {
	get_guild_chat_inbox,
	get_guild_chat_unread_count,
	has_guild_chat_capability,
	list_guild_chat_messages,
	send_guild_chat_message,
	set_guild_chat_enabled
} from './guild_chat';
import {
	acknowledge_deletion_return_claim,
	associate_client_with_melvor_account,
	cancel_deletion_on_authentication,
	cancel_scheduled_client_deletion,
	CLIENT_DELETION_MAINTENANCE_INTERVAL,
	create_deletion_return_claim,
	get_client_deletion_status,
	get_deletion_claim_view,
	has_deletion_returns,
	list_sibling_identities,
	parse_melvor_account,
	process_due_client_deletions,
	recover_deleted_client,
	schedule_client_deletion
} from './identity';
import {
	acknowledge_economy_receipt,
	economy_item_effects,
	pending_economy_receipts,
	run_economy_command
} from './economy';
import {
	acknowledge_victory_cache,
	abandon_assault,
	activate_raid,
	get_raid_state,
	get_victory_cache,
	reserve_assault,
	settle_assault,
	type RaidOutcome
} from './raid';
// #endregion
export { db, db_get_single, db_execute, db_insert, db_exists, db_get_all, db_run, get_service_setting, register_client } from './db';
export { CAMPAIGN_AUTO_ADVANCE_INTERVAL, CAMPAIGN_AUTO_CONTRIBUTION_CAP, CAMPAIGN_AUTO_PROGRESS_SQL, get_campaign_auto_advance, get_campaign_item_total, get_required_campaign_contributors } from './campaign';
export { COUNCIL_HISTORY_PAGE_SIZE, COUNCIL_MAINTENANCE_INTERVAL, get_petition_conflict_subject, get_petition_resolution, is_petition_choice, is_petition_type, PETITION_FAILED_RETRY_AFTER, PETITION_LIFETIME, PETITION_RUNNING_STALE_AFTER } from './council';
export { create_http_server, identify_request, read_json_request, status_response, validate_json_request } from './http';
export { flush_logs, report_error, write_log } from './log';
export { load_auth_response_delay, load_request_limit_configuration, RequestLimitPolicy } from './security';
export { create_shutdown_handler } from './shutdown';
export { is_shadowed, shadowed_cutoff } from './shadowed';
export { AVAILABLE_CAMPAIGNS } from './campaign_data';
export { CHAT_BUDGET_ENABLED, CHAT_BUDGET_ERROR, CHAT_PRIVACY_ERROR, delete_conversation, delete_message, get_chat_state, get_unread_chat_count, list_conversations, list_messages, send_message, set_block, set_messaging_enabled, start_conversation } from './chat';
export { get_support_unread_count, list_support_conversations, list_support_messages, reconcile_support_memberships, reconcile_support_team_memberships, send_support_message } from './support_chat';
export { get_guild_chat_inbox, get_guild_chat_unread_count, has_guild_chat_capability, list_guild_chat_messages, send_guild_chat_message, set_guild_chat_enabled } from './guild_chat';
export { acknowledge_deletion_return_claim, associate_client_with_melvor_account, cancel_deletion_on_authentication, cancel_scheduled_client_deletion, CLIENT_DELETION_MAINTENANCE_INTERVAL, create_deletion_return_claim, get_client_deletion_status, get_deletion_claim_view, has_deletion_returns, list_sibling_identities, parse_melvor_account, process_due_client_deletions, recover_deleted_client, schedule_client_deletion } from './identity';
export { acknowledge_economy_receipt, economy_item_effects, pending_economy_receipts, run_economy_command } from './economy';
export { acknowledge_victory_cache, abandon_assault, activate_raid, get_raid_state, get_victory_cache, reserve_assault, settle_assault } from './raid';
export { BACKEND_VERSION } from './version';


// #region TYPES
export type SessionRequestHandler = (req: Request, url: URL, client_id: number, json: JsonObject) => HandlerReturnType;
export type SessionBinaryRequestHandler = (req: Request, url: URL, client_id: number) => HandlerReturnType;
export type CachedSession = { client_id: number, mod_version: string | null, device_diagnostics?: DeviceDiagnostics | null, last_access: number };

export type ClientRuntime = {
	device: DeviceDiagnostics | null;
	mod_version: string;
	active_mods: string[];
	game_mode_id: string | null;
	language: string | null;
};

export type ActiveTrade = {
	trade_id: number;
	state: number;
	attending_id: number;
}

export type FriendRequest = {
	friend: ClientDisplayInfo,
	request_id: number;
}

export enum GiftFlags {
	Returned = 1 << 0
}

export type TransferItem = {
	id: string;
	qty: number;
}

export type ClientDisplayInfo = {
	display_name: string;
	icon_id: string;
}

export type EquipmentSnapshotSlot = {
	slot_id: string;
	item_id: string;
}

export type PlayerStatusSkill = {
	skill_id: string;
	level: number;
}

export type PlayerStatusActivity =
	| { type: 'idle' }
	| { type: 'skill'; skill_id: string; action_id: string }
	| { type: 'combat'; area_id: string | null };

export type PlayerStatusActiveActivity = Exclude<PlayerStatusActivity, { type: 'idle' }>;

export type GuildMemberRow = {
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
	status_activities: string | null;
	account_creation_date: number | null;
	total_skill_level: number | null;
	gp_visible: number;
	gp_amount: number | null;
	game_mode_visible: number;
	game_mode_id: string | null;
	active_mods_visible: number;
	active_mods_available: number;
	language: string | null;
	last_multiplayer_active_at: number;
	joined_at: number | null;
};

export type GuildSummary = {
	guild_id: number;
	name: string;
	icon_id: string;
	member_count: number;
	is_free_fellowship?: boolean;
	is_public?: boolean;
}

export type GuildType = 'private' | 'public' | 'free_fellowship';

export type GuildCapabilities = {
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

export const FREE_FELLOWSHIP_TYPE: GuildType = 'free_fellowship';
export const PUBLIC_GUILD_TYPE: GuildType = 'public';
export const GUILD_MEMBER_PAGE_SIZE = 50;
export const DIRECT_JOIN_CHARITREE_LOCK = 1000 * 60 * 60 * 24;

export const GUILD_CAPABILITIES: Record<GuildType, GuildCapabilities> = {
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
	public: {
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

export function get_guild_capabilities(type: GuildType): GuildCapabilities {
	return { ...GUILD_CAPABILITIES[type] };
}

export function guild_summary_from_row(row: GuildSummary & { type: GuildType }): GuildSummary {
	return row.type === FREE_FELLOWSHIP_TYPE
		? { guild_id: row.guild_id, name: row.name, icon_id: row.icon_id, member_count: row.member_count,
			is_free_fellowship: true }
		: { guild_id: row.guild_id, name: row.name, icon_id: row.icon_id, member_count: row.member_count,
			...(row.type === PUBLIC_GUILD_TYPE ? { is_public: true } : {}) };
}

export type CouncilPetitionRow = db_row.guild_petitions & {
	eligible_count: number;
	aye_count: number;
	nay_count: number;
	current_vote: 'aye' | 'nay' | null;
	is_eligible: number;
	target_display_name: string | null;
	target_icon_id: string | null;
	winnowing_target_count: number;
}

export type GuildCampaign = {
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
export const DEFAULT_USER_ICON_ID = 'melvorD:Plant';
export const DEFAULT_USER_DISPLAY_NAME = 'Unknown Idler';
export const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{M}\p{N} ._'’-]*[\p{L}\p{M}\p{N}])?$/u;
export const MAX_TRANSFER_ITEM_COUNT = 32;
export const MAX_TRANSFER_CONTENT_ID_COUNT = 128;
export const MAX_MARKET_ITEM_NAMESPACE_COUNT = 64;
export const MAX_MARKET_ITEM_NAMESPACE_LENGTH = 64;
export const MAX_MARKET_EXCLUDED_ITEM_COUNT = 512;
export const MAX_ITEM_ID_LENGTH = 256;
export const MAX_EQUIPMENT_SLOT_COUNT = 32;
export const MAX_EQUIPMENT_ID_LENGTH = 256;
export const MAX_STATUS_SKILL_COUNT = 64;
export const MAX_STATUS_ACTIVITY_COUNT = 16;
export const MAX_STATUS_ID_LENGTH = 256;
export const MAX_ACTIVE_MOD_COUNT = 128;
export const MAX_ACTIVE_MOD_NAME_LENGTH = 128;
export const MAX_MOD_VERSION_LENGTH = 64;
export const MAX_GAME_MODE_ID_LENGTH = 256;
export const MAX_LANGUAGE_LENGTH = 64;
export const AUTH_RESPONSE_DELAY_MS = load_auth_response_delay();
reconcile_support_memberships(
	process.env.SUPPORT_TEAM_CLIENT_IDENTIFIERS_CONFIGURED === '1'
		? process.env.SUPPORT_TEAM_CLIENT_IDENTIFIERS ?? ''
		: undefined
);
reconcile_support_team_memberships(
	process.env.SUPPORT_TEAM_MEMBERSHIPS_CONFIGURED === '1'
		? process.env.SUPPORT_TEAM_MEMBERSHIPS ?? '{}'
		: undefined
);

// maximum cache life is X * 2, minimum is X.
export const CACHE_SESSION_LIFETIME = 1000 * 60 * 60; // 1 hour

// time between data cache sweeps
export const CACHE_RESET_INTERVAL = 1000 * 60 * 60 * 24; // 24 hours
export const CLIENT_ACTIVITY_WRITE_INTERVAL = 1000 * 60 * 5; // 5 minutes

// time between players taking charity items
export const CHARITY_TIMEOUT = 1000 * 60 * 60 * 24; // 24 hours
export const CHARITY_ITEM_LIFETIME = 1000 * 60 * 60 * 24 * 4; // 4 days
export const CHARITY_MAINTENANCE_INTERVAL = 1000 * 60 * 60; // 1 hour

export const CAMPAIGN_RESTART_TIMER = 1000 * 60 * 60 * 12; // 12 hours

export const MARKET_ITEMS_PER_PAGE = 30;

// #endregion

// #region GLOBALS
export const server = create_http_server(Number(process.env.SERVER_PORT));
export const request_limits = new RequestLimitPolicy(load_request_limit_configuration());

export const client_session_cache = new Map<string, CachedSession>();
export const client_activity_writes = new Map<number, number>();

export const friend_request_cache = new Map<number, FriendRequest[]>();
export const gift_cache = new Map<number, number[]>();
export const display_name_cache = new Map<number, string>();
export const display_icon_cache = new Map<number, string>();
export const market_completed_cached = new Map<number, number[]>();

export const trade_cache = new Map<number, ActiveTrade>(); // trade_id to ActiveTrade
export const trade_player_cache = new Map<number, number[]>(); // client_id to trade_id[]
export const resolved_trade_cache = new Map<number, number[]>(); // client_id to trade_id[]

export const guild_campaigns = new Map<number, GuildCampaign>();
// #endregion

// #region COMMON FN
export function log(prefix: string, message: string, ...args: unknown[]): void {
	let formatted_message = format('[{' + prefix + '}] ' + message, ...args);
	formatted_message = formatted_message.replace(/\{([^}]+)\}/g, '$1');

	write_log('info', `type=application message=${JSON.stringify(formatted_message)}`);
}

export function default_handler(status_code: number): Response {
	return status_response(status_code);
}

export function temporary_unavailable(): Response {
	return new Response('Service Unavailable', {
		status: 503,
		headers: { 'Retry-After': '300' }
	});
}

export function require_service_available(handler: RequestHandler): RequestHandler {
	return (req, url) => {
		if (get_service_setting('maintenance') === '1') {
			mark_rejection(req, 'maintenance');
			return temporary_unavailable();
		}
		return handler(req, url);
	};
}

export function require_source_capacity(handler: RequestHandler): RequestHandler {
	return (req, url) => {
		const limited = request_limits.limit_source(req);
		if (limited) mark_rejection(req, 'source_rate_limit');
		return limited ?? handler(req, url);
	};
}

export function require_registration_capacity(handler: RequestHandler): RequestHandler {
	return (req, url) => {
		const limited = request_limits.limit_registration(req);
		if (limited) mark_rejection(req, 'registration_rate_limit');
		return limited ?? handler(req, url);
	};
}

export function browser_response(req: Request, result: unknown): Response {
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
	headers.set('Cache-Control', 'private, no-store');
	headers.set('Access-Control-Allow-Origin', origin);
	headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	headers.set('Access-Control-Expose-Headers', 'X-Multiplayer-Session-State, Retry-After');
	headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token, X-Icon-Catalog-Upload-Token, Cache-Control, Pragma');
	if (req.method === 'OPTIONS') {
		// Native runtimes may add headers. Access is controlled by explicit tokens, not origins or cookies.
		const requested_headers = req.headers.get('Access-Control-Request-Headers');
		if (requested_headers)
			headers.set('Access-Control-Allow-Headers', requested_headers);
		headers.append('Vary', 'Access-Control-Request-Headers');
		headers.set('Access-Control-Max-Age', '600');
	}
	headers.append('Vary', 'Origin');
	headers.append('Vary', 'X-Session-Token');

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

export function allow_browser_access(handler: RequestHandler): RequestHandler {
	return async (req: Request, url: URL) => {
		if (req.method === 'OPTIONS')
			return browser_response(req, new Response(null, { status: 204 }));

		return browser_response(req, await handler(req, url));
	};
}

export function is_valid_uuid(uuid: string): boolean {
	return uuid.length === 36 && /^[0-9a-f-]+$/.test(uuid);
}

export function remove_player_cache_entry(cache: Map<number, number[]>, client_id: number, item_id: number) {
	const cached_entries = cache.get(client_id);
	if (cached_entries)
		cache.set(client_id, cached_entries.filter(e => e !== item_id));
}

export function parse_transfer_items(items: unknown): TransferItem[] | null {
	if (!Array.isArray(items) || items.length > MAX_TRANSFER_ITEM_COUNT)
		return null;

	const parsed: TransferItem[] = [];

	for (const item of items) {
		if (typeof item !== 'object' || item === null || Array.isArray(item))
			return null;

		const value = item as Record<string, unknown>;
		if (!is_valid_item_id(value.id) || typeof value.qty !== 'number')
			return null;

		if (!Number.isSafeInteger(value.qty) || value.qty <= 0)
			return null;

		parsed.push({ id: value.id, qty: value.qty });
	}

	return parsed;
}

export function parse_number_array(value: unknown): number[] | null {
	if (!Array.isArray(value) || value.length > MAX_TRANSFER_CONTENT_ID_COUNT)
		return null;
	const unique = new Set<number>();
	for (const item of value) {
		if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 1 || unique.has(item))
			return null;
		unique.add(item);
	}
	return value;
}

export function query_placeholders(values: unknown[]): string {
	return values.map(() => '?').join(', ');
}

export function parse_existing_item_ids(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length > MAX_TRANSFER_ITEM_COUNT)
		return null;
	const item_ids: string[] = [];
	for (const item_id of value) {
		if (typeof item_id !== 'string' || item_id.length === 0)
			return null;
		item_ids.push(item_id);
	}
	return new Set(item_ids).size === item_ids.length ? item_ids : null;
}

export function parse_market_namespaces(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length > MAX_MARKET_ITEM_NAMESPACE_COUNT)
		return null;
	const parameters: string[] = [];
	for (const namespace of value) {
		if (typeof namespace !== 'string' || namespace.length === 0 ||
			namespace.length > MAX_MARKET_ITEM_NAMESPACE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(namespace))
			return null;
		parameters.push(namespace.replaceAll('_', '\\_') + ':%');
	}
	return parameters;
}

export function parse_client_runtime(value: unknown): ClientRuntime | null | undefined {
	if (value === undefined)
		return undefined;
	if (value === null || typeof value !== 'object' || Array.isArray(value))
		return null;

	const runtime = value as Record<string, unknown>;
	const mod_version = runtime.mod_version;
	if (typeof mod_version !== 'string' || mod_version.length === 0 ||
		mod_version.length > MAX_MOD_VERSION_LENGTH || !/^[0-9A-Za-z](?:[0-9A-Za-z.-]*[0-9A-Za-z])?$/.test(mod_version))
		return null;
	if (!Array.isArray(runtime.active_mods) || runtime.active_mods.length > MAX_ACTIVE_MOD_COUNT)
		return null;

	const active_mods: string[] = [];
	const seen = new Set<string>();
	for (const value of runtime.active_mods) {
		if (typeof value !== 'string')
			return null;
		const name = value.trim();
		if (name.length === 0 || name.length > MAX_ACTIVE_MOD_NAME_LENGTH)
			return null;
		if (!seen.has(name)) {
			seen.add(name);
			active_mods.push(name);
		}
	}

	const game_mode_id = runtime.game_mode_id;
	if (game_mode_id !== undefined && game_mode_id !== null &&
		(typeof game_mode_id !== 'string' || game_mode_id.length === 0 ||
			game_mode_id.length > MAX_GAME_MODE_ID_LENGTH ||
			!/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(game_mode_id)))
		return null;

	const language = runtime.language;
	if (language !== undefined && language !== null &&
		(typeof language !== 'string' || language.length > MAX_LANGUAGE_LENGTH))
		return null;

	return { device: parse_device_diagnostics(runtime.device), mod_version, active_mods, game_mode_id: game_mode_id ?? null, language: language ?? null };
}

export function persist_client_runtime(client_id: number, runtime: ClientRuntime | undefined, now = Date.now()): void {
	if (runtime === undefined)
		return;
	db.query(
		'INSERT INTO `client_runtime_snapshots` (`client_id`, `mod_version`, `active_mods`, `game_mode_id`, `language`, `reported_at`) ' +
		'VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT (`client_id`) DO UPDATE SET ' +
		'`mod_version` = excluded.`mod_version`, `active_mods` = excluded.`active_mods`, ' +
		'`game_mode_id` = excluded.`game_mode_id`, `language` = excluded.`language`, `reported_at` = excluded.`reported_at`'
	).run(client_id, runtime.mod_version, JSON.stringify(runtime.active_mods), runtime.game_mode_id, runtime.language, now);
}

export function get_released_mod_version(): string | null {
	const version = get_service_setting('released_mod_version');
	return version === null || version.length === 0 ? null : version;
}

export function parse_market_excluded_item_ids(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length > MAX_MARKET_EXCLUDED_ITEM_COUNT)
		return null;
	const item_ids: string[] = [];
	for (const item_id of value) {
		if (!is_valid_item_id(item_id))
			return null;
		item_ids.push(item_id);
	}
	return new Set(item_ids).size === item_ids.length ? item_ids : null;
}

export function array_random(arr: Array<unknown>) {
	return arr[Math.floor(Math.random() * arr.length)];
}

export function parse_guild_name(guild_name: unknown): string | null {
	if (typeof guild_name !== 'string')
		return null;

	const trimmed = guild_name.trim();
	return trimmed.length > 0 && trimmed.length <= 20 ? trimmed : null;
}

export const OFFICIAL_GAME_ICON_NAMESPACES = new Set([
	'melvorD',
	'melvorF',
	'melvorAoD',
	'melvorTotH',
	'melvorItA'
]);

export function is_valid_namespaced_icon_id(icon_id: unknown, namespaces: Set<string>): icon_id is string {
	if (typeof icon_id !== 'string')
		return false;
	const separator = icon_id.indexOf(':');
	return separator > 0 && namespaces.has(icon_id.slice(0, separator));
}

export function is_valid_avatar_icon_id(icon_id: unknown): icon_id is string {
	return is_valid_namespaced_icon_id(icon_id, OFFICIAL_GAME_ICON_NAMESPACES);
}

export function is_valid_guild_icon_id(icon_id: unknown): icon_id is string {
	return is_valid_namespaced_icon_id(icon_id, OFFICIAL_GAME_ICON_NAMESPACES);
}

export function is_valid_equipment_id(id: unknown): id is string {
	return typeof id === 'string' && id.length > 0 && id.length <= MAX_EQUIPMENT_ID_LENGTH &&
		/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(id);
}

export function is_valid_item_id(id: unknown): id is string {
	return typeof id === 'string' && id.length > 0 && id.length <= MAX_ITEM_ID_LENGTH &&
		/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(id);
}

export function parse_equipment_snapshot(slots: unknown): EquipmentSnapshotSlot[] | null {
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

export function is_valid_status_id(id: unknown): id is string {
	return typeof id === 'string' && id.length > 0 && id.length <= MAX_STATUS_ID_LENGTH &&
		/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(id);
}

export function is_valid_status_action_id(id: unknown): id is string {
	return typeof id === 'string' && id.length > 0 && id.length <= MAX_STATUS_ID_LENGTH &&
		/^[A-Za-z0-9_.:-]+$/.test(id);
}

export function parse_player_status_activity(activity: unknown): PlayerStatusActivity | null {
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

export function player_status_activity_key(activity: PlayerStatusActiveActivity): string {
	return activity.type === 'skill'
		? `skill:${activity.skill_id}:${activity.action_id}`
		: `combat:${activity.area_id ?? ''}`;
}

export function parse_player_status_activities(activities: unknown): PlayerStatusActiveActivity[] | null {
	if (!Array.isArray(activities) || activities.length > MAX_STATUS_ACTIVITY_COUNT)
		return null;

	const parsed: PlayerStatusActiveActivity[] = [];
	const seen = new Set<string>();
	for (const candidate of activities) {
		const activity = parse_player_status_activity(candidate);
		if (activity === null || activity.type === 'idle')
			return null;
		const key = player_status_activity_key(activity);
		if (seen.has(key))
			return null;
		seen.add(key);
		parsed.push(activity);
	}
	return parsed;
}

export function legacy_status_activities(activity: PlayerStatusActivity): PlayerStatusActiveActivity[] {
	return activity.type === 'idle' ? [] : [activity];
}

export function status_snapshot_activity(snapshot: Pick<db_row.status_snapshots,
	'activity_type' | 'activity_skill_id' | 'activity_action_id' | 'activity_area_id'>): PlayerStatusActivity {
	return snapshot.activity_type === 'idle'
		? { type: 'idle' }
		: snapshot.activity_type === 'skill'
			? { type: 'skill', skill_id: snapshot.activity_skill_id as string,
				action_id: snapshot.activity_action_id as string }
			: { type: 'combat', area_id: snapshot.activity_area_id };
}

export function status_snapshot_activities(snapshot: Pick<db_row.status_snapshots, 'activities'>,
	legacy_activity: PlayerStatusActivity): PlayerStatusActiveActivity[] {
	try {
		const parsed = parse_player_status_activities(JSON.parse(snapshot.activities));
		if (parsed !== null)
			return parsed;
	} catch {
		// Older or manually repaired snapshots fall back to the legacy activity.
	}
	return legacy_status_activities(legacy_activity);
}

export function parse_player_status_skills(skills: unknown): PlayerStatusSkill[] | null {
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

export function parse_player_status_account_creation_date(value: unknown): number | null | undefined {
	if (value === null)
		return null;
	return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined;
}

export function parse_player_status_total_skill_level(value: unknown): number | null | undefined {
	if (value === null)
		return null;
	return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
}
// #endregion

// #region MAINTENANCE
export function sweep_data_caches() {
	clear_data_caches();
	setTimeout(sweep_data_caches, CACHE_RESET_INTERVAL);
}

export function clear_data_caches() {
	client_activity_writes.clear();
	friend_request_cache.clear();
	gift_cache.clear();
	display_name_cache.clear();
	display_icon_cache.clear();
	market_completed_cached.clear();

	trade_cache.clear();
	trade_player_cache.clear();
	resolved_trade_cache.clear();
}

export function invalidate_client_sessions(client_id: number) {
	for (const [token, session] of client_session_cache)
		if (session.client_id === client_id)
			client_session_cache.delete(token);
}

export function sweep_client_session_cache() {
	const current_time = Date.now();

	for (const [session_token, session] of client_session_cache)
		if (current_time - session.last_access > CACHE_SESSION_LIFETIME)
			client_session_cache.delete(session_token);

	setTimeout(sweep_client_session_cache, CACHE_SESSION_LIFETIME);
}

export function expire_petitions(now = Date.now()): number {
	const expire = db.transaction(() => {
		db.query(
			'UPDATE `guild_petition_winnowing_targets` SET `subject_locked` = 0 WHERE `petition_id` IN (' +
			"SELECT `id` FROM `guild_petitions` WHERE `lifecycle` = 'active' AND `expires_at` <= ?)"
		).run(now);
		return db.query(
			"UPDATE `guild_petitions` SET `lifecycle` = 'lapsed', `resolved_at` = `expires_at`, " +
			"`subject_locked` = 0 WHERE `lifecycle` = 'active' AND `expires_at` <= ?"
		).run(now).changes;
	});
	return expire.immediate();
}

export function unlock_winnowing_targets(petition_id: number) {
	db.query(
		'UPDATE `guild_petition_winnowing_targets` SET `subject_locked` = 0 WHERE `petition_id` = ?'
	).run(petition_id);
}

export function expire_charity_items(now = Date.now(), guild_id?: number): number {
	if (guild_id === undefined)
		return db.query('DELETE FROM `charity_items` WHERE `expires_at` <= ?').run(now).changes;
	return db.query(
		'DELETE FROM `charity_items` WHERE `guild_id` = ? AND `expires_at` <= ?'
	).run(guild_id, now).changes;
}

export function claim_council_action(now = Date.now()): db_row.guild_petitions | null {
	const claim = db.transaction(() => {
		const petition = db.query(
			"SELECT * FROM `guild_petitions` WHERE `lifecycle` = 'granted' " +
			"AND `type` IN ('appellation', 'heraldry', 'banishment', 'winnowing', 'charitree_ingratitude', " +
			"'charitree_sacrilege', 'charitree_beneficence', 'fellowship', 'enclosure') AND (" +
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

export function ensure_banishment_return(
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

export function add_banishment_return_item(return_id: number, item_id: string, qty: number) {
	if (qty <= 0)
		return;
	db.query(
		'INSERT INTO `banishment_return_items` (`return_id`, `item_id`, `qty`) VALUES(?, ?, ?) ' +
		'ON CONFLICT (`return_id`, `item_id`) DO UPDATE SET `qty` = `qty` + excluded.`qty`'
	).run(return_id, item_id, qty);
}

export function apply_banishment_target(
	petition: db_row.guild_petitions,
	target_client_id: number,
	target_membership_id: number
): string {
	const now = Date.now();
	const banish = db.transaction(() => {
		const membership = db.query(
			'SELECT `id` FROM `guild_memberships` WHERE `id` = ? AND `client_id` = ? AND `guild_id` = ? LIMIT 1'
		).get(
			target_membership_id,
			target_client_id,
			petition.guild_id
		) as { id: number } | null;
		if (membership === null)
			return { effect: 'already_absent' as const, dissolved: false, trade_ids: [] as number[] };

		const target_return_id = ensure_banishment_return(petition, target_client_id, true, now);
		const market_items = db.query(
			'SELECT * FROM `market_items` WHERE `client_id` = ? AND `guild_id` = ?'
		).all(target_client_id, petition.guild_id) as db_row.market_items[];
		let gp = 0;
		for (const item of market_items) {
			if (item.direction === 'buy')
				gp += item.escrow_gp;
			else {
				add_banishment_return_item(target_return_id, item.item_id, item.available);
				gp += Math.max((item.qty - item.available) * item.price - item.payout, 0);
			}
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

		record_guild_activity({ guild_id: petition.guild_id, event_type: 'banished', actor_client_id: target_client_id,
			source_key: `petition:${petition.id}:membership:${membership.id}:banished`, created_at: now });
		db.query('DELETE FROM `guild_memberships` WHERE `id` = ?').run(membership.id);
		const remaining = db.query(
			'SELECT COUNT(*) AS `count` FROM `guild_memberships` WHERE `guild_id` = ?'
		).get(petition.guild_id) as { count: number };
		if (remaining.count === 0)
			db.query('DELETE FROM `guilds` WHERE `id` = ?').run(petition.guild_id);

		return {
			effect: 'banished' as const,
			dissolved: remaining.count === 0,
			trade_ids: trades.map(trade => trade.trade_id),
			trade_clients: trades.flatMap(trade => [trade.sender_id, trade.recipient_id])
		};
	});

	const result = banish.immediate();
	for (const trade_id of result.trade_ids)
		trade_cache.delete(trade_id);
	if (result.effect === 'banished') {
		for (const client_id of result.trade_clients)
			trade_player_cache.delete(client_id);
	}
	market_completed_cached.delete(target_client_id);
	if (result.dissolved)
		forget_guild_campaign(petition.guild_id);
	else if (result.effect === 'banished')
		void resize_unprogressed_campaign(petition.guild_id);
	return result.effect;
}

export function apply_banishment_action(petition: db_row.guild_petitions): string {
	return apply_banishment_target(
		petition,
		petition.target_client_id as number,
		petition.target_membership_id as number
	);
}

export function apply_winnowing_action(petition: db_row.guild_petitions): string {
	const targets = db.query(
		'SELECT target.`membership_id`, target.`client_id`, client.`last_multiplayer_active_at` ' +
		'FROM `guild_petition_winnowing_targets` AS target ' +
		'JOIN `clients` AS client ON client.`id` = target.`client_id` ' +
		'WHERE target.`petition_id` = ? ORDER BY target.`membership_id`'
	).all(petition.id) as Array<db_row.guild_petition_winnowing_targets & { last_multiplayer_active_at: number }>;
	const now = Date.now();
	let banished = 0;
	let spared = 0;
	let absent = 0;
	for (const target of targets) {
		const membership = db.query(
			'SELECT 1 FROM `guild_memberships` WHERE `id` = ? AND `client_id` = ? AND `guild_id` = ? LIMIT 1'
		).get(target.membership_id, target.client_id, petition.guild_id);
		if (membership === null) {
			absent++;
			continue;
		}
		if (!is_shadowed(target.last_multiplayer_active_at, now)) {
			spared++;
			continue;
		}
		if (apply_banishment_target(petition, target.client_id, target.membership_id) === 'banished')
			banished++;
		else
			absent++;
	}
	return `banished:${banished};spared:${spared};absent:${absent}`;
}

export function apply_council_guild_action(petition: db_row.guild_petitions): string {
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
	if (petition.type === 'fellowship') {
		const updated = db.query(
			"UPDATE `guilds` SET `type` = 'public' WHERE `id` = ? AND `type` = 'private'"
		).run(petition.guild_id);
		return updated.changes === 1 ? 'opened' : 'already_open_or_absent';
	}
	if (petition.type === 'enclosure') {
		const updated = db.query(
			"UPDATE `guilds` SET `type` = 'private' WHERE `id` = ? AND `type` = 'public'"
		).run(petition.guild_id);
		return updated.changes === 1 ? 'enclosed' : 'already_enclosed_or_absent';
	}
	if (petition.type === 'charitree_ingratitude') {
		const removed = db.query(
			'DELETE FROM `charity_items` WHERE `guild_id` = ? AND `expires_at` <= ?'
		).run(petition.guild_id, petition.charitree_expires_before);
		return removed.changes > 0 ? 'cleared' : 'already_empty';
	}
	if (petition.type === 'charitree_sacrilege') {
		const disable = db.transaction(() => {
			const updated = db.query(
				'UPDATE `guilds` SET `charitree_enabled` = 0 WHERE `id` = ? AND `charitree_enabled` = 1'
			).run(petition.guild_id);
			const removed = db.query('DELETE FROM `charity_items` WHERE `guild_id` = ?').run(petition.guild_id);
			return { updated: updated.changes, removed: removed.changes };
		});
		const result = disable.immediate();
		if (result.updated === 0)
			return 'already_disabled';
		return result.removed > 0 ? 'disabled_and_destroyed' : 'disabled_empty';
	}
	if (petition.type === 'charitree_beneficence') {
		const updated = db.query(
			'UPDATE `guilds` SET `charitree_enabled` = 1 WHERE `id` = ? AND `charitree_enabled` = 0'
		).run(petition.guild_id);
		return updated.changes === 1 ? 'enabled' : 'already_enabled';
	}
	if (petition.type === 'winnowing')
		return apply_winnowing_action(petition);
	return apply_banishment_action(petition);
}

export function process_council_actions(max_actions = 20): number {
	let processed = 0;
	while (processed < max_actions) {
		const petition = claim_council_action();
		if (petition === null)
			break;

		try {
			const effect = apply_council_guild_action(petition);
			const complete = db.transaction(() => {
				db.query(
					"UPDATE `guild_petitions` SET `execution_state` = 'succeeded', `execution_effect` = ?, " +
					'`subject_locked` = 0 WHERE `id` = ? AND `execution_state` = \'running\''
				).run(effect, petition.id);
				unlock_winnowing_targets(petition.id);
			});
			complete.immediate();
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

export function maintain_council() {
	try {
		expire_petitions();
		process_council_actions();
	} catch (error) {
		report_error('Council maintenance failed', error);
	}
	setTimeout(maintain_council, COUNCIL_MAINTENANCE_INTERVAL);
}

export function maintain_charity() {
	try {
		expire_charity_items();
	} catch (error) {
		report_error('Charity maintenance failed', error);
	}
	setTimeout(maintain_charity, CHARITY_MAINTENANCE_INTERVAL);
}

export function execute_due_client_deletions(now = Date.now()) {
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

export function maintain_client_deletions() {
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
maintain_charity();
maintain_client_deletions();
// #endregion

// #region MARKET
export async function market_list_item(guild_id: number, client_id: number, item_id: string, item_qty: number, item_sell_price: number) {
	const lot = await db_get_single(
		'INSERT INTO `market_items` (`guild_id`, `client_id`, `direction`, `item_id`, `qty`, `price`, `available`, `published_at`) VALUES(?, ?, \'sell\', ?, ?, ?, ?, ?) ' +
		'ON CONFLICT (`guild_id`, `client_id`, `direction`, `item_id`, `price`) DO UPDATE SET `qty` = `qty` + excluded.`qty`, ' +
		'`available` = `available` + excluded.`available` RETURNING `id`',
		[guild_id, client_id, item_id, item_qty, item_sell_price, item_qty, Date.now()]
	) as db_row.market_items;

	if (lot !== null)
		remove_player_cache_entry(market_completed_cached, client_id, lot.id);
}

export async function get_market_completed(client_id: number) {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return [];

	const cached = market_completed_cached.get(client_id);
	if (cached)
		return cached;

	const results = await db_get_all(
		'SELECT `id` FROM `market_items` WHERE `guild_id` = ? AND `client_id` = ? AND `direction` = \'sell\' AND `available` = 0',
		[guild_id, client_id]
	) as db_row.market_items[];
	const completed = results.map(row => row.id);

	market_completed_cached.set(client_id, completed);
	return completed;
}
// #endregion

// #region CAMPAIGN
export function empty_guild_campaign(guild_id: number): GuildCampaign {
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

export function forget_guild_campaign(guild_id: number) {
	const campaign = guild_campaigns.get(guild_id);
	if (campaign !== undefined && campaign.restart_timer !== null)
		clearTimeout(campaign.restart_timer);
	guild_campaigns.delete(guild_id);
}

export async function start_new_campaign(guild_id: number): Promise<GuildCampaign | null> {
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
	campaign.required_contributors = get_required_campaign_contributors(
		await get_non_shadowed_member_count(guild_id)
	);
	campaign.item_total = get_campaign_item_total(
		campaign_item.estimated_12h_output,
		campaign.required_contributors
	);
	campaign.item_current = 0;
	campaign.auto_contribution = 0;
	campaign.pct = 0;
	campaign.restart_timer = null;
	campaign.active_id = db.transaction(() => {
		const inserted = db.query(
			'INSERT INTO `campaign_state` ' +
			'(`guild_id`, `campaign_id`, `item_id`, `item_amount`, `required_contributors`) ' +
			'VALUES(?, ?, ?, ?, ?) RETURNING `id`'
		).get(guild_id, campaign.campaign_id, campaign.item_id, campaign.item_total,
			campaign.required_contributors) as { id: number };
		record_guild_activity({ guild_id, event_type: 'campaign_started',
			source_key: `campaign:${inserted.id}:started` });
		return inserted.id;
	}).immediate();
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

export async function update_campaign_progress(campaign: GuildCampaign) {
	campaign.pct = campaign.item_current / campaign.item_total;

	if (campaign.item_current >= campaign.item_total)
		return finalize_campaign(campaign);
}

export function persist_campaign_completion(campaign: GuildCampaign): number | null {
	const completed_id = campaign.active_id;
	if (completed_id === 0)
		return null;

	const next_active_timestamp = Date.now() + CAMPAIGN_RESTART_TIMER;
	const completed = db.query(
		'UPDATE `campaign_state` SET `complete` = 1, `campaign_next` = ? ' +
		'WHERE `id` = ? AND `guild_id` = ? AND `complete` = 0 RETURNING `id`'
	).get(next_active_timestamp, completed_id, campaign.guild_id);
	if (completed === null)
		return null;

	db.query(
		'INSERT INTO `campaign_completions` ' +
		'(`source_campaign_state_id`, `source_guild_id`, `client_id`, `campaign_id`, `item_id`, `item_amount`, `taken`) ' +
		'SELECT state.`id`, state.`guild_id`, contribution.`client_id`, state.`campaign_id`, state.`item_id`, ' +
		'contribution.`item_amount`, contribution.`taken` ' +
		'FROM `campaign_contributions` AS contribution ' +
		'JOIN `campaign_state` AS state ON state.`id` = contribution.`campaign_id` ' +
		'WHERE state.`id` = ? AND state.`complete` = 1 ' +
		'ON CONFLICT (`source_campaign_state_id`, `client_id`) DO NOTHING'
	).run(completed_id);

	return next_active_timestamp;
}

export function apply_campaign_completion(campaign: GuildCampaign, next_active_timestamp: number) {
	campaign.active_id = 0;
	campaign.next_active_timestamp = next_active_timestamp;
	schedule_campaign_restart(campaign);
}

export async function finalize_campaign(campaign: GuildCampaign) {
	const completed_id = campaign.active_id;
	const next_active_timestamp = db.transaction(() => {
		const completed_at = persist_campaign_completion(campaign);
		if (completed_at !== null)
			record_guild_activity({ guild_id: campaign.guild_id, event_type: 'campaign_completed',
				source_key: `campaign:${completed_id}:completed` });
		return completed_at;
	}).immediate();
	if (next_active_timestamp !== null)
		apply_campaign_completion(campaign, next_active_timestamp);
}

export async function load_campaign_state(guild_id: number): Promise<GuildCampaign | null> {
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

export async function ensure_guild_campaign(guild_id: number): Promise<GuildCampaign | null> {
	const cached = guild_campaigns.get(guild_id);
	if (cached !== undefined) {
		if (cached.active_id === 0 && cached.next_active_timestamp <= Date.now())
			return start_new_campaign(guild_id);
		return cached;
	}
	return load_campaign_state(guild_id);
}

export async function resize_unprogressed_campaign(guild_id: number) {
	const campaign = guild_campaigns.get(guild_id);
	if (campaign === undefined || campaign.active_id === 0 || campaign.item_current > 0)
		return;

	const guild = await get_guild_summary(guild_id);
	if (guild === null)
		return;

	const required_contributors = get_required_campaign_contributors(
		await get_non_shadowed_member_count(guild_id)
	);
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

export function schedule_campaign_restart(campaign: GuildCampaign) {
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

export async function get_campaign_progress(client_id: number) {
	const guild_id = await get_client_guild_id(client_id);
	if (guild_id === null)
		return { active: false, pct: 0 };

	const campaign = await ensure_guild_campaign(guild_id);
	return {
		active: (campaign?.active_id ?? 0) > 0,
		pct: campaign?.pct ?? 0
	};
}

export async function add_campaign_auto_progress(campaign: GuildCampaign, item_qty: number) {
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

export async function get_campaign_history(client_id: number) {
	return await db_get_all(
		'SELECT `item_amount`, `taken`, `source_campaign_state_id` AS `id`, `campaign_id`, `item_id` ' +
		'FROM `campaign_completions` ' +
		'WHERE `client_id` = ? ORDER BY `source_campaign_state_id` DESC LIMIT 15',
		[client_id]
	);
}

export async function get_campaign_rankings(client_id: number) {
	const rankings_raw = await db_get_all(
		'SELECT `campaign_id`, COUNT(*) AS `completed` FROM `campaign_completions` ' +
		'WHERE `client_id` = ? GROUP BY `campaign_id`',
		[client_id]
	);
	const rankings = {} as Record<string, number>;
	for (const row of rankings_raw)
		rankings[row.campaign_id] = row.completed;

	return rankings;
}

export async function tick_campaign_baseline_advancement() {
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

export function schedule_campaign_baseline_advancement() {
	setTimeout(() => void tick_campaign_baseline_advancement(), CAMPAIGN_AUTO_ADVANCE_INTERVAL);
}

export async function load_all_campaign_states() {
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
export async function is_friend_code_taken(friend_code: string): Promise<boolean> {
	return db_exists('SELECT 1 FROM `clients` WHERE `friend_code` = ? LIMIT 1', [friend_code]);
}

export function is_valid_friend_code(friend_code: string): boolean {
	return /^[0-9]{3}-[0-9]{3}-[0-9]{3}$/.test(friend_code);
}

export async function generate_friend_code(): Promise<string> {
	const chunk = () => Math.floor(Math.random() * 900) + 100;
	const code = () => chunk() + '-' + chunk() + '-' + chunk();

	let generated_code = code();
	while (await is_friend_code_taken(generated_code))
		generated_code = code();

	return generated_code;
}

export async function get_user_id_from_friend_code(friend_code: string): Promise<number> {
	const user_row = await db_get_single('SELECT `id` FROM `clients` WHERE `friend_code` = ?', [friend_code]) as db_row.clients;
	return user_row?.id ?? -1;
}
// #endregion

// #region DISPLAY NAME FN
export function validate_display_name(display_name: unknown): string {
	return parse_display_name(display_name) ?? DEFAULT_USER_DISPLAY_NAME;
}

export function parse_display_name(display_name: unknown): string | null {
	if (typeof display_name === 'string') {
		const trimmed = display_name.trim();
		if (trimmed.length > 0 && trimmed.length <= 20 && DISPLAY_NAME_PATTERN.test(trimmed))
			return trimmed;
	}
	return null;
}

export async function get_client_display(client_id: number): Promise<ClientDisplayInfo> {
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

export async function get_client_display_icon(client_id: number): Promise<string> {
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

export async function get_client_display_name(client_id: number): Promise<string> {
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
export async function get_client_guild_id(client_id: number): Promise<number | null> {
	const membership = await db_get_single(
		'SELECT `guild_id` FROM `guild_memberships` WHERE `client_id` = ? LIMIT 1',
		[client_id]
	) as db_row.guild_memberships;
	return membership?.guild_id ?? null;
}

export async function guild_membership_exists(client_id_a: number, client_id_b: number): Promise<boolean> {
	return db_exists(
		'SELECT 1 FROM `guild_memberships` AS a JOIN `guild_memberships` AS b ON b.`guild_id` = a.`guild_id` ' +
		'WHERE a.`client_id` = ? AND b.`client_id` = ? LIMIT 1',
		[client_id_a, client_id_b]
	);
}

export async function get_guild_summary(guild_id: number): Promise<GuildSummary | null> {
	const guild = await db_get_single(
		'SELECT g.`id` AS `guild_id`, g.`type`, g.`name`, g.`icon_id`, COUNT(m.`client_id`) AS `member_count` ' +
		'FROM `guilds` AS g LEFT JOIN `guild_memberships` AS m ON m.`guild_id` = g.`id` ' +
		'WHERE g.`id` = ? GROUP BY g.`id`',
		[guild_id]
	) as GuildSummary & { type: GuildType };
	return guild === null ? null : guild_summary_from_row(guild);
}

export function get_guild_member_status_activity(member: GuildMemberRow): PlayerStatusActivity | null {
	if (member.status_visible !== 1 || member.status_available !== 1 || member.status_activity_type === null)
		return null;
	return status_snapshot_activity({
		activity_type: member.status_activity_type,
		activity_skill_id: member.status_activity_skill_id,
		activity_action_id: member.status_activity_action_id,
		activity_area_id: member.status_activity_area_id
	});
}

export function get_guild_member_status_activities(member: GuildMemberRow, activity: PlayerStatusActivity | null): PlayerStatusActiveActivity[] {
	if (member.status_visible !== 1 || member.status_available !== 1 || activity === null || member.status_activities === null)
		return [];
	return status_snapshot_activities({ activities: member.status_activities }, activity);
}

export function guild_member_from_row(member: GuildMemberRow, now = Date.now()) {
	const status_activity = get_guild_member_status_activity(member);
	const account_age = member.status_visible === 1 && member.account_creation_date !== null &&
		Number.isSafeInteger(member.account_creation_date) && member.account_creation_date > 0
		? Math.max(0, now - member.account_creation_date)
		: null;
	return {
		client_id: member.client_id,
		display_name: member.display_name,
		icon_id: member.icon_id,
		equipment_visible: member.equipment_visible === 1,
		equipment_available: member.equipment_available === 1,
		status_visible: member.status_visible === 1,
		status_available: member.status_available === 1,
		status_activity,
		status_activities: get_guild_member_status_activities(member, status_activity),
		account_age,
		total_skill_level: member.status_visible === 1 && member.total_skill_level !== null &&
			Number.isSafeInteger(member.total_skill_level) && member.total_skill_level >= 0
			? member.total_skill_level : null,
		gp_visible: member.gp_visible === 1,
		gp: member.gp_visible === 1 ? member.gp_amount : null,
		game_mode_visible: member.game_mode_visible === 1,
		game_mode_id: member.game_mode_visible === 1 ? member.game_mode_id : null,
		active_mods_visible: member.active_mods_visible === 1,
		active_mods_available: member.active_mods_visible === 1 && member.active_mods_available === 1,
		language: member.language,
		last_seen_at: member.last_multiplayer_active_at > 0 ? member.last_multiplayer_active_at : null,
		joined_at: member.joined_at !== null && member.joined_at > 0 ? member.joined_at : null
	};
}

export async function get_guild_members(guild_id: number, shadowed = false, now = Date.now()) {
	const cutoff = shadowed_cutoff(now);
	const activity_filter = shadowed
		? ' AND (c.`last_multiplayer_active_at` = 0 OR c.`last_multiplayer_active_at` < ?)'
		: ' AND c.`last_multiplayer_active_at` >= ?';
	const members = await db_get_all(
		'SELECT c.`id` AS `client_id`, c.`display_name`, c.`icon_id`, ' +
		'c.`equipment_visible`, ' +
		'EXISTS(SELECT 1 FROM `equipment_snapshots` AS es WHERE es.`client_id` = c.`id`) AS `equipment_available`, ' +
		'c.`status_visible`, ' +
		'EXISTS(SELECT 1 FROM `status_snapshots` AS available_ss WHERE available_ss.`client_id` = c.`id`) AS `status_available`, ' +
		'ss.`activity_type` AS `status_activity_type`, ss.`activity_skill_id` AS `status_activity_skill_id`, ' +
		'ss.`activity_action_id` AS `status_activity_action_id`, ss.`activity_area_id` AS `status_activity_area_id`, ss.`activities` AS `status_activities`, ' +
		'ss.`account_creation_date`, ss.`total_skill_level`, ' +
		'c.`gp_visible`, gps.`amount` AS `gp_amount`, c.`game_mode_visible`, runtime.`game_mode_id`, ' +
		'c.`active_mods_visible`, (runtime.`active_mods` IS NOT NULL AND runtime.`active_mods` <> \'[]\') AS `active_mods_available`, ' +
		'runtime.`language`, ' +
		'c.`last_multiplayer_active_at`, joined_activity.`created_at` AS `joined_at` ' +
		'FROM `guild_memberships` AS m ' +
		'JOIN `clients` AS c ON c.`id` = m.`client_id` ' +
		'LEFT JOIN `status_snapshots` AS ss ON ss.`client_id` = c.`id` ' +
		'LEFT JOIN `gp_snapshots` AS gps ON gps.`client_id` = c.`id` ' +
		'LEFT JOIN `client_runtime_snapshots` AS runtime ON runtime.`client_id` = c.`id` ' +
		'LEFT JOIN `guild_activity_events` AS joined_activity ON joined_activity.`guild_id` = m.`guild_id` ' +
			"AND joined_activity.`source_key` = 'membership:' || m.`id` || ':joined' " +
		'WHERE m.`guild_id` = ?' + activity_filter + ' ' +
		'ORDER BY c.`last_multiplayer_active_at` DESC, c.`display_name` COLLATE NOCASE, c.`id`',
		[guild_id, cutoff]
	) as GuildMemberRow[];
	return members.map(member => guild_member_from_row(member, now));
}

export async function get_guild_member_directory(
	guild_id: number,
	page: number,
	search: string,
	shadowed = false,
	now = Date.now()
) {
	const escaped_search = search.replace(/[\\%_]/g, '\\$&');
	const search_pattern = `%${escaped_search}%`;
	const cutoff = shadowed_cutoff(now);
	const activity_filter = shadowed
		? ' AND (c.`last_multiplayer_active_at` = 0 OR c.`last_multiplayer_active_at` < ?)'
		: ' AND c.`last_multiplayer_active_at` >= ?';
	const [members, count] = await Promise.all([
			db_get_all(
				'SELECT c.`id` AS `client_id`, c.`display_name`, c.`icon_id`, ' +
				'c.`equipment_visible`, ' +
				'EXISTS(SELECT 1 FROM `equipment_snapshots` AS es WHERE es.`client_id` = c.`id`) AS `equipment_available`, ' +
				'c.`status_visible`, ' +
				'EXISTS(SELECT 1 FROM `status_snapshots` AS available_ss WHERE available_ss.`client_id` = c.`id`) AS `status_available`, ' +
				'ss.`activity_type` AS `status_activity_type`, ss.`activity_skill_id` AS `status_activity_skill_id`, ' +
				'ss.`activity_action_id` AS `status_activity_action_id`, ss.`activity_area_id` AS `status_activity_area_id`, ss.`activities` AS `status_activities`, ' +
				'ss.`account_creation_date`, ss.`total_skill_level`, ' +
				'c.`gp_visible`, gps.`amount` AS `gp_amount`, c.`game_mode_visible`, runtime.`game_mode_id`, ' +
				'c.`active_mods_visible`, (runtime.`active_mods` IS NOT NULL AND runtime.`active_mods` <> \'[]\') AS `active_mods_available`, ' +
				'runtime.`language`, ' +
				'c.`last_multiplayer_active_at`, joined_activity.`created_at` AS `joined_at` ' +
			'FROM `guild_memberships` AS m JOIN `clients` AS c ON c.`id` = m.`client_id` ' +
			'LEFT JOIN `status_snapshots` AS ss ON ss.`client_id` = c.`id` ' +
			'LEFT JOIN `gp_snapshots` AS gps ON gps.`client_id` = c.`id` ' +
			'LEFT JOIN `client_runtime_snapshots` AS runtime ON runtime.`client_id` = c.`id` ' +
			'LEFT JOIN `guild_activity_events` AS joined_activity ON joined_activity.`guild_id` = m.`guild_id` ' +
				"AND joined_activity.`source_key` = 'membership:' || m.`id` || ':joined' " +
			'WHERE m.`guild_id` = ? AND LOWER(c.`display_name`) LIKE LOWER(?) ESCAPE \'\\\'' + activity_filter + ' ' +
			'ORDER BY c.`last_multiplayer_active_at` DESC, c.`display_name` COLLATE NOCASE, c.`id` ' +
			'LIMIT ? OFFSET ?',
			[guild_id, search_pattern, cutoff, GUILD_MEMBER_PAGE_SIZE, page * GUILD_MEMBER_PAGE_SIZE]
		),
		db_get_single(
			' SELECT COUNT(*) AS `count` FROM `guild_memberships` AS m ' +
			'JOIN `clients` AS c ON c.`id` = m.`client_id` ' +
			'WHERE m.`guild_id` = ? AND LOWER(c.`display_name`) LIKE LOWER(?) ESCAPE \'\\\'' + activity_filter,
			[guild_id, search_pattern, cutoff]
		)
	]);

	return {
		members: (members as GuildMemberRow[]).map(member => guild_member_from_row(member, now)),
		page,
		page_size: GUILD_MEMBER_PAGE_SIZE,
		search,
		total: count?.count ?? 0,
		has_more: (page + 1) * GUILD_MEMBER_PAGE_SIZE < (count?.count ?? 0)
	};
}

export async function get_non_shadowed_member_count(guild_id: number, now = Date.now()): Promise<number> {
	const row = await db_get_single(
		'SELECT COUNT(*) AS `count` FROM `guild_memberships` AS m ' +
		'JOIN `clients` AS c ON c.`id` = m.`client_id` ' +
		'WHERE m.`guild_id` = ? AND c.`last_multiplayer_active_at` >= ?',
		[guild_id, shadowed_cutoff(now)]
	);
	return row?.count ?? 0;
}

export async function get_guild_type(guild_id: number): Promise<GuildType | null> {
	const guild = await db_get_single('SELECT `type` FROM `guilds` WHERE `id` = ? LIMIT 1', [guild_id]) as {
		type: GuildType;
	} | null;
	return guild?.type ?? null;
}

export async function get_guild_applicants(client_id: number) {
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

export async function has_guild_departure_blocker(client_id: number): Promise<boolean> {
	const blockers = await db_get_single(
		'SELECT ' +
		'EXISTS(SELECT 1 FROM `market_items` WHERE `client_id` = ?) OR ' +
		'EXISTS(SELECT 1 FROM `gifts` WHERE `client_id` = ? OR (`sender_id` = ? AND (`flags` & ?) = 0)) OR ' +
		'EXISTS(SELECT 1 FROM `trade_offers` WHERE `sender_id` = ? OR `recipient_id` = ?) OR ' +
		'EXISTS(SELECT 1 FROM `resolved_trade_offers` WHERE `client_id` = ?) AS `blocked`',
		[client_id, client_id, client_id, GiftFlags.Returned, client_id, client_id, client_id]
	);
	return blockers?.blocked === 1;
}

export function petition_to_player_view(row: CouncilPetitionRow, client_id: number) {
	const active = row.lifecycle === 'active';
	const tally_visible = !active || (row.is_eligible === 1 && row.current_vote !== null);
	let proposal: JsonSerializable;
	if (row.type === 'appellation')
		proposal = { name: row.proposed_name as string };
	else if (row.type === 'heraldry')
		proposal = { icon_id: row.proposed_icon_id as string };
	else if (row.type === 'banishment')
		proposal = {
			target: {
				client_id: row.target_client_id as number,
				display_name: row.target_display_name as string,
				icon_id: row.target_icon_id as string
			}
		};
	else if (row.type === 'winnowing')
		proposal = { target_count: row.winnowing_target_count };
	else
		proposal = {};

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

export async function get_council_petitions(guild_id: number, client_id: number, resolved_page: number) {
	const select =
		'SELECT p.*, target.`display_name` AS `target_display_name`, target.`icon_id` AS `target_icon_id`, ' +
		'(SELECT COUNT(*) FROM `guild_petition_winnowing_targets` WHERE `petition_id` = p.`id`) AS `winnowing_target_count`, ' +
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

	const guild = await db_get_single(
		'SELECT g.`type`, g.`charitree_enabled`, EXISTS(SELECT 1 FROM `charity_items` WHERE `guild_id` = g.`id`) ' +
			'AS `has_items`, EXISTS(SELECT 1 FROM `guild_memberships` AS membership ' +
			'JOIN `clients` AS client ON client.`id` = membership.`client_id` ' +
			'WHERE membership.`guild_id` = g.`id` AND client.`last_multiplayer_active_at` < ?) AS `has_shadowed` ' +
			'FROM `guilds` AS g WHERE g.`id` = ? LIMIT 1',
		[shadowed_cutoff(), guild_id]
	) as { type: GuildType; charitree_enabled: number; has_items: number; has_shadowed: number } | null;
	const available_petition_types: PetitionType[] = ['appellation', 'heraldry', 'banishment'];
	if (guild?.has_shadowed === 1)
		available_petition_types.push('winnowing');
	if (guild?.type === 'private')
		available_petition_types.push('fellowship');
	else if (guild?.type === PUBLIC_GUILD_TYPE)
		available_petition_types.push('enclosure');
	if (guild?.charitree_enabled === 1) {
		available_petition_types.push('charitree_sacrilege');
		if (guild.has_items === 1)
			available_petition_types.push('charitree_ingratitude');
	} else if (guild?.charitree_enabled === 0) {
		available_petition_types.push('charitree_beneficence');
	}

	return {
		petitions: [...active, ...resolved.slice(0, COUNCIL_HISTORY_PAGE_SIZE)].map(row =>
			petition_to_player_view(row, client_id)
		),
		available_petition_types,
		resolved_page,
		has_more: resolved.length > COUNCIL_HISTORY_PAGE_SIZE
	};
}

export function get_banishment_claim_view(claim_id: string, client_id: number) {
	const claim = db.query(
		'SELECT claim.*, returned.`guild_name` FROM `banishment_return_claims` AS claim ' +
		'JOIN `banishment_returns` AS returned ON returned.`id` = claim.`return_id` ' +
		'WHERE claim.`id` = ? AND claim.`client_id` = ? AND claim.`acknowledged_at` IS NULL LIMIT 1'
	).get(claim_id, client_id) as (db_row.banishment_return_claims & { guild_name: string }) | null;
	if (claim === null)
		return null;

	const items: JsonObject[] = db.query<{ id: string; qty: number }, [string]>(
		'SELECT `item_id` AS `id`, `qty` FROM `banishment_return_claim_items` WHERE `claim_id` = ? ORDER BY `item_id`'
	).all(claim_id).map(item => ({ id: item.id, qty: item.qty }));
	return {
		claim_id: claim.id,
		items,
		gp: claim.gp,
		banished: claim.includes_notice === 1 ? { guild_name: claim.guild_name } : null
	};
}

export function create_banishment_claim(
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
export async function get_friend_requests(client_id: number): Promise<FriendRequest[]> {
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

export async function friend_request_exists(client_id: number, friend_id: number): Promise<boolean> {
	return await db_exists('SELECT 1 FROM `friend_requests` WHERE `client_id` = ? AND `friend_id` = ?', [client_id, friend_id]);
}

export async function create_friend_request(client_id: number, friend_id: number) {
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

export async function get_friend_request(request_id: number): Promise<db_row.friend_requests> {
	return await db_get_single('SELECT `request_id`, `client_id`, `friend_id` FROM `friend_requests` WHERE `request_id` = ?', [request_id]) as db_row.friend_requests;
}

export async function delete_friend_request(request: db_row.friend_requests) {
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
export async function friendship_exists(client_id_a: number, client_id_b: number): Promise<boolean> {
	const low_id = Math.min(client_id_a, client_id_b);
	const high_id = Math.max(client_id_a, client_id_b);
	return await db_exists('SELECT 1 FROM `friends` WHERE `client_id_a` = ? AND `client_id_b` = ?', [low_id, high_id]);
}

export function accept_friend_request(client_id: number, request_id: number): number | null {
	const accept = db.transaction(() => {
		const request = db.query<db_row.friend_requests, [number, number]>(
			'SELECT `request_id`, `client_id`, `friend_id` FROM `friend_requests` ' +
			'WHERE `request_id` = ? AND `client_id` = ?'
		).get(request_id, client_id);
		if (request === null)
			return null;

		const low_id = Math.min(request.client_id, request.friend_id);
		const high_id = Math.max(request.client_id, request.friend_id);
		db.query(
			'INSERT INTO `friends` (`client_id_a`, `client_id_b`) VALUES(?, ?) ' +
			'ON CONFLICT (`client_id_a`, `client_id_b`) DO NOTHING'
		).run(low_id, high_id);
		db.query(
			'DELETE FROM `friend_requests` WHERE (`client_id` = ? AND `friend_id` = ?) ' +
			'OR (`client_id` = ? AND `friend_id` = ?)'
		).run(low_id, high_id, high_id, low_id);
		return request.friend_id;
	});

	const friend_id = accept.immediate();
	if (friend_id !== null) {
		friend_request_cache.delete(client_id);
		friend_request_cache.delete(friend_id);
	}
	return friend_id;
}

export async function get_friends(client_id: number) {
	return await db_get_all('SELECT c.`id` AS `friend_id`, c.`display_name`, c.`icon_id` FROM `friends` JOIN `clients` AS c ON c.`id` = CASE WHEN `client_id_a` = ? THEN `client_id_b` ELSE `client_id_a` END WHERE `client_id_a` = ? OR `client_id_b` = ?', [client_id, client_id, client_id]);
}

export async function delete_friend(client_id: number, friend_id: number) {
	const low_id = Math.min(client_id, friend_id);
	const high_id = Math.max(client_id, friend_id);
	await db_execute('DELETE FROM `friends` WHERE `client_id_a` = ? AND `client_id_b` = ?', [low_id, high_id]);
}
// #endregion

// #region GIFT FN
export async function get_gift(gift_id: number) {
	return await db_get_single('SELECT * FROM `gifts` WHERE `gift_id` = ? LIMIT 1', [gift_id]) as db_row.gifts;
}

export async function get_gift_items(gift_id: number) {
	return await db_get_all('SELECT `id`, `item_id`, `qty` FROM `gift_items` WHERE `gift_id` = ?', [gift_id]) as db_row.gift_items[];
}

export async function get_client_gifts(client_id: number) {
	const cached_entries = gift_cache.get(client_id);
	if (cached_entries)
		return cached_entries;

	const result = await db_get_all('SELECT `gift_id` FROM `gifts` WHERE `client_id` = ?', [client_id]) as db_row.gifts[];
	const gift_ids = result.map(row => row?.gift_id) as number[];

	gift_cache.set(client_id, gift_ids);

	return gift_ids;
}

export async function return_gift(gift: db_row.gifts) {
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
export async function get_client_trades(client_id: number) {
	const cached_entries = trade_player_cache.get(client_id);
	if (cached_entries)
		return cached_entries;

	const result = await db_get_all('SELECT `trade_id` FROM `trade_offers` WHERE `sender_id` = ? OR `recipient_id` = ?', [client_id, client_id]) as db_row.trade_offers[];
	const trade_ids = result.map(row => row?.trade_id) as number[];

	trade_player_cache.set(client_id, trade_ids);

	return trade_ids;
}

export async function get_trade_offer_meta(trade_id: number) {
	const cached = trade_cache.get(trade_id);
	if (cached)
		return cached;

	const result = await db_get_single('SELECT `attending_id`, `state` FROM `trade_offers` WHERE `trade_id` = ?', [trade_id]) as db_row.trade_offers;

	if (result)
		trade_cache.set(trade_id, result as ActiveTrade);

	return result;
}

export async function get_trade_offer(trade_id: number) {
	return await db_get_single('SELECT * FROM `trade_offers` WHERE `trade_id` = ? LIMIT 1', [trade_id]) as db_row.trade_offers;
}

export async function get_resolved_trade_offer(trade_id: number) {
	return await db_get_single('SELECT * FROM `resolved_trade_offers` WHERE `trade_id` = ? LIMIT 1', [trade_id]) as db_row.resolved_trade_offers;
}

export async function get_trade_items(trade_id: number) {
	return await db_get_all('SELECT `id`, `item_id`, `qty`, `counter` FROM `trade_items` WHERE `trade_id` = ?', [trade_id]) as db_row.gift_items[];
}

export async function create_resolved_trade(trade_id: number, client_id: number, sender_id: number, declined: boolean) {
	await db_execute(
		'INSERT INTO `resolved_trade_offers` (trade_id, client_id, sender_id, declined) VALUES(?, ?, ?, ?)',
		[trade_id, client_id, sender_id, declined ? 1 : 0]
	);

	resolved_trade_cache.get(client_id)?.push(trade_id);
}

export async function get_client_resolved_trades(client_id: number) {
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
// Short-lived, bounded hashes explain replacement without retaining old bearer tokens or enabling replay.
const replaced_sessions = new Map<string, { client_id: number; at: number; device: DeviceDiagnostics | null }>();
function session_digest(token: string): string { return createHash('sha256').update(token).digest('hex'); }
function remember_replaced_sessions(client_id: number, installation_id: string | null, except_token = ''): void {
	const now = Date.now();
	for (const [key, value] of replaced_sessions)
		if (now - value.at >= 60 * 60 * 1000) replaced_sessions.delete(key);
	for (const row of db.query<{ session_token: string; device_diagnostics: string | null }, [number, string | null, string]>(
		'SELECT session_token, device_diagnostics FROM client_sessions WHERE client_id = ? AND installation_id IS ? AND session_token != ? LIMIT 64'
	).all(client_id, installation_id, except_token)) {
		replaced_sessions.set(session_digest(row.session_token), { client_id, at: now,
			device: row.device_diagnostics ? parse_device_diagnostics(JSON.parse(row.device_diagnostics)) : null });
	}
	while (replaced_sessions.size > 4096) replaced_sessions.delete(replaced_sessions.keys().next().value!);
}

export function bind_installation_session(client_id: number, installation_id: string, token: string): void {
	db.transaction(() => {
		remember_replaced_sessions(client_id, installation_id, token);
		db.query('DELETE FROM client_sessions WHERE client_id = ? AND installation_id = ? AND session_token != ?')
			.run(client_id, installation_id, token);
		db.query('UPDATE client_sessions SET installation_id = ? WHERE session_token = ? AND client_id = ?')
			.run(installation_id, token, client_id);
	}).immediate();
}

export async function generate_session_token(client_id: number, mod_version: string | null, device: DeviceDiagnostics | null = null, installation_id: string | null = null): Promise<string> {
	return db.transaction(() => {
		remember_replaced_sessions(client_id, installation_id);
		db.query('DELETE FROM `client_sessions` WHERE `client_id` = ? AND installation_id IS ?').run(client_id, installation_id);
		for (const [session_token, session] of client_session_cache)
			if (session.client_id === client_id)
				client_session_cache.delete(session_token);

		const session_token = crypto.randomUUID();
		db.query(
			'INSERT INTO `client_sessions` (`session_token`, `client_id`, `mod_version`, `device_diagnostics`, `installation_id`) VALUES(?, ?, ?, ?, ?)'
		).run(session_token, client_id, mod_version, device ? JSON.stringify(device) : null, installation_id);
		client_session_cache.set(session_token, { client_id, mod_version, device_diagnostics: device, last_access: Date.now() });
		if (device) {
			// Diagnostic churn must never prevent a player from authenticating or grow storage without bound.
			db.query(`INSERT INTO client_installations
				(client_id, installation_id, device_diagnostics, mod_version, first_seen_at, last_seen_at)
				SELECT ?, ?, ?, ?, ?, ? WHERE
				EXISTS (SELECT 1 FROM client_installations WHERE client_id = ? AND installation_id = ?)
				OR (SELECT COUNT(*) FROM client_installations WHERE client_id = ?) < 32
				ON CONFLICT (client_id, installation_id) DO UPDATE SET
				device_diagnostics=excluded.device_diagnostics, mod_version=excluded.mod_version,
				last_seen_at=excluded.last_seen_at`).run(client_id, device.installation_id, JSON.stringify(device),
				mod_version, Date.now(), Date.now(), client_id, device.installation_id, client_id);
		}

		return session_token;
	}).immediate();
}

export async function get_client_session(session_token: unknown): Promise<CachedSession | null> {
	if (typeof session_token !== 'string')
		return null;

	const cached_session = client_session_cache.get(session_token);
	if (cached_session !== undefined) {
		if (!await db_exists(
			'SELECT 1 FROM `client_sessions` s JOIN `clients` c ON c.id=s.client_id ' +
			'WHERE s.session_token = ? AND c.disabled = 0 AND c.deleted_at IS NULL',
			[session_token]
		)) {
			client_session_cache.delete(session_token);
			return null;
		}

		cached_session.last_access = Date.now();
		return cached_session;
	}

	const session_row = await db_get_single(
		'SELECT session.`client_id`, session.`mod_version`, session.`device_diagnostics` FROM `client_sessions` AS session ' +
		'JOIN `clients` AS client ON client.`id` = session.`client_id` ' +
		'WHERE session.`session_token` = ? AND client.`disabled` = 0 AND client.`deleted_at` IS NULL',
		[session_token]
	) as db_row.client_sessions;
	const client_id = session_row?.client_id ?? -1;

	if (client_id > -1) {
		const session = {
			client_id,
			mod_version: session_row?.mod_version ?? null,
			device_diagnostics: session_row?.device_diagnostics ? parse_device_diagnostics(JSON.parse(session_row.device_diagnostics)) : null,
			last_access: Date.now()
		};
		client_session_cache.set(session_token, session);
		return session;
	}

	return null;
}

export function validate_session_request(handler: SessionRequestHandler, json_body: boolean = false) {
	return async (req: Request, url: URL) => {
		let json = null;

		if (json_body) {
			const result = await read_json_request(req);
			if ('response' in result)
				return result.response;
			json = result.json;
		}

		const x_session_token = req.headers.get('X-Session-Token');
		const session = await get_client_session(x_session_token);

		if (session === null) {
			const replaced = typeof x_session_token === 'string' && x_session_token.length <= 128
				? replaced_sessions.get(session_digest(x_session_token)) : undefined;
			if (replaced && Date.now() - replaced.at < 60 * 60 * 1000) {
				mark_rejection(req, 'session_replaced');
				identify_request(req, replaced.client_id, undefined, replaced.device);
				return new Response('Unauthorized', { status: 401, headers: { 'X-Multiplayer-Session-State': 'replaced' } });
			}
			mark_rejection(req, 'invalid_session');
			return 401; // Unauthorized
		}

		const client_id = session.client_id;
		identify_request(req, client_id, session.mod_version ?? undefined, session.device_diagnostics);
		const limited = request_limits.limit_identity(client_id);
		if (limited !== null) {
			mark_rejection(req, 'identity_rate_limit');
			return limited;
		}

		const now = Date.now();
		if (now - (client_activity_writes.get(client_id) ?? 0) >= CLIENT_ACTIVITY_WRITE_INTERVAL) {
			db.query('UPDATE `clients` SET `last_multiplayer_active_at` = ? WHERE `id` = ?')
				.run(now, client_id);
			client_activity_writes.set(client_id, now);
		}
		return handler(req, url, client_id, json as JsonObject);
	};
}

export function session_get_route(route: string, handler: SessionRequestHandler) {
	server.route(
		route,
		allow_browser_access(require_source_capacity(require_service_available(validate_session_request(handler)))),
		['GET', 'OPTIONS']
	);
	// Android runtimes can fail authenticated GETs after a successful preflight.
	// The POST alias uses the same read handler and all normal request guards.
	session_post_route(route, handler);
}

export function session_post_route(route: string, handler: SessionRequestHandler) {
	server.route(
		route,
		allow_browser_access(require_source_capacity(require_service_available(validate_session_request(handler, true)))),
		['POST', 'OPTIONS']
	);
}

export function session_binary_post_route(route: string, handler: SessionBinaryRequestHandler) {
	server.route(
		route,
		allow_browser_access(require_source_capacity(require_service_available(validate_session_request(handler)))),
		['POST', 'OPTIONS']
	);
}
// #endregion
