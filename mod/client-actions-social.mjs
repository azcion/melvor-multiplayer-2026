export function install_social_actions(runtime) {
	const {
		state,
		api_get,
		api_post,
		capture_equipment_snapshot,
		capture_status_snapshot,
		changePage,
		close_account_dropdown,
		close_modal,
		close_modal_and_wait,
		document,
		game,
		get_client_events,
		get_friends,
		getLangString,
		get_instance_storage_item,
		is_social_only,
		hide_button_spinner,
		hide_modal_error,
		invalidate_guild_state,
		is_button_spinning,
		log,
		notify,
		notify_error,
		queue_modal,
		refresh_council,
		refresh_guild_members,
		refresh_guild_page,
		refresh_guild_state,
		refresh_shadowed_members,
		setup_guild_icons,
		setup_icons,
		show_button_spinner,
		show_modal_error,
		Swal,
	} = runtime;

	return {
		async confirm_display_name(event) {
			const $button = event.currentTarget;
			if (is_button_spinning($button))
				return;

			const display_name = this.display_name_input.trim();
			if (display_name.length === 0)
				return show_modal_error(getLangString('MOD_MP_DISPLAY_NAME_REQUIRED_ERR'));

			if (display_name.length > 20)
				return show_modal_error(getLangString('MOD_MP_DISPLAY_NAME_TOO_LONG_ERR'));
			if (!/^[\p{L}\p{N}](?:[\p{L}\p{M}\p{N} ._'’-]*[\p{L}\p{M}\p{N}])?$/u.test(display_name))
				return show_modal_error(getLangString('MOD_MP_DISPLAY_NAME_CHARACTERS_ERR'));

			hide_modal_error();
			show_button_spinner($button);

			const res = await api_post('/api/client/set_display_name', { display_name });

			hide_button_spinner($button);
			if (res?.success) {
				this.profile_display_name = res.display_name;
				await this.close_modal_and_wait('change-display-name-modal');
				await refresh_guild_state(true);
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

		stop_icon_scroll_propagation(event) {
			event.stopPropagation();
		},

		async confirm_icon_pick(event) {
			if (this.picked_icon === '')
				return;

			const $button = event.currentTarget;
			if (is_button_spinning($button))
				return;

			show_button_spinner($button);

			const res = await api_post('/api/client/set_icon', { icon_id: this.picked_icon });
			hide_button_spinner($button);
			if (res?.success) {
				this.profile_icon = this.picked_icon;
				await this.close_modal_and_wait('change-icon-modal');
				await refresh_guild_state(true);
				return;
			}

			this.close_modal();
		},

		show_icon_modal() {
			this.close_account_dropdown();
			setup_icons();

			state.picked_icon = '';

			queue_modal(game.characterName, 'change-icon-modal', this.get_avatar_icon(state.profile_icon), {
				showConfirmButton: false,
				customClass: { popup: 'mp-icon-picker-modal-popup' }
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
			if (is_social_only() && type.startsWith('charitree_'))
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
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
			if (is_social_only() && type.startsWith('charitree_'))
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
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
			return this.council_available_petition_types.includes(type) &&
				(!is_social_only() || !type.startsWith('charitree_'));
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
	};
}
