// #region CONSTANTS
const SERVER_HOST = 'http://127.0.0.1:3000';
const SERVER_INSTANCE_STORAGE_PREFIX = 'instance:local-mac:';
const SERVER_INSTANCE_STORAGE_LEGACY_PREFIXES = [];
const MOD_VERSION = 'development';
const LOCAL_MOD_CHARACTER_STORAGE_PREFIX = 'mp:local-character:';
const LEGACY_LOCAL_MOD_CHARACTER_STORAGE_PREFIX = 'kru-melvor-multiplayer:local-character:';
const SERVER_SCOPED_LEGACY_STORAGE_KEYS = [
	'charity_timeout',
	'charity_bonus_timeout',
	'pending_banishment_guild_name',
	'processed_banishment_claim_ids',
	'processed_economy_receipt_ids',
	'processed_raid_cache_ids',
	'raid_terminal_result',
	'transfer_inventory'
];
const LOG_PREFIX = '[multiplayer] ';

const IS_DEV_MODE = false;
const DEV_CHARACTER_STORAGE = {
	client_identifier: '04fcad4c-7df5-43c3-a70e-299cd618a0ab',
	client_key: 'f88596d3-e2b2-4a50-9754-6b05f1a15bac',
	friend_code: '689-388-847',
	transfer_inventory: [
		{
			id: 'melvorF:Fire_Acolyte_Wizard_Hat', // hats, get your hats! free hats!
			qty: 200
		}
	]
};

const TRANSFER_INVENTORY_MAX_LIMIT = 32;
const GIFT_FLAG_RETURNED = 1 << 0;

const CHARITY_TIMEOUT = 1000 * 60 * 60 * 24; // 24 hours
const CHARITY_CHECK_TIMEOUT = 10 * 1000; // 10 seconds

const MARKET_ITEMS_PER_PAGE = 30;
const MARKET_FILTER_ITEMS_LIMIT = 24;
const EQUIPMENT_SYNC_DELAY = 150;
const STATUS_SYNC_DELAY = 150;
const STATUS_MIN_SYNC_INTERVAL = 10 * 1000;
const STATUS_OBSERVER_INTERVAL = 1000;
const GUILD_STATE_FRESHNESS = 15 * 1000;
const GUILD_CHAT_CAPABILITY = 'guild-chat-v1';
const SUPPORT_TEAM_ICON_ASSETS = Object.freeze({
	multiplayer: 'multiplayer.svg',
	sae_support: 'sae_support.png'
});
const OFFICIAL_GAME_NAMESPACES = new Set([
	'melvorD',
	'melvorF',
	'melvorAoD',
	'melvorTotH',
	'melvorItA'
]);
// #endregion

// #region GLOBALS
const ctx = mod.getContext(import.meta);

let session_token = null;
let session_generation = 0;
const API_GET_CACHE_NONCE = crypto.randomUUID();
let api_get_request_sequence = 0;
let is_connecting = false;
let client_event_poll_id = 0;
let client_event_request = null;
let client_event_revision = 0;
let client_events_have_pending = false;
let client_event_poll_failures = 0;
let market_search_generation = 0;
let guild_state_refresh_id = 0;
let guild_state_refresh_request = null;
let guild_state_refreshed_at = 0;
let server_host = SERVER_HOST;
let server_instance_storage_prefix = SERVER_INSTANCE_STORAGE_PREFIX;
let server_instance_storage_legacy_prefixes = SERVER_INSTANCE_STORAGE_LEGACY_PREFIXES;
let server_settings_section = null;
let resolve_server_config = null;
let get_custom_server_validation_error = null;
let custom_server_max_length = null;
let modal_queue_guard = null;
let modal_component_registry = null;
let polling = null;
let open_transfer_page = null;
let remove_sold_out_market_result = null;
let get_market_page_window = null;
let apply_banishment_claim = null;
let load_transfer_delivery_state = null;
let replace_transfer_delivery_inventory = null;
let trade_returns = null;
let transfer_inventory = null;
let item_visibility = null;
let charitree_rules = null;
let client_runtime = null;
let game_mode_sharing = null;
let localization = null;
let status_activities = null;
let icon_catalog_discovery = null;
let icon_catalog_collection = null;
let economy_receipts = null;
let identity_bindings = null;
let instance_storage = null;
let is_reconciling_banishment_returns = false;
let event_snapshots = null;
let gift_contents = null;
let transfer_delivery_state = null;
let economy_receipt_reconciliation = Promise.resolve(true);
let equipment_sync_timer = null;
let equipment_sync_in_flight = false;
let equipment_sync_pending = false;
let last_synced_equipment = null;
let equipment_view_action_armed = false;
let equipment_view_action_timer = null;
let status_sync_timer = null;
let status_sync_in_flight = false;
let status_sync_pending = false;
let last_synced_status_skills = null;
let last_synced_status_activity = null;
let last_synced_status_activities = null;
let status_icon_discovery_generation = 0;
let status_icon_collection_queue = Promise.resolve();
let last_synced_gp = null;
let last_status_sync_at = 0;
let status_observer_timer = null;
let last_observed_status_activity = null;
let last_observed_status_activities = null;
let last_observed_gp = null;
let chat_poll_id = 0;
let chat_poll_failures = 0;
let chat_view_generation = 0;
let chat_page_visible = false;
let interface_ready = false;
let release_notice_shown = false;
let raid_combat = null;
let raid_loaded_session_id = null;
let is_reconciling_raid_cache = false;
const pending_identity_notices = [];

let last_charity_check = 0;
let charity_clock_timer = null;
let charity_page_visible = false;

let has_sorted_market_filter_items = false;
let has_done_first_market_search = false;

const skill_pets = new Map();
let active_mod_names = [];
let loaded_game_mode_id = null;
// #endregion

function capture_active_mod_names() {
	active_mod_names = client_runtime.normalize_active_mod_names(mod.manager.getLoadedModList());
}

function get_client_runtime_report() {
	return client_runtime.make_client_runtime_report(MOD_VERSION, active_mod_names, loaded_game_mode_id,
		client_runtime.get_language_code(typeof setLang === 'string' ? setLang : null));
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

	is_connected: false,
	is_transfer_page_visible: false,
	is_updating_transfer_contents: false,

	removing_friend: null,
	gifting_recipient: null,

	friend_code: '',
	display_name_input: '',
	profile_display_name: '',
	equipment_visible: true,
	equipment_visibility_pending: false,
	status_visible: true,
	status_visibility_pending: false,
	gp_visible: true,
	gp_visibility_pending: false,
	game_mode_visible: true,
	game_mode_visibility_pending: false,
	active_mods_visible: true,
	active_mods_visibility_pending: false,
	messaging_enabled: true,
	chat_privacy_pending: false,
	guild_chat_enabled: true,
	guild_chat_participation_pending: false,
	guild_chat_state: { affiliated: false, enabled: true },
	selected_guild_member: null,
	viewed_equipment: null,
	viewed_status: null,
	viewed_active_mods: [],
	profile_active_tab: 'skills',
	member_actions_preview: false,
	member_actions_error: '',
	icon_search: '',
	picked_icon: '',
	profile_icon: 'melvorD:Plant',
	current_mod_version: MOD_VERSION,
	released_mod_version: '',

	add_gp_value: 0,
	item_slider_value: 0,

	transfer_inventory: [],
	selected_transfer_item_id: '',

	charity_tree_inventory: [],
	selected_charity_item_id: '',
	charity_timeout: 0,
	charity_bonus_timeout: 0,
	charity_bonus_unlocked: false,
	charity_update_time: Date.now(),
	charity_tree_loading: false,

	campaign_data: {},
	campaign_active: false,
	campaign_id: '',
	campaign_next_timestamp: 0,
	campaign_item_id: '',
	campaign_pct: 0,
	campaign_item_total: 0,
	campaign_contribution: 0,
	campaign_max_contribution: 0,
	campaign_loading: false,
	campaign_has_data: false,
	campaign_history: [],
	campaign_rankings: {},
	campaign_update_time: Date.now(),

	market_active_tab: 'search',
	market_direction: 'sell',
	market_results: [],
	market_listings: [],
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
	market_sort_direction: 1,
	market_completed: [],

	market_total_items: 0,
	market_current_page: 1,

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
	guild_client_id: null,
	guild_list_search: '',
	guild_name_input: '',
	guild_icon_search: '',
	guild_icons: [],
	picked_guild_icon: '',
	guild_page_error: '',
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
	chat_loading: false,
	chat_messages_loading: false,
	chat_has_more: false,
	chat_before_cursor: null,
	chat_error: '',
	chat_drafts: {},
	chat_pending_sends: {},
	chat_sending_conversations: {},
	chat_unread: 0,
	chat_client_id: null,
	chat_budget_enabled: true,
	chat_budget: { credits: 5, maximum: 5, refill_interval: 60000, next_refill_at: 0 },
	selected_chat_message: null,
	identities: [],
	identities_loading: false,
	identities_error: '',
	self_deletion: null,
	identity_notice_requester: '',
	identity_notice_time: '',
	raid_state: { affiliation: 'none', cache_pending: false },
	raid_loading: false,
	raid_action_pending: false,
	raid_error: '',
	raid_update_time: Date.now(),
	// #endregion

	// #region COMPUTED PROPS
	get sorted_trades() {
		return this.trades.sort((a, b) => a.attending === b.attending ? 0 : a.attending ? -1 : 1);
	},

	get transfer_inventory_value_raw() {
		let total_value = 0;

		for (const entry of this.transfer_inventory) {
			if (entry.id === 'melvorD:GP') {
				total_value += entry.qty;
		 	} else {
				const item = game.items.getObjectByID(entry.id);
				if (item?.sellsFor.currency === game.gp)
					total_value += game.bank.getItemSalePrice(item, entry.qty);
			}
		}

		return total_value;
	},

	get transfer_inventory_value() {
		return game.gp.formatAmount(numberWithCommas(this.transfer_inventory_value_raw));
	},

	get add_gp_value_formatted() {
		return formatNumber(this.add_gp_value);
	},

	format_shared_gp(amount) {
		return Number.isSafeInteger(amount) && amount >= 0 ? formatNumber(amount) : '';
	},

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

	get visible_council_petitions() {
		return this.council_show_resolved
			? this.council_petitions
			: this.council_petitions.filter(petition => petition.lifecycle === 'active');
	},

	get has_resolved_council_petitions() {
		return this.council_petitions.some(petition => petition.lifecycle !== 'active');
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

	get is_charitree_enabled() {
		return this.is_guild_member && this.guild_state.guild.charitree_enabled !== false;
	},

	get guild_member_count() {
		return this.guild_state.guild?.member_count ?? this.guild_members.length;
	},

	get guild_recipients() {
		return this.guild_members.filter(member => member.client_id !== this.guild_client_id);
	},

	get viewed_equipment_grid() {
		return this.viewed_equipment === null ? [] : build_equipment_grid(this.viewed_equipment);
	},

	get member_profile_available() {
		const member = this.selected_guild_member;
		return member !== null && ((member.status_visible === true && member.status_available === true) ||
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
		return this.is_guild_member || this.transfer_inventory.length > 0 || this.gifts.length > 0 ||
			this.resolved_trades.length > 0;
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

	get chat_latest_message_id() {
		return this.chat_messages.reduce((latest, message) => Math.max(latest, message.message_id), 0);
	},

	get chat_can_send() {
		const kind = this.selected_chat_conversation?.conversation_kind ?? 'private';
		return (kind !== 'private' || (this.messaging_enabled && (!this.chat_budget_enabled || this.chat_budget.credits > 0))) &&
			this.chat_draft.trim().length > 0 &&
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

	get personal_chat_conversations() {
		return this.chat_conversations.filter(conversation => (conversation.conversation_kind ?? 'private') === 'private');
	},

	get guild_chat_conversations() {
		return this.chat_conversations.filter(conversation => conversation.conversation_kind === 'guild');
	},

	get support_chat_conversations() {
		return this.chat_conversations.filter(conversation => conversation.conversation_kind === 'support');
	},

	get show_guild_chat_category() {
		return this.guild_chat_conversations.length > 0 || this.guild_chat_state.affiliated === true;
	},

	get num_market_sold_items() {
		return this.market_completed.length;
	},

	get num_attending_trades() {
		return this.trades.filter(trade => trade.attending).length;
	},

	get num_transfer_offers() {
		return this.gifts.length + this.num_attending_trades + this.resolved_trades.length;
	},

	get num_friend_requests() {
		return this.events.friend_requests.length;
	},

	get num_guild_applicants() {
		return this.events.guild_applicants.length;
	},

	get num_active_transfers() {
		return this.gifts.length + this.resolved_trades.length + this.trades.length;
	},

	get raid() {
		return this.raid_state.raid ?? null;
	},

	get raid_progress_pct() {
		return this.raid === null ? 0 : Math.max(0, Math.min(100,
			((this.raid.max_health - this.raid.remaining_health) / this.raid.max_health) * 100));
	},

	get raid_can_assault() {
		return this.raid?.active === true && this.raid?.member?.eligible === true &&
			(this.raid?.member?.assaults ?? 0) > 0 && !this.raid_action_pending;
	},

	get is_charity_ready() {
		return state.charity_timeout + CHARITY_TIMEOUT < state.charity_update_time;
	},

	get is_charity_bonus_ready() {
		return state.charity_bonus_timeout + CHARITY_TIMEOUT < state.charity_update_time;
	},

	get can_take_charity() {
		return this.is_charity_ready || (this.charity_bonus_unlocked && this.is_charity_bonus_ready);
	},

	get charity_next_opportunity_at() {
		return charitree_rules.get_charitree_next_opportunity(
			this.charity_timeout,
			this.charity_bonus_timeout,
			this.charity_bonus_unlocked,
			CHARITY_TIMEOUT
		);
	},

	get charity_next_opportunity_formatted() {
		return charitree_rules.format_charitree_remaining(
			this.charity_next_opportunity_at,
			this.charity_update_time
		);
	},

	get selected_charity_take_block() {
		const item = this.charity_tree_inventory.find(entry => entry.id === this.selected_charity_item_id);
		return item === undefined ? null : this.get_charity_take_block(item);
	},

	get selected_charity_take_warning() {
		const item = this.charity_tree_inventory.find(entry => entry.id === this.selected_charity_item_id);
		if (item === undefined || item.qty <= 1 || this.get_charity_take_block(item) !== null ||
			this.is_charity_item_discovered(item.id))
			return null;
		return getLangString('MOD_MP_CHARITY_UNDISCOVERED_STACK');
	},

	get campaign_item_current() {
		return Math.round(this.campaign_item_total * this.campaign_pct);
	},

	get campaign_item_name() {
		const item = game.items.getObjectByID(state.campaign_item_id);
		return item?.name ?? 'Unknown Item';
	},

	get campaign_item_icon() {
		return this.get_item_icon(state.campaign_item_id);
	},

	get campaign_item_owned_qty() {
		const item = game.items.getObjectByID(state.campaign_item_id);
		return item === undefined ? 0 : game.bank.getQty(item);
	},

	get campaign_max_solo_contrib() {
		return this.campaign_max_contribution;
	},

	get campaign_max_solo_contrib_reached() {
		return this.campaign_contribution >= this.campaign_max_solo_contrib;
	},

	get campaign_contribution_remaining() {
		return Math.max(this.campaign_max_solo_contrib - this.campaign_contribution, 0);
	},

	get campaign_item_remaining() {
		return Math.max(this.campaign_item_total - this.campaign_item_current, 0);
	},

	get campaign_next_formatted() {
		const delta = this.campaign_next_timestamp - this.campaign_update_time;
		const seconds = Math.floor(delta / 1000);
		
		if (seconds < 60)
			return 'less than a minute';
		
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		
		if (hours > 0)
			return `${hours} ${hours !== 1 ? 'hours' : 'hour'}`;
		
		return `${minutes} ${minutes !== 1 ? 'minutes' : 'minute'}`;
	},

	get market_buy_price_formatted() {
		if (this.market_buy_item)
			return formatNumber(this.market_buy_item.price * this.item_slider_value) + ' GP';

		return '0 GP';
	},

	get market_fulfill_price_formatted() {
		if (this.market_fulfill_item)
			return formatNumber(this.market_fulfill_item.price * this.item_slider_value) + ' GP';

		return '0 GP';
	},

	get market_create_total_formatted() {
		const total = Number(this.market_create_qty) * Number(this.market_create_price);
		return Number.isSafeInteger(total) && total > 0 ? formatNumber(total) + ' GP' : '0 GP';
	},

	get market_listings_filtered() {
		return this.market_listings.filter(item => item.direction === this.market_listing_direction);
	},

	get market_filter_search_sanitized() {
		return this.market_filter_search.trim().toLowerCase();
	},

	get market_filter_items_filtered() {
		const search = this.market_filter_search_sanitized;
		const items = search.length === 0
			? this.market_filter_items
			: this.market_filter_items.filter(item => item.name_lower.includes(search));

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
		game,
		getLangString,
		changePage,
		Swal,
		document,
		$,
		nativeManager: typeof nativeManager === 'undefined' ? undefined : nativeManager,
		crypto,
		SUPPORT_TEAM_ICON_ASSETS,
		GIFT_FLAG_RETURNED,
		MARKET_ITEMS_PER_PAGE,
		TRANSFER_INVENTORY_MAX_LIMIT,
		game_mode_sharing,
		client_runtime,
		charitree_rules,
		trade_returns,
		transfer_inventory,
		api_get,
		api_post,
		add_gp_to_transfer,
		capture_equipment_snapshot,
		capture_status_snapshot,
		invalidate_status_icon_collection,
		close_account_dropdown,
		close_modal: (...args) => state.close_modal(...args),
		close_modal_and_wait,
		destroy_selected_transfer_inventory,
		get_chat_conversation_key,
		get_client_events,
		get_friends,
		getLangString,
		get_icon_object_by_id,
		is_official_game_id,
		get_instance_storage_item,
		has_local_unresolved_item,
		hide_button_spinner,
		hide_modal_error,
		invalidate_guild_state,
		is_button_spinning,
		is_local_item_resolved,
		load_market_filter_items,
		log,
		notify,
		notify_error,
		notify_item,
		open_transfer_page,
		queue_modal,
		reconcile_economy_receipts,
		refresh_chat_conversations,
		refresh_chat_messages,
		refresh_council,
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
		set_instance_storage_item,
		setup_guild_icons,
		setup_icons,
		show_button_spinner,
		show_modal_error,
		start_chat_polling,
		start_status_observer,
		stop_chat_polling,
		stop_status_observer,
		unmount_connected_modal_components,
		update_campaign_nav,
		update_charitree_nav,
		update_market_listings,
		update_market_page,
		update_market_search,
		update_transfer_contents,
		update_raid_nav,
		formatNumber,
		numberWithCommas,
		get chat_view_generation() { return chat_view_generation; },
		set chat_view_generation(value) { chat_view_generation = value; },
		get active_mod_names() { return active_mod_names; },
		get has_sorted_market_filter_items() { return has_sorted_market_filter_items; },
		set has_sorted_market_filter_items(value) { has_sorted_market_filter_items = value; },
		get last_charity_check() { return last_charity_check; },
		set last_charity_check(value) { last_charity_check = value; },
		get last_observed_gp() { return last_observed_gp; },
		set last_observed_gp(value) { last_observed_gp = value; },
		get last_synced_equipment() { return last_synced_equipment; },
		set last_synced_equipment(value) { last_synced_equipment = value; },
		get last_synced_gp() { return last_synced_gp; },
		set last_synced_gp(value) { last_synced_gp = value; },
		get last_synced_status_activities() { return last_synced_status_activities; },
		set last_synced_status_activities(value) { last_synced_status_activities = value; },
		get last_synced_status_activity() { return last_synced_status_activity; },
		set last_synced_status_activity(value) { last_synced_status_activity = value; },
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
		return;
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
	} catch (error) {
		modal_queue_guard.release(template_id);
		throw error;
	}
}

function show_modal_error(text) {
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

function capture_equipment_snapshot() {
	const equipped = game.combat?.player?.equipment?.equippedArray ?? [];
	return equipped
		.filter(entry => entry.providesStats && entry.slot?.id && entry.item?.id &&
			entry.item.id !== 'melvorD:Empty_Equipment')
		.map(entry => ({ slot_id: entry.slot.id, item_id: entry.item.id }))
		.sort((a, b) => a.slot_id.localeCompare(b.slot_id));
}

function schedule_equipment_sync(delay = EQUIPMENT_SYNC_DELAY) {
	if (!state.is_connected || !state.equipment_visible)
		return;
	clearTimeout(equipment_sync_timer);
	equipment_sync_timer = setTimeout(flush_equipment_sync, delay);
}

async function flush_equipment_sync() {
	equipment_sync_timer = null;
	if (!state.is_connected || !state.equipment_visible)
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

function capture_status_activities() {
	return status_activities.capture_status_activities(game);
}

function capture_status_activity(activities = capture_status_activities()) {
	return status_activities.capture_primary_status_activity(game, activities);
}

function capture_status_snapshot() {
	const activities = capture_status_activities();
	return {
		skills: capture_status_skills(),
		activity: capture_status_activity(activities),
		activities,
		gp: capture_gp()
	};
}

function update_local_status_member(snapshot) {
	if (!state.status_visible || !Number.isSafeInteger(state.guild_client_id))
		return;

	const update = member => member.client_id === state.guild_client_id
		? { ...member, status_activity: snapshot.activity, status_activities: [...snapshot.activities] }
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
	if (!state.status_visible || icon_catalog_discovery === null || icon_catalog_collection === null)
		return;
	const is_collection_allowed = () => state.status_visible && generation === status_icon_discovery_generation;
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

function serialize_status_activity(activity) {
	return JSON.stringify(activity.type === 'skill'
		? { type: activity.type, skill_id: activity.skill_id }
		: activity);
}

function serialize_status_activities(activities) {
	return JSON.stringify(activities);
}

function schedule_status_sync(delay = STATUS_SYNC_DELAY) {
	if (!state.is_connected || (!state.status_visible && !state.gp_visible) || !polling.is_foreground(document))
		return;
	delay = Math.max(delay, last_status_sync_at + STATUS_MIN_SYNC_INTERVAL - Date.now());
	clearTimeout(status_sync_timer);
	status_sync_timer = setTimeout(flush_status_sync, Math.max(0, delay));
}

async function flush_status_sync() {
	status_sync_timer = null;
	if (!state.is_connected || (!state.status_visible && !state.gp_visible) || !polling.is_foreground(document))
		return;
	if (status_sync_in_flight) {
		status_sync_pending = true;
		return;
	}

	const snapshot = capture_status_snapshot();
	const serialized_skills = state.status_visible ? JSON.stringify(snapshot.skills) : null;
	const serialized_activity = state.status_visible ? serialize_status_activity(snapshot.activity) : null;
	const serialized_activities = state.status_visible ? serialize_status_activities(snapshot.activities) : null;
	const payload = {};
	if (state.status_visible && serialized_skills !== last_synced_status_skills)
		payload.skills = snapshot.skills;
	if (state.status_visible && serialized_activity !== last_synced_status_activity)
		payload.activity = snapshot.activity;
	if (state.status_visible && serialized_activities !== last_synced_status_activities)
		payload.activities = snapshot.activities;
	if (state.gp_visible && snapshot.gp !== null && snapshot.gp !== last_synced_gp)
		payload.gp = snapshot.gp;
	if (payload.skills === undefined && payload.activity === undefined && payload.activities === undefined && payload.gp === undefined)
		return;

	status_sync_in_flight = true;
	last_status_sync_at = Date.now();
	let res = null;
	try {
		res = await api_post('/api/client/status/sync', payload);
	} catch (e) {
		log('player status synchronization failed (%s)', e);
	}
	status_sync_in_flight = false;
	if (res?.success) {
		update_local_status_member(snapshot);
		if (payload.skills !== undefined) {
			last_synced_status_skills = serialized_skills;
			queue_status_icon_collection(snapshot.skills);
		}
		if (payload.activity !== undefined)
			last_synced_status_activity = serialized_activity;
		if (payload.activities !== undefined)
			last_synced_status_activities = serialized_activities;
		if (payload.gp !== undefined)
			last_synced_gp = payload.gp;
	}
	else
		log('player status synchronization deferred');

	if (status_sync_pending) {
		status_sync_pending = false;
		schedule_status_sync(0);
	}
}

function observe_status_changes() {
	if (!state.is_connected || (!state.status_visible && !state.gp_visible) || !polling.is_foreground(document))
		return;

	const snapshot = state.status_visible ? capture_status_snapshot() : null;
	const serialized = snapshot === null ? null : serialize_status_activity(snapshot.activity);
	const serialized_activities = snapshot === null ? null : serialize_status_activities(snapshot.activities);
	const gp = state.gp_visible ? capture_gp() : null;
	if (serialized === last_observed_status_activity && serialized_activities === last_observed_status_activities && gp === last_observed_gp)
		return;

	last_observed_status_activity = serialized;
	last_observed_status_activities = serialized_activities;
	last_observed_gp = gp;
	schedule_status_sync();
}

function start_status_observer() {
	if (status_observer_timer !== null || !state.is_connected || (!state.status_visible && !state.gp_visible) ||
		!polling.is_foreground(document))
		return;

	observe_status_changes();
	status_observer_timer = setInterval(observe_status_changes, STATUS_OBSERVER_INTERVAL);
}

function stop_status_observer() {
	if (status_observer_timer !== null)
		clearInterval(status_observer_timer);
	status_observer_timer = null;
	last_observed_status_activity = null;
	last_observed_status_activities = null;
	last_observed_gp = null;
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
	return item_visibility.is_item_resolved(item_id, id => game.items.getObjectByID(id));
}

function filter_local_resolved_items(items, get_item_id) {
	return item_visibility.filter_resolved_items(items, get_item_id, is_local_item_resolved);
}

function has_local_unresolved_item(items, get_item_id) {
	return item_visibility.has_unresolved_item(items, get_item_id, is_local_item_resolved);
}

function get_local_item_namespaces() {
	return item_visibility.get_resolved_item_namespaces([...game.items.registeredObjects]);
}

function add_bank_item(item_id, amount, found = false) {
	if (item_id === 'melvorD:GP')
		game.gp.add(amount);
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
	if (!state.is_guild_member)
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

async function market_create_listing(item, item_qty, item_sell_price) {
	if (!state.is_guild_member)
		return notify_error('MOD_MP_GUILD_REQUIRED');

	if (item_qty <= 0)
		return notify_error('MOD_MP_MARKET_CANNOT_SELL_NOTHING');

	if (item_sell_price <= 0)
		return notify_error('MOD_MP_MARKET_CANNOT_SELL_FREE');

	if (game.bank.getQty(item) < item_qty)
		return notify_error('MOD_MP_MARKET_NOT_ENOUGH_ITEM');

	const res = await api_post('/api/market/sell', {
		item_id: item.id,
		item_qty,
		item_sell_price,
		command_id: crypto.randomUUID()
	});

	if (res?.success && await reconcile_economy_receipts([res.receipt])) {
		notify('MOD_MP_MARKET_ITEM_LISTED', 'success', 'assets/market.svg', item_qty);

		if (state.market_active_tab === 'listing')
			update_market_listings();
	} else {
		notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
	}
}

async function update_market_listings() {
	if (state.market_listings_loading)
		return;

	state.market_listings_loading = true;
	try {
		const res = await api_get('/api/market/listings');
		state.market_listings = (res?.items ?? []).map(item => ({
			...item,
			direction: item.direction ?? 'sell',
			unresolved: !is_local_item_resolved(item.item_id)
		}));
	} finally {
		state.market_listings_loading = false;
	}
}

async function update_market_search() {
	const generation = ++market_search_generation;
	const page = state.market_current_page;
	const sort = state.market_sort_direction;
	const direction = state.market_direction;
	const item_id = state.market_filter_item;
	const item_namespaces = get_local_item_namespaces();
	state.market_search_loading = true;
	try {
		let unresolved_item_ids;
		if (item_id !== null)
			unresolved_item_ids = [];
		else {
			const catalog = await api_post('/api/market/catalog', {
				item_namespaces,
				direction
			});
			if (generation !== market_search_generation)
				return;
			if (!catalog?.success) {
				state.market_results = [];
				state.market_total_items = 0;
				return;
			}
			unresolved_item_ids = (catalog.item_ids ?? []).filter(item_id => !is_local_item_resolved(item_id));
		}

		const res = await api_post('/api/market/search', {
			page,
			sort,
			direction,
			...(item_id === null ? {} : { item_id }),
			item_namespaces,
			unresolved_item_ids
		});
		if (generation !== market_search_generation)
			return;
		if (res?.success) {
			state.market_current_page = res.page;
			state.market_total_items = res.total_items;
			state.market_results = (res.items ?? []).map(item => ({
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
	state.market_filter_items = [...game.items.registeredObjects].map(e => e[1]).filter(item => {
		if (item.category === '')
			return false;

		return true;
	}).map(item => {
		return {
			id: item.id,
			name: item.name,
			name_lower: item.name.toLowerCase(),
			media: item.media,
		}
	});

	has_sorted_market_filter_items = true;
}
// #endregion

// #region CAMPAIGN FUNCTIONS
async function update_campaign_info(force_reload = false) {
	state.campaign_update_time = Date.now();

	if (!state.is_guild_member)
		return;

	if (state.campaign_loading || (!force_reload && state.campaign_has_data))
		return;

	state.campaign_loading = true;
	try {
		const res = await api_get('/api/campaign/info');

		if (res !== null && !res.error_lang) {
			state.campaign_has_data = true;
			state.campaign_history = res.history;
			state.campaign_rankings = res.rankings;

			if (res.active) {
				state.campaign_id = res.campaign_id;
				state.campaign_item_id = res.item_id;
				state.campaign_item_total = res.item_total;
				state.campaign_contribution = res.contribution;
				state.campaign_max_contribution = res.max_contribution;
			} else {
				state.campaign_next_timestamp = res.next_campaign;
			}

			check_campaign_pets();
		} else {
			notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
		}
	} finally {
		state.campaign_loading = false;
	}
}

function check_campaign_pets() {
	for (const [campaign_id, ranking] of Object.entries(state.campaign_rankings)) {
		if (ranking < 4)
			continue;

		const campaign_data = state.campaign_data[campaign_id];
		const pet = game.pets.getObjectByID(campaign_data.pet);

		if (!game.petManager.unlocked.has(pet))
			game.petManager.unlockPetByID(campaign_data.pet);
	}
}

async function load_campaign_data(ctx) {
	state.campaign_data = await ctx.loadData('data/campaigns.json');
}

function update_campaign_nav() {
	const aside = document.querySelector('.mp-campaign-nav');

	if (state.campaign_active)
		aside.textContent = Math.floor(state.campaign_pct * 100) + '%';
	else
		aside.textContent = getLangString('MOD_MP_SIDEBAR_CAMPAIGN_INACTIVE');
}

function update_raid_nav() {
	const aside = document.querySelector('.mp-raid-nav');
	if (!aside)
		return;

	const active = state.raid?.active === true;
	aside.textContent = getLangString(active ? 'MOD_MP_SIDEBAR_RAID_ACTIVE' : 'MOD_MP_SIDEBAR_RAID_PREVIEW');
	aside.classList.toggle('mp-raid-active', active);
}

function localize_multiplayer_page_names() {
	localization.localize_multiplayer_page_names({ game, sidebar, getLangString, createElement });
}

function update_charitree_nav() {
	const nav_item = sidebar.category('Multiplayer').item('multiplayer:Charity_Tree');
	nav_item.rootEl?.classList.toggle('d-none', state.is_guild_member && !state.is_charitree_enabled);

	const aside = document.querySelector('.mp-charity-nav');
	if (!aside)
		return;

	aside.textContent = state.is_charitree_enabled && state.can_take_charity
		? getLangString('MOD_MP_SIDEBAR_CHARITY_READY')
		: '';
}
// #endregion

// #region PET FUNCTIONS
async function load_pets(ctx) {
	const pets = await ctx.loadData('data/pets.json');
	
	ctx.gameData.buildPackage(pkg => {
		for (const pet of pets) {
			pet.name = getLangString(pet.name);
			pet.hint = getLangString(pet.hint);

			pkg.pets.add(pet);
		}
	}).add();

	// Providing customDescription to pets does not appear to work, so we hack it in.
	for (const pet of pets) {
		const pet_obj = game.pets.getObjectByID('multiplayer:' + pet.id);
		pet_obj._customDescription = getLangString(pet.customDescription);
		skill_pets.set(pet.id, pet_obj);
	}
}

function has_pet_by_id(pet_id) {
	return game.petManager.unlocked.has(skill_pets.get(pet_id));
}
// #endregion

// #region CHARITY FUNCTIONS
async function request_charity_tree_contents(force_reload = false) {
	state.charity_update_time = Date.now();
	update_charitree_nav();

	if (!state.is_guild_member)
		return;

	if (state.charity_tree_loading)
		return;

	const current_time = Date.now();
	if (!force_reload && current_time < last_charity_check + CHARITY_CHECK_TIMEOUT)
		return;

	last_charity_check = current_time;
	state.charity_tree_loading = true;
	try {
		const res = await api_get('/api/charity/contents');
		if (Array.isArray(res?.items))
			state.charity_tree_inventory = filter_local_resolved_items(res.items, item => item.id);
	} finally {
		state.charity_tree_loading = false;
	}
}

function update_charity_clock() {
	state.charity_update_time = Date.now();
	if (typeof update_charitree_nav === 'function')
		update_charitree_nav();
	const has_expired_items = state.charity_tree_inventory.some(
		item => Number.isSafeInteger(item.expires_at) && item.expires_at <= state.charity_update_time
	);
	if (has_expired_items) {
		state.charity_tree_inventory = state.charity_tree_inventory.filter(
			item => !Number.isSafeInteger(item.expires_at) || item.expires_at > state.charity_update_time
		);
	}
}

function set_charity_page_visible(is_visible) {
	charity_page_visible = is_visible;
	clearInterval(charity_clock_timer);
	charity_clock_timer = null;
	if (!charity_page_visible)
		return;
	update_charity_clock();
	charity_clock_timer = setInterval(update_charity_clock, 1000);
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
		const returned = await api_post('/api/gift/decline', { gift_id: gift.id });
		return returned?.success === true;
	}
	return false;
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

async function update_transfer_contents() {
	if (state.is_updating_transfer_contents)
		return;

	state.is_updating_transfer_contents = true;
	try {
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
	aside.textContent = state.transfer_inventory.length + ' / ' + TRANSFER_INVENTORY_MAX_LIMIT;
	aside.classList.toggle('text-danger', state.transfer_inventory.length >= TRANSFER_INVENTORY_MAX_LIMIT);
}

function add_gp_to_transfer(amount) {
	if (!state.is_guild_member)
		return notify_error('MOD_MP_GUILD_REQUIRED');
	if (state.has_destroyable_transfer_items)
		return notify_error('MOD_MP_TRANSFER_DESTROY_ITEM_FIRST');

	if (game.gp.amount < amount)
		return notify_error('MOD_MP_INSUFFICIENT_GP_ERR');

	const existing_entry = state.transfer_inventory.find(e => e.id === 'melvorD:GP');
	if (existing_entry) {
		existing_entry.qty += amount;
	} else {
		if (state.transfer_inventory.length >= TRANSFER_INVENTORY_MAX_LIMIT)
			return notify_error('MOD_MP_TRANSFER_INVENTORY_FULL');

		state.transfer_inventory.unshift({
			id: 'melvorD:GP',
			qty: amount
		});
	}

	game.gp.remove(amount);
	update_transfer_inventory_nav();
	persist_transfer_inventory();
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
	if (!state.is_guild_member)
		return notify_error('MOD_MP_GUILD_REQUIRED');

	const existing_entry = state.transfer_inventory.find(e => e.id === item.id);
	if (existing_entry?.destroyable)
		return notify_error('MOD_MP_TRANSFER_DESTROY_ITEM_FIRST');
	if (existing_entry) {
		existing_entry.qty += qty;
	} else {
		if (state.transfer_inventory.length >= TRANSFER_INVENTORY_MAX_LIMIT)
			return notify_error('MOD_MP_TRANSFER_INVENTORY_FULL');

		state.transfer_inventory.push({
			id: item.id,
			qty: qty
		});
	}

	game.bank.removeItemQuantity(item, qty);
	update_transfer_inventory_nav();
	persist_transfer_inventory();
}

function persist_transfer_inventory() {
	transfer_delivery_state = replace_transfer_delivery_inventory(
		transfer_delivery_state,
		state.transfer_inventory
	);
	set_instance_storage_item('transfer_delivery_state', transfer_delivery_state);
}

function load_transfer_inventory() {
	transfer_delivery_state = load_transfer_delivery_state(
		get_instance_storage_item('transfer_delivery_state'),
		get_instance_storage_item('transfer_inventory'),
		get_instance_storage_item('processed_banishment_claim_ids')
	);
	state.transfer_inventory = transfer_delivery_state.inventory.map(entry => ({ ...entry }));
	set_instance_storage_item('transfer_delivery_state', transfer_delivery_state);
	update_transfer_inventory_nav();
}

function reconcile_economy_receipts(receipts) {
	if (!Array.isArray(receipts))
		return Promise.resolve(false);
	receipts = receipts.filter(receipt => receipt !== null && receipt !== undefined);
	if (receipts.length === 0)
		return Promise.resolve(true);
	const reconcile = async () => {
		const stored_ids = get_instance_storage_item('processed_economy_receipt_ids');
		const processed_ids = Array.isArray(stored_ids) ? stored_ids : [];
		for (const receipt of receipts) {
			const result = economy_receipts.apply_economy_receipt(receipt, processed_ids, {
				maximum_transfer_entries: TRANSFER_INVENTORY_MAX_LIMIT,
				has_bank_item: item_id => game.items.getObjectByID(item_id) !== undefined,
				get_bank_qty: item_id => game.bank.getQty(game.items.getObjectByID(item_id)),
				add_bank_item: (item_id, qty) => add_bank_item(
					item_id,
					qty,
					receipt.kind === 'charity-take' && !state.is_charity_item_discovered(item_id)
				),
				remove_bank_item: (item_id, qty) => game.bank.removeItemQuantity(game.items.getObjectByID(item_id), qty),
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
				return false;
			}
			const acknowledged = await api_post('/api/economy/receipts/acknowledge', { receipt_id: receipt.id });
			if (!acknowledged?.success)
				return false;
		}
		return true;
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
function cache_bust_api_endpoint(endpoint) {
	const separator = endpoint.includes('?') ? '&' : '?';
	return `${endpoint}${separator}_mp_cache=${API_GET_CACHE_NONCE}-${++api_get_request_sequence}`;
}

async function api_get(endpoint) {
	try {
		return await polling.fetch_with_timeout(fetch, server_host + cache_bust_api_endpoint(endpoint), {
			method: 'GET',
			headers: {
				'X-Session-Token': session_token ?? undefined
			}
		}, {
			consume: async res => res.status === 200 ? await res.json() : null
		});
	} catch (e) {
		error('GET transport failed for %s (%s)', endpoint, e);
		return null;
	}
}

async function api_post_response(endpoint, payload) {
	try {
		return await polling.fetch_with_timeout(fetch, server_host + endpoint, {
			method: 'POST',
			body: JSON.stringify(payload),
			headers: {
				'Content-Type': 'application/json',
				'X-Session-Token': session_token ?? undefined
			}
		}, {
			consume: async res => {
				let json = null;
				if (res.headers.get('Content-Type')?.includes('application/json')) {
					try {
						json = await res.json();
					} catch (e) {
						if (e?.name === 'AbortError')
							throw e;
						error('failed to parse API response for %s (%s)', endpoint, e);
					}
				}
				return { response: res, json };
			}
		});
	} catch (e) {
		error('POST transport failed for %s (%s)', endpoint, e);
		return { response: null, json: null };
	}
}

async function api_post_binary_response(endpoint, bytes, media_type, upload_token) {
	try {
		return await polling.fetch_with_timeout(fetch, server_host + endpoint, {
			method: 'POST',
			body: bytes,
			headers: {
				'Content-Type': media_type,
				'X-Session-Token': session_token ?? undefined,
				'X-Icon-Catalog-Upload-Token': upload_token
			}
		}, {
			consume: async res => {
				let json = null;
				if (res.headers.get('Content-Type')?.includes('application/json')) {
					try {
						json = await res.json();
					} catch (e) {
						if (e?.name === 'AbortError')
							throw e;
					}
				}
				return { response: res, json };
			}
		});
	} catch (e) {
		error('binary POST transport failed for %s (%s)', endpoint, e);
		return { response: null, json: null };
	}
}

async function api_post(endpoint, payload) {
	const result = await api_post_response(endpoint, payload);
	if (result.response?.status === 200) {
		if (endpoint.startsWith('/api/guilds/') || endpoint.startsWith('/api/banishment/'))
			invalidate_guild_state();
		return result.json;
	}

	return null;
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
		if (notice.type === 'account_changed') {
			queue_modal('MOD_MP_IDENTITY_ACCOUNT_CHANGED_TITLE', 'identity-account-changed-modal');
		} else if (notice.type === 'deletion_cancelled') {
			state.identity_notice_requester = notice.data.requester_display_name;
			state.identity_notice_time = new Date(notice.data.requested_at).toLocaleString();
			queue_modal('MOD_MP_IDENTITY_DELETION_CANCELLED_TITLE', 'identity-deletion-cancelled-modal');
		} else if (notice.type === 'recovered') {
			queue_modal('MOD_MP_IDENTITY_RECOVERED_TITLE', 'identity-recovered-modal');
		} else if (notice.type === 'outdated_version') {
			queue_modal('MOD_MP_OUTDATED_VERSION_TITLE', 'outdated-version-modal');
		}
	}
}

function set_session_token(token) {
	session_token = token;
	session_generation++;
	state.is_connected = true;
	last_synced_equipment = null;
	last_synced_status_skills = null;
	last_synced_status_activity = null;
	last_synced_status_activities = null;
	last_synced_gp = null;
	last_observed_status_activity = null;
	last_observed_status_activities = null;
	last_observed_gp = null;
	last_status_sync_at = 0;
	client_event_revision = 0;
	client_events_have_pending = false;
	invalidate_guild_state();
	log('client session authenticated');
}

async function refresh_chat_state() {
	const res = await api_get('/api/chat/state');
	if (res === null)
		return;
	state.messaging_enabled = res.messaging_enabled !== false;
	state.guild_chat_enabled = res.guild_chat_enabled !== false;
	state.chat_client_id = res.client_id;
	state.chat_budget_enabled = res.budget_enabled !== false;
	if (res.budget)
		state.chat_budget = res.budget;
}

async function refresh_chat_conversations() {
	const selected = state.selected_chat_conversation;
	const res = await api_get('/api/chat/conversations?capabilities=' + GUILD_CHAT_CAPABILITY);
	if (!Array.isArray(res?.conversations))
		return;
	state.chat_conversations = res.conversations;
	state.guild_chat_state = res.guild_chat ?? { affiliated: false, enabled: state.guild_chat_enabled };
	state.guild_chat_enabled = state.guild_chat_state.enabled !== false;
	state.chat_unread = res.conversations.reduce((total, conversation) => total + conversation.unread_count, 0);
	update_chat_nav();
	if (selected) {
		const current = res.conversations.find(conversation =>
			(conversation.conversation_kind ?? 'private') ===
				(selected.conversation_kind ?? 'private') &&
			conversation.conversation_id === selected.conversation_id &&
			conversation.support_team_id === selected.support_team_id
		);
		if (current) {
			const moderation_changed = current.conversation_kind === 'guild' &&
				Number.isSafeInteger(selected.moderation_count) &&
				Number.isSafeInteger(current.moderation_count) &&
				current.moderation_count !== selected.moderation_count;
			state.selected_chat_conversation = current;
			if (moderation_changed) {
				state.close_chat_conversation();
				await state.open_chat_conversation(current);
			}
		} else if (selected.conversation_kind === 'guild') {
			state.close_chat_conversation();
		}
	}
}

function update_chat_nav() {
	const aside = document.querySelector('.mp-chat-nav');
	if (aside !== null) {
		aside.textContent = state.chat_unread > 0 ? String(state.chat_unread) : '';
		aside.hidden = state.chat_unread <= 0;
	}
}

async function refresh_chat_messages(cursor = '', prepend = false, quiet = false, view_generation = chat_view_generation) {
	const conversation = state.selected_chat_conversation;
	if (!conversation || (state.chat_messages_loading && !quiet))
		return false;
	const kind = conversation.conversation_kind ?? 'private';
	if (kind === 'private' && conversation.conversation_id === null)
		return false;
	const conversation_id = conversation.conversation_id;
	if (!quiet)
		state.chat_messages_loading = true;
	state.chat_error = '';
	let res = null;
	try {
		const conversation_parameter = conversation.conversation_id === null
			? '' : '&conversation_id=' + conversation.conversation_id;
		const team_parameter = conversation.support_team_id === undefined
			? '' : '&support_team_id=' + conversation.support_team_id;
		res = await api_get('/api/chat/messages?conversation_kind=' + kind + conversation_parameter + team_parameter + cursor);
		if (view_generation !== chat_view_generation ||
			state.selected_chat_conversation?.conversation_id !== conversation_id ||
			state.selected_chat_conversation?.support_team_id !== conversation.support_team_id)
			return false;
		if (Array.isArray(res?.messages)) {
			const known = new Set(state.chat_messages.map(message => message.message_id));
			const additions = res.messages.filter(message => !known.has(message.message_id));
			if (res.messages.length > 0 && (prepend || (cursor === '' && state.chat_before_cursor === null)))
				state.chat_before_cursor = res.messages[0].message_id;
			state.chat_messages = prepend
				? [...additions, ...state.chat_messages]
				: [...state.chat_messages, ...additions].sort((a, b) => a.message_id - b.message_id);
			if (prepend || cursor === '')
				state.chat_has_more = res.has_more === true;
			if (additions.length > 0)
				await refresh_chat_conversations();
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
	const view_generation = ++chat_view_generation;
	state.chat_loading = true;
	try {
		await Promise.all([refresh_chat_state(), refresh_chat_conversations()]);
		if (state.selected_chat_conversation)
			await refresh_chat_messages('', false, false, view_generation);
	} finally {
		if (view_generation === chat_view_generation) {
			state.chat_loading = false;
			start_chat_polling();
		}
	}
}

function stop_chat_polling() {
	chat_poll_id++;
}

function start_chat_polling() {
	stop_chat_polling();
	chat_poll_failures = 0;
	if (!chat_page_visible || !state.selected_chat_conversation?.conversation_id || !polling.is_foreground(document))
		return;
	const poll_id = chat_poll_id;
	setTimeout(() => poll_chat_messages(poll_id), polling.chat_poll_delay());
}

async function poll_chat_messages(poll_id) {
	if (poll_id !== chat_poll_id || !chat_page_visible || !polling.is_foreground(document))
		return;
	let succeeded = false;
	try {
		const view_generation = chat_view_generation;
		if (state.selected_chat_conversation)
			succeeded = await refresh_chat_messages(
				'&after=' + state.chat_latest_message_id,
				false,
				true,
				view_generation
			);
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
}

async function refresh_guild_state(force = false) {
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
		state.guild_members = (res.members ?? []).map(member => ({
			...member,
			status_activity: member.status_activity ?? null,
			status_activities: Array.isArray(member.status_activities) ? member.status_activities : [],
			gp: Number.isSafeInteger(member.gp) && member.gp >= 0 ? member.gp : null,
			last_seen_at: Number.isSafeInteger(member.last_seen_at) && member.last_seen_at > 0 ? member.last_seen_at : null,
			joined_at: Number.isSafeInteger(member.joined_at) && member.joined_at > 0 ? member.joined_at : null
		}));
		state.guild_member_search = res.member_directory?.search ?? '';
		state.guild_member_directory_page = res.member_directory?.page ?? 0;
		state.guild_member_directory_has_more = res.member_directory?.has_more === true;
		state.guild_applicants = res.applicants ?? [];
		state.guild_client_id = res.current_client_id ?? null;
		state.events.guild_applicants = state.guild_applicants;
		update_charitree_nav();

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
			state.charity_tree_inventory = [];
			state.campaign_has_data = false;
			state.campaign_history = [];
			state.campaign_rankings = {};
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

async function refresh_guild_members(page = 0, search = state.guild_member_search, append = false) {
	if (!state.is_guild_member || !state.is_free_fellowship || state.guild_member_directory_loading)
		return;
	state.guild_member_directory_loading = true;
	try {
		const res = await api_get('/api/guilds/members?page=' + page + '&search=' + encodeURIComponent(search));
		if (res !== null) {
			const members = (res.members ?? []).map(member => ({
				...member,
				status_activity: member.status_activity ?? null,
				status_activities: Array.isArray(member.status_activities) ? member.status_activities : [],
				gp: Number.isSafeInteger(member.gp) && member.gp >= 0 ? member.gp : null,
				last_seen_at: Number.isSafeInteger(member.last_seen_at) && member.last_seen_at > 0 ? member.last_seen_at : null,
				joined_at: Number.isSafeInteger(member.joined_at) && member.joined_at > 0 ? member.joined_at : null
			}));
			state.guild_members = append
				? [...state.guild_members, ...members.filter(member =>
					!state.guild_members.some(existing => existing.client_id === member.client_id))]
				: members;
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
	return 'MOD_MP_GUILD_ACTIVITY_' + event.event_type.toUpperCase();
}

function get_guild_activity_arg_1(event) {
	if (event.event_type.startsWith('petition_'))
		return state.get_council_type_lang(event.metadata.petition_type);
	return event.actor_display_name ?? '';
}

function get_guild_activity_arg_2(event) {
	return event.event_type === 'raid_boss_defeated' ? event.metadata.tier : '';
}

function format_guild_activity_time(created_at) {
	return new Date(created_at).toLocaleString();
}

async function refresh_shadowed_members(page = 0, search = state.shadowed_member_search, append = false) {
	if (!state.is_guild_member || state.shadowed_member_directory_loading)
		return;
	state.shadowed_member_directory_loading = true;
	try {
		const res = await api_get('/api/guilds/members/shadowed?page=' + page + '&search=' + encodeURIComponent(search));
		if (res !== null) {
			const members = (res.members ?? []).map(member => ({
				...member,
				status_activity: member.status_activity ?? null,
				status_activities: Array.isArray(member.status_activities) ? member.status_activities : [],
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
	state.guilds = res?.guilds ?? [];
}

async function refresh_guild_page() {
	setup_guild_icons();
	const guild_state = await refresh_guild_state();

	if (state.is_guild_member) {
		state.shadowed_member_count = 0;
		await Promise.all([refresh_council(), refresh_shadowed_members(), refresh_guild_activity()]);
	}
	else if (guild_state?.affiliation === 'none')
		await refresh_guild_list();
}

async function refresh_raid_state() {
	state.raid_update_time = Date.now();
	state.raid_loading = true;
	try {
		const res = await api_get('/api/raids/state');
		if (res !== null) {
			state.raid_state = res;
			update_raid_nav();
			if (res.cache_pending)
				void reconcile_raid_cache();
		}
		return res;
	} finally {
		state.raid_loading = false;
	}
}

async function reconcile_raid_cache() {
	if (is_reconciling_raid_cache || !state.is_connected)
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
	if (!state.is_guild_member || state.is_free_fellowship || state.council_loading)
		return;
	state.council_loading = true;
	try {
		const res = await api_get('/api/guilds/council?page=' + page);
		if (res !== null) {
			if (append) {
				const known = new Set(state.council_petitions.map(petition => petition.petition_id));
				state.council_petitions.push(...res.petitions.filter(petition => !known.has(petition.petition_id)));
			} else {
				state.council_petitions = res.petitions ?? [];
			}
			state.council_resolved_page = res.resolved_page ?? page;
			state.council_has_more = res.has_more === true;
			state.council_available_petition_types = res.available_petition_types ?? [];
		}
	} finally {
		state.council_loading = false;
	}
}

async function get_client_events(reconcile_gifts = true) {
	if (client_event_request !== null)
		return client_event_request;
	client_event_request = get_client_events_request(reconcile_gifts);
	try {
		return await client_event_request;
	} finally {
		client_event_request = null;
	}
}

async function get_client_events_request(reconcile_gifts = true) {
	const res = await api_get('/api/events?revision=' + client_event_revision + '&capabilities=' + GUILD_CHAT_CAPABILITY);
	if (res !== null) {
		if (res.unchanged === true)
			return res;
		client_events_have_pending = polling.has_pending_events(res);
		if (!await reconcile_economy_receipts(res.economy_receipts ?? []))
			return res;
		if (Number.isSafeInteger(res.revision))
			client_event_revision = res.revision;
		invalidate_guild_state();
		state.events.friend_requests = res.friend_requests;
		state.events.guild_applicants = res.guild_applicants ?? [];
		state.market_completed = res.market_completed;
		state.chat_unread = res.chat_unread ?? 0;
		update_chat_nav();
		if (chat_page_visible)
			await refresh_chat_conversations();

		event_snapshots.reconcile_event_transfers(state, res);

		if (state.campaign_active && !res.campaign.active) {
			// campaign no longer active, ditch known data client-side
			state.campaign_id = '';
			state.campaign_item_id = '';
			state.campaign_item_total = 0;
			state.campaign_contribution = 0;
			state.campaign_max_contribution = 0;
		}

		const campaign_state_changed = state.campaign_active !== res.campaign.active;

		state.campaign_pct = res.campaign.pct;
		state.campaign_active = res.campaign.active;

		if (campaign_state_changed) {
			state.campaign_has_data = false;
			update_campaign_info();
		}

		update_campaign_nav();

		if (state.is_transfer_page_visible)
			setTimeout(() => update_transfer_contents(), 1);
		else if (reconcile_gifts)
			void reconcile_pending_gifts();
		if (res.banishment_return_pending) {
			await reconcile_banishment_returns();
			await refresh_guild_state();
		}
		show_pending_banishment_notice();
	}
	return res;
}

function start_client_event_polling() {
	const poll_id = ++client_event_poll_id;
	client_event_poll_failures = 0;
	if (state.is_connected && polling.is_foreground(document))
		void poll_client_events(poll_id);
}

async function poll_client_events(poll_id) {
	let succeeded = false;
	try {
		succeeded = await get_client_events() !== null;
	} catch (e) {
		error('Client event polling failed (%s)', e);
	} finally {
		client_event_poll_failures = succeeded ? 0 : Math.min(client_event_poll_failures + 1, 5);
		if (poll_id === client_event_poll_id && polling.is_foreground(document)) {
			const delay = succeeded
				? polling.event_poll_delay(client_events_have_pending)
				: polling.retry_poll_delay(client_event_poll_failures);
			setTimeout(() => poll_client_events(poll_id), delay);
		}
	}
}

function handle_runtime_visibility_change() {
	if (!polling.is_foreground(document)) {
		client_event_poll_id++;
		stop_chat_polling();
		stop_status_observer();
		clearTimeout(status_sync_timer);
		status_sync_timer = null;
		return;
	}
	start_client_event_polling();
	start_status_observer();
	schedule_status_sync(0);
	start_chat_polling();
}
// #region

// #region SETUP FUNCTIONS
export async function setup(ctx) {
	const { ModalQueueGuard, ModalComponentRegistry } = await ctx.loadModule('modal-queue.mjs');
	const raid_module = await ctx.loadModule('raid-combat.mjs');
	const transfer_page = await ctx.loadModule('transfer-page.mjs');
	const market_results = await ctx.loadModule('market-results.mjs');
	const banishment_returns = await ctx.loadModule('banishment-returns.mjs');
	trade_returns = await ctx.loadModule('trade-returns.mjs');
	transfer_inventory = await ctx.loadModule('transfer-inventory.mjs');
	economy_receipts = await ctx.loadModule('economy-receipts.mjs');
	const server_config = await ctx.loadModule('server-config.mjs');
	polling = await ctx.loadModule('polling.mjs');
	identity_bindings = await ctx.loadModule('identity-bindings.mjs');
	instance_storage = await ctx.loadModule('instance-storage.mjs');
	event_snapshots = await ctx.loadModule('event-snapshots.mjs');
	gift_contents = await ctx.loadModule('gift-contents.mjs');
	item_visibility = await ctx.loadModule('item-visibility.mjs');
	charitree_rules = await ctx.loadModule('charitree-rules.mjs');
	client_runtime = await ctx.loadModule('client-runtime.mjs');
	game_mode_sharing = await ctx.loadModule('game-mode-sharing.mjs');
	localization = await ctx.loadModule('localization.mjs');
	status_activities = await ctx.loadModule('status-activities.mjs');
	icon_catalog_discovery = await ctx.loadModule('icon-catalog-discovery.mjs');
	icon_catalog_collection = await ctx.loadModule('icon-catalog-collection.mjs');
	open_transfer_page = transfer_page.open_transfer_page;
	remove_sold_out_market_result = market_results.remove_sold_out_market_result;
	get_market_page_window = market_results.market_page_window;
	apply_banishment_claim = banishment_returns.apply_banishment_claim;
	load_transfer_delivery_state = banishment_returns.load_transfer_delivery_state;
	replace_transfer_delivery_inventory = banishment_returns.replace_transfer_inventory;
	resolve_server_config = server_config.resolve_server_config;
	get_custom_server_validation_error = server_config.get_custom_server_validation_error;
	custom_server_max_length = server_config.CUSTOM_SERVER_MAX_LENGTH;
	const { install_common_actions } = await ctx.loadModule('client-actions-common.mjs');
	const { install_chat_actions } = await ctx.loadModule('client-actions-chat.mjs');
	const { install_market_campaign_charity_actions } = await ctx.loadModule('client-actions-market-campaign-charity.mjs');
	const { install_trading_actions } = await ctx.loadModule('client-actions-trading.mjs');
	const { install_transfer_actions } = await ctx.loadModule('client-actions-transfer.mjs');
	const { install_social_actions } = await ctx.loadModule('client-actions-social.mjs');
	const { register_components } = await ctx.loadModule('client-components.mjs');
	const action_runtime = create_action_runtime();
	Object.assign(
		state,
		{
			load_more_guild_activity,
			get_guild_activity_lang_id,
			get_guild_activity_arg_1,
			get_guild_activity_arg_2,
			format_guild_activity_time
		},
		install_common_actions(action_runtime),
		install_chat_actions(action_runtime),
		install_market_campaign_charity_actions(action_runtime),
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
		storage: {
			get: () => get_instance_storage_item('raid_terminal_result') ?? null,
			set: terminal => set_instance_storage_item('raid_terminal_result', terminal),
			remove: () => remove_instance_storage_item('raid_terminal_result')
		},
		settle: async terminal => {
			const result = await api_post_response('/api/raids/assaults/settle', terminal);
			if (result.response?.status === 200)
				return result.json;
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
				changePage(game.pages.getObjectByID('multiplayer:Guild_Raid'));
			void refresh_raid_state();
		}, 0)
	});
	raid_combat = raid_module.install_raid_combat_hooks(
		ctx,
		raid_controller,
		globalThis.CombatManager ?? game.combat.constructor,
		game
	);

	await patch_localization(ctx);

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

	await ctx.loadTemplates('ui/templates.html');
	document.addEventListener('visibilitychange', handle_runtime_visibility_change);

	await load_pets(ctx);
	await ctx.gameData.addPackage('data.json');
	localize_multiplayer_page_names();

	load_campaign_data(ctx);

	ctx.onCharacterLoaded(() => {
		raid_combat.clear_loaded_combat();
		raid_loaded_session_id = crypto.randomUUID();
		loaded_game_mode_id = client_runtime.get_game_mode_id(game.currentGamemode);
		apply_server_configuration();
		start_multiplayer_session();
		load_transfer_inventory();

		state.charity_timeout = get_instance_storage_item('charity_timeout') ?? 0;
		state.charity_bonus_timeout = get_instance_storage_item('charity_bonus_timeout') ?? 0;

		state.charity_bonus_unlocked = has_pet_by_id('Multiplayer_Pet_Charity');
	});
	ctx.onCharacterSelectionLoaded(() => {
		set_charity_page_visible(false);
		raid_combat?.abandon();
	});

	sidebar.category('Multiplayer', {
		before: 'Combat',
		toggleable: true,
		name: createElement('lang-string', {
			attributes: [['lang-id', 'MOD_MP_MENU_HEADER']]
		})
	});
	
	ctx.onInterfaceReady(() => {
		interface_ready = true;
		setup_account_menu();
		update_chat_nav();

		const $main_container = $('main-container');
		for (const page of ['guild', 'raid', 'chat', 'transfer', 'charity', 'campaign', 'market'])
			make_scoped_template(page + '-page', $main_container);

		patch_bank();
		patch_bank_market();
		watch_equipment_view_actions();
		watch_status_changes(ctx);
		show_pending_banishment_notice();
		show_pending_identity_notices();
		
		on_page_toggle('mp-guild-page', refresh_guild_page, true);
		on_page_toggle('mp-raid-page', refresh_raid_state, true);
		on_page_toggle('mp-chat-page', is_visible => {
			chat_page_visible = is_visible;
			if (is_visible)
				void refresh_chat_page();
			else {
				chat_view_generation++;
				state.chat_loading = false;
				stop_chat_polling();
			}
		});
		on_page_toggle('mp-charity-page', async is_visible => {
			set_charity_page_visible(is_visible);
			if (!is_visible)
				return;
			await refresh_guild_state();
			await request_charity_tree_contents(true);
		}, false);
		on_page_toggle('mp-campaign-page', async () => {
			await Promise.all([get_client_events(), refresh_guild_state()]);
			await update_campaign_info(true);
		}, true);
		on_page_toggle('mp-market-page', async () => {
			await refresh_guild_state();
			await update_market_page(true);
		}, true);
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

function make_avatar_icon(icon_object) {
	if (!is_official_game_id(icon_object?.id) || typeof icon_object.name !== 'string' ||
		typeof icon_object.media !== 'string')
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
			...get_icon_objects(game.monsters),
			...get_icon_objects(game.thieving?.actions)
		];
		const seen = new Set();
		state.available_icons = icon_objects
			.map(make_avatar_icon)
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
	}).filter(icon => is_official_game_id(icon.id));
}

function patch_bank_market() {
	const $bank_item_menu = document.querySelector('bank-selected-item-menu');
	const $gutter = $bank_item_menu.querySelector('.gutters-tiny');

	make_template('bank-market-container', $gutter);

	const $slider_element = document.getElementById('mp-market-slider');
	const slider = new BankRangeSlider($slider_element);

	let selected_bank_item = null;
	let sell_price = 1;

	const $sell_value = document.getElementById('mp-market-sell-value');
	function update_sell_value() {
		const amount = slider.quantity;
		const sell_total = amount * sell_price;

		$sell_value.textContent = selected_bank_item.item.sellsFor.currency.formatAmount(numberWithCommas(sell_total));
	}

	const $sell_amount_input = document.getElementById('mp-market-sell-amount');
	const $sell_price_input = document.getElementById('mp-market-sell-price');

	function update_bank_item(orig_func, ...args) {
		orig_func.call(this, ...args);

		selected_bank_item = args[0];
		sell_price = game.bank.getItemSalePrice(selected_bank_item.item);
		$sell_price_input.value = sell_price;

		if (slider.sliderInstance === undefined)
			return;

		slider.setSliderRange(selected_bank_item);
		update_sell_value();
	}

	const orig_update_item_quantity = $bank_item_menu.updateItemQuantity;
	$bank_item_menu.updateItemQuantity = function(...args) {
		update_bank_item.call(this, orig_update_item_quantity, ...args);
	}

	const orig_set_item = $bank_item_menu.setItem;
	$bank_item_menu.setItem = function(...args) {
		update_bank_item.call(this, orig_set_item, ...args);
	}

	$sell_amount_input.addEventListener('input', () => slider.setSliderPosition($sell_amount_input.value));

	$sell_price_input.addEventListener('input', () => {
		sell_price = parseInt($sell_price_input.value);
		update_sell_value();
	});

	slider.customOnChange = (amount) => {
		$sell_amount_input.value = amount;
		update_sell_value();
	};

	const $market_sell_button = document.getElementById('mp-market-sell-button');
	$market_sell_button.addEventListener('click', async () => {
		if (is_button_spinning($market_sell_button))
			return;

		show_button_spinner($market_sell_button);
		try {
			await market_create_listing(selected_bank_item.item, slider.quantity, sell_price);
		} catch (e) {
			error('failed to create market listing (%s)', e);
			notify_error('MOD_MP_GENERIC_ERR');
		} finally {
			hide_button_spinner($market_sell_button);
		}
	});
}

function patch_bank() {
	const $bank_item_menu = document.querySelector('bank-selected-item-menu');
	const $gutter = $bank_item_menu.querySelector('.gutters-tiny');

	make_template('bank-container', $gutter);

	const $slider_element = document.getElementById('mp-transfer-slider');
	const slider = new BankRangeSlider($slider_element);

	let selected_bank_item = null;

	const $transfer_value = document.getElementById('mp-transfer-value');

	function update_transfer_value() {
		const amount = slider.quantity;
		$transfer_value.textContent = selected_bank_item.item.sellsFor.currency.formatAmount(numberWithCommas(game.bank.getItemSalePrice(selected_bank_item.item, amount)));
	}

	function update_bank_item(orig_func, ...args) {
		orig_func.call(this, ...args);

		selected_bank_item = args[0];
		if (slider.sliderInstance === undefined)
			return;

		slider.setSliderRange(selected_bank_item);
		update_transfer_value();
	}

	const orig_update_item_quantity = $bank_item_menu.updateItemQuantity;
	$bank_item_menu.updateItemQuantity = function(...args) {
		update_bank_item.call(this, orig_update_item_quantity, ...args);
	}

	const orig_set_item = $bank_item_menu.setItem;
	$bank_item_menu.setItem = function(...args) {
		update_bank_item.call(this, orig_set_item, ...args);
	}

	const $transfer_input = document.getElementById('mp-transfer-amount');
	$transfer_input.addEventListener('input', () => slider.setSliderPosition($transfer_input.value));

	slider.customOnChange = (amount) => {
		$transfer_input.value = amount;
		update_transfer_value();
	};

	const $transfer_all_button = document.getElementById('mp-transfer-all');
	$transfer_all_button.addEventListener('click', () => slider.setSliderPosition(Infinity));

	const $transfer_all_but_1_button = document.getElementById('mp-transfer-all-but-1');
	$transfer_all_but_1_button.addEventListener('click', () => slider.setSliderPosition(slider.sliderMax - 1));

	const $transfer_button = document.getElementById('mp-transfer-button');
	$transfer_button.addEventListener('click', () => {
		add_item_to_transfer_inventory(selected_bank_item.item, slider.quantity);
	});

	// detect data page open
	on_page_toggle('mp-transfer-page', async is_visible => {
		state.is_transfer_page_visible = is_visible;
		if (is_visible) {
			await Promise.all([get_client_events(), refresh_guild_state()]);
			await update_transfer_contents();
		}
	});
}

/** Patches the global fetchLanguageJSON() fn so we can load and inject our own
 * translations. This is a hackfix because I couldn't find a way for mods to load
 * their own translations via data. */
async function patch_localization(ctx) {
	const fetch_mod_localization = async (lang, language = loadedLangJson) => {
		const fetch_lang = localization.resolve_multiplayer_language(lang);

		try {
			const patch_lang = await ctx.loadData('data/lang/' + fetch_lang + '.json');
			for (const [key, value] of Object.entries(patch_lang))
				language[key] = value;
			localize_multiplayer_page_names();
		} catch (e) {
			error('Failed to patch localization for %s (%s)', fetch_lang, e);
		}
	};

	const orig_fetchLanguageJSON = globalThis.fetchLanguageJSON;
	globalThis.fetchLanguageJSON = localization.create_localized_language_fetch(
		orig_fetchLanguageJSON,
		fetch_mod_localization
	);

	if (loadedLangJson !== undefined)
		await fetch_mod_localization(setLang);
}

async function start_multiplayer_session() {
	if (is_connecting)
		return;

	is_connecting = true;
	try {
		const melvor_cloud_manager = typeof cloudManager === 'undefined' ? globalThis.cloudManager : cloudManager;
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
		const credentials = binding ?? legacy_credentials;
		const using_legacy_credentials = binding === null && legacy_credentials !== null;

		if (credentials === null) {
			await register_multiplayer_identity(account, account !== null && normalized_bindings.entries.length > 0);
			return;
		}

		log('existing client identity found, authenticating session...');
		const auth = await api_post_response('/api/authenticate', {
			client_identifier: credentials.client_identifier,
			client_key: credentials.client_key,
			client_runtime: get_client_runtime_report(),
			...account
		});
		if (auth.response?.status === 200 && auth.json !== null) {
			if (account !== null)
				store_account_identity_binding(account, { ...credentials, friend_code: auth.json.friend_code });
			activate_multiplayer_identity(auth.json);
			if (auth.json.deletion_cancelled)
				queue_identity_notice('deletion_cancelled', auth.json.deletion_cancelled);
			if (auth.json.identity_recovered)
				queue_identity_notice('recovered');
			return;
		}

		if (auth.response?.status === 409 && auth.json?.identity_status === 'melvor_account_mismatch' &&
			account !== null && using_legacy_credentials) {
			await register_multiplayer_identity(account, true);
			return;
		}

		notify_error('MOD_MP_MULTIPLAYER_CONNECTION_ERR');
		error('failed to authenticate client (%s), multiplayer features not available', auth.response?.status ?? 'transport');
	} catch (e) {
		notify_error('MOD_MP_MULTIPLAYER_CONNECTION_ERR');
		error('failed to start multiplayer session (%s)', e);
	} finally {
		is_connecting = false;
	}
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
	const client_key = crypto.randomUUID();
	const registration = await api_post_response('/api/register', {
		client_key,
		display_name: game.characterName,
		client_runtime: get_client_runtime_report(),
		...account
	});
	if (registration.response?.status !== 200 || registration.json === null) {
		notify_error('MOD_MP_MULTIPLAYER_CONNECTION_ERR');
		error('failed to register client (%s), multiplayer features not available', registration.response?.status ?? 'transport');
		return false;
	}

	const credentials = {
		client_identifier: registration.json.client_identifier,
		client_key,
		friend_code: registration.json.friend_code
	};
	if (account === null) {
		set_instance_storage_item('client_key', client_key);
		set_instance_storage_item('client_identifier', registration.json.client_identifier);
		set_instance_storage_item('friend_code', registration.json.friend_code);
	} else {
		store_account_identity_binding(account, credentials);
	}
	activate_multiplayer_identity(registration.json);
	if (account_changed)
		queue_identity_notice('account_changed');
	return true;
}

function activate_multiplayer_identity(response) {
	set_session_token(response.session_token);
	guild_state_refresh_id++;
	state.guild_state = { affiliation: 'none' };
	state.guild_state_loaded = false;
	state.guild_state_loading = false;
	state.guild_state_error = '';
	state.guilds = [];
	state.profile_display_name = response.display_name;
	state.profile_icon = response.icon_id;
	state.equipment_visible = response.equipment_visible !== false;
	state.status_visible = response.status_visible !== false;
	invalidate_status_icon_collection();
	state.gp_visible = response.gp_visible !== false;
	state.game_mode_visible = response.game_mode_visible !== false;
	state.active_mods_visible = response.active_mods_visible !== false;
	state.messaging_enabled = response.chat?.messaging_enabled !== false;
	state.guild_chat_enabled = response.chat?.guild_chat_enabled !== false;
	state.guild_chat_state = { affiliated: false, enabled: state.guild_chat_enabled };
	state.chat_client_id = response.chat?.client_id ?? null;
	state.chat_budget_enabled = response.chat?.budget_enabled !== false;
	if (!release_notice_shown && client_runtime.is_mod_version_outdated(MOD_VERSION, response.released_mod_version)) {
		release_notice_shown = true;
		state.released_mod_version = response.released_mod_version;
		queue_identity_notice('outdated_version');
	}
	if (response.chat?.budget)
		state.chat_budget = response.chat.budget;
	start_status_observer();
	start_client_event_polling();
	void refresh_guild_state();
	void raid_combat?.flush();
	void refresh_raid_state();
	void refresh_identities();
	schedule_equipment_sync(0);
	schedule_status_sync(0);
}
// #endregion
