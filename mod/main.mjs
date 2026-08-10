// #region CONSTANTS
const SERVER_HOST = 'http://127.0.0.1:3000';
const SERVER_INSTANCE_STORAGE_PREFIX = 'instance:local-mac:';
const SERVER_INSTANCE_STORAGE_LEGACY_PREFIXES = [];
const LOCAL_MOD_CHARACTER_STORAGE_PREFIX = 'mp:local-character:';
const LEGACY_LOCAL_MOD_CHARACTER_STORAGE_PREFIX = 'kru-melvor-multiplayer:local-character:';
const SERVER_SCOPED_LEGACY_STORAGE_KEYS = [
	'charity_timeout',
	'charity_bonus_timeout',
	'pending_banishment_guild_name',
	'processed_banishment_claim_ids',
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
const EQUIPMENT_SYNC_DELAY = 150;
const STATUS_SYNC_DELAY = 150;
const STATUS_MIN_SYNC_INTERVAL = 10 * 1000;
const STATUS_OBSERVER_INTERVAL = 1000;
const GUILD_STATE_FRESHNESS = 15 * 1000;
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
let paginate_market_results = null;
let apply_banishment_claim = null;
let item_visibility = null;
let charitree_rules = null;
let identity_bindings = null;
let instance_storage = null;
let is_reconciling_banishment_returns = false;
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
let last_synced_gp = null;
let last_status_sync_at = 0;
let status_observer_timer = null;
let last_observed_status_activity = null;
let last_observed_gp = null;
let chat_poll_id = 0;
let chat_view_generation = 0;
let chat_page_visible = false;
let interface_ready = false;
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
// #endregion

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
	messaging_enabled: true,
	chat_privacy_pending: false,
	selected_guild_member: null,
	viewed_equipment: null,
	viewed_status: null,
	profile_active_tab: 'skills',
	member_actions_error: '',
	icon_search: '',
	picked_icon: '',
	profile_icon: 'melvorD:Plant',

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
	market_results: [],
	market_listings: [],
	market_buy_item: null,
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

	available_icons: [],

	friends: [],

	guild_state: { affiliation: 'none' },
	guild_state_loaded: false,
	guild_state_loading: false,
	guild_state_error: '',
	guilds: [],
	guild_members: [],
	guild_member_search: '',
	guild_member_directory_page: 0,
	guild_member_directory_has_more: false,
	guild_member_directory_loading: false,
	shadowed_members: [],
	shadowed_member_search: '',
	shadowed_member_directory_page: 0,
	shadowed_member_directory_has_more: false,
	shadowed_member_directory_loading: false,
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
	chat_sending: false,
	chat_has_more: false,
	chat_before_cursor: null,
	chat_error: '',
	chat_draft: '',
	chat_unread: 0,
	chat_client_id: null,
	chat_budget_enabled: true,
	chat_budget: { credits: 5, maximum: 5, refill_interval: 60000, next_refill_at: 0 },
	chat_pending_send: null,
	selected_chat_message: null,
	identities: [],
	identities_loading: false,
	identities_error: '',
	selected_identity: null,
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
		return this.available_icons.filter(icon => icon.search_name.includes(icon_search_lower)).slice(0, 32);
	},

	get filtered_guild_icons() {
		const search = this.guild_icon_search.trim().toLowerCase();
		const matches = search.length === 0
			? this.guild_icons
			: this.guild_icons.filter(icon => icon.search_name.includes(search));
		return matches.slice(0, 32);
	},

	get filtered_council_icons() {
		const search = this.council_icon_search.trim().toLowerCase();
		const matches = search.length === 0
			? this.guild_icons
			: this.guild_icons.filter(icon => icon.search_name.includes(search));
		return matches.slice(0, 32);
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

	get viewed_status_activity_icon() {
		return this.get_status_activity_icon(this.viewed_status?.activity);
	},

	get viewed_status_activity_name() {
		return this.get_status_activity_name(this.viewed_status?.activity);
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
		const support = this.selected_chat_conversation?.conversation_kind === 'support';
		return (support || (this.messaging_enabled && (!this.chat_budget_enabled || this.chat_budget.credits > 0))) &&
			this.chat_draft.trim().length > 0 &&
			!this.chat_sending;
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

	get market_filter_search_sanitized() {
		return this.market_filter_search.trim().toLowerCase();
	},

	get market_filter_items_filtered() {
		if (this.market_filter_search_sanitized.length === 0)
			return this.market_filter_items;

		return this.market_filter_items.filter(item => item.name_lower.includes(this.market_filter_search_sanitized));
	},

	get market_page_count() {
		return Math.ceil(this.market_total_items / MARKET_ITEMS_PER_PAGE);
	},
	// #endregion

	// #region COMMON ACTIONS
	get_svg(id) {
		return ctx.getResourceUrl('assets/' + id + '.svg');
	},

	get_svg_url(id) {
		return 'url(' + this.get_svg(id) + ')';
	},

	get_item_icon(id) {
		if (id === 'melvorD:GP')
			return game.gp.media;

		const item = game.items.getObjectByID(id);
		return item?.media ?? 'assets/media/main/question.png';
	},

	get_item_name(id) {
		const item = game.items.getObjectByID(id);
		return item?.name ?? 'Unknown Item';
	},

	get_avatar_icon(id) {
		const monster = game.monsters.getObjectByID(id);
		return monster?.media ?? 'assets/media/main/question.png';
	},

	get_guild_icon(id) {
		if (id === 'multiplayer')
			return this.get_svg('multiplayer');
		const area = game.combatAreas.getObjectByID(id);
		return area?.media ?? 'assets/media/main/question.png';
	},

	get_skill_icon(id) {
		const skill = game.skills?.getObjectByID(id);
		return skill?.media ?? 'assets/media/main/question.png';
	},

	get_skill_name(id) {
		const skill = game.skills?.getObjectByID(id);
		return skill?.name ?? id;
	},

	get_skill_level_cap(id) {
		const skill = game.skills?.getObjectByID(id);
		const level_cap = Number(skill?.levelCap ?? skill?.maxLevel);
		return Number.isSafeInteger(level_cap) && level_cap > 0 ? level_cap : 120;
	},

	get_profile_equipment_message() {
		return getLangString(this.selected_guild_member?.equipment_visible === false
			? 'MOD_MP_EQUIPMENT_NOT_SHARED' : 'MOD_MP_EQUIPMENT_NOT_AVAILABLE');
	},

	get_profile_status_message() {
		return getLangString(this.selected_guild_member?.status_visible === false
			? 'MOD_MP_STATUS_NOT_SHARED' : 'MOD_MP_STATUS_NOT_AVAILABLE');
	},

	get_status_activity_name(activity) {
		if (activity?.type === 'skill')
			return this.get_skill_name(activity.skill_id);
		if (activity?.type === 'combat')
			return activity.area_id === null ? getLangString('MOD_MP_STATUS_ACTIVITY_COMBAT') :
				game.combatAreas?.getObjectByID(activity.area_id)?.name ?? getLangString('MOD_MP_STATUS_ACTIVITY_COMBAT');
		return getLangString('MOD_MP_STATUS_ACTIVITY_IDLE');
	},

	get_status_activity_icon(activity) {
		if (activity?.type === 'skill')
			return this.get_skill_icon(activity.skill_id);
		if (activity?.type === 'combat') {
			const area = activity.area_id === null ? null : game.combatAreas?.getObjectByID(activity.area_id);
			return area?.media ?? 'assets/media/skills/combat/combat.png';
		}
		return this.get_svg('single_user');
	},

	get_last_seen_lang_id(timestamp) {
		if (!Number.isSafeInteger(timestamp) || timestamp <= 0)
			return 'MOD_MP_LAST_SEEN_UNKNOWN';
		return Math.max(0, Date.now() - timestamp) < 60 * 60 * 1000
			? 'MOD_MP_LAST_SEEN_MINUTES'
			: 'MOD_MP_LAST_SEEN_HOURS';
	},

	get_last_seen_value(timestamp) {
		const elapsed = Math.max(0, Date.now() - timestamp);
		return elapsed < 60 * 60 * 1000
			? Math.max(1, Math.floor(elapsed / (60 * 1000)))
			: Math.max(1, Math.floor(elapsed / (60 * 60 * 1000)));
	},

	get_free_fellowship_search_placeholder() {
		return getLangString('MOD_MP_FREE_FELLOWSHIP_SEARCH');
	},

	get_shadowed_member_search_placeholder() {
		return getLangString('MOD_MP_GUILD_SEARCH_SHADOWED_MEMBERS');
	},

	format_chat_time(timestamp) {
		return new Date(timestamp).toLocaleString();
	},

	format_chat_datetime(timestamp) {
		return new Date(timestamp).toISOString();
	},

	get_chat_compose_placeholder() {
		return getLangString(this.selected_chat_conversation?.conversation_kind === 'support' || this.messaging_enabled
			? 'MOD_MP_CHAT_COMPOSE_PLACEHOLDER' : 'MOD_MP_CHAT_DISABLED');
	},

	get_chat_participant_icon(conversation = this.selected_chat_conversation) {
		return conversation?.participant?.icon_id === 'multiplayer'
			? this.get_svg('multiplayer') : this.get_avatar_icon(conversation?.participant?.icon_id);
	},

	get_chat_block_label() {
		return getLangString(this.selected_chat_conversation?.blocked ? 'MOD_MP_CHAT_UNBLOCK' : 'MOD_MP_CHAT_BLOCK');
	},

	get_chat_block_confirmation_info() {
		return getLangString(this.selected_chat_conversation?.blocked
			? 'MOD_MP_CHAT_UNBLOCK_CONFIRM_INFO' : 'MOD_MP_CHAT_BLOCK_CONFIRM_INFO');
	},

	get_pet_icon(id) {
		const pet = game.pets.getObjectByID(id);
		return pet?.media ?? 'assets/media/main/question.png';
	},

	close_modal() {
		unmount_connected_modal_components();
		Swal.close();
	},

	close_modal_and_wait(template_id) {
		return close_modal_and_wait(template_id);
	},

	close_account_dropdown() {
		close_account_dropdown();
	},
	// #endregion

	// #region CHAT ACTIONS
	open_chat_page() {
		this.close_account_dropdown();
		changePage(game.pages.getObjectByID('multiplayer:Chat'));
	},

	async start_member_chat(event) {
		const member = this.selected_guild_member;
		const $button = event.currentTarget;
		if (!member || member.client_id === this.guild_client_id || is_button_spinning($button))
			return;
		this.member_actions_error = '';
		show_button_spinner($button);
		let res = null;
		try {
			res = await api_post('/api/chat/conversations/start', { client_id: member.client_id });
		} catch (e) {
			log('Chat start failed (%s)', e);
		}
		hide_button_spinner($button);
		if (!res?.success) {
			this.member_actions_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			return;
		}
		this.selected_chat_conversation = { ...res.conversation, blocked: false };
		this.chat_messages = [];
		this.selected_chat_message = null;
		this.chat_has_more = false;
		this.close_modal();
		this.open_chat_page();
	},

	async open_chat_conversation(conversation) {
		const view_generation = ++chat_view_generation;
		this.selected_chat_conversation = conversation;
		this.chat_messages = [];
		this.selected_chat_message = null;
		this.chat_has_more = false;
		this.chat_before_cursor = null;
		this.chat_error = '';
		this.chat_messages_loading = false;
		this.chat_loading = false;
		await refresh_chat_messages('', false, false, view_generation);
		if (view_generation !== chat_view_generation ||
			this.selected_chat_conversation?.conversation_kind !== conversation.conversation_kind ||
			this.selected_chat_conversation?.conversation_id !== conversation.conversation_id ||
			this.selected_chat_conversation?.support_team_id !== conversation.support_team_id)
			return;
		start_chat_polling();
	},

	close_chat_conversation() {
		chat_view_generation++;
		this.selected_chat_conversation = null;
		this.chat_messages = [];
		this.selected_chat_message = null;
		this.chat_has_more = false;
		this.chat_before_cursor = null;
		this.chat_error = '';
		this.chat_messages_loading = false;
		stop_chat_polling();
	},

	show_chat_budget_modal() {
		queue_modal('MOD_MP_CHAT_BUDGET_INFO_TITLE', 'chat-budget-info-modal', this.get_item_icon('melvorD:Message_In_A_Bottle'), {
			showConfirmButton: false
		}, true, false);
	},

	show_chat_actions_modal() {
		const conversation = this.selected_chat_conversation;
		if (!conversation)
			return;
		queue_modal(conversation.participant.display_name, 'chat-actions-modal', this.get_avatar_icon(conversation.participant.icon_id), {
			showConfirmButton: false
		}, false, false);
	},

	show_chat_block_confirmation() {
		const conversation = this.selected_chat_conversation;
		if (!conversation)
			return;
		this.close_modal();
		setTimeout(() => queue_modal(this.get_chat_block_label(), 'chat-block-confirm-modal', this.get_avatar_icon(conversation.participant.icon_id), {
			showConfirmButton: false
		}, false, false), 0);
	},

	show_chat_delete_confirmation() {
		const conversation = this.selected_chat_conversation;
		if (!conversation)
			return;
		this.close_modal();
		setTimeout(() => queue_modal('MOD_MP_CHAT_DELETE_CONVERSATION', 'chat-delete-confirm-modal', this.get_avatar_icon(conversation.participant.icon_id), {
			showConfirmButton: false
		}, true, false), 0);
	},

	show_chat_message_actions(message) {
		if (!message)
			return;
		this.selected_chat_message = message;
		queue_modal('MOD_MP_CHAT_MESSAGE_ACTIONS', 'chat-message-actions-modal', this.get_avatar_icon(this.selected_chat_conversation?.participant.icon_id), {
			showConfirmButton: false
		}, true, false);
	},

	show_chat_message_delete_confirmation() {
		if (!this.selected_chat_message)
			return;
		this.close_modal();
		setTimeout(() => queue_modal('MOD_MP_CHAT_DELETE_MESSAGE_CONFIRM_TITLE', 'chat-message-delete-confirm-modal', this.get_avatar_icon(this.selected_chat_conversation?.participant.icon_id), {
			showConfirmButton: false
		}, true, false), 0);
	},

	async copy_chat_message() {
		const message = this.selected_chat_message;
		if (!message)
			return;
		const clipboard = globalThis.navigator?.clipboard;
		if (!clipboard?.writeText)
			return show_modal_error(getLangString('MOD_MP_CHAT_COPY_FAILED'));
		try {
			await clipboard.writeText(message.content);
		} catch (e) {
			log('Chat message copy failed (%s)', e);
			return show_modal_error(getLangString('MOD_MP_CHAT_COPY_FAILED'));
		}
		this.selected_chat_message = null;
		this.close_modal();
		notify('MOD_MP_CHAT_COPIED', 'success');
	},

	async load_older_chat_messages() {
		if (this.chat_before_cursor === null)
			return;
		await refresh_chat_messages('&before=' + this.chat_before_cursor, true);
	},

	handle_chat_keydown(event) {
		if (event.key !== 'Enter' || event.isComposing || event.shiftKey ||
			(typeof nativeManager !== 'undefined' && nativeManager.isMobile))
			return;
		event.preventDefault();
		void this.send_chat_message(event);
	},

	async send_chat_message(event) {
		event?.preventDefault();
		const conversation = this.selected_chat_conversation;
		const content = this.chat_draft.trim();
		if (!conversation || content.length === 0 || content.length > 1000 || this.chat_sending)
			return;
		this.chat_sending = true;
		this.chat_error = '';
		const pending = this.chat_pending_send;
		const idempotency_key = pending?.conversation_kind === conversation.conversation_kind &&
			pending?.conversation_id === conversation.conversation_id &&
			pending.support_team_id === conversation.support_team_id &&
			pending.client_id === conversation.participant.client_id && pending.content === content
			? pending.idempotency_key
			: crypto.randomUUID();
		this.chat_pending_send = {
			conversation_kind: conversation.conversation_kind ?? 'private',
			conversation_id: conversation.conversation_id,
			support_team_id: conversation.support_team_id,
			client_id: conversation.participant.client_id,
			content,
			idempotency_key
		};
		let res = null;
		try {
			res = await api_post('/api/chat/messages/send', {
				conversation_kind: conversation.conversation_kind ?? 'private',
				conversation_id: conversation.conversation_id,
				support_team_id: conversation.support_team_id,
				client_id: conversation.participant.client_id,
				idempotency_key,
				content
			});
		} catch (e) {
			log('Chat send failed (%s)', e);
		}
		if (res !== null)
			this.chat_pending_send = null;
		if (res?.success) {
			conversation.conversation_id = res.message.conversation_id;
			if (!this.chat_messages.some(message => message.message_id === res.message.message_id))
				this.chat_messages.push(res.message);
			if (res.budget)
				this.chat_budget = res.budget;
			this.chat_budget_enabled = res.budget_enabled !== false;
			this.chat_draft = '';
			await refresh_chat_conversations();
			start_chat_polling();
		} else {
			this.chat_error = getLangString(res?.error_lang ?? 'MOD_MP_CHAT_SEND_FAILED');
		}
		this.chat_sending = false;
	},

	async delete_chat_message(event) {
		const message = this.selected_chat_message;
		if (!message)
			return;
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;
		show_button_spinner($button);
		const res = await api_post('/api/chat/messages/delete', { message_id: message.message_id });
		if (!res?.success) {
			hide_button_spinner($button);
			return show_modal_error(getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR'));
		}
		this.chat_messages = this.chat_messages.filter(entry => entry.message_id !== message.message_id);
		this.selected_chat_message = null;
		this.close_modal();
		await refresh_chat_conversations();
	},

	async delete_chat_conversation(event) {
		const conversation = this.selected_chat_conversation;
		if (!conversation)
			return;
		if (conversation.conversation_id === null) {
			this.close_chat_conversation();
			this.close_modal();
			return;
		}
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;
		show_button_spinner($button);
		const res = await api_post('/api/chat/conversations/delete', {
			conversation_id: conversation.conversation_id
		});
		if (!res?.success) {
			hide_button_spinner($button);
			return show_modal_error(getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR'));
		}
		this.close_chat_conversation();
		this.close_modal();
		await refresh_chat_conversations();
	},

	async toggle_chat_block(event) {
		const conversation = this.selected_chat_conversation;
		if (!conversation)
			return;
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;
		show_button_spinner($button);
		const desired = !conversation.blocked;
		const res = await api_post('/api/chat/block', {
			client_id: conversation.participant.client_id,
			blocked: desired
		});
		if (!res?.success) {
			hide_button_spinner($button);
			return show_modal_error(getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR'));
		}
		conversation.blocked = res.blocked;
		this.close_modal();
		await refresh_chat_conversations();
	},

	async set_messaging_enabled(event) {
		if (this.chat_privacy_pending)
			return;
		event.preventDefault();
		this.chat_privacy_pending = true;
		this.member_actions_error = '';
		const desired = !this.messaging_enabled;
		const res = await api_post('/api/chat/privacy', { messaging_enabled: desired });
		if (res?.success)
			this.messaging_enabled = res.messaging_enabled;
		else
			this.member_actions_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
		this.chat_privacy_pending = false;
	},
	// #endregion

	// #region MARKET ACTIONS
	clear_market_filter() {
		this.market_filter_item = null;
		state.market_page_first(true);
	},

	choose_market_filter() {
		this.market_active_tab = 'filter';
		this.market_filter_search = '';

		if (!has_sorted_market_filter_items)
			load_market_filter_items();

		setTimeout(() => $('mp-market-filter-input').focus(), 1);
	},

	select_market_filter_item(item_id) {
		state.market_filter_item = item_id;
		state.market_active_tab = 'search';
		state.market_page_first(true);
	},

	show_market_buy_modal(item) {
		this.market_buy_item = item;

		const item_name = this.get_item_name(item.item_id);
		queue_modal(getLangString('MOD_MP_MARKET_BUY_MODAL_TITLE') + item_name, 'market-buy-modal', this.get_item_icon(item.item_id), {
			showConfirmButton: false
		}, false, false);
	},

	async buy_market_item(event) {
		const $button = event.currentTarget;

		if (is_button_spinning($button))
			return;

		if (!state.market_buy_item)
			return notify_error('MOD_MP_GENERIC_ERR');

		if (state.item_slider_value <= 0)
			return notify_error('MOD_MP_MARKET_BUY_NOTHING');

		const item = game.items.getObjectByID(state.market_buy_item.item_id);
		if (!item)
			return notify_error('MOD_MP_MARKET_BUY_ERROR_UNKNOWN');

		if (game.gp.amount < state.item_slider_value * state.market_buy_item.price)
			return notify_error('MOD_MP_MARKET_INSUFFICIENT_GP');

		show_button_spinner($button);

		const res = await api_post('/api/market/buy', {
			id: state.market_buy_item.id,
			qty: state.item_slider_value
		});

		if (res?.success) {
			add_bank_item(res.item_id, res.item_qty);
			game.gp.remove(res.gp_loss);

			if (res.new_item_qty > 0) {
				state.market_buy_item.available = res.new_item_qty;
			} else {
				remove_sold_out_market_result(state, state.market_buy_item.id, MARKET_ITEMS_PER_PAGE);
				await update_market_search();
			}
		} else {
			notify_error(res?.error_lang ?? 'MOD_MP_MARKET_BUY_ERROR');
		}

		hide_button_spinner($button);
		this.close_modal();
	},

	market_page(page) {
		const before = this.market_current_page;
		this.market_current_page = page;

		if (this.market_current_page !== before)
			update_market_search();
	},

	market_page_first(force_reload = false) {
		const before = this.market_current_page;
		this.market_current_page = 1;

		if (force_reload || this.market_current_page !== before)
			update_market_search();
	},

	market_page_prev() {
		const before = this.market_current_page;
		this.market_current_page = Math.max(this.market_current_page - 1, 1);

		if (this.market_current_page !== before)
			update_market_search();
	},

	market_page_next() {
		const before = this.market_current_page;
		this.market_current_page = Math.min(this.market_current_page + 1, this.market_page_count);

		if (this.market_current_page !== before)
			update_market_search();
	},

	market_page_last() {
		const before = this.market_current_page;
		this.market_current_page = this.market_page_count;

		if (this.market_current_page !== before)
			update_market_search();
	},

	toggle_market_sort() {
		state.market_sort_direction = state.market_sort_direction ^ 1;
		update_market_search();
	},

	open_market_tab() {
		this.market_active_tab = 'search';
	},

	open_listing_tab() {
		this.market_active_tab = 'listing';
		update_market_listings();
	},

	async resolve_market_listing(event, item, action) {
		const $button = event.currentTarget;

		if ($button.classList.contains('disabled') || is_button_spinning($button))
			return;
		if (item.unresolved && action !== 'destroy')
			return;
		if (action === 'destroy' && state.transfer_inventory.length >= TRANSFER_INVENTORY_MAX_LIMIT && item.available > 0)
			return notify_error('MOD_MP_TRANSFER_INVENTORY_FULL');
		if (action === 'destroy' && state.transfer_inventory.some(entry =>
			entry.id === item.item_id && entry.destroyable !== true
		))
			return notify_error('MOD_MP_TRANSFER_DESTROY_ITEM_FIRST');

		show_button_spinner($button);

		const res = await api_post('/api/market/' + action, { id: item.id });
		if (res?.success) {
			if (action === 'cancel' && res.item_qty > 0)
				add_bank_item(res.item_id, res.item_qty);
			else if (action === 'destroy' && res.item_qty > 0)
				add_destroyable_item_to_transfer_inventory(res.item_id, res.item_qty);

			if (res.payout > 0) {
				game.gp.add(res.payout);
				item.payout += res.payout;
			}

			if (action === 'cancel' || action === 'destroy' || res.ended) {
				state.market_listings = state.market_listings.filter(listing => listing.id !== item.id);
				state.market_completed = state.market_completed.filter(listing => listing !== item.id);
			}
		} else {
			notify_error('MOD_MP_GENERIC_ERR');
		}

		hide_button_spinner($button);
	},
	// #endregion

	// #region CAMPAIGN ACTIONS
	get_campaign_svg(id) {
		return this.get_svg(this.campaign_data[id]?.asset ?? 'campaign_placeholder')
	},

	get_current_campaign_svg() {
		return this.get_campaign_svg(this.campaign_id)
	},

	get_campaign_title(id) {
		return getLangString(this.campaign_data[id]?.name_lang ?? 'MOD_MP_CAMPAIGN_NAME_UNKNOWN');
	},

	get_current_campaign_title() {
		return this.get_campaign_title(this.campaign_id);
	},

	get_campaign_color(id) {
		return this.campaign_data[id]?.color_code ?? '#acacac';
	},

	get_current_campaign_color() {
		return this.get_campaign_color(this.campaign_id);
	},

	show_campaign_contribute_modal() {
		queue_modal('MOD_MP_CAMPAIGN_CONTRIBUTE', 'campaign-contribute-modal', this.campaign_item_icon, {
			showConfirmButton: false
		}, true, false);
	},

	async contribute_to_campaign(event) {
		if (!state.campaign_active || !state.campaign_has_data)
			return notify_error('MOD_MP_CAMPAIGN_CONTRIBUTE_ERR');

		const item_amount = state.item_slider_value;
		if (item_amount <= 0)
			return;

		const item = game.items.getObjectByID(state.campaign_item_id);
		const item_owned_qty = game.bank.getQty(item);

		if (item_owned_qty < item_amount)
			return notify_error('MOD_MP_CAMPAIGN_CONTRIBUTE_AMOUNT_ERR');

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/campaign/contribute', { item_amount });
		if (res?.success && res?.item_loss > 0) {
			const remove_item = game.items.getObjectByID(res.item_id);
			game.bank.removeItemQuantity(remove_item, res.item_loss);
			state.campaign_contribution += res.item_loss;
			state.campaign_pct = res.campaign_pct;

			update_campaign_nav();
			notify_item('MOD_MP_CAMPAIGN_CONTRIBUTED', 'success', remove_item, res.item_loss);
		} else {
			notify_error('MOD_MP_CAMPAIGN_CONTRIBUTE_ERR');
		}

		hide_button_spinner($button);
		this.close_modal();
	},

	async claim_campaign_reward(event, campaign) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		let reward_mod = 1.6;

		const campaign_pet = game.pets.getObjectByID(campaign.pet);
		if (game.petManager.unlocked.has(campaign_pet))
			reward_mod += 0.1;

		const reward_item = game.items.getObjectByID(campaign.item_id);
		const reward_value = (reward_item.sellsFor.quantity * campaign.item_amount) * reward_mod;

		const res = await api_post('/api/campaign/claim', { campaign_id: campaign.id, value: reward_value });
		if (res?.success) {
			game.gp.add(reward_value);
			campaign.taken = reward_value;
		} else {
			notify_error('MOD_MP_GENERIC_ERR');
		}

		hide_button_spinner($button);
	},

	get_campaign_ranking(campaign_id) {
		return this.campaign_rankings[campaign_id] ?? 0;
	},
	// #endregion

	// #region CHARITY ACTIONS
	async charity_take_item(event) {
		const item = this.charity_tree_inventory.find(e => e.id === state.selected_charity_item_id);
		if (!item)
			return notify_error('MOD_MP_CHARITY_INVALID_ITEM');
		if (!is_local_item_resolved(item.id))
			return notify_error('MOD_MP_CHARITY_UNKNOWN_ITEM');
		const take_block = this.get_charity_take_block(item);
		if (take_block !== null)
			return notify_error(this.get_charity_take_block_lang(take_block));
		const was_discovered = this.is_charity_item_discovered(item.id);

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/charity/take', {
			item_id: state.selected_charity_item_id,
			qty: this.get_charity_take_quantity(item)
		});

		if (res?.success) {
			add_bank_item(item.id, res.item_qty, !was_discovered);
			if (res.item_remaining_qty > 0) {
				state.charity_tree_inventory = state.charity_tree_inventory.map(entry => entry.id === item.id
					? { ...entry, qty: res.item_remaining_qty, expires_at: res.item_expires_at }
					: entry);
			} else {
				state.charity_tree_inventory = state.charity_tree_inventory.filter(e => e.id !== item.id);
			}
		} else {
			notify_error(res?.error_lang ?? 'MOD_MP_CHARITY_TAKEN');
		}

		if (res?.timeout !== undefined) {
			state.charity_timeout = res.timeout;
			set_instance_storage_item('charity_timeout', res.timeout);
		}

		if (res?.timeout_bonus !== undefined) {
			state.charity_bonus_timeout = res.timeout_bonus;
			set_instance_storage_item('charity_bonus_timeout', res.timeout_bonus);
		}

		hide_button_spinner($button);
	},

	is_charity_item_discovered(item_id) {
		if (item_id === 'melvorD:GP')
			return true;
		const item = game.items.getObjectByID(item_id);
		return item !== undefined && game.stats.itemFindCount(item) > 0;
	},

	get_charity_take_block(item) {
		return charitree_rules.get_charitree_take_block(item, {
			current_gp: game.gp.amount,
			gp_currency: game.gp,
			get_item: item_id => game.items.getObjectByID(item_id),
			get_sale_price: (game_item, qty) => game.bank.getItemSalePrice(game_item, qty),
			is_discovered: item_id => this.is_charity_item_discovered(item_id)
		});
	},

	get_charity_take_block_lang(block) {
		return 'MOD_MP_CHARITY_VALUE_LIMIT';
	},

	get_charity_take_block_text(block) {
		return getLangString(this.get_charity_take_block_lang(block));
	},

	get_charity_take_quantity(item) {
		return charitree_rules.get_charitree_take_quantity(item, {
			is_discovered: item_id => this.is_charity_item_discovered(item_id)
		});
	},

	format_charity_expiry(expires_at) {
		return charitree_rules.format_charitree_remaining(expires_at, this.charity_update_time);
	},

	async donate_items(event) {
		if (this.has_destroyable_transfer_items)
			return notify_error('MOD_MP_TRANSFER_DESTROY_ITEM_FIRST');

		const items = state.transfer_inventory;

		if (items.length === 0)
			return notify_error('MOD_MP_CHARITY_NO_SELECTION');

		if (has_local_unresolved_item(items, item => item.id))
			return notify_error('MOD_MP_CHARITY_UNKNOWN_ITEM');

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/charity/donate', { items });
		if (res?.success) {
			const donation_value = state.transfer_inventory_value_raw;

			clear_transfer_inventory();
			last_charity_check = 0;

			notify('MOD_MP_CHARITY_DONATED');

			// 0.1% + for every 10,000,000 worth of donation, % to get pet is +1%, capped at 10%
			const pet_pct = Math.min(0.1 + Math.floor(donation_value / 10000000) / 100, 0.1);
			if (Math.random() < pet_pct) {
				state.charity_bonus_unlocked = true;
				game.petManager.unlockPetByID('multiplayer:Multiplayer_Pet_Charity');
			}
		} else
			notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');

		hide_button_spinner($button);
	},
	// #endregion

	// #region TRADE ACTIONS
	async create_trade() {
		if (this.has_destroyable_transfer_items)
			return notify_error('MOD_MP_TRANSFER_DESTROY_ITEM_FIRST');

		if (state.transfer_inventory.length > 0) {
			await refresh_guild_state();
			queue_modal('MOD_MP_TITLE_SEND_TRADE_OFFER', 'create-trade-modal', 'assets/transfer_bag.svg', {
				showConfirmButton: false
			}, true);
		} else {
			notify_error('MOD_MP_TRANSFER_NO_ITEMS_ERR');
		}
	},

	async select_trade_recipient(recipient) {
		this.close_modal();

		const res = await api_post('/api/trade/offer', {
			recipient_id: recipient.client_id,
			items: state.transfer_inventory
		});

		if (res?.success) {
			clear_transfer_inventory();

			state.trades.push({
				trade_id: res.trade_id,
				state: 0,
				data: null
			});

			update_transfer_contents();
		}
	},

	get_trade_items_value(items) {
		let total_value = 0;

		for (const entry of items) {
			if (entry.item_id === 'melvorD:GP') {
				total_value += entry.qty;
			} else {
				const item = game.items.getObjectByID(entry.item_id);
				if (item?.sellsFor.currency === game.gp)
					total_value += game.bank.getItemSalePrice(item, entry.qty);
			}
		}

		return game.gp.formatAmount(numberWithCommas(total_value));
	},

	filter_trade_items_home(trade) {
		return trade.data.items.filter(item => item.counter === (trade.attending ? 0 : 1));
	},

	filter_trade_items_away(trade) {
		return trade.data.items.filter(item => item.counter === (trade.attending ? 1 : 0));
	},

	async counter_trade(event, trade_id) {
		const trade = state.trades.find(t => t.trade_id === trade_id);
		if (!trade)
			return;

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/trade/counter', {
			trade_id,
			items: state.transfer_inventory
		});

		hide_button_spinner($button);

		if (res?.success) {
			clear_transfer_inventory();

			state.trades = state.trades.filter(t => t.trade_id !== trade_id);

			// this needs to happen on the next tick to prevent petite-vue breaking
			// bug: https://github.com/vuejs/core/issues/5657 (element hoisting is not a good solution)
			setTimeout(() => {
				state.trades.push({
					trade_id,
					state: 1,
					attending: false,
					data: null
				});

				update_transfer_contents();
			}, 1);

		} else {
			notify_error('MOD_MP_GENERIC_ERR');
		}
	},

	async resolve_trade(event, trade_id) {
		// prevent resolving a trade with no local data
		const trade = state.resolved_trades.find(t => t.trade_id === trade_id);
		if (!trade?.data)
			return;

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/trade/resolve', { trade_id });

		hide_button_spinner($button);

		if (res?.success === true) {
			for (const item of trade.data.items)
				add_bank_item(item.item_id, item.qty);

			state.resolved_trades = state.resolved_trades.filter(trade => trade.trade_id !== trade_id);
		} else {
			notify_error('MOD_MP_GENERIC_ERR');
		}
	},

	async decline_trade(event, trade_id) {
		// prevent declining a trade with no local data
		const trade = state.trades.find(t => t.trade_id === trade_id);
		if (!trade?.data)
			return;

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/trade/decline', { trade_id });
		hide_button_spinner($button);

		if (res?.success === true) {
			state.trades = state.trades.filter(trade => trade.trade_id !== trade_id);
		} else {
			notify_error('MOD_MP_GENERIC_ERR');
		}
	},

	async accept_trade(event, trade_id) {
		// prevent accepting a trade with no local data
		const trade = state.trades.find(t => t.trade_id === trade_id);
		if (!trade?.data)
			return;

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/trade/accept', { trade_id });
		hide_button_spinner($button);

		if (res?.success === true) {
			const items = trade.data.items.filter(item => item.counter === 1);
			for (const item of items)
				add_bank_item(item.item_id, item.qty);

			state.trades = state.trades.filter(trade => trade.trade_id !== trade_id);
		} else {
			notify_error('MOD_MP_GENERIC_ERR');
		}
	},

	async cancel_trade(event, trade_id) {
		// prevent cancelling a trade with no local data
		const trade = state.trades.find(t => t.trade_id === trade_id);
		if (!trade?.data)
			return;

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/trade/cancel', { trade_id });
		hide_button_spinner($button);

		if (res?.success === true) {
			let items = trade.data.items;

			if (trade.state === 1)
				items = items.filter(item => item.counter === 1);

			for (const item of items)
				add_bank_item(item.item_id, item.qty);
			
			state.trades = state.trades.filter(trade => trade.trade_id !== trade_id);
		} else {
			notify_error('MOD_MP_GENERIC_ERR');
		}
	},
	// #endregion

	// #region GIFT ACTIONS
	is_returned_gift(gift) {
		return (gift.data.flags & GIFT_FLAG_RETURNED) !== 0;
	},

	async resolve_gift(event, gift_id, accept) {
		const $button = event.currentTarget;

		if (is_button_spinning($button))
			return;

		const gift = this.gifts.find(g => g.id === gift_id);
		if (gift === undefined)
			return notify_error('MOD_MP_GENERIC_ERR');

		show_button_spinner($button);

		const res = await api_post(accept ? '/api/gift/accept' : '/api/gift/decline', { gift_id });
		hide_button_spinner($button);

		if (res?.success) {
			if (accept) {
				for (const item of gift.data.items) {
					const check_item = game.items.getObjectByID(item.item_id);
					if (check_item)
						add_bank_item(item.item_id, item.qty);
				}
			}

			this.gifts = this.gifts.filter(g => g.id !== gift_id);
		} else {
			notify_error('MOD_MP_GENERIC_ERR');
		}
	},

	async gift_friend() {
		if (this.has_destroyable_transfer_items)
			return notify_error('MOD_MP_TRANSFER_DESTROY_ITEM_FIRST');

		if (state.transfer_inventory.length > 0) {
			await refresh_guild_state();
			queue_modal('MOD_MP_TITLE_SEND_GIFT', 'gift-friend-modal', 'assets/media/bank/present.png', {
				showConfirmButton: false
			}, true, false);
		} else {
			notify_error('MOD_MP_TRANSFER_NO_ITEMS_ERR');
		}
	},

	select_gift_recipient(recipient) {
		this.close_modal();

		state.gifting_recipient = recipient;

		queue_modal('MOD_MP_TITLE_CONFIRM_GIFT_RECIPIENT', 'confirm-gift-recipient-modal', 'assets/media/bank/present.png', {
			showConfirmButton: false
		}, true, false);
	},

	async confirm_gift(event) {
		const $button = event.currentTarget;

		if (is_button_spinning($button))
			return;

		show_button_spinner($button);
		const recipient_id = state.gifting_recipient.client_id;

		const res = await api_post('/api/gift/send', {
			recipient_id,
			items: state.transfer_inventory
		});

		try {
			if (res === null)
				throw new Error('MOD_MP_GENERIC_ERR');

			if (res.error_lang)
				throw new Error(res.error_lang);
		} catch (e) {
			hide_button_spinner($button);
			return show_modal_error(getLangString(e.message));
		}

		hide_button_spinner($button);

		clear_transfer_inventory();

		notify('MOD_MP_NOTIF_GIFT_SENT');
		state.close_modal();
	},
	// #endregion

	// #region TRANSFER ACTIONS
	get_transfer_value(transfer) {
		if (transfer.data === null)
			return '...';

		let total_value = 0;

		for (const entry of transfer.data.items) {
			if (entry.item_id === 'melvorD:GP') {
				total_value += entry.qty;
			} else {
				const item = game.items.getObjectByID(entry.item_id);
				if (item?.sellsFor.currency === game.gp)
					total_value += game.bank.getItemSalePrice(item, entry.qty);
			}
		}

		return game.gp.formatAmount(numberWithCommas(total_value));
	},

	async open_transfer_data_page() {
		state.close_account_dropdown();
		await open_transfer_page({
			refresh_events: () => get_client_events(false),
			refresh_guild: refresh_guild_state,
			update_contents: update_transfer_contents,
			navigate: () => changePage(game.pages.getObjectByID('multiplayer:Transfer_Items'))
		});
	},

	async open_market_page(tab_id) {
		state.close_account_dropdown();
		changePage(game.pages.getObjectByID('multiplayer:Multiplayer_Market'));
		state.market_active_tab = tab_id;
		await update_market_page();
	},

	open_guild_page() {
		this.close_account_dropdown();
		changePage(game.pages.getObjectByID('multiplayer:Guild'));
	},

	open_raid_page() {
		this.close_account_dropdown();
		changePage(game.pages.getObjectByID('multiplayer:Guild_Raid'));
	},

	format_raid_time(timestamp) {
		if (!Number.isSafeInteger(timestamp))
			return '';
		const remaining = timestamp - this.raid_update_time;
		if (remaining <= 0)
			return 'now';
		const hours = Math.floor(remaining / 3_600_000);
		const minutes = Math.ceil((remaining % 3_600_000) / 60_000);
		return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
	},

	get_raid_monster_icon(tier) {
		return ctx.getResourceUrl('assets/raid_plant_t1.png');
	},

	get_raid_tier_progress(tier) {
		return [0, 1000, 1800, 3000, 4500][tier] ?? 0;
	},

	async activate_raid() {
		if (this.raid_action_pending)
			return;
		this.raid_action_pending = true;
		this.raid_error = '';
		const res = await api_post('/api/raids/activate', {});
		if (res?.success)
			await refresh_raid_state();
		else
			this.raid_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
		this.raid_action_pending = false;
	},

	async begin_raid_assault(tier) {
		if (!this.raid_can_assault || raid_combat === null)
			return;
		if (!raid_combat.has_full_hitpoints(game.combat.player)) {
			this.raid_error = getLangString('MOD_MP_RAID_FULL_HP_REQUIRED');
			return;
		}
		this.raid_action_pending = true;
		this.raid_error = '';
		try {
			const reserve = () => api_post('/api/raids/assaults/reserve', {
				tier,
				loaded_session_id: raid_loaded_session_id
			});
			let reservation = await reserve();
			if (reservation?.error_lang === 'MOD_MP_RAID_ASSAULT_PENDING' && !raid_combat.has_active()) {
				const abandoned = await api_post('/api/raids/assaults/abandon', {});
				if (!abandoned?.success)
					throw new Error('MOD_MP_RAID_START_FAILED');
				reservation = await reserve();
			}
			if (typeof reservation?.assault_id !== 'string')
				throw new Error(reservation?.error_lang ?? 'MOD_MP_RAID_START_FAILED');
			raid_combat.start(reservation);
			await refresh_raid_state();
		} catch (e) {
			this.raid_error = getLangString(e?.message?.startsWith('MOD_') ? e.message : 'MOD_MP_RAID_START_FAILED');
			error('failed to begin Raid Assault (%s)', e);
		}
		this.raid_action_pending = false;
	},

	async show_options_modal() {
		this.close_account_dropdown();
		await refresh_identities();
		const member = this.guild_members.find(entry => entry.client_id === this.guild_client_id) ?? {
			client_id: this.guild_client_id,
			display_name: this.profile_display_name,
			icon_id: this.profile_icon,
			equipment_visible: this.equipment_visible,
			equipment_available: false,
			status_visible: this.status_visible,
			status_available: false,
			gp_visible: this.gp_visible,
			gp: null,
			last_seen_at: null
		};
		this.show_member_actions(member);
	},

	open_identities_from_options() {
		this.close_modal();
		setTimeout(() => this.show_identities_modal(), 0);
	},

	show_identities_modal() {
		this.selected_identity = null;
		queue_modal('MOD_MP_IDENTITIES_TITLE', 'identities-modal', 'assets/multiplayer.svg', {
			showConfirmButton: false
		});
	},

	show_identity_actions(identity) {
		this.selected_identity = identity;
		this.close_modal();
		setTimeout(() => queue_modal(identity.display_name, 'identity-actions-modal',
			this.get_avatar_icon(identity.icon_id), { showConfirmButton: false }, false, false), 0);
	},

	back_to_identities() {
		this.close_modal();
		setTimeout(() => this.show_identities_modal(), 0);
	},

	show_identity_deletion_confirmation() {
		this.close_modal();
		setTimeout(() => queue_modal('MOD_MP_IDENTITY_DELETE_CONFIRM_TITLE', 'identity-delete-confirm-modal',
			'assets/multiplayer.svg', { showConfirmButton: false }), 0);
	},

	format_identity_time(timestamp) {
		return new Date(timestamp).toLocaleString();
	},

	async schedule_identity_deletion(event) {
		if (!this.selected_identity || is_button_spinning(event.currentTarget))
			return;
		show_button_spinner(event.currentTarget);
		let res = null;
		try {
			res = await api_post('/api/identities/delete', { client_id: this.selected_identity.client_id });
		} catch (e) {
			error('failed to schedule identity deletion (%s)', e);
		}
		if (!res?.success) {
			hide_button_spinner(event.currentTarget);
			return show_modal_error(getLangString('MOD_MP_GENERIC_ERR'));
		}
		await refresh_identities();
		this.close_modal();
		setTimeout(() => this.show_identities_modal(), 0);
	},

	async cancel_identity_deletion(event) {
		if (!this.selected_identity || is_button_spinning(event.currentTarget))
			return;
		show_button_spinner(event.currentTarget);
		let res = null;
		try {
			res = await api_post('/api/identities/delete/cancel', { client_id: this.selected_identity.client_id });
		} catch (e) {
			error('failed to cancel identity deletion (%s)', e);
		}
		if (!res?.success) {
			hide_button_spinner(event.currentTarget);
			return show_modal_error(getLangString('MOD_MP_GENERIC_ERR'));
		}
		await refresh_identities();
		this.close_modal();
		setTimeout(() => this.show_identities_modal(), 0);
	},

	show_member_actions(member) {
		this.selected_guild_member = member;
		this.member_actions_error = '';
		queue_modal(member.display_name, 'member-actions-modal', this.get_avatar_icon(member.icon_id), {
			showConfirmButton: false
		}, false, false);
	},

	open_display_name_from_options() {
		this.close_modal();
		setTimeout(() => this.show_display_name_modal(), 0);
	},

	open_icon_from_options() {
		this.close_modal();
		setTimeout(() => this.show_icon_modal(), 0);
	},

	leave_guild_from_options() {
		this.close_modal();
		setTimeout(() => this.confirm_leave_guild(), 0);
	},

	async set_equipment_visibility(event) {
		if (this.equipment_visibility_pending)
			return;
		event.preventDefault();
		const desired = !this.equipment_visible;
		this.equipment_visibility_pending = true;
		this.member_actions_error = '';
		let res = null;
		try {
			res = await api_post('/api/client/equipment/visibility', { visible: desired });
		} catch (e) {
			log('equipment visibility update failed (%s)', e);
		}
		if (res?.success) {
			this.equipment_visible = res.visible;
			if (this.selected_guild_member?.client_id === this.guild_client_id)
				this.selected_guild_member.equipment_visible = res.visible;
			if (res.visible) {
				last_synced_equipment = null;
				schedule_equipment_sync(0);
			} else {
				last_synced_equipment = null;
			}
		} else {
			this.member_actions_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
		}
		this.equipment_visibility_pending = false;
	},

	async set_status_visibility(event) {
		if (this.status_visibility_pending)
			return;
		event.preventDefault();
		const desired = !this.status_visible;
		this.status_visibility_pending = true;
		this.member_actions_error = '';
		let res = null;
		try {
			res = await api_post('/api/client/status/visibility', { visible: desired });
		} catch (e) {
			log('player status visibility update failed (%s)', e);
		}
		if (res?.success) {
			this.status_visible = res.visible;
			if (this.selected_guild_member?.client_id === this.guild_client_id)
				this.selected_guild_member.status_visible = res.visible;
			last_synced_status_skills = null;
			last_synced_status_activity = null;
			if (res.visible) {
				start_status_observer();
				schedule_status_sync(0);
			} else if (!this.gp_visible) {
				stop_status_observer();
			}
		} else {
			this.member_actions_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
		}
		this.status_visibility_pending = false;
	},

	async set_gp_visibility(event) {
		if (this.gp_visibility_pending)
			return;
		event.preventDefault();
		const desired = !this.gp_visible;
		this.gp_visibility_pending = true;
		this.member_actions_error = '';
		let res = null;
		try {
			res = await api_post('/api/client/gp/visibility', { visible: desired });
		} catch (e) {
			log('GP visibility update failed (%s)', e);
		}
		if (res?.success) {
			this.gp_visible = res.visible;
			if (this.selected_guild_member?.client_id === this.guild_client_id) {
				this.selected_guild_member.gp_visible = res.visible;
				if (!res.visible)
					this.selected_guild_member.gp = null;
			}
			last_synced_gp = null;
			last_observed_gp = null;
			if (res.visible) {
				start_status_observer();
				schedule_status_sync(0);
			} else if (!this.status_visible) {
				stop_status_observer();
			}
		} else {
			this.member_actions_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
		}
		this.gp_visibility_pending = false;
	},

	async view_member_profile(event) {
		const member = this.selected_guild_member;
		const $button = event.currentTarget;
		if (!member || is_button_spinning($button))
			return;
		this.member_actions_error = '';
		show_button_spinner($button);
		let equipment_res = null;
		let status_res = null;
		try {
			[equipment_res, status_res] = await Promise.all([
				api_get('/api/guilds/equipment?client_id=' + member.client_id),
				api_get('/api/guilds/status?client_id=' + member.client_id)
			]);
		} catch (e) {
			log('player profile fetch failed (%s)', e);
		}
		hide_button_spinner($button);
		const equipment = Array.isArray(equipment_res?.slots) ? equipment_res.slots : null;
		const status = Array.isArray(status_res?.skills) && status_res.activity?.type !== undefined ? status_res : null;
		if (equipment === null && status === null) {
			this.member_actions_error = getLangString(equipment_res?.error_lang ?? status_res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			return;
		}

		this.viewed_equipment = equipment;
		this.viewed_status = status;
		this.profile_active_tab = 'skills';
		this.close_modal();
		setTimeout(() => queue_modal(member.display_name, 'profile-modal', this.get_avatar_icon(member.icon_id), {
			showConfirmButton: false,
			width: 'min(95vw, 760px)',
			customClass: { popup: 'mp-profile-modal-popup' },
			didClose: () => {
				this.viewed_equipment = null;
				this.viewed_status = null;
			}
		}, false, false), 0);
	},

	async add_gp_to_transfer() {
		add_gp_to_transfer(state.add_gp_value);
		this.close_modal();
	},

	show_add_gp_modal() {
		queue_modal('MOD_MP_TITLE_ADD_GP', 'add-gp-modal', 'assets/media/main/coins.png', {
			showConfirmButton: false
		}, true, false);
	},

	transfer_return_selected() {
		return_selected_transfer_inventory();
	},

	transfer_return_all() {
		return_all_transfer_inventory();
	},

	transfer_destroy_selected() {
		destroy_selected_transfer_inventory();
	},
	// #endregion

	// #region DISPLAY NAME ACTIONS
	async confirm_display_name(event) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		const display_name = this.display_name_input.trim();
		if (display_name.length === 0)
			return show_modal_error(getLangString('MOD_MP_DISPLAY_NAME_REQUIRED_ERR'));

		if (display_name.length > 20)
			return show_modal_error(getLangString('MOD_MP_DISPLAY_NAME_TOO_LONG_ERR'));

		hide_modal_error();
		show_button_spinner($button);

		const res = await api_post('/api/client/set_display_name', { display_name });

		hide_button_spinner($button);
		if (res?.success) {
			this.profile_display_name = res.display_name;
			this.close_modal();
		} else {
			show_modal_error(getLangString('MOD_MP_GENERIC_ERR'));
		}
	},

	show_display_name_modal() {
		this.close_account_dropdown();
		this.display_name_input = this.profile_display_name;

		queue_modal('MOD_MP_TITLE_DISPLAY_NAME', 'change-display-name-modal', this.get_avatar_icon(this.profile_icon), {
			showConfirmButton: false
		}, true, false);
	},
	// #endregion

	// #region ICON PICK ACTIONS
	pick_icon(icon) {
		this.picked_icon = icon.id;

		const $image = document.querySelector('.swal2-image');

		if ($image)
			$image.src = icon.media;
	},

	async confirm_icon_pick(event) {
		if (this.picked_icon === '')
			return;

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/client/set_icon', { icon_id: this.picked_icon });
		if (res?.success)
			this.profile_icon = this.picked_icon;

		hide_button_spinner($button);
		this.close_modal();
	},

	show_icon_modal() {
		this.close_account_dropdown();
		setup_icons();

		state.picked_icon = '';

		queue_modal(game.characterName, 'change-icon-modal', this.get_avatar_icon(state.profile_icon), {
			showConfirmButton: false
		}, false, false);
	},
	// #endregion

	// #region GUILD ACTIONS
	pick_guild_icon(icon) {
		this.picked_guild_icon = icon.id;
		this.guild_page_error = '';
	},

	join_free_fellowship(event, guild) {
		this.selected_free_fellowship = guild;
		queue_modal('MOD_MP_FREE_FELLOWSHIP_CONFIRM_TITLE', 'free-fellowship-confirm-modal', this.get_guild_icon(guild.icon_id), {
			showConfirmButton: false
		}, true, false);
	},

	async confirm_join_free_fellowship(event) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;
		show_button_spinner($button);
		const res = await api_post('/api/guilds/join-free', {});
		hide_button_spinner($button);
		if (!res?.success)
			return show_modal_error(getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR'));

		this.close_modal();
		this.selected_free_fellowship = null;
		await refresh_guild_page();
		notify('MOD_MP_FREE_FELLOWSHIP_JOINED', 'success');
	},

	async join_guild(event, guild) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;
		show_button_spinner($button);
		const res = await api_post('/api/guilds/join', { guild_id: guild.guild_id });
		hide_button_spinner($button);
		if (!res?.success)
			return notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');

		await refresh_guild_page();
		notify('MOD_MP_GUILD_JOINED', 'success');
	},

	search_guild_members() {
		return refresh_guild_members(0, this.guild_member_search);
	},

	load_more_guild_members() {
		return refresh_guild_members(this.guild_member_directory_page + 1, this.guild_member_search, true);
	},

	async show_shadowed_members_modal() {
		this.shadowed_member_search = '';
		this.shadowed_members = [];
		await refresh_shadowed_members();
		queue_modal('MOD_MP_GUILD_SHADOWED_MEMBERS', 'shadowed-members-modal', 'assets/single_user.svg', {
			showConfirmButton: false
		});
	},

	search_shadowed_members() {
		return refresh_shadowed_members(0, this.shadowed_member_search);
	},

	load_more_shadowed_members() {
		return refresh_shadowed_members(
			this.shadowed_member_directory_page + 1,
			this.shadowed_member_search,
			true
		);
	},

	open_shadowed_member_actions(member) {
		this.close_modal();
		setTimeout(() => this.show_member_actions(member), 0);
	},

	async create_guild(event) {
		const name = this.guild_name_input.trim();
		if (name.length === 0)
			return this.guild_page_error = getLangString('MOD_MP_GUILD_NAME_REQUIRED');
		if (name.length > 20)
			return this.guild_page_error = getLangString('MOD_MP_GUILD_NAME_TOO_LONG');
		if (this.picked_guild_icon === '')
			return this.guild_page_error = getLangString('MOD_MP_GUILD_ICON_REQUIRED');

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;
		this.guild_page_error = '';
		show_button_spinner($button);

		const res = await api_post('/api/guilds/create', {
			name,
			icon_id: this.picked_guild_icon
		});
		hide_button_spinner($button);

		if (!res?.success) {
			this.guild_page_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			return;
		}

		this.guild_name_input = '';
		this.guild_icon_search = '';
		this.picked_guild_icon = '';
		await refresh_guild_state();
		notify('MOD_MP_GUILD_CREATED', 'success');
	},

	async apply_to_guild(event, guild) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;
		show_button_spinner($button);
		const res = await api_post('/api/guilds/apply', { guild_id: guild.guild_id });
		hide_button_spinner($button);

		if (!res?.success)
			return notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');

		await refresh_guild_state();
		notify('MOD_MP_GUILD_APPLICATION_SENT', 'success');
	},

	async withdraw_guild_application(event) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;
		show_button_spinner($button);
		const res = await api_post('/api/guilds/withdraw', {});
		hide_button_spinner($button);

		if (!res?.success)
			return notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');

		await refresh_guild_page();
		notify('MOD_MP_GUILD_APPLICATION_WITHDRAWN');
	},

	async decide_guild_application(event, application, approve) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;
		show_button_spinner($button);
		const res = await api_post('/api/guilds/application/decide', {
			application_id: application.application_id,
			approve
		});
		hide_button_spinner($button);

		if (!res?.success)
			return notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');

		this.guild_applicants = this.guild_applicants.filter(
			applicant => applicant.application_id !== application.application_id
		);
		this.events.guild_applicants = this.events.guild_applicants.filter(
			applicant => applicant.application_id !== application.application_id
		);
		if (approve)
			await refresh_guild_state();
	},

	async show_raise_petition_modal() {
		this.council_error = '';
		await refresh_council();
		queue_modal('MOD_MP_COUNCIL_RAISE', 'council-raise-modal', 'assets/multiplayer.svg', {
			showConfirmButton: false
		});
	},

	show_council_petition_modal(type) {
		this.close_modal();
		this.council_type = type;
		this.council_error = '';
		this.council_name_input = '';
		this.council_icon_search = '';
		this.council_picked_icon = '';
		setup_guild_icons();
		const template = type === 'appellation'
			? 'council-appellation-modal'
			: type === 'heraldry'
				? 'council-heraldry-modal'
				: type === 'banishment'
					? 'council-banishment-modal'
					: 'council-action-modal';
		queue_modal(getLangString('MOD_MP_COUNCIL_RAISE_PREFIX') + this.get_council_type_lang(type), template, 'assets/multiplayer.svg', {
			showConfirmButton: false
		}, false);
	},

	toggle_resolved_council_petitions() {
		this.council_show_resolved = !this.council_show_resolved;
	},

	pick_council_icon(icon) {
		this.council_picked_icon = icon.id;
		this.council_error = '';
	},

	async submit_council_petition(event, type, target_client_id = null) {
		const payload = { type };
		if (type === 'appellation') {
			const name = this.council_name_input.trim();
			if (name.length === 0)
				return this.council_error = getLangString('MOD_MP_GUILD_NAME_REQUIRED');
			if (name.length > 20)
				return this.council_error = getLangString('MOD_MP_GUILD_NAME_TOO_LONG');
			payload.name = name;
		} else if (type === 'heraldry') {
			if (this.council_picked_icon === '')
				return this.council_error = getLangString('MOD_MP_GUILD_ICON_REQUIRED');
			payload.icon_id = this.council_picked_icon;
		} else if (type === 'banishment') {
			payload.target_client_id = target_client_id;
		}

		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;
		show_button_spinner($button);
		const res = await api_post('/api/guilds/petitions/raise', payload);
		hide_button_spinner($button);
		if (!res?.success)
			return this.council_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');

		this.close_modal();
		await refresh_council();
	},

	async vote_council_petition(event, petition, choice) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;
		show_button_spinner($button);
		const res = await api_post('/api/guilds/petitions/vote', {
			petition_id: petition.petition_id,
			choice
		});
		hide_button_spinner($button);
		if (!res?.success)
			return notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
		invalidate_guild_state();
		await Promise.all([refresh_guild_state(), refresh_council()]);
	},

	async withdraw_council_petition(event, petition) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;
		show_button_spinner($button);
		const res = await api_post('/api/guilds/petitions/withdraw', {
			petition_id: petition.petition_id
		});
		hide_button_spinner($button);
		if (!res?.success)
			return notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
		await refresh_council();
	},

	get_council_type_lang(type) {
		return getLangString('MOD_MP_COUNCIL_TYPE_' + type.toUpperCase());
	},

	can_raise_council_petition(type) {
		return this.council_available_petition_types.includes(type);
	},

	get_council_action_key(type) {
		return type.startsWith('charitree_') ? type.replace('charitree_', '').toUpperCase() : type.toUpperCase();
	},

	get_council_action_confirm(type) {
		return getLangString('MOD_MP_COUNCIL_' + this.get_council_action_key(type) + '_CONFIRM');
	},

	get_council_action_proposal(type) {
		return getLangString('MOD_MP_COUNCIL_' + this.get_council_action_key(type) + '_PROPOSAL');
	},

	get_council_outcome_lang(lifecycle) {
		return getLangString('MOD_MP_COUNCIL_OUTCOME_' + lifecycle.toUpperCase());
	},

	get_council_choice_lang(choice) {
		return getLangString(choice === 'aye' ? 'MOD_MP_COUNCIL_AYE' : 'MOD_MP_COUNCIL_NAY');
	},

	get_council_execution_lang(execution_state) {
		return execution_state === 'failed'
			? getLangString('MOD_MP_COUNCIL_ACTION_DELAYED')
			: getLangString('MOD_MP_COUNCIL_ACTION_PENDING');
	},

	get_council_tally_width(petition, choice) {
		if (!petition.tally || petition.tally.eligible === 0)
			return '0%';
		return (petition.tally[choice] / petition.tally.eligible * 100) + '%';
	},

	async load_more_council_petitions(event) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;
		show_button_spinner($button);
		await refresh_council(this.council_resolved_page + 1, true);
		hide_button_spinner($button);
	},

	confirm_leave_guild() {
		queue_modal('MOD_MP_TITLE_LEAVE_GUILD', 'leave-guild-modal', 'assets/multiplayer.svg', {
			showConfirmButton: false
		});
	},

	async leave_guild(event) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;
		show_button_spinner($button);
		const res = await api_post('/api/guilds/leave', {});
		hide_button_spinner($button);

		if (!res?.success)
			return show_modal_error(getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR'));

		await this.close_modal_and_wait('leave-guild-modal');
		await refresh_guild_page();
		notify('MOD_MP_GUILD_LEFT');
	},
	// #endregion

	// #region FRIEND REQ ACTIONS
	async accept_friend_request(event, request) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/friends/accept', {
			request_id: request.request_id
		});

		hide_button_spinner($button);

		if (res?.success === true) {
			state.events.friend_requests.splice(state.events.friend_requests.indexOf(request), 1);

			if (res.friend)
				state.friends.push(res.friend);
		} else {
			notify_error('MOD_MP_GENERIC_ERR');
		}
	},

	async ignore_friend_request(event, request) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);

		const res = await api_post('/api/friends/ignore', {
			request_id: request.request_id
		});

		hide_button_spinner($button);

		if (res?.success === true) {
			state.events.friend_requests.splice(state.events.friend_requests.indexOf(request), 1);
		} else {
			notify_error('MOD_MP_GENERIC_ERR');
		}
	},

	async show_friend_request_modal() {
		state.close_account_dropdown();
		await get_client_events();
		queue_modal('MOD_MP_TITLE_FRIEND_REQUESTS', 'friend-request-modal');
	},
	// #endregion

	// #region FRIEND LIST ACTIONS
	remove_friend_prompt(friend) {
		this.close_modal();

		state.removing_friend = friend;

		queue_modal('MOD_MP_TITLE_REMOVE_FRIEND_CONFIRM', 'remove-friend-modal', 'assets/remove_friend.svg', {
			showConfirmButton: false
		});
	},

	async remove_friend($event) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		show_button_spinner($button);
		const friend_id = state.removing_friend.friend_id;

		const res = await api_post('/api/friends/remove', { friend_id });

		if (res?.success) {
			state.friends = state.friends.filter(f => f.friend_id !== friend_id);
			notify('MOD_MP_NOTIF_FRIEND_REMOVED');
		}

		hide_button_spinner($button);
		state.close_modal();
	},

	async show_friends_modal() {
		state.close_account_dropdown();
		await get_friends();
		queue_modal('MOD_MP_TITLE_FRIENDS', 'friends-modal');
	},
	// #endregion

	// #region FRIEND ACTIONS
	show_friend_code_modal() {
		state.close_account_dropdown();
		state.friend_code = get_instance_storage_item('friend_code');

		queue_modal('MOD_MP_TITLE_FRIEND_CODE', 'friend-code-modal');
	},

	show_add_friend_modal() {
		state.close_account_dropdown();

		queue_modal('MOD_MP_TITLE_ADD_FRIEND', 'add-friend-modal', 'assets/add_user.svg', {
			showConfirmButton: false
		});
	},

	async add_friend(event) {
		const $button = event.currentTarget;
		if (is_button_spinning($button))
			return;

		hide_modal_error();
		show_button_spinner($button);

		const friend_code = $('mp-add-friend-modal-field').value.trim();

		try {
			if (!/^\d{3}-\d{3}-\d{3}$/.test(friend_code))
				throw new Error('MOD_MP_INVALID_FRIEND_CODE_ERR');

			const client_friend_code = get_instance_storage_item('friend_code');
			if (friend_code === client_friend_code)
				throw new Error('MOD_MP_NO_SELF_LOVE_ERR');

			const res = await api_post('/api/friends/add', { friend_code });
			if (res === null)
				throw new Error('MOD_MP_GENERIC_ERR');

			if (res.error_lang)
				throw new Error(res.error_lang);
		} catch (e) {
			hide_button_spinner($button);
			return show_modal_error(getLangString(e.message));
		}

		hide_button_spinner($button);

		notify('MOD_MP_NOTIF_FRIEND_REQ_SENT');
		state.close_modal();
	},
	// #endregion
});

// #region COMMON FUNCTIONS
function queue_modal(title_lang, template_id, image_url = 'assets/multiplayer.svg', data = {}, localize_title = true, get_image = true) {
	if (!modal_queue_guard.reserve(template_id)) {
		log('ignored duplicate modal request (%s)', template_id);
		return;
	}

	const modal_options = Object.assign({
		title: localize_title ? getLangString(title_lang) : title_lang,
		html: modal_component(template_id),
		imageUrl: get_image ? ctx.getResourceUrl(image_url) : image_url,
		imageWidth: 64,
		imageHeight: 64,
		allowOutsideClick: true,
		backdrop: true
	}, data);

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

function get_first_game_object(value) {
	if (value instanceof Set || Array.isArray(value))
		return value.values().next().value ?? null;
	return value ?? null;
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

function capture_status_activity() {
	const active_action = game.activeAction;
	const is_alt_magic = active_action === game.altMagic;
	if (!is_alt_magic && (active_action === game.combat || active_action?.isCombat === true)) {
		const area_id = get_game_object_id(active_action.selectedArea ?? active_action.combatArea ?? active_action.area);
		return { type: 'combat', area_id };
	}

	if (active_action?.isActive === true) {
		const skill_id = get_game_object_id(active_action);
		let action = null;
		try {
			action = active_action.masteryAction;
		} catch (e) {
			// Some skills throw while their current selection is incomplete.
		}
		if (action === null || action === undefined) {
			for (const property of [
				'activeTree', 'activeTrees', 'activeRecipe', 'activeFish', 'currentNPC',
				'selectedRock', 'selectedRecipe', 'studiedConstellation', 'activeObstacle', 'activeMap'
			]) {
				let candidate = null;
				try {
					candidate = active_action[property];
					action = get_first_game_object(candidate);
				} catch (e) {
					action = null;
				}
				if (action !== null && action !== undefined)
					break;
			}
		}
		const action_id = get_game_object_id(action);
		if (skill_id !== null && action_id !== null)
			return { type: 'skill', skill_id, action_id };
	}

	return { type: 'idle' };
}

function capture_status_snapshot() {
	return {
		skills: capture_status_skills(),
		activity: capture_status_activity(),
		gp: capture_gp()
	};
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
	const payload = {};
	if (state.status_visible && serialized_skills !== last_synced_status_skills)
		payload.skills = snapshot.skills;
	if (state.status_visible && serialized_activity !== last_synced_status_activity)
		payload.activity = snapshot.activity;
	if (state.gp_visible && snapshot.gp !== null && snapshot.gp !== last_synced_gp)
		payload.gp = snapshot.gp;
	if (payload.skills === undefined && payload.activity === undefined && payload.gp === undefined)
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
		if (payload.skills !== undefined)
			last_synced_status_skills = serialized_skills;
		if (payload.activity !== undefined)
			last_synced_status_activity = serialized_activity;
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

	const serialized = state.status_visible ? serialize_status_activity(capture_status_activity()) : null;
	const gp = state.gp_visible ? capture_gp() : null;
	if (serialized === last_observed_status_activity && gp === last_observed_gp)
		return;

	last_observed_status_activity = serialized;
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
		item_sell_price
	});

	if (res?.success) {
		game.bank.removeItemQuantity(item, item_qty);
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

	const res = await api_get('/api/market/listings');
	state.market_listings = (res?.items ?? []).map(item => ({
		...item,
		unresolved: !is_local_item_resolved(item.item_id)
	}));
	state.market_listings_loading = false;
}

async function update_market_search() {
	if (state.market_search_loading)
		return;

	state.market_search_loading = true;

	const data = {
		page: state.market_current_page,
		sort: state.market_sort_direction,
		item_namespaces: get_local_item_namespaces()
	};

	if (state.market_filter_item !== null)
		data.item_id = state.market_filter_item;

	const res = await api_post('/api/market/search', data);
	if (res?.success) {
		const visible_items = filter_local_resolved_items(res.items, item => item.item_id);
		const page = paginate_market_results(visible_items, state.market_current_page, MARKET_ITEMS_PER_PAGE);
		state.market_current_page = page.current_page;
		state.market_total_items = page.total_items;
		state.market_results = page.items;
	} else {
		state.market_results = [];
		state.market_total_items = 0;
	}

	state.market_search_loading = false;
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

	state.campaign_loading = false;
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
		aside.textContent = 'Inactive';
}

function update_charitree_nav() {
	const nav_item = sidebar.category('Multiplayer').item('multiplayer:Charity_Tree');
	nav_item.rootEl?.classList.toggle('d-none', state.is_guild_member && !state.is_charitree_enabled);
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

	if (!state.is_guild_member)
		return;

	if (state.charity_tree_loading)
		return;

	const current_time = Date.now();
	if (!force_reload && current_time < last_charity_check + CHARITY_CHECK_TIMEOUT)
		return;

	last_charity_check = current_time;
	state.charity_tree_loading = true;

	const res = await api_get('/api/charity/contents');
	if (Array.isArray(res?.items))
		state.charity_tree_inventory = filter_local_resolved_items(res.items, item => item.id);

	state.charity_tree_loading = false;
}

function update_charity_clock() {
	state.charity_update_time = Date.now();
	state.charity_tree_inventory = state.charity_tree_inventory.filter(
		item => !Number.isSafeInteger(item.expires_at) || item.expires_at > state.charity_update_time
	);
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
	if (has_local_unresolved_item(gift_data.items, item => item.item_id)) {
		gift.data = null;

		if ((gift_data.flags & GIFT_FLAG_RETURNED) === 0) {
			const returned = await api_post('/api/gift/decline', { gift_id: gift.id });
			return returned?.success === true;
		}

		return false;
	}

	gift.data = gift_data;
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

	state.is_updating_transfer_contents = false;
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

			add_bank_item(selected_id, entry.qty);
			state.transfer_inventory = state.transfer_inventory.filter(e => e.id !== selected_id);
			state.selected_transfer_item_id = '';

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
	set_instance_storage_item('transfer_inventory', state.transfer_inventory);
}

function clear_transfer_inventory() {
	state.transfer_inventory = [];
	persist_transfer_inventory();
	update_transfer_inventory_nav();
}

function load_transfer_inventory() {
	const stored = get_instance_storage_item('transfer_inventory');
	state.transfer_inventory = stored ?? [];
	update_transfer_inventory_nav();
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

			const stored_claim_ids = get_instance_storage_item('processed_banishment_claim_ids');
			const processed_claim_ids = Array.isArray(stored_claim_ids) ? stored_claim_ids : [];
			if (apply_banishment_claim(
				state.transfer_inventory,
				processed_claim_ids,
				claim,
				TRANSFER_INVENTORY_MAX_LIMIT
			)) {
				persist_transfer_inventory();
				set_instance_storage_item('processed_banishment_claim_ids', processed_claim_ids);
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
	const res = await fetch(server_host + cache_bust_api_endpoint(endpoint), {
		method: 'GET',
		headers: {
			'X-Session-Token': session_token ?? undefined
		}
	});

	if (res.status === 200)
		return res.json();

	return null;
}

async function api_post_response(endpoint, payload) {
	const res = await fetch(server_host + endpoint, {
		method: 'POST',
		body: JSON.stringify(payload),
		headers: {
			'Content-Type': 'application/json',
			'X-Session-Token': session_token ?? undefined
		}
	});
	let json = null;
	if (res.headers.get('Content-Type')?.includes('application/json')) {
		try {
			json = await res.json();
		} catch (e) {
			error('failed to parse API response for %s (%s)', endpoint, e);
		}
	}
	return { response: res, json };
}

async function api_post(endpoint, payload) {
	const result = await api_post_response(endpoint, payload);
	if (result.response.status === 200) {
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
	last_synced_gp = null;
	last_observed_status_activity = null;
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
	state.chat_client_id = res.client_id;
	state.chat_budget_enabled = res.budget_enabled !== false;
	if (res.budget)
		state.chat_budget = res.budget;
}

async function refresh_chat_conversations() {
	const res = await api_get('/api/chat/conversations');
	if (!Array.isArray(res?.conversations))
		return;
	state.chat_conversations = res.conversations;
	state.chat_unread = res.conversations.reduce((total, conversation) => total + conversation.unread_count, 0);
	update_chat_nav();
	if (state.selected_chat_conversation) {
		const current = res.conversations.find(conversation =>
			(conversation.conversation_kind ?? 'private') ===
				(state.selected_chat_conversation.conversation_kind ?? 'private') &&
			conversation.conversation_id === state.selected_chat_conversation.conversation_id &&
			conversation.support_team_id === state.selected_chat_conversation.support_team_id
		);
		if (current)
			state.selected_chat_conversation = current;
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
		return;
	const kind = conversation.conversation_kind ?? 'private';
	if (kind === 'private' && conversation.conversation_id === null)
		return;
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
	} catch (e) {
		log('Chat message refresh failed (%s)', e);
	}
	if (view_generation !== chat_view_generation ||
		state.selected_chat_conversation?.conversation_id !== conversation_id ||
		state.selected_chat_conversation?.support_team_id !== conversation.support_team_id)
		return;
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
	if (!quiet)
		state.chat_messages_loading = false;
}

async function refresh_chat_page() {
	const view_generation = ++chat_view_generation;
	state.chat_loading = true;
	await Promise.all([refresh_chat_state(), refresh_chat_conversations()]);
	if (state.selected_chat_conversation)
		await refresh_chat_messages('', false, false, view_generation);
	if (view_generation !== chat_view_generation)
		return;
	state.chat_loading = false;
	start_chat_polling();
}

function stop_chat_polling() {
	chat_poll_id++;
}

function start_chat_polling() {
	stop_chat_polling();
	if (!chat_page_visible || !state.selected_chat_conversation?.conversation_id || !polling.is_foreground(document))
		return;
	const poll_id = chat_poll_id;
	setTimeout(() => poll_chat_messages(poll_id), polling.chat_poll_delay());
}

async function poll_chat_messages(poll_id) {
	if (poll_id !== chat_poll_id || !chat_page_visible || !polling.is_foreground(document))
		return;
	const view_generation = chat_view_generation;
	if (view_generation === chat_view_generation && state.selected_chat_conversation)
		await refresh_chat_messages('&after=' + state.chat_latest_message_id, false, true, view_generation);
	if (poll_id === chat_poll_id && chat_page_visible && state.selected_chat_conversation && polling.is_foreground(document))
		setTimeout(() => poll_chat_messages(poll_id), polling.chat_poll_delay());
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
	let res = null;
	try {
		res = await api_get('/api/guilds/state');
	} catch (e) {
		error('failed to refresh Guild state (%s)', e);
	}

	if (refresh_id !== guild_state_refresh_id || refresh_generation !== session_generation)
		return null;

	state.guild_state_loading = false;
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
		gp: Number.isSafeInteger(member.gp) && member.gp >= 0 ? member.gp : null,
		last_seen_at: Number.isSafeInteger(member.last_seen_at) && member.last_seen_at > 0 ? member.last_seen_at : null
	}));
	state.guild_member_search = res.member_directory?.search ?? '';
	state.guild_member_directory_page = res.member_directory?.page ?? 0;
	state.guild_member_directory_has_more = res.member_directory?.has_more === true;
	state.guild_applicants = res.applicants ?? [];
	state.guild_client_id = res.current_client_id ?? null;
	state.events.guild_applicants = state.guild_applicants;
	update_charitree_nav();

	if (res.affiliation !== 'member') {
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
}

async function refresh_guild_members(page = 0, search = state.guild_member_search, append = false) {
	if (!state.is_guild_member || !state.is_free_fellowship || state.guild_member_directory_loading)
		return;
	state.guild_member_directory_loading = true;
	const res = await api_get('/api/guilds/members?page=' + page + '&search=' + encodeURIComponent(search));
	if (res !== null) {
		const members = (res.members ?? []).map(member => ({
			...member,
			status_activity: member.status_activity ?? null,
			gp: Number.isSafeInteger(member.gp) && member.gp >= 0 ? member.gp : null,
			last_seen_at: Number.isSafeInteger(member.last_seen_at) && member.last_seen_at > 0 ? member.last_seen_at : null
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
	state.guild_member_directory_loading = false;
}

async function refresh_shadowed_members(page = 0, search = state.shadowed_member_search, append = false) {
	if (!state.is_guild_member || state.shadowed_member_directory_loading)
		return;
	state.shadowed_member_directory_loading = true;
	const res = await api_get('/api/guilds/members/shadowed?page=' + page + '&search=' + encodeURIComponent(search));
	if (res !== null) {
		const members = (res.members ?? []).map(member => ({
			...member,
			status_activity: member.status_activity ?? null,
			gp: Number.isSafeInteger(member.gp) && member.gp >= 0 ? member.gp : null,
			last_seen_at: Number.isSafeInteger(member.last_seen_at) && member.last_seen_at > 0 ? member.last_seen_at : null
		}));
		state.shadowed_members = append
			? [...state.shadowed_members, ...members.filter(member =>
				!state.shadowed_members.some(existing => existing.client_id === member.client_id))]
			: members;
		state.shadowed_member_search = res.search ?? search;
		state.shadowed_member_directory_page = res.page ?? page;
		state.shadowed_member_directory_has_more = res.has_more === true;
	}
	state.shadowed_member_directory_loading = false;
}

async function refresh_guild_list() {
	const res = await api_get('/api/guilds/list');
	state.guilds = res?.guilds ?? [];
}

async function refresh_guild_page() {
	setup_guild_icons();
	const guild_state = await refresh_guild_state();

	if (state.is_guild_member)
		await refresh_council();
	else if (guild_state?.affiliation === 'none')
		await refresh_guild_list();
}

async function refresh_raid_state() {
	state.raid_update_time = Date.now();
	state.raid_loading = true;
	const res = await api_get('/api/raids/state');
	if (res !== null) {
		state.raid_state = res;
		if (res.cache_pending)
			void reconcile_raid_cache();
	}
	state.raid_loading = false;
	return res;
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
	state.council_loading = false;
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
	const res = await api_get('/api/events?revision=' + client_event_revision);
	if (res !== null) {
		if (Number.isSafeInteger(res.revision))
			client_event_revision = res.revision;
		if (res.unchanged === true)
			return res;
		client_events_have_pending = polling.has_pending_events(res);
		invalidate_guild_state();
		state.events.friend_requests = res.friend_requests;
		state.events.guild_applicants = res.guild_applicants ?? [];
		state.market_completed = res.market_completed;
		const previous_chat_unread = state.chat_unread;
		state.chat_unread = res.chat_unread ?? 0;
		update_chat_nav();
		if (chat_page_visible && state.chat_unread !== previous_chat_unread)
			await refresh_chat_conversations();

		for (const trade of res.trades) {
			// .trade_id, .attending, .state
			const cache_trade = state.trades.find(e => e.trade_id === trade.trade_id);
			if (cache_trade) {
				if (cache_trade.state !== trade.state) {
					// remove the existing trade from trades
					state.trades = state.trades.filter(e => e.trade_id !== trade.trade_id);

					setTimeout(() => {
						state.trades.push({
							trade_id: cache_trade.trade_id,
							state: trade.state,
							attending: trade.attending,
							data: null
						});
					}, 1);
				}
			} else {
				state.trades.push(Object.assign({ data: null }, trade));
			}
		}

		for (const trade_id of res.resolved_trades) {
			if (!state.resolved_trades.some(e => e.trade_id === trade_id))
				state.resolved_trades.push({ trade_id, data: null });
		}
		
		for (const gift_id of res.gifts) {
			if (!state.gifts.some(e => e.id === gift_id))
				state.gifts.push({ id: gift_id, data: null });
		}

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
	if (state.is_connected && polling.is_foreground(document))
		void poll_client_events(poll_id);
}

async function poll_client_events(poll_id) {
	await get_client_events();
	if (poll_id === client_event_poll_id && polling.is_foreground(document))
		setTimeout(() => poll_client_events(poll_id), polling.event_poll_delay(client_events_have_pending));
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
	const server_config = await ctx.loadModule('server-config.mjs');
	polling = await ctx.loadModule('polling.mjs');
	identity_bindings = await ctx.loadModule('identity-bindings.mjs');
	instance_storage = await ctx.loadModule('instance-storage.mjs');
	item_visibility = await ctx.loadModule('item-visibility.mjs');
	charitree_rules = await ctx.loadModule('charitree-rules.mjs');
	modal_queue_guard = new ModalQueueGuard(template_id =>
		document.querySelector(`mp-modal-component[data-template-id="${template_id}"]`) !== null
	);
	modal_component_registry = new ModalComponentRegistry(template_id => {
		const component = document.createElement('mp-modal-component');
		component.setAttribute('data-template-id', template_id);
		return component;
	});
	open_transfer_page = transfer_page.open_transfer_page;
	remove_sold_out_market_result = market_results.remove_sold_out_market_result;
	paginate_market_results = market_results.paginate_market_results;
	apply_banishment_claim = banishment_returns.apply_banishment_claim;
	resolve_server_config = server_config.resolve_server_config;
	get_custom_server_validation_error = server_config.get_custom_server_validation_error;
	custom_server_max_length = server_config.CUSTOM_SERVER_MAX_LENGTH;
	const raid_controller = new raid_module.RaidCombatController({
		storage: {
			get: () => get_instance_storage_item('raid_terminal_result') ?? null,
			set: terminal => set_instance_storage_item('raid_terminal_result', terminal),
			remove: () => remove_instance_storage_item('raid_terminal_result')
		},
		settle: async terminal => {
			const result = await api_post_response('/api/raids/assaults/settle', terminal);
			if (result.response.status === 200)
				return result.json;
			if ([404, 409].includes(result.response.status)) {
				log('discarding terminal Raid Assault result after final server response %d', result.response.status);
				return { success: true };
			}
			if (result.response.status === 410)
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

	server_settings_section = ctx.settings.section('Connection');
	server_settings_section.add({
		type: 'text',
		name: 'custom-server',
		label: 'Custom server',
		hint: 'Optional HTTPS server origin. Clear this field to use the default server. Changes apply after a full game reload.',
		default: '',
		maxLength: custom_server_max_length,
		onChange(value) {
			return get_custom_server_validation_error(value) ?? true;
		}
	});

	await patch_localization(ctx);
	await ctx.loadTemplates('ui/templates.html');
	document.addEventListener('visibilitychange', handle_runtime_visibility_change);

	await load_pets(ctx);
	await ctx.gameData.addPackage('data.json');

	load_campaign_data(ctx);

	ctx.onCharacterLoaded(() => {
		raid_combat.clear_loaded_combat();
		raid_loaded_session_id = crypto.randomUUID();
		apply_server_configuration();
		start_multiplayer_session();
		load_transfer_inventory();

		state.charity_timeout = get_instance_storage_item('charity_timeout') ?? 0;
		state.charity_bonus_timeout = get_instance_storage_item('charity_bonus_timeout') ?? 0;

		state.charity_bonus_unlocked = has_pet_by_id('Multiplayer_Pet_Charity');
	});
	ctx.onCharacterSelectionLoaded(() => raid_combat?.abandon());

	sidebar.category('Multiplayer', { before: 'Combat', toggleable: true });
	
	ctx.onInterfaceReady(() => {
		interface_ready = true;
		setup_account_menu();

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
		}, true);
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

function setup_icons() {
	if (state.available_icons.length === 0) {
		state.available_icons = [...game.monsters.registeredObjects].map(entry => {
			const monster = entry[1];
			return {
				id: monster.id,
				search_name: monster.name.toLowerCase(),
				media: monster.media
			};
		}).filter(icon => icon.id.startsWith('melvorF:') || icon.id.startsWith('melvorD:'));
	}
}

function setup_guild_icons() {
	if (state.guild_icons.length > 0)
		return;

	state.guild_icons = [...game.combatAreas.registeredObjects].map(entry => {
		const area = entry[1];
		return {
			id: area.id,
			search_name: area.name.toLowerCase(),
			media: area.media
		};
	}).filter(icon => icon.id.startsWith('melvorF:') || icon.id.startsWith('melvorD:'));
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
	const lang_supported = ['en'];

	const fetch_mod_localization = async (lang) => {
		const fetch_lang = lang_supported.includes(lang) ? lang : 'en';

		try {
			const patch_lang = await ctx.loadData('data/lang/' + fetch_lang + '.json');
			for (const [key, value] of Object.entries(patch_lang))
				loadedLangJson[key] = value;
		} catch (e) {
			error('Failed to patch localization for %s (%s)', fetch_lang, e);
		}
	};

	const orig_fetchLanguageJSON = globalThis.fetchLanguageJSON;
	globalThis.fetchLanguageJSON = async (lang) => {
		await orig_fetchLanguageJSON(lang);
		await fetch_mod_localization(lang);
	}

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
			...account
		});
		if (auth.response.status === 200 && auth.json !== null) {
			if (account !== null)
				store_account_identity_binding(account, { ...credentials, friend_code: auth.json.friend_code });
			activate_multiplayer_identity(auth.json);
			if (auth.json.deletion_cancelled)
				queue_identity_notice('deletion_cancelled', auth.json.deletion_cancelled);
			if (auth.json.identity_recovered)
				queue_identity_notice('recovered');
			return;
		}

		if (auth.response.status === 409 && auth.json?.identity_status === 'melvor_account_mismatch' &&
			account !== null && using_legacy_credentials) {
			await register_multiplayer_identity(account, true);
			return;
		}

		notify_error('MOD_MP_MULTIPLAYER_CONNECTION_ERR');
		error('failed to authenticate client (%d), multiplayer features not available', auth.response.status);
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
		...account
	});
	if (registration.response.status !== 200 || registration.json === null) {
		notify_error('MOD_MP_MULTIPLAYER_CONNECTION_ERR');
		error('failed to register client (%d), multiplayer features not available', registration.response.status);
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
	state.gp_visible = response.gp_visible !== false;
	state.messaging_enabled = response.chat?.messaging_enabled !== false;
	state.chat_client_id = response.chat?.client_id ?? null;
	state.chat_budget_enabled = response.chat?.budget_enabled !== false;
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

// #region COMPONENTS
class MPModalComponent extends HTMLElement {
	constructor() {
		super();
		this.template_app = null;
		this.disconnect_waiters = [];
	}

	connectedCallback() {
		if (this.template_app !== null)
			return;

		const template_id = this.getAttribute('data-template-id');
		modal_queue_guard.release(template_id);
		this.template_app = mount_modal_template(template_id, this);
	}

	disconnectedCallback() {
		this.unmountTemplate();
		for (const resolve of this.disconnect_waiters)
			resolve();
		this.disconnect_waiters = [];
	}

	whenDisconnected() {
		if (!this.isConnected)
			return Promise.resolve();
		return new Promise(resolve => this.disconnect_waiters.push(resolve));
	}

	unmountTemplate() {
		if (this.template_app === null)
			return;
		this.template_app.unmount();
		this.template_app = null;
		this.replaceChildren();
	}
}

class LangStringFormattedElement extends HTMLElement {
	constructor() {
		super();
	}

	connectedCallback() {
		this.updateTranslation();
	}

	updateTranslation() {
		const lang_id = this.getAttribute('lang-id');
		
		if (lang_id === null) {
			this.textContent = 'Language ID Undefined';
			return;
		}

		let translated_string = getLangString(`${lang_id}`);
		
		const format_args = [];
		let i = 1;
		while (this.hasAttribute(`lang-arg-${i}`)) {
			format_args.push(this.getAttribute(`lang-arg-${i}`));
			i++;
		}

		if (format_args.length > 0)
			translated_string = this.formatString(translated_string, format_args);
		
		this.textContent = translated_string;
	}

	formatString(str, args) {
		return str.replace(/%s/g, () => args.shift() || '');
	}

	attributeChangedCallback(name, oldValue, newValue) {
		this.updateTranslation();
	}

	static get observedAttributes() {
		return ['lang-id', ...Array.from({length: 10}, (_, i) => `lang-arg-${i+1}`)];
	}
}

class MPItemIcon extends HTMLElement {
	constructor() {
		super();
	}

	createUnsupportedItemTooltip() {
		return `<div class="text-center">
				<div class="media d-flex align-items-center push">
					<div class="mr-3">
						<img class="bank-img m-1" src="assets/media/main/question.png">
					</div>
					<div class="media-body">
						<div class="font-w600 text-danger">Unsupported Item</div>
						<div role="separator" class="dropdown-divider m-0 mb-1"></div>
						<small class="text-info">This item will not be added to your inventory.</small>
					</div>
				</div>
		</div>`;
	}

	createGPTooltip() {
		return `<div class="text-center">
				<div class="media d-flex align-items-center push">
					<div class="mr-3">
						<img class="bank-img m-1" src="assets/media/main/coins.png">
					</div>
					<div class="media-body">
						<div class="font-w600">Gold (GP)</div>
						<div role="separator" class="dropdown-divider m-0 mb-1"></div>
						<small class="text-info">The currency of Melvor!</small>
					</div>
				</div>
		</div>`;
	}

	connectedCallback() {
		const item_id = this.getAttribute('data-item-id');
		this.item = game.items.getObjectByID(item_id);

		this.tooltip = tippy(this, {
			content: '',
			placement: 'top',
			allowHTML: true,
			interactive: false,
			animation: false,
			touch: 'hold',
			onShow: (instance) => {
				if (item_id === 'melvorD:GP')
					instance.setContent(this.createGPTooltip());
				else if (this.item !== undefined)
					instance.setContent(createItemInformationTooltip(this.item));
				else
					instance.setContent(this.createUnsupportedItemTooltip());
			}
		});
	}

	disconnectedCallback() {
		this.tooltip?.destroy();
	}
}

class MPEquipmentItem extends HTMLElement {
	connectedCallback() {
		const item = game.items.getObjectByID(this.getAttribute('data-item-id'));
		if (item === undefined)
			return;
		this.tooltip = tippy(this, {
			content: '',
			placement: 'top',
			allowHTML: true,
			interactive: false,
			animation: false,
			touch: 'hold',
			onShow: instance => instance.setContent(createItemInformationTooltip(item))
		});
	}

	disconnectedCallback() {
		this.tooltip?.destroy();
	}
}

class MPGPSlider extends HTMLElement {
	constructor() {
		super();

		state.add_gp_value = 1;

		const $input = document.createElement('input');
		$input.type = 'text';

		this.appendChild($input);

		this.slider = new BankRangeSlider($input);

		this.slider.sliderMax = game.gp.amount;
		this.slider.sliderMin = 1;

		this.slider.sliderInstance.update({
			min: 1,
			max: game.gp.amount
		});

		const $value = document.createElement('input');
		$value.classList.add('form-control', 'mt-2');
		$value.type = 'number';
		$value.value = 1;

		$value.addEventListener('input', () => this.slider.setSliderPosition($value.value));
		this.slider.customOnChange = (amount) => {
			$value.value = amount;
			state.add_gp_value = amount;
		};

		this.appendChild($value);
	}
}

class MPItemSlider extends HTMLElement {
	constructor() {
		super();

		const max = this.getMax();
		state.item_slider_value = 0;

		const $input = document.createElement('input');
		$input.type = 'text';

		this.appendChild($input);

		this.slider = new BankRangeSlider($input);

		this.slider.sliderMax = max;
		this.slider.sliderMin = 0;

		this.slider.sliderInstance.update({
			min: 0,
			max
		});

		const $value = document.createElement('input');
		$value.classList.add('form-control', 'mt-2');
		$value.type = 'number';
		$value.value = 0;

		$value.addEventListener('input', () => this.slider.setSliderPosition($value.value));
		this.slider.customOnChange = (amount) => {
			$value.value = amount;
			state.item_slider_value = amount;
		};

		this.appendChild($value);
	}

	getMax() {
		const item_id = this.getAttribute('data-item-id');
		return parseInt(this.getAttribute('data-max') ?? game.bank.getQty(game.items.getObjectByID(item_id)));	
	}

	attributeChangedCallback(name, oldValue, newValue) {
		const max = this.getMax();

		this.slider.sliderMax = max;
		this.slider.sliderMin = 0;

		this.slider.sliderInstance.update({
			min: 0,
			max: max
		});
	}

	static get observedAttributes() {
		return ['data-item-id', 'data-max'];
	}
}

window.customElements.define('mp-lang-string-f', LangStringFormattedElement);
window.customElements.define('mp-modal-component', MPModalComponent);
window.customElements.define('mp-item-icon', MPItemIcon);
window.customElements.define('mp-equipment-item', MPEquipmentItem);
window.customElements.define('mp-gp-slider', MPGPSlider);
window.customElements.define('mp-item-slider', MPItemSlider);
// #endregion
