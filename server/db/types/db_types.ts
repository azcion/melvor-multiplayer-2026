export type campaign_state = {
	id: number;
	guild_id: number;
	campaign_id: string;
	item_id: string;
	item_amount: number;
	item_current: number;
	required_contributors: number;
	auto_contribution: number;
	campaign_next: number;
	complete: number;
};

export type charity_items = {
	guild_id: number;
	item_id: string;
	qty: number;
	expires_at: number;
};

export type client_sessions = {
	session_token: string,
	client_id: number
};

export type clients = {
	id: number,
	client_identifier: string,
	client_key: string,
	friend_code: string,
	display_name: string,
	icon_id: string,
	last_charity: number,
	last_bonus_charity: number,
	disabled: number,
	equipment_visible: number,
	status_visible: number,
	gp_visible: number,
	messaging_enabled: number,
	messaging_credits: number,
	messaging_refill_at: number,
	melvor_account_id: number | null,
	manual_melvor_account_link: number,
	deleted_at: number | null,
	last_multiplayer_active_at: number,
	event_revision: number
};

export type guild_raids = {
	id: number;
	guild_id: number;
	started_at: number;
	expires_at: number;
	active_member_count: number;
	required_contributors: number;
	max_health: number;
	remaining_health: number;
	secured_at: number | null;
};

export type guild_raid_roster = {
	raid_id: number;
	membership_id: number;
	client_id: number;
	contribution: number;
	highest_tier: number;
	successful_assaults: number;
	manual_assaults_remaining: number | null;
};

export type melvor_accounts = {
	id: number;
	cloud_username: string;
	playfab_id: string;
	created_at: number;
};

export type client_deletion_requests = {
	id: number;
	target_client_id: number;
	requester_client_id: number;
	requested_at: number;
	execute_at: number;
	cancelled_at: number | null;
	executed_at: number | null;
};

export type client_deletion_returns = {
	id: number;
	request_id: number;
	client_id: number;
	source_display_name: string;
	gp: number;
	created_at: number;
	completed_at: number | null;
};

export type client_deletion_return_items = {
	return_id: number;
	item_id: string;
	qty: number;
};

export type client_deletion_return_claims = {
	id: string;
	return_id: number;
	client_id: number;
	gp: number;
	created_at: number;
	acknowledged_at: number | null;
};

export type chat_conversations = {
	id: number;
	participant_low_id: number;
	participant_high_id: number;
	created_at: number;
};

export type chat_participants = {
	conversation_id: number;
	client_id: number;
	conversation_hidden: number;
	hidden_through_message_id: number;
};

export type chat_messages = {
	id: number;
	conversation_id: number;
	sender_id: number;
	idempotency_key: string;
	content: string;
	created_at: number;
};

export type chat_message_deletions = {
	message_id: number;
	client_id: number;
	deleted_at: number;
};

export type chat_message_reads = {
	message_id: number;
	client_id: number;
	read_at: number;
};

export type chat_blocks = {
	blocker_id: number;
	blocked_id: number;
	created_at: number;
};

export type equipment_snapshots = {
	client_id: number;
};

export type equipment_snapshot_items = {
	client_id: number;
	slot_id: string;
	item_id: string;
};

export type status_snapshots = {
	client_id: number;
	activity_type: 'idle' | 'skill' | 'combat';
	activity_skill_id: string | null;
	activity_action_id: string | null;
	activity_area_id: string | null;
};

export type status_snapshot_skills = {
	client_id: number;
	skill_id: string;
	level: number;
};

export type gp_snapshots = {
	client_id: number;
	amount: number;
};

export type service_settings = {
	key: string;
	value: string;
};

export type friend_requests = {
	request_id: number,
	client_id: number,                   
	friend_id: number
};

export type friends = {
	client_id_a: number;
	client_id_b: number;
};

export type gift_items = {
	id: number;
	gift_id: number;
	item_id: string;
	qty: number;
};

export type gifts = {
	gift_id: number;
	client_id: number;
	sender_id: number;
	flags: number;
};

export type guilds = {
	id: number;
	type: 'private' | 'free_fellowship';
	name: string;
	icon_id: string;
	charitree_enabled: number;
};

export type guild_memberships = {
	id: number;
	client_id: number;
	guild_id: number;
};

export type guild_petitions = {
	id: number;
	guild_id: number;
	guild_name: string;
	type: 'appellation' | 'heraldry' | 'banishment' | 'charitree_ingratitude' |
		'charitree_sacrilege' | 'charitree_beneficence';
	conflict_subject: string;
	subject_locked: number;
	petitioner_id: number;
	proposed_name: string | null;
	proposed_icon_id: string | null;
	target_client_id: number | null;
	target_membership_id: number | null;
	charitree_expires_before: number | null;
	created_at: number;
	expires_at: number;
	resolved_at: number | null;
	lifecycle: 'active' | 'granted' | 'denied' | 'lapsed' | 'withdrawn';
	execution_state: 'not_applicable' | 'pending' | 'running' | 'succeeded' | 'failed';
	execution_attempts: number;
	execution_last_attempt_at: number | null;
	execution_failure_category: string | null;
	execution_failure_message: string | null;
	execution_effect: string | null;
};

export type guild_petition_voters = {
	petition_id: number;
	client_id: number;
};

export type guild_petition_votes = {
	petition_id: number;
	client_id: number;
	choice: 'aye' | 'nay';
	submitted_at: number;
};

export type guild_applications = {
	id: number;
	client_id: number;
	guild_id: number;
};

export type resolved_trade_offers = {
	trade_id: number;
	client_id: number;
	sender_id: number;
	declined: number;
};

export type trade_items = {
	id: number;
	trade_id: number;
	item_id: string;
	qty: number;
	counter: number;
};

export type trade_offers = {
	trade_id: number;
	sender_id: number;
	recipient_id: number;
	attending_id: number;
	state: number;
};

export type campaign_contributions = {
	campaign_id: number;
	client_id: number;
	item_amount: number;
	taken: number;
};

export type market_items = {
	id: number;
	guild_id: number;
	client_id: number;
	item_id: string;
	qty: number;
	available: number;
	price: number;
	payout: number;
};

export type banishment_returns = {
	id: number;
	petition_id: number;
	client_id: number;
	guild_id: number;
	guild_name: string;
	notice_pending: number;
	gp: number;
	created_at: number;
	completed_at: number | null;
};

export type banishment_return_items = {
	return_id: number;
	item_id: string;
	qty: number;
};

export type banishment_return_claims = {
	id: string;
	return_id: number;
	client_id: number;
	gp: number;
	includes_notice: number;
	created_at: number;
	acknowledged_at: number | null;
};

export type banishment_return_claim_items = {
	claim_id: string;
	item_id: string;
	qty: number;
};
