export function install_chat_actions(runtime) {
	const {
		state,
		api_post,
		changePage,
		close_account_dropdown,
		crypto,
		game,
		get_chat_conversation_key,
		getLangString,
		hide_button_spinner,
		is_button_spinning,
		log,
		nativeManager,
		notify,
		queue_modal,
		refresh_chat_conversations,
		refresh_chat_messages,
		show_button_spinner,
		show_modal_error,
		start_chat_polling,
		stop_chat_polling,
	} = runtime;

	return {
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
			const view_generation = ++runtime.chat_view_generation;
			this.selected_chat_conversation = conversation;
			this.chat_messages = [];
			this.selected_chat_message = null;
			this.chat_has_more = false;
			this.chat_before_cursor = null;
			this.chat_error = '';
			this.chat_messages_loading = false;
			this.chat_loading = false;
			await refresh_chat_messages('', false, false, view_generation);
			if (view_generation !== runtime.chat_view_generation ||
				this.selected_chat_conversation?.conversation_kind !== conversation.conversation_kind ||
				this.selected_chat_conversation?.conversation_id !== conversation.conversation_id ||
				this.selected_chat_conversation?.support_team_id !== conversation.support_team_id)
				return;
			start_chat_polling();
		},

		close_chat_conversation() {
			runtime.chat_view_generation++;
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
			queue_modal('MOD_MP_CHAT_MESSAGE_ACTIONS', 'chat-message-actions-modal', this.get_chat_participant_icon(), {
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
			const conversation_key = get_chat_conversation_key(conversation);
			const view_generation = runtime.chat_view_generation;
			const content = this.chat_draft.trim();
			if (!conversation || conversation_key === null || content.length === 0 || content.length > 1000 ||
				this.chat_sending_conversations[conversation_key] === true)
				return;
			this.chat_sending_conversations[conversation_key] = true;
			this.chat_error = '';
			const conversation_kind = conversation.conversation_kind ?? 'private';
			const pending = this.chat_pending_sends[conversation_key];
			const idempotency_key = pending?.conversation_kind === conversation_kind &&
				pending?.conversation_id === conversation.conversation_id &&
				pending.support_team_id === conversation.support_team_id &&
				pending.client_id === conversation.participant.client_id && pending.content === content
				? pending.idempotency_key
				: crypto.randomUUID();
			this.chat_pending_sends[conversation_key] = {
				conversation_kind,
				conversation_id: conversation.conversation_id,
				support_team_id: conversation.support_team_id,
				client_id: conversation.participant.client_id,
				content,
				idempotency_key
			};
			let res = null;
			try {
				res = await api_post('/api/chat/messages/send', {
					conversation_kind,
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
				delete this.chat_pending_sends[conversation_key];
			const is_current_view = () => view_generation === runtime.chat_view_generation &&
				get_chat_conversation_key(this.selected_chat_conversation) === conversation_key;
			try {
				if (res?.success) {
					conversation.conversation_id = res.message.conversation_id;
					if (is_current_view() && !this.chat_messages.some(message => message.message_id === res.message.message_id))
						this.chat_messages.push(res.message);
					if (res.budget)
						this.chat_budget = res.budget;
					this.chat_budget_enabled = res.budget_enabled !== false;
					if (this.chat_drafts[conversation_key]?.trim() === content)
						this.chat_drafts[conversation_key] = '';
					await refresh_chat_conversations();
					if (is_current_view())
						start_chat_polling();
				} else if (is_current_view()) {
					this.chat_error = getLangString(res?.error_lang ?? 'MOD_MP_CHAT_SEND_FAILED');
				}
			} finally {
				delete this.chat_sending_conversations[conversation_key];
			}
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

		async set_guild_chat_enabled(event) {
			if (this.guild_chat_participation_pending)
				return;
			event.preventDefault();
			this.guild_chat_participation_pending = true;
			this.member_actions_error = '';
			const desired = !this.guild_chat_enabled;
			const res = await api_post('/api/chat/guild-participation', { enabled: desired });
			if (res?.success) {
				this.guild_chat_enabled = res.enabled;
				this.guild_chat_state.enabled = res.enabled;
				if (!res.enabled && this.selected_chat_conversation?.conversation_kind === 'guild')
					this.close_chat_conversation();
				await refresh_chat_conversations();
			} else {
				this.member_actions_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			}
			this.guild_chat_participation_pending = false;
		},
	};
}
