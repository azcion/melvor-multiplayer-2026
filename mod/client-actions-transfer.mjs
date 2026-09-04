const TRANSFER_CONFIRMATIONS = Object.freeze({
	donate: {
		info_lang_id: 'MOD_MP_TRANSFER_CONFIRM_DONATE',
		action_lang_id: 'MOD_MP_TRANSFER_CONFIRM_DONATE_ACTION'
	},
	counter_trade: {
		info_lang_id: 'MOD_MP_TRANSFER_CONFIRM_COUNTER_TRADE',
		action_lang_id: 'MOD_MP_TRANSFER_CONFIRM_COUNTER_TRADE_ACTION'
	},
	cancel_trade: {
		info_lang_id: 'MOD_MP_TRANSFER_CONFIRM_CANCEL_TRADE',
		action_lang_id: 'MOD_MP_TRANSFER_CONFIRM_CANCEL_TRADE_ACTION'
	},
	decline_gift: {
		info_lang_id: 'MOD_MP_TRANSFER_CONFIRM_DECLINE_GIFT',
		action_lang_id: 'MOD_MP_TRANSFER_CONFIRM_DECLINE_GIFT_ACTION'
	},
	decline_trade: {
		info_lang_id: 'MOD_MP_TRANSFER_CONFIRM_DECLINE_TRADE',
		action_lang_id: 'MOD_MP_TRANSFER_CONFIRM_DECLINE_TRADE_ACTION'
	}
});

export function install_transfer_actions(runtime) {
	const {
		state,
		GIFT_FLAG_RETURNED,
		MARKET_ITEMS_PER_PAGE,
		TRANSFER_INVENTORY_MAX_LIMIT,
		api_get,
		api_post,
		add_currency_to_transfer,
		add_gp_to_transfer,
		claim_inbox,
		capture_equipment_snapshot,
		capture_status_snapshot,
		invalidate_status_icon_collection,
		charitree_rules,
		changePage,
		close_account_dropdown,
		close_modal_and_wait,
		crypto,
		ctx,
		destroy_selected_transfer_inventory,
		document,
		formatNumber,
		game,
		get_client_events,
		getLangString,
		is_transfer_currency,
		is_social_only,
		has_local_unresolved_item,
		hide_button_spinner,
		is_button_spinning,
		is_local_item_resolved,
		load_market_filter_items,
		numberWithCommas,
		notify,
		notify_error,
		notify_item,
		open_transfer_page,
		queue_modal,
		reconcile_economy_receipts,
		refresh_guild_state,
		refresh_identities,
		refresh_raid_state,
		remove_sold_out_market_result,
		return_all_transfer_inventory,
		return_selected_transfer_inventory,
		schedule_equipment_sync,
		schedule_status_sync,
		set_instance_storage_item,
		show_button_spinner,
		show_modal_error,
		Swal,
		start_gp_sampling,
		start_status_observer,
		stop_gp_sampling,
		stop_status_observer,
		trade_returns,
		transfer_inventory,
		update_campaign_nav,
		update_market_listings,
		update_market_page,
		update_market_search,
		update_transfer_contents,
	} = runtime;
	let transfer_confirmation = null;

	return {
		// #region TRANSFER ACTIONS
		show_transfer_confirmation(action, transfer_id = null) {
			if (TRANSFER_CONFIRMATIONS[action] === undefined)
				return;
			transfer_confirmation = { action, transfer_id };
			queue_modal('MOD_MP_TRANSFER_CONFIRM_TITLE', 'transfer-confirm-modal', 'assets/transfer_bag.svg', {
				showConfirmButton: false
			});
		},

		get_transfer_confirmation_info_lang_id() {
			return TRANSFER_CONFIRMATIONS[transfer_confirmation?.action]?.info_lang_id ??
				'MOD_MP_TRANSFER_CONFIRM_TITLE';
		},

		get_transfer_confirmation_action_lang_id() {
			return TRANSFER_CONFIRMATIONS[transfer_confirmation?.action]?.action_lang_id ??
				'MOD_MP_BUTTON_CANCEL';
		},

		async confirm_transfer_action(event) {
			const confirmation = transfer_confirmation;
			if (confirmation === null)
				return;
			transfer_confirmation = null;
			this.close_modal();

			switch (confirmation.action) {
			case 'donate':
				return this.donate_items(event, true);
			case 'counter_trade':
				return this.counter_trade(event, confirmation.transfer_id, true);
			case 'cancel_trade':
				return this.cancel_trade(event, confirmation.transfer_id, true);
			case 'decline_gift':
				return this.resolve_gift(event, confirmation.transfer_id, false, true);
			case 'decline_trade':
				return this.decline_trade(event, confirmation.transfer_id, true);
			}
		},

		claim_inbox(event) {
			return claim_inbox(event);
		},

		get_transfer_value(transfer) {
			if (transfer.data === null)
				return '...';

			let total_value = 0;

			for (const entry of transfer.data.items) {
				if (entry.item_id === 'melvorD:GP') {
					total_value += entry.qty;
				} else if (!is_transfer_currency(entry.item_id)) {
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
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
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
			if (!this.raid_can_assault || runtime.raid_combat === null)
				return;
			if (!runtime.raid_combat.has_full_hitpoints(game.combat.player)) {
				this.raid_error = getLangString('MOD_MP_RAID_FULL_HP_REQUIRED');
				return;
			}
			this.raid_action_pending = true;
			this.raid_error = '';
			try {
				const reserve = () => api_post('/api/raids/assaults/reserve', {
					tier,
					loaded_session_id: runtime.raid_loaded_session_id
				});
				let reservation = await reserve();
				if (reservation?.error_lang === 'MOD_MP_RAID_ASSAULT_PENDING' && !runtime.raid_combat.has_active()) {
					const abandoned = await api_post('/api/raids/assaults/abandon', {});
					if (!abandoned?.success)
						throw new Error('MOD_MP_RAID_START_FAILED');
					reservation = await reserve();
				}
				if (typeof reservation?.assault_id !== 'string')
					throw new Error(reservation?.error_lang ?? 'MOD_MP_RAID_START_FAILED');
				runtime.raid_combat.start(reservation);
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
				skills_visible: this.skills_visible,
				skills_available: false,
				activity_visible: this.activity_visible,
				activity_available: false,
				account_age: null,
				total_skill_level: null,
				gp_visible: this.gp_visible,
				gp: null,
				game_mode_visible: this.game_mode_visible,
				game_mode_id: runtime.loaded_game_mode_id,
				active_mods_visible: this.active_mods_visible,
				active_mods_available: this.active_mods_visible && runtime.active_mod_names.length > 0,
				last_seen_at: null
			};
			this.show_member_actions(member);
		},

		open_identities_from_options() {
			this.close_modal();
			setTimeout(() => this.show_identities_modal(), 0);
		},

		show_identities_modal() {
			queue_modal('MOD_MP_IDENTITIES_TITLE', 'identities-modal', 'assets/multiplayer.svg', {
				showConfirmButton: false
			});
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
			if (!Number.isSafeInteger(this.chat_client_id) || is_button_spinning(event.currentTarget))
				return;
			show_button_spinner(event.currentTarget);
			let res = null;
			try {
				res = await api_post('/api/identities/delete', { client_id: this.chat_client_id });
			} catch (e) {
				error('failed to schedule identity deletion (%s)', e);
			}
			if (!res?.success) {
				hide_button_spinner(event.currentTarget);
				return show_modal_error(getLangString('MOD_MP_GENERIC_ERR'));
			}
			await refresh_identities();
			this.close_modal();
		},

		async cancel_identity_deletion(event) {
			if (!Number.isSafeInteger(this.chat_client_id) || is_button_spinning(event.currentTarget))
				return;
			show_button_spinner(event.currentTarget);
			let res = null;
			try {
				res = await api_post('/api/identities/delete/cancel', { client_id: this.chat_client_id });
			} catch (e) {
				error('failed to cancel identity deletion (%s)', e);
			}
			if (!res?.success) {
				hide_button_spinner(event.currentTarget);
				return show_modal_error(getLangString('MOD_MP_GENERIC_ERR'));
			}
			await refresh_identities();
			this.close_modal();
		},

		show_member_actions(member, preview = false) {
			this.selected_guild_member = member;
			this.member_actions_preview = preview;
			this.member_actions_error = '';
			queue_modal(member.display_name, 'member-actions-modal', this.get_avatar_icon(member.icon_id), {
				showConfirmButton: false
			}, false, false);
		},

		async preview_self_from_options() {
			const status = capture_status_snapshot();
			const account_age = status.account_creation_date === null
				? this.selected_guild_member?.account_age ?? null
				: Math.max(0, Date.now() - status.account_creation_date);
			const member = {
				...this.selected_guild_member,
				client_id: this.guild_client_id,
				display_name: this.profile_display_name,
				icon_id: this.profile_icon,
				equipment_visible: this.equipment_visible,
				equipment_available: this.equipment_visible,
				skills_visible: this.skills_visible,
				skills_available: this.skills_visible,
				activity_visible: this.activity_visible,
				activity_available: this.activity_visible,
				status_activity: this.activity_visible ? status?.activity ?? null : null,
				status_activities: this.activity_visible ? status?.activities ?? [] : [],
				account_age,
				total_skill_level: this.skills_visible ? status?.total_skill_level ?? null : null,
				game_mode_visible: this.game_mode_visible,
				game_mode_id: runtime.loaded_game_mode_id,
				active_mods_visible: this.active_mods_visible,
				active_mods_available: this.active_mods_visible && runtime.active_mod_names.length > 0
			};
			await this.close_modal_and_wait('member-actions-modal');
			this.show_member_actions(member, true);
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
					runtime.last_synced_equipment = null;
					schedule_equipment_sync(0);
				} else {
					runtime.last_synced_equipment = null;
				}
			} else {
				this.member_actions_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			}
			this.equipment_visibility_pending = false;
		},

		async set_skills_visibility(event) {
			if (this.skills_visibility_pending)
				return;
			event.preventDefault();
			const desired = !this.skills_visible;
			this.skills_visibility_pending = true;
			this.member_actions_error = '';
			let res = null;
			try {
				res = await api_post(this.split_visibility_supported ? '/api/client/skills/visibility' : '/api/client/status/visibility', { visible: desired });
			} catch (e) {
				log('player skills visibility update failed (%s)', e);
			}
			if (res?.success) {
				this.skills_visible = res.visible;
				if (!this.split_visibility_supported)
					this.activity_visible = res.visible;
				if (!res.visible)
					invalidate_status_icon_collection();
				if (this.selected_guild_member?.client_id === this.guild_client_id)
					Object.assign(this.selected_guild_member, {
						skills_visible: res.visible,
						...(!this.split_visibility_supported ? { activity_visible: res.visible, activity_available: res.visible } : {}),
						...(res.visible ? {} : { skills_available: false, total_skill_level: null })
					});
				runtime.last_synced_status_skills = null;
				runtime.last_synced_status_statistics = null;
				start_status_observer();
				schedule_status_sync(0);
			} else {
				this.member_actions_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			}
			this.skills_visibility_pending = false;
		},

		async set_activity_visibility(event) {
			if (this.activity_visibility_pending)
				return;
			event.preventDefault();
			const desired = !this.activity_visible;
			this.activity_visibility_pending = true;
			this.member_actions_error = '';
			let res = null;
			try {
				res = await api_post('/api/client/activity/visibility', { visible: desired });
			} catch (e) {
				log('player activity visibility update failed (%s)', e);
			}
			if (res?.success) {
				this.activity_visible = res.visible;
				if (this.selected_guild_member?.client_id === this.guild_client_id)
					Object.assign(this.selected_guild_member, {
						activity_visible: res.visible,
						...(res.visible ? {} : { activity_available: false, status_activity: null, status_activities: [] })
					});
				runtime.last_synced_status_activity = null;
				runtime.last_synced_status_activities = null;
				start_status_observer();
				schedule_status_sync(0);
			} else {
				this.member_actions_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			}
			this.activity_visibility_pending = false;
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
				runtime.last_synced_gp = null;
				if (res.visible) {
					start_gp_sampling(true);
					schedule_status_sync(0);
				} else
					stop_gp_sampling();
			} else {
				this.member_actions_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			}
			this.gp_visibility_pending = false;
		},

		async set_game_mode_visibility(event) {
			if (this.game_mode_visibility_pending)
				return;
			event.preventDefault();
			const desired = !this.game_mode_visible;
			this.game_mode_visibility_pending = true;
			this.member_actions_error = '';
			let res = null;
			try {
				res = await api_post('/api/client/game-mode/visibility', { visible: desired });
			} catch (e) {
				log('game mode visibility update failed (%s)', e);
			}
			if (res?.success) {
				this.game_mode_visible = res.visible;
				if (this.selected_guild_member?.client_id === this.guild_client_id) {
					this.selected_guild_member.game_mode_visible = res.visible;
					this.selected_guild_member.game_mode_id = runtime.loaded_game_mode_id;
				}
			} else {
				this.member_actions_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			}
			this.game_mode_visibility_pending = false;
		},

		async set_active_mods_visibility(event) {
			if (this.active_mods_visibility_pending)
				return;
			event.preventDefault();
			const desired = !this.active_mods_visible;
			this.active_mods_visibility_pending = true;
			this.member_actions_error = '';
			let res = null;
			try {
				res = await api_post('/api/client/active-mods/visibility', { visible: desired });
			} catch (e) {
				log('active mod visibility update failed (%s)', e);
			}
			if (res?.success) {
				this.active_mods_visible = res.visible;
				if (this.selected_guild_member?.client_id === this.guild_client_id) {
					this.selected_guild_member.active_mods_visible = res.visible;
					this.selected_guild_member.active_mods_available = res.visible && runtime.active_mod_names.length > 0;
				}
			} else {
				this.member_actions_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			}
			this.active_mods_visibility_pending = false;
		},

		async view_member_active_mods(event) {
			const member = this.selected_guild_member;
			const $button = event.currentTarget;
			if (!member || is_button_spinning($button))
				return;
			this.member_actions_error = '';
			show_button_spinner($button);
			let res = null;
			if (this.member_actions_preview) {
				res = member.active_mods_visible && runtime.active_mod_names.length > 0
					? { active_mods: [...runtime.active_mod_names] }
					: null;
			} else {
				try {
					res = await api_get('/api/guilds/active-mods?client_id=' + member.client_id);
				} catch (e) {
					log('active mod list fetch failed (%s)', e);
				}
			}
			hide_button_spinner($button);
			if (!Array.isArray(res?.active_mods) || res.active_mods.length === 0) {
				this.member_actions_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
				return;
			}

			this.viewed_active_mods = [...res.active_mods];
			this.close_modal();
			setTimeout(() => queue_modal(member.display_name, 'active-mods-modal', this.get_avatar_icon(member.icon_id), {
				showConfirmButton: false,
				didClose: () => {
					this.viewed_active_mods = [];
				}
			}, false, false), 0);
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
			if (this.member_actions_preview) {
				equipment_res = member.equipment_visible ? { slots: capture_equipment_snapshot() } : null;
				status_res = member.skills_visible || member.activity_visible ? capture_status_snapshot() : null;
			} else {
				try {
					[equipment_res, status_res] = await Promise.all([
						api_get('/api/guilds/equipment?client_id=' + member.client_id),
						api_get('/api/guilds/status?client_id=' + member.client_id)
					]);
				} catch (e) {
					log('player profile fetch failed (%s)', e);
				}
			}
			hide_button_spinner($button);
			const equipment = Array.isArray(equipment_res?.slots) ? equipment_res.slots : null;
			const status = member.skills_visible === true && member.skills_available === true &&
				Array.isArray(status_res?.skills) ? status_res : null;
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
			add_currency_to_transfer('melvorD:GP', state.add_currency_value);
			this.close_modal();
		},

		show_add_currency_modal() {
			queue_modal('MOD_MP_TITLE_ADD_CURRENCY', 'add-currency-modal', 'assets/media/main/coins.png', {
				showConfirmButton: false
			}, true, false);
		},

		show_add_currency_amount_modal(currency_id) {
			if (!state.get_transfer_currency(currency_id))
				return;
			state.selected_transfer_currency_id = currency_id;
			this.close_modal();
			setTimeout(() => queue_modal('MOD_MP_TITLE_ADD_CURRENCY', 'add-currency-amount-modal',
				state.selected_transfer_currency?.currency?.media, { showConfirmButton: false }, true, false), 0);
		},

		async add_currency_to_transfer() {
			add_currency_to_transfer(state.selected_transfer_currency_id, state.add_currency_value);
			this.close_modal();
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
	};
}
