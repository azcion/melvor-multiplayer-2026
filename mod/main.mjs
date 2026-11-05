// #region CONSTANTS
const SERVER_HOST = 'http://127.0.0.1:3000';
const SERVER_INSTANCE_STORAGE_PREFIX = 'instance:local-mac:';
const SERVER_INSTANCE_STORAGE_LEGACY_PREFIXES = [];
const MOD_VERSION = 'development';
const UPDATES_LAST_SEEN_MOD_VERSION_KEY = 'updates_last_seen_mod_version';
const LOCAL_MOD_CHARACTER_STORAGE_PREFIX = 'mp:local-character:';
const LEGACY_LOCAL_MOD_CHARACTER_STORAGE_PREFIX = 'kru-melvor-multiplayer:local-character:';
const SERVER_SCOPED_LEGACY_STORAGE_KEYS = [
	'pending_banishment_guild_name',
	'processed_banishment_claim_ids',
	'processed_inbox_claim_ids',
	'processed_economy_receipt_ids',
	'processed_raid_cache_ids',
	'raid_terminal_result',
	'transfer_inventory'
];
const LOG_PREFIX = '[multiplayer] ';

const IS_DEV_MODE = false;
const DEV_CHARACTER_STORAGE = Object.create(null);

const TRANSFER_INVENTORY_MAX_LIMIT = 6;
const ECONOMY_RECEIPT_PAGE_SIZE = 64;
const GIFT_FLAG_RETURNED = 1 << 0;

const CRUCIBLE_CLOCK_INTERVAL = 30 * 1000; // 30 seconds
const CRUCIBLE_GUIDE_STEPS = [
	['06-meld-flow', 'MOD_MP_CRUCIBLE_GUIDE_MELD_TITLE', 'MOD_MP_CRUCIBLE_GUIDE_MELD_DESCRIPTION'],
	['01-cast-menu', 'MOD_MP_CRUCIBLE_GUIDE_OFFER_TITLE', 'MOD_MP_CRUCIBLE_GUIDE_OFFER_DESCRIPTION'],
	['02-cast-quantity', 'MOD_MP_CRUCIBLE_GUIDE_CAST_TITLE', 'MOD_MP_CRUCIBLE_GUIDE_CAST_DESCRIPTION'],
	['03-offering', 'MOD_MP_CRUCIBLE_GUIDE_HEAT_TITLE', 'MOD_MP_CRUCIBLE_GUIDE_HEAT_DESCRIPTION'],
	['04-choose-wish', 'MOD_MP_CRUCIBLE_GUIDE_CHOOSE_TITLE', 'MOD_MP_CRUCIBLE_GUIDE_CHOOSE_DESCRIPTION'],
	['05-wish-quantity', 'MOD_MP_CRUCIBLE_GUIDE_QUANTITY_TITLE', 'MOD_MP_CRUCIBLE_GUIDE_QUANTITY_DESCRIPTION'],
	['07-forming', 'MOD_MP_CRUCIBLE_GUIDE_WAIT_TITLE', 'MOD_MP_CRUCIBLE_GUIDE_WAIT_DESCRIPTION'],
	['08-claim-wish', 'MOD_MP_CRUCIBLE_GUIDE_CLAIM_TITLE', 'MOD_MP_CRUCIBLE_GUIDE_CLAIM_DESCRIPTION'],
	['09-collect', 'MOD_MP_CRUCIBLE_GUIDE_COLLECT_TITLE', 'MOD_MP_CRUCIBLE_GUIDE_COLLECT_DESCRIPTION']
];
const EXPEDITION_CLOCK_INTERVAL = 30 * 1000;
const EXPEDITION_STATE_REFRESH_INTERVAL = 30 * 1000;
const EXPEDITION_AUTO_CHECK_IN_INTERVAL = 10 * 60_000;
const EXPEDITION_VOTE_COOLDOWN = 1000;
const EXPEDITION_CHECK_IN_COOLDOWN = 10 * 1000;

const MARKET_ITEMS_PER_PAGE = 30;
const MARKET_FILTER_ITEMS_LIMIT = 24;
const MARKET_FILTER_EXCLUDED_ITEM_IDS = new Set(['melvorItA:Unknown_Chest']);
const EQUIPMENT_SYNC_DELAY = 150;
const STATUS_SYNC_DELAY = 150;
const STATUS_MIN_SYNC_INTERVAL = 10 * 1000;
const STATUS_OBSERVER_INTERVAL = 1000;
const GUILD_STATE_FRESHNESS = 15 * 1000;
const GUILD_CHAT_CAPABILITY = 'guild-chat-v1';
const GLOBAL_CHAT_CAPABILITY = 'global-chat-v1';
const POLLS_CAPABILITY = 'polls-v1';
const CHAT_CAPABILITIES = GUILD_CHAT_CAPABILITY + ',' + GLOBAL_CHAT_CAPABILITY + ',' + POLLS_CAPABILITY;
const SUPPORT_TEAM_ICON_ASSETS = Object.freeze({
	multiplayer: 'multiplayer.svg',
	sae_support: 'sae_support.png'
});
const DEFAULT_AVATAR_ICON_ID = 'melvorD:Plant';
const DEFAULT_AVATAR_PROMPT_STORAGE_KEY = 'default_avatar_prompt_shown';
const OWNED_DLC_STATUS_CLASSES = Object.freeze({
	melvorTotH: 'text-toth',
	melvorAoD: 'text-aod',
	melvorItA: 'text-ita'
});
const OFFICIAL_GAME_NAMESPACES = new Set([
	'melvorD',
	'melvorF',
	'melvorAoD',
	'melvorTotH',
	'melvorItA'
]);
const MULTIPLAYER_GAME_NAMESPACE = 'multiplayer';
// #endregion

// #region GLOBALS
const ctx = mod.getContext(import.meta);
let get_mod_asset_url;

let session_token = null;
let session_generation = 0;
const API_GET_CACHE_NONCE = crypto.randomUUID();
let api_get_request_sequence = 0;
let is_connecting = false;
let client_event_poll_id = 0;
let client_event_request = null;
let client_event_trailing = false;
let client_event_revision = 0;
let client_events_have_pending = false;
let client_event_poll_failures = 0;
let client_event_scheduled_checks = 0;
let market_search_generation = 0;
let market_haggles_update_request = null;
let market_haggles_update_requested = false;
let guild_state_refresh_id = 0;
let guild_state_refresh_request = null;
let guild_state_refreshed_at = 0;
let guild_page_visible = false;
let council_clock_timer = null;
let inbox_update_request = null;
let server_host = SERVER_HOST;
let server_instance_storage_prefix = SERVER_INSTANCE_STORAGE_PREFIX;
let server_instance_storage_legacy_prefixes = SERVER_INSTANCE_STORAGE_LEGACY_PREFIXES;
let server_settings_section = null;
let combat_settings_section = null;
let resolve_server_config = null;
let get_custom_server_validation_error = null;
let custom_server_max_length = null;
let modal_queue_guard = null;
let modal_component_registry = null;
let polling = null;
let service_availability = null;
let service_module = null;
let chat_items = null;
let open_transfer_page = null;
let request_scheduler = null;
let read_cache = null;
let unavailable_guild_previews = new Set();
let guild_preview_scope = null;
let page_snapshots_supported = false;
let transfer_history_refresh_timer = null;
let events_refreshed_at = 0;
let last_events_result = null;
let guild_revision_scope = null;
let last_guild_revision = null;
const CACHED_READS = new Set(['/api/inbox', '/api/market/haggles', '/api/guilds/state', '/api/alliances',
	'/api/guilds/council?page=0', '/api/guilds/members/shadowed?page=0&search=', '/api/guilds/activity', '/api/guilds/list',
	...['inbox', 'outbox', 'pending'].map(pane => `/api/transfers/history?pane=${pane}`)]);
let transfer_history_module = null;
let load_transfer_history = null;
let transfer_history_refresh_running = false;
let transfer_history_refresh_pending = false;
let remove_sold_out_market_result = null;
let get_market_page_window = null;
let sort_market_filter_items = null;
let apply_banishment_claim = null;
let apply_inbox_claim = null;
let combat_arena = null;
let combat_inventory = null;
let equipment_evidence = null;
let combat_page_visible = false;
let load_inbox_delivery_state = null;
let forget_inbox_claim = null;
let get_inbox_existing_item_ids = null;
let load_transfer_delivery_state = null;
let replace_transfer_delivery_inventory = null;
let trade_returns = null;
let transfer_inventory = null;
let item_visibility = null;
let crucible_rules = null;
let client_runtime = null;
let equipment_catalog_cache = null;
let loaded_save_tracker = null;
let offline_work_gate = null;
let connection_diagnostics = null;
let installation_store = null;
let transport_diagnostics = null;
let installation_credentials = null;
let connected_backend_version = null;
let game_mode_sharing = null;
let localization = null;
let status_activities = null;
let expedition_tasks = null;
let expedition_view = null;
let expedition_leaderboard = null;
let status_statistics = null;
let icon_catalog_discovery = null;
let icon_catalog_collection = null;
let economy_receipts = null;
let economy_receipt_review_module = null;
let economy_receipt_reviews = null;
let identity_bindings = null;
let identity_bootstrap = null;
let identity_registration_supported = false;
let active_identity_credentials = null;
let instance_storage = null;
let social_mode = null;
let social_mode_change_request = Promise.resolve();
const acknowledged_economy_receipt_ids = [];
let is_reconciling_banishment_returns = false;
let event_snapshots = null;
let gift_contents = null;
let changelog_loader = null;
let updates_loader = null;
let transfer_delivery_state = null;
let inbox_delivery_state = null;
let economy_receipt_reconciliation = Promise.resolve(true);
let transfer_currency_support = null;
let market_fulfillment_notice_queue = [];
let market_fulfillment_notice_displaying = false;
let equipment_sync_timer = null;
let equipment_sync_in_flight = false;
let equipment_sync_pending = false;
let last_synced_equipment = null;
let equipment_view_action_armed = false;
let equipment_view_action_timer = null;
let status_sync_timer = null;
let status_sync_in_flight = false;
let status_sync_pending = false;
let status_sync_failures = 0;
let last_synced_status_skills = null;
let last_synced_status_activities = null;
let last_synced_status_statistics = null;
let status_icon_discovery_generation = 0;
let status_icon_collection_queue = Promise.resolve();
let last_synced_gp = null;
let last_status_sync_at = 0;
let status_observer_timer = null;
let last_observed_status_activities = null;
let last_observed_status_statistics = null;
let gp_sampling_timer = null;
let gp_sampling_id = 0;
let gp_scheduled_checks = 0;
let chat_poll_id = 0;
let chat_poll_failures = 0;
let chat_view_generation = 0;
let chat_page_visible = false;
let interface_ready = false;
let listing_filter_prompt_module = null;
let listing_filter_prompt = null;
let release_notice_shown = false;
let raid_combat = null;
let raid_loaded_session_id = null;
let is_reconciling_raid_cache = false;
const pending_identity_notices = [];
let social_mode_choice_selection = false;

let crucible_clock_timer = null;
let expedition_clock_timer = null;
let raid_clock_timer = null;
let raid_refresh_generation = 0;
let guild_raid_badge_timer = null;
let last_expedition_state_refresh_at = 0;
let crucible_page_visible = false;
let crucible_page_entry = 0;
let crucible_page_hydrating = false;

let has_sorted_market_filter_items = false;
let has_done_first_market_search = false;

const multiplayer_pet_flare = new Map();
let active_mod_names = [];
let active_mod_details = [];
let loaded_game_mode_id = null;
let owned_dlc_namespaces = [];
// #endregion

async function capture_active_mod_names() {
	const loaded = mod.manager.getLoadedModList();
	active_mod_names = client_runtime.normalize_active_mod_names(loaded);
	active_mod_details = await client_runtime.capture_active_mod_details(loaded, mod.manager.activeProfile?.mods);
}

function get_device_diagnostics() {
	if (!installation_store) return null;
	const manager = typeof nativeManager === 'undefined' ? globalThis.nativeManager : nativeManager;
	return { ...installation_store.read(server_host),
		...connection_diagnostics.detect_runtime(manager, globalThis.navigator?.userAgent),
		details_source: 'player_reported' };
}
function get_connection_report() {
	return transport_diagnostics.report({ device: get_device_diagnostics(), mod_version: MOD_VERSION,
		connected: state.is_connected, backend_version: connected_backend_version });
}

function get_client_runtime_report() {
	const melvor_cloud_manager = typeof cloudManager === 'undefined' ? globalThis.cloudManager : cloudManager;
	owned_dlc_namespaces = client_runtime.get_owned_dlc(melvor_cloud_manager);
	const report = client_runtime.make_client_runtime_report(MOD_VERSION, active_mod_names, loaded_game_mode_id,
		client_runtime.get_language_code(typeof setLang === 'string' ? setLang : null), get_device_diagnostics(),
		owned_dlc_namespaces, active_mod_details);
	const loaded_save = loaded_save_tracker?.report();
	if (loaded_save) report.loaded_save = loaded_save;
	return report;
}

function get_member_owned_dlc(member) {
	const reported_owned_dlc = Array.isArray(member?.owned_dlc) ? member.owned_dlc : [];
	return (client_runtime?.OWNED_DLC_NAMESPACES ?? []).filter(namespace => reported_owned_dlc.includes(namespace));
}

function get_owned_dlc_status_class(namespace) {
	return OWNED_DLC_STATUS_CLASSES[namespace] ?? '';
}

function get_chat_conversation_key(conversation) {
	if (!conversation)
		return null;
	const kind = conversation.conversation_kind ?? 'private';
	if (kind === 'private')
		return 'private:' + conversation.participant?.client_id;
	if (kind === 'support')
		return 'support:' + conversation.support_team_id + ':' + conversation.participant?.client_id;
	return kind + ':' + conversation.conversation_id;
}

const state = ui.createStore({
	// #region REACTIVE GLOBALS
	TRANSFER_INVENTORY_MAX_LIMIT,

	identity_code: '',
	identity_error: '',
	identity_create_confirmed: false,
	identity_bootstrap_busy: false,
	show_identity_recovery_code() { show_identity_recovery_code(); },
	open_identity_bootstrap() { open_identity_bootstrap(); },
	async connect_identity_code() {
		if (this.identity_bootstrap_busy) return;
		this.identity_bootstrap_busy = true;
		try { await start_multiplayer_session({ recovery_code: this.identity_code }); }
		finally { this.identity_bootstrap_busy = false; }
	},
	async create_multiplayer_identity() {
		if (!this.identity_create_confirmed || this.identity_bootstrap_busy) return;
		this.identity_bootstrap_busy = true;
		try { await start_multiplayer_session({ create: true }); }
		finally { this.identity_bootstrap_busy = false; }
	},
	is_connected: false,
	multiplayer_unsupported: false,
	service_status: null,
	minimum_supported_mod_version: '',
	is_transfer_page_visible: false,
	is_updating_transfer_contents: false,

	removing_friend: null,
	gifting_recipient: null,

	friend_code: '',
	display_name_input: '',
	profile_display_name: '',
	equipment_visible: true,
	equipment_visibility_pending: false,
	skills_visible: true,
	skills_visibility_pending: false,
	activity_visible: true,
	activity_visibility_pending: false,
	gp_visible: true,
	gp_visibility_pending: false,
	game_mode_visible: true,
	game_mode_visibility_pending: false,
	active_mods_visible: true,
	active_mods_visibility_pending: false,
	dev_tag_eligible: false,
	dev_tag_visible: true,
	dev_tag_visibility_pending: false,
	messaging_enabled: true,
	chat_privacy_pending: false,
	global_chat_enabled: true,
	account_tags: [],
	dev_badge_labels: {},
	pending_preview: null,
	global_chat_participation_pending: false,
	global_chat_cooling_down: false,
	tester_chat_cooling_down: false,
	alliance_access: false,
	alliance_state: { alliance: null, processes: [], affiliation_pending: false },
	alliance_loading: false,
	alliance_preview_affiliated: true,
	alliance_history_visible: false,
	alliance_error: '',
	alliance_picker_mode: 'found',
	alliance_picker_entries: [],
	alliance_picker_page: 0,
	alliance_picker_has_more: false,
	alliance_name_input: '',
	alliance_modal: null,
	alliance_confirmation: null,
	alliance_reason_confirmation: null,
	alliance_preview: null,
	alliance_preview_restore_picker: false,
	alliance_preview_from_member_guilds: false,
	alliance_chat_state: { affiliated: false, enabled: true },
	alliance_chat_enabled: true,
	alliance_chat_participation_pending: false,
	guild_chat_enabled: true,
	guild_chat_participation_pending: false,
	guild_chat_state: { affiliated: false, enabled: true },
	selected_guild_member: null,
	viewed_equipment: null,
	viewed_status: null,
	viewed_active_mods: [],
	viewed_cheat_mods: [],
	viewed_category_mods: [],
	viewed_cheat_category: 'items',
	viewed_cheats_unavailable: false,
	viewed_cheats_remaining: '',
	viewed_cheats_elapsed: '',
	profile_active_tab: 'skills',
	member_actions_preview: false,
	member_actions_error: '',
	icon_search: '',
	picked_icon: '',
	profile_icon: DEFAULT_AVATAR_ICON_ID,
	show_icon_prompt_info: false,
	current_mod_version: MOD_VERSION,
	social_mode: 'full',
	social_mode_enforcement: null,
	social_mode_cancellation_pending: false,
	released_mod_version: '',
	changelog_entries: [],
	changelog_loading: false,
	changelog_loaded: false,
	changelog_error: '',
	wiki_url: 'https://melvor.azcn.io/wiki',
	updates_sections: [],
	updates_loading: false,
	updates_loaded: false,
	updates_loaded_host: '',
	updates_error: '',
	updates_mobile_tab: 'updates',
	last_seen_mod_version: '',
	updates_new: false,
	transfers_mobile_tab: 'inbox',
	transfers_panels_open: { inbox: true, outbox: true, pending: true },
	transfers_history_open: { inbox: false, outbox: false, pending: false },
	transfer_history: {},
	transfer_history_clock: performance.now(),

	add_currency_value: 0,
	selected_transfer_currency_id: '',
	item_slider_value: 0,
	bank_action_item_id: '',
	bank_action_mode: '',
	bank_action_market_price: 1,
	bank_action_market_currency_id: 'melvorD:GP',
	bank_action_alliance_price: '',
	bank_action_unlimited: true,
	bank_action_purchase_limit: 1,
	bank_action_allow_haggles: true,

	transfer_inventory: [],
	inbox_items: [],
	inbox_groups: [],
	inbox_pending_claim: false,
	inbox_loading: false,
	inbox_claiming: false,
	selected_transfer_item_id: '',

	server_owned_pets: false,
	owned_pet_ids: [],
	crucible: null,
	crucible_summary: null,
	crucible_loading: false,
	crucible_busy: false,
	crucible_error: '',
	crucible_wish_item_id: '',
	crucible_wish_qty: 1,
	crucible_capacity_base: 200,
	crucible_capacity_auto_renew: false,
	crucible_wish_search: '',
	crucible_panels_open: { heat: true, wishes: true, offerings: true },
	crucible_guide_index: 0,
	crucible_selected_offering_id: null,
	crucible_selected_wish_id: null,
	crucible_clock_time: Date.now(),

	market_active_tab: 'search',
	market_direction: 'sell',
	listing_filter_categories: ['items', 'time', 'resources', 'multitasking', 'shops', 'loot_rng'],
	listing_filters: ['items'],
	multiplayer_settings_section: 'all',
	market_results: [],
	market_listings: [],
	market_haggles: [],
	market_haggle_item: null,
	market_haggle_counter: null,
	market_haggle_price: 1,
	market_haggles_loading: false,
	market_haggle_pending: 0,
	market_buy_item: null,
	market_fulfill_item: null,
	market_create_item: null,
	market_create_qty: 1,
	market_create_price: 1,
	market_listing_direction: 'buy',
	market_filter_item: null,
	market_filter_search: '',
	market_filter_items: [],
	market_search_loading: false,
	market_listings_loading: false,
	market_discovery_restriction_enabled: false,
	market_sort: 'recent',
	market_available_only: false,
	market_completed: [],
	market_fulfillment_notice_items: [],
	market_fulfillment_notice_order_count: 0,

	market_total_items: 0,
	market_current_page: 1,
	selected_chat_item_id: '',
	chat_item_market_checked: false,

	events: {
		friend_requests: [],
		guild_applicants: []
	},

	trades: [],
	gifts: [],
	resolved_trades: [],
	unsupported_returned_gift_id: null,
	unsupported_returned_gift_command_id: '',

	available_icons: [],

	friends: [],

	guild_state: { affiliation: 'none' },
	guild_state_loaded: false,
	guild_state_loading: false,
	guild_state_error: '',
	guilds: [],
	guild_members: [],
	guild_mobile_tab: 'guild',
	guild_activity: [],
	guild_activity_cursor: null,
	guild_activity_loading: false,
	guild_activity_error: false,
	guild_member_search: '',
	guild_member_directory_page: 0,
	guild_member_directory_has_more: false,
	guild_member_directory_loading: false,
	shadowed_members: [],
	shadowed_member_search: '',
	shadowed_member_directory_page: 0,
	shadowed_member_directory_has_more: false,
	shadowed_member_directory_loading: false,
	shadowed_member_count: 0,
	selected_free_fellowship: null,
	guild_applicants: [],
	guild_preview_decided_applications: [],
	guild_client_id: null,
	guild_list_search: '',
	guild_name_input: '',
	guild_icon_search: '',
	guild_icons: [],
	picked_guild_icon: '',
	guild_page_error: '',
	council_update_time: Date.now(),
	council_time_offset: 0,
	council_petitions: [],
	council_available_petition_types: [],
	council_has_more: false,
	council_resolved_page: 0,
	council_loading: false,
	council_show_resolved: false,
	council_type: null,
	council_name_input: '',
	council_icon_search: '',
	council_picked_icon: '',
	council_target_client_id: null,
	council_error: '',
	pending_banishment_guild_name: '',
	chat_conversations: [],
	selected_chat_conversation: null,
	chat_messages: [],
	chat_message_cursor: null,
	chat_loading: false,
	chat_messages_loading: false,
	chat_has_more: false,
	chat_before_cursor: null,
	chat_error: '',
	chat_drafts: {},
	chat_item_drafts: {},
	chat_highlight_drafts: {},
	chat_can_highlight: false,
	chat_highlight_input: '',
	chat_highlight_modal_key: null,
	chat_item_search: '',
	chat_person_search: '',
	chat_person_catalog: [],
	chat_feature_search: '',
	chat_feature_catalog: [],
	chat_item_catalog: [],
	chat_item_order_ids: [],
	chat_recent_items: [],
	chat_pending_sends: {},
	chat_sending_conversations: {},
	chat_reaction_choices: ['👍', '👎', '❤️', '😂', '😭', '💀', '👀', '🔥', '💯', '🎉', '🤔', '😮', '😬', '😡', '🗿', '👋', '👏', '😎'],
	chat_reaction_random_choices: [],
	chat_reaction_revision: null,
	chat_reaction_picker_message_id: null,
	chat_reaction_picker_style: {},
	chat_reaction_pending: {},
	chat_reaction_throttle_until: {},
	chat_translation_preferences: {},
	chat_notification_preferences: {},
	chat_notifications_busy: false,
	chat_translation_language_input: 'en',
	polls: [],
	polls_summary: null,
	poll_revision: null,
	poll_can_create: false,
	poll_creator_content: '',
	poll_creator_options: [''],
	poll_creator_choice_mode: 'multi',
	poll_creator_poll_id: null,
	poll_creator_pending: false,
	poll_delete_target: null,
	poll_delete_pending: false,
	poll_vote_throttle_until: {},
	chat_unread: 0,
	chat_client_id: null,
	chat_budget_enabled: true,
	chat_budget: { credits: 5, maximum: 5, refill_interval: 60000, next_refill_at: 0 },
	selected_chat_message: null,
	chat_is_admin: false,
	admin_detail_groups: [],
	admin_details_kind: null,
	selected_poll: null,
	identities: [],
	identities_loading: false,
	identities_error: '',
	self_deletion: null,
	identity_notice_requester: '',
	identity_notice_time: '',
	raid_state: { affiliation: 'none', cache_pending: false },
	raid_tier_progress: {},
	raid_monster_drops: {},
	raid_drop_entries: [],
	raid_boss_info: null,
	raid_loading: false,
	raid_loaded: false,
	raid_action_pending: false,
	raid_error: '',
	raid_confirmation_full_hp: false,
	raid_update_time: Date.now(),
	raid_time_offset: 0,
	expedition_tracking_active: false,
	expedition_tracking_loading: false,
	expedition_debug_text: '',
	expedition_debug_action: '',
	expedition_leaderboard: null,
	expedition_leaderboard_loading: false,
	expedition_leaderboard_error: false,
	expedition_state: null,
	expedition_personal: null,
	expedition_loading: false,
	expedition_clock_time: Date.now(),
	expedition_active_activities: [],
	expedition_action_pending: false,
	expedition_vote_cooldown_until: 0,
	expedition_check_in_cooldown_until: 0,
	expedition_pending_report: null,
	expedition_report_notice_visible: false,
	expedition_work_tab: 'chamber',
	expedition_snow: null,
	expedition_snow_controls_enabled: false,
	expedition_snow_stats: null,
	expedition_phase_visit_id: null,
	expedition_phase_open: { arrival: true, exploration: true, departure: true },
	// #endregion

	// #region COMPUTED PROPS
	get_transfer_currency(currency_id) {
		return transfer_currency_support?.get_transfer_currency(game, currency_id) ?? null;
	},

	currency_display_shorthand(entry) {
		return localization.localize_currency_shorthand(entry, setLang, getLangString);
	},

	format_currency_amount(currency, amount) {
		return localization.format_multiplayer_currency_amount(currency, amount, setLang, getLangString);
	},

	get_capped_transfer_items(items) {
		return transfer_currency_support?.cap_transfer_items(game, items) ?? items;
	},

	get_transfer_cap_notice(items = this.transfer_inventory) {
		const overages = transfer_currency_support?.get_transfer_currency_overages(game, items) ?? [];
		return overages.map(entry => `${this.currency_display_shorthand(entry)}: ${numberWithCommas(entry.cap)}`).join(', ');
	},

	get pending_gifts() { return [...this.gifts, ...(this.pending_preview?.gifts ?? [])]; },
	get pending_resolved_trades() { return [...this.resolved_trades, ...(this.pending_preview?.resolved_trades ?? [])]; },
	get pending_haggles() { return [...this.market_haggles, ...(this.pending_preview?.haggles ?? [])]; },
	is_pending_preview(kind, id) {
		const rows = this.pending_preview?.[kind === 'gift' ? 'gifts' : kind === 'trade' ? 'trades' : 'haggles'] ?? [];
		return rows.some(row => (kind === 'trade' ? row.trade_id : row.id) === id) ||
			(kind === 'trade' && (this.pending_preview?.resolved_trades ?? []).some(row => row.trade_id === id));
	},
	async pending_preview_action(kind, id, action) {
		const res = await api_post('/api/features/pending/action', { kind, id, action });
		if (!res?.success) notify_error('MOD_MP_GENERIC_ERR');
	},
	get sorted_trades() {
		return [...this.trades, ...(this.pending_preview?.trades ?? [])].sort((a, b) => a.attending === b.attending ? 0 : a.attending ? -1 : 1);
	},

	get_haggle_stack_value(haggle) {
		const item = game.items.getObjectByID(haggle.item_id);
		if (item === undefined)
			return '—';
		const value = item.sellsFor?.currency === game.gp ? game.bank.getItemSalePrice(item, haggle.item_qty) : 0;
		return this.format_currency_amount(game.gp, numberWithCommas(value));
	},

	get transfer_inventory_value_raw() {
		let total_value = 0;

		for (const entry of this.transfer_inventory) {
			if (entry.id === 'melvorD:GP') {
				total_value += entry.qty;
			} else if (!transfer_currency_support?.is_transfer_currency(game, entry.id)) {
				const item = game.items.getObjectByID(entry.id);
				if (item?.sellsFor?.currency === game.gp) {
					const value = game.bank.getItemSalePrice(item, entry.qty);
					if (value > 0)
						total_value += value;
				}
			}
		}

		return total_value;
	},

	get transfer_inventory_zero_gp_count() {
		let count = 0;
		for (const entry of this.transfer_inventory) {
			if (entry.id === 'melvorD:GP' || transfer_currency_support?.is_transfer_currency(game, entry.id))
				continue;
			const item = game.items.getObjectByID(entry.id);
			if (item !== undefined && !item.id.includes(':Summoning_Familiar_') &&
				(item.sellsFor?.currency !== game.gp || game.bank.getItemSalePrice(item, entry.qty) <= 0))
				count += entry.qty;
		}
		return count;
	},

	get transfer_inventory_currency_count() {
		return this.transfer_inventory
			.filter(entry => transfer_currency_support?.is_transfer_currency(game, entry.id))
			.reduce((total, entry) => total + entry.qty, 0);
	},

	get transfer_inventory_donation_value() {
		return this.transfer_inventory_value_raw + this.transfer_inventory_zero_gp_count + this.transfer_inventory_currency_count;
	},

	get transfer_inventory_value() {
		return this.format_currency_amount(game.gp, numberWithCommas(this.transfer_inventory_value_raw));
	},

	get add_currency_value_formatted() {
		return formatNumber(this.add_currency_value);
	},

	get bank_action_item_owned_qty() {
		const item = get_bank_action_item();
		return item === null ? 0 : game.bank.getQty(item);
	},

	get bank_action_item_name() {
		return this.bank_action_item_id === '' ? '' : this.get_item_name(this.bank_action_item_id);
	},

	get bank_action_item_sale_currency_id() {
		return get_bank_action_item()?.sellsFor?.currency?.id ?? 'melvorD:GP';
	},
	get bank_action_item_unit_value_number() {
		const item = get_bank_action_item();
		return numberWithCommas(item === null ? 0 : game.bank.getItemSalePrice(item, 1));
	},
	get bank_action_item_value_number() {
		const item = get_bank_action_item();
		return numberWithCommas(item === null ? 0 : game.bank.getItemSalePrice(item, this.item_slider_value));
	},
	get bank_action_item_value_formatted() {
		const item = get_bank_action_item();
		if (item === null)
			return this.format_currency_amount(game.gp, '0');
		const value = game.bank.getItemSalePrice(item, this.item_slider_value);
		return this.format_currency_amount(item.sellsFor?.currency, numberWithCommas(value));
	},

	get bank_action_market_total_formatted() {
		const total = Number(this.item_slider_value) * Number(this.bank_action_market_price);
		return Number.isSafeInteger(total) && total >= 0 ? this.format_currency_amount(game.gp, numberWithCommas(total)) : this.format_currency_amount(game.gp, '0');
	},

	get market_currencies() {
		return (transfer_currency_support?.get_transfer_currencies(game) ?? [])
			.filter(entry => is_local_item_available(entry.id));
	},
	market_currency(row) {
		return this.get_transfer_currency(row?.currency_id ?? 'melvorD:GP');
	},
	market_currency_icon(row) {
		return this.market_currency(row)?.currency.media ?? 'assets/media/main/coins.svg';
	},
	market_currency_shorthand(row) {
		const entry = this.market_currency(row) ??
			transfer_currency_support?.TRANSFER_CURRENCY_DEFINITIONS?.find(entry => entry.id === row?.currency_id) ??
			{ id: 'melvorD:GP', shorthand: 'GP' };
		return this.currency_display_shorthand(entry);
	},
	market_currency_amount(row) {
		return this.market_currency(row)?.currency.amount ?? 0;
	},
	market_buyable(row) {
		return Math.min(row?.available ?? 0, row?.buyable ?? row?.available ?? 0);
	},
	set_market_listing_qty(value) {
		const qty = Number(value);
		this.item_slider_value = Number.isSafeInteger(qty) ? Math.max(1, Math.min(qty, this.bank_action_item_owned_qty)) : 1;
	},
	get bank_action_listing_valid() {
		const qty = Number(this.item_slider_value), price = Number(this.bank_action_market_price);
		const alliance = this.bank_action_alliance_price === '' ? 0 : Number(this.bank_action_alliance_price);
		return Number.isSafeInteger(qty) && qty > 0 && qty <= this.bank_action_item_owned_qty &&
			Number.isSafeInteger(price) && price > 0 && Number.isSafeInteger(qty * price) &&
			(this.bank_action_alliance_price === '' || (Number.isSafeInteger(alliance) && alliance > 0 && Number.isSafeInteger(qty * alliance))) &&
			(this.bank_action_unlimited || (Number.isSafeInteger(this.bank_action_purchase_limit) && this.bank_action_purchase_limit > 0)) &&
			this.market_currencies.some(row => row.id === this.bank_action_market_currency_id);
	},
	market_listing_amount(price, quantity = this.item_slider_value) {
		const total = Number(price) * Number(quantity);
		return Number.isSafeInteger(total) && total >= 0 ? numberWithCommas(total) : '—';
	},
	get transfer_currencies() {
		return transfer_currency_support?.get_available_transfer_currencies(game) ?? [];
	},

	get selected_transfer_currency() {
		return transfer_currency_support?.get_transfer_currency(game, this.selected_transfer_currency_id) ?? null;
	},

	format_shared_gp(amount) {
		return Number.isSafeInteger(amount) && amount >= 0 ? formatNumber(amount) : '';
	},

	get_member_owned_dlc,
	get_owned_dlc_status_class,

	get filtered_icons() {
		const icon_search_lower = this.icon_search.toLowerCase();
		return this.available_icons.filter(icon => icon.search_name.includes(icon_search_lower));
	},

	get filtered_guild_icons() {
		const search = this.guild_icon_search.trim().toLowerCase();
		const matches = search.length === 0
			? this.guild_icons
			: this.guild_icons.filter(icon => icon.search_name.includes(search));
		return matches;
	},

	get filtered_council_icons() {
		const search = this.council_icon_search.trim().toLowerCase();
		const matches = search.length === 0
			? this.guild_icons
			: this.guild_icons.filter(icon => icon.search_name.includes(search));
		return matches;
	},

	get guild_visible_tab() {
		if (this.guild_mobile_tab === 'alliance' && this.alliance_access) return 'alliance';
		if (this.guild_mobile_tab === 'council' && this.guild_state.guild?.capabilities?.council) return 'council';
		return 'guild';
	},

	get council_discussion_badge() { return this.get_petition_nav_badge('council'); },
	get alliance_discussion_badge() { return this.get_petition_nav_badge('alliance'); },

	get council_needs_vote() {
		return this.council_petitions.some(petition => petition.lifecycle === 'active' && petition.can_vote && !petition.current_vote);
	},

	get guild_showcase() {
		return this.council_petitions.some(petition => petition.synthetic === true);
	},

	get visible_guild_applicants() {
		if (this.guild_state.guild?.is_public || this.is_free_fellowship) return [];
		return [...this.guild_applicants, ...(this.guild_showcase ? [
			{ application_id: -1, synthetic: true, client_id: -301, display_name: 'Copper Cook', icon_id: 'melvorD:Golbin', raid_defeats: 17, gp: 125000, gp_visible: true, owned_dlc: ['melvorTotH'], social_mode: 'full', equipment_visible: false, skills_visible: false, active_mods_visible: false },
			{ application_id: -2, synthetic: true, client_id: -302, display_name: 'Willow Baker', icon_id: 'melvorD:Golbin', raid_defeats: 3, gp: null, gp_visible: false, using_cheats: true, cheat_mods: ['Synthetic cheat example'], owned_dlc: [], social_mode: 'social', equipment_visible: false, skills_visible: false, active_mods_visible: false }
		] : [])].filter(application => !(this.guild_preview_decided_applications ?? []).includes(application.application_id));
	},

	get alliance_view() { return this.get_alliance_view(); },
	get alliance_member_guilds() {
		const ours = this.guild_state.guild?.guild_id;
		return [...(this.alliance_view.alliance?.member_guilds ?? [])].sort((a, b) =>
			Number(b.guild_id === ours) - Number(a.guild_id === ours));
	},
	get alliance_member_count() {
		return this.alliance_member_guilds.reduce((sum, guild) => sum + (guild.member_count ?? 0), 0);
	},
	get alliance_applications() {
		return this.alliance_view.processes.filter(p => p.kind === 'join' && p.applicant && this.alliance_view.alliance && this.is_alliance_process_active(p));
	},
	get alliance_active_proposals() {
		return this.alliance_view.processes.filter(p => this.is_alliance_process_active(p) && !this.alliance_applications.some(application => application.process_id === p.process_id));
	},
	get alliance_proposal_history() {
		return this.alliance_view.processes.filter(p => !this.is_alliance_process_active(p));
	},

	get alliance_needs_vote() {
		return this.alliance_access && (this.council_petitions.some(petition =>
			petition.type.startsWith('alliance_') && petition.lifecycle === 'active' && petition.can_vote && !petition.current_vote) ||
			(!this.alliance_state.affiliation_pending && this.alliance_state.processes.some(proposal => proposal.can_consider)));
	},

	get visible_council_petitions() {
		return this.council_petitions.filter(petition => petition.lifecycle === 'active');
	},

	get closed_council_petitions() {
		return this.council_petitions.filter(petition => petition.lifecycle !== 'active');
	},

	get filtered_guilds() {
		const search = this.guild_list_search.trim().toLowerCase();
		return search.length === 0
			? this.guilds
			: this.guilds.filter(guild => guild.name.toLowerCase().includes(search));
	},

	get is_guild_member() {
		return this.guild_state.affiliation === 'member' && this.guild_state.guild != null;
	},

	get is_social_only() {
		return social_mode?.is_social_only_mode(this.social_mode) === true;
	},

	get is_free_fellowship() {
		return this.guild_state.guild?.is_free_fellowship === true;
	},

	get guild_page_view() {
		if (this.is_guild_member)
			return 'member';
		if (this.guild_state.affiliation === 'applicant')
			return 'applicant';
		if (this.guild_state_error !== '')
			return 'error';
		if (this.guild_state_loading || !this.guild_state_loaded)
			return 'loading';
		return this.guild_state.affiliation === 'none' ? 'onboarding' : 'loading';
	},

	get guild_member_count() {
		return this.guild_state.guild?.member_count ?? this.guild_members.length;
	},

	get guild_active_member_count() {
		return this.guild_state.guild?.active_member_count ?? this.guild_member_count;
	},

	get guild_recipients() {
		return this.guild_members.filter(member => member.client_id !== this.guild_client_id && member.social_mode !== 'social');
	},

	get council_banishment_members() {
		const members = [...this.guild_members, ...this.shadowed_members];
		const seen = new Set();
		return members.filter(member => {
			if (seen.has(member.client_id))
				return false;
			seen.add(member.client_id);
			return true;
		});
	},

	get viewed_equipment_grid() {
		return this.viewed_equipment === null ? [] : build_equipment_grid(this.viewed_equipment);
	},

	get member_profile_available() {
		const member = this.selected_guild_member;
		return member !== null && ((member.skills_visible === true && member.skills_available === true) ||
			(member.equipment_visible === true && member.equipment_available === true));
	},

	get viewed_status_skills() {
		const skills = this.viewed_status?.skills ?? [];
		const skill_order = new Map(get_registered_game_objects(game.skills)
			.map((skill, index) => [get_game_object_id(skill), index]));
		return [...skills].sort((a, b) => {
			const a_order = skill_order.get(a.skill_id) ?? Number.MAX_SAFE_INTEGER;
			const b_order = skill_order.get(b.skill_id) ?? Number.MAX_SAFE_INTEGER;
			return a_order - b_order || a.skill_id.localeCompare(b.skill_id);
		});
	},

	get has_transfer_access() {
		if (this.is_social_only)
			return this.inbox_items.length > 0 || this.inbox_pending_claim;
		return this.is_guild_member || this.transfer_inventory.length > 0 || this.gifts.length > 0 ||
			this.trades.length > 0 || this.resolved_trades.length > 0 || this.inbox_items.length > 0 ||
			this.inbox_pending_claim || this.market_haggle_pending > 0;
	},

	get has_destroyable_transfer_items() {
		return this.transfer_inventory.some(item => item.destroyable === true);
	},

	get selected_transfer_item_is_destroyable() {
		return this.transfer_inventory.find(item => item.id === this.selected_transfer_item_id)?.destroyable === true;
	},

	get num_notifications() {
		return this.num_guild_applicants + this.num_transfer_offers + this.num_market_sold_items + this.chat_unread;
	},

	get num_uninteracted_open_polls() {
		return this.polls_summary?.open_uninteracted ?? this.polls.filter(poll => poll.open === true && poll.interacted !== true).length;
	},

	get chat_can_send() {
		const kind = this.selected_chat_conversation?.conversation_kind ?? 'private';
		return (kind !== 'private' || (this.messaging_enabled && (!this.chat_budget_enabled || this.chat_budget.credits > 0))) &&
			(!['announcements', 'announcement-discussion'].includes(kind) || this.selected_chat_conversation?.can_send === true) &&
			(kind !== 'global' || !this.global_chat_cooling_down) &&
			(kind !== 'testers' || !this.tester_chat_cooling_down) &&
			this.chat_draft.trim().length > 0 &&
			this.is_chat_item_draft_valid() &&
			!this.chat_sending;
	},

	get chat_draft() {
		const key = get_chat_conversation_key(this.selected_chat_conversation);
		return key === null ? '' : this.chat_drafts[key] ?? '';
	},

	set chat_draft(value) {
		const key = get_chat_conversation_key(this.selected_chat_conversation);
		if (key !== null)
			this.chat_drafts[key] = value;
	},

	get chat_pending_send() {
		const key = get_chat_conversation_key(this.selected_chat_conversation);
		return key === null ? null : this.chat_pending_sends[key] ?? null;
	},

	get chat_sending() {
		const key = get_chat_conversation_key(this.selected_chat_conversation);
		return key !== null && this.chat_sending_conversations[key] === true;
	},

	get show_chat_support_prompts() {
		const conversation = this.selected_chat_conversation;
		return conversation?.conversation_kind === 'support' && conversation.viewer_side === 'player' &&
			conversation.conversation_id === null && this.chat_draft.trim().length === 0;
	},

	get personal_chat_conversations() {
		return this.chat_conversations.filter(conversation => (conversation.conversation_kind ?? 'private') === 'private');
	},

	get global_chat_conversations() {
		return this.chat_conversations.filter(conversation => conversation.conversation_kind === 'global');
	},

	get announcement_chat_conversations() {
		return this.chat_conversations.filter(conversation => conversation.conversation_kind === 'announcements');
	},

	get polls_chat_conversations() {
		return this.chat_conversations.filter(conversation => conversation.conversation_kind === 'polls');
	},

	get alliance_chat_conversations() {
		return this.chat_conversations.filter(conversation => conversation.conversation_kind === 'alliance');
	},

	get guild_chat_conversations() {
		return this.chat_conversations.filter(conversation => conversation.conversation_kind === 'guild');
	},

	get support_chat_conversations() {
		return this.chat_conversations.filter(conversation => conversation.conversation_kind === 'support');
	},

	get show_guild_chat_category() {
		return this.alliance_chat_conversations.length > 0 || this.alliance_chat_state.affiliated === true || this.guild_chat_conversations.length > 0 || this.guild_chat_state.affiliated === true;
	},

	get num_market_sold_items() {
		return this.market_completed.length;
	},

	get num_attending_trades() {
		return this.trades.filter(trade => trade.attending).length;
	},

	get num_transfer_offers() {
		return this.gifts.length + this.num_attending_trades + this.resolved_trades.length + this.market_haggle_pending;
	},

	get num_friend_requests() {
		return this.events.friend_requests.length;
	},

	get num_guild_applicants() {
		return this.events.guild_applicants.length;
	},

	get num_active_transfers() {
		return this.gifts.length + this.resolved_trades.length + this.trades.length + this.market_haggle_pending +
			Object.values(this.pending_preview ?? {}).reduce((total, rows) => total + rows.length, 0);
	},

	get raid() {
		return this.raid_state.raid ?? null;
	},

	get raid_visible() {
		return this.raid?.active === true && this.raid_update_time < this.raid.expires_at &&
			this.raid_state.entered !== false;
	},

	get raid_entry_available() {
		return this.raid_state.can_activate === true && this.raid?.active === true &&
			this.raid_update_time < this.raid.expires_at;
	},

	get raid_progress_pct() {
		return this.raid === null || this.raid.max_health <= 0 ? 0 : Math.max(0, Math.min(100,
			(this.raid.remaining_health / this.raid.max_health) * 100));
	},

	get raid_can_assault() {
		const pending = this.raid?.member?.pending_assault;
		const can_resume = pending?.loaded_session_id === raid_loaded_session_id &&
			this.raid_update_time < pending?.combat_deadline;
		return this.raid_visible && this.raid?.member?.eligible === true &&
			((this.raid?.member?.assaults ?? 0) > 0 || can_resume) && !this.raid_action_pending &&
			!raid_combat?.has_active();
	},

	get eligible_crucible_wish_items() {
		return (this.crucible?.wish_catalog ?? []).map(entry => {
			const item = game.items.getObjectByID(entry.id);
			return item && game.stats.itemFindCount(item) > 0 ? { ...entry, name: item.name } : null;
		}).filter(Boolean).sort((left, right) => right.max_item_value - left.max_item_value || left.name.localeCompare(right.name));
	},

	get filtered_crucible_wish_items() {
		const search = String(this.crucible_wish_search ?? '').trim().toLocaleLowerCase();
		return this.eligible_crucible_wish_items.filter(item => search === '' ||
			String(item.name).toLocaleLowerCase().includes(search));
	},

	get crucible_heat_levels() {
		const thresholds = [1, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000, 10_000_000_000];
		const rates = [1, 2, 3, 5, 8, 12, 17, 22, 28];
		return thresholds.map((value, index) => ({ tier: index + 1, value, rate: rates[index],
			current: this.crucible?.heat?.tier === index + 1 }));
	},
	load_crucible_heat_preference() {
		this.crucible_panels_open.heat = get_instance_storage_item('crucible_heat_expanded') !== false;
	},
	toggle_crucible_heat() {
		this.crucible_panels_open.heat = !this.crucible_panels_open.heat;
		set_instance_storage_item('crucible_heat_expanded', this.crucible_panels_open.heat);
	},
	get crucible_guide_length() { return CRUCIBLE_GUIDE_STEPS.length; },
	get crucible_guide_title_id() { return CRUCIBLE_GUIDE_STEPS[this.crucible_guide_index][1]; },
	get crucible_guide_description_id() { return CRUCIBLE_GUIDE_STEPS[this.crucible_guide_index][2]; },
	get crucible_guide_image() { return get_mod_asset_url(`assets/crucible-guide/${CRUCIBLE_GUIDE_STEPS[this.crucible_guide_index][0]}.png`); },
	get crucible_wish_item_name() {
		return this.eligible_crucible_wish_items.find(item => item.id === this.crucible_wish_item_id)?.name ?? '';
	},

	get crucible_wish_requirement() {
		const entry = this.crucible?.wish_catalog?.find(item => item.id === this.crucible_wish_item_id);
		const qty = Number(this.crucible_wish_qty);
		return entry && Number.isSafeInteger(qty) && qty >= 1 && qty <= 1000 && Number.isSafeInteger(entry.max_item_value * qty * 5) ? entry.max_item_value * qty * 5 : 0;
	},

	get crucible_capacity() {
		const capacity = this.crucible?.capacity;
		return capacity && (capacity.expires_at === null || capacity.expires_at > this.crucible_clock_time)
			? capacity : { ...capacity, base: 100, expires_at: null, auto_renew: false, renewal_micros: 0 };
	},
	get crucible_capacity_quote() {
		const base = this.crucible_capacity_base;
		const current = this.crucible_capacity.base ?? 100;
		if (![200,300,400,500].includes(base) || base <= current) return 0;
		const price = tier => (tier / 100 - 1) * (tier / 100) / 2 * 10_000_000;
		return price(base) - price(current);
	},
	get crucible_capacity_renewal_changed() {
		return this.crucible_capacity.base > 100 && this.crucible_capacity_base === this.crucible_capacity.base &&
			this.crucible_capacity_auto_renew !== this.crucible_capacity.auto_renew;
	},
	get crucible_capacity_confirm_label() {
		if (this.crucible_capacity_quote > 0) return 'MOD_MP_WISH_BUY_CAPACITY';
		if (this.crucible_capacity_renewal_changed)
			return this.crucible_capacity_auto_renew ? 'MOD_MP_WISH_AUTO_RENEW' : 'MOD_MP_WISH_DISABLE_RENEWAL';
		return 'MOD_MP_WISH_CONFIRM';
	},
	get crucible_capacity_can_confirm() {
		return !this.crucible_busy && (this.crucible_capacity_renewal_changed ||
			this.crucible_capacity_quote > 0 && this.crucible_capacity_quote <= (this.crucible?.capacity?.points_micros ?? 0));
	},
	get crucible_wish_ep_micros() {
		return crucible_rules?.wish_price_micros(Number(this.crucible_wish_qty), this.crucible_capacity.base ?? 100) ?? 0;
	},
	get crucible_wish_gp_cost() { return crucible_rules?.wish_gp_cost(this.crucible_wish_requirement) ?? 0; },
	get crucible_wish_affordable() {
		return this.crucible_wish_ep_micros > 0 && this.crucible_wish_gp_cost > 0 &&
			(this.crucible?.capacity?.points_micros ?? 0) >= this.crucible_wish_ep_micros &&
			game.gp.amount >= this.crucible_wish_gp_cost;
	},

	get market_buy_price_formatted() {
		if (this.market_buy_item)
			return formatNumber(this.market_buy_item.price * this.item_slider_value) + ' ' + this.market_currency_shorthand(this.market_buy_item);

		return '0 ' + this.market_currency_shorthand(null);
	},

	get market_fulfill_price_formatted() {
		if (this.market_fulfill_item)
			return formatNumber(this.market_fulfill_item.price * this.item_slider_value) + ' ' + this.market_currency_shorthand(null);

		return '0 ' + this.market_currency_shorthand(null);
	},

	get market_fulfill_item_owned_qty() {
		const item = this.market_fulfill_item === null ? null :
			game.items.getObjectByID(this.market_fulfill_item.item_id);
		return item === undefined || item === null ? 0 : game.bank.getQty(item);
	},

	get_market_item_owned_qty(item_id) {
		const item = game.items.getObjectByID(item_id);
		return item === undefined || item === null ? 0 : game.bank.getQty(item);
	},

	get market_haggle_item_owned_qty() {
		const item = this.market_haggle_item === null ? null :
			game.items.getObjectByID(this.market_haggle_item.item_id);
		return item === undefined || item === null ? 0 : game.bank.getQty(item);
	},

	get market_create_total_formatted() {
		const total = Number(this.market_create_qty) * Number(this.market_create_price);
		return Number.isSafeInteger(total) && total > 0 ? formatNumber(total) + ' ' + this.market_currency_shorthand(null) : '0 ' + this.market_currency_shorthand(null);
	},

	get market_create_calculation_formatted() {
		const item_qty = Number(this.market_create_qty);
		const item_price = Number(this.market_create_price);
		return Number.isSafeInteger(item_qty) && item_qty > 0 && Number.isSafeInteger(item_price) && item_price > 0
			? `${formatNumber(item_qty)} × ${formatNumber(item_price)} ${this.market_currency_shorthand(null)}`
			: '0 × 0 ' + this.market_currency_shorthand(null);
	},

	get market_listings_filtered() {
		return this.market_listings.filter(item => item.direction === this.market_listing_direction);
	},

	get market_filter_search_sanitized() {
		return this.market_filter_search.trim().toLowerCase();
	},

	get market_filter_items_filtered() {
		const search = this.market_filter_search_sanitized;
		const eligible = this.market_discovery_restriction_enabled
			? this.market_filter_items.filter(item => !is_market_item_hidden_by_discovery(item.id))
			: this.market_filter_items;
		const items = search.length === 0
			? eligible
			: eligible.filter(item => item.name_lower.includes(search));

		return items.slice(0, MARKET_FILTER_ITEMS_LIMIT);
	},

	get market_page_count() {
		return Math.max(Math.ceil(this.market_total_items / MARKET_ITEMS_PER_PAGE), 1);
	},

	get market_page_window() {
		return get_market_page_window(this.market_current_page, this.market_page_count);
	},
	// #endregion

});

function create_action_runtime() {
	return {
		state,
		ctx,
		get_mod_asset_url,
		game,
		get_game_asset_url: path => assets.getURI(path),
		get_number_multiplier: () => numberMultiplier,
		getLangString,
		localization,
		changePage: navigate_page,
		Swal,
		document,
		next_tick: () => PetiteVue.nextTick(),
		$,
		nativeManager: typeof nativeManager === 'undefined' ? undefined : nativeManager,
		crypto,
		get_offering_item_valuation,
		SUPPORT_TEAM_ICON_ASSETS,
		GIFT_FLAG_RETURNED,
		MARKET_ITEMS_PER_PAGE,
		TRANSFER_INVENTORY_MAX_LIMIT,
		multiplayer_pet_flare,
		is_social_only: () => state.is_social_only,
		game_mode_sharing,
		client_runtime,
		trade_returns,
		transfer_currency_support,
		transfer_inventory,
		api_get,
		api_post,
		run_pending_economy_action,
		recover_paid_wish_actions,
		run_pending_crucible_wish_action,
		filter_local_available_items,
		add_currency_to_transfer,
		add_gp_to_transfer,
		is_transfer_currency: currency_id => transfer_currency_support?.is_transfer_currency(game, currency_id) === true,
		claim_inbox,
		capture_equipment_snapshot,
		capture_status_snapshot,
		begin_expedition_woodcutting_tracking,
		check_in_expedition_tracking,
		format_status_account_age,
		invalidate_status_icon_collection,
		close_account_dropdown,
		close_modal: (...args) => state.close_modal(...args),
		close_modal_and_wait,
		destroy_selected_transfer_inventory,
		get_chat_conversation_key,
		get_local_item_namespaces,
		get_client_events,
		get_friends,
		getLangString,
		get_icon_object_by_id,
		is_official_game_id,
		get_instance_storage_item,
		set_instance_storage_item,
		has_local_unresolved_item,
		hide_button_spinner,
		hide_modal_error,
		invalidate_guild_state,
		is_button_spinning,
		is_local_item_available,
		is_local_item_resolved,
		is_market_item_discovered,
		load_market_filter_items,
		sort_market_filter_items,
		log,
		error,
		notify,
		notify_error,
		notify_item,
		open_transfer_page,
		queue_modal,
		reconcile_economy_receipts,
		refresh_chat_conversations,
		update_chat_nav,
		refresh_chat_messages,
		refresh_council,
		update_guild_nav,
		refresh_guild_members,
		refresh_guild_page,
		refresh_guild_state,
		refresh_identities,
		refresh_raid_state,
		refresh_shadowed_members,
		remove_sold_out_market_result,
		return_all_transfer_inventory,
		return_selected_transfer_inventory,
		schedule_equipment_sync,
		schedule_status_sync,
		setup_guild_icons,
		setup_icons,
		show_button_spinner,
		show_modal_error,
		start_chat_polling,
		start_gp_sampling,
		start_status_observer,
		stop_chat_polling,
		stop_gp_sampling,
		stop_status_observer,
		unmount_connected_modal_components,
		update_crucible_nav,
		update_multiplayer_nav,
		update_market_listings,
		update_market_haggles,
		update_market_page,
		update_market_search,
		openLink,
		update_transfer_contents,
		update_raid_nav,
		formatNumber,
		numberWithCommas,
		get chat_view_generation() { return chat_view_generation; },
		set chat_view_generation(value) { chat_view_generation = value; },
		get active_mod_names() { return active_mod_names; },
		get has_sorted_market_filter_items() { return has_sorted_market_filter_items; },
		set has_sorted_market_filter_items(value) { has_sorted_market_filter_items = value; },
		get last_synced_status_statistics() { return last_synced_status_statistics; },
		set last_synced_status_statistics(value) { last_synced_status_statistics = value; },
		get last_synced_equipment() { return last_synced_equipment; },
		set last_synced_equipment(value) { last_synced_equipment = value; },
		get last_synced_gp() { return last_synced_gp; },
		set last_synced_gp(value) { last_synced_gp = value; },
		get last_synced_status_activities() { return last_synced_status_activities; },
		set last_synced_status_activities(value) { last_synced_status_activities = value; },
		get last_synced_status_skills() { return last_synced_status_skills; },
		set last_synced_status_skills(value) { last_synced_status_skills = value; },
		get loaded_game_mode_id() { return loaded_game_mode_id; },
		set loaded_game_mode_id(value) { loaded_game_mode_id = value; },
		get raid_combat() { return raid_combat; },
		set raid_combat(value) { raid_combat = value; },
		get raid_loaded_session_id() { return raid_loaded_session_id; },
		set raid_loaded_session_id(value) { raid_loaded_session_id = value; }
	};
}

// #region COMMON FUNCTIONS
function queue_modal(title_lang, template_id, image_url = 'assets/multiplayer.svg', data = {}, localize_title = true, get_image = true) {
	if (!modal_queue_guard.reserve(template_id)) {
		log('ignored duplicate modal request (%s)', template_id);
		return false;
	}

	const modal_options = Object.assign({
		html: modal_component(template_id),
		imageUrl: get_image ? ctx.getResourceUrl(image_url) : image_url,
		imageWidth: 64,
		imageHeight: 64,
		allowOutsideClick: true,
		backdrop: true
	}, data, {
		titleText: localize_title ? getLangString(title_lang) : title_lang
	});
	delete modal_options.title;

	const did_close = modal_options.didClose;
	modal_options.didClose = (...args) => {
		modal_queue_guard.release(template_id);
		did_close?.(...args);
	};

	try {
		addModalToQueue(modal_options);
		return true;
	} catch (error) {
		modal_queue_guard.release(template_id);
		throw error;
	}
}

function show_modal_error(text) {
	if (state.service_status) return;
	const $modal_error = $('mp-modal-error');
	$modal_error.textContent = text;
	$modal_error.classList.remove('d-none');
}

function hide_modal_error() {
	$('mp-modal-error').classList.add('d-none');
}

function show_button_spinner(element) {
	if (typeof element === 'string')
		element = $(element);

	const $spinner = element.querySelector('[role="status"]');
	$spinner.classList.remove('d-none');
}

function hide_button_spinner(element) {
	if (typeof element === 'string')
		element = $(element);

	const $spinner = element.querySelector('[role="status"]');
	$spinner.classList.add('d-none');
}

function is_button_spinning(element) {
	if (typeof element === 'string')
		element = $(element);

	const $spinner = element.querySelector('[role="status"]');
	return !$spinner.classList.contains('d-none');
}

function modal_component(template_id) {
	return modal_component_registry.get(template_id);
}

function make_template(id, parent = null) {
	const host = parent ?? document.body;
	if (host !== document.body && !host.hasAttribute('data-mp-template-scope'))
		host.setAttribute('data-mp-template-scope', id);
	return ui.create({ $template: '#template-mp-' + id, state }, host);
}

function find_main_container() {
	return $('main-container') ?? document.querySelector('main-container');
}

function make_scoped_template(id, parent) {
	const host = document.createElement('div');
	host.setAttribute('data-mp-template-scope', id);
	parent.append(host);
	make_template(id, host);
	return host;
}

function mount_modal_template(id, parent) {
	const selector = '#template-mp-' + id;
	const template = document.querySelector(selector);
	if (!(template instanceof HTMLTemplateElement))
		throw new Error(`No modal template exists: "${selector}"`);
	parent.append(template.content.cloneNode(true));
	parent.setAttribute('v-scope', '');
	const app = PetiteVue.createApp({ $template: selector, state });
	app.mount(parent);
	return app;
}

function unmount_connected_modal_components() {
	for (const component of modal_component_registry.values()) {
		if (component.isConnected)
			component.unmountTemplate();
	}
}

async function close_modal_and_wait(template_id) {
	const component = modal_component_registry.get(template_id);
	component.unmountTemplate();
	Swal.close();
	await component.whenDisconnected();
	await PetiteVue.nextTick();
}

function close_account_dropdown() {
	const $menu = document.getElementById('header-user-options-dropdown');
	$menu?.classList.remove('show');
	document.getElementById('page-header-user-dropdown')?.setAttribute('aria-expanded', 'false');
}

function close_mobile_sidebar() {
	const page_container = document.getElementById('page-container');
	if (!page_container?.classList.contains('sidebar-o-xs'))
		return;

	document.querySelector('[data-action="sidebar_close"]')?.click();
}

function navigate_page(page) {
	changePage(page);
	close_mobile_sidebar();
}

function capture_equipment_snapshot() {
	const equipped = game.combat?.player?.equipment?.equippedArray ?? [];
	return equipped
		.filter(entry => entry.providesStats && entry.slot?.id && entry.item?.id &&
			entry.item.id !== 'melvorD:Empty_Equipment')
		.map(entry => ({ slot_id: entry.slot.id, item_id: entry.item.id }))
		.sort((a, b) => a.slot_id.localeCompare(b.slot_id));
}

function schedule_equipment_sync(delay = EQUIPMENT_SYNC_DELAY) {
	if (!state.is_connected)
		return;
	clearTimeout(equipment_sync_timer);
	equipment_sync_timer = setTimeout(flush_equipment_sync, delay);
}

async function flush_equipment_sync() {
	equipment_sync_timer = null;
	if (!state.is_connected)
		return;
	if (equipment_sync_in_flight) {
		equipment_sync_pending = true;
		return;
	}

	const slots = capture_equipment_snapshot();
	const serialized = JSON.stringify(slots);
	if (serialized === last_synced_equipment)
		return;

	equipment_sync_in_flight = true;
	let res = null;
	try {
		res = await api_post('/api/client/equipment/sync', { slots });
	} catch (e) {
		log('equipment snapshot synchronization failed (%s)', e);
	}
	equipment_sync_in_flight = false;
	if (res?.success)
		last_synced_equipment = serialized;
	else
		log('equipment snapshot synchronization deferred');

	if (equipment_sync_pending) {
		equipment_sync_pending = false;
		schedule_equipment_sync(0);
	}
}

function get_registered_game_objects(collection) {
	return [...collection?.registeredObjects ?? []]
		.map(entry => Array.isArray(entry) ? entry[1] : entry)
		.filter(Boolean);
}

function get_game_object_id(value) {
	return typeof value === 'string' ? value : value?.id ?? value?.localID ?? null;
}

function capture_status_skills() {
	return get_registered_game_objects(game.skills)
		.map(skill => ({
			skill_id: get_game_object_id(skill),
			level: Number(skill.level ?? skill.currentLevel)
		}))
		.filter(entry => typeof entry.skill_id === 'string' && Number.isSafeInteger(entry.level) && entry.level >= 0)
		.sort((a, b) => a.skill_id.localeCompare(b.skill_id));
}

function capture_status_statistics() {
	const account_creation_date = typeof GeneralStats === 'undefined' ? null :
		Number(game.stats?.General?.get?.(GeneralStats.AccountCreationDate));
	const total_skill_level = Number(game.completion?.skillLevelProgress?.currentCount?.getSum?.());
	return {
		account_creation_date: Number.isSafeInteger(account_creation_date) && account_creation_date > 0
			? account_creation_date : null,
		total_skill_level: Number.isSafeInteger(total_skill_level) && total_skill_level >= 0
			? total_skill_level : null
	};
}

function capture_status_activities() {
	return status_activities.capture_status_activities(game);
}

function capture_expedition_work_statistics() {
	const definitions = [
		['melvorD:Woodcutting', 'Woodcutting', [1]],
		['melvorD:Fishing', 'Fishing', [3]],
		['melvorD:Firemaking', 'Firemaking', [2]],
		['melvorD:Cooking', 'Cooking', [2]],
		['melvorD:Mining', 'Mining', [2]],
		['melvorD:Smithing', 'Smithing', [2]],
		['melvorD:Thieving', 'Thieving', [4]],
		['melvorD:Fletching', 'Fletching', [2]],
		['melvorD:Crafting', 'Crafting', [1]],
		['melvorD:Runecrafting', 'Runecrafting', [1]],
		['melvorD:Herblore', 'Herblore', [1]],
		['melvorD:Agility', 'Agility', [3]],
		['melvorD:Summoning', 'Summoning', [1]],
		['melvorD:Astrology', 'Astrology', [0]],
		['melvorD:Magic', 'Magic', [1]],
		['melvorAoD:Archaeology', 'Archaeology', [2]],
		['melvorAoD:Cartography', 'Cartography', [1, 3, 9]],
		['melvorItA:Harvesting', 'Harvesting', [1]],
		['melvorD:Combat', 'Combat', [7, 8]]
	];
	const time_ms = {};
	for (const [skill_id, tracker_name, stat_ids] of definitions) {
		const tracker = game.stats?.[tracker_name];
		if (typeof tracker?.get !== 'function')
			continue;
		// Keep fractional native counters usable without changing the whole-millisecond wire contract.
		const value = Math.floor(stat_ids.reduce((sum, stat_id) => sum + Number(tracker.get(stat_id) ?? 0), 0));
		if (Number.isSafeInteger(value) && value >= 0)
			time_ms[skill_id] = value;
	}
	return { version: 1, time_ms };
}

function format_expedition_activities(activities) {
	const lines = (activities ?? []).map(activity => activity.type === 'skill'
		? expedition_text('MOD_MP_EXPEDITION_DEBUG_SKILL', activity.skill_id, activity.action_id)
		: expedition_text('MOD_MP_EXPEDITION_DEBUG_COMBAT', activity.area_id ??
			getLangString('MOD_MP_EXPEDITION_DEBUG_UNKNOWN_AREA')));
	return getLangString('MOD_MP_EXPEDITION_DEBUG_DETECTED_WORK') + '\n' +
		(lines.length === 0 ? '- ' + getLangString('MOD_MP_EXPEDITION_DEBUG_NONE') :
			lines.map(line => '- ' + line).join('\n'));
}

function format_expedition_elapsed(elapsed_ms) {
	const total_seconds = Math.max(0, Math.floor(Number(elapsed_ms) / 1000));
	const hours = Math.floor(total_seconds / 3600);
	const minutes = Math.floor((total_seconds % 3600) / 60);
	const seconds = total_seconds % 60;
	return `${hours}h ${minutes}m ${seconds}s`;
}

function format_expedition_debug_report(report, activities, include_timestamps = false) {
	const fields = [
		['SERVER_WALL_TIME', format_expedition_elapsed(report.elapsed_ms)],
		['WOODCUTTING_DELTA', format_expedition_elapsed(report.target_work_ms)],
		['ELIGIBLE_WORK', format_expedition_elapsed(report.total_work_ms)],
		['TIMELINE_CREDIT', format_expedition_elapsed(report.timeline_credit_ms)],
		['STATISTICS_CREDIT', format_expedition_elapsed(report.statistics_credit_ms)],
		['FINAL_CREDIT', format_expedition_elapsed(report.credited_ms)],
		['CONCURRENCY', Number(report.concurrency_factor).toFixed(3) + 'x']
	];
	const lines = fields.map(([field, value]) => expedition_text('MOD_MP_EXPEDITION_DEBUG_' + field, value));
	if (include_timestamps)
		lines.push(`started_at=${report.started_at}`, `server_now=${report.server_now}`);
	return lines.join('\n') + '\n\n' + format_expedition_activities(activities);
}

async function refresh_expedition_tracking() {
	if (!state.is_connected || !state.is_guild_member || state.expedition_tracking_loading)
		return;
	state.expedition_tracking_loading = true;
	try {
		const result = await api_get('/api/expedition/work-tracking');
		state.expedition_tracking_active = result?.active === true;
	} finally {
		state.expedition_tracking_loading = false;
	}
}

const EXPEDITION_PENDING_KEY = 'expedition_pending_report';
const EXPEDITION_CHAMBER_ART = {
	"entrance": "entrance",
	"prismatic_descent": "1.7.0/prismatic-descent",
	"drowned_cloister": "1.7.0/drowned-cloister",
	"rootforge_passage": "1.7.0/rootforge-passage",
	"glassroot_terraces": "1.7.0/glassroot-terraces",
	"tideworn_crypts": "1.7.0/tideworn-crypts",
	"embervein_machinery": "1.7.0/embervein-machinery",
	"mossbound_reliquary": "1.7.0/mossbound-reliquary",
	"buried_observatory": "1.7.0/buried-observatory",
	"prismatic_orrery": "1.7.0/prismatic-orrery",
	"voidwatch_threshold": "1.7.0/voidwatch-threshold",
	"hollow_star": "1.7.0/hollow-star"
};
const EXPEDITION_EXIT_ART = {
	"Prismatic Descent": "1.7.0/prismatic-descent",
	"Drowned Cloister": "1.7.0/drowned-cloister",
	"Rootforge Passage": "1.7.0/rootforge-passage",
	"Glassroot Terraces": "1.7.0/glassroot-terraces",
	"Tideworn Crypts": "1.7.0/tideworn-crypts",
	"Embervein Machinery": "1.7.0/embervein-machinery",
	"Mossbound Reliquary": "1.7.0/mossbound-reliquary",
	"Buried Observatory": "1.7.0/buried-observatory",
	"Prismatic Orrery": "1.7.0/prismatic-orrery",
	"Voidwatch Threshold": "1.7.0/voidwatch-threshold",
	"The Hollow Star": "1.7.0/hollow-star"
};
let last_expedition_work_observed_at = 0;
let last_expedition_check_in_at = 0;

function expedition_hours(milliseconds) {
	return (Math.max(0, Number(milliseconds) || 0) / 3_600_000).toFixed(2);
}

// Display only: balances, quotes, affordability and payments retain exact micro-EP.
function format_ep(points_micros, { round_up = false } = {}) {
	const value = Number(points_micros);
	const micros = Number.isFinite(value) ? Math.max(0, value) : 0;
	const points = round_up ? Math.ceil(micros / 10_000) / 100 : micros / 1_000_000;
	return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(points);
}

function expedition_text(key, ...values) {
	let index = 0;
	return getLangString(key).replace(/%s/g, () => String(values[index++] ?? ''));
}

function expedition_return_story(summary) {
	if (!summary) return '';
	const { weeks, days } = expedition_view.return_duration(summary.registered_at, summary.ended_at);
	const units = {
		HOURS: ['MOD_MP_EXPEDITION_RETURN_HOURS_ONE', 'MOD_MP_EXPEDITION_RETURN_HOURS_MANY'],
		CHAMBERS: ['MOD_MP_EXPEDITION_RETURN_CHAMBERS_ONE', 'MOD_MP_EXPEDITION_RETURN_CHAMBERS_MANY'],
		WEEKS: ['MOD_MP_EXPEDITION_RETURN_WEEKS_ONE', 'MOD_MP_EXPEDITION_RETURN_WEEKS_MANY'],
		DAYS: ['MOD_MP_EXPEDITION_RETURN_DAYS_ONE', 'MOD_MP_EXPEDITION_RETURN_DAYS_MANY']
	};
	const quantity = (kind, value) => expedition_text(units[kind][value === 1 ? 0 : 1], value);
	return expedition_text('MOD_MP_EXPEDITION_RETURN_STORY',
		quantity('HOURS', Math.floor(summary.contributed_ms / 3_600_000)),
		quantity('CHAMBERS', summary.chamber_count), quantity('WEEKS', weeks), quantity('DAYS', days));
}

async function claim_expedition_bonus(expedition_id) {
	if (state.expedition_action_pending || !state.is_connected) return;
	const generation = session_generation;
	state.expedition_action_pending = true;
	try {
		const result = await api_post('/api/expedition/ending/claim', { expedition_id });
		if (generation !== session_generation) return;
		if (!result?.success) expedition_notify(getLangString(result?.error_lang ?? 'MOD_MP_EXPEDITION_RETURN_CLAIM_FAILED'), 'danger');
		await refresh_expedition_state();
	} finally {
		if (generation === session_generation) state.expedition_action_pending = false;
	}
}

function expedition_status(kind, value) {
	const key = `MOD_MP_EXPEDITION_${kind}_${String(value ?? '').toUpperCase()}`;
	return loadedLangJson?.[key] ? getLangString(key) : String(value ?? '');
}

function format_time_remaining(expires_at, now) {
	const remaining = expires_at - now;
	if (!Number.isSafeInteger(expires_at) || remaining <= 0)
		return '0m';

	const total_minutes = Math.ceil(remaining / 60_000);
	const days = Math.floor(total_minutes / (24 * 60));
	const hours = Math.floor((total_minutes % (24 * 60)) / 60);
	const minutes = total_minutes % 60;
	if (days > 0)
		return `${days}d ${hours}h`;
	if (hours > 0)
		return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}


function expedition_time_remaining(timestamp) {
	return format_time_remaining(timestamp, state.expedition_clock_time);
}

function expedition_time_since(timestamp) {
	const minutes = Math.max(0, Math.floor((state.expedition_clock_time - Number(timestamp)) / 60_000) || 0);
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor((minutes % 1440) / 60);
	return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

let expedition_page_visible = false;
function set_expedition_page_visible(is_visible) {
	expedition_page_visible = is_visible;
	clearInterval(expedition_clock_timer);
	expedition_clock_timer = null;
	if (!is_visible) return;
	state.expedition_clock_time = Date.now();
	state.expedition_active_activities = capture_status_activities();
	expedition_clock_timer = setInterval(() => {
		state.expedition_clock_time = Date.now();
		void expedition_leaderboard?.refresh();
	}, EXPEDITION_CLOCK_INTERVAL);
	void expedition_leaderboard?.refresh();
	void refresh_expedition_state();
	if (is_visible) void combat_inventory?.refresh();
}

let expedition_work_prompt_gate = null;
let expedition_work_prompt_loading = false;

async function maybe_start_expedition_work(activities) {
	if (offline_work_gate?.pending() || !state.is_connected) return;
	const current_model = state.expedition_state ?? state.expedition_personal;
	const current_tracking = state.expedition_state?.tracking ?? state.expedition_personal?.tracking;
	expedition_work_prompt_gate ??= expedition_tasks.create_work_prompt_gate();
	const due = expedition_work_prompt_gate.observe({ session: session_generation, activities,
		enabled: true, automatic: true,
		tracking: !!state.expedition_pending_report || !!current_tracking &&
			!expedition_tasks.should_prefer_equipment(current_model, activities),
		now: Date.now() });
	if (!due || expedition_work_prompt_loading || state.expedition_loading || state.expedition_action_pending) return;
	const generation = session_generation;
	const activity_key = expedition_tasks.work_activity_key(activities);
	expedition_work_prompt_loading = true;
	try {
		const refreshed = await refresh_expedition_state();
		if (generation !== session_generation || !state.is_connected || !polling.is_foreground(document) ||
			activity_key !== expedition_tasks.work_activity_key(capture_status_activities())) return;
		// Retry unavailable work; settle competing chamber tracking before selecting project work.
		expedition_work_prompt_gate.defer(Date.now(), 30_000);
		if (!refreshed || state.expedition_action_pending || state.expedition_pending_report) return;
		const model = state.expedition_state ?? state.expedition_personal;
		const tracking = state.expedition_state?.tracking ?? state.expedition_personal?.tracking;
		if (tracking) {
			// Settle chamber work before a matching project takes over. Never bypass a pending claim.
			if (expedition_tasks.should_prefer_equipment(model, activities) &&
				tracking.source !== 'equipment' && !tracking.pending_boundary_at && !tracking.claim) {
				await submit_expedition_work('stop', null, true, true);
				expedition_work_prompt_gate.defer(Date.now(), 2500);
			}
			return;
		}
		const task = expedition_tasks.best_eligible_task(model, activities);
		if (task) await submit_expedition_work('start', task.task_id, true);
	} finally {
		expedition_work_prompt_loading = false;
	}
}

function expedition_notify(message, theme = 'success') {
	const generation = session_generation;
	if (offline_work_gate?.defer_notice(() => {
		if (generation === session_generation) expedition_notify(message, theme);
	})) return;
	notifyPlayer({ media: ctx.getResourceUrl('assets/multiplayer.svg') }, message, theme, 1);
}

let last_expedition_tracking_notice_session = null;

function notify_expedition_tracking_ended(previous, next, message) {
	const generation = session_generation;
	if (offline_work_gate?.defer_notice(() => {
		if (generation === session_generation) notify_expedition_tracking_ended(previous, next, message);
	})) return;
	const notice_session = previous ? `${session_generation}:${previous.session_id}` : null;
	if (!previous || previous.pending_boundary_at ||
		(next && !next.pending_boundary_at && next.expedition_id === previous.expedition_id &&
			next.visit_id === previous.visit_id && next.task_id === previous.task_id) ||
		last_expedition_tracking_notice_session === notice_session) return;
	last_expedition_tracking_notice_session = notice_session;
	addModalToQueue({
		title: getLangString('MOD_MP_EXPEDITION_TASK_TRACKING_ENDED'),
		text: message,
		icon: 'info',
		timer: 4000,
		timerProgressBar: true,
		showConfirmButton: false
	});
}

function start_expedition_action_cooldown(field, duration) {
	const until = Date.now() + duration;
	state[field] = until;
	setTimeout(() => { if (state[field] === until) state[field] = 0; }, duration);
}

function expedition_percent(task) {
	return Math.min(100, Math.floor(100 * ((task.player_ms ?? 0) + (task.system_ms ?? 0)) / task.target_ms));
}

function expedition_work_name(skill_id) {
	if (skill_id === 'melvorD:Combat') return getLangString('MOD_MP_EXPEDITION_SKILL_COMBAT');
	return expedition_view.work_skill_name(game, skill_id);
}

function expedition_work_icon(skill_id) {
	return expedition_view.work_skill_icon(game, skill_id);
}

function expedition_can_track(task, activities = state.expedition_active_activities) {
	return expedition_tasks.can_track_task(task, activities);
}

function expedition_remaining(task) {
	const remaining = expedition_tasks.task_remaining(task);
	if (remaining === 'Complete') return getLangString('MOD_MP_EXPEDITION_COMPLETE');
	return expedition_text('MOD_MP_EXPEDITION_TIME_REMAINING', remaining.slice(0, -' remaining'.length));
}

function expedition_progress_width(milliseconds, task) {
	return task.target_ms > 0 ? Math.min(100, 100 * Math.max(0, milliseconds || 0) / task.target_ms) + '%' : '0%';
}

function expedition_other_player_ms(task) {
	return Math.max(0, (task.player_ms ?? 0) - (task.personal_ms ?? 0));
}

function expedition_contribution_time(milliseconds) {
	return expedition_tasks.task_contribution_time(milliseconds);
}

function expedition_progress_description(task) {
	const contributions = [
		['MOD_MP_EXPEDITION_YOUR_WORK_TIME', task.personal_ms],
		['MOD_MP_EXPEDITION_OTHER_WORK_TIME', expedition_other_player_ms(task)],
		['MOD_MP_EXPEDITION_ASSISTANCE_TIME', task.system_ms]
	].map(([key, milliseconds]) => [key, expedition_contribution_time(milliseconds)])
		.filter(([, time]) => time !== null)
		.map(([key, time]) => expedition_text(key, time));
	return `${expedition_remaining(task)}. ${expedition_text('MOD_MP_EXPEDITION_PERCENT_COMPLETE', expedition_percent(task))}${contributions.length ? `. ${contributions.join('; ')}` : ''}.`;
}

function toggle_expedition_phase(phase) {
	if (!['arrival', 'exploration', 'departure'].includes(phase)) return;
	state.expedition_phase_open = {
		...state.expedition_phase_open,
		[phase]: !state.expedition_phase_open[phase]
	};
}

async function read_expedition_state(expand_on_open = true) {
	const generation = session_generation;
	const tracking_only = !expedition_page_visible;
	if (state.is_guild_member === false) {
		state.expedition_state = null;
		const personal = await api_get('/api/expedition/personal');
		if (generation !== session_generation) return null;
		if (personal?.contract_version === 1) {
			equipment_evidence.configure(personal.equipment_projects?.project ? [personal.equipment_projects.project] : []);
			if (state.combat) state.combat.equipment_projects = personal.equipment_projects;
			state.expedition_personal = personal; last_expedition_state_refresh_at = Date.now();
		}
		return personal;
	}
	let result = await api_get('/api/expedition/state' + (tracking_only ? '?view=tracking' : ''));
	if (generation !== session_generation) return null;
	// Opening the page while a recovery read is in flight needs the full model too.
	if (expand_on_open && tracking_only && expedition_page_visible) {
		result = await api_get('/api/expedition/state');
		if (generation !== session_generation) return null;
	}
	if (result?.contract_version === 1) {
		equipment_evidence.configure(result.equipment_projects?.project ? [result.equipment_projects.project] : []);
		if (state.combat) state.combat.equipment_projects = result.equipment_projects;
		last_expedition_state_refresh_at = Date.now();
		expedition_view.sync_phase_state(state, result.expedition?.chamber);
		state.expedition_state = result;
		if (state.expedition_personal) {
			state.expedition_personal.points_micros = result.points_micros;
			state.expedition_personal.tracking = result.tracking;
			state.expedition_personal.equipment_projects = result.equipment_projects;
		}
	}
	return result;
}

async function refresh_expedition_state(reconnect = false) {
	if (offline_work_gate?.blocked()) return false;
	if (!state.is_connected || state.expedition_loading) return;
	const tracking_only = !expedition_page_visible;
	const guildless_at_start = state.is_guild_member === false;
	const phase_started = performance.now();
	const generation = session_generation;
	state.expedition_loading = true;
	try {

		const result = await read_expedition_state(false);
		if (generation !== session_generation) return;
		let hydrated = result?.contract_version === 1;
		if (result?.error_lang) {
			state.expedition_state = null;
			expedition_notify(getLangString(result.error_lang), 'danger');
			const personal = await api_get('/api/expedition/personal');
			if (generation !== session_generation) return;
			state.expedition_personal = personal;
			hydrated = personal?.contract_version === 1;
		}
		if (!hydrated) return false;
		const pending = get_instance_storage_item(EXPEDITION_PENDING_KEY);
		state.expedition_pending_report = pending && typeof pending === 'object' ? pending : null;
		if (state.expedition_pending_report) await retry_expedition_report(true);
		else if (expedition_view.tracked_task_ended(result))
			await submit_expedition_work('stop', null, true);
		else if (reconnect) {
			const tracking = result?.tracking ?? state.expedition_personal?.tracking;
			const history = state.expedition_personal?.history?.find(entry => entry.expedition_id === tracking?.expedition_id);
			if (tracking && !tracking.pending_boundary_at && history?.status !== 'inactive' && result?.expedition?.status !== 'inactive')
				await submit_expedition_work('check-in', tracking.task_id, true);
		}
		return hydrated;
	} finally {
		if (generation === session_generation) {
			state.expedition_loading = false;
			transport_diagnostics?.phase('expedition', performance.now() - phase_started);
			update_expedition_nav();
			if ((tracking_only && expedition_page_visible) || (guildless_at_start && state.is_guild_member === true))
				void refresh_expedition_state();
		}
	}
}

async function register_expedition() {
	if (state.expedition_action_pending) return;
	state.expedition_action_pending = true;
	try {
		const result = await api_post('/api/expedition/register', { operation_id: crypto.randomUUID(), content_version: 3 });
		if (result?.success) await refresh_expedition_state();
		else expedition_notify(result?.error_lang ? getLangString(result.error_lang) : getLangString('MOD_MP_EXPEDITION_REGISTRATION_FAILED'), 'danger');
	} finally {
		state.expedition_action_pending = false;
	}
}

async function retry_expedition_report(automatic = false, quiet = false) {
	const pending = state.expedition_pending_report;
	if (!pending || state.expedition_action_pending || offline_work_gate?.blocked() ||
		(!automatic && offline_work_gate?.pending())) return;
	const report_generation = session_generation;
	const previous_tracking = state.expedition_state?.tracking ?? state.expedition_personal?.tracking;
	state.expedition_action_pending = true;
	const notice_delay = Math.max(0, 5000 - (Date.now() - (pending.payload?.captured_at ?? Date.now())));
	if (notice_delay === 0) state.expedition_report_notice_visible = true;
	const notice_timer = setTimeout(() => {
		if (report_generation === session_generation &&
			state.expedition_pending_report?.payload?.operation_id === pending.payload.operation_id)
			state.expedition_report_notice_visible = true;
	}, notice_delay);
	try {
		let result = await api_post(pending.endpoint, pending.payload);
		if (report_generation !== session_generation) return;
		if (!result?.success && !result?.pending) state.expedition_report_notice_visible = true;
		if (automatic && result === null && !offline_work_gate?.blocked()) result = await api_post(pending.endpoint, pending.payload);
		if (report_generation !== session_generation) return;
		if (result?.pending) {
			last_expedition_check_in_at = Date.now();
			notify_expedition_tracking_ended(previous_tracking, result.tracking,
				getLangString('MOD_MP_EXPEDITION_ACTIVITY_CHANGED_PENDING'));
			remove_instance_storage_item(EXPEDITION_PENDING_KEY);
			state.expedition_pending_report = null;
			const personal = await api_get('/api/expedition/personal');
			if (report_generation !== session_generation) return;
			if (personal?.contract_version === 1) {
				equipment_evidence.configure(personal.equipment_projects?.project ? [personal.equipment_projects.project] : []);
				state.expedition_personal = personal;
			}
			if (!personal?.tracking || personal.tracking.session_id !== result.tracking?.session_id) {
				expedition_notify(getLangString('MOD_MP_EXPEDITION_WORK_UNVERIFIED'), 'danger');
			} else expedition_notify(getLangString('MOD_MP_EXPEDITION_WORK_ZERO_AFTER_BOUNDARY'), 'danger');
		} else if (result?.success) {
			const model = state.expedition_state ?? state.expedition_personal;
			if (pending.payload.source === 'equipment' && model) {
				equipment_evidence.configure(result.equipment_projects?.project ? [result.equipment_projects.project] : []);
				if (state.combat) state.combat.equipment_projects = result.equipment_projects;
				for (const target of [state.expedition_state, state.expedition_personal]) if (target) {
					target.tracking = result.tracking; target.equipment_projects = result.equipment_projects;
				}
				if (!result.equipment_projects?.project) void combat_inventory?.refresh();
			}
			last_expedition_check_in_at = Date.now();
			remove_instance_storage_item(EXPEDITION_PENDING_KEY);
			state.expedition_pending_report = null;
			const credited = result.settlement?.credited_ms ?? 0;
			let notice = result.settlement
				? expedition_text('MOD_MP_EXPEDITION_HOURS_CREDITED', expedition_hours(credited), expedition_status('REASON', result.settlement.reason), result.tracking ? getLangString('MOD_MP_EXPEDITION_TRACKING_CONTINUES') : getLangString('MOD_MP_EXPEDITION_TRACKING_ENDED'))
				: result.tracking ? getLangString('MOD_MP_EXPEDITION_TRACKING_ACCEPTED') : getLangString('MOD_MP_EXPEDITION_TASK_TRACKING_ENDED');
			if (result.warning === 'task_unavailable')
				notice += getLangString('MOD_MP_EXPEDITION_TASK_UNAVAILABLE');
			if (result.warning === 'fresh_snapshot_required')
				notice += getLangString('MOD_MP_EXPEDITION_FRESH_SNAPSHOT');
			if (!quiet || !result.tracking || credited === 0 || result.warning) expedition_notify(notice);
			notify_expedition_tracking_ended(previous_tracking, result.tracking, notice);
			// Personal work leaves chamber state unchanged; its independent refresh clock still runs.
			// Replays, older servers and boundary recovery retain an authoritative refresh.
			const current_equipment = pending.payload.source === 'equipment' && model && result.equipment_projects &&
				result.equipment_work_current === true && !result.warning;
			const refreshed = current_equipment ? { contract_version: 1 } : await read_expedition_state();
			if (report_generation !== session_generation) return;
			if (refreshed?.contract_version !== 1) {
				const personal = await api_get('/api/expedition/personal');
				if (report_generation !== session_generation) return;
				state.expedition_personal = personal;
			}
		} else {
			const terminal = new Set(['task_unavailable', 'activity_required', 'expedition_unavailable', 'work_source_unavailable',
				'invalid_capture_time', 'boundary_capture_mismatch', 'tracking_identity_mismatch', 'no_active_tracking', 'operation_conflict',
				'claim_pending', 'tracking_busy']);
			if (terminal.has(result?.error)) {
				remove_instance_storage_item(EXPEDITION_PENDING_KEY);
				state.expedition_pending_report = null;
				await read_expedition_state();
			}
			expedition_notify(result?.error === 'activity_required'
				? getLangString('MOD_MP_EXPEDITION_ACTIVITY_REQUIRED')
				: result?.error === 'tracking_busy' ? getLangString('MOD_MP_EQUIPMENT_TRACKING_BUSY')
				: getLangString('MOD_MP_EXPEDITION_WORK_REPORT_FAILED'), 'danger');
		}
	} finally {
		clearTimeout(notice_timer);
		if (report_generation === session_generation) {
			state.expedition_report_notice_visible = !!state.expedition_pending_report;
			state.expedition_action_pending = false;
			update_expedition_nav();
		}
	}
}

async function maybe_auto_check_in_expedition() {
	if (offline_work_gate?.pending()) return;
	if (!state.is_connected || !polling.is_foreground(document) || state.expedition_loading ||
		state.expedition_action_pending || Date.now() - last_expedition_check_in_at < EXPEDITION_AUTO_CHECK_IN_INTERVAL)
		return;
	const tracking = state.expedition_state?.tracking ?? state.expedition_personal?.tracking;
	if (!state.expedition_pending_report && (!tracking || tracking.pending_boundary_at)) return;
	// Reuse the saved report after a lost response; never replace it with fresh statistics.
	last_expedition_check_in_at = Date.now();
	if (state.expedition_pending_report) await retry_expedition_report(true, true);
	else await submit_expedition_work('check-in', tracking.task_id, true, true);
}

function save_expedition_report(pending) {
	try {
		set_instance_storage_item(EXPEDITION_PENDING_KEY, pending);
		if (get_instance_storage_item(EXPEDITION_PENDING_KEY)?.payload?.operation_id === pending.payload.operation_id) return true;
	} catch (e) {
		log('work report persistence failed (%s)', e);
	}
	expedition_notify(getLangString('MOD_MP_EXPEDITION_WORK_STORAGE_FAILED'), 'danger');
	return false;
}

async function submit_expedition_work(kind, task_id = null, automatic = false, quiet = false) {
	if (offline_work_gate?.blocked() || (!automatic && offline_work_gate?.pending())) return;
	if (state.expedition_action_pending || state.expedition_pending_report) return;
	if (kind === 'check-in' && !automatic && Date.now() < state.expedition_check_in_cooldown_until) return;
	const expedition = state.expedition_state?.expedition;
	const tracking = state.expedition_state?.tracking ?? state.expedition_personal?.tracking;
	if (tracking?.pending_boundary_at) return;
	const activities = capture_status_activities();
	const model = state.expedition_state ?? state.expedition_personal;
	const personal_task = model?.equipment_projects?.project?.stages?.flat().find(task => task.task_id === task_id);
	const equipment = kind === 'start' ? !!personal_task : tracking?.source === 'equipment';
	if (equipment) {
		if (kind === 'start' && (tracking || !personal_task?.available || !activities.some(activity =>
			expedition_tasks.equipment_activity_matches(personal_task, activity)))) return;
		const actions = equipment_evidence.snapshot(kind === 'start' ? task_id : tracking.task_id);
		if (!actions) return;
		const payload = { source: 'equipment', operation_id: crypto.randomUUID(), project_id: kind === 'start' ? model.equipment_projects.project.id : tracking.project_id,
			task_id: kind === 'start' ? task_id : tracking.task_id, captured_at: Date.now(), activities,
			statistics: capture_expedition_work_statistics(), actions };
		const pending = { endpoint: `/api/expedition/task/${kind}`, payload };
		if (!save_expedition_report(pending)) return;
		state.expedition_pending_report = pending; state.expedition_report_notice_visible = false;
		await retry_expedition_report(automatic, quiet);
		return;
	}
	if (tracking?.source === 'equipment') return;
	if (kind === 'start') {
		state.expedition_active_activities = activities;
		const task = expedition?.chamber?.tasks?.find(entry => entry.task_id === task_id);
		if (!expedition_can_track(task, activities)) {
			expedition_notify(getLangString('MOD_MP_EXPEDITION_ACTIVITY_REQUIRED'), 'danger');
			return;
		}
	}
	const expedition_id = kind === 'start' ? expedition?.id : tracking?.expedition_id;
	const visit_id = kind === 'start' ? expedition?.chamber?.visit_id : tracking?.visit_id;
	if (!expedition_id || !visit_id) return;
	const payload = {
		operation_id: crypto.randomUUID(), expedition_id, visit_id,
		task_id, captured_at: Date.now(),
		activities, statistics: capture_expedition_work_statistics()
	};
	const pending = { endpoint: `/api/expedition/task/${kind}`, payload };
	if (!save_expedition_report(pending)) return;
	state.expedition_report_notice_visible = false;
	state.expedition_pending_report = pending;
	if (kind === 'check-in' && !automatic)
		start_expedition_action_cooldown('expedition_check_in_cooldown_until', EXPEDITION_CHECK_IN_COOLDOWN);
	await retry_expedition_report(automatic, quiet);
}

async function vote_expedition_exit(exit_id) {
	if (state.expedition_action_pending || Date.now() < state.expedition_vote_cooldown_until) return;
	const expedition = state.expedition_state?.expedition;
	if (!expedition?.chamber) return;
	state.expedition_action_pending = true;
	start_expedition_action_cooldown('expedition_vote_cooldown_until', EXPEDITION_VOTE_COOLDOWN);
	try {
		const result = await api_post('/api/expedition/vote', {
			operation_id: crypto.randomUUID(), expedition_id: expedition.id,
			visit_id: expedition.chamber.visit_id, exit_id
		});
		if (result?.success) {
			expedition_notify(getLangString('MOD_MP_EXPEDITION_VOTE_RECORDED'));
			const refreshed = await api_get('/api/expedition/state');
			if (refreshed?.contract_version === 1) state.expedition_state = refreshed;
		} else {
			const error_lang_id = localization.expedition_vote_error_lang_id(result?.error, result?.error_lang);
			expedition_notify(getLangString(error_lang_id ?? 'MOD_MP_EXPEDITION_VOTE_FAILED'), 'danger');
		}
	} finally {
		state.expedition_action_pending = false;
		update_expedition_nav();
	}
}

async function debug_advance_expedition(action, task_id = null) {
	if (!state.expedition_state?.debug_enabled || state.expedition_action_pending) return;
	const expedition = state.expedition_state.expedition;
	if (!expedition) return;
	state.expedition_action_pending = true;
	try {
		const result = await api_post('/api/expedition/debug/advance', {
			expedition_id: expedition.id, visit_id: expedition.chamber?.visit_id ?? null,
			action, task_id
		});
		if (result?.success) {
			expedition_notify(getLangString('MOD_MP_EXPEDITION_TEST_ADVANCE_APPLIED'));
		} else expedition_notify(result?.error ?? getLangString('MOD_MP_EXPEDITION_TEST_ADVANCE_FAILED'), 'danger');
		const refreshed = await api_get('/api/expedition/state');
		if (refreshed?.contract_version === 1) state.expedition_state = refreshed;
	} finally {
		state.expedition_action_pending = false;
		update_expedition_nav();
	}
}

function show_expedition_debug_confirmation(action) {
	if (!state.expedition_state?.debug_enabled || !['cancel', 'wipe'].includes(action)) return;
	state.expedition_debug_action = action;
	queue_modal(action === 'cancel' ? 'MOD_MP_EXPEDITION_UI_CANCEL_EXPEDITION' : 'MOD_MP_EXPEDITION_UI_WIPE_DATA',
		'expedition-debug-confirm-modal', 'assets/multiplayer.svg', { showConfirmButton: false });
}

async function confirm_expedition_debug_action() {
	if (!state.expedition_state?.debug_enabled || state.expedition_action_pending) return;
	const action = state.expedition_debug_action;
	if (!['cancel', 'wipe'].includes(action)) return;
	state.expedition_action_pending = true;
	try {
		const result = await api_post(`/api/expedition/debug/${action}`, action === 'cancel'
			? { expedition_id: state.expedition_state.expedition?.id }
			: { current_expedition_id: ['registration', 'active'].includes(state.expedition_state.expedition?.status)
				? state.expedition_state.expedition.id : null, confirm: 'WIPE EXPEDITION DATA' });
		if (!result?.success) {
			expedition_notify(getLangString('MOD_MP_EXPEDITION_TEST_ACTION_FAILED'), 'danger');
			return;
		}
		await close_modal_and_wait('expedition-debug-confirm-modal');
		if (action === 'wipe') {
			remove_instance_storage_item(EXPEDITION_PENDING_KEY);
			state.expedition_pending_report = null;
			state.expedition_personal = null;
		}
		await refresh_expedition_state();
		expedition_notify(action === 'wipe' ? getLangString('MOD_MP_EXPEDITION_DATA_WIPED') : getLangString('MOD_MP_EXPEDITION_CANCELLED'));
	} finally {
		state.expedition_action_pending = false;
	}
}

async function begin_expedition_woodcutting_tracking() {
	if (state.expedition_tracking_loading || offline_work_gate?.blocked())
		return;
	const activities = capture_status_activities();
	state.expedition_debug_text = format_expedition_activities(activities);
	const woodcutting = activities.some(activity =>
		activity.type === 'skill' && activity.skill_id === 'melvorD:Woodcutting');
	if (!woodcutting) {
		state.expedition_debug_text += '\n\n' + getLangString('MOD_MP_EXPEDITION_DEBUG_WOODCUTTING_MISSING');
		return;
	}
	state.expedition_tracking_loading = true;
	try {
		const statistics = capture_expedition_work_statistics();
		const result = await api_post('/api/expedition/work-tracking/start', { activities, statistics });
		state.expedition_tracking_active = result?.active === true;
		state.expedition_debug_text += result?.success === true
			? '\n\n' + getLangString('MOD_MP_EXPEDITION_DEBUG_TRACKING_STARTED')
			: '\n\n' + getLangString('MOD_MP_EXPEDITION_DEBUG_TRACKING_REJECTED');
	} finally {
		state.expedition_tracking_loading = false;
	}
}

async function check_in_expedition_tracking() {
	if (state.expedition_tracking_loading || offline_work_gate?.blocked())
		return;
	state.expedition_tracking_loading = true;
	try {
		const activities = capture_status_activities();
		const statistics = capture_expedition_work_statistics();
		const result = await api_post('/api/expedition/work-tracking/check-in', { activities, statistics });
		state.expedition_tracking_active = false;
		addModalToQueue({
			title: getLangString('MOD_MP_EXPEDITION_CHECK_IN_TITLE'),
			text: result?.success === true ? format_expedition_debug_report(result, activities, true)
				: getLangString('MOD_MP_EXPEDITION_DEBUG_NO_TRACKING'),
			icon: result?.success === true ? 'info' : 'warning'
		});
	} finally {
		state.expedition_tracking_loading = false;
	}
}

function capture_status_snapshot() {
	const activities = capture_status_activities();
	return {
		skills: capture_status_skills(),
		...capture_status_statistics(),
		activities,
		gp: capture_gp()
	};
}

function update_local_status_member(snapshot) {
	if (!Number.isSafeInteger(state.guild_client_id))
		return;

	const update = member => member.client_id === state.guild_client_id
		? { ...member,
			...(state.skills_visible ? { skills_visible: true, skills_available: true } : {}),
			...(state.activity_visible ? { activity_visible: true, activity_available: true, status_activity: snapshot.activities[0] ?? { type: 'idle' }, status_activities: [...snapshot.activities] } : {}),
			account_age: snapshot.account_creation_date === null ? null :
				Math.max(0, Date.now() - snapshot.account_creation_date),
			total_skill_level: state.skills_visible ? snapshot.total_skill_level : null }
		: member;
	state.guild_members = state.guild_members.map(update);
	if (state.selected_guild_member?.client_id === state.guild_client_id)
		state.selected_guild_member = update(state.selected_guild_member);
}

function invalidate_status_icon_collection() {
	status_icon_discovery_generation++;
}

function queue_status_icon_collection(skills) {
	const generation = ++status_icon_discovery_generation;
	status_icon_collection_queue = status_icon_collection_queue
		.catch(() => null)
		.then(() => collect_status_icon_catalog(skills, generation));
}

async function collect_status_icon_catalog(skills, generation) {
	if (!state.skills_visible || icon_catalog_discovery === null || icon_catalog_collection === null)
		return;
	const is_collection_allowed = () => state.skills_visible && generation === status_icon_discovery_generation;
	try {
		await icon_catalog_collection.collect_skill_icon_candidates(skills, {
			discover_candidates: async snapshot => {
				const manifest = await icon_catalog_discovery.discover_skill_icon_candidates(snapshot, {
					resolve_skill: skill_id => game.skills?.getObjectByID?.(skill_id),
					resolve_media_url: media => ctx.getResourceUrl(media),
					on_diagnostic: diagnostic => log('skill icon discovery skipped %s (%s)', diagnostic.skill_id, diagnostic.stage)
				});
				return manifest;
			},
			check_manifest: async manifest => {
				if (!is_collection_allowed())
					return null;
				const result = await api_post_response('/api/client/icon-catalog/check', { icons: manifest });
				return result.response?.status === 200 ? result.json : null;
			},
			upload_candidate: async (candidate, request) => {
				if (!is_collection_allowed())
					return false;
				return await api_post_binary_response('/api/client/icon-catalog/upload', candidate.bytes,
					candidate.media_type, request.upload_token);
			},
			is_collection_allowed,
			on_diagnostic: diagnostic => {
				if (diagnostic.skill_id)
					log('skill icon collection skipped %s (%s)', diagnostic.skill_id, diagnostic.stage);
				else
					log('skill icon collection failed (%s)', diagnostic.stage);
			}
		});
	} catch (e) {
		if (is_collection_allowed())
			log('skill icon collection failed (%s)', e);
	}
}

function capture_gp() {
	const amount = Number(game.gp?.amount);
	return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function serialize_status_activities(activities) {
	return status_activities.status_activities_sync_signature(activities);
}

function serialize_status_statistics(snapshot, include_total_skill_level = true) {
	return JSON.stringify({
		account_creation_date: snapshot.account_creation_date,
		...(include_total_skill_level ? { total_skill_level: snapshot.total_skill_level } : {})
	});
}

function format_status_account_age(account_age, precision = 'minute') {
	const language = typeof setLang === 'string' && setLang.length > 0 ? setLang : 'en';
	return status_statistics?.format_account_age(account_age, language, getLangString, precision) ?? '';
}

function status_sync_allowed() {
	return !offline_work_gate?.pending();
}

function schedule_status_sync(delay = STATUS_SYNC_DELAY, enforce_minimum = true) {
	if (!state.is_connected || !status_sync_allowed() || !polling.is_foreground(document))
		return;
	if (enforce_minimum)
		delay = Math.max(delay, last_status_sync_at + STATUS_MIN_SYNC_INTERVAL - Date.now());
	clearTimeout(status_sync_timer);
	status_sync_timer = setTimeout(flush_status_sync, Math.max(0, delay));
}

async function flush_status_sync() {
	status_sync_timer = null;
	if (!state.is_connected || !status_sync_allowed() || !polling.is_foreground(document))
		return;
	if (status_sync_in_flight) {
		status_sync_pending = true;
		return;
	}

	const snapshot = capture_status_snapshot();
	const serialized_skills = JSON.stringify(snapshot.skills);
	const serialized_statistics = serialize_status_statistics(snapshot);
	const serialized_activities = serialize_status_activities(snapshot.activities);
	const payload = {};
	if (serialized_skills !== last_synced_status_skills)
		payload.skills = snapshot.skills;
	if (serialized_statistics !== last_synced_status_statistics) {
		payload.account_creation_date = snapshot.account_creation_date;
		payload.total_skill_level = snapshot.total_skill_level;
	}
	if (serialized_activities !== last_synced_status_activities ||
		(state.expedition_state?.tracking && !state.expedition_pending_report &&
			Date.now() - last_expedition_work_observed_at >= 15 * 60_000))
		payload.activities = snapshot.activities;
	if (payload.activities !== undefined)
		payload.work_statistics = capture_expedition_work_statistics();
	if (snapshot.gp !== null && snapshot.gp !== last_synced_gp)
		payload.gp = snapshot.gp;
	if (payload.skills === undefined && payload.account_creation_date === undefined &&
		payload.activities === undefined && payload.gp === undefined) {
		status_sync_failures = 0;
		return;
	}

	const request_generation = session_generation;
	status_sync_in_flight = true;
	last_status_sync_at = Date.now();
	const previous_expedition_tracking = state.expedition_state?.tracking ?? state.expedition_personal?.tracking;
	let res = null;
	try {
		res = await api_post('/api/client/status/sync', payload);
	} catch (e) {
		log('player status synchronization failed (%s)', e);
	}
	status_sync_in_flight = false;
	if (request_generation !== session_generation) {
		status_sync_pending = false;
		if (state.is_connected)
			schedule_status_sync(0);
		return;
	}
	if (res?.success) {
		status_sync_failures = 0;
		if (payload.skills !== undefined || payload.account_creation_date !== undefined || payload.activities !== undefined)
			update_local_status_member(snapshot);
		if (payload.skills !== undefined) {
			last_synced_status_skills = serialized_skills;
			if (state.skills_visible)
				queue_status_icon_collection(snapshot.skills);
		}
		if (payload.account_creation_date !== undefined || payload.total_skill_level !== undefined)
			last_synced_status_statistics = serialized_statistics;
		if (payload.activities !== undefined)
			last_synced_status_activities = serialized_activities;
		if (payload.work_statistics !== undefined && state.expedition_state?.tracking)
			last_expedition_work_observed_at = Date.now();
		if (payload.gp !== undefined)
			last_synced_gp = payload.gp;
		if (res.work_tracking_stopped) {
			state.expedition_tracking_active = false;
			const stopped = res.work_tracking_stopped;
			addModalToQueue({
				title: getLangString('MOD_MP_EXPEDITION_STOPPED_TITLE'),
				text: format_expedition_debug_report(stopped, stopped.activities),
				icon: 'info'
			});
		}
		if (res.expedition_work_stopped?.pending) {
			notify_expedition_tracking_ended(previous_expedition_tracking,
				null, getLangString('MOD_MP_EXPEDITION_ACTIVITY_CHANGED_PENDING'));
			expedition_notify(getLangString('MOD_MP_EXPEDITION_ACTIVITY_CHANGED_PENDING'));
			void refresh_expedition_state();
		} else if (res.expedition_work_stopped?.success) {
			notify_expedition_tracking_ended(previous_expedition_tracking,
				null, expedition_text('MOD_MP_EXPEDITION_ACTIVITY_CHANGED_CREDIT',
					expedition_hours(res.expedition_work_stopped.credited_ms),
					expedition_status('REASON', res.expedition_work_stopped.reason)));
			expedition_notify(expedition_text('MOD_MP_EXPEDITION_ACTIVITY_CHANGED_CREDIT',
				expedition_hours(res.expedition_work_stopped.credited_ms),
				expedition_status('REASON', res.expedition_work_stopped.reason)));
			if (state.expedition_state) state.expedition_state.tracking = null;
			void refresh_expedition_state();
		}
	}
	else {
		status_sync_failures = Math.min(status_sync_failures + 1, 5);
		log('player status synchronization deferred');
	}

	if (status_sync_pending) {
		status_sync_pending = false;
		schedule_status_sync(0);
	} else if (!res?.success && state.is_connected)
		schedule_status_sync(polling.retry_poll_delay(status_sync_failures), false);
}

function observe_status_changes() {
	void offline_work_gate?.pump();
	if (!state.is_connected || !status_sync_allowed() || !polling.is_foreground(document))
		return;

	const snapshot = capture_status_snapshot();
	const serialized_activities = serialize_status_activities(snapshot.activities);
	const serialized_statistics = serialize_status_statistics(snapshot);
	state.expedition_active_activities = snapshot.activities;
	update_expedition_nav(snapshot.activities);
	const tracking = (state.expedition_state ?? state.expedition_personal)?.tracking;
	if (tracking?.source === 'equipment' && !state.expedition_action_pending && !state.expedition_pending_report &&
		(!snapshot.activities.some(activity => expedition_tasks.equipment_activity_matches({ skill_id: tracking.task_id.split('|')[0], action_id: tracking.task_id.split('|')[1] }, activity)) || Date.now() - last_expedition_check_in_at >= 30000))
		void submit_expedition_work('check-in', tracking.task_id, true, true);
	void maybe_start_expedition_work(snapshot.activities);
	if (serialized_activities === last_observed_status_activities &&
		serialized_statistics === last_observed_status_statistics)
		return;

	last_observed_status_activities = serialized_activities;
	last_observed_status_statistics = serialized_statistics;
	schedule_status_sync();
}

function start_status_observer() {
	if (status_observer_timer !== null || !state.is_connected ||
		!polling.is_foreground(document))
		return;

	observe_status_changes();
	status_observer_timer = setInterval(observe_status_changes, STATUS_OBSERVER_INTERVAL);
}

function stop_status_observer() {
	if (status_observer_timer !== null)
		clearInterval(status_observer_timer);
	status_observer_timer = null;
	last_observed_status_activities = null;
	last_observed_status_statistics = null;
}

function start_gp_sampling(count_initial_check = false) {
	stop_gp_sampling();
	if (!state.is_connected || !polling.is_foreground(document))
		return;
	const sampling_id = gp_sampling_id;
	sample_gp(sampling_id, count_initial_check);
}

function stop_gp_sampling() {
	gp_sampling_id++;
	clearTimeout(gp_sampling_timer);
	gp_sampling_timer = null;
}

function sample_gp(sampling_id, scheduled_check = true) {
	if (sampling_id !== gp_sampling_id || !state.is_connected || !polling.is_foreground(document))
		return;
	if (scheduled_check)
		gp_scheduled_checks++;
	schedule_status_sync(0);
	gp_sampling_timer = setTimeout(
		() => sample_gp(sampling_id, true),
		polling.event_poll_delay(false, gp_scheduled_checks)
	);
}

function watch_status_changes() {
	for (const skill of get_registered_game_objects(game.skills)) {
		if (typeof skill.on !== 'function')
			continue;
		try {
			skill.on('levelChanged', () => schedule_status_sync());
		} catch (e) {
			log('player status level hook unavailable for %s (%s)', skill.id, e);
		}
	}
}

function watch_equipment_view_actions() {
	document.addEventListener('click', event => {
		if (!(event.target instanceof Element) || event.target.closest('[id^="mp-"], [class*="mp-equipment"]'))
			return;
		const equipment_view = event.target.closest(
			'[id*="equipment"], [id*="equip-set"], [class*="equipment"], [class*="equip-set"]'
		);
		if (equipment_view !== null) {
			equipment_view_action_armed = true;
			clearTimeout(equipment_view_action_timer);
			equipment_view_action_timer = setTimeout(() => { equipment_view_action_armed = false; }, 30000);
			schedule_equipment_sync();
		} else if (equipment_view_action_armed) {
			equipment_view_action_armed = false;
			clearTimeout(equipment_view_action_timer);
			schedule_equipment_sync();
		}
	});
}

function build_equipment_grid(snapshot) {
	const items_by_slot = new Map(snapshot.map(entry => [entry.slot_id, entry.item_id]));
	const registered_slots = [...game.equipmentSlots.registeredObjects].map(entry => entry[1]);
	const registered_ids = new Set(registered_slots.map(slot => slot.id));
	const blocked_slots = new Set();

	for (const { item_id } of snapshot) {
		const item = game.items.getObjectByID(item_id);
		for (const slot of item?.occupiesSlots ?? [])
			blocked_slots.add(typeof slot === 'string' ? slot : slot.id);
	}

	const positions = registered_slots.map(slot => slot.gridPosition).filter(Boolean);
	const min_col = positions.length === 0 ? 0 : Math.min(...positions.map(position => position.col));
	const min_row = positions.length === 0 ? 0 : Math.min(...positions.map(position => position.row));
	const slots = registered_slots.map(slot => {
		const item_id = items_by_slot.get(slot.id) ?? null;
		const item = item_id === null ? null : game.items.getObjectByID(item_id);
		return {
			slot_id: slot.id,
			slot_name: slot.localID,
			item_id,
			item,
			media: item?.media ?? (item_id === null ? slot.emptyMedia : null) ?? 'assets/media/main/question.png',
			unknown: item_id !== null && item === undefined,
			blocked: item_id === null && blocked_slots.has(slot.id),
			col: (slot.gridPosition?.col ?? 0) - min_col + 1,
			row: (slot.gridPosition?.row ?? 0) - min_row + 1
		};
	});

	let extra_row = Math.max(...slots.map(slot => slot.row), 0) + 1;
	for (const [slot_id, item_id] of items_by_slot) {
		if (registered_ids.has(slot_id))
			continue;
		slots.push({
			slot_id,
			slot_name: slot_id,
			item_id,
			item: null,
			media: 'assets/media/main/question.png',
			unknown: true,
			blocked: false,
			col: 1,
			row: extra_row++
		});
	}

	return slots;
}

function $(id) {
	return document.getElementById(id);
}

function notify_error(lang_id, icon) {
	if (state.service_status && ['MOD_MP_MULTIPLAYER_CONNECTION_ERR', 'MOD_MP_GENERIC_ERR'].includes(lang_id)) return;
	notify(lang_id, 'danger', icon);
}

function notify(lang_id, theme = undefined, icon = 'assets/multiplayer.svg', qty = 1) {
	notifyPlayer({ media: ctx.getResourceUrl(icon) }, getLangString(lang_id), theme, qty);
}

function notify_item(lang_id, theme = undefined, item, qty = 1) {
	notifyPlayer({ media: item.media }, getLangString(lang_id), theme, qty);
}

function log(message, ...params) {
	console.log(LOG_PREFIX + message, ...params);
}

function error(message, ...params) {
	console.error(LOG_PREFIX + message, ...params);
}

function is_local_item_resolved(item_id) {
	return transfer_currency_support?.is_transfer_currency(game, item_id) === true ||
		item_visibility.is_item_resolved(item_id, id => game.items.getObjectByID(id));
}

function filter_local_resolved_items(items, get_item_id) {
	return item_visibility.filter_resolved_items(items, get_item_id, is_local_item_resolved);
}

function filter_local_available_items(items, get_item_id) {
	return item_visibility.filter_items_for_owned_dlc(
		filter_local_resolved_items(items, get_item_id),
		get_item_id,
		owned_dlc_namespaces
	);
}

function is_local_item_available(item_id) {
	return is_local_item_resolved(item_id) &&
		item_visibility.is_item_available_for_owned_dlc(item_id, owned_dlc_namespaces);
}

function has_local_unresolved_item(items, get_item_id) {
	return item_visibility.has_unresolved_item(items, get_item_id, is_local_item_resolved);
}

function get_local_item_namespaces() {
	return item_visibility.get_resolved_item_namespaces([...game.items.registeredObjects])
		.filter(namespace => item_visibility.is_item_available_for_owned_dlc(`${namespace}:Item`, owned_dlc_namespaces));
}

function is_market_item_discovered(item_id) {
	const item = game.items.getObjectByID(item_id);
	return item !== undefined && game.stats.itemFindCount(item) > 0;
}

function is_market_item_hidden_by_discovery(item_id) {
	return state.market_discovery_restriction_enabled && !is_market_item_discovered(item_id);
}

function apply_market_discovery_policy(response) {
	if (typeof response?.market_discovery_restriction_enabled !== 'boolean')
		return;
	const changed = state.market_discovery_restriction_enabled !== response.market_discovery_restriction_enabled;
	state.market_discovery_restriction_enabled = response.market_discovery_restriction_enabled;
	if (!changed)
		return;
	has_sorted_market_filter_items = false;
	if (state.market_discovery_restriction_enabled && state.market_create_item !== null &&
		!is_market_item_discovered(state.market_create_item))
		state.market_create_item = null;
}

function add_bank_item(item_id, amount, found = false) {
	const currency = transfer_currency_support?.get_transfer_currency(game, item_id)?.currency;
	if (currency !== undefined)
		currency.add(amount);
	else
		game.bank.addItemByID(item_id, amount, false, found, true);
}

function get_character_storage_item(key) {
	if (IS_DEV_MODE)
		return DEV_CHARACTER_STORAGE[key];

	if (is_creator_toolkit_local_mod()) {
		const storage_key = get_local_character_storage_key(key);
		let stored_value = localStorage.getItem(storage_key);
		let legacy_storage_key;

		if (stored_value === null) {
			legacy_storage_key = get_local_character_storage_key(key, LEGACY_LOCAL_MOD_CHARACTER_STORAGE_PREFIX);
			stored_value = localStorage.getItem(legacy_storage_key);
		}

		if (stored_value === null)
			return undefined;

		try {
			const value = JSON.parse(stored_value);

			if (legacy_storage_key !== undefined) {
				localStorage.setItem(storage_key, stored_value);
				if (localStorage.getItem(storage_key) === stored_value &&
					localStorage.getItem(legacy_storage_key) === stored_value)
					localStorage.removeItem(legacy_storage_key);
			}

			return value;
		} catch (e) {
			error('failed to read local character storage key %s (%s)', key, e);
			return undefined;
		}
	}

	return ctx.characterStorage.getItem(key);
}

function set_character_storage_item(key, value) {
	if (IS_DEV_MODE) {
		DEV_CHARACTER_STORAGE[key] = value;
	} else {
		ctx.characterStorage.setItem(key, value);

		if (is_creator_toolkit_local_mod()) {
			const storage_key = get_local_character_storage_key(key);
			if (value === undefined)
				localStorage.removeItem(storage_key);
			else
				localStorage.setItem(storage_key, JSON.stringify(value));
		}
	}
}

function remove_character_storage_item(key) {
	if (IS_DEV_MODE) {
		delete DEV_CHARACTER_STORAGE[key];
		return;
	}
	ctx.characterStorage.removeItem(key);
	if (is_creator_toolkit_local_mod())
		localStorage.removeItem(get_local_character_storage_key(key));
}

function is_creator_toolkit_local_mod() {
	return ctx.version === '';
}

function get_local_character_storage_key(key, prefix = LOCAL_MOD_CHARACTER_STORAGE_PREFIX) {
	const save_slot = typeof currentCharacter === 'number' ? currentCharacter : 'unknown';
	return `${prefix}${save_slot}:${key}`;
}

function get_instance_storage_item(key) {
	return instance_storage.read_instance_storage_item(
		get_character_storage_item,
		set_character_storage_item,
		server_instance_storage_prefix,
		server_instance_storage_legacy_prefixes,
		key
	);
}

function set_instance_storage_item(key, value) {
	set_character_storage_item(server_instance_storage_prefix + key, value);
}

function remove_instance_storage_item(key) {
	remove_character_storage_item(server_instance_storage_prefix + key);
}

function get_instance_storage_keys() {
	const keys = new Set(IS_DEV_MODE ? Object.keys(DEV_CHARACTER_STORAGE) : ctx.characterStorage.keys);
	if (!IS_DEV_MODE && is_creator_toolkit_local_mod()) {
		for (const prefix of [get_local_character_storage_key(''), get_local_character_storage_key('', LEGACY_LOCAL_MOD_CHARACTER_STORAGE_PREFIX)])
			for (const key of Object.keys(localStorage))
				if (key.startsWith(prefix)) keys.add(key.slice(prefix.length));
	}
	return [...keys].filter(key => key.startsWith(server_instance_storage_prefix))
		.map(key => key.slice(server_instance_storage_prefix.length));
}

function finish_pending_crucible_wish_action(key, pending, result) {
	if (rollback_module.transient_rollback_failure(result)) return;
	const retired_id = rollback_module.retired_rollback_command(result);
	if (result?.error === 'economy_command_retired' && retired_id !== pending.payload.command_id) return;
	if (retired_id || result?.success === true || result?.success === false || typeof result?.error_lang === 'string') {
		if (get_instance_storage_item(key)?.payload?.command_id === pending.payload.command_id)
			remove_instance_storage_item(key);
	}
}

async function run_pending_crucible_wish_action(kind, endpoint, payload = {}) {
	if (rollback_client && !rollback_client.admitted()) return null;
	const generation = session_generation, origin = server_host;
	if (rollback_module.retain_legacy_wish_commands({read:get_instance_storage_item,write:set_instance_storage_item,remove:remove_instance_storage_item,origin:server_host}))
		return {success:false,error:'legacy_wish_recovery_review',error_lang:'MOD_MP_WISH_RECOVERY_REVIEW'};
	const storage_key = `pending_crucible_wish:${state.chat_client_id}:${kind}`;
	let pending = get_instance_storage_item(storage_key);
	if (pending === undefined) {
		pending = { client_id:state.chat_client_id, origin:server_host, endpoint, payload: { ...payload, command_id: crypto.randomUUID() } };
		set_instance_storage_item(storage_key, pending);
		if (JSON.stringify(get_instance_storage_item(storage_key)) !== JSON.stringify(pending)) return null;
	}
	if (pending?.endpoint !== endpoint || typeof pending?.payload?.command_id !== 'string') return null;
	const result = await api_post_without_economy_journal(pending.endpoint, pending.payload);
	if (generation !== session_generation || origin !== server_host) return null;
	finish_pending_crucible_wish_action(storage_key, pending, result);
	return result;
}

async function recover_pending_crucible_wish_actions() {
	if (rollback_module.retain_legacy_wish_commands({read:get_instance_storage_item,write:set_instance_storage_item,remove:remove_instance_storage_item,origin:server_host})) return;
	if (rollback_client && !rollback_client.admitted()) return;
	const generation = session_generation, origin = server_host;
	for (const kind of ['make', 'cancel', 'claim']) {
		const key = `pending_crucible_wish:${state.chat_client_id}:${kind}`;
		const pending = get_instance_storage_item(key);
		if (pending?.endpoint !== `/api/crucible/wish/${kind}` || typeof pending?.payload?.command_id !== 'string')
			continue;
		const result = await api_post_without_economy_journal(pending.endpoint, pending.payload);
		if (generation !== session_generation || origin !== server_host) return;
		finish_pending_crucible_wish_action(key, pending, result);
	}
}

function load_social_mode() {
	state.social_mode = social_mode.normalize_social_mode(get_instance_storage_item('social_mode'));
}

function leave_social_only_disabled_page() {
	if (!interface_ready || !state.is_social_only)
		return;
	const disabled_pages = ['mp-crucible-page', 'mp-market-page'];
	if (disabled_pages.some(id => {
		const page = document.getElementById(id);
		return page !== null && !page.classList.contains('d-none');
	}))
		navigate_page(game.pages.getObjectByID('multiplayer:Guild'));
}

async function request_social_mode(next) {
	if (!state.is_connected)
		return false;

	state.social_mode_cancellation_pending = true;
	const storage_key = `social_mode_${next}_command_id`;
	const saved_command_id = get_instance_storage_item(storage_key);
	const command_id = saved_command_id ?? crypto.randomUUID();
	set_instance_storage_item(storage_key, command_id);
	try {
		const result = await api_post('/api/social-mode/set', { mode: next, command_id });
		if (result?.success !== true || !await reconcile_economy_receipts([result.receipt])) {
			notify_error('MOD_MP_SOCIAL_MODE_CANCEL_FAILED');
			return false;
		}

		remove_instance_storage_item(storage_key);
		state.social_mode = social_mode.normalize_social_mode(result.social_mode);
		set_instance_storage_item('social_mode', state.social_mode);
		state.pending_preview = null;
		state.gifts = [];
		state.trades = [];
		state.resolved_trades = [];
		state.market_listings = [];
		state.market_completed = [];
		state.market_results = [];
		state.crucible = null; state.crucible_summary = null;
		state.inbox_items = [];
		state.inbox_groups = [];
		state.inbox_pending_claim = false;
		await get_client_events(false);
		if (next === social_mode.SOCIAL_MODE_FULL)
			await update_transfer_contents();
		else
			await update_inbox();
		if (next === social_mode.SOCIAL_MODE_FULL)
			void refresh_raid_state();
		update_multiplayer_nav();
		leave_social_only_disabled_page();
		return true;
	} catch (e) {
		error('Social Only exchange cancellation failed (%s)', e);
		notify_error('MOD_MP_SOCIAL_MODE_CANCEL_FAILED');
		return false;
	} finally {
		state.social_mode_cancellation_pending = false;
	}
}

function apply_social_mode(value, selected = true) {
	const next = social_mode.normalize_social_mode(value);
	if (next === social_mode.SOCIAL_MODE_FULL && state.social_mode_enforcement !== null) {
		notify_error('MOD_MP_SOCIAL_MODE_ENFORCED');
		return Promise.resolve(false);
	}
	if (next === state.social_mode && get_instance_storage_item(`social_mode_${next}_command_id`) === undefined) {
		if (selected)
			set_instance_storage_item('social_mode_selected', true);
		return Promise.resolve(true);
	}

	social_mode_change_request = social_mode_change_request.then(
		() => request_social_mode(next),
		() => request_social_mode(next)
	);
	if (selected)
		social_mode_change_request = social_mode_change_request.then(result => {
			if (result)
				set_instance_storage_item('social_mode_selected', true);
			return result;
		});
	return social_mode_change_request;
}

function queue_social_mode_modal(mark_as_selected = false) {
	social_mode_choice_selection = false;
	return queue_modal('MOD_MP_SOCIAL_MODE_TITLE', 'social-mode-choice-modal', 'assets/multiplayer.svg', {
		imageWidth: 100,
		imageHeight: 100,
		customClass: { popup: 'mp-social-mode-choice-modal-popup' },
		showConfirmButton: false,
		showCloseButton: true,
		allowOutsideClick: true,
		allowEscapeKey: true,
		didClose: () => {
			if (mark_as_selected && !social_mode_choice_selection)
				set_instance_storage_item('social_mode_selected', true);
			if (mark_as_selected)
				queue_default_avatar_notice();
			social_mode_choice_selection = false;
		}
	});
}

function open_social_mode_picker() {
	Swal.close();
	setTimeout(() => { queue_social_mode_modal(); }, 0);
}

function install_social_mode_setting(ctx) {
	ctx.settings.type('social-mode', {
		get: () => state.social_mode,
		// Melvor calls set(root, value) when rendering/restoring settings. This button
		// must not replace the server-owned mode with the separate Mod Settings value.
		set: () => {},
		render() {
			const root = document.createElement('div');
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'btn btn-primary';
			button.setAttribute('aria-label', getLangString('MOD_MP_SETTINGS_MODE'));
			button.textContent = getLangString('MOD_MP_SETTINGS_CHANGE_MODE');
			button.addEventListener('click', open_social_mode_picker);
			root.append(button);
			return root;
		}
	});
}

function on_page_toggle(id, callback, visible_only) {
	const $element = $(id);
	let was_visible = !$element.classList.contains('d-none');
	const observer = new MutationObserver(() => {
		const is_visible = !$element.classList.contains('d-none');
		if (is_visible === was_visible)
			return;
		was_visible = is_visible;

		if (!visible_only || is_visible)
			callback(is_visible);
	});

	observer.observe($element, {
		attributes: true,
		attributeFilter: ['class']
	});
}
// #endregion

// #region MARKET FUNCTIONS
async function update_market_page(force_reload = false) {
	if (!state.is_guild_member || state.is_social_only)
		return;

	if (state.market_active_tab === 'search') {
		if (force_reload || !has_done_first_market_search) {
			has_done_first_market_search = true;
			await update_market_search();
		}
	} else if (state.market_active_tab === 'listing') {
		await update_market_listings();
	}
}

async function market_create_listing(item, item_qty, item_sell_price, terms = {}) {
	if (state.is_social_only) {
		notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
		return false;
	}
	if (!state.is_guild_member) {
		notify_error('MOD_MP_GUILD_REQUIRED');
		return false;
	}
	if (!is_local_item_available(item?.id))
		return false;

	if (!Number.isSafeInteger(item_qty) || item_qty <= 0) {
		notify_error('MOD_MP_MARKET_CANNOT_SELL_NOTHING');
		return false;
	}

	if (!Number.isSafeInteger(item_sell_price) || item_sell_price <= 0) {
		notify_error('MOD_MP_MARKET_CANNOT_SELL_FREE');
		return false;
	}

	if (game.bank.getQty(item) < item_qty) {
		notify_error('MOD_MP_MARKET_NOT_ENOUGH_ITEM');
		return false;
	}

	const res = await api_post('/api/market/sell', {
		item_id: item.id,
		item_qty,
		item_sell_price,
		...terms,
		command_id: crypto.randomUUID()
	});

	if (res?.success && await reconcile_economy_receipts([res.receipt])) {
		notify('MOD_MP_MARKET_ITEM_LISTED', 'success', 'assets/market.svg', item_qty);

		if (state.market_active_tab === 'listing')
			update_market_listings();
		return true;
	} else {
		notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
		return false;
	}
}

async function update_market_listings() {
	if (state.is_social_only)
		return;
	if (state.market_listings_loading)
		return;

	has_sorted_market_filter_items = false;
	state.market_listings_loading = true;
	try {
		const res = await api_get('/api/market/listings');
		apply_market_discovery_policy(res);
		state.market_listings = (res?.items ?? []).map(item => ({
			...item,
			direction: item.direction ?? 'sell',
			unresolved: !is_local_item_resolved(item.item_id)
		}));
	} finally {
		state.market_listings_loading = false;
	}
}

async function update_market_haggles() {
	if (state.is_social_only)
		return;
	if (market_haggles_update_request !== null)
		return market_haggles_update_request;
	market_haggles_update_requested = true;

	market_haggles_update_request = (async () => {
		state.market_haggles_loading = true;
		try {
			while (market_haggles_update_requested) {
				market_haggles_update_requested = false;
				const res = await api_get('/api/market/haggles');
				if (market_haggles_update_requested)
					continue;
				if (!res?.success) return;
				const haggles = res.haggles ?? [];
				state.market_haggles = haggles.filter(haggle => haggle.status === 'active' ||
					(haggle.claim && !haggle.claim.claimed));
				state.market_haggle_pending = state.market_haggles.length;
				update_transfer_inventory_nav();
			}
		} finally {
			state.market_haggles_loading = false;
			market_haggles_update_request = null;
		}
	})();
	return market_haggles_update_request;
}

async function update_market_search() {
	if (state.is_social_only) {
		state.market_results = [];
		state.market_total_items = 0;
		return;
	}
	const generation = ++market_search_generation;
	const page = state.market_current_page;
	const sort = state.market_sort;
	const available_only = state.market_available_only;
	const direction = state.market_direction;
	const item_id = state.market_filter_item;
	const item_namespaces = get_local_item_namespaces();
	state.market_search_loading = true;
	try {
		let unresolved_item_ids;
		if (item_id !== null)
			unresolved_item_ids = !is_local_item_resolved(item_id) || is_market_item_hidden_by_discovery(item_id)
				? [item_id] : [];
		else {
			const catalog = await api_post('/api/market/catalog', {
				item_namespaces,
				currency_ids: state.market_currencies.map(row => row.id),
				direction,
				listing_filters: [...state.listing_filters]
			});
			if (generation !== market_search_generation)
				return;
			apply_market_discovery_policy(catalog);
			if (!catalog?.success) {
				state.market_results = [];
				state.market_total_items = 0;
				return;
			}
			unresolved_item_ids = (catalog.item_ids ?? []).filter(item_id =>
				!is_local_item_resolved(item_id) || is_market_item_hidden_by_discovery(item_id));
		}

		const res = await api_post('/api/market/search', {
			page,
			sort,
			available_only,
			direction,
			...(item_id === null ? {} : { item_id }),
			item_namespaces,
			currency_ids: state.market_currencies.map(row => row.id),
			unresolved_item_ids,
			listing_filters: [...state.listing_filters]
		});
		if (generation !== market_search_generation)
			return;
		apply_market_discovery_policy(res);
		if (res?.success) {
			state.market_current_page = res.page;
			state.market_total_items = res.total_items;
			state.market_results = item_visibility.filter_items_for_owned_dlc(
				res.items ?? [], item => item.item_id, owned_dlc_namespaces
			).filter(item => !is_market_item_hidden_by_discovery(item.item_id)).map(item => ({
				...item,
				direction: item.direction ?? direction,
				market_owner: item.buyer ?? item.seller ?? null
			}));
		} else {
			state.market_results = [];
			state.market_total_items = 0;
		}
	} finally {
		if (generation === market_search_generation)
			state.market_search_loading = false;
	}
}

function load_market_filter_items() {
	const filter_items = [...game.items.registeredObjects].map(e => e[1]).filter(item => {
		if (item.category === '' || MARKET_FILTER_EXCLUDED_ITEM_IDS.has(item.id))
			return false;

		return is_local_item_available(item.id);
	}).map(item => {
		return {
			id: item.id,
			name: item.name,
			name_lower: item.name.toLowerCase(),
			media: item.media,
		}
	});
	state.market_filter_items = sort_market_filter_items(filter_items, state.market_listings);

	has_sorted_market_filter_items = true;
}
// #endregion

function set_nav_ready(aside, ready) {
	aside.classList.toggle('mp-nav-ready', ready);
}

function update_raid_nav() {
	const aside = document.querySelector('.mp-raid-nav');
	if (!aside)
		return;

	set_nav_ready(aside, true);
	aside.textContent = '';
	aside.hidden = true;
	aside.classList.toggle('mp-raid-active', false);
}

function update_expedition_nav(activities = capture_status_activities()) {
	const item = sidebar.category('Multiplayer').item('multiplayer:Expedition').itemEl;
	if (!item) return;
	let aside = item.querySelector('.mp-expedition-nav');
	if (!aside) {
		aside = document.createElement('span');
		aside.className = 'mp-expedition-nav';
		item.append(aside);
	}
	const ready = state.is_connected && !state.multiplayer_unsupported;
	set_nav_ready(aside, ready);
	const needs_vote = ready && expedition_view.needs_passage_vote(state.expedition_state);
	const skill_ids = ready
		? expedition_tasks.tracked_skill_ids(state.expedition_state ?? state.expedition_personal, activities) : [];
	aside.hidden = !needs_vote && skill_ids.length === 0;
	const icons = skill_ids.map(id => ({
		media: id === 'melvorD:Combat' ? assets.getURI(expedition_work_icon(id)) : expedition_work_icon(id),
		name: expedition_work_name(id)
	}));
	const vote_label = needs_vote ? getLangString('MOD_MP_VOTE_BADGE') : '';
	const signature = JSON.stringify({ icons, vote_label });
	if (aside.dataset.icons === signature) return;
	aside.dataset.icons = signature;
	const children = icons.map(({ media, name }) => {
		const image = document.createElement('img');
		image.src = media;
		image.alt = name;
		image.title = expedition_text('MOD_MP_EXPEDITION_TRACKING_TITLE', name);
		return image;
	});
	if (needs_vote) {
		const badge = document.createElement('span');
		badge.className = 'badge mp-expedition-nav-vote';
		badge.textContent = vote_label;
		children.push(badge);
	}
	aside.replaceChildren(...children);
}

async function refresh_changelog() {
	if (changelog_loader === null || state.changelog_loading)
		return;

	state.changelog_loading = true;
	state.changelog_error = '';
	try {
		state.changelog_entries = await changelog_loader.load_changelog();
		state.changelog_loaded = true;
	} catch (e) {
		state.changelog_error = getLangString('MOD_MP_CHANGELOG_LOAD_FAILED');
		log('changelog loading failed (%s)', e);
	} finally {
		state.changelog_loading = false;
	}
}

async function refresh_updates(force = false) {
	if (updates_loader === null || state.updates_loading ||
		(!force && state.updates_loaded && state.updates_loaded_host === server_host))
		return;

	const request_host = server_host;
	state.updates_loading = true;
	state.updates_error = '';
	try {
		const result = await api_get('/api/updates');
		if (result === null || request_host !== server_host) throw new Error('Updates unavailable');
		state.updates_sections = updates_loader.normalize_updates(result);
		state.updates_loaded = true;
		state.updates_loaded_host = request_host;
	} catch (e) {
		state.updates_error = getLangString('MOD_MP_UPDATES_LOAD_FAILED');
		log('updates loading failed (%s)', e);
	} finally {
		state.updates_loading = false;
	}
}

function set_updates_mobile_tab(tab) {
	if (tab === 'updates' || tab === 'changelog') {
		state.updates_mobile_tab = tab;
		if (tab === 'changelog' && is_mobile_layout())
			mark_updates_seen();
	}
}

function is_mobile_layout() {
	return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
		window.matchMedia('(max-width: 767.98px)').matches;
}

function mark_updates_seen() {
	set_character_storage_item(UPDATES_LAST_SEEN_MOD_VERSION_KEY, MOD_VERSION);
	state.last_seen_mod_version = MOD_VERSION;
	state.updates_new = false;
	update_multiplayer_nav();
}

function localize_multiplayer_page_names() {
	localization.localize_multiplayer_page_names({ game, sidebar, getLangString, createElement });
}

let chat_header_resize_observer = null;

function update_chat_header_offset() {
	const header = document.getElementById('page-header');
	if (!header) return;
	const style = getComputedStyle(header);
	const pinned = style.position === 'fixed' || style.position === 'sticky';
	const offset = pinned ? header.getBoundingClientRect().height + (parseFloat(style.top) || 0) : 0;
	for (const id of ['mp-chat-page', 'mp-combat-page'])
		document.getElementById(id)?.style.setProperty('--mp-chat-header-top', `${offset}px`);
}

function setup_chat_sticky_header() {
	chat_header_resize_observer?.disconnect();
	const header = document.getElementById('page-header');
	if (header && typeof ResizeObserver !== 'undefined') {
		chat_header_resize_observer = new ResizeObserver(update_chat_header_offset);
		chat_header_resize_observer.observe(header);
	}
	window.removeEventListener('resize', update_chat_header_offset);
	window.addEventListener('resize', update_chat_header_offset);
	update_chat_header_offset();
}

function watch_chat_nav() {
	const nav_item = sidebar.category('Multiplayer').item('multiplayer:Chat');
	nav_item.rootEl?.addEventListener('click', () => state.close_chat_conversation(), true);
}

function update_crucible_nav() {
	const nav_item = sidebar.category('Multiplayer').item('multiplayer:Crucible');
	nav_item.rootEl?.classList.toggle('mp-nav-unavailable', state.multiplayer_unsupported || !state.is_guild_member || state.is_social_only);
	const aside = document.querySelector('.mp-crucible-nav');
	if (!aside)
		return;
	const summary = state.crucible_summary;
	const ready = state.guild_state_loaded && state.is_connected && state.is_guild_member &&
		!state.is_social_only && (summary ?? state.crucible)?.is_open === true;
	state.crucible_clock_time = Date.now();
	const wish_ready = ready && (summary ? summary.wishes.some(wish => is_local_item_available(wish.item_id))
		: (state.crucible?.wishes ?? []).some(wish => wish.phase === 'melded' && wish.owned));
	const reclaim_available = ready && (summary ? summary.offerings.some(offering => is_local_item_available(offering.id) &&
		state.crucible_reclaim_quantity(offering) > 0) : (state.crucible?.offerings ?? []).some(offering =>
		state.crucible_reclaim_block(offering) === null));
	aside.classList.toggle('mp-crucible-wish', wish_ready);
	set_nav_ready(aside, ready);
	aside.textContent = wish_ready ? getLangString('MOD_MP_SIDEBAR_CRUCIBLE_WISH')
		: reclaim_available ? getLangString('MOD_MP_SIDEBAR_CRUCIBLE_RECLAIM') : '';
	aside.hidden = !wish_ready && !reclaim_available;
}

function update_guild_nav() {
	const aside = document.querySelector('.mp-guild-nav');
	if (aside === null) return;
	const ready = state.guild_state_loaded;
	set_nav_ready(aside, ready);
	const applicants = state.is_guild_member && !state.is_free_fellowship && !state.guild_state.guild?.is_public ? state.visible_guild_applicants.length : 0;
	const needs_vote = state.is_guild_member && (state.council_needs_vote || state.alliance_needs_vote);
	const discussion = state.is_guild_member ? state.get_petition_nav_badge?.() : null;
	aside.classList?.toggle('mp-petition-unread', ready && discussion?.count > 0);
	aside.classList?.toggle('mp-chat-tagged-nav', ready && discussion?.tagged === true);
	aside.textContent = !ready ? '' : !state.is_guild_member ? getLangString('MOD_MP_SIDEBAR_GUILD_START') :
		discussion?.count > 0 ? discussion.text : applicants > 0 ? String(applicants) : needs_vote ? getLangString('MOD_MP_VOTE_BADGE') : '';
	aside.hidden = !ready || (state.is_guild_member && applicants === 0 && !needs_vote && !(discussion?.count > 0));
}

function update_combat_nav() {
	const aside = document.querySelector('.mp-combat-nav');
	if (!aside) return;
	const active = state.combat?.status === 'ready' && state.combat?.arena?.status === 'active';
	set_nav_ready(aside, true);
	aside.textContent = active ? getLangString('MOD_MP_SIDEBAR_RAID_ACTIVE') : '';
	aside.hidden = !active;
}

function update_multiplayer_nav() {
	update_combat_nav();
	const multiplayer_category = sidebar.category('Multiplayer');
	for (const page_id of ['Guild', 'Transfer_Items', 'Crucible', 'Multiplayer_Market', 'Expedition', 'Guild_Raid'])
		multiplayer_category.item('multiplayer:' + page_id).rootEl?.classList.toggle('mp-nav-unavailable', state.multiplayer_unsupported);
	update_guild_nav();
	const updates_aside = document.querySelector('.mp-updates-nav');
	if (updates_aside !== null) {
		set_nav_ready(updates_aside, true);
		updates_aside.textContent = state.updates_new ? getLangString('MOD_MP_SIDEBAR_NEW') : '';
		updates_aside.hidden = !state.updates_new;
	}

	for (const page_id of ['Multiplayer_Market', 'Expedition', 'Guild_Raid']) {
		const nav_item = multiplayer_category.item('multiplayer:' + page_id);
		nav_item.rootEl?.classList.toggle('mp-nav-unavailable', state.multiplayer_unsupported || (!state.is_guild_member && page_id !== 'Expedition') ||
			(state.is_social_only && page_id === 'Multiplayer_Market'));
	}

	const transfer_nav_item = multiplayer_category.item('multiplayer:Transfer_Items');
	transfer_nav_item.rootEl?.classList.toggle('mp-nav-unavailable', state.multiplayer_unsupported || !state.has_transfer_access);
	update_crucible_nav();
	update_expedition_nav();
}
// #endregion

// #region PET FUNCTIONS
async function load_pets(ctx) {
	const pets = await ctx.loadData('data/pets.json');
	for (const pet of pets)
		multiplayer_pet_flare.set(pet.id, { ...pet });
}
// #endregion

function set_crucible_page_visible(is_visible) {
	crucible_page_visible = is_visible;
	crucible_page_entry++;
	// Entry owns the full read after Events, current eligibility and pending recovery.
	crucible_page_hydrating = is_visible;
	clearInterval(crucible_clock_timer);
	crucible_clock_timer = null;
	if (!crucible_page_visible)
		return;
	crucible_clock_timer = setInterval(() => {
		state.crucible_clock_time = Date.now();
		update_crucible_nav();
		if (!crucible_page_hydrating && state.is_connected && polling.is_foreground(document))
			void state.refresh_crucible(true);
	}, CRUCIBLE_CLOCK_INTERVAL);
}
// #endregion

// #region TRANSFER FUNCTIONS
async function apply_gift_contents(gift, gift_data) {
	const action = gift_contents.apply_gift_content_state(
		gift,
		gift_data,
		has_local_unresolved_item(gift_data.items, item => item.item_id)
	);
	if (action === 'return') {
		const returned = await run_pending_economy_action(`gift_decline:${gift.id}`, '/api/gift/decline', { gift_id: gift.id });
		return returned?.success === true;
	}
	return false;
}

async function update_inbox() {
	if (inbox_update_request !== null)
		return inbox_update_request;
	const request = (async () => {
		state.inbox_loading = true;
		try {
			const res = await api_get('/api/inbox');
			if (res !== null) {
				state.inbox_items = Array.isArray(res.items) ? res.items.map(item => ({ ...item })) : [];
				state.inbox_groups = Array.isArray(res.groups) ? res.groups.map(group => ({
					...group,
					items: Array.isArray(group.items) ? group.items.map(item => ({ ...item })) : []
				})) : state.inbox_items.length > 0
					? [{ source_type: 'other', source_name: '', items: state.inbox_items.map(item => ({ ...item })) }]
					: [];
				state.inbox_pending_claim = res.pending_claim === true;
			}
			return res !== null;
		} finally {
			state.inbox_loading = false;
			update_transfer_inventory_nav();
		}
	})();
	inbox_update_request = request;
	try {
		return await request;
	} finally {
		if (inbox_update_request === request)
			inbox_update_request = null;
	}
}

function reconcile_guild_member_social_modes(modes) {
	if (!Array.isArray(modes))
		return;
	const by_client_id = new Map(modes
		.filter(entry => Number.isSafeInteger(entry?.client_id) &&
			(entry.social_mode === social_mode.SOCIAL_MODE_FULL || entry.social_mode === social_mode.SOCIAL_MODE_SOCIAL))
		.map(entry => [entry.client_id, entry.social_mode]));
	const reconcile = member => by_client_id.has(member.client_id)
		? { ...member, social_mode: by_client_id.get(member.client_id) }
		: member;
	state.guild_members = state.guild_members.map(reconcile);
	if (state.selected_guild_member !== null)
		state.selected_guild_member = reconcile(state.selected_guild_member);
}

function get_bank_item_ids() {
	const bank_item_ids = [...(game.bank.items?.keys?.() ?? [])]
		.map(item => typeof item === 'string' ? item : item?.id ?? game.items.getObjectByID(item)?.id)
		.filter(item_id => typeof item_id === 'string');
	return [...new Set([
		...bank_item_ids,
		...(transfer_currency_support?.get_transfer_currencies(game).map(({ id }) => id) ?? [])
	])];
}

function get_bank_free_slots() {
	const capacity = game.bank.maximumSlots;
	const used = game.bank.occupiedSlots;
	return Number.isSafeInteger(capacity) && Number.isSafeInteger(used)
		&& capacity >= 0 && used >= 0
		? Math.max(0, capacity - used) : 0;
}

async function claim_inbox(event) {
	const $button = event.currentTarget;
	if (state.inbox_claiming || is_button_spinning($button))
		return;
	state.inbox_claiming = true;
	show_button_spinner($button);
	try {
		const res = await api_post('/api/inbox/claim', {
			existing_item_ids: get_inbox_existing_item_ids(state.inbox_items, get_bank_item_ids()),
			available_slots: get_bank_free_slots()
		});
		const claim = res?.claim;
		if (!claim) {
			await update_inbox();
			if (res !== null && state.inbox_items.length > 0)
				notify_error('MOD_MP_INBOX_CLAIM_BLOCKED');
			return;
		}

		const applied = apply_inbox_claim(inbox_delivery_state, claim, {
			is_known_item: item_id => game.items.getObjectByID(item_id) !== undefined,
			is_known_currency: item_id => transfer_currency_support?.is_transfer_currency(game, item_id) === true,
			has_bank_item: item_id => get_bank_item_ids().includes(item_id),
			get_bank_free_slots
		});
		if (applied.status === 'invalid' || applied.status === 'blocked') {
			notify_error('MOD_MP_INBOX_CLAIM_BLOCKED');
			return;
		}
		if (applied.status === 'applied') {
			for (const item of claim.items) {
				if (item.id === 'melvorD:GP')
					game.gp.add(item.qty);
				else
					add_bank_item(item.id, item.qty);
			}
			inbox_delivery_state = applied.state;
			set_instance_storage_item('inbox_delivery_state', inbox_delivery_state);
		}

		const acknowledged = await api_post('/api/inbox/acknowledge', { claim_id: claim.claim_id });
		if (!acknowledged?.success) {
			notify_error('MOD_MP_GENERIC_ERR');
			return;
		}
		inbox_delivery_state = forget_inbox_claim(inbox_delivery_state, claim.claim_id);
		if (inbox_delivery_state.processed_claim_ids.length === 0)
			remove_instance_storage_item('inbox_delivery_state');
		else
			set_instance_storage_item('inbox_delivery_state', inbox_delivery_state);
		await update_inbox();
	} finally {
		hide_button_spinner($button);
		state.inbox_claiming = false;
	}
}

async function reconcile_pending_gifts() {
	const pending_gifts = state.gifts.filter(gift => gift.data === null);
	if (pending_gifts.length === 0)
		return;

	const res = await api_post('/api/transfers/get_contents', {
		gift_ids: pending_gifts.map(gift => gift.id),
		trade_ids: [],
		resolved_trade_ids: []
	});
	if (res === null)
		return;

	const returned_gift_ids = [];
	for (const gift of pending_gifts) {
		const gift_data = res.gifts[gift.id];
		if (gift_data && await apply_gift_contents(gift, gift_data))
			returned_gift_ids.push(gift.id);
	}

	if (returned_gift_ids.length > 0)
		state.gifts = state.gifts.filter(gift => !returned_gift_ids.includes(gift.id));
}

function schedule_transfer_history_refresh() {
	clearTimeout(transfer_history_refresh_timer);
	transfer_history_refresh_timer = setTimeout(() => {
		// Finish durable claim/receipt acknowledgements before optional history reads.
		if (state.inbox_claiming || state.is_updating_transfer_contents || !economy_commands_ready) {
			if (state.is_connected && state.is_transfer_page_visible) schedule_transfer_history_refresh();
			return;
		}
		if (state.is_transfer_page_visible) void refresh_transfer_history();
	}, 500);
}

async function refresh_transfer_history() {
	if (!load_transfer_history || !state.is_connected) return;
	transfer_history_refresh_pending = true;
	if (transfer_history_refresh_running) return;
	transfer_history_refresh_running = true;
	try {
		do {
			transfer_history_refresh_pending = false;
			state.transfer_history_clock = performance.now();
			await prepare_page_snapshot('transfers');
			await Promise.all(transfer_history_module.HISTORY_PANES.filter(pane => state.transfers_history_open[pane]).map(pane => load_transfer_history(pane)));
		} while (transfer_history_refresh_pending && state.is_connected && state.is_transfer_page_visible);
	} finally {
		transfer_history_refresh_running = false;
	}
}

async function update_transfer_contents() {
	if (state.is_updating_transfer_contents)
		return;

	state.is_updating_transfer_contents = true;
	try {
		await update_inbox();
		const missing_gifts = state.gifts.filter(gift => gift.data === null).map(gift => gift.id);
		const missing_trades = state.trades.filter(trade => trade.data === null).map(trade => trade.trade_id);
		const missing_resolved_trades = state.resolved_trades.filter(trade => trade.data === null).map(trade => trade.trade_id);

		if (missing_gifts.length > 0 || missing_trades.length > 0 || missing_resolved_trades.length > 0) {
			const res = await api_post('/api/transfers/get_contents', {
				gift_ids: missing_gifts,
				trade_ids: missing_trades,
				resolved_trade_ids: missing_resolved_trades
			});

			if (res !== null) {
				const returned_gift_ids = [];
				for (const gift of state.gifts) {
					const gift_data = res.gifts[gift.id];
					if (gift_data && await apply_gift_contents(gift, gift_data))
						returned_gift_ids.push(gift.id);
				}
				if (returned_gift_ids.length > 0)
					state.gifts = state.gifts.filter(gift => !returned_gift_ids.includes(gift.id));

				for (const trade of state.trades) {
					const trade_data = res.trades[trade.trade_id];
					if (trade_data)
						trade.data = trade_data;
				}

				for (const trade of state.resolved_trades) {
					const trade_data = res.resolved_trades[trade.trade_id];
					if (trade_data)
						trade.data = trade_data;
				}
			}
		}
	} finally {
		state.is_updating_transfer_contents = false;
		update_multiplayer_nav();
	}
}

function return_all_transfer_inventory() {
	const returnable = state.transfer_inventory.filter(entry => entry.destroyable !== true);
	for (const entry of returnable)
		add_bank_item(entry.id, entry.qty);

	state.transfer_inventory = state.transfer_inventory.filter(entry => entry.destroyable === true);
	state.selected_transfer_item_id = '';
	persist_transfer_inventory();
	update_transfer_inventory_nav();
}

function return_selected_transfer_inventory() {
	const selected_id = state.selected_transfer_item_id;
	if (selected_id.length > 0) {
		const entry = state.transfer_inventory.find(e => e.id === selected_id);
		if (entry) {
			if (entry.destroyable === true)
				return notify_error('MOD_MP_TRANSFER_DESTROY_ITEM_ONLY');

			const returned = transfer_inventory.take_returnable_transfer_entry(state.transfer_inventory, selected_id);
			if (returned === null)
				return notify_error('MOD_MP_TRANSFER_DESTROY_ITEM_ONLY');
			add_bank_item(selected_id, returned.entry.qty);
			state.transfer_inventory = returned.inventory;
			state.selected_transfer_item_id = '';
			persist_transfer_inventory();
			update_transfer_inventory_nav();
		}
	} else {
		notify_error('MOD_MP_TRANSFER_NO_ITEM_SELECTED');
	}
}

function destroy_selected_transfer_inventory() {
	const selected_id = state.selected_transfer_item_id;
	const entry = state.transfer_inventory.find(item => item.id === selected_id);
	if (!entry || entry.destroyable !== true)
		return notify_error('MOD_MP_TRANSFER_DESTROY_ITEM_ONLY');

	state.transfer_inventory = state.transfer_inventory.filter(item => item.id !== selected_id);
	state.selected_transfer_item_id = '';
	persist_transfer_inventory();
	update_transfer_inventory_nav();
	notify('MOD_MP_TRANSFER_ITEM_DESTROYED');
}

function update_transfer_inventory_nav() {
	const aside = document.querySelector('.mp-transfer-nav');
	if (aside !== null) {
		set_nav_ready(aside, true);
		const num_transfer_offers = state.num_transfer_offers;
		const has_items = state.transfer_inventory.length > 0;
		const has_transfer_offers = num_transfer_offers > 0;
		const has_inbox_items = state.inbox_items.length > 0;
		aside.textContent = has_transfer_offers
			? String(num_transfer_offers)
			: has_inbox_items ? String(state.inbox_items.length)
			: has_items ? state.transfer_inventory.length + ' / ' + TRANSFER_INVENTORY_MAX_LIMIT : '';
		aside.hidden = !has_transfer_offers && !has_inbox_items && !has_items;
		aside.classList.toggle('mp-transfer-action-nav', has_transfer_offers);
		aside.classList.toggle('mp-transfer-inbox-nav', !has_transfer_offers && has_inbox_items);
	}
	update_multiplayer_nav();
}

function add_currency_to_transfer(currency_id, amount) {
	if (state.is_social_only)
		return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
	if (!state.is_guild_member)
		return notify_error('MOD_MP_GUILD_REQUIRED');
	if (state.has_destroyable_transfer_items)
		return notify_error('MOD_MP_TRANSFER_DESTROY_ITEM_FIRST');

	const currency = transfer_currency_support?.get_transfer_currency(game, currency_id)?.currency;
	if (currency === undefined)
		return notify_error('MOD_MP_GENERIC_ERR');
	if (!Number.isSafeInteger(amount) || amount < 1 || currency.amount < amount)
		return notify_error(currency === game.gp ? 'MOD_MP_INSUFFICIENT_GP_ERR' : 'MOD_MP_INSUFFICIENT_CURRENCY_ERR');

	const existing_entry = state.transfer_inventory.find(e => e.id === currency_id);
	if (existing_entry) {
		existing_entry.qty += amount;
	} else {
		if (state.transfer_inventory.length >= TRANSFER_INVENTORY_MAX_LIMIT)
			return notify_error('MOD_MP_TRANSFER_INVENTORY_FULL');

		state.transfer_inventory.unshift({
			id: currency_id,
			qty: amount
		});
	}

	currency.remove(amount);
	update_transfer_inventory_nav();
	persist_transfer_inventory();
}

function add_gp_to_transfer(amount) {
	return add_currency_to_transfer('melvorD:GP', amount);
}

function add_destroyable_item_to_transfer_inventory(item_id, qty) {
	const existing_entry = state.transfer_inventory.find(entry => entry.id === item_id);
	if (existing_entry) {
		if (existing_entry.destroyable !== true)
			return false;
		existing_entry.qty += qty;
		existing_entry.destroyable = true;
	} else {
		if (state.transfer_inventory.length >= TRANSFER_INVENTORY_MAX_LIMIT)
			return false;

		state.transfer_inventory.push({
			id: item_id,
			qty,
			destroyable: true
		});
	}

	state.selected_transfer_item_id = item_id;
	persist_transfer_inventory();
	update_transfer_inventory_nav();
	return true;
}

function add_item_to_transfer_inventory(item, qty) {
	if (state.is_social_only) {
		notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
		return false;
	}
	if (!state.is_guild_member) {
		notify_error('MOD_MP_GUILD_REQUIRED');
		return false;
	}
	if (!Number.isSafeInteger(qty) || qty < 1 || game.bank.getQty(item) < qty) {
		notify_error('MOD_MP_MARKET_NOT_ENOUGH_ITEM');
		return false;
	}

	const existing_entry = state.transfer_inventory.find(e => e.id === item.id);
	if (existing_entry?.destroyable) {
		notify_error('MOD_MP_TRANSFER_DESTROY_ITEM_FIRST');
		return false;
	}
	if (existing_entry) {
		existing_entry.qty += qty;
	} else {
		if (state.transfer_inventory.length >= TRANSFER_INVENTORY_MAX_LIMIT) {
			notify_error('MOD_MP_TRANSFER_INVENTORY_FULL');
			return false;
		}

		state.transfer_inventory.push({
			id: item.id,
			qty: qty
		});
	}

	game.bank.removeItemQuantity(item, qty);
	update_transfer_inventory_nav();
	persist_transfer_inventory();
	return true;
}

function persist_transfer_inventory() {
	transfer_delivery_state = replace_transfer_delivery_inventory(
		transfer_delivery_state,
		state.transfer_inventory
	);
	set_instance_storage_item('transfer_delivery_state', transfer_delivery_state);
}

function show_next_market_fulfillment_notice() {
	if (market_fulfillment_notice_displaying || market_fulfillment_notice_queue.length === 0)
		return;

	const notice = market_fulfillment_notice_queue.shift();
	state.market_fulfillment_notice_items = notice.items;
	state.market_fulfillment_notice_order_count = notice.order_count;
	market_fulfillment_notice_displaying = true;

	try {
		const queued = queue_modal(
			notice.order_count === 1
				? 'MOD_MP_MARKET_FULFILLMENT_TITLE'
				: 'MOD_MP_MARKET_FULFILLMENTS_TITLE',
			'market-fulfillment-notice-modal',
			'assets/market.svg',
			{
				didClose() {
					state.market_fulfillment_notice_items = [];
					state.market_fulfillment_notice_order_count = 0;
					market_fulfillment_notice_displaying = false;
					show_next_market_fulfillment_notice();
				}
			}
		);
		if (queued === false) {
			state.market_fulfillment_notice_items = [];
			state.market_fulfillment_notice_order_count = 0;
			market_fulfillment_notice_displaying = false;
			market_fulfillment_notice_queue.unshift(notice);
		}
	} catch (e) {
		state.market_fulfillment_notice_items = [];
		state.market_fulfillment_notice_order_count = 0;
		market_fulfillment_notice_displaying = false;
		market_fulfillment_notice_queue.unshift(notice);
		error('could not queue Marketplace fulfillment notice (%s)', e);
	}
}

function queue_market_fulfillment_notice(receipts) {
	const notice = economy_receipts.summarize_market_fulfillment_receipts(receipts);
	if (notice.order_count === 0 || notice.items.length === 0)
		return;

	market_fulfillment_notice_queue.push(notice);
	show_next_market_fulfillment_notice();
}

function load_transfer_inventory() {
	inbox_delivery_state = load_inbox_delivery_state(
		get_instance_storage_item('inbox_delivery_state'),
		get_instance_storage_item('processed_inbox_claim_ids')
	);
	set_instance_storage_item('inbox_delivery_state', inbox_delivery_state);
	transfer_delivery_state = load_transfer_delivery_state(
		get_instance_storage_item('transfer_delivery_state'),
		get_instance_storage_item('transfer_inventory'),
		get_instance_storage_item('processed_banishment_claim_ids')
	);
	state.transfer_inventory = transfer_delivery_state.inventory.map(entry => ({ ...entry }));
	set_instance_storage_item('transfer_delivery_state', transfer_delivery_state);
	update_transfer_inventory_nav();
}

let pending_economy_actions;

function run_pending_economy_action(key, endpoint, payload) {
	return pending_economy_actions.run(`${state.chat_client_id}:${key}`, endpoint, payload);
}

// Recover persisted Wish purchases before refreshing quotes, even when the accepted
// purchase has exhausted EP or created an active Wish and its confirmation is closed.
async function recover_paid_wish_actions() {
	const generation = session_generation, origin = server_host;
	for (const kind of ['make', 'capacity', 'renewal']) {
		const key = `crucible_wish_${kind}`;
		const pending = get_instance_storage_item(`pending_economy_action:${state.chat_client_id}:${key}`);
		if (pending?.endpoint !== `/api/crucible/wish/${kind}` || typeof pending?.payload?.command_id !== 'string') continue;
		if (economy_receipt_reviews?.has(pending.payload.command_id)) {
			remove_instance_storage_item(`pending_economy_action:${state.chat_client_id}:${key}`);
			continue;
		}
		await run_pending_economy_action(key, pending.endpoint, pending.payload);
		if (generation !== session_generation || origin !== server_host) return;
	}
}

function reconcile_economy_receipts(receipts) {
	if (!Array.isArray(receipts))
		return Promise.resolve(false);
	const generation = session_generation, origin = server_host;
	const reviews = economy_receipt_reviews;
	receipts = receipts.filter(receipt => receipt !== null && receipt !== undefined);
	if (receipts.length === 0)
		return Promise.resolve(true);
	const reconcile = async () => {
		if (generation !== session_generation || origin !== server_host) return false;
		let deferred = false;
		const reconciled_receipts = [];
		const stored_ids = get_instance_storage_item('processed_economy_receipt_ids');
		let processed_ids = Array.isArray(stored_ids) ? stored_ids : [];
		for (const receipt of receipts) {
			if (generation !== session_generation || origin !== server_host) return false;
			if (rollback_client?.is_retired(receipt?.id)) { economy_command_journal?.retire(receipt.id); continue; }
			if (rollback_client && !rollback_client.allows_receipt(receipt)) { deferred = true; continue; }
			if (reviews?.has(receipt?.id)) {
				economy_command_journal?.retire(receipt.id);
				continue;
			}
			if (typeof receipt?.id === 'string' && acknowledged_economy_receipt_ids.includes(receipt.id)) {
				economy_command_journal?.acknowledge(receipt.id);
				continue;
			}
			const result = economy_receipts.apply_economy_receipt(receipt, processed_ids, {
				maximum_transfer_entries: TRANSFER_INVENTORY_MAX_LIMIT,
				has_bank_item: item_id => transfer_currency_support?.is_transfer_currency(game, item_id) === true ||
					game.items.getObjectByID(item_id) !== undefined,
				get_bank_qty: item_id => transfer_currency_support?.get_transfer_currency(game, item_id)?.currency?.amount ??
					game.bank.getQty(game.items.getObjectByID(item_id)),
				add_bank_item: (item_id, qty) => add_bank_item(
					item_id,
					qty,
					receipt.kind === 'crucible-reclaim' &&
						!state.is_crucible_item_discovered(item_id)
				),
				remove_bank_item: (item_id, qty) => {
					const currency = transfer_currency_support?.get_transfer_currency(game, item_id)?.currency;
					if (currency !== undefined)
						currency.remove(qty);
					else
						game.bank.removeItemQuantity(game.items.getObjectByID(item_id), qty);
				},
				get_gp: () => game.gp.amount,
				add_gp: qty => game.gp.add(qty),
				remove_gp: qty => game.gp.remove(qty),
				get_transfer_inventory: () => state.transfer_inventory,
				replace_transfer_inventory: inventory => {
					state.transfer_inventory = inventory;
					persist_transfer_inventory();
					update_transfer_inventory_nav();
				},
				persist_processed_ids: ids => set_instance_storage_item('processed_economy_receipt_ids', ids)
			});
			if (result === 'invalid' || result === 'blocked') {
				error('could not apply Economy Receipt %s (%s)', receipt?.id, result);
				if (!reviews?.defer(receipt?.id, result)) return false;
				economy_command_journal?.retire(receipt.id);
				void reviews.flush();
				continue;
			}
			const acknowledged = await api_post('/api/economy/receipts/acknowledge', { receipt_id: receipt.id });
			if (generation !== session_generation || origin !== server_host) return false;
			if (!acknowledged?.success) {
				if (!reviews?.defer(receipt.id, 'acknowledgement_failed')) return false;
				economy_command_journal?.retire(receipt.id);
				void reviews.flush();
				continue;
			}
			reconciled_receipts.push(receipt);
			economy_command_journal?.acknowledge(receipt.id);
			processed_ids = economy_receipts.forget_processed_economy_receipt(processed_ids, receipt.id);
			if (processed_ids.length === 0)
				remove_instance_storage_item('processed_economy_receipt_ids');
			else
				set_instance_storage_item('processed_economy_receipt_ids', processed_ids);
			economy_receipts.remember_acknowledged_economy_receipt(
				acknowledged_economy_receipt_ids,
				receipt.id
			);
		}
		queue_market_fulfillment_notice(reconciled_receipts);
		return !deferred;
	};
	const pending = economy_receipt_reconciliation.then(reconcile, reconcile);
	economy_receipt_reconciliation = pending.catch(() => false);
	return pending;
}

function show_pending_banishment_notice() {
	const guild_name = get_instance_storage_item('pending_banishment_guild_name');
	if (typeof guild_name !== 'string' || guild_name.length === 0)
		return;
	state.pending_banishment_guild_name = guild_name;
	queue_modal('MOD_MP_COUNCIL_BANISHED_TITLE', 'banished-modal', 'assets/multiplayer.svg', {
		showConfirmButton: false,
		didOpen() {
			remove_instance_storage_item('pending_banishment_guild_name');
		}
	});
}

async function reconcile_banishment_returns() {
	if (is_reconciling_banishment_returns)
		return;
	is_reconciling_banishment_returns = true;
	try {
		for (let claims = 0; claims < TRANSFER_INVENTORY_MAX_LIMIT + 1; claims++) {
			const existing_item_ids = state.transfer_inventory.map(item => item.id);
			const res = await api_post('/api/banishment/returns/claim', {
				existing_item_ids,
				available_slots: TRANSFER_INVENTORY_MAX_LIMIT - state.transfer_inventory.length
			});
			const claim = res?.claim;
			if (!claim)
				break;

			const applied = apply_banishment_claim(transfer_delivery_state, claim, TRANSFER_INVENTORY_MAX_LIMIT);
			if (applied.status === 'blocked')
				break;
			if (applied.status === 'applied') {
				transfer_delivery_state = applied.state;
				state.transfer_inventory = transfer_delivery_state.inventory.map(entry => ({ ...entry }));
				set_instance_storage_item('transfer_delivery_state', transfer_delivery_state);
			}
			if (claim.banished?.guild_name) {
				set_instance_storage_item('pending_banishment_guild_name', claim.banished.guild_name);
				state.pending_banishment_guild_name = claim.banished.guild_name;
			}

			const acknowledged = await api_post('/api/banishment/returns/acknowledge', {
				claim_id: claim.claim_id
			});
			if (!acknowledged?.success)
				break;
		}
		update_transfer_inventory_nav();
		show_pending_banishment_notice();
	} catch (e) {
		error('failed to reconcile Banishment Return (%s)', e);
	} finally {
		is_reconciling_banishment_returns = false;
	}
}
// #endregion

// #region API FUNCTIONS
function update_service_notice(kind, translate = getLangString) {
	if (state.multiplayer_unsupported) return;
	state.service_status = kind === 'resolved' ? null : kind;
	const previous = state.chat_conversations.find(entry => entry.synthetic_service);
	const conversation = service_module.service_conversation(kind, translate, previous);
	state.chat_conversations = [...state.chat_conversations.filter(entry => !entry.synthetic_service), conversation];
	if (state.selected_chat_conversation?.synthetic_service) {
		state.selected_chat_conversation = conversation;
		state.chat_messages = [conversation.latest_message];
	}
	state.chat_error = '';
	state.chat_unread = state.get_chat_notification_unread();
	if (interface_ready) update_chat_nav();
	if (kind !== 'resolved') stop_chat_polling();
}

async function service_fetch(fetch_impl, endpoint, options, request = {}, probe = false) {
	if (service_availability?.active() && !probe)
		throw Object.assign(new Error('Service paused'), { code: 'service_paused' });
	const generation = session_generation, origin = server_host;
	const ticket = service_availability?.ticket();
	const current = () => generation === session_generation && origin === server_host && !state.multiplayer_unsupported;
	let received = false;
	return polling.fetch_with_timeout(fetch_impl, endpoint, options, { ...request,
		observe: entry => {
			request.observe?.(entry);
			if (current() && ['network_error', 'timeout', 'response_error'].includes(entry.outcome))
				service_availability?.fail(received ? 'unavailable' : 'unreachable', null, ticket);
		},
		consume: async response => {
			received = true;
			if (response.status >= 500 && current()) {
				let body = null;
				if (response.headers.get('Content-Type')?.includes('application/json')) {
					try { body = await response.clone().json(); } catch { /* Gateway bodies need not be JSON. */ }
				}
				if (current()) service_availability?.fail(response.status === 503 && body?.error === 'maintenance' ? 'maintenance' : 'unavailable',
					response.headers.get('Retry-After'), ticket);
			}
			return request.consume ? request.consume(response) : response;
		}
	});
}

async function probe_multiplayer_service() {
	const origin = server_host, generation = session_generation;
	if (!polling.is_foreground(document) || state.multiplayer_unsupported) return false;
	const response = await service_fetch(fetch, origin + '/api/versions', { method: 'GET', cache: 'no-store' }, {
		consume: async response => ({ status: response.status, json: response.ok ? await response.json() : null })
	}, true);
	if (origin !== server_host || generation !== session_generation || response.status !== 200 || !Array.isArray(response.json?.api_versions)) return false;
	// Release the transport gate before login; no user command is automatically replayed.
	service_availability.reset();
	update_service_notice('resolved');
	if (!state.is_connected) await start_multiplayer_session({ service_retry: true });
	else {
		read_cache.invalidate(); events_refreshed_at = 0;
		start_client_event_polling(); start_chat_polling();
	}
	return true;
}

function handle_session_response(response, request_generation) {
	if (request_generation !== session_generation || response.status !== 401 || !state.is_connected)
		return;
	state.is_connected = false;
	service_availability?.reset();
	state.service_status = null;
	if (state.chat_conversations?.some(entry => entry.synthetic_service)) {
		state.chat_conversations = state.chat_conversations.filter(entry => !entry.synthetic_service);
		if (state.selected_chat_conversation?.synthetic_service) state.close_chat_conversation();
		state.chat_unread = state.get_chat_notification_unread();
		if (interface_ready) update_chat_nav();
	}
	state.clear_browser_links?.();
	state.pending_preview = null;
	client_event_poll_id++;
	stop_chat_polling();
	stop_gp_sampling();
	stop_status_observer();
	clearTimeout(status_sync_timer);
	status_sync_timer = null;
	notify_error(response.headers.get('X-Multiplayer-Session-State') === 'replaced'
		? 'MOD_MP_SESSION_REPLACED' : 'MOD_MP_SESSION_ENDED');
}

let api_contract;
let economy_command_module;
let economy_command_journal;
let rollback_module;
let rollback_client = null;
let rollback_server_supported = false;
let economy_commands_ready = false;
let client_events_hydrated = false;
let selected_api_major = null;

function unsupported_support_conversation(minimum_supported_mod_version) {
	const created_at = Date.now();
	const message = {
		message_id: -1, conversation_id: -1, sender_id: null,
		sender: { display_name: getLangString('MOD_MP_CHAT_CATEGORY_SUPPORT'), icon_id: 'multiplayer' },
		content: getLangString('MOD_MP_UNSUPPORTED_VERSION_MESSAGE'), created_at,
		author_side: 'team', sent_by_viewer: false, reactions: []
	};
	return {
		conversation_kind: 'support', conversation_id: -1, support_team_id: -1, viewer_side: 'player',
		synthetic_unsupported: true,
		participant: { client_id: null, display_name: getLangString('MOD_MP_CHAT_CATEGORY_SUPPORT'), icon_id: 'multiplayer' },
		created_at, latest_message: message, unread_count: 1, blocked: false, minimum_supported_mod_version
	};
}

function enter_unsupported_multiplayer(minimum_supported_mod_version) {
	if (!client_runtime.is_mod_version_unsupported(MOD_VERSION, minimum_supported_mod_version))
		return false;
	service_availability?.reset();
	state.service_status = null;
	state.multiplayer_unsupported = true;
	state.minimum_supported_mod_version = minimum_supported_mod_version;
	state.is_connected = false;
	state.clear_browser_links?.();
	state.pending_preview = null;
	economy_commands_ready = false;
	client_event_poll_id++;
	stop_chat_polling();
	stop_gp_sampling();
	stop_status_observer();
	clearTimeout(status_sync_timer);
	status_sync_timer = null;
	clearTimeout(equipment_sync_timer);
	equipment_sync_timer = null;
	const conversation = unsupported_support_conversation(minimum_supported_mod_version);
	state.chat_conversations = [conversation];
	state.chat_unread = 1;
	if (state.selected_chat_conversation?.synthetic_unsupported === true) {
		state.selected_chat_conversation = conversation;
		state.chat_messages = [conversation.latest_message];
	}
	if (interface_ready) {
		update_chat_nav();
		update_multiplayer_nav();
	}
	return true;
}

async function discover_api_contract() {
	const origin = server_host;
	const generation = session_generation;
	selected_api_major = null;
	rollback_server_supported = false;
	identity_registration_supported = false;
	let minimum_supported_mod_version = null;
	let discovered_wiki_url = null;
	const major = await service_fetch(fetch, origin + '/api/versions', { method: 'GET' }, {
		observe: entry => transport_diagnostics?.record(entry),
		consume: async response => {
			const body = response.status === 200 ? await response.json() : null;
			minimum_supported_mod_version = body?.minimum_supported_mod_version ?? null;
			discovered_wiki_url = body?.wiki_url;
			page_snapshots_supported = body?.page_snapshots === true;
			identity_registration_supported = Array.isArray(body?.capabilities) && body.capabilities.includes('identity-registration-v1');
			rollback_server_supported = Array.isArray(body?.capabilities) && body.capabilities.includes('save-rollback-v1');
			return api_contract.select_api_major(response.status, body);
		}
	});
	if (origin !== server_host || generation !== session_generation)
		throw new Error('Stale API discovery');
	selected_api_major = major;
	state.wiki_url = api_contract.wiki_url(discovered_wiki_url);
	enter_unsupported_multiplayer(minimum_supported_mod_version);
}

function resolve_api_endpoint(endpoint, major = selected_api_major) {
	return api_contract.api_endpoint(endpoint, major);
}

function cache_bust_api_endpoint(endpoint) {
	const separator = endpoint.includes('?') ? '&' : '?';
	// Stable browser URLs let CORS preflights be reused. Native/unknown runtimes retain the cache workaround.
	const platform = get_device_diagnostics()?.platform;
	const nonce = platform === 'browser' ? `session-${session_generation}` : ++api_get_request_sequence;
	return `${endpoint}${separator}_mp_cache=${API_GET_CACHE_NONCE}-${nonce}`;
}

async function prepare_page_snapshot(page) {
	if (!page_snapshots_supported) return;
	const endpoint = '/api/pages/snapshot?page=' + page + (page === 'transfers' ? '&view=active' : '');
	const generation = session_generation;
	const snapshot = await read_cache.read(endpoint, valid => api_get_request(endpoint, valid));
	if (generation !== session_generation || !snapshot?.data) return;
	const measured_routes = { '/api/inbox': 'snapshot-inbox', '/api/market/haggles': 'snapshot-haggles',
		'/api/transfers/history?pane=inbox': 'snapshot-history-inbox',
		'/api/transfers/history?pane=outbox': 'snapshot-history-outbox',
		'/api/transfers/history?pane=pending': 'snapshot-history-pending' };
	for (const [route, duration] of Object.entries(snapshot.timings ?? {}))
		if (measured_routes[route] && Number.isFinite(duration)) transport_diagnostics?.phase(measured_routes[route], duration);
	for (const [route, value] of Object.entries(snapshot.data))
		if (value && typeof value === 'object' && !value.error_lang && !value.status) read_cache.prime(route, value);
}

async function coordinated_request(endpoint, options, request) {
	const generation = session_generation;
	const origin = server_host;
	const read_only_post = /\/api\/v\d+\/(?:market\/(?:search|catalog)|transfers\/get_contents)(?:\?|$)/.test(endpoint);
	const acknowledgement = /\/api\/v\d+\/(?:inbox|economy\/receipts|banishment\/returns|raids\/cache)\/acknowledge(?:\?|$)/.test(endpoint);
	const read = options.method !== 'POST' || read_only_post;
	const background_sync = /\/client\/(?:status|equipment)\/sync(?:\?|$)/.test(endpoint);
	const foreground = read && ((chat_page_visible && /\/(?:chat|polls)(?:\/|\?|$)/.test(endpoint)) ||
		(guild_page_visible && /\/(?:guilds|alliances|pages)(?:\/|\?|$)/.test(endpoint)) ||
		(state.is_transfer_page_visible && /\/(?:inbox|transfers|market|pages)(?:\/|\?|$)/.test(endpoint)) ||
		(crucible_page_visible && endpoint.includes('/crucible/')) ||
		(expedition_page_visible && endpoint.includes('/expedition/')));
	const priority = acknowledgement ? 2 : foreground || (!read && !background_sync) ? 1 : 0;
	const queued_at = Date.now();
	return request_scheduler.run(priority, async () => {
		if (generation !== session_generation || origin !== server_host) throw new DOMException('Stale request', 'AbortError');
		const consume = request.consume;
		const queue_wait_ms = Date.now() - queued_at;
		const handshake = /\/api\/v\d+\/(?:authenticate|register)(?:\?|$)/.test(endpoint);
		const timer = handshake && rollback_module ? rollback_module.create_handshake_timer(fetch) : null;
		const result = await service_fetch(timer?.fetch ?? fetch, endpoint, options, { ...request, observe: entry => request.observe?.({ ...entry, queue_wait_ms }), consume: response => {
			request_scheduler.observe(response);
			return consume(response);
		} });
		if (timer && result?.json) {
			const payload = JSON.parse(options.body);
			return { ...result, timing: { ...timer.snapshot(), origin, generation, load_id: payload.client_runtime?.loaded_save?.load_id } };
		}
		return result;
	}, () => generation === session_generation && origin === server_host &&
		(!read || request.is_current?.() !== false), read);
}

async function api_get(endpoint, is_current = null) {
	if (state.multiplayer_unsupported)
		return null;
	if (is_current) return api_get_request(endpoint, is_current);
	const preview = endpoint.startsWith('/api/alliances/guild-preview?');
	const scope = server_host + ':' + session_generation;
	if (guild_preview_scope !== scope) {
		guild_preview_scope = scope;
		unavailable_guild_previews.clear();
	}
	if (preview && unavailable_guild_previews.has(endpoint)) return { guild: null };
	const result = await read_cache.read(endpoint, valid => api_get_request(endpoint, valid), CACHED_READS.has(endpoint) || preview);
	// Historical petitions can outlive their Guild. Remember only definitive misses,
	// independently of routine Council cache invalidation, within this server/session.
	if (preview && result?.guild === null && scope === server_host + ':' + session_generation)
		unavailable_guild_previews.add(endpoint);
	return result;
}

async function api_get_request(endpoint, is_current = () => true, retry_throttled = true) {
	if (state.multiplayer_unsupported)
		return null;
	const request_generation = session_generation;
	let throttled = false;
	try {
		if (selected_api_major === null) await discover_api_contract();
		const catalog_request = equipment_catalog_cache?.prepare(endpoint);
		const result = await coordinated_request(server_host + cache_bust_api_endpoint(resolve_api_endpoint(catalog_request?.endpoint ?? endpoint)), {
			method: 'GET',
			headers: {
				'X-Session-Token': session_token ?? undefined
			}
		}, {
			is_current,
			observe: entry => transport_diagnostics?.record(entry),
			consume: async res => {
				throttled = res.status === 429;
				handle_session_response(res, request_generation);
				const json = res.headers.get('Content-Type')?.includes('application/json') ? await res.json() : null;
				if (res.status === 426)
					enter_unsupported_multiplayer(json?.minimum_supported_mod_version);
				if (res.status === 404 && endpoint.startsWith('/api/alliances/guild-preview?') &&
					request_generation === session_generation && is_current()) return { guild: null };
				return res.status === 200 && request_generation === session_generation ? (catalog_request ? catalog_request.hydrate(json) : json) : null;
			}
		});
		if (throttled && retry_throttled && is_current())
			return api_get_request(endpoint, is_current, false);
		return result;
	} catch (e) {
		if (e?.name !== 'AbortError' || is_current())
			error('GET transport failed for %s (%s)', endpoint, e?.name ?? 'Error');
		return null;
	}
}

async function api_post_response(endpoint, payload, request_session_token = session_token, major = selected_api_major) {
	if (state.multiplayer_unsupported)
		return { response: null, json: null };
	if (payload?.command_id !== undefined && economy_command_journal)
		return economy_command_journal.run(endpoint, payload, major);
	return api_post_response_raw(endpoint, payload, request_session_token, major);
}

async function api_post_response_raw(endpoint, payload, request_session_token = session_token, major = selected_api_major) {
	if (state.multiplayer_unsupported)
		return { response: null, json: null };
	if (rollback_client && !rollback_client.admitted() && rollback_module.unsafe_rollback_client_request(endpoint))
		return { response: null, json: { success:false,error:'economy_review_pending' } };
	const request_generation = session_generation;
	try {
		const catalog_request = equipment_catalog_cache?.prepare(endpoint);
		return await coordinated_request(server_host + resolve_api_endpoint(catalog_request?.endpoint ?? endpoint, major), {
			method: 'POST',
			body: JSON.stringify(payload),
			headers: {
				'Content-Type': 'application/json',
				'X-Session-Token': request_session_token ?? undefined
			}
		}, {
			observe: entry => transport_diagnostics?.record(entry),
			consume: async res => {
				handle_session_response(res, request_generation);
				let json = null;
				if (res.headers.get('Content-Type')?.includes('application/json'))
					json = await res.json();
				if (res.status === 426)
					enter_unsupported_multiplayer(json?.minimum_supported_mod_version);
				if (request_generation !== session_generation) return { response: null, json: null };
				if (catalog_request) json = catalog_request.hydrate(json);
				if (rollback_module?.transient_rollback_failure(json)) { rollback_client?.block(); economy_commands_ready = false; }
				const retired_id = rollback_module?.retired_rollback_command(json);
				if (retired_id) rollback_client?.retire(retired_id);
				if (res.ok && json?.success !== false && !json?.error_lang &&
					(is_event_affecting_mutation(endpoint) || /^\/api\/(?:inbox\/|market\/haggle(?:\/|$)|client\/(?:set_display_name|set_icon)$)/.test(endpoint))) {
					if (endpoint !== '/api/economy/receipts/acknowledge') {
						const governance = /^\/api\/(?:guilds|alliances|banishment|social-mode|client)\//.test(endpoint);
						const transfers_affected = /^\/api\/(?:inbox|market|gift|trade|crucible)\//.test(endpoint);
						if (governance || transfers_affected) read_cache.invalidate(key => governance || key.includes('transfers') || key.includes('page=transfers') ||
							key.startsWith('/api/inbox') || key.startsWith('/api/market') || key.startsWith('/api/crucible'));
					}
					if (endpoint.startsWith('/api/market/haggle') && market_haggles_update_request !== null)
						market_haggles_update_requested = true;
					events_refreshed_at = 0;
					if (client_event_request !== null) client_event_trailing = true;
					if (state.is_transfer_page_visible && /^\/api\/(?:inbox|market|gift|trade|crucible|banishment|economy\/receipts|guilds|social-mode)\//.test(endpoint))
						schedule_transfer_history_refresh();
				}
				return { response: res, json };
			}
		});
	} catch (e) {
		error('POST transport failed for %s (%s)', endpoint, e?.name ?? 'Error');
		return { response: null, json: null };
	}
}

async function api_post_binary_response(endpoint, bytes, media_type, upload_token) {
	if (state.multiplayer_unsupported)
		return { response: null, json: null };
	const request_generation = session_generation;
	try {
		return await coordinated_request(server_host + resolve_api_endpoint(endpoint), {
			method: 'POST',
			body: bytes,
			headers: {
				'Content-Type': media_type,
				'X-Session-Token': session_token ?? undefined,
				'X-Icon-Catalog-Upload-Token': upload_token
			}
		}, {
			observe: entry => transport_diagnostics?.record(entry),
			consume: async res => {
				handle_session_response(res, request_generation);
				let json = null;
				if (res.headers.get('Content-Type')?.includes('application/json'))
					json = await res.json();
				if (res.status === 426)
					enter_unsupported_multiplayer(json?.minimum_supported_mod_version);
				return request_generation === session_generation ? { response: res, json } : { response: null, json: null };
			}
		});
	} catch (e) {
		error('binary POST transport failed for %s (%s)', endpoint, e?.name ?? 'Error');
		return { response: null, json: null };
	}
}

async function api_post_without_economy_journal(endpoint, payload, major = selected_api_major) {
	const result = await api_post_response_raw(endpoint, payload, session_token, major);
	return result.response?.status === 200 ? result.json : null;
}

async function api_post(endpoint, payload, major = selected_api_major) {
	const result = await api_post_response(endpoint, payload, session_token, major);
	if (result.response?.status === 200) {
		if (endpoint.startsWith('/api/guilds/') || endpoint.startsWith('/api/banishment/'))
			invalidate_guild_state();
		if (is_event_affecting_mutation(endpoint) && result.json !== null && result.json?.error_lang === undefined &&
			result.json?.success !== false)
			void get_client_events();
		return result.json;
	}

	return null;
}

const EVENT_AFFECTING_MUTATIONS = new Set([
	'/api/banishment/returns/acknowledge',
	'/api/banishment/returns/claim',
	'/api/crucible/cast',
	'/api/crucible/reclaim',
	'/api/crucible/clear',
	'/api/crucible/wish/make',
	'/api/crucible/wish/capacity',
	'/api/crucible/wish/renewal',
	'/api/crucible/wish/cancel',
	'/api/crucible/wish/claim',
	'/api/chat/block',
	'/api/chat/conversations/delete',
	'/api/chat/conversations/start',
	'/api/chat/global-participation',
	'/api/chat/guild-participation',
	'/api/chat/alliance-participation',
	'/api/alliances/propose',
	'/api/alliances/consider',
	'/api/alliances/withdraw',
	'/api/chat/messages/delete',
	'/api/chat/messages/send',
	'/api/chat/privacy',
	'/api/economy/receipts/acknowledge',
	'/api/friends/accept',
	'/api/friends/add',
	'/api/friends/ignore',
	'/api/friends/remove',
	'/api/gift/accept',
	'/api/gift/decline',
	'/api/gift/discard',
	'/api/gift/send',
	'/api/guilds/application/decide',
	'/api/guilds/apply',
	'/api/guilds/create',
	'/api/guilds/join',
	'/api/guilds/join-free',
	'/api/guilds/leave',
	'/api/guilds/petitions/raise',
	'/api/guilds/petitions/vote',
	'/api/guilds/petitions/withdraw',
	'/api/guilds/withdraw',
	'/api/identities/delete',
	'/api/identities/delete/cancel',
	'/api/market/buy',
	'/api/market/buy-order',
	'/api/market/cancel',
	'/api/market/claim-legacy-payouts',
	'/api/market/destroy',
	'/api/market/fulfill',
	'/api/market/payout',
	'/api/market/sell',
	'/api/social-mode/cancel',
	'/api/social-mode/set',
	'/api/trade/accept',
	'/api/trade/cancel',
	'/api/trade/counter',
	'/api/trade/decline',
	'/api/trade/offer',
	'/api/trade/resolve'
]);

function is_event_affecting_mutation(endpoint) {
	return EVENT_AFFECTING_MUTATIONS.has(endpoint.split('?')[0]);
}

async function refresh_identities() {
	if (!state.is_connected)
		return;
	state.identities_loading = true;
	state.identities_error = '';
	try {
		const res = await api_get('/api/identities');
		if (res === null)
			throw new Error('identity list unavailable');
		state.identities = Array.isArray(res.identities) ? res.identities : [];
		state.self_deletion = res.self_deletion ?? null;
	} catch (e) {
		error('failed to refresh linked identities (%s)', e);
		state.identities_error = getLangString('MOD_MP_IDENTITIES_LOAD_FAILED');
	} finally {
		state.identities_loading = false;
	}
}

function queue_identity_notice(type, data = {}) {
	pending_identity_notices.push({ type, data });
	show_pending_identity_notices();
}

function show_pending_identity_notices() {
	if (!interface_ready)
		return;
	for (const notice of pending_identity_notices.splice(0)) {
		if (notice.type === 'bootstrap') {
			if (!state.is_connected) open_identity_bootstrap();
		} else if (notice.type === 'account_changed') {
			queue_modal('MOD_MP_IDENTITY_ACCOUNT_CHANGED_TITLE', 'identity-account-changed-modal');
		} else if (notice.type === 'deletion_cancelled') {
			state.identity_notice_requester = notice.data.requester_display_name;
			state.identity_notice_time = new Date(notice.data.requested_at).toLocaleString();
			queue_modal('MOD_MP_IDENTITY_DELETION_CANCELLED_TITLE', 'identity-deletion-cancelled-modal');
		} else if (notice.type === 'recovered') {
			queue_modal('MOD_MP_IDENTITY_RECOVERED_TITLE', 'identity-recovered-modal');
		} else if (notice.type === 'outdated_version') {
			queue_modal('MOD_MP_OUTDATED_VERSION_TITLE', 'outdated-version-modal');
		} else if (notice.type === 'social_mode_choice') {
			queue_social_mode_modal(true);
		} else if (notice.type === 'default_avatar') {
			state.show_icon_modal(true);
		}
	}
}

function queue_default_avatar_notice() {
	if (state.profile_icon === DEFAULT_AVATAR_ICON_ID &&
		get_instance_storage_item(DEFAULT_AVATAR_PROMPT_STORAGE_KEY) !== true)
		queue_identity_notice('default_avatar');
}

function check_released_mod_version(released_mod_version) {
	if (release_notice_shown || !client_runtime.is_mod_version_outdated(MOD_VERSION, released_mod_version))
		return;
	release_notice_shown = true;
	state.released_mod_version = released_mod_version;
	queue_identity_notice('outdated_version');
}

function set_session_token(token) {
	state.pending_preview = null;
	state.transfer_history = transfer_history_module.create_transfer_history_state();
	session_token = token;
	session_generation++;
	expedition_leaderboard?.reset();
	combat_arena?.close();
	state.clear_browser_links?.();
	combat_inventory?.reset();
	state.combat_dungeons_visited = get_instance_storage_item('combat_dungeons_visited') === true;
	events_refreshed_at = 0;
	last_events_result = null;
	state.is_connected = true;
	const saved_listing_filters = get_instance_storage_item('listing_filters');
	state.listing_filters = Array.isArray(saved_listing_filters)
		? state.listing_filter_categories.filter(id => saved_listing_filters.includes(id)) : ['items'];
	state.expedition_state = null;
	state.expedition_loading = false;
	expedition_work_prompt_gate?.reset();
	state.expedition_personal = null;
	state.expedition_pending_report = null;
	state.expedition_report_notice_visible = false;
	state.expedition_vote_cooldown_until = 0;
	state.expedition_check_in_cooldown_until = 0;
	last_expedition_state_refresh_at = 0;
	last_expedition_work_observed_at = 0;
	last_expedition_check_in_at = Date.now();
	last_synced_equipment = null;
	last_synced_status_skills = null;
	last_synced_status_activities = null;
	last_synced_status_statistics = null;
	last_synced_gp = null;
	last_observed_status_activities = null;
	last_observed_status_statistics = null;
	last_status_sync_at = 0;
	status_sync_failures = 0;
	client_event_revision = 0;
	client_events_hydrated = false;
	client_events_have_pending = false;
	client_event_scheduled_checks = 0;
	gp_scheduled_checks = 0;
	stop_gp_sampling();
	invalidate_guild_state();
	log('client session authenticated');
	offline_work_gate?.request();
}

function apply_dev_badge_labels(labels) {
	if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return;
	const next = Object.fromEntries(Object.entries(labels).filter(([id, label]) =>
		chat_items.badge_feature(id) && chat_items.valid_dev_badge_label(label)));
	if (JSON.stringify(next) === JSON.stringify(state.dev_badge_labels)) return;
	state.dev_badge_labels = next;
	for (const chip of document.querySelectorAll('.mp-chat-badge[data-feature-id]')) {
		const label = chat_items.feature_name(game, getLangString, chip.dataset.featureId, next);
		if (chip.firstChild?.nodeType === 3) chip.firstChild.nodeValue = label;
	}
}

async function refresh_chat_state() {
	const res = await api_get('/api/chat/state');
	if (res === null)
		return;
	apply_dev_badge_labels(res.dev_badge_labels);
	state.messaging_enabled = res.messaging_enabled !== false;
	state.global_chat_enabled = res.global_chat_enabled !== false;
	if (Array.isArray(res.account_tags)) state.account_tags = res.account_tags;
	state.guild_chat_enabled = res.guild_chat_enabled !== false;
	state.chat_client_id = res.client_id;
	state.chat_is_admin = res.is_admin === true;
	state.chat_can_highlight = res.can_highlight === true;
	state.chat_budget_enabled = res.budget_enabled !== false;
	if (res.budget)
		state.chat_budget = res.budget;
}

async function refresh_chat_conversations() {
	const selected = state.selected_chat_conversation;
	const res = await api_get('/api/chat/conversations?capabilities=' + CHAT_CAPABILITIES);
	if (!Array.isArray(res?.conversations))
		return;
	const conversations = [...res.conversations];
	conversations.push(...(state.chat_conversations ?? []).filter(entry => entry.synthetic_service));
	state.polls_summary = res.polls_summary ?? null;
	if (res.polls_summary) state.poll_can_create = res.polls_summary.can_create === true;
	conversations.push({ conversation_kind: 'polls', conversation_id: 1,
		participant: { client_id: null, display_name: getLangString('MOD_MP_POLLS_TITLE'), icon_id: 'multiplayer' },
		created_at: 0, latest_message: null, unread_count: 0, blocked: false });
	state.chat_conversations = conversations;
	state.global_chat_enabled = res.global_chat?.enabled !== false;
	state.alliance_chat_state = res.alliance_chat ?? { affiliated: false, enabled: true };
	state.alliance_chat_enabled = state.alliance_chat_state.enabled !== false;
	state.guild_chat_state = res.guild_chat ?? { affiliated: false, enabled: state.guild_chat_enabled };
	state.guild_chat_enabled = state.guild_chat_state.enabled !== false;
	state.chat_unread = state.get_chat_notification_unread(res.conversations) +
		(state.chat_conversations?.find(entry => entry.synthetic_service)?.unread_count ?? 0);
	update_chat_nav();
	// An inbox request must not restore a conversation the player has since left.
	if (selected && state.selected_chat_conversation === selected) {
		const current = res.conversations.find(conversation =>
			(conversation.conversation_kind ?? 'private') ===
				(selected.conversation_kind ?? 'private') &&
			conversation.conversation_id === selected.conversation_id &&
			conversation.support_team_id === selected.support_team_id
		);
		if (current) {
			const moderation_changed = (current.conversation_kind === 'alliance' || current.conversation_kind === 'guild' || current.conversation_kind === 'global' ||
				current.conversation_kind === 'announcements') &&
				Number.isSafeInteger(selected.moderation_count) &&
				Number.isSafeInteger(current.moderation_count) &&
				current.moderation_count !== selected.moderation_count;
			current.message_moderation_count = selected.message_moderation_count;
			state.selected_chat_conversation = current;
			if (moderation_changed) {
				state.close_chat_conversation();
				await state.open_chat_conversation(current);
			}
		} else if (selected.conversation_kind === 'alliance' || selected.conversation_kind === 'guild' || selected.conversation_kind === 'global' ||
			selected.conversation_kind === 'announcements') {
			state.close_chat_conversation();
		}
	}
}

function update_chat_nav() {
	const tagged = state.get_chat_notification_tagged();
	const aside = document.querySelector('.mp-chat-nav');
	if (aside !== null) {
		set_nav_ready(aside, true);
		aside.classList.toggle('mp-chat-tagged-nav', tagged);
		aside.textContent = tagged ? '@' : state.chat_unread > 0 ? String(state.chat_unread) : '';
		aside.hidden = state.chat_unread <= 0;
	}
	const header_badge = document.getElementById('mp-chat-header-unread');
	if (header_badge !== null) {
		header_badge.classList.toggle('mp-chat-tagged-nav', tagged);
		header_badge.textContent = tagged ? '@' : state.chat_unread > 0 ? String(state.chat_unread) : '';
		header_badge.hidden = state.chat_unread <= 0;
	}
}

function setup_mobile_sidebar_unread() {
	const sidebar_button = document.getElementById('sidebar-btn');
	if (!sidebar_button || sidebar_button.querySelector('#mp-chat-header-unread'))
		return;
	const badge = document.createElement('span');
	badge.id = 'mp-chat-header-unread';
	badge.className = 'text-size-sm font-w600 text-white badge badge-danger mp-chat-header-unread';
	badge.setAttribute('aria-hidden', 'true');
	badge.hidden = true;
	sidebar_button.append(badge);
}

async function refresh_chat_messages(cursor = '', prepend = false, quiet = false, view_generation = chat_view_generation) {
	const conversation = state.selected_chat_conversation;
	if (conversation?.synthetic_service || conversation?.synthetic_unsupported) return true;
	if (!conversation || (state.chat_messages_loading && !quiet))
		return false;
	const kind = conversation.conversation_kind ?? 'private';
	const is_current = () => view_generation === chat_view_generation &&
		(state.selected_chat_conversation?.conversation_kind ?? 'private') === kind &&
		state.selected_chat_conversation?.conversation_id === conversation.conversation_id &&
		state.selected_chat_conversation?.support_team_id === conversation.support_team_id;
	if (kind === 'polls') {
		const after = quiet && Number.isSafeInteger(state.poll_revision) ? '&after=' + state.poll_revision : '';
		const res = await api_get('/api/polls?capabilities=' + POLLS_CAPABILITY + after, is_current);
		if (!is_current()) return false;
		if (!Array.isArray(res?.polls)) return false;
		if (Array.isArray(res.deleted_poll_ids) && res.deleted_poll_ids.length > 0) {
			const deleted = new Set(res.deleted_poll_ids);
			state.polls = state.polls.filter(poll => !deleted.has(poll.poll_id));
			if (state.selected_chat_conversation?.conversation_kind === 'poll-discussion' &&
				deleted.has(state.selected_chat_conversation.conversation_id))
				state.close_chat_conversation();
		}
		if (!after) state.polls = [];
		for (const poll of res.polls) {
			const index = state.polls.findIndex(entry => entry.poll_id === poll.poll_id);
			if (index < 0) state.polls.push(poll); else state.polls[index] = poll;
		}
		if (res.discussion_unread_counts)
			for (const poll of state.polls)
				poll.discussion_unread_count = res.discussion_unread_counts[poll.poll_id] ?? 0;
		state.polls_summary = null;
		state.poll_revision = res.revision;
		state.poll_can_create = res.can_create === true;
		return true;
	}
	if (kind === 'private' && conversation.conversation_id === null)
		return false;
	const conversation_id = conversation.conversation_id;
	// Sends, older history and translation refreshes do not prove that intervening Messages were fetched.
	const advances_cursor = !prepend && (cursor.startsWith('&after=') || state.chat_message_cursor === null);
	if (!quiet)
		state.chat_messages_loading = true;
	state.chat_error = '';
	let res = null;
	let moderation_changed = false;
	try {
		const conversation_parameter = conversation.conversation_id === null
			? '' : '&conversation_id=' + conversation.conversation_id;
		const team_parameter = conversation.support_team_id === undefined
			? '' : '&support_team_id=' + conversation.support_team_id;
		const capability_parameter = kind === 'global' ? '&capabilities=' + GLOBAL_CHAT_CAPABILITY :
			kind === 'poll-discussion' ? '&capabilities=' + POLLS_CAPABILITY : '';
		const reaction_parameter = Number.isSafeInteger(state.chat_reaction_revision)
			? '&reaction_after=' + state.chat_reaction_revision : '';
		res = await api_get('/api/chat/messages?conversation_kind=' + kind + conversation_parameter + team_parameter +
			cursor + reaction_parameter + capability_parameter, is_current);
		if (Number.isSafeInteger(res?.moderation_count) &&
			Number.isSafeInteger(conversation.message_moderation_count) &&
			res.moderation_count !== conversation.message_moderation_count && cursor !== '') {
			// Match shared-chat moderation: reload visible history when a Message is hidden.
			res = await api_get('/api/chat/messages?conversation_kind=' + kind + conversation_parameter + team_parameter + capability_parameter, is_current);
			cursor = '';
			prepend = false;
			moderation_changed = true;
		}
		if (kind === 'petition-discussion' && typeof res?.petition_votes_visible === 'boolean' &&
			typeof conversation.petition_votes_visible === 'boolean' &&
			res.petition_votes_visible !== conversation.petition_votes_visible && cursor !== '') {
			// Revealed ballots can have IDs older than the current polling cursor.
			res = await api_get('/api/chat/messages?conversation_kind=' + kind + conversation_parameter, is_current);
			cursor = '';
			prepend = false;
			moderation_changed = true;
		}
		if (view_generation !== chat_view_generation ||
			(state.selected_chat_conversation?.conversation_kind ?? 'private') !== kind ||
			state.selected_chat_conversation?.conversation_id !== conversation_id ||
			state.selected_chat_conversation?.support_team_id !== conversation.support_team_id)
			return false;
		if ((kind === 'petition-discussion' || kind === 'announcement-discussion') && res?.error_lang === 'MOD_MP_CHAT_CONVERSATION_MISSING') {
			state.close_chat_conversation();
			return false;
		}
		if (Array.isArray(res?.messages)) {
			if (moderation_changed) {
				state.chat_messages = [];
				state.chat_message_cursor = null;
				state.chat_before_cursor = null;
				state.chat_reaction_revision = null;
			}
			if (advances_cursor || moderation_changed)
				state.chat_message_cursor = res.messages.reduce((latest, message) =>
					Math.max(latest, message.message_id), state.chat_message_cursor ?? 0);
			if (Number.isSafeInteger(res.moderation_count)) conversation.message_moderation_count = res.moderation_count;
			if (kind === 'petition-discussion') conversation.petition_votes_visible = res.petition_votes_visible;
			if (kind === 'announcement-discussion') {
				conversation.can_send = res.can_send === true;
				if (conversation.announcement) conversation.announcement.deleted = !conversation.can_send;
			}
			if (kind === 'petition-discussion' && !prepend) {
				const id = res.discussion_id ?? conversation_id;
				for (const entry of [...(state.council_petitions ?? []), ...(state.alliance_state?.processes ?? []), ...(state.events?.petition_discussions ?? [])])
					if ((entry.discussion_id ?? entry.petition_id) === id) {
						entry.discussion_unread_count = res.discussion_unread_count ?? 0;
						entry.discussion_has_unread_tag = res.discussion_has_unread_tag === true;
					}
				update_guild_nav();
			}
			if (kind === 'poll-discussion' && res.messages.length > 0) {
				const poll = state.polls.find(poll => poll.poll_id === conversation_id);
				if (poll) poll.discussion_unread_count = 0;
			}
			if (kind === 'announcements' && res.discussion_unread_counts)
				for (const message of state.chat_messages) message.discussion_unread_count = res.discussion_unread_counts[message.message_id] ?? 0;
			const known = new Set(state.chat_messages.map(message => message.message_id));
			const additions = res.messages.filter(message => !known.has(message.message_id));
			for (const incoming of res.messages) {
				const existing = state.chat_messages.find(message => message.message_id === incoming.message_id);
				if (existing) {
					existing.deleted = incoming.deleted === true;
					existing.can_delete = incoming.can_delete === true;
					if (incoming.discussion_unread_count !== undefined) existing.discussion_unread_count = incoming.discussion_unread_count;
					existing.translations = incoming.translations ?? {};
					existing.parts = incoming.parts;
					existing.translation_parts = incoming.translation_parts;
					existing.translation_status = incoming.translation_status;
					existing.translation_enqueued_at = incoming.translation_enqueued_at;
				}
			}
			const should_scroll_for_additions = quiet && additions.length > 0 && state.chat_messages_are_at_bottom();
			if (Array.isArray(res.reaction_updates)) {
				for (const update of res.reaction_updates) {
					const message = state.chat_messages.find(entry => entry.message_id === update?.message_id);
					if (message && Number.isSafeInteger(update.reaction_revision) && Array.isArray(update.reactions) &&
						update.reaction_revision >= (message.reaction_revision ?? 0)) {
						message.reactions = update.reactions;
						message.reaction_revision = update.reaction_revision;
					}
				}
			}
			if (Number.isSafeInteger(res.reaction_revision) &&
				res.reaction_revision >= (state.chat_reaction_revision ?? 0))
				state.chat_reaction_revision = res.reaction_revision;
			if (res.messages.length > 0 && (prepend || (cursor === '' && state.chat_before_cursor === null)))
				state.chat_before_cursor = res.messages[0].message_id;
			state.chat_messages = prepend
				? [...additions, ...state.chat_messages]
				: [...state.chat_messages, ...additions].sort((a, b) => a.message_id - b.message_id);
			if (prepend || cursor === '')
				state.chat_has_more = res.has_more === true;
			if (additions.length > 0) {
				if (!quiet && !prepend && cursor === '')
					await state.scroll_chat_messages_to_bottom();
				if (kind !== 'petition-discussion')
					await refresh_chat_conversations();
			}
			if (should_scroll_for_additions)
				await state.scroll_chat_messages_to_bottom();
		} else if (!quiet) {
			state.chat_error = getLangString(res?.error_lang ?? 'MOD_MP_CHAT_LOAD_FAILED');
		}
		return Array.isArray(res?.messages);
	} catch (e) {
		log('Chat message refresh failed (%s)', e);
		return false;
	} finally {
		if (!quiet && view_generation === chat_view_generation)
			state.chat_messages_loading = false;
	}
}

async function refresh_chat_page() {
	if (!state.is_connected)
		return;
	const phase_started = performance.now();
	const view_generation = ++chat_view_generation;
	const petition_discussion = state.selected_chat_conversation?.conversation_kind === 'petition-discussion';
	state.chat_loading = true;
	try {
		await Promise.all([
			refresh_chat_state(),
			...(petition_discussion ? [] : [refresh_chat_conversations()]),
			...(state.selected_chat_conversation ? [refresh_chat_messages('', false, false, view_generation)] : [])
		]);
		if (state.selected_chat_conversation && view_generation === chat_view_generation)
			await state.scroll_chat_messages_to_bottom();
	} finally {
		transport_diagnostics?.phase('chat', performance.now() - phase_started);
		if (view_generation === chat_view_generation) {
			state.chat_loading = false;
			start_chat_polling();
		}
	}
}

function stop_chat_polling() {
	chat_poll_id++;
}

function start_chat_polling(immediate = false) {
	stop_chat_polling();
	chat_poll_failures = 0;
	if (service_availability?.active() || state.selected_chat_conversation?.synthetic_service || state.selected_chat_conversation?.synthetic_unsupported || !chat_page_visible || !state.selected_chat_conversation?.conversation_id || !polling.is_foreground(document))
		return;
	const poll_id = chat_poll_id;
	setTimeout(() => poll_chat_messages(poll_id), immediate ? 0 : polling.chat_poll_delay());
}

async function poll_chat_messages(poll_id) {
	if (poll_id !== chat_poll_id || !chat_page_visible || !polling.is_foreground(document))
		return;
	let succeeded = false;
	try {
		const view_generation = chat_view_generation;
		if (state.selected_chat_conversation) {
			const translation_pending = state.chat_messages.some(message =>
				state.is_chat_message_translation_pending(message));
			succeeded = await refresh_chat_messages(
				translation_pending || state.chat_message_cursor === null ? '' : '&after=' + state.chat_message_cursor,
				false,
				true,
				view_generation
			);
		}
	} catch (e) {
		error('Chat polling failed (%s)', e);
	} finally {
		chat_poll_failures = succeeded ? 0 : Math.min(chat_poll_failures + 1, 5);
		if (poll_id === chat_poll_id && chat_page_visible && state.selected_chat_conversation && polling.is_foreground(document)) {
			const delay = succeeded
				? polling.chat_poll_delay()
				: polling.retry_poll_delay(chat_poll_failures);
			setTimeout(() => poll_chat_messages(poll_id), delay);
		}
	}
}

async function get_friends() {
	const res = await api_get('/api/friends/get');
	if (res !== null)
		state.friends = res.friends;
}

function invalidate_guild_state() {
	guild_state_refreshed_at = 0;
	read_cache?.invalidate(key => key.includes('guild') || key.includes('alliance') || key.includes('decisions'));
}

async function refresh_guild_state(force = false) {
	if (force && guild_state_refresh_request === null)
		read_cache?.invalidate(key => key === '/api/guilds/state' || key.includes('page=guild') || key.includes('page=decisions'));
	if (!force && state.guild_state_loaded && Date.now() - guild_state_refreshed_at < GUILD_STATE_FRESHNESS)
		return state.guild_state;
	if (guild_state_refresh_request !== null)
		return guild_state_refresh_request;
	guild_state_refresh_request = refresh_guild_state_request();
	try {
		return await guild_state_refresh_request;
	} finally {
		guild_state_refresh_request = null;
	}
}

async function refresh_initial_guild_state() {
	const generation = session_generation;
	// Let the first Events revision invalidate old reads before hydrating eligibility.
	// A failed Events request must not leave Guild eligibility unresolved.
	await get_client_events();
	if (generation === session_generation && state.is_connected) await refresh_guild_state();
}

async function refresh_guild_state_after_invalidation() {
	const pending_refresh = guild_state_refresh_request;
	if (pending_refresh !== null)
		await pending_refresh;
	return refresh_guild_state(true);
}

async function refresh_guild_state_request() {
	const refresh_id = ++guild_state_refresh_id;
	const refresh_generation = session_generation;
	state.guild_state_loading = true;
	state.guild_state_error = '';
	try {
		const res = await api_get('/api/guilds/state');
		if (refresh_id !== guild_state_refresh_id || refresh_generation !== session_generation)
			return null;

		if (res === null) {
			state.guild_state_error = getLangString('MOD_MP_GUILD_LOAD_FAILED');
			return null;
		}

		state.guild_state = res;
		guild_state_refreshed_at = Date.now();
		state.guild_state_loaded = true;
		state.guild_client_id = res.current_client_id ?? null;
		state.guild_members = prioritize_current_guild_member((res.members ?? []).map(member => ({
			...member,
			skills_visible: member.skills_visible === true,
			skills_available: member.skills_available === true,
			activity_visible: member.activity_visible === true,
			activity_available: member.activity_available === true,
			status_activity: member.status_activity ?? null,
			status_activities: Array.isArray(member.status_activities) ? member.status_activities : [],
			account_age: Number.isSafeInteger(member.account_age) && member.account_age >= 0 ? member.account_age : null,
			total_skill_level: Number.isSafeInteger(member.total_skill_level) && member.total_skill_level >= 0 ? member.total_skill_level : null,
			gp: Number.isSafeInteger(member.gp) && member.gp >= 0 ? member.gp : null,
			last_seen_at: Number.isSafeInteger(member.last_seen_at) && member.last_seen_at > 0 ? member.last_seen_at : null,
			joined_at: Number.isSafeInteger(member.joined_at) && member.joined_at > 0 ? member.joined_at : null
		})));
		state.guild_member_search = res.member_directory?.search ?? '';
		state.guild_member_directory_page = res.member_directory?.page ?? 0;
		state.guild_member_directory_has_more = res.member_directory?.has_more === true;
		state.guild_applicants = res.applicants ?? [];
		state.events.guild_applicants = state.guild_applicants;
		update_multiplayer_nav();
		if (res.affiliation === 'member' && !state.expedition_state && !state.expedition_loading)
			void refresh_expedition_state();

		if (res.affiliation !== 'member') {
			state.shadowed_member_count = 0;
			state.council_petitions = [];
			state.council_available_petition_types = [];
			state.council_has_more = false;
			state.council_resolved_page = 0;
			state.council_show_resolved = false;
			state.market_completed = [];
			state.market_results = [];
			state.market_listings = [];
			state.crucible = null; state.crucible_summary = null;
		}

		return res;
	} catch (e) {
		error('failed to refresh Guild state (%s)', e);
		state.guild_state_error = getLangString('MOD_MP_GUILD_LOAD_FAILED');
		return null;
	} finally {
		state.guild_state_loading = false;
	}
}

function prioritize_current_guild_member(members) {
	const current_index = members.findIndex(member => member.client_id === state.guild_client_id);
	return current_index <= 0 ? members : [members[current_index], ...members.slice(0, current_index), ...members.slice(current_index + 1)];
}

async function refresh_guild_members(page = 0, search = state.guild_member_search, append = false) {
	if (!state.is_guild_member || !state.is_free_fellowship || state.guild_member_directory_loading)
		return;
	state.guild_member_directory_loading = true;
	try {
		const res = await api_get('/api/guilds/members?page=' + page + '&search=' + encodeURIComponent(search) + '&game_mode_ids=' + encodeURIComponent(JSON.stringify(
			game_mode_sharing.search_game_mode_ids(search, game.gamemodes?.allObjects ?? []))));
		if (res !== null) {
			const members = (res.members ?? []).map(member => ({
				...member,
				skills_visible: member.skills_visible === true,
				skills_available: member.skills_available === true,
				activity_visible: member.activity_visible === true,
				activity_available: member.activity_available === true,
				status_activity: member.status_activity ?? null,
				status_activities: Array.isArray(member.status_activities) ? member.status_activities : [],
				account_age: Number.isSafeInteger(member.account_age) && member.account_age >= 0 ? member.account_age : null,
				total_skill_level: Number.isSafeInteger(member.total_skill_level) && member.total_skill_level >= 0 ? member.total_skill_level : null,
				gp: Number.isSafeInteger(member.gp) && member.gp >= 0 ? member.gp : null,
				last_seen_at: Number.isSafeInteger(member.last_seen_at) && member.last_seen_at > 0 ? member.last_seen_at : null,
				joined_at: Number.isSafeInteger(member.joined_at) && member.joined_at > 0 ? member.joined_at : null
			}));
			state.guild_members = prioritize_current_guild_member(append
				? [...state.guild_members, ...members.filter(member =>
					!state.guild_members.some(existing => existing.client_id === member.client_id))]
				: members);
			state.guild_member_search = res.search ?? search;
			state.guild_member_directory_page = res.page ?? page;
			state.guild_member_directory_has_more = res.has_more === true;
			state.guild_state.member_directory = res;
		}
	} finally {
		state.guild_member_directory_loading = false;
	}
}

async function refresh_guild_activity(cursor = null, append = false) {
	if (!state.is_guild_member || state.guild_activity_loading)
		return;
	state.guild_activity_loading = true;
	state.guild_activity_error = false;
	try {
		const endpoint = '/api/guilds/activity' + (cursor === null ? '' : '?cursor=' + encodeURIComponent(cursor));
		const res = await api_get(endpoint);
		if (res === null) {
			state.guild_activity_error = true;
			return;
		}
		state.guild_activity = append ? [...state.guild_activity, ...res.events] : res.events;
		state.guild_activity_cursor = res.next_cursor;
	} finally {
		state.guild_activity_loading = false;
	}
}

async function load_more_guild_activity() {
	if (state.guild_activity_cursor !== null)
		await refresh_guild_activity(state.guild_activity_cursor, true);
}

function get_guild_activity_lang_id(event) {
	if (event.event_type === 'raid_started' && event.actor_client_id === null)
		return 'MOD_MP_GUILD_ACTIVITY_RAID_AUTOMATIC';
	return 'MOD_MP_GUILD_ACTIVITY_' + event.event_type.toUpperCase();
}

function get_guild_activity_arg_1(event) {
	if (event.event_type.startsWith('petition_'))
		return state.get_council_type_lang(event.metadata.petition_type);
	if (event.event_type === 'market_bought' || event.event_type === 'market_sold')
		return formatNumber(event.metadata.quantity);
	if (event.event_type === 'market_bought_by')
		return event.metadata.buyer_display_name ?? '';
	if (event.event_type === 'market_sold_to')
		return event.metadata.seller_display_name ?? '';
	return event.actor_display_name ?? '';
}

function get_guild_activity_arg_2(event) {
	if (event.event_type === 'market_bought' || event.event_type === 'market_sold')
		return state.get_item_name(event.metadata.item_id);
	if (event.event_type === 'market_bought_by' || event.event_type === 'market_sold_to')
		return formatNumber(event.metadata.quantity);
	return event.event_type === 'raid_boss_defeated' ? event.metadata.tier : '';
}

function get_guild_activity_arg_3(event) {
	if (event.event_type === 'market_bought' || event.event_type === 'market_sold')
		return event.event_type === 'market_bought'
			? event.metadata.seller_display_name ?? ''
			: event.metadata.buyer_display_name ?? '';
	if (event.event_type === 'market_bought_by' || event.event_type === 'market_sold_to')
		return state.get_item_name(event.metadata.item_id);
	return '';
}

function format_guild_activity_time(created_at) {
	return new Date(created_at).toLocaleString();
}

function get_guild_established_days() {
	const established_at = state.guild_state.guild?.established_at;
	if (!Number.isSafeInteger(established_at) || established_at < 0)
		return null;
	return Math.floor(Math.max(0, Date.now() - established_at) / (24 * 60 * 60 * 1000));
}

async function refresh_shadowed_members(page = 0, search = state.shadowed_member_search, append = false) {
	if (!state.is_guild_member || state.shadowed_member_directory_loading)
		return;
	state.shadowed_member_directory_loading = true;
	try {
		const modes = game_mode_sharing.search_game_mode_ids(search, game.gamemodes?.allObjects ?? []);
		const res = await api_get('/api/guilds/members/shadowed?page=' + page + '&search=' + encodeURIComponent(search) +
			(modes.length ? '&game_mode_ids=' + encodeURIComponent(JSON.stringify(modes)) : ''));
		if (res !== null) {
			const members = (res.members ?? []).map(member => ({
				...member,
				shadowed: true,
				status_activity: member.status_activity ?? null,
				status_activities: Array.isArray(member.status_activities) ? member.status_activities : [],
				account_age: Number.isSafeInteger(member.account_age) && member.account_age >= 0 ? member.account_age : null,
				total_skill_level: Number.isSafeInteger(member.total_skill_level) && member.total_skill_level >= 0 ? member.total_skill_level : null,
				gp: Number.isSafeInteger(member.gp) && member.gp >= 0 ? member.gp : null,
				last_seen_at: Number.isSafeInteger(member.last_seen_at) && member.last_seen_at > 0 ? member.last_seen_at : null,
				joined_at: Number.isSafeInteger(member.joined_at) && member.joined_at > 0 ? member.joined_at : null
			}));
			state.shadowed_members = append
				? [...state.shadowed_members, ...members.filter(member =>
					!state.shadowed_members.some(existing => existing.client_id === member.client_id))]
				: members;
			state.shadowed_member_search = res.search ?? search;
			state.shadowed_member_directory_page = res.page ?? page;
			state.shadowed_member_directory_has_more = res.has_more === true;
			state.shadowed_member_count = Number.isSafeInteger(res.total) && res.total >= 0 ? res.total : 0;
		}
	} finally {
		state.shadowed_member_directory_loading = false;
	}
}

async function refresh_guild_list() {
	const res = await api_get('/api/guilds/list');
	if (Array.isArray(res?.guilds)) state.guilds = res.guilds;
}

async function refresh_guild_page() {
	const phase_started = performance.now();
	try {
		setup_guild_icons();
		await get_client_events();
		await prepare_page_snapshot('guild');
		await refresh_guild_state();
		if (state.is_guild_member) {
			state.shadowed_member_count = 0;
			await Promise.all([refresh_council(), refresh_shadowed_members(), refresh_guild_activity()]);
			await state.refresh_alliance();
		}
		else if (state.guild_state.affiliation === 'none')
			await refresh_guild_list();
	} finally {
		transport_diagnostics?.phase('guild', performance.now() - phase_started);
	}
}

function set_guild_page_visible(is_visible) {
	guild_page_visible = is_visible;
	clearInterval(council_clock_timer);
	council_clock_timer = null;
	clearInterval(guild_raid_badge_timer);
	guild_raid_badge_timer = null;
	if (!is_visible) return;
	state.council_update_time = Date.now() + state.council_time_offset;
	void refresh_guild_page();
	council_clock_timer = setInterval(() => {
		const previous_time = state.council_update_time;
		state.council_update_time = Date.now() + state.council_time_offset;
		if (state.council_petitions.some(petition => petition.lifecycle === 'active' &&
			previous_time < petition.expires_at && state.council_update_time >= petition.expires_at))
			void refresh_council();
	}, 1_000);
	guild_raid_badge_timer = setInterval(() => void refresh_guild_state(true), 120_000);
}

async function refresh_raid_state() {
	const generation = ++raid_refresh_generation;
	state.raid_update_time = Date.now() + state.raid_time_offset;
	state.raid_loading = true;
	try {
		const res = await api_get('/api/raids/state');
		if (res !== null && generation === raid_refresh_generation) {
			state.raid_loaded = true;
			state.raid_state = res;
			state.raid_time_offset = Number.isSafeInteger(res.server_now) ? res.server_now - Date.now() : 0;
			state.raid_update_time = Date.now() + state.raid_time_offset;
			update_raid_nav();
			if (res.cache_pending)
				void reconcile_raid_cache();
		}
		return res;
	} finally {
		if (generation === raid_refresh_generation)
			state.raid_loading = false;
	}
}

function set_raid_page_visible(is_visible) {
	clearInterval(raid_clock_timer);
	raid_clock_timer = null;
	if (!is_visible) return;
	state.raid_update_time = Date.now() + state.raid_time_offset;
	void Promise.all([get_client_events(), refresh_raid_state()]);
	let refreshed_at = Date.now();
	raid_clock_timer = setInterval(() => {
		const previous_time = state.raid_update_time;
		state.raid_update_time = Date.now() + state.raid_time_offset;
		const boundary = state.raid?.expires_at ?? state.raid_state.activation_available_at;
		if (Date.now() - refreshed_at >= 60_000 ||
			(previous_time < boundary && state.raid_update_time >= boundary)) {
			refreshed_at = Date.now();
			void refresh_raid_state();
		}
	}, 1_000);
}

async function reconcile_raid_cache() {
	if (is_reconciling_raid_cache || !state.is_connected || state.is_social_only)
		return;
	is_reconciling_raid_cache = true;
	try {
		while (true) {
			const res = await api_get('/api/raids/cache');
			const cache = res?.cache;
			if (cache === null || cache === undefined)
				break;
			const processed = get_instance_storage_item('processed_raid_cache_ids') ?? [];
			if (!processed.includes(cache.id)) {
				const new_ids = cache.items
					.map(item => item.item_id)
					.filter(item_id => !state.transfer_inventory.some(item => item.id === item_id));
				if (state.transfer_inventory.length + new Set(new_ids).size > TRANSFER_INVENTORY_MAX_LIMIT) {
					state.raid_error = getLangString('MOD_MP_RAID_CACHE_FULL');
					break;
				}
				for (const item of cache.items) {
					const existing = state.transfer_inventory.find(entry => entry.id === item.item_id);
					if (existing)
						existing.qty += item.qty;
					else
						state.transfer_inventory.push({ id: item.item_id, qty: item.qty });
				}
				persist_transfer_inventory();
				processed.push(cache.id);
				set_instance_storage_item('processed_raid_cache_ids', processed.slice(-64));
			}
			const acknowledged = await api_post('/api/raids/cache/acknowledge', { cache_id: cache.id });
			if (!acknowledged?.success)
				break;
			state.raid_state.cache_pending = false;
			update_transfer_inventory_nav();
			if (interface_ready)
				queue_modal('MOD_MP_RAID_CACHE_TITLE', 'raid-cache-modal');
		}
	} catch (e) {
		error('failed to reconcile Guild Victory Cache (%s)', e);
	} finally {
		is_reconciling_raid_cache = false;
	}
}

async function refresh_council(page = 0, append = false) {
	if (!state.is_guild_member || state.council_loading)
		return;
	state.council_loading = true;
	try {
		const res = await api_get('/api/guilds/council?page=' + page);
		if (res !== null) {
			if (Number.isSafeInteger(res.server_time)) state.council_time_offset = res.server_time - Date.now();
			state.council_update_time = Date.now() + state.council_time_offset;
			void state.resolve_alliance_petition_guilds(res.petitions ?? []);
			if (append) {
				const known = new Set(state.council_petitions.map(petition => petition.petition_id));
				state.council_petitions.push(...res.petitions.filter(petition => !known.has(petition.petition_id)));
			} else {
				state.council_petitions = res.petitions ?? [];
			}
			state.council_resolved_page = res.resolved_page ?? page;
			state.council_has_more = res.has_more === true;
			state.council_available_petition_types = res.available_petition_types ?? [];
			apply_market_discovery_policy(res);
		}
	} finally {
		state.council_loading = false;
		update_guild_nav();
	}
}

async function get_client_events(reconcile_gifts = true) {
	if (economy_commands_ready && last_events_result && Date.now() - events_refreshed_at < 2000) return last_events_result;
	if (client_event_request !== null) {
		return client_event_request;
	}
	const request_generation = session_generation;
	client_event_request = get_client_events_request(reconcile_gifts, request_generation);
	try {
		const result = await client_event_request;
		if (result !== null) { last_events_result = result; events_refreshed_at = Date.now(); }
		return result;
	} finally {
		client_event_request = null;
		if (client_event_trailing) {
			client_event_trailing = false;
			events_refreshed_at = 0;
			if (state.is_connected && polling.is_foreground(document))
				void get_client_events();
		}
	}
}

async function get_client_events_request(reconcile_gifts, request_generation) {
	const endpoint = client_events_hydrated && !rollback_client?.needs_full()
		? '/api/events?revision=' + client_event_revision + '&capabilities=' + CHAT_CAPABILITIES + '&pending_preview=1&summaries=1&guild_revision=' + last_guild_revision
		: '/api/events?capabilities=' + CHAT_CAPABILITIES + '&pending_preview=1&summaries=1';
	const listing_filters = state.listing_filters.join(',');
	const res = await api_get(endpoint + '&listing_filters=' + encodeURIComponent(listing_filters));
	if (res !== null && request_generation === session_generation) {
		if (enter_unsupported_multiplayer(res.minimum_supported_mod_version))
			return res;
		if (listing_filters === state.listing_filters.join(',') && Object.hasOwn(res, 'crucible_summary')) {
			state.crucible_summary = res.crucible_summary;
			update_crucible_nav();
			void recover_paid_wish_actions();
			if (crucible_page_visible && !crucible_page_hydrating) void state.refresh_crucible();
		} else if (!crucible_page_hydrating) void state.refresh_crucible();
		void expedition_leaderboard?.refresh();
		void maybe_auto_check_in_expedition();
		if (state.expedition_state?.tracking && !state.expedition_pending_report &&
			Date.now() - last_expedition_work_observed_at >= 15 * 60_000)
			schedule_status_sync(0);
		if ((state.is_guild_member === true || state.expedition_state?.tracking) && !state.expedition_pending_report && !state.expedition_action_pending &&
			Date.now() - last_expedition_state_refresh_at >= EXPEDITION_STATE_REFRESH_INTERVAL)
			void refresh_expedition_state();
		apply_dev_badge_labels(res.dev_badge_labels);
		check_released_mod_version(res.released_mod_version);
		rollback_client?.consume(res.rollback);
		void rollback_client?.calibrate();
		void economy_receipt_reviews?.flush();
		if (rollback_client?.needs_full() && res.unchanged === true) {
			client_events_hydrated = false; client_event_trailing = true;
			return res;
		}
		if (res.unchanged === true) {
			void economy_command_journal?.recover();
			return res;
		}
		economy_commands_ready = false;
		client_events_have_pending = polling.has_pending_events(res);
		const revision_scope = server_host + ':' + session_generation;
		const guild_changed = guild_revision_scope !== revision_scope || !Number.isSafeInteger(res.guild_revision) || res.guild_revision !== last_guild_revision;
		guild_revision_scope = revision_scope; last_guild_revision = res.guild_revision;
		read_cache.invalidate(key => (CACHED_READS.has(key) || key.startsWith('/api/pages/snapshot?')) &&
			(guild_changed || !/\/(?:guilds|alliances)(?:\/|$)|page=(?:guild|decisions)/.test(key)));
		if (guild_changed) invalidate_guild_state();
		if (state.is_transfer_page_visible) {
			await prepare_page_snapshot('transfers');
			schedule_transfer_history_refresh();
		}
		state.events.friend_requests = res.friend_requests;
		if (typeof res.alliance_access === 'boolean') state.alliance_access = res.alliance_access;
		if (Array.isArray(res.account_tags)) state.account_tags = res.account_tags;
		state.events.guild_applicants = res.guild_applicants ?? [];
		state.events.petition_discussions = res.petition_discussions;
		state.market_completed = res.market_completed;
		state.market_haggle_pending = res.haggle_pending ?? 0;
		if (state.is_transfer_page_visible)
			update_market_haggles();
		const has_muted_chats = Object.values(state.chat_notification_preferences).includes(false);
		if (!has_muted_chats)
			state.chat_unread = (res.chat_unread ?? 0) + (state.chat_conversations?.find(entry => entry.synthetic_service)?.unread_count ?? 0);
		state.inbox_pending_claim = res.inbox_pending === true;
		update_chat_nav();
		if (chat_page_visible || has_muted_chats || state.chat_unread > 0 || state.get_chat_notification_tagged())
			await refresh_chat_conversations();
		if (request_generation !== session_generation)
			return null;

		state.pending_preview = res.pending_preview ?? null;
		event_snapshots.reconcile_event_transfers(state, res);
		if (res.social_mode === social_mode.SOCIAL_MODE_FULL || res.social_mode === social_mode.SOCIAL_MODE_SOCIAL) {
			state.social_mode = res.social_mode;
			state.social_mode_enforcement = ['identity', 'account', 'guild'].includes(res.social_mode_enforcement)
				? res.social_mode_enforcement : null;
			set_instance_storage_item('social_mode', state.social_mode);
		}
		reconcile_guild_member_social_modes(res.guild_member_social_modes);
		update_transfer_inventory_nav();
		update_multiplayer_nav();
		leave_social_only_disabled_page();

		if (state.is_transfer_page_visible) {
			setTimeout(() => update_transfer_contents(), 1);
		}
		else if (reconcile_gifts)
			void reconcile_pending_gifts();
		const pending_economy_receipts = res.economy_receipts;
		if (!await reconcile_economy_receipts(pending_economy_receipts ?? []))
			return res;
		if (request_generation !== session_generation)
			return null;
		const active_receipts = pending_economy_receipts?.filter(receipt => !economy_receipt_reviews?.has(receipt?.id));
		if (economy_receipts.is_complete_economy_receipt_page(active_receipts, ECONOMY_RECEIPT_PAGE_SIZE)) {
			if (!rollback_client || rollback_client.admitted()) remove_instance_storage_item('processed_economy_receipt_ids');
			economy_commands_ready = rollback_client ? rollback_client.complete_snapshot(true) : true;
		}
		if (Number.isSafeInteger(res.revision))
			client_event_revision = res.revision;
		client_events_hydrated = true;
		void economy_command_journal?.recover();
		if (res.inbox_pending === true || state.inbox_items.length > 0)
			void update_inbox();
		if (res.banishment_return_pending) {
			await reconcile_banishment_returns();
			if (request_generation !== session_generation)
				return null;
			const guild_state = await refresh_guild_state_after_invalidation();
			if (state.is_guild_member) await Promise.all([state.refresh_alliance(), refresh_council()]);
			else state.alliance_state = { alliance: null, processes: [], affiliation_pending: false };
			if (guild_state?.affiliation === 'none')
				await refresh_guild_list();
		}
		else if (guild_changed || !state.guild_state_loaded) {
			await prepare_page_snapshot(guild_page_visible ? 'guild' : 'decisions');
			if (request_generation !== session_generation) return null;
			await refresh_guild_state();
			if (request_generation !== session_generation) return null;
			if (state.is_guild_member) await Promise.all([state.refresh_alliance(), refresh_council()]);
		}
		update_guild_nav();
		show_pending_banishment_notice();
	}
	return res;
}

function start_client_event_polling(count_initial_check = false) {
	const poll_id = ++client_event_poll_id;
	client_event_poll_failures = 0;
	if (state.is_connected && polling.is_foreground(document))
		void poll_client_events(poll_id, count_initial_check);
}

async function poll_client_events(poll_id, scheduled_check = true) {
	let succeeded = false;
	try {
		succeeded = await get_client_events() !== null;
	} catch (e) {
		error('Client event polling failed (%s)', e);
	} finally {
		client_event_poll_failures = succeeded ? 0 : Math.min(client_event_poll_failures + 1, 5);
		if (succeeded && scheduled_check)
			client_event_scheduled_checks++;
		if (state.is_connected && poll_id === client_event_poll_id && polling.is_foreground(document)) {
			const delay = succeeded
				? polling.event_poll_delay(client_events_have_pending, client_event_scheduled_checks)
				: polling.retry_poll_delay(client_event_poll_failures);
			setTimeout(() => poll_client_events(poll_id, true), delay);
		}
	}
}

function handle_runtime_visibility_change() {
	if (!polling.is_foreground(document)) {
		combat_arena?.close();
		client_event_poll_id++;
		stop_chat_polling();
		stop_gp_sampling();
		stop_status_observer();
		clearTimeout(status_sync_timer);
		status_sync_timer = null;
		return;
	}
	if (combat_page_visible) void combat_inventory?.refresh();
	start_client_event_polling();
	start_gp_sampling();
	start_status_observer();
	schedule_status_sync(0);
	start_chat_polling(true);
}
// #region

// #region SETUP FUNCTIONS
export async function setup(ctx) {
	const setup_started = performance.now();
	const loaded_save_module = await ctx.loadModule('loaded-save.mjs');
	loaded_save_tracker = loaded_save_module.create_loaded_save_tracker({ uuid: () => crypto.randomUUID(), now: () => Date.now() });
	loaded_save_module.install_loaded_save_capture(ctx, typeof Game === 'undefined' ? null : Game, loaded_save_tracker);
	const { create_offline_work_gate } = await ctx.loadModule('offline-work-gate.mjs');
	offline_work_gate = create_offline_work_gate({
		is_loading: () => typeof loadingOfflineProgress !== 'undefined' && loadingOfflineProgress,
		reconcile: async () => {
			if (!state.is_connected || !polling.is_foreground(document) || state.expedition_loading ||
				state.expedition_action_pending || status_sync_in_flight) return false;
			const saved_report = get_instance_storage_item(EXPEDITION_PENDING_KEY);
			const generation = session_generation;
			let hydrated = await refresh_expedition_state(true);
			if (generation !== session_generation || !state.is_connected || offline_work_gate.blocked()) return false;
			// Replay saved reports byte-for-byte before capturing the completed offline counters.
			if (hydrated && saved_report && !state.expedition_pending_report) hydrated = await refresh_expedition_state(true);
			return hydrated && generation === session_generation && !state.expedition_pending_report && !offline_work_gate.blocked();
		},
		on_resumed: () => { schedule_status_sync(0); },
		on_error: e => log('offline work reconciliation deferred (%s)', e)
	});
	const { create_asset_url_resolver } = await ctx.loadModule('asset-urls.mjs');
	get_mod_asset_url = create_asset_url_resolver(await ctx.loadData('asset-urls.json'), media => ctx.getResourceUrl(media));
	const { ModalQueueGuard, ModalComponentRegistry } = await ctx.loadModule('modal-queue.mjs');
	listing_filter_prompt_module = await ctx.loadModule('listing-filter-prompt.mjs');
	changelog_loader = await ctx.loadModule('changelog.mjs');
	updates_loader = await ctx.loadModule('updates.mjs');
	const combat_module = await ctx.loadModule('combat-arena.mjs');
	const tutorial_module = await ctx.loadModule('combat-tutorial.mjs');
	const practice_module = await ctx.loadModule('combat-practice.mjs');
	const combat_localized = (id, fallback) => { const value = getLangString(id); return !value || value === id ? fallback : value; };
	const combat_localized_text = (id, fallback, values = {}) => combat_localized(id, fallback).replace(/\{([a-z_]+)\}/gi, (_, key) => String(values[key] ?? `{${key}}`));
	const combat_inventory_module = await ctx.loadModule('combat-inventory.mjs');
	const equipment_module = await ctx.loadModule('equipment-projects.mjs');
	status_activities = await ctx.loadModule('status-activities.mjs');
	equipment_evidence = equipment_module.create_equipment_evidence({
		action_id: status_activities.native_work_action_id,
		is_skill_active: status_activities.is_skill_active,
		read: () => get_instance_storage_item('equipment_action_evidence'),
		write: value => set_instance_storage_item('equipment_action_evidence', value),
		scope: () => server_instance_storage_prefix,
		on_error: () => expedition_notify(getLangString('MOD_MP_EXPEDITION_WORK_STORAGE_FAILED'), 'danger')
	});
	state.equipment_tasks = () => expedition_tasks.equipment_tasks(state.expedition_state ?? state.expedition_personal);
	state.equipment_model = () => state.combat?.equipment_projects ?? (state.expedition_state ?? state.expedition_personal)?.equipment_projects;
	state.equipment_tracking = () => (state.expedition_state ?? state.expedition_personal)?.tracking;
	state.equipment_discovered = id => { const item = game.items.getObjectByID(id); return !!item && game.stats.itemFindCount(item) > 0; };
	state.equipment_slot = slot => state.equipment_model()?.slots?.find(entry => entry.slot === slot) ?? null;
	state.equipment_access = slot => state.equipment_model()?.access?.find(entry => entry.slot === slot) ?? null;
	state.equipment_tier_name = (tier, slot = null) => equipment_module.is_food_slot(slot) ? state.get_item_name(state.equipment_model()?.catalog?.find(item => item.slot === 'Food' && item.tier === tier)?.item_id ?? '') : getLangString(['MOD_MP_EQUIPMENT_TIER_BRONZE', 'MOD_MP_EQUIPMENT_TIER_IRON', 'MOD_MP_EQUIPMENT_TIER_STEEL', 'MOD_MP_EQUIPMENT_TIER_MITHRIL', 'MOD_MP_EQUIPMENT_TIER_ADAMANT', 'MOD_MP_EQUIPMENT_TIER_RUNE'][tier - 1] ?? 'MOD_MP_EQUIPMENT_TIER_UNKNOWN');
	state.equipment_slot_name = slot => {
		if (equipment_module.is_food_slot(slot)) return `${state.combat_name('food')} ${slot === 'Food' ? 1 : 2}`;
		const native = get_registered_game_objects(game.equipmentSlots).find(entry => entry.id === slot || entry.localID === slot || entry.id?.endsWith(':' + slot));
		return native?.name ?? native?.localID ?? String(slot);
	};
	state.equipment_stage_name = index => state.equipment_project_stage_name(
		state.equipment_model()?.catalog?.find(item => item.item_id === state.equipment_model()?.project?.item_id) ?? {}, index);
	state.equipment_project_stage_name = (item, index) => {
		if (item.slot === 'Food') return state.combat_name(index === 0 ? 'fishing' : 'cooking');
		if (item.item_id?.endsWith('_Arrows')) return getLangString('MOD_MP_EQUIPMENT_ARROW_STAGE_' + index);
		return getLangString(['MOD_MP_EQUIPMENT_GATHER', 'MOD_MP_EQUIPMENT_SMELT', 'MOD_MP_EQUIPMENT_CRAFT'][index] ?? 'MOD_MP_EQUIPMENT_STAGE');
	};
	state.equipment_project_started = id => state.equipment_model()?.project?.item_id === id;
	state.equipment_project_completed = id => state.equipment_model()?.unlocked?.includes(id) === true;
	state.equipment_item_slot = item => item.slot === 'Food' && equipment_module.is_food_slot(state.equipment_modal_slot) ? state.equipment_modal_slot : item.slot;
	state.equipment_item_unlocked = item => item.slot === 'Food' && !equipment_module.is_food_slot(state.equipment_modal_slot) ? ['Food', 'Food2'].some(slot => (state.equipment_slot(slot)?.tier ?? 0) >= item.tier) : (state.equipment_slot(state.equipment_item_slot(item))?.tier ?? 0) >= item.tier;
	state.equipment_project_categories = () => {
		const model = state.equipment_model();
		const visible = (model?.catalog ?? []).filter(item => item.tier > 0 && equipment_module.equipment_project_visible(model, item));
		return [
			{ id: 'weapons', name: getLangString('MOD_MP_EQUIPMENT_WEAPONS'), items: visible.filter(item => item.slot === 'Weapon') },
			{ id: 'armor', name: getLangString('MOD_MP_EQUIPMENT_ARMOR'), items: visible.filter(item => item.slot !== 'Weapon' && item.slot !== 'Quiver' && item.slot !== 'Food') },
			{ id: 'arrows', name: getLangString('MOD_MP_EQUIPMENT_ARROWS'), items: visible.filter(item => item.slot === 'Quiver') },
			{ id: 'food', name: state.combat_name('food'), items: visible.filter(item => item.slot === 'Food') }
		].filter(category => category.items.length);
	};
	state.equipment_project_can_start = item => state.combat_tutorial_access('project', item.item_id) && state.equipment_can_mutate() && !state.equipment_model()?.project &&
		!state.equipment_project_completed(item.item_id) && state.equipment_discovered(item.item_id) &&
		equipment_module.equipment_project_visible(state.equipment_model(), item);
	state.equipment_project_title = item => `${state.equipment_project_name(item)} · ${getLangString(
		!state.combat_tutorial_access('project', item.item_id) ? 'MOD_MP_EQUIPMENT_SLOT_LOCKED' :
		state.equipment_project_completed(item.item_id) ? 'MOD_MP_EQUIPMENT_UNLOCKED' :
		state.equipment_project_started(item.item_id) ? 'MOD_MP_EQUIPMENT_IN_PROGRESS' :
		state.equipment_discovered(item.item_id) ? 'MOD_MP_EQUIPMENT_BEGIN' : 'MOD_MP_EQUIPMENT_DISCOVER_FIRST')}`;
	state.equipment_grid = (group = state.combat.equipment_set ?? 'melee') => {
		const model = state.equipment_model();
		const native_slots = get_registered_game_objects(game.equipmentSlots);
		const access_slots = (model?.access ?? []).filter(access => !equipment_module.is_food_slot(access.slot) && (group === 'all' || group === 'ranged' || (group === 'melee' && access.slot !== 'Quiver')));
		const positions = native_slots.filter(slot => access_slots.some(access => slot.localID === access.slot || slot.id?.endsWith(':' + access.slot))).map(slot => slot.gridPosition).filter(Boolean);
		const min_col = Math.min(...positions.map(position => position.col), 1);
		const rows = [...new Set(positions.map(position => position.row))].sort((a, b) => a - b);
		const fallback = { Helmet: [2, 1], Platebody: [2, 2], Platelegs: [2, 3], Boots: [2, 4], Weapon: [1, 2], Shield: [3, 2], Gloves: [1, 3], Quiver: [1, 1] };
		return access_slots.map(access => {
			const owned = state.equipment_slot(access.slot);
			const native = native_slots.find(slot => slot.localID === access.slot || slot.id?.endsWith(':' + access.slot));
			const purchase = equipment_module.equipment_slot_purchase(model, access.slot, state.combat.ep_micros);
			const available = (group !== 'ranged' || access.slot === 'Quiver') && state.combat_tutorial_access('slot', access.slot);
			const item_id = available ? owned?.equipped_item ?? null : null;
			const weapon_id = state.equipment_slot('Weapon')?.equipped_item;
			const blocked = access.slot === 'Shield' && (model?.catalog ?? []).some(item => item.item_id === weapon_id && item.occupies?.includes('Shield'));
			let action = '';
			if (!available) action = state.combat_name('unavailable');
			else if (purchase && !state.combat_tutorial_access('purchase', access.slot)) action = state.combat_name('unavailable');
			else if (purchase && !purchase.eligible) action = getLangString('MOD_MP_EQUIPMENT_EQUIP_CURRENT');
			else if (purchase) action = `${getLangString(purchase.action === 'unlock-slot' ? 'MOD_MP_EQUIPMENT_UNLOCK_SLOT' : 'MOD_MP_EQUIPMENT_UNLOCK_TIER')} ${purchase.tier ? state.equipment_tier_name(purchase.tier) : ''} · ${state.format_ep(purchase.cost_micros)} EP`;
			return { slot: access.slot, col: native?.gridPosition ? native.gridPosition.col - min_col + 1 : fallback[access.slot]?.[0] ?? 1,
				row: native?.gridPosition ? rows.indexOf(native.gridPosition.row) + 1 : fallback[access.slot]?.[1] ?? 1,
				item_id, blocked, available, tier: available ? owned?.tier ?? -1 : -1, media: item_id ? state.get_item_icon(item_id) : native?.emptyMedia ?? '', locked: !owned || !available,
				upgrade: state.combat_tutorial_access('purchase', access.slot) && !!purchase?.affordable && purchase.eligible && available, can_purchase: state.combat_tutorial_access('purchase', access.slot) && !!purchase?.affordable && purchase.eligible && available && state.equipment_can_mutate(),
				title: [state.equipment_slot_name(access.slot), owned?.tier > 0 && available ? state.equipment_tier_name(owned.tier) : '', item_id ? state.get_item_name(item_id) : '', action].filter(Boolean).join(' · ') };
		});
	};
	state.consumable_grid = () => ['Food', 'Food2', 'Potion1', 'Potion2'].map((slot, index) => {
		const available = slot === 'Food' && state.combat_tutorial_access('slot', slot);
		const owned = available ? state.equipment_slot(slot) : null;
		const purchase = available ? equipment_module.equipment_slot_purchase(state.equipment_model(), slot, state.combat.ep_micros) : null;
		const can_purchase = state.combat_tutorial_access('purchase', slot) && available && !!purchase?.affordable && purchase.eligible && state.equipment_can_mutate();
		const item_id = owned?.equipped_item ?? null;
		return { slot, available, item_id, tier: owned?.tier ?? -1, col: index % 2 + 1, row: Math.floor(index / 2) + 1,
			locked: !owned, upgrade: !!purchase && !!owned && can_purchase, can_purchase,
			title: available ? [state.equipment_slot_name(slot), owned ? `${getLangString('MOD_MP_EQUIPMENT_CURRENT_TIER')}: ${owned.tier}` : getLangString('MOD_MP_EQUIPMENT_SLOT_LOCKED'), item_id ? state.get_item_name(item_id) : ''].filter(Boolean).join(' · ') : `${equipment_module.is_food_slot(slot) ? state.equipment_slot_name(slot) : state.combat_name('potion') + ' ' + (index - 1)} · ${state.combat_name('unavailable')}` };
	});
	state.consumable_unlocked_items = () => (state.equipment_model()?.catalog ?? []).filter(item => item.slot === 'Food' && state.equipment_project_completed(item.item_id));
	state.consumable_is_equipped = item => state.equipment_slot('Food')?.equipped_item === item.item_id;
	state.consumable_select_item = item => {
		state.equipment_select('combat', 'slot', 'Food');
		state.equipment_modal_choose(item);
	};
	state.equipment_selected = { combat: null, project: null };
	state.equipment_modal_kind = 'combat';
	state.equipment_modal_tiers = false;
	state.equipment_modal_slot = null;
	state.equipment_select = (kind, type, id, tiers = false) => {
		if (type === 'project' && !state.combat_tutorial_access('project', id)) return;
		if (type === 'slot' && (id === 'Food2' || !state.combat_tutorial_access('slot', id))) return;
		state.equipment_modal_tiers = tiers;
		state.equipment_selected[kind] = { type, id, scope: `${server_host}:${session_generation}` };
		state.equipment_modal_scope = `${server_host}:${session_generation}`;
		state.equipment_modal_kind = kind;
		state.equipment_modal_slot = type === 'slot' ? id : null;
		queue_modal(type === 'slot' ? state.equipment_slot_name(id) : getLangString('MOD_MP_COMBAT_EQUIPMENT'), 'equipment-modal', '', {
			imageUrl: undefined, showConfirmButton: false, showCloseButton: true, width: '440px',
			showClass: { popup: '' }, hideClass: { popup: '' },
			customClass: { popup: 'mp-equipment-modal-popup' }
		}, false, false);
	};
	state.equipment_modal_open_tiers = async () => {
		const slot = state.equipment_modal_slot;
		const scope = state.equipment_modal_scope;
		await close_modal_and_wait('equipment-modal');
		if (scope !== `${server_host}:${session_generation}`) return;
		state.equipment_select('combat', 'slot', slot, true);
	};
	state.equipment_modal_unlocked_tiers = () => (state.equipment_access(state.equipment_modal_slot)?.tiers ?? []).filter(tier => tier.tier <= (state.equipment_slot(state.equipment_modal_slot)?.tier ?? 0));
	state.equipment_modal_next_tiers = () => (state.equipment_access(state.equipment_modal_slot)?.tiers ?? []).filter(tier => tier.tier === (state.equipment_slot(state.equipment_modal_slot)?.tier ?? (equipment_module.is_food_slot(state.equipment_modal_slot) ? 0 : -1)) + 1);
	state.equipment_modal_needs_item = () => (state.equipment_slot(state.equipment_modal_slot)?.tier ?? 0) > 0 && state.equipment_slot(state.equipment_modal_slot)?.upgrade_ready !== true;
	state.equipment_modal_items = () => state.equipment_modal_scope !== `${server_host}:${session_generation}` ? [] : equipment_module.equipment_slot_items(state.equipment_model(), state.equipment_modal_slot);
	state.equipment_modal_choose = item => {
		if (state.equipment_modal_scope !== `${server_host}:${session_generation}`) return;
		state.equipment_selected.combat = { type: 'item', id: item.item_id, scope: `${server_host}:${session_generation}` };
	};
	state.equipment_modal_upgrade = async () => {
		if (!state.equipment_modal_slot || state.equipment_modal_scope !== `${server_host}:${session_generation}`) return;
		await state.equipment_confirm('combat', state.equipment_modal_slot);
	};
	state.equipment_modal_current_tier = () => {
		const slot = state.equipment_slot(state.equipment_modal_slot);
		return !slot ? getLangString('MOD_MP_EQUIPMENT_SLOT_LOCKED') : slot.tier ? state.equipment_tier_name(slot.tier, state.equipment_modal_slot) : getLangString('MOD_MP_EQUIPMENT_NO_MATERIAL');
	};
	state.equipment_item_stats = item => equipment_module.equipment_stat_groups(item, key => getLangString('MOD_MP_EQUIPMENT_STAT_' + key));
	state.equipment_item_requirements = item => (item.requirements ?? []).map(requirement => {
		const skill = game.skills?.getObjectByID?.(requirement.skillID);
		const skill_id = requirement.skillID?.split(':').at(-1)?.toLowerCase();
		return { name: skill?.name ?? requirement.skillID?.split(':').at(-1) ?? '', media: skill?.media ?? '', level: requirement.level,
			met: requirement.type === 'SkillLevel' && (state.combat.character?.levels?.[skill_id] ?? 0) >= requirement.level };
	});
	state.equipment_slot_action = slot_id => {
		const tile = (equipment_module.is_food_slot(slot_id) ? state.consumable_grid() : state.equipment_grid()).find(tile => tile.slot === slot_id);
		if (!tile) return [];
		const purchase = equipment_module.equipment_slot_purchase(state.equipment_model(), slot_id, state.combat.ep_micros);
		return [{ title: purchase && !purchase.eligible ? getLangString('MOD_MP_EQUIPMENT_EQUIP_CURRENT') : purchase && !purchase.affordable ? state.combat_name('insufficient_ep') : state.equipment_slot_name(slot_id), cost: purchase?.cost_micros ?? null,
			label: purchase ? (purchase.action === 'unlock-slot' ? getLangString('MOD_MP_EQUIPMENT_UNLOCK_SLOT') : getLangString('MOD_MP_EQUIPMENT_UNLOCK_TIER') + ' · ' + state.equipment_tier_name(purchase.tier, slot_id)) : '',
			can_confirm: state.combat_tutorial_access('purchase', slot_id) && !!purchase?.affordable && purchase.eligible && tile.available !== false && state.equipment_can_mutate(), action: purchase?.action, slot: slot_id }];
	};
	state.equipment_modal_slot_actions = () => state.equipment_modal_slot && state.equipment_modal_scope === `${server_host}:${session_generation}` ? state.equipment_slot_action(state.equipment_modal_slot) : [];
	state.equipment_selection = kind => {
		const selected = state.equipment_selected[kind];
		if (!selected || selected.scope !== `${server_host}:${session_generation}`) return [];
		const model = state.equipment_model();
		if (selected.type === 'slot') return state.equipment_slot_action(selected.id);
		const item = model?.catalog?.find(item => item.item_id === selected.id);
		if (!item) return [];
		if (selected.type === 'project') return [{ title: state.equipment_project_title(item), cost: 0,
			label: getLangString('MOD_MP_EQUIPMENT_BEGIN'), can_confirm: state.equipment_project_can_start(item), action: 'start-project', item }];
		return [{ title: [state.equipment_project_name(item), state.equipment_requirement_text(item)].filter(Boolean).join(' · '), cost: 0,
			label: item.unlock_only ? getLangString('MOD_MP_EQUIPMENT_ARROWS_DEFERRED') : getLangString(state.equipment_is_equipped(item) ? 'MOD_MP_EQUIPMENT_UNEQUIP' : 'MOD_MP_EQUIPMENT_EQUIP'),
			can_confirm: state.equipment_can_mutate() && !item.unlock_only && (state.equipment_is_equipped(item) || state.equipment_meets_requirements(item)), action: 'equip', item }];
	};
	state.equipment_confirm = async (kind, slot_id = null) => {
		const selection = state.equipment_selected[kind];
		if (selection?.scope !== `${server_host}:${session_generation}`) return;
		const resolve = () => slot_id ? state.equipment_slot_action(slot_id)[0] : state.equipment_selection(kind)[0];
		const action = resolve();
		if (!action?.can_confirm) return;
		await close_modal_and_wait('equipment-modal');
		const current = resolve();
		if (selection.scope !== `${server_host}:${session_generation}` || state.equipment_selected[kind] !== selection || !current?.can_confirm || current.cost !== action.cost || current.label !== action.label) return;
		const success = action.action === 'start-project' ? await state.equipment_start(action.item.item_id) :
			action.action === 'equip' ? await state.equipment_toggle(action.item) : await state.equipment_purchase(action.action, action.slot);
		if (success && state.equipment_selected[kind] === selection) state.equipment_selected[kind] = null;
	};
	state.equipment_unlocked_items = () => (state.equipment_model()?.catalog ?? []).filter(item => item.slot !== 'Food' && state.equipment_project_completed(item.item_id) && (state.combat.equipment_set === 'ranged' ? item.slot === 'Quiver' : item.slot !== 'Quiver'));
	state.equipment_is_equipped = item => state.equipment_slot(state.equipment_item_slot(item))?.equipped_item === item.item_id;
	state.equipment_meets_requirements = item => !item.unlock_only && (state.equipment_slot(state.equipment_item_slot(item))?.tier ?? -1) >= item.tier && (item.requirements ?? []).every(requirement => {
		if (requirement.type !== 'SkillLevel' || !Number.isSafeInteger(requirement.level)) return false;
		const skill_id = requirement.skillID?.split(':').at(-1)?.toLowerCase();
		return !!skill_id && (state.combat.character?.levels?.[skill_id] ?? 0) >= requirement.level;
	});
	state.equipment_requirement_text = item => [
		...((state.equipment_slot(state.equipment_item_slot(item))?.tier ?? -1) < item.tier ? [getLangString('MOD_MP_EQUIPMENT_ACCESS_REQUIRED')] : []),
		...(item.requirements ?? []).map(requirement => {
		const skill = game.skills?.getObjectByID?.(requirement.skillID);
		return `${skill?.name ?? requirement.skillID?.split(':').at(-1) ?? ''} ${requirement.level}`;
		})
	].join(', ');
	state.equipment_toggle = async item => {
		if (!await combat_inventory.equipment('equip', { slot: state.equipment_item_slot(item), item_id: state.equipment_is_equipped(item) ? null : item.item_id })) return false;
		await refresh_expedition_state();
		return true;
	};
	state.equipment_cancel_ready = () => state.equipment_can_mutate() && !state.expedition_pending_report && !!state.equipment_model()?.project;
	state.equipment_cancel_preview = () => {
		if (!state.equipment_cancel_ready()) return;
		state.equipment_cancel_selection = { id: state.equipment_model().project.id, scope: `${server_host}:${session_generation}` };
		queue_modal('MOD_MP_EQUIPMENT_CANCEL_PROJECT', 'equipment-cancel-modal', '', { showConfirmButton: false, width: '440px', customClass: { popup: 'mp-equipment-modal-popup' } }, true, false);
	};
	state.equipment_cancel_confirm = async () => {
		const selected = state.equipment_cancel_selection;
		const ready = () => selected?.scope === `${server_host}:${session_generation}` && selected.id === state.equipment_model()?.project?.id && state.equipment_cancel_ready();
		if (!ready()) return;
		await close_modal_and_wait('equipment-cancel-modal');
		if (!ready()) return;
		if (await combat_inventory.equipment('cancel-project', { project_id: selected.id })) await refresh_expedition_state();
	};
	state.equipment_start = async id => {
		if (!await combat_inventory.equipment('start-project', { item_id: id, discovered: state.equipment_discovered(id) })) return false;
		await refresh_expedition_state();
		return true;
	};
	state.equipment_set_available = type => tutorial_module.equipment_set_available(state.combat, type, state.chat_is_admin);
	state.equipment_set_select = type => {
		if (!state.equipment_set_available(type)) return;
		state.combat.equipment_set = type;
		state.equipment_selected.combat = null;
	};
	state.combat_slot_reset_quote = group => state.equipment_model()?.resets?.[group];
	state.reset_combat_equipment = async (group = 'equipment') => {
		if (!state.combat[group + '_reset_confirm'] || !state.equipment_can_mutate()) return false;
		if (!await combat_inventory.reset_equipment(group)) return false;
		state.equipment_selected.combat = null;
		await refresh_expedition_state();
		return true;
	};
	state.equipment_purchase = async (action, slot) => {
		if (!await combat_inventory.equipment(action, { slot })) return false;
		await refresh_expedition_state();
		return true;
	};
	state.equipment_equip = (slot, id) => combat_inventory.equipment('equip', { slot, item_id: id });
	state.open_equipment_projects = () => { state.expedition_work_tab = 'equipment'; navigate_page(game.pages.getObjectByID('multiplayer:Expedition')); };
	state.equipment_refresh = async () => { await combat_inventory.refresh(); await refresh_expedition_state(); };
	state.equipment_debug_selection = null;
	state.equipment_debug_preview = task => {
		if (!state.combat.debug_enabled || !state.equipment_debug_ready()) return;
		const project = state.equipment_model()?.project;
		state.equipment_debug_selection = { scope: `${server_host}:${session_generation}`, project_id: project.id, revision: state.combat.character.revision,
			task_id: task?.task_id ?? null, name: task ? state.equipment_task_name(task) : state.equipment_project_name(project) };
	};
	state.equipment_debug_ready = () => state.combat.debug_enabled && !!state.equipment_model()?.project &&
		state.equipment_can_mutate() && !state.expedition_pending_report && !state.equipment_tracking();
	state.equipment_debug_confirm = async () => {
		const preview = state.equipment_debug_selection;
		if (!preview || preview.scope !== `${server_host}:${session_generation}` ||
			preview.project_id !== state.equipment_model()?.project?.id || !state.equipment_debug_ready()) return false;
		state.equipment_debug_selection = null;
		if (!await combat_inventory.debug_equipment(preview)) return false;
		await refresh_expedition_state();
		return true;
	};
	state.equipment_task_name = task => task?.action_id === 'multiplayer:Any_Woodcutting' ? getLangString('MOD_MP_EQUIPMENT_ANY_WOODCUTTING') : task?.action_id ? (game.fletching?.actions?.getObjectByID?.(task.action_id)?.name ?? state.get_item_name(task.action_id)) : '';
	state.equipment_project_name = project => project ? state.get_item_name(project.item_id) : '';
	state.equipment_duration = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
	state.equipment_matches = task => capture_status_activities().some(activity => expedition_tasks.equipment_activity_matches(task, activity));
	state.equipment_can_mutate = () => state.is_connected && !state.expedition_loading && !state.expedition_action_pending && !state.combat.inventory_busy && state.combat.arena?.status !== 'active';
	state.equipment_action = kind => submit_expedition_work(kind);

	state.combat = combat_module.create_combat_view();
	state.combat_dungeons_visited = false;
	const combat_animation = combat_module.create_combat_animator({ get_root: () => document.getElementById('mp-combat-page') });
	let combat_start_caps = null, combat_start_unlocks = null;
	combat_arena = combat_module.create_combat_controller({
		view: state.combat,
		on_result: async arena => {
			const scope = `${server_host}:${session_generation}`, before = combat_start_caps, before_unlocks = combat_start_unlocks;
			const settled = await combat_inventory.settle(arena);
			if (scope !== `${server_host}:${session_generation}` || state.combat.arena?.id !== arena.id) return;
			state.combat.result = combat_module.combat_result_details(arena, before, settled ? state.combat.unlocks?.skill_caps : null);
			state.combat.result.materials = combat_module.combat_material_gains(before_unlocks, settled ? state.combat.unlocks : null);
			queue_modal(getLangString(`MOD_MP_COMBAT_${arena.status === 'fled' ? 'FORFEIT' : arena.status.toUpperCase()}`).toUpperCase(), 'combat-result-modal', 'assets/colosseum.png', {
				showConfirmButton: false, showCloseButton: true, allowOutsideClick: true, allowEscapeKey: false,
				customClass: { popup: 'mp-combat-result-popup' }
			}, false);
		},
		on_start: () => {
			// Copy scalar cap maps explicitly: Petite Vue proxies cannot be structured-cloned.
			combat_start_unlocks = state.combat.unlocks ? { material_caps: { ...state.combat.unlocks.material_caps } } : null;
			combat_start_caps = state.combat.unlocks?.skill_caps ? { ...state.combat.unlocks.skill_caps } : null;
			if (combat_page_visible) requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }));
		},
		on_state: arena => {
			combat_animation.update(combat_page_visible ? arena : null);
			update_combat_nav();
			void combat_inventory?.settle(arena);
		},
		get_scope: () => `${server_host}:${session_generation}`,
		get_origin: () => server_host,
		can_connect: () => state.is_connected && document.visibilityState !== 'hidden',
		ticket: () => api_post('/api/combat/ticket', {})
	});
	combat_inventory = combat_inventory_module.create_combat_inventory({ view: state.combat, access: tutorial_module.tutorial_access,
		practice_sync: practice_module.practice_sync,
		scope: () => `${server_host}:${session_generation}`, can_mutate: () => economy_commands_ready && !economy_command_journal?.has_pending(),
		request: (path,payload) => payload ? api_post(path,payload) : api_get(path), reconcile: reconcile_economy_receipts
	});
	state.refresh_combat_inventory = () => combat_inventory.refresh();
	state.prepare_combat = () => combat_inventory.prepare();
	state.combat_skill_available = skill => (!state.combat.tutorial || state.combat.tutorial.complete) && combat_inventory_module.available_combat_skills.includes(skill);
	state.combat_level_quote = skill => combat_inventory_module.combat_level_quote(state.combat.character, skill, state.combat.level_quantities[skill]);
	state.set_combat_level_quantity = (skill, quantity) => { state.combat.level_quantities[skill] = combat_inventory_module.combat_level_quote(state.combat.character, skill, quantity).count; };
	state.combat_skill_icon = skill => game.skills.getObjectByID(`melvorD:${skill[0].toUpperCase()}${skill.slice(1)}`)?.media ?? assets.getURI('assets/media/main/question.png');
	state.combat_levels_quote = () => combat_inventory_module.combat_levels_quote(state.combat.character, state.combat.level_quantities);
	state.purchase_combat_level = skill => combat_inventory.level(skill);
	state.reset_combat_levels = () => combat_inventory.reset_levels();
	state.combat_style_name = id => game.attackStyles.getObjectByID('melvorD:' + ({ accurate: 'Stab', aggressive: 'Slash', defensive: 'Block' }[id] ?? 'Stab'))?.name ?? state.combat_name(id);

	state.start_combat = async () => {
		if (!['test_combat', 'raid'].includes(state.combat.page_tab) || state.combat.recovery || state.combat.maintenance?.drain_at != null || state.combat.starting || state.combat.pending || state.combat.inventory_busy || !state.combat.character || !state.is_connected || state.combat.arena?.status === 'active') return;
		if (state.combat.page_tab === 'test_combat' && !state.combat_choices().some(choice => choice.id === state.combat.encounter)) return;
		if (state.combat.page_tab === 'test_combat' && state.combat.tutorial?.complete && !state.combat_practice_tier()?.available) return;
		const scope = `${server_host}:${session_generation}`;
		state.combat.starting = true;
		try {
			// Refresh the server-owned food selection and access before admission.
			if (await combat_inventory.refresh({ fresh: true }) && scope === `${server_host}:${session_generation}` && ['test_combat', 'raid'].includes(state.combat.page_tab) &&
				(state.combat.page_tab === 'raid' || state.combat_choices().some(choice => choice.id === state.combat.encounter))) await combat_arena.connect(true);
		} finally {
			if (scope === `${server_host}:${session_generation}` && state.combat.status !== 'connecting' && !state.combat.pending) state.combat.starting = false;
		}
	};
	state.combat_recover = action => combat_arena.recover(action);
	state.combat_recovery_copy = (key, amount = '') => getLangString('MOD_MP_COMBAT_RECOVERY_' + key.toUpperCase()).replace('%s', String(amount));
	state.combat_restart_minutes = () => Math.max(0,Math.ceil(((state.combat.maintenance?.drain_at ?? Date.now())-Date.now())/60000));
	state.combat_action = (action, target) => combat_arena.act(action, target);
	window.addEventListener('keydown', combat_module.create_combat_keydown({
		enabled: () => combat_settings_section?.get('combat-keybinds') !== false,
		active: () => combat_page_visible && document.visibilityState !== 'hidden' &&
			state.combat.arena?.status === 'active' && state.combat.page_tab === state.combat.combat_tab &&
			!document.body.classList.contains('swal2-shown') && !document.querySelector('.modal.show') &&
			!!document.querySelector('#mp-combat-page .mp-combat-arena')?.getClientRects().length,
		get_slot: slot => document.querySelector(`#mp-combat-page [data-combat-slot="${slot}"]`)
	}), true);

	state.combat_cycle_opponents_view = () => combat_arena.cycle_opponents_view();
	state.combat_opponents_compact = () => combat_module.combat_opponents_compact(state.combat);
	state.combat_run_icon = () => assets.getURI('assets/media/skills/combat/run.png');
	state.combat_inventory_error = () => state.combat.inventory_error === 'cap_locked' ? combat_localized('MOD_MP_COMBAT_PRACTICE_LOCKED', 'Clear Dungeon tiers to unlock the recommended skill caps.') : state.combat.inventory_error === 'tutorial_required' ? combat_localized('MOD_MP_COMBAT_TUTORIAL_REQUIRED', 'Complete training to unlock this action.') : state.combat_name(['food_locked', 'quote_changed', 'max_level', 'insufficient_ep', 'nothing_to_reset', 'active', 'discovery_required', 'project_unavailable', 'requirements_unmet', 'equip_current_tier', 'slot_locked', 'slot_conflict'].includes(state.combat.inventory_error) ? state.combat.inventory_error : 'inventory_rejected');
	state.combat_run_copy = key => key === 'start' || key === 'stop' ? getLangString('MOD_MP_COMBAT_BATTLE_' + key.toUpperCase()) : combat_localized('MOD_MP_COMBAT_RUN_' + String(key).toUpperCase(), combat_module.COMBAT_RUN_COPY[key] ?? key);
	tutorial_module.install_tutorial_review_actions(state, getLangString, state.get_item_name, state.equipment_slot_name);
	state.combat_dungeon_debug_select = target_id => {
		const target = state.combat.dungeon_debug_options?.targets.find(target => target.id === target_id);
		if (!target) return;
		state.combat.dungeon_debug_target = target.id;
		state.combat.dungeon_debug_confirm = false;
		state.combat.dungeon_debug_levels = Object.fromEntries(['attack','strength','defence','hitpoints'].map(skill => [skill,Math.max(target.level,skill === 'hitpoints' ? 3 : 1)]));
		const material = target.material >= 3 ? 'Steel' : 'Iron';
		state.combat.dungeon_debug_gear = target.level >= 5 ? { Weapon:`melvorD:${material}_Sword`,Shield:`melvorD:${material}_Shield`,Helmet:`melvorD:${material}_Helmet` } : {Weapon:'melvorD:Bronze_Sword',Shield:'melvorD:Bronze_Shield',Helmet:'melvorD:Bronze_Helmet'};
		state.combat.dungeon_debug_food = target.food_tier >= 2 ? 'melvorD:Herring' : 'melvorD:Shrimp';
	};
	state.combat_dungeon_debug_ready = () => state.chat_is_admin && !!state.combat.dungeon_debug_options && state.equipment_can_mutate() &&
		!state.combat.pending && !state.combat.starting && !state.equipment_tracking() && !state.expedition_pending_report;
	state.combat_dungeon_debug_apply = async () => {
		if (!state.combat.dungeon_debug_confirm || !state.combat_dungeon_debug_ready()) return false;
		const target = state.combat.dungeon_debug_options.targets.find(target => target.id === state.combat.dungeon_debug_target);
		const payload = { target:target.id, confirm:true, levels:{...state.combat.dungeon_debug_levels},
			gear:Object.fromEntries(Object.entries(state.combat.dungeon_debug_gear).filter(([,id]) => id)), food:state.combat.dungeon_debug_food };
		state.combat.dungeon_debug_confirm = false;
		if (!await combat_inventory.debug_dungeon(payload)) return false;
		combat_arena.close('idle');
		state.combat.level_quantities = {};
		state.combat.raid_selection = target.dungeon;
		state.combat.page_tab = 'raid';
		state.combat.mode = 'raid';
		state.combat.encounter = target.dungeon;
		state.combat.raid_tab = 'details';
		state.equipment_selected.combat = null;
		return true;
	};
	state.combat_tutorial_debug_ready = () => state.chat_is_admin && state.equipment_can_mutate() &&
		!state.combat.pending && !state.combat.starting && !state.equipment_tracking() && !state.expedition_pending_report &&
		state.combat.tutorial_debug_targets.some(target => target.id === state.combat.tutorial_debug_target);
	state.combat_tutorial_debug_apply = async (target = state.combat.tutorial_debug_target) => {
		if (!state.combat.tutorial_debug_confirm || !state.combat_tutorial_debug_ready()) return false;
		state.combat.tutorial_debug_confirm = false;
		if (!await combat_inventory.debug_tutorial({ target })) return false;
		combat_arena.close('idle');
		state.combat.level_quantities = {};
		state.combat.equipment_set = 'melee';
		state.combat.page_tab = 'character';
		state.combat.preparation_tab = state.combat.character ? (state.combat.tutorial?.trial?.slot === 'Food' ? 'consumables' : 'equipment') : 'levels';
		state.equipment_selected.combat = null;
		await refresh_expedition_state();
		return true;
	};
	state.combat_tutorial_skip_ready = () => Number.isSafeInteger(state.combat.tutorial?.skip_ep_micros) &&
		!state.combat.tutorial.complete && !state.combat.inventory_busy && !state.combat.starting &&
		economy_commands_ready && !economy_command_journal?.has_pending();
	state.combat_tutorial_skip_preview = () => {
		if (!state.combat_tutorial_skip_ready()) return;
		state.combat_tutorial_skip_quote = { ep_micros: state.combat.tutorial.skip_ep_micros, scope: session_generation };
		queue_modal('MOD_MP_COMBAT_TUTORIAL_SKIP', 'combat-tutorial-skip-modal', '', { showConfirmButton: false, width: '440px' }, true, false);
	};
	state.combat_tutorial_skip_message = () => getLangString('MOD_MP_COMBAT_TUTORIAL_SKIP_INFO')
		.replace('{ep}', String((state.combat_tutorial_skip_quote?.ep_micros ?? 0) / 1_000_000));
	state.combat_tutorial_skip_confirm = async () => {
		const quote = state.combat_tutorial_skip_quote;
		const ready = () => quote?.scope === session_generation && state.combat_tutorial_skip_ready() &&
			quote.ep_micros === state.combat.tutorial.skip_ep_micros;
		if (!ready()) return;
		await close_modal_and_wait('combat-tutorial-skip-modal');
		if (!ready()) return;
		if (await combat_inventory.skip_tutorial(quote.ep_micros, () => combat_arena.close('idle'))) await refresh_expedition_state();
	};
	state.combat_tutorial_guide = () => {
		const guide = tutorial_module.tutorial_guide(state.combat.tutorial, state.equipment_model(), getLangString, state.get_item_name, state.equipment_slot_name);
		if (guide && !state.combat.character) return { ...guide, action: 'prepare', tab: 'levels', text: getLangString('MOD_MP_COMBAT_TUTORIAL_PREPARE') };
		return guide && state.combat.arena?.status === 'active' ? { ...guide, text: tutorial_module.tutorial_lesson(state.combat.tutorial.victories, getLangString) } : guide;
	};
	state.combat_tutorial_access = (kind, id) => tutorial_module.tutorial_access(state.combat, kind, id);
	state.combat_select_page = tab => {
		if (!state.combat_tutorial_access('page', tab)) return;
		state.combat.page_tab = tab;
		if (tab === 'raid') {
			state.combat_dungeons_visited = true;
			set_instance_storage_item('combat_dungeons_visited', true);
			state.combat.mode = 'raid';
			state.combat.encounter = state.combat.raid_selection;
			combat_inventory.refresh({ fresh: true });
		}
		else if (tab === 'test_combat' && state.combat.mode === 'raid') { state.combat.mode = 'once'; state.combat.encounter = state.combat_choices()[0]?.id ?? ''; practice_module.practice_sync(state.combat); }
	};
	state.combat_select_preparation = tab => { if (state.combat_tutorial_access('tab', tab)) state.combat.preparation_tab = tab; };
	state.combat_tutorial_heading = () => {
		const number = (state.combat.tutorial?.victories ?? 0) + 1;
		const name = tutorial_module.tutorial_name(state.combat.tutorial?.trial?.id, getLangString) ?? state.combat.tutorial?.trial?.name ?? '';
		return combat_localized_text('MOD_MP_COMBAT_TUTORIAL_HEADING', 'Training {number} / 7 · {name}', { number, name });
	};
	state.combat_tutorial_highlight = (kind, id = null) => {
		if (kind === 'battles') return state.combat_tutorial_highlight('page', 'test_combat') || state.combat_tutorial_highlight('page', 'raid');
		if (kind === 'page' && id === 'raid') return state.combat.tutorial?.complete === true && !state.combat_dungeons_visited;
		const guide = state.combat_tutorial_guide();
		if (!guide) return false;
		if (kind === 'page') return state.combat_tutorial_access('page', id) && id === (guide.action === 'battle' ? 'test_combat' : 'character');
		if (kind === 'eat') return state.combat.arena?.status === 'active' && state.combat.tutorial.victories === 4;
		if (kind === 'slot') return guide.trial.slot === id && ['unlock-slot', 'unlock-tier', 'equip'].includes(guide.action);
		if (kind === 'slot-action') return guide.trial.slot === id && ['unlock-slot', 'unlock-tier'].includes(guide.action);
		if (kind === 'item') return id === guide.trial.item && guide.action === 'equip';
		if (kind === 'project') return id === guide.trial.item && ['start-project', 'work'].includes(guide.action);
		if (kind === 'tab') return id === guide.tab && guide.action !== 'battle';
		return kind === guide.action;
	};
	state.combat_choices = () => state.combat.tutorial && !state.combat.tutorial.complete ? [{ id: state.combat.tutorial.trial.id, name: tutorial_module.tutorial_name(state.combat.tutorial.trial.id, getLangString) ?? state.combat.tutorial.trial.name, actors: [state.combat.tutorial.trial.id], description: combat_localized_text('MOD_MP_COMBAT_TUTORIAL_PROGRESS', 'Training · {number} / 7', { number: state.combat.tutorial.victories + 1 }) }] : practice_module.practice_choices(state.combat, getLangString);
	state.combat_practice_choices = () => state.combat.tutorial?.complete === true ? practice_module.practice_choices(state.combat, getLangString) : [];
	state.combat_practice_cleared = entry => entry.tiers.filter(tier => tier.complete).length;
	state.combat_practice_categories = practice_module.PRACTICE_CATEGORIES;
	state.combat_practice_copy = key => practice_module.practice_copy(key, getLangString);
	state.combat_practice_selected = () => practice_module.localize_practice_entry(practice_module.practice_selected(state.combat), getLangString);
	state.combat_practice_material = material => combat_localized(`MOD_MP_EQUIPMENT_TIER_${String(material).toUpperCase()}`, material);
	state.combat_practice_tier_label = tier => `${combat_localized('MOD_MP_COMBAT_PRACTICE_TIER', 'Tier')} ${practice_module.roman(tier.tier)}${!tier.available ? ' · ' + combat_localized('MOD_MP_COMBAT_PRACTICE_LOCKED_SHORT', 'Locked') : tier.complete ? ' · ' + combat_localized('MOD_MP_COMBAT_PRACTICE_CLEARED', 'Cleared') : ''}`;
	state.combat_tutorial_copy = key => combat_localized(`MOD_MP_COMBAT_TUTORIAL_${key}`, key);
	state.combat_tutorial_target_name = target => {
		if (target?.id === 'start') return state.combat_tutorial_copy('REVIEW_TARGET_START');
		if (target?.id === 'complete') return state.combat_tutorial_copy('REVIEW_TARGET_COMPLETE');
		const match = /^(\d+):([a-z-]+)(?::(\d+))?$/.exec(String(target?.id ?? ''));
		if (!match) return target?.title ?? '';
		const phase_keys = { 'unlock-slot':'REVIEW_UNLOCK_SLOT', 'unlock-tier':'REVIEW_UPGRADE', 'start-project':'REVIEW_START_PROJECT', work:'REVIEW_PROJECT_STAGE', equip:'REVIEW_EQUIP', battle:'REVIEW_READY_FOR_BATTLE' };
		const phase_key = phase_keys[match[2]];
		const phase = phase_key ? state.combat_tutorial_copy(phase_key) : target.title.split(' · ').at(-1);
		const labeled_phase = match[2] === 'work' ? combat_localized_text(`MOD_MP_COMBAT_TUTORIAL_${phase_key}`, 'Project stage {stage}', { stage: Number(match[3]) + 1 }) : phase;
		const number = Number(match[1]) + 1;
		const trial_name = tutorial_module.tutorial_name(`tutorial_${number}`, getLangString) ?? '';
		return `${number} · ${trial_name} · ${labeled_phase}`;
	};
	state.combat_practice_tier = () => state.combat_practice_selected()?.tiers?.find(tier => tier.tier === state.combat.practice_tier) ?? null;
	state.combat_practice_select = (kind,value) => practice_module.practice_select(state.combat,kind,value);
	state.combat_practice_effects = () => [...new Map((state.combat_practice_tier()?.waves.flat() ?? []).filter(actor => actor.effect).map(actor => [actor.effect,actor])).values()];
	state.combat_encounter_name = () => practice_module.practice_title(state.combat, state.combat.arena, getLangString) ?? tutorial_module.tutorial_name(state.combat.arena?.encounter, getLangString) ?? combat_module.combat_run_title(state.combat.arena);
	state.combat_respawning = () => state.combat.arena?.status === 'active' && state.combat.arena?.run?.phase === 'respawning';
	state.combat_name = id => practice_module.practice_actor(state.combat,id,getLangString)?.name ?? (/^(saltwing|reefbreaker|undertide_tendril|blob|bittertoad|bogmaw|drowned_root|cinder_snail|kiln_wisp|embercoil|slagheart)_\d+$/.test(id) ? state.combat_name(String(id).replace(/_\d+$/, '')) : null) ?? tutorial_module.tutorial_name(id,getLangString) ?? (/^(golbin|golbin_scout|mind_golbin)_\d+$/.test(id) ? state.combat_name(id.replace(/_\d+$/, '')) : null) ?? (String(id).startsWith('plant_') ? state.combat_name('plant') : getLangString('MOD_MP_COMBAT_' + String(id).toUpperCase()));
	state.combat_cap = skill => state.combat.character?.caps?.[skill] ?? 1;
	state.combat_local_date = timestamp => combat_module.combat_local_date(timestamp, typeof setLang === 'string' ? setLang : 'en');
	state.combat_raid_page = page => combat_inventory.raid_page(page);
	state.combat_load_dungeon_activity = () => combat_inventory.load_dungeon_activity();
	state.combat_raids = () => combat_module.combat_choices('raid').map(dungeon => ({...dungeon, name: state.combat_name(dungeon.id === 'golbins' ? 'horde' : dungeon.id)}));
	state.combat_dungeon_art = id => get_mod_asset_url(`assets/combat-dungeons/${id}.png`);
	state.combat_selected_raid = () => state.combat_raids().find(raid => raid.id === state.combat.raid_selection) ?? state.combat_raids()[0];
	state.combat_select_raid = id => { state.combat.raid_selection = id; state.combat.encounter = id; state.combat.raid_page = 0; state.combat.raid_tab = 'details'; combat_inventory.refresh(); };
	state.combat_dungeon = (id = state.combat.raid_selection) => state.combat.dungeons?.find(dungeon => dungeon.id === id) ?? (id === 'golbins' ? state.combat.raid : null);
	state.combat_raid_tiers = id => combat_module.combat_raid_tiers(state.combat.unlocks, state.combat_dungeon(id)?.endpoint ?? 1, state.combat_dungeon(id), state.equipment_model()?.catalog ?? []);
	state.combat_raid_copy = (key, dungeon = state.combat.raid_selection) => {
		const localized = ({start:'dungeon_start',entry:dungeon === 'quarry' ? 'quarry_entry' : dungeon === 'mire' ? 'mire_entry' : 'dungeon_entry',herring:'dungeon_herring',raids:'tab_raid',description:dungeon === 'quarry' ? 'quarry_description' : dungeon === 'mire' ? 'mire_description' : dungeon === 'tidal' ? 'tidal_description' : 'dungeon_description'})[key];
		return localized ? state.combat_name(localized) : combat_localized('MOD_MP_COMBAT_DUNGEON_' + String(key).toUpperCase(), combat_module.COMBAT_RAID_COPY[key] ?? key);
	};
	state.combat_roman = practice_module.roman;
	state.combat_time = combat_module.combat_time;
	state.combat_duration = ticks => combat_module.combat_duration(ticks, state.combat.arena);
	state.combat_interval = combat_module.combat_time;
	state.combat_attack_icon = type => assets.getURI(({ melee: 'assets/media/skills/combat/attack.png',
		ranged: 'assets/media/skills/ranged/ranged.png', magic: 'assets/media/skills/magic/magic.png' })[type] ?? 'assets/media/skills/combat/attack.png');
	state.combat_eat_remaining = combat_module.combat_eat_remaining;
	state.combat_eat_overlay = combat_module.combat_eat_overlay;
	state.combat_eat_opacity = combat_module.combat_eat_opacity;
	state.combat_tick = combat_module.combat_tick;
	state.combat_effect_space = combat_module.combat_effect_space;
	state.combat_effect_remaining = combat_module.combat_effect_remaining;
	state.combat_effect_info = effect => effect.lifetime === 'persistent'
		? state.combat_name(effect.id === 'slow' ? 'slow_persistent_info' : 'persistent_info')
		: state.combat_name(effect.id + '_info');
	state.combat_effect_label = effect => effect.lifetime === 'persistent' ? state.combat_name('chamber')
		: effect.remaining_attacks === null ? state.combat_duration(state.combat_effect_remaining(effect, state.combat.arena))
		: effect.remaining_attacks + ' ' + state.combat_name('attacks');
	state.combat_material_access = tier => state.combat_name('material_access').replace('{material}',state.equipment_tier_name(tier));
	state.combat_effect_icon = combat_module.combat_effect_icon;
	// Native paths verified in melvorDemo combat-effect templates (including Bleed100).
	const combat_effect_media = Object.fromEntries(Object.entries({ poison: 'status/poison.png', bleed: 'misc/blood.png',
		burn: 'main/burn.png', slow: 'status/slowed.png', freeze: 'status/frozen.png' }).map(([id,path]) => [id, assets.getURI('assets/media/' + path)]));
	state.combat_effect_image = id => combat_effect_media[id] ?? '';
	state.combat_quarry_notice = () => state.combat_name('quarry_slow_notice').replace('{slow}', '<img class="mp-combat-raid-skill-icon" src="' + state.combat_effect_image('slow') + '" alt="">' + state.combat_name('slow')).replace('{material}', '<strong>' + state.equipment_tier_name(2) + '</strong>');
	state.combat_role_effects = id => {
		const actor = state.combat.arena?.enemies?.find(enemy => enemy.id === id);
		if (actor?.on_hit_effects) return actor.on_hit_effects.map(entry => entry.effect);
		const effect = actor?.on_hit_effect;
		return effect ? [effect] : ({ vine: ['poison'], tendril: ['bleed'], root: ['slow'] })[id] ?? [];
	};
	state.combat_food_image = () => state.get_item_icon(state.combat.arena ? state.combat.arena.food_id : state.combat.food_id);
	state.combat_food_name = () => (state.combat.arena ? state.combat.arena.food_id ? state.get_item_name(state.combat.arena.food_id) : state.combat_name('no_food') : state.combat.food_id ? state.get_item_name(state.combat.food_id) : state.combat_name('no_food'));
	state.combat_feedback = actor => combat_module.combat_feedback(state.combat.arena, actor);
	state.combat_feedback_attack_type = event => combat_module.combat_feedback_attack_type(state.combat.arena, event);
	state.combat_effect_ids = combat_module.COMBAT_EFFECTS;
	state.combat_stances = combat_module.COMBAT_STANCES;
	state.combat_actor_image_style = combat_module.combat_actor_image_style;
	state.combat_actor_image = id => {
		const human = practice_module.practice_actor(state.combat,id);
		if (human) return game.thieving?.actions?.getObjectByID?.('melvorF:' + human.portrait)?.media ?? assets.getURI('assets/media/main/question.png');
		const actor = String(id).replace(/_\d+$/, '');
		const monster = ({saltwing:'melvorD:Seagull',reefbreaker:'melvorD:GiantCrab'})[actor];
		if (monster) return game.monsters.getObjectByID(monster)?.media ?? assets.getURI('assets/media/main/question.png');
		const quarry_media = {cinder_snail:'pets/harry.png',kiln_wisp:'monsters/fire_spirit.png',embercoil:'monsters/burning_snake.png',slagheart:'monsters/Lava_Golem.png'}[actor];
		if (quarry_media) return assets.getURI('assets/media/' + quarry_media);
		const mire_media = {blob:'GreenSlime',bittertoad:'poison_toad',bogmaw:'hungry_plant',drowned_root:'Grumpy_Willow'}[actor];
		if (mire_media) return assets.getURI('assets/media/monsters/' + mire_media + '.png');
		if (actor === 'undertide' || actor === 'undertide_tendril') return assets.getURI('assets/media/monsters/' + (actor === 'undertide' ? 'kraken' : 'tentacle') + '.png');
		return tutorial_module.tutorial_portrait(id, game.thieving?.actions) ?? (id === 'player' ? ctx.getResourceUrl('assets/colosseum.png') : String(id).startsWith('plant_') ? (game.monsters.getObjectByID('melvorD:Plant')?.media ?? assets.getURI('assets/media/main/question.png')) :
		 /^(golbin|golbin_scout|mind_golbin)(?:_\d+)?$/.test(id) ? assets.getURI('assets/media/monsters/goblin.png') :
		ctx.getResourceUrl(['vine', 'tendril', 'root'].includes(id) ? `assets/combat-${id}.svg` : 'assets/combat.svg'));
	};
	state.combat_gear = () => Object.entries(state.combat.arena?.registration?.gear ?? state.combat.registration?.gear ?? {});
	state.combat_gear_debuffed = entry => combat_module.combat_gear_debuffed(state.combat.arena, entry);
	state.combat_role = id => ['vine', 'tendril', 'root'].includes(id) ? state.combat_name(id + '_role') : '';
	state.combat_event_name = kind => state.combat_name(kind.startsWith('apply_') ? kind.slice(6) : kind);
	state.combat_percent = fraction => (fraction * 100).toFixed(1);
	state.combat_max_hit_marker = combat_module.combat_max_hit_marker;
	state.combat_opponent_max_hit = enemy => combat_module.combat_opponent_max_hit(state.combat.arena, enemy);
	state.combat_player_thresholds = combat_module.combat_player_thresholds;
	const raid_module = await ctx.loadModule('raid-combat.mjs');
	const transfer_page = await ctx.loadModule('transfer-page.mjs');
	transfer_history_module = await ctx.loadModule('transfer-history.mjs');
	state.transfer_history = transfer_history_module.create_transfer_history_state();
	load_transfer_history = transfer_history_module.create_transfer_history_loader({ state, api_get,
		scope: () => `${server_host}:${state.chat_client_id}:${session_generation}` });
	const market_results = await ctx.loadModule('market-results.mjs');
	const banishment_returns = await ctx.loadModule('banishment-returns.mjs');
	const inbox_module = await ctx.loadModule('inbox-delivery.mjs');
	trade_returns = await ctx.loadModule('trade-returns.mjs');
	transfer_inventory = await ctx.loadModule('transfer-inventory.mjs');
	transfer_currency_support = await ctx.loadModule('transfer-currencies.mjs');
	rollback_module = await ctx.loadModule('save-rollback.mjs');
	economy_receipts = await ctx.loadModule('economy-receipts.mjs');
	economy_receipt_review_module = await ctx.loadModule('economy-receipt-reviews.mjs');
	const pending_actions = await ctx.loadModule('pending-economy-actions.mjs');
	pending_economy_actions = pending_actions.create_pending_economy_actions({
		read: get_instance_storage_item,
		write: set_instance_storage_item,
		remove: remove_instance_storage_item,
		post: api_post,
		reconcile: reconcile_economy_receipts,
		uuid: () => crypto.randomUUID(),
		scope: () => `${server_host}:${state.chat_client_id}:${session_generation}`,
		is_retired: id => rollback_client?.is_retired(id) === true,
		is_reviewed: id => economy_receipt_reviews?.has(id) === true,
		can_recover: pending => rollback_client?.admitted() !== false || rollback_module.protected_rollback_recovery_route(pending.endpoint),
		can_start: () => economy_commands_ready && !economy_command_journal?.has_pending()
	});
	const server_config = await ctx.loadModule('server-config.mjs');
	polling = await ctx.loadModule('polling.mjs');
	service_module = await ctx.loadModule('service-availability.mjs');
	service_availability = service_module.create_service_availability({ probe: probe_multiplayer_service, changed: update_service_notice });
	const requests = await ctx.loadModule('request-coordinator.mjs');
	request_scheduler = requests.create_request_scheduler({ observe: entry => transport_diagnostics?.measure(entry) });
	read_cache = requests.create_read_cache({ scope: () => server_host + ':' + session_generation, observe: entry => transport_diagnostics?.measure(entry) });
	api_contract = await ctx.loadModule('api-contract.mjs');
	const catalog_module = await ctx.loadModule('equipment-catalog.mjs');
	equipment_catalog_cache = catalog_module.create_equipment_catalog_cache(() => server_host + ':' + session_generation);
	economy_command_module = await ctx.loadModule('economy-command-journal.mjs');
	identity_bindings = await ctx.loadModule('identity-bindings.mjs');
	identity_bootstrap = await ctx.loadModule('identity-bootstrap.mjs');
	instance_storage = await ctx.loadModule('instance-storage.mjs');
	social_mode = await ctx.loadModule('social-mode.mjs');
	event_snapshots = await ctx.loadModule('event-snapshots.mjs');
	gift_contents = await ctx.loadModule('gift-contents.mjs');
	item_visibility = await ctx.loadModule('item-visibility.mjs');
	crucible_rules = await ctx.loadModule('crucible-rules.mjs');
	client_runtime = await ctx.loadModule('client-runtime.mjs');
	connection_diagnostics = await ctx.loadModule('connection-diagnostics.mjs');
	let installation_local_storage;
	try { installation_local_storage = globalThis.localStorage; } catch { /* Storage restrictions must not block setup. */ }
	installation_store = connection_diagnostics.create_installation_store(installation_local_storage);
	transport_diagnostics = connection_diagnostics.create_transport_diagnostics();
	const credentials_module = await ctx.loadModule('installation-credentials.mjs');
	installation_credentials = credentials_module.create_installation_credentials(installation_local_storage);
	game_mode_sharing = await ctx.loadModule('game-mode-sharing.mjs');
	localization = await ctx.loadModule('localization.mjs');
	expedition_tasks = await ctx.loadModule('expedition-tasks.mjs');
	expedition_view = await ctx.loadModule('expedition-view.mjs');
	const [journey_module, journey_graph, journey_topology] = await Promise.all([
		ctx.loadModule('expedition-journey.mjs'), ctx.loadModule('expedition-journey-graph.mjs'),
		ctx.loadModule('expedition-journey-topology.mjs')
	]);
	const journey = journey_module.create_journey_runtime({ ...journey_graph, ...journey_topology });
	journey.register_journey_element({ label: value => state.expedition_display_label(value), getLangString });
	expedition_leaderboard = expedition_view.create_leaderboard({ state,
		fetch_page: page => api_get('/api/expedition/leaderboard?page=' + page),
		visible: () => state.is_connected && expedition_page_visible && polling.is_foreground(document),
		generation: () => session_generation });
	state.expedition_leaderboard_page = page => expedition_leaderboard.refresh(page);
	// Independent renderer modules: load together after save capture and core runtime setup.
	const [image_particles, crucible_heat, expedition_crystals, expedition_haze, expedition_observatory,
		expedition_orrery, expedition_voidwatch, expedition_hollow_star, expedition_snow, expedition_branches] = await Promise.all([
		ctx.loadModule('image-particles.mjs'), ctx.loadModule('crucible-heat.mjs'),
		ctx.loadModule('expedition-crystals.mjs'), ctx.loadModule('expedition-haze.mjs'),
		ctx.loadModule('expedition-observatory.mjs'), ctx.loadModule('expedition-orrery.mjs'),
		ctx.loadModule('expedition-voidwatch.mjs'), ctx.loadModule('expedition-hollow-star.mjs'),
		ctx.loadModule('expedition-snow.mjs'), ctx.loadModule('expedition-branches.mjs')
	]);
	state.expedition_snow = { ...expedition_snow.DEFAULT_SNOW_SETTINGS };
	status_statistics = await ctx.loadModule('status-statistics.mjs');
	icon_catalog_discovery = await ctx.loadModule('icon-catalog-discovery.mjs');
	icon_catalog_collection = await ctx.loadModule('icon-catalog-collection.mjs');
	open_transfer_page = transfer_page.open_transfer_page;
	remove_sold_out_market_result = market_results.remove_sold_out_market_result;
	get_market_page_window = market_results.market_page_window;
	sort_market_filter_items = market_results.sort_market_filter_items;
	apply_banishment_claim = banishment_returns.apply_banishment_claim;
	apply_inbox_claim = inbox_module.apply_inbox_claim;
	load_inbox_delivery_state = inbox_module.load_inbox_delivery_state;
	forget_inbox_claim = inbox_module.forget_inbox_claim;
	get_inbox_existing_item_ids = inbox_module.get_inbox_existing_item_ids;
	load_transfer_delivery_state = banishment_returns.load_transfer_delivery_state;
	replace_transfer_delivery_inventory = banishment_returns.replace_transfer_inventory;
	resolve_server_config = server_config.resolve_server_config;
	get_custom_server_validation_error = server_config.get_custom_server_validation_error;
	custom_server_max_length = server_config.CUSTOM_SERVER_MAX_LENGTH;
	const { install_common_actions } = await ctx.loadModule('client-actions-common.mjs');
	const { install_chat_actions } = await ctx.loadModule('client-actions-chat.mjs');
	const { install_browser_link_actions } = await ctx.loadModule('browser-links.mjs');
	const { install_page_guide_actions, setup_page_guide_button } = await ctx.loadModule('page-guides.mjs');
	chat_items = await ctx.loadModule('chat-items.mjs');
	const { install_market_actions } = await ctx.loadModule('client-actions-market.mjs');
	const { install_crucible_actions } = await ctx.loadModule('client-crucible.mjs');
	const { install_trading_actions } = await ctx.loadModule('client-actions-trading.mjs');
	const { install_transfer_actions } = await ctx.loadModule('client-actions-transfer.mjs');
	const { install_social_actions } = await ctx.loadModule('client-actions-social.mjs');
	const { register_components } = await ctx.loadModule('client-components.mjs');
	const action_runtime = create_action_runtime();
	action_runtime.raid_resistance_from_defeats = raid_module.raid_resistance_from_defeats;
	action_runtime.format_raid_attack_description = attack => raid_module.format_raid_attack_description(attack, game);
	action_runtime.chat_items = chat_items;
	action_runtime.chat_highlights = await ctx.loadModule('chat-highlights.mjs');
	Object.assign(
		state,
		{
			reset_expedition_snow: () => { state.expedition_snow = { ...expedition_snow.DEFAULT_SNOW_SETTINGS }; },
			refresh_expedition_state,
			register_expedition,
			retry_expedition_report,
			submit_expedition_work,
			vote_expedition_exit,
			debug_advance_expedition,
			show_expedition_debug_confirmation,
			confirm_expedition_debug_action,
			format_ep,
			expedition_available_points: task => format_ep(expedition_tasks.task_available_points_micros(task)),
			expedition_time_remaining,
			expedition_time_since,
			expedition_hours,
			expedition_contribution_time,
			expedition_percent,
			expedition_work_name,
			expedition_work_icon,
			expedition_can_track,
			expedition_remaining,
			expedition_progress_width,
			expedition_other_player_ms,
			expedition_progress_description,
			expedition_needs_vote: () => expedition_view.needs_passage_vote(state.expedition_state),
			expedition_arrival_complete: chamber => expedition_view.arrival_complete(chamber),
			expedition_phase_tasks: (chamber, phase, stage) =>
				expedition_view.phase_tasks(chamber, phase, stage, state.expedition_state?.tracking),
			expedition_phase_summary: (chamber, phase) => {
				const tasks = expedition_view.phase_tasks(chamber, phase);
				return expedition_text('MOD_MP_EXPEDITION_PHASE_SUMMARY',
					tasks.filter(task => task.completed_at != null).length, tasks.length);
			},
			expedition_text,
			expedition_has_ended: expedition_view.expedition_has_ended,
			expedition_return_story,
			expedition_journey_flavor: () => expedition_view.journey_flavor(state.expedition_state?.expedition, getLangString),
			claim_expedition_bonus,
			expedition_status,
			expedition_display_label: (label, count, chamber_id) =>
				expedition_view.display_expedition_label(label, count, getLangString, chamber_id),
			expedition_tracking_title: (chamber, tracking) => expedition_view.tracking_task_title(chamber, tracking, getLangString),
			expedition_passage_name: (slot, count) => count === 1
				? getLangString('MOD_MP_EXPEDITION_THE_PASSAGE')
				: getLangString('MOD_MP_EXPEDITION_PASSAGE_' + slot),
			toggle_expedition_phase,
		expedition_chamber_art_url: id => get_mod_asset_url(EXPEDITION_CHAMBER_ART[id]
				? `assets/expedition-chambers/${EXPEDITION_CHAMBER_ART[id]}.png`
				: 'assets/expedition-chamber-placeholder.svg'),
		expedition_exit_art_url: label => get_mod_asset_url(EXPEDITION_EXIT_ART[label]
				? `assets/expedition-chambers/${EXPEDITION_EXIT_ART[label]}.png`
				: 'assets/expedition-exit-placeholder.svg'),
		expedition_exit_gateway_url: (chamber_id, slot) => get_mod_asset_url(
				`assets/expedition-exit-gateways/${expedition_view.passage_gateway(chamber_id, slot)}.png`),
			choose_social_mode: mode => {
				social_mode_choice_selection = true;
				state.close_modal();
				void apply_social_mode(mode);
			},
			set_social_mode: mode => { void apply_social_mode(mode); },
			show_bank_actions_modal,
			set_bank_action_mode,
			submit_bank_action,
			load_more_guild_activity,
			get_guild_activity_lang_id,
			get_guild_activity_arg_1,
			get_guild_activity_arg_2,
			get_guild_activity_arg_3,
			format_guild_activity_time,
			set_updates_mobile_tab,
			open_multiplayer_wiki: () => openLink(state.wiki_url),
			load_transfer_history: (pane, append = false) => load_transfer_history(pane, append),
			toggle_transfer_history: pane => {
				state.transfers_history_open[pane] = !state.transfers_history_open[pane];
				if (state.transfers_history_open[pane]) void load_transfer_history(pane);
			},
			get_transfer_history_entries: pane => transfer_history_module.visible_transfer_history(state.transfer_history[pane], state.transfer_history_clock).slice(0, state.transfer_history[pane].visible_count),
			has_more_transfer_history: pane => state.transfer_history[pane].entries.length > state.transfer_history[pane].visible_count || !!state.transfer_history[pane].next_cursor,
			get_transfer_history_items: entry => transfer_history_module.transfer_history_items(entry.items, item_id => transfer_currency_support.is_transfer_currency(game, item_id)),
			format_transfer_history_item: item => formatNumber(item.qty) + (transfer_currency_support.is_transfer_currency(game, item.item_id) ? ' ' : ' × ') + state.get_item_name(item.item_id),
			get_transfer_history_exchange: entry => transfer_history_module.transfer_history_exchange(entry, getLangString, state.format_transfer_history_item),
			get_transfer_history_context: entry => transfer_history_module.transfer_history_context(entry, getLangString),
			get_transfer_history_sources: item => transfer_history_module.transfer_history_sources(item, getLangString, state.get_inbox_group_title),
			get_transfer_history_title: entry => transfer_history_module.transfer_history_label(entry, getLangString, state.get_inbox_group_title),
			get_guild_established_days
		},
		install_common_actions(action_runtime),
		install_chat_actions(action_runtime),
		install_browser_link_actions({ state, api_get, api_post_response, getLangString,
			get_scope: () => server_host + ':' + session_generation, get_origin: () => server_host }),
		install_page_guide_actions({ state, queue_modal }),
		install_market_actions(action_runtime),
		install_crucible_actions(action_runtime, crucible_rules),
		install_trading_actions(action_runtime),
		install_transfer_actions(action_runtime),
		install_social_actions(action_runtime)
	);
	modal_queue_guard = new ModalQueueGuard(template_id =>
		document.querySelector(`mp-modal-component[data-template-id="${template_id}"]`) !== null
	);
	modal_component_registry = new ModalComponentRegistry(template_id => {
		const component = document.createElement('mp-modal-component');
		component.setAttribute('data-template-id', template_id);
		return component;
	});
	chat_items.register_chat_elements({ game, state, getLangString, document, HTMLElement, customElements });
	register_components({
		BankRangeSlider,
		createItemInformationTooltip,
		game,
		getLangString,
		modal_queue_guard,
		mount_modal_template,
		state,
		tippy
	});
	const raid_controller = new raid_module.RaidCombatController({
		now: () => Date.now() + state.raid_time_offset,
		storage: {
			get: () => get_instance_storage_item('raid_terminal_result') ?? null,
			set: terminal => set_instance_storage_item('raid_terminal_result', terminal),
			remove: () => remove_instance_storage_item('raid_terminal_result')
		},
		settle: async terminal => {
			const result = await api_post_response('/api/raids/assaults/settle', terminal);
			if (result.response?.status === 200) {
				if (result.json?.outcome === 'success')
					void update_inbox();
				return result.json;
			}
			if ([404, 409].includes(result.response?.status)) {
				log('discarding terminal Raid Assault result after final server response %d', result.response.status);
				return { success: true };
			}
			if (result.response?.status === 410)
				return { success: true };
			return null;
		},
		on_terminal: () => setTimeout(() => {
			if (game.combat.isActive && raid_module.is_raid_monster(game.combat.selectedMonster))
				game.combat.stop(true);
			if (interface_ready)
				navigate_page(game.pages.getObjectByID('multiplayer:Guild_Raid'));
			void refresh_raid_state();
		}, 0)
	});
	raid_combat = raid_module.install_raid_combat_hooks(
		ctx,
		raid_controller,
		globalThis.CombatManager ?? game.combat.constructor,
		game,
		navigate_page
	);

	raid_module.install_raid_attack_description_hook(ctx, customElements.get('special-attack-span'), game);

	await patch_localization(ctx, setup_page_guide_button);

	install_social_mode_setting(ctx);
	connection_diagnostics.install_loading_report(ctx, {
		t: key => getLangString('MOD_MP_LOADING_REPORT_' + key), get_report: get_connection_report
	});
	transport_diagnostics.phase('setup', performance.now() - setup_started);
	const mode_settings_section = ctx.settings.section(getLangString('MOD_MP_SETTINGS_MODE_SECTION'));
	mode_settings_section.add({
		type: 'social-mode',
		name: 'social-mode',
		default: social_mode.SOCIAL_MODE_FULL
	});
	server_settings_section = ctx.settings.section(getLangString('MOD_MP_SETTINGS_CONNECTION'));
	ctx.onModsLoaded(capture_active_mod_names);
	server_settings_section.add({
		type: 'text',
		name: 'custom-server',
		label: getLangString('MOD_MP_SETTINGS_CUSTOM_SERVER'),
		hint: getLangString('MOD_MP_SETTINGS_CUSTOM_SERVER_HINT'),
		default: '',
		maxLength: custom_server_max_length,
		onChange(value) {
			return get_custom_server_validation_error(value) ?? true;
		}
	});

	combat_settings_section = ctx.settings.section(getLangString('MOD_MP_PAGE_COMBAT'));
	combat_settings_section.add({
		type: 'switch', name: 'combat-keybinds', default: true,
		label: getLangString('MOD_MP_SETTINGS_COMBAT_KEYS'),
		hint: getLangString('MOD_MP_SETTINGS_COMBAT_KEYS_HINT')
	});

	await ctx.loadTemplates('ui/templates.html');
	document.addEventListener('visibilitychange', handle_runtime_visibility_change);
	globalThis.addEventListener('pagehide', () => combat_arena?.close());

	await load_pets(ctx);
	await ctx.gameData.addPackage('data.json');
	localize_multiplayer_page_names();
	localization.localize_raid_content({ game, getLangString });

	ctx.onCharacterLoaded(() => {
		state.clear_browser_links?.();
		offline_work_gate.start(game);
		service_availability.reset();
		state.service_status = null;
		state.chat_conversations = state.chat_conversations.filter(entry => !entry.synthetic_service);
		if (state.selected_chat_conversation?.synthetic_service) state.close_chat_conversation();
		client_runtime.queue_mod_conflict_notice(mod.manager.getLoadedModList(), getLangString, addModalToQueue, document, ctx.name);
		raid_combat.clear_loaded_combat();
		raid_loaded_session_id = crypto.randomUUID();
		loaded_save_tracker.character_loaded(game);
		loaded_game_mode_id = client_runtime.get_game_mode_id(game.currentGamemode);
		state.load_chat_translation_preferences();
		state.last_seen_mod_version = get_character_storage_item(UPDATES_LAST_SEEN_MOD_VERSION_KEY) ?? '';
		state.updates_new = updates_loader.has_unseen_mod_version(MOD_VERSION, state.last_seen_mod_version);
		apply_server_configuration();
		state.load_crucible_heat_preference();
		state.load_chat_notification_preferences();
		equipment_evidence.start(game);
		load_social_mode();
		update_multiplayer_nav();
		start_multiplayer_session();
		load_transfer_inventory();

	});
	ctx.onCharacterSelectionLoaded(() => {
		state.clear_browser_links?.();
		equipment_evidence.stop();
		offline_work_gate.stop();
		combat_page_visible = false;
		combat_arena?.close();
		combat_inventory?.reset();
		state.combat_dungeons_visited = false;
		listing_filter_prompt?.stop();
		set_crucible_page_visible(false);
		loaded_save_tracker.clear();
		set_expedition_page_visible(false);
		raid_combat?.abandon();
	});

	sidebar.category('Multiplayer', {
		before: 'Into the Abyss',
		toggleable: true,
		name: createElement('lang-string', {
			attributes: [['lang-id', 'MOD_MP_MENU_HEADER']]
		})
	});
	ctx.onInterfaceReady(() => {
		interface_ready = true;
		void rollback_client?.pump_notice();
		if (!customElements.get('mp-crucible-heat-lava')) customElements.define('mp-crucible-heat-lava',
			image_particles.create_image_particle_element({ create_renderer: () => crucible_heat.create_heat_renderer({
				get_tier: () => state.crucible?.heat?.tier ?? 0
			}) }));
		if (!customElements.get('mp-expedition-snow')) customElements.define('mp-expedition-snow',
			expedition_snow.create_expedition_snow_element({
				create_image_particle_element: image_particles.create_image_particle_element,
				get_settings: () => state.expedition_snow,
				on_stats: stats => { if (state.expedition_snow_controls_enabled) state.expedition_snow_stats = stats; },
				measure: () => state.expedition_snow_controls_enabled
			}));
		if (!customElements.get('mp-expedition-crystals')) customElements.define('mp-expedition-crystals',
			image_particles.create_image_particle_element({ create_renderer: expedition_crystals.create_crystal_renderer }));
		if (!customElements.get('mp-expedition-haze')) customElements.define('mp-expedition-haze',
			image_particles.create_image_particle_element({ create_renderer: () => expedition_haze.create_glassroot_renderer({
				create_facet_glint_renderer: expedition_crystals.create_facet_glint_renderer
			}) }));
		if (!customElements.get('mp-expedition-observatory')) customElements.define('mp-expedition-observatory',
			image_particles.create_image_particle_element({ create_renderer: expedition_observatory.create_observatory_renderer }));
		if (!customElements.get('mp-expedition-orrery')) customElements.define('mp-expedition-orrery',
			image_particles.create_image_particle_element({ create_renderer: expedition_orrery.create_orrery_renderer }));
		if (!customElements.get('mp-expedition-voidwatch')) customElements.define('mp-expedition-voidwatch',
			image_particles.create_image_particle_element({ create_renderer: expedition_voidwatch.create_voidwatch_renderer }));
		for (const id of ['drowned_cloister', 'rootforge_passage', 'tideworn_crypts', 'embervein_machinery', 'mossbound_reliquary']) {
			const tag = `mp-expedition-${id.replaceAll('_', '-')}`;
			if (!customElements.get(tag)) customElements.define(tag, image_particles.create_image_particle_element({
				create_renderer: () => expedition_branches.create_branch_renderer(id)
			}));
		}
		if (!customElements.get('mp-expedition-hollow-star')) customElements.define('mp-expedition-hollow-star',
			image_particles.create_image_particle_element({ create_renderer: () => expedition_hollow_star.create_hollow_star_renderer({
				get_tasks: () => expedition_hollow_star.hollow_star_tasks(state.expedition_state)
			}) }));
		const setup_interface = $main_container => {
			const interface_started = performance.now();
			setup_account_menu();
			setup_page_guide_button({ document, state, getLangString });
			watch_chat_nav();
			setup_mobile_sidebar_unread();
			update_chat_nav();
			update_transfer_inventory_nav();
			update_multiplayer_nav();
			update_raid_nav();

			for (const page of ['guild', 'raid', 'combat', 'expedition', 'chat', 'transfer', 'crucible', 'market', 'updates']) {
				make_scoped_template(page + '-page', $main_container);
			}
			transport_diagnostics.phase('interface', performance.now() - interface_started);
			setup_chat_sticky_header();
			void refresh_changelog();
			void refresh_updates();

			patch_bank_actions();
			watch_equipment_view_actions();
			watch_status_changes(ctx);
			show_pending_banishment_notice();
			show_pending_identity_notices();

			on_page_toggle('mp-guild-page', set_guild_page_visible);
			on_page_toggle('mp-raid-page', set_raid_page_visible);
			on_page_toggle('mp-combat-page', visible => {
				combat_page_visible = visible;
				combat_animation.update(visible ? state.combat.arena : null);
				if (visible) {
					void combat_inventory.refresh();
					void refresh_chat_state();
				}
			});
			on_page_toggle('mp-expedition-page', set_expedition_page_visible);
			on_page_toggle('mp-chat-page', is_visible => {
				chat_page_visible = is_visible;
				if (is_visible) update_chat_header_offset();
				if (is_visible && state.is_connected) {
					// Chat hydrates its own inbox/configuration; polling owns Events.
					void refresh_chat_page();
				} else {
					chat_view_generation++;
					state.chat_loading = false;
					stop_chat_polling();
				}
			});
			on_page_toggle('mp-crucible-page', async is_visible => {
				set_crucible_page_visible(is_visible);
				if (!is_visible)
					return;
				const entry = crucible_page_entry;
				try {
					await get_client_events();
					if (entry !== crucible_page_entry) return;
					await refresh_guild_state();
					if (entry !== crucible_page_entry) return;
					await recover_pending_crucible_wish_actions();
					if (entry !== crucible_page_entry) return;
					await state.refresh_crucible(true);
				} finally {
					if (entry === crucible_page_entry) crucible_page_hydrating = false;
				}
			}, false);
			on_page_toggle('mp-market-page', async () => {
				await get_client_events();
				await refresh_guild_state();
				await update_market_page(true);
			}, true);
			on_page_toggle('mp-updates-page', is_visible => {
				if (is_visible && !is_mobile_layout())
					mark_updates_seen();
				if (is_visible && !state.changelog_loaded)
					void refresh_changelog();
				if (is_visible && state.updates_loaded_host !== server_host)
					void refresh_updates();
			}, false);
		};

		const $main_container = find_main_container();
		if ($main_container !== null) {
			setup_interface($main_container);
			return;
		}

		const observer_root = document.documentElement ?? document.body;
		if (observer_root === null) {
			error('main container unavailable during interface setup');
			return;
		}
		const observer = new MutationObserver(() => {
			const main_container = find_main_container();
			if (main_container === null)
				return;
			observer.disconnect();
			setup_interface(main_container);
		});
		observer.observe(observer_root, { childList: true, subtree: true });
	});
}

function setup_account_menu() {
	const $account_button = document.getElementById('page-header-user-dropdown');
	const account_icons = [...($account_button?.querySelectorAll('#header-account-icon') ?? [])];
	const $account_icon = account_icons.shift();
	const multiplayer_icon = ctx.getResourceUrl('assets/multiplayer.svg');
	for (const $duplicate_icon of account_icons)
		$duplicate_icon.remove();
	if ($account_icon) {
		$account_icon.dataset.src = multiplayer_icon;
		$account_icon.src = multiplayer_icon;
	}

	const $account_menu = document.getElementById('header-user-options-dropdown');
	const $menu_content = $account_menu?.querySelector('.p-2');
	const $account_divider = $menu_content?.querySelector('.dropdown-divider');
	const $save_management_header = $account_divider?.nextElementSibling;
	if (!$menu_content || !$save_management_header)
		return;
	if (!$save_management_header.matches('h5.dropdown-header.text-warning'))
		return;

	make_template('account-options', $menu_content);
	const $account_options = document.getElementById('mp-account-options');
	if ($account_options)
		$menu_content.insertBefore($account_options, $save_management_header);
}

function apply_server_configuration() {
	const previous_server_host = server_host;
	try {
		const config = resolve_server_config(
			SERVER_HOST,
			SERVER_INSTANCE_STORAGE_PREFIX,
			server_settings_section.get('custom-server')
		);
		server_host = config.host;
		server_instance_storage_prefix = config.storage_prefix;
		server_instance_storage_legacy_prefixes = config.is_custom
			? []
			: SERVER_INSTANCE_STORAGE_LEGACY_PREFIXES;
		if (!config.is_custom) {
			instance_storage.migrate_unscoped_server_storage(
				get_character_storage_item,
				set_character_storage_item,
				server_instance_storage_prefix,
				SERVER_SCOPED_LEGACY_STORAGE_KEYS
			);
		}
		log('using %s multiplayer server', config.is_custom ? 'custom' : 'default');
	} catch (e) {
		server_host = SERVER_HOST;
		server_instance_storage_prefix = SERVER_INSTANCE_STORAGE_PREFIX;
		server_instance_storage_legacy_prefixes = SERVER_INSTANCE_STORAGE_LEGACY_PREFIXES;
		instance_storage.migrate_unscoped_server_storage(
			get_character_storage_item,
			set_character_storage_item,
			server_instance_storage_prefix,
			SERVER_SCOPED_LEGACY_STORAGE_KEYS
		);
		error('invalid saved custom server setting; using default server (%s)', e);
	}
	if (!IS_DEV_MODE && is_creator_toolkit_local_mod() &&
		typeof currentCharacter === 'number' && Number.isInteger(currentCharacter) && currentCharacter >= 0) {
		try {
			instance_storage.prune_legacy_local_character_storage(
				localStorage,
				get_local_character_storage_key(server_instance_storage_prefix, LEGACY_LOCAL_MOD_CHARACTER_STORAGE_PREFIX),
				get_local_character_storage_key(server_instance_storage_prefix)
			);
		} catch { /* Browser storage availability must not block server selection. */ }
	}
	if (previous_server_host !== server_host) {
		service_availability?.reset();
		state.service_status = null;
		state.chat_conversations = state.chat_conversations.filter(entry => !entry.synthetic_service);
		if (state.selected_chat_conversation?.synthetic_service) state.close_chat_conversation();
		selected_api_major = null;
		state.wiki_url = api_contract.wiki_url(null);
		session_generation++;
		expedition_leaderboard?.reset();
		combat_arena?.close();
		state.clear_browser_links?.();
		combat_inventory?.reset();
		state.combat_dungeons_visited = get_instance_storage_item('combat_dungeons_visited') === true;
		events_refreshed_at = 0;
		last_events_result = null;
		page_snapshots_supported = false;
		state.is_connected = false;
		state.pending_preview = null;
		economy_command_journal = null;
		rollback_client = null; economy_commands_ready = false; rollback_server_supported = false;
		if (interface_ready) void refresh_updates(true);
	}
}

function get_icon_objects(collection) {
	const objects = collection?.allObjects ?? collection?.registeredObjects ?? [];
	return [...objects]
		.map(entry => Array.isArray(entry) ? entry[1] : entry)
		.filter(Boolean);
}

function get_icon_object_by_id(collection, id) {
	if (!collection || typeof id !== 'string')
		return null;

	const direct = collection.getObjectByID?.(id);
	if (direct)
		return direct;

	return get_icon_objects(collection).find(object => object.id === id) ?? null;
}

function is_official_game_id(id) {
	if (typeof id !== 'string')
		return false;
	const separator = id.indexOf(':');
	return separator > 0 && OFFICIAL_GAME_NAMESPACES.has(id.slice(0, separator));
}

function is_multiplayer_game_id(id) {
	if (typeof id !== 'string')
		return false;
	const separator = id.indexOf(':');
	return separator > 0 && id.slice(0, separator) === MULTIPLAYER_GAME_NAMESPACE;
}

function is_question_mark_media(media) {
	return typeof media === 'string' && /(?:^|\/)assets\/media\/main\/question\.png(?:[?#]|$)/i.test(media);
}

function make_avatar_icon(icon_object, allow_multiplayer = false) {
	if ((!is_official_game_id(icon_object?.id) && !(allow_multiplayer && is_multiplayer_game_id(icon_object?.id))) ||
		typeof icon_object.name !== 'string' ||
		typeof icon_object.media !== 'string' ||
		is_question_mark_media(icon_object.media))
		return null;
	return {
		id: icon_object.id,
		search_name: icon_object.name.toLowerCase(),
		media: icon_object.media
	};
}

function setup_icons() {
	if (state.available_icons.length === 0) {
		const icon_objects = [
			...get_icon_objects(game.pets).map(icon => ({ icon, allow_multiplayer: false })),
			...[...multiplayer_pet_flare.values()].map(pet => ({
				icon: {
					id: 'multiplayer:' + pet.id,
					name: getLangString(pet.name),
					media: ctx.getResourceUrl(pet.media)
				},
				allow_multiplayer: true
			})),
			...get_icon_objects(game.monsters).map(icon => ({ icon, allow_multiplayer: false })),
			...get_icon_objects(game.thieving?.actions).map(icon => ({ icon, allow_multiplayer: false }))
		];
		const seen = new Set();
		state.available_icons = icon_objects
			.map(entry => make_avatar_icon(entry.icon, entry.allow_multiplayer))
			.filter(icon => {
				if (icon === null || seen.has(icon.id))
					return false;
				seen.add(icon.id);
				return true;
			});
	}
}

function setup_guild_icons() {
	if (state.guild_icons.length > 0)
		return;

	state.guild_icons = get_icon_objects(game.combatAreas).map(area => {
		return {
			id: area.id,
			search_name: area.name.toLowerCase(),
			media: area.media
		};
	}).filter(icon => is_official_game_id(icon.id) && !is_question_mark_media(icon.media));
}

const BANK_ACTION_TITLE_LANG_IDS = {
	'': 'MOD_MP_BANK_ACTIONS_TITLE',
	transfer: 'MOD_MP_BANK_ACTION_TRANSFER',
	market: 'MOD_MP_BANK_ACTION_MARKET',
	crucible: 'MOD_MP_BANK_ACTION_CRUCIBLE'
};

function get_bank_action_item() {
	return state.bank_action_item_id === '' ? null : game.items.getObjectByID(state.bank_action_item_id);
}

function get_bank_action_donation_value(item, qty) {
	const sale_value = item.sellsFor?.currency === game.gp
		? game.bank.getItemSalePrice(item, qty)
		: 0;
	if (sale_value > 0)
		return sale_value;
	return item.id.includes(':Summoning_Familiar_') ? 0 : qty;
}

function get_offering_item_valuation(item_id) {
	const item = game.items.getObjectByID(item_id);
	const value_currency_id = item?.sellsFor?.currency?.id;
	const value_per_item = item?.sellsFor?.quantity;
	if (typeof value_currency_id !== 'string' || !Number.isSafeInteger(value_per_item) || value_per_item < 0)
		return { value_currency_id: null, value_per_item: item === undefined ? null : 0 };
	return { value_currency_id, value_per_item };
}

function update_bank_action_modal_header(mode) {
	const item = get_bank_action_item();
	const $title = document.getElementById('swal2-title');
	const $image = document.querySelector('.swal2-image');
	document.querySelector('.mp-bank-actions-modal-popup')?.classList.toggle('mp-market-listing-popup', mode === 'market');
	if ($title)
		$title.textContent = getLangString(BANK_ACTION_TITLE_LANG_IDS[mode]);
	if ($image) {
		$image.src = mode === '' ? ctx.getResourceUrl('assets/multiplayer.svg') : state.get_item_icon(item.id);
		$image.alt = mode === '' ? getLangString('MOD_MP_BANK_ACTIONS_TITLE') : item.name;
	}
}

function show_bank_actions_modal() {
	if (state.multiplayer_unsupported)
		return;
	if (!state.is_guild_member)
		return notify_error('MOD_MP_GUILD_REQUIRED');

	const item = game.bank.selectedBankItem?.item ?? get_bank_action_item();
	if (item === null || game.bank.getQty(item) < 1)
		return notify_error('MOD_MP_MARKET_NOT_ENOUGH_ITEM');

	state.bank_action_item_id = item.id;
	state.bank_action_mode = '';
	state.item_slider_value = 1;
	state.bank_action_market_price = Math.max(1, game.bank.getItemSalePrice(item));
	queue_modal('MOD_MP_BANK_ACTIONS_TITLE', 'bank-actions-modal', 'assets/multiplayer.svg', {
		showConfirmButton: false,
		customClass: { popup: 'mp-bank-actions-modal-popup' },
		didClose: () => {
			state.bank_action_mode = '';
			state.item_slider_value = 0;
		}
	});
}

function set_bank_action_mode(mode) {
	if (BANK_ACTION_TITLE_LANG_IDS[mode] === undefined)
		return;
	state.bank_action_mode = mode;
	state.item_slider_value = 1;
	if (mode === 'market') {
		state.bank_action_market_price = Math.max(1, game.bank.getItemSalePrice(get_bank_action_item()));
		state.bank_action_market_currency_id = 'melvorD:GP';
		state.bank_action_alliance_price = '';
		state.bank_action_unlimited = true;
		state.bank_action_purchase_limit = 1;
		state.bank_action_allow_haggles = true;
	}
	update_bank_action_modal_header(mode);
}

async function submit_bank_action(event) {
	const item = get_bank_action_item();
	const qty = Number(state.item_slider_value);
	if (item === null || !Number.isSafeInteger(qty) || qty < 1 || qty > game.bank.getQty(item)) {
		notify_error('MOD_MP_MARKET_NOT_ENOUGH_ITEM');
		return;
	}

	const $button = event?.currentTarget;
	if ($button && is_button_spinning($button))
		return;
	if ($button)
		show_button_spinner($button);

	try {
		if (state.bank_action_mode === 'transfer') {
			if (add_item_to_transfer_inventory(item, qty))
				state.close_modal();
			return;
		}

		if (state.bank_action_mode === 'market') {
			const price = Number(state.bank_action_market_price);
			if (!Number.isSafeInteger(price) || price < 1) {
				notify_error('MOD_MP_MARKET_CANNOT_SELL_FREE');
				return;
			}
			if (!state.bank_action_listing_valid) return notify_error('MOD_MP_LISTING_INVALID');
			if (await market_create_listing(item, qty, price, {
				currency_id: state.bank_action_market_currency_id,
				alliance_price: state.bank_action_alliance_price === '' ? 0 : Number(state.bank_action_alliance_price),
				purchase_limit: state.bank_action_unlimited ? 0 : state.bank_action_purchase_limit,
				allow_haggles: state.bank_action_allow_haggles
			}))
				state.close_modal();
			return;
		}

		if (state.bank_action_mode === 'crucible') {
			await state.refresh_crucible();
			if (!state.crucible?.is_open) {
				notify_error('MOD_MP_CRUCIBLE_SEALED');
				return;
			}
			const res = await run_pending_economy_action('bank_crucible_cast:' + item.id, '/api/crucible/cast', {
				items: [{ id: item.id, qty, ...get_offering_item_valuation(item.id) }],
				source: 'bank',
				donation_value: get_bank_action_donation_value(item, qty)
			});
			if (!res?.success) {
				notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
				return;
			}
			notify('MOD_MP_CRUCIBLE_CAST_DONE');
			if (typeof res.pet_id === 'string' && !state.owned_pet_ids.includes(res.pet_id))
				state.owned_pet_ids = [...state.owned_pet_ids, res.pet_id];
			await state.refresh_crucible(true);
			state.close_modal();
		}
	} catch (e) {
		error('failed to complete bank action (%s)', e);
		notify_error('MOD_MP_GENERIC_ERR');
	} finally {
		if ($button)
			hide_button_spinner($button);
	}
}

function patch_bank_actions() {
	const $bank_item_menu = document.querySelector('bank-selected-item-menu');
	const $gutter = $bank_item_menu.querySelector('.gutters-tiny');
	const $sell_panel = [...$gutter.children].find($child =>
		$child.querySelector('lang-string[lang-id="BANK_STRING_22"]') !== null);
	const existing_children = new Set($gutter.children);
	make_template('bank-actions-container', $gutter);
	const $actions_panel = [...$gutter.children].find($child => !existing_children.has($child));
	if ($actions_panel && $sell_panel)
		$gutter.insertBefore($actions_panel, $sell_panel);

	function update_bank_item(orig_func, ...args) {
		orig_func.call(this, ...args);
		state.bank_action_item_id = args[0]?.item?.id ?? '';
	}

	function reset_bank_action_item(orig_func, ...args) {
		update_bank_item.call(this, orig_func, ...args);
		state.item_slider_value = 1;
	}

	const orig_update_item_quantity = $bank_item_menu.updateItemQuantity;
	$bank_item_menu.updateItemQuantity = function(...args) {
		update_bank_item.call(this, orig_update_item_quantity, ...args);
	}

	const orig_set_item = $bank_item_menu.setItem;
	$bank_item_menu.setItem = function(...args) {
		reset_bank_action_item.call(this, orig_set_item, ...args);
	}

	// detect data page open
	on_page_toggle('mp-transfer-page', async is_visible => {
		state.is_transfer_page_visible = is_visible;
		if (is_visible) {
			state.transfer_history_clock = performance.now();
			await get_client_events();
			await refresh_guild_state();
			await prepare_page_snapshot('transfers');
			await Promise.all([update_transfer_contents(), update_market_haggles(), refresh_transfer_history()]);
		}
	});
}

/** Patches the global fetchLanguageJSON() fn so we can load and inject our own
 * translations. This is a hackfix because I couldn't find a way for mods to load
 * their own translations via data. */
async function patch_localization(ctx, setup_page_guide_button) {
	const fetch_mod_localization = async (lang, language = loadedLangJson) => {
		const fetch_lang = localization.resolve_multiplayer_language(lang);

		try {
			const patch_lang = await ctx.loadData('data/lang/' + fetch_lang + '.json');
			for (const [key, value] of Object.entries(patch_lang))
				language[key] = value;
			localize_multiplayer_page_names();
			if (document.getElementById('mp-page-guide-link'))
				setup_page_guide_button({ document, state, getLangString: key => language[key] ?? getLangString(key) });
			const notice = state.chat_conversations.find(entry => entry.synthetic_service);
			if (notice) update_service_notice(notice.service_status, key => language[key] ?? getLangString(key));
		} catch (e) {
			error('Failed to patch localization for %s (%s)', fetch_lang, e);
		}
	};

	const orig_fetchLanguageJSON = globalThis.fetchLanguageJSON;
	globalThis.fetchLanguageJSON = localization.create_localized_language_fetch(
		orig_fetchLanguageJSON,
		fetch_mod_localization
	);

	if (loadedLangJson !== undefined) {
		await fetch_mod_localization('en');
		if (setLang !== 'en')
			await fetch_mod_localization(setLang);
	}
}

async function start_multiplayer_session(options = {}) {
	if (is_connecting)
		return;

	is_connecting = true;
	active_identity_credentials = null;
	listing_filter_prompt?.stop();
	state.is_connected = false;
	state.pending_preview = null;
	state.multiplayer_unsupported = false;
	state.minimum_supported_mod_version = '';
	session_generation++;
	expedition_leaderboard?.reset();
	combat_arena?.close();
	state.clear_browser_links?.();
	combat_inventory?.reset();
	state.combat_dungeons_visited = get_instance_storage_item('combat_dungeons_visited') === true;
	events_refreshed_at = 0;
	last_events_result = null;
	state.transfer_history = transfer_history_module.create_transfer_history_state();
	economy_commands_ready = false;
	economy_command_journal = null;
	rollback_client = null;
	try {
		const melvor_cloud_manager = typeof cloudManager === 'undefined' ? globalThis.cloudManager : cloudManager;
		await discover_api_contract();
		if (state.multiplayer_unsupported)
			return;
		const account = identity_bindings.read_melvor_account(melvor_cloud_manager, globalThis.localStorage);
		const stored_bindings = get_instance_storage_item('identity_bindings');
		const normalized_bindings = identity_bindings.normalize_identity_bindings(stored_bindings);
		if (account === null && normalized_bindings.entries.length > 0) {
			notify_error('MOD_MP_MULTIPLAYER_CONNECTION_ERR');
			error('Melvor account context is unavailable; refusing to use an ambiguous legacy identity');
			return;
		}
		const binding = identity_bindings.find_identity_binding(stored_bindings, account);
		const legacy_identifier = get_instance_storage_item('client_identifier');
		const legacy_key = get_instance_storage_item('client_key');
		const legacy_credentials = typeof legacy_identifier === 'string' && typeof legacy_key === 'string'
			? { client_identifier: legacy_identifier, client_key: legacy_key }
			: null;
		const pending = identity_bootstrap.read_pending_registration(get_instance_storage_item(identity_bootstrap.pending_registration_key(account)), account);
		let credentials = pending ?? binding ?? legacy_credentials;
		if (options.recovery_code !== undefined) {
			credentials = identity_bootstrap.decode_recovery_code(options.recovery_code, server_host);
			if (!credentials) { state.identity_error = getLangString('MOD_MP_IDENTITY_CODE_INVALID'); return; }
		}
		state.identity_error = '';
		if (options.create === true) {
			await register_multiplayer_identity(account, false);
			if (state.is_connected) state.close_modal();
			return;
		}
		const using_legacy_credentials = credentials === legacy_credentials;

		if (!identity_bootstrap.valid_identity_credentials(credentials)) {
			queue_identity_notice('bootstrap');
			return;
		}

		log('existing client identity found, authenticating session...');
		const auth = await api_post_response('/api/authenticate', {
			client_identifier: credentials.client_identifier,
			// The save proof preserves compatibility with older servers, which ignore installation fields.
			// New servers require the supplied installation key and never fall back to this proof on rejection.
			client_key: credentials.client_key,
			...installation_credentials.auth(server_host, credentials.client_identifier, get_device_diagnostics().installation_id),
			client_runtime: get_client_runtime_report(),
			...account
		});
		if (auth.response?.status === 200 && auth.json !== null &&
			api_contract.validate_api_bootstrap(auth.json, selected_api_major)) {
			if (enter_unsupported_multiplayer(auth.json.minimum_supported_mod_version))
				return;
			persist_identity_credentials(account, { ...credentials, friend_code: auth.json.friend_code });
			if (pending?.client_identifier === credentials.client_identifier || options.recovery_code !== undefined)
				remove_instance_storage_item(identity_bootstrap.pending_registration_key(account));
			if (options.recovery_code !== undefined) flush_identity_storage();
			active_identity_credentials = credentials;
			activate_multiplayer_identity(auth.json, auth.timing);
			if (options.recovery_code !== undefined) { state.identity_code = ''; state.close_modal(); }
			void enroll_current_installation(auth.json, credentials.client_identifier);
			if (auth.json.deletion_cancelled)
				queue_identity_notice('deletion_cancelled', auth.json.deletion_cancelled);
			if (auth.json.identity_recovered)
				queue_identity_notice('recovered');
			return;
		}

		if (auth.response?.status === 401 && pending?.client_identifier === credentials.client_identifier && options.recovery_code === undefined && !options.registration_replay) {
			await register_multiplayer_identity(account, false);
			return;
		}
		if (auth.response?.status === 409 && auth.json?.identity_status === 'melvor_account_mismatch' &&
			account !== null && using_legacy_credentials && options.recovery_code === undefined) {
			await register_multiplayer_identity(account, true);
			return;
		}

		state.identity_error = state.service_status ? '' : getLangString('MOD_MP_IDENTITY_CONNECT_FAILED');
		if (options.recovery_code === undefined && [401, 403, 409].includes(auth.response?.status)) queue_identity_notice('bootstrap');
		notify_error(auth.json?.identity_status === 'installation_revoked' ? 'MOD_MP_INSTALLATION_REVOKED' : 'MOD_MP_MULTIPLAYER_CONNECTION_ERR');
		error('failed to authenticate client (%s), multiplayer features not available', auth.response?.status ?? 'transport');
	} catch (e) {
		notify_error(e?.code === 'api_incompatible' ? 'MOD_MP_API_INCOMPATIBLE' : 'MOD_MP_MULTIPLAYER_CONNECTION_ERR');
		state.identity_error = state.service_status ? '' : getLangString('MOD_MP_IDENTITY_CONNECT_FAILED');
		error('failed to start multiplayer session');
	} finally {
		is_connecting = false;
	}
}

function open_identity_bootstrap() {
	if (modal_queue_guard.pending_templates.has('identity-bootstrap-modal') || modal_queue_guard.is_template_active('identity-bootstrap-modal')) return;
	state.identity_code = '';
	state.identity_create_confirmed = false;
	queue_modal('MOD_MP_IDENTITY_CONNECT_TITLE', 'identity-bootstrap-modal', 'assets/multiplayer.svg', {
		showConfirmButton: false, didClose: () => { state.identity_code = ''; }
	});
}

function show_identity_recovery_code() {
	if (!state.is_connected) { queue_identity_notice('bootstrap'); return; }
	const credentials = active_identity_credentials;
	try { state.identity_code = identity_bootstrap.encode_recovery_code(server_host, credentials); }
	catch { notify_error('MOD_MP_IDENTITY_CONNECT_FAILED'); return; }
	state.close_modal();
	queue_modal('MOD_MP_IDENTITY_BACKUP_TITLE', 'identity-backup-modal', 'assets/multiplayer.svg', {
		didClose: () => { state.identity_code = ''; }
	});
}

// Melvor characterStorage is serialized only when the native game saves.
function flush_identity_storage() {
	if (IS_DEV_MODE || is_creator_toolkit_local_mod()) return;
	if (typeof saveData !== 'function' || typeof getKeyForSaveSlot !== 'function' || typeof currentCharacter !== 'number')
		throw new Error('Native save unavailable');
	const key = getKeyForSaveSlot(currentCharacter) + 'saveGame';
	const before = localStorage.getItem(key);
	saveData();
	const after = localStorage.getItem(key);
	if (typeof after !== 'string' || after === before) throw new Error('Native save did not persist');
}

function persist_identity_credentials(account, credentials) {
	if (account !== null) store_account_identity_binding(account, credentials);
	else {
		set_instance_storage_item('client_key', credentials.client_key);
		set_instance_storage_item('client_identifier', credentials.client_identifier);
		set_instance_storage_item('friend_code', credentials.friend_code);
	}
	const stored = account !== null ? identity_bindings.find_identity_binding(get_instance_storage_item('identity_bindings'), account) : {
		client_identifier: get_instance_storage_item('client_identifier'), client_key: get_instance_storage_item('client_key')
	};
	if (!stored || stored.client_identifier !== credentials.client_identifier || stored.client_key !== credentials.client_key)
		throw new Error('Identity storage did not persist');
}

function store_account_identity_binding(account, credentials) {
	const bindings = identity_bindings.upsert_identity_binding(
		get_instance_storage_item('identity_bindings'),
		account,
		credentials
	);
	set_instance_storage_item('identity_bindings', bindings);
	if (typeof credentials.friend_code === 'string')
		set_instance_storage_item('friend_code', credentials.friend_code);
}

async function register_multiplayer_identity(account, account_changed) {
	log('missing identity for current Melvor account, registering new identity...');
	if (!identity_registration_supported) {
		state.identity_error = getLangString('MOD_MP_IDENTITY_HOST_UPGRADE');
		return false;
	}
	const pending = identity_bootstrap.prepare_registration(get_instance_storage_item, set_instance_storage_item, account);
	flush_identity_storage();
	const client_key = pending.client_key;
	const registration = await api_post_response('/api/register', {
		client_key,
		registration_id: pending.client_identifier,
		display_name: game.characterName,
		client_runtime: get_client_runtime_report(),
		...account
	});
	if (registration.response?.status === 409 && registration.json?.identity_status === 'registration_exists') {
		// The server committed a previous attempt. Reconnect using the already persisted proof.
		is_connecting = false;
		await start_multiplayer_session({ registration_replay: true });
		return state.is_connected;
	}
	if (registration.response?.status !== 200 || registration.json === null ||
		!api_contract.validate_api_bootstrap(registration.json, selected_api_major)) {
		state.identity_error = state.service_status ? '' : getLangString('MOD_MP_IDENTITY_CONNECT_FAILED');
		notify_error('MOD_MP_MULTIPLAYER_CONNECTION_ERR');
		error('failed to register client (%s), multiplayer features not available', registration.response?.status ?? 'transport');
		return false;
	}
	if (enter_unsupported_multiplayer(registration.json.minimum_supported_mod_version))
		return false;

	const credentials = {
		client_identifier: registration.json.client_identifier,
		client_key,
		friend_code: registration.json.friend_code
	};
	if (registration.json.client_identifier !== pending.client_identifier) throw new Error('Unexpected registered identity');
	persist_identity_credentials(account, credentials);
	remove_instance_storage_item(identity_bootstrap.pending_registration_key(account));

	active_identity_credentials = credentials;
	activate_multiplayer_identity(registration.json, registration.timing);
	void enroll_current_installation(registration.json, credentials.client_identifier);
	if (account_changed)
		queue_identity_notice('account_changed');
	return true;
}

async function enroll_current_installation(response, client_identifier) {
	if (response.installation_auth_supported !== true) return;
	try {
		await installation_credentials.enroll(server_host, client_identifier, get_device_diagnostics().installation_id,
			payload => api_post_response('/api/installations/enroll', payload, response.session_token));
	} catch { /* Enrollment failure leaves the already authenticated legacy session usable. */ }
}

function activate_multiplayer_identity(response, timing) {
	if (Array.isArray(response.chat_reaction_choices) && response.chat_reaction_choices.length === 18 && response.chat_reaction_choices.every(value => typeof value === 'string'))
		state.chat_reaction_choices = [...response.chat_reaction_choices];
	if (enter_unsupported_multiplayer(response.minimum_supported_mod_version))
		return;
	const handshake_generation = session_generation;
	connected_backend_version = Number.isSafeInteger(response.backend_version) ? response.backend_version : null;
	set_session_token(response.session_token);
	economy_commands_ready = false;
	const generation = session_generation;
	const origin = server_host;
	const storage_key = `pending_economy_command:${response.chat.client_id}`;
	const review_key = `economy_receipt_reviews:${response.chat.client_id}`;
	economy_receipt_reviews = economy_receipt_review_module.create_economy_receipt_reviews({
		read: () => get_instance_storage_item(review_key),
		write: value => set_instance_storage_item(review_key, value),
		report: payload => api_post('/api/economy/receipts/review', payload),
		current: () => generation === session_generation && origin === server_host && state.is_connected
	});
	rollback_client = rollback_module.create_rollback_client({
		supported: rollback_server_supported || response.rollback?.protocol === 'save-rollback-v1',
		origin, client_id: response.chat.client_id, load_id: loaded_save_tracker?.report()?.load_id,
		handshake_generation, current: () => generation === session_generation && origin === server_host && state.is_connected,
		read: get_instance_storage_item, write: set_instance_storage_item,
		keys: get_instance_storage_keys, remove: remove_instance_storage_item,
		post: async (endpoint, payload) => endpoint === null ? api_get_request('/api/save-rollback/status') : api_post_response_raw(endpoint, payload, response.session_token),
		retire(id) {
			economy_command_journal?.retire(id);
			const stored = get_instance_storage_item('processed_economy_receipt_ids');
			if (Array.isArray(stored) && stored.includes(id)) set_instance_storage_item('processed_economy_receipt_ids', stored.filter(value => value !== id));
		},
		changed() { economy_commands_ready = false; },
		ui_ready: () => interface_ready, queue: options => addModalToQueue(options), close: () => Swal.close(), text: getLangString
	});
	economy_command_journal = economy_command_module.create_economy_command_journal({
		read: () => get_instance_storage_item(storage_key),
		write: value => set_instance_storage_item(storage_key, value),
		remove: () => remove_instance_storage_item(storage_key),
		send: (endpoint, payload, major) => api_post_response_raw(endpoint, payload, response.session_token, major),
		reconcile: reconcile_economy_receipts,
		current: () => generation === session_generation && origin === server_host && state.is_connected,
		can_submit: pending => (economy_commands_ready && rollback_client.admitted()) || rollback_module.protected_rollback_recovery_route(pending.endpoint),
		can_recover: pending => rollback_client.admitted() || rollback_module.protected_rollback_recovery_route(pending.endpoint),
		is_retired: id => rollback_client.is_retired(id)
	});
	void rollback_client.bootstrap(response, timing).then(() => {
		if (generation !== session_generation || origin !== server_host || !state.is_connected) return;
		client_events_hydrated = false; events_refreshed_at = 0;
		if (client_event_request !== null) client_event_trailing = true;
		else void get_client_events();
	}).catch(() => { if (generation === session_generation) economy_commands_ready = false; });
	guild_state_refresh_id++;
	state.guild_state = { affiliation: 'none' };
	state.guild_state_loaded = false;
	state.guild_state_loading = false;
	state.guild_state_error = '';
	state.guilds = [];
	state.profile_display_name = response.display_name;
	state.profile_icon = response.icon_id;
	state.server_owned_pets = response.server_owned_pets === true;
	state.owned_pet_ids = Array.isArray(response.owned_pet_ids) ? response.owned_pet_ids : [];
	state.raid_monster_drops = response.raid_monster_drops ?? {};
	state.raid_tier_progress = response.raid_tier_progress && typeof response.raid_tier_progress === 'object'
		? response.raid_tier_progress : {};
	state.social_mode = social_mode.normalize_social_mode(response.social_mode);
	state.social_mode_enforcement = ['identity', 'account', 'guild'].includes(response.social_mode_enforcement)
		? response.social_mode_enforcement : null;
	set_instance_storage_item('social_mode', state.social_mode);
	state.equipment_visible = response.equipment_visible !== false;
	state.skills_visible = response.skills_visible !== false;
	state.activity_visible = response.activity_visible !== false;
	invalidate_status_icon_collection();
	state.gp_visible = response.gp_visible !== false;
	state.game_mode_visible = response.game_mode_visible !== false;
	state.active_mods_visible = response.active_mods_visible !== false;
	state.dev_tag_eligible = response.dev_tag?.eligible === true;
	state.dev_tag_visible = response.dev_tag?.visible !== false;
	state.messaging_enabled = response.chat?.messaging_enabled !== false;
	state.global_chat_enabled = response.chat?.global_chat_enabled !== false;
	state.pending_preview = null;
	state.account_tags = Array.isArray(response.account_tags) ? response.account_tags : [];
	apply_dev_badge_labels(response.dev_badge_labels ?? {});
	state.alliance_access = response.alliance_access === true;
	state.guild_chat_enabled = response.chat?.guild_chat_enabled !== false;
	state.guild_chat_state = { affiliated: false, enabled: state.guild_chat_enabled };
	state.chat_client_id = response.chat?.client_id ?? null;
	state.chat_is_admin = false;
	state.chat_can_highlight = false;
	state.chat_highlight_drafts = {};
	state.chat_highlight_modal_key = null;
	state.chat_budget_enabled = response.chat?.budget_enabled !== false;
	check_released_mod_version(response.released_mod_version);
	if (response.chat?.budget)
		state.chat_budget = response.chat.budget;
	if (state.social_mode_enforcement !== null)
		set_instance_storage_item('social_mode_selected', true);
	else if (get_instance_storage_item('social_mode_selected') !== true)
		queue_identity_notice('social_mode_choice');
	else
		queue_default_avatar_notice();
	update_multiplayer_nav();
	start_gp_sampling(true);
	start_status_observer();
	start_client_event_polling(true);
	if (chat_page_visible)
		void refresh_chat_page();
	void refresh_initial_guild_state();
	void raid_combat?.flush();
	void refresh_raid_state();
	schedule_equipment_sync(0);
	schedule_status_sync(0);
	if (response.listing_filter_prompt_pending === true) {
		listing_filter_prompt?.stop();
		listing_filter_prompt = listing_filter_prompt_module.create_listing_filter_prompt({
			current: () => generation === session_generation && origin === server_host && state.is_connected,
			idle: () => interface_ready && document.visibilityState !== 'hidden' &&
				pending_identity_notices.length === 0 && modal_queue_guard.pending_templates.size === 0 &&
				typeof modalQueue !== 'undefined' && !modalQueuePaused && modalQueue.length === 0 && !modalIsOpen && !Swal.isVisible(),
			pending: async () => (await api_get('/api/listing-filters/prompt'))?.pending,
			show: didOpen => state.open_listing_filters_settings({ didOpen }),
			acknowledge: async () => {
				const result = await api_post_response('/api/listing-filters/prompt/acknowledge', {}, response.session_token);
				return result.response?.status === 200 && result.json?.success === true;
			}
		});
	}
}
// #endregion
