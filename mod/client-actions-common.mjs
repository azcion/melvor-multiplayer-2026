const BUNDLED_SKILL_ICON_ASSETS = Object.freeze({
	'adventuring:Adventuring': 'skill_adventuring.svg',
	'enchanting:Enchanting': 'skill_enchanting.png',
	'invention:Invention': 'skill_invention.png',
	'kru_archaeology:Archaeology': 'skill_archaeology.svg',
	'mythMusic:Music': 'skill_music.png',
	'namespace_profile:Profile': 'skill_profile.svg',
	'namespace_thuum:Thuum': 'skill_thuum.png',
	'necromancy:Necromancy': 'skill_necromancy.png',
	'occultism:Occultism': 'skill_occultism.png',
	'rielkConstruction:Construction': 'skill_construction.png',
	'sailing:Sailing': 'skill_sailing.png',
	'shamanism:Shamanism': 'skill_shamanism.png'
});

export function install_common_actions(runtime) {
	const {
		state,
		SUPPORT_TEAM_ICON_ASSETS,
		ctx,
		game,
		game_mode_sharing,
		client_runtime,
		close_account_dropdown,
		close_modal_and_wait,
		getLangString,
		numberWithCommas,
		format_status_account_age,
		get_icon_object_by_id,
		is_official_game_id,
		Swal,
		unmount_connected_modal_components,
	} = runtime;

	return {
		get_svg(id) {
			return ctx.getResourceUrl('assets/' + id + '.svg');
		},

		get_svg_url(id) {
			return 'url(' + this.get_svg(id) + ')';
		},

		get_item_icon(id) {
			const currency = game.currencies?.getObjectByID(id);
			if (currency !== undefined)
				return currency.media;

			const item = game.items.getObjectByID(id);
			return item?.media ?? 'assets/media/main/question.png';
		},

		get_item_name(id) {
			const currency = game.currencies?.getObjectByID(id);
			if (currency !== undefined)
				return currency.name;

			const item = game.items.getObjectByID(id);
			return item?.name ?? 'Unknown Item';
		},

		get_avatar_icon(id) {
			const icon_object = get_icon_object_by_id(game.monsters, id) ??
				get_icon_object_by_id(game.thieving?.actions, id) ??
				get_icon_object_by_id(game.pets, id);
			return icon_object?.media ?? 'assets/media/main/question.png';
		},

		get_shared_game_mode(member) {
			if (member?.game_mode_visible !== true)
				return null;
			return game_mode_sharing.resolve_game_mode(
				member.game_mode_id,
				id => game.gamemodes?.getObjectByID(id),
				getLangString('MOD_MP_GAME_MODE_UNKNOWN')
			);
		},

		get_roster_game_mode(member) {
			if (member?.game_mode_visible !== true)
				return null;
			return game_mode_sharing.get_base_game_mode(member.game_mode_id);
		},

		get_language_lang_id(language) {
			return client_runtime.get_language_lang_id(language);
		},

		get_language_name(language) {
			const lang_id = this.get_language_lang_id(language);
			return lang_id === null ? '' : getLangString(lang_id);
		},

		format_member_account_age(account_age) {
			return format_status_account_age(account_age);
		},

		format_member_total_skill_level(total_skill_level) {
			return Number.isSafeInteger(total_skill_level) && total_skill_level >= 0
				? numberWithCommas(total_skill_level) : '';
		},

		get_guild_icon(id) {
			if (id === 'multiplayer')
				return this.get_svg('multiplayer');
			const area = game.combatAreas.getObjectByID(id);
			return area?.media ?? 'assets/media/main/question.png';
		},

		get_skill_icon(id) {
			const bundled_asset = BUNDLED_SKILL_ICON_ASSETS[id];
			if (bundled_asset !== undefined)
				return ctx.getResourceUrl('assets/' + bundled_asset);
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
			return getLangString(this.selected_guild_member?.skills_visible === false
				? 'MOD_MP_SKILLS_NOT_SHARED' : 'MOD_MP_SKILLS_NOT_AVAILABLE');
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
				return area !== null && is_official_game_id(area?.id) && area.media
					? area.media : 'assets/media/skills/combat/combat.png';
			}
			return this.get_svg('single_user');
		},

		get_status_activities(member) {
			if (Array.isArray(member?.status_activities) && member.status_activities.length > 0)
				return member.status_activities;
			return member?.status_activity === null || member?.status_activity === undefined
				? [] : [member.status_activity];
		},

		get_last_seen_lang_id(timestamp, is_current_member = false) {
			if (is_current_member)
				return 'MOD_MP_LAST_SEEN_JUST_NOW';
			if (!Number.isSafeInteger(timestamp) || timestamp <= 0)
				return 'MOD_MP_LAST_SEEN_UNKNOWN';
			const elapsed = Math.max(0, Date.now() - timestamp);
			return elapsed < 5 * 60 * 1000
				? 'MOD_MP_LAST_SEEN_JUST_NOW'
				: elapsed < 60 * 60 * 1000
					? 'MOD_MP_LAST_SEEN_MINUTES'
					: 'MOD_MP_LAST_SEEN_HOURS';
		},

		get_last_seen_value(timestamp) {
			const elapsed = Math.max(0, Date.now() - timestamp);
			return elapsed < 60 * 60 * 1000
				? Math.max(1, Math.floor(elapsed / (60 * 1000)))
				: Math.max(1, Math.floor(elapsed / (60 * 60 * 1000)));
		},

		is_new_guild_member(timestamp) {
			return Number.isSafeInteger(timestamp) && timestamp > 0 &&
				Math.max(0, Date.now() - timestamp) <= 48 * 60 * 60 * 1000;
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
			return getLangString((this.selected_chat_conversation?.conversation_kind ?? 'private') !== 'private' || this.messaging_enabled
				? 'MOD_MP_CHAT_COMPOSE_PLACEHOLDER' : 'MOD_MP_CHAT_DISABLED');
		},

		get_chat_participant_icon(conversation = this.selected_chat_conversation) {
			if (conversation?.conversation_kind === 'guild')
				return this.get_guild_icon(conversation.participant?.icon_id);
			if (conversation?.conversation_kind === 'support' && conversation.viewer_side === 'player') {
				const asset = SUPPORT_TEAM_ICON_ASSETS[conversation.participant?.icon_id];
				return asset === undefined ? 'assets/media/main/question.png' : ctx.getResourceUrl('assets/' + asset);
			}
			return this.get_avatar_icon(conversation?.participant?.icon_id);
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
	};
}
