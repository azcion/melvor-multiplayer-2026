export function install_chat_actions(runtime) {
	const {
		document,
		state,
		api_get,
		api_post,
		changePage,
		close_account_dropdown,
		crypto,
		game,
		get_chat_conversation_key,
		getLangString,
		get_instance_storage_item = () => undefined,
		hide_button_spinner,
		is_button_spinning,
		log,
		localization,
		nativeManager,
		next_tick = () => Promise.resolve(),
		now = () => Date.now(),
		notify,
		queue_modal,
		refresh_chat_conversations,
		refresh_chat_messages,
		set_instance_storage_item = () => {},
		show_button_spinner,
		show_modal_error,
		start_chat_polling,
		stop_chat_polling,
		update_chat_nav = () => {},
		update_market_listings = async () => {},
		schedule_timeout = (callback, delay) => setTimeout(callback, delay),
	} = runtime;
	const items = runtime.chat_items;
	let item_picker_composer = null;
	let notifications_next_toggle_at = 0;
	const reaction_throttle_ms = 1000;
	const translation_wait_ms = 10000;
	const translation_languages = new Set(['en', 'zh-CN']);
	const localized_welcome_language = () => localization.resolve_multiplayer_language(
		typeof setLang === 'string' ? setLang : 'en'
	);
	const default_translation_language = conversation => {
		const kind = conversation?.conversation_kind ?? 'private';
		return typeof setLang === 'string' && setLang === 'zh-CN' &&
			(kind === 'global' || kind === 'guild') ? 'zh-CN' : null;
	};
	const translation_preference = conversation => {
		const key = get_chat_conversation_key(conversation);
		if (key === null) return null;
		const stored = state.chat_translation_preferences[key];
		if (translation_languages.has(stored)) return stored;
		if (stored === false) return null;
		return default_translation_language(conversation);
	};
	const preferred_manual_language = message => {
		const configured = translation_preference(state.selected_chat_conversation);
		if (configured) return configured;
		const game_language = typeof setLang === 'string' && setLang === 'zh-CN' ? 'zh-CN' : 'en';
		return game_language;
	};

	const get_chat_messages_element = () => document.querySelector('.mp-chat-messages');
	const close_chat_reaction_picker = () => {
		if (!state)
			return;
		state.chat_reaction_picker_message_id = null;
		state.chat_reaction_picker_style = {};
	};
	if (document?.addEventListener) {
		document.addEventListener('click', event => {
			if (!(event.target instanceof Element) ||
				!event.target.closest('.mp-chat-reaction-add, .mp-chat-reaction-picker'))
				close_chat_reaction_picker();
		});
		document.addEventListener('scroll', close_chat_reaction_picker, true);
		globalThis.addEventListener?.('resize', close_chat_reaction_picker);
	}
	const scroll_chat_messages_to_bottom = () => {
		const $messages = get_chat_messages_element();
		if ($messages)
			$messages.scrollTop = $messages.scrollHeight;
	};
	const wait_and_scroll_chat_messages_to_bottom = async () => {
		await next_tick();
		scroll_chat_messages_to_bottom();
	};

	return {
		get_chat_draft_parts() {
			const key = get_chat_conversation_key(this.selected_chat_conversation);
			const stored = this.chat_item_drafts?.[key];
			return stored && items?.fallback_text(stored) === this.chat_draft ? stored :
				(this.chat_draft ? [{ type: 'text', text: this.chat_draft }] : []);
		},

		get_chat_draft_document() {
			return JSON.stringify({ key: get_chat_conversation_key(this.selected_chat_conversation), parts: this.get_chat_draft_parts() });
		},

		update_chat_item_draft(key, parts) {
			if (key !== get_chat_conversation_key(this.selected_chat_conversation)) return;
			this.chat_item_drafts[key] = parts;
			this.chat_draft = items.fallback_text(parts);
		},

		is_chat_item_draft_valid() {
			return items ? items.valid_parts(this.get_chat_draft_parts()) : this.chat_draft.length <= 1000;
		},

		get_chat_item_count_label() {
			return `${this.chat_draft.trim().length} / 1000`;
		},

		async show_chat_item_picker(composer) {
			item_picker_composer = composer;
			this.chat_item_search = '';
			await update_market_listings();
			this.chat_item_order_ids = items.ordered_item_ids(this.market_listings);
			this.chat_item_catalog = items.item_catalog(game, this.market_listings);
			queue_modal('MOD_MP_CHAT_INSERT_ITEM', 'chat-item-picker-modal', undefined, {
				showConfirmButton: false,
				didOpen: () => {
					this.render_chat_item_results();
					document.querySelector('.mp-chat-item-search')?.focus();
				},
				didClose: () => {
					if (item_picker_composer === composer) item_picker_composer = null;
					if (composer.isConnected && composer.key === get_chat_conversation_key(state.selected_chat_conversation)) {
						if (composer.picker_item_id) composer.insert_item(composer.picker_item_id);
						else {
							composer.editor.focus();
							composer.set_selection(...composer.picker_restore_selection);
						}
					}
				}
			});
		},

		open_chat_item_picker() {
			document.querySelector('mp-chat-composer')?.open_picker();
		},

		get_chat_item_results() {
			return items.search_items(this.chat_item_catalog, this.chat_item_search,
				[...this.chat_item_order_ids, ...this.chat_recent_items]);
		},

		update_chat_item_search(event) {
			this.chat_item_search = event.target.value;
			this.render_chat_item_results();
		},

		render_chat_item_results() {
			const host = document.querySelector('.mp-chat-item-results');
			const empty = document.querySelector('.mp-chat-item-empty');
			if (!host || !empty) return;
			const results = this.get_chat_item_results();
			const fragment = document.createDocumentFragment();
			for (const item of results) {
				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'mp-chat-item-result';
				button.addEventListener('click', () => state.choose_chat_item(item.id));
				button.addEventListener('keydown', event => state.handle_chat_item_result_key(event, item.id));
				const image = document.createElement('img');
				image.src = item.media; image.alt = ''; image.draggable = false;
				const name = document.createElement('span');
				name.textContent = item.name;
				button.append(image, name); fragment.append(button);
			}
			host.replaceChildren(fragment);
			empty.classList.toggle('d-none', results.length !== 0);
		},

		choose_chat_item(id) {
			const composer = item_picker_composer;
			if (!composer?.isConnected || composer.key !== get_chat_conversation_key(this.selected_chat_conversation)) return;
			if (!items.official_chat_item(id) || !game.items.getObjectByID(id)) return;
			this.chat_recent_items = [id, ...this.chat_recent_items.filter(recent => recent !== id)].slice(0, 10);
			// didClose restores the editor after SweetAlert has released its focus trap.
			composer.picker_item_id = id;
			this.close_modal();
		},

		handle_chat_item_search_key(event) {
			if (event.isComposing) return;
			if (event.key === 'ArrowDown') {
				event.preventDefault(); document.querySelector('.mp-chat-item-result')?.focus();
			} else if (event.key === 'Enter') {
				event.preventDefault(); const first = this.get_chat_item_results()[0]; if (first) this.choose_chat_item(first.id);
			}
		},

		handle_chat_item_result_key(event, id) {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault(); this.choose_chat_item(id); return;
			}
			if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
			event.preventDefault();
			const next = event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
			(next ?? document.querySelector('.mp-chat-item-search'))?.focus();
		},

		get_chat_message_parts(message) {
			const content = this.get_chat_message_content(message);
			const own = message?.sender_id === this.chat_client_id || message?.sent_by_viewer === true;
			const language = message?.sender_id === null ? localized_welcome_language() :
				message?.manual_translation_language ?? translation_preference(this.selected_chat_conversation);
			if (!own && language && message?.translation_parts?.[language] && content === message.translations?.[language])
				return message.translation_parts[language];
			return content === message?.content && message.parts ? message.parts : [{ type: 'text', text: content }];
		},

		get_chat_message_document(message) { return JSON.stringify(this.get_chat_message_parts(message)); },

		get_chat_plain_content(message) {
			return (message.parts ?? [{ type: 'text', text: message.content ?? '' }]).map(part => part.type === 'text' ? part.text :
				game.items.getObjectByID(part.item_id)?.name ?? items.fallback_item_name(part.item_id)).join('');
		},

		load_chat_notification_preferences() {
			const stored = get_instance_storage_item('chat_notification_preferences');
			state.chat_notification_preferences = stored && typeof stored === 'object' && !Array.isArray(stored)
				? Object.fromEntries(Object.entries(stored).filter(([, enabled]) => enabled === false)) : {};
		},

		is_chat_notifications_enabled(conversation = this.selected_chat_conversation) {
			const key = get_chat_conversation_key(conversation);
			return this.chat_notification_preferences[key] !== false;
		},

		get_chat_notification_unread(conversations = this.chat_conversations) {
			return conversations.reduce((total, conversation) => total +
				(this.is_chat_notifications_enabled(conversation) ? conversation.unread_count ?? 0 : 0), 0);
		},

		toggle_chat_notifications() {
			const key = get_chat_conversation_key(this.selected_chat_conversation);
			if (key === null || this.chat_notifications_busy || now() < notifications_next_toggle_at)
				return;
			const enabled = !this.is_chat_notifications_enabled();
			const preferences = { ...this.chat_notification_preferences };
			if (enabled) delete preferences[key];
			else preferences[key] = false;
			set_instance_storage_item('chat_notification_preferences', preferences);
			this.chat_notification_preferences = preferences;
			this.chat_unread = this.get_chat_notification_unread();
			update_chat_nav();
			notifications_next_toggle_at = now() + 2000;
			this.chat_notifications_busy = true;
			schedule_timeout(() => { state.chat_notifications_busy = false; }, 2000);
			notify(enabled ? 'MOD_MP_CHAT_NOTIFICATIONS_ENABLED' : 'MOD_MP_CHAT_NOTIFICATIONS_DISABLED', 'success');
		},

		load_chat_translation_preferences() {
			const stored_translation_preferences = get_instance_storage_item('chat_translation_preferences');
			state.chat_translation_preferences = stored_translation_preferences &&
				typeof stored_translation_preferences === 'object' && !Array.isArray(stored_translation_preferences)
				? Object.fromEntries(Object.entries(stored_translation_preferences)
					.filter(([, language]) => language === false || translation_languages.has(language)))
				: {};
		},

		async scroll_chat_messages_to_bottom() {
			await wait_and_scroll_chat_messages_to_bottom();
		},

		chat_messages_are_at_bottom() {
			const $messages = get_chat_messages_element();
			return $messages !== null &&
				$messages.scrollHeight - $messages.scrollTop - $messages.clientHeight <= 24;
		},

		open_chat_page() {
			this.close_account_dropdown();
			changePage(game.pages.getObjectByID('multiplayer:Chat'));
		},

		async start_member_chat(event) {
			const member = this.selected_guild_member;
			const $button = event.currentTarget;
			if (!member || member.can_start_chat === false || member.client_id === this.guild_client_id || is_button_spinning($button))
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
			this.chat_reaction_revision = null;
			this.selected_chat_message = null;
			this.chat_has_more = false;
			this.close_modal();
			this.open_chat_page();
		},

		async open_chat_conversation(conversation) {
			const view_generation = ++runtime.chat_view_generation;
			this.selected_chat_conversation = conversation;
			this.chat_messages = [];
			this.chat_reaction_revision = null;
			this.selected_chat_message = null;
			this.chat_has_more = false;
			this.chat_before_cursor = null;
			this.chat_error = '';
			this.chat_messages_loading = false;
			this.chat_loading = false;
			if (conversation.synthetic_unsupported === true) {
				this.chat_messages = [conversation.latest_message];
				await this.scroll_chat_messages_to_bottom();
				return;
			}
			await refresh_chat_messages('', false, false, view_generation);
			if (view_generation !== runtime.chat_view_generation ||
				this.selected_chat_conversation?.conversation_kind !== conversation.conversation_kind ||
				this.selected_chat_conversation?.conversation_id !== conversation.conversation_id ||
				this.selected_chat_conversation?.support_team_id !== conversation.support_team_id)
				return;
			await this.scroll_chat_messages_to_bottom();
			start_chat_polling();
		},

		close_chat_conversation() {
			runtime.chat_view_generation++;
			this.selected_chat_conversation = null;
			this.chat_messages = [];
			this.chat_reaction_revision = null;
			this.selected_chat_message = null;
			this.chat_reaction_picker_message_id = null;
			this.chat_reaction_picker_style = {};
			this.chat_has_more = false;
			this.chat_before_cursor = null;
			this.chat_error = '';
			this.chat_messages_loading = false;
			stop_chat_polling();
		},

		async toggle_chat_reaction_picker(message, event) {
			if (!Number.isSafeInteger(message?.message_id) || message.message_id < 1)
				return;
			if (this.chat_reaction_picker_message_id === message.message_id) {
				this.chat_reaction_picker_message_id = null;
				this.chat_reaction_picker_style = {};
				return;
			}
			const bubble = event?.currentTarget?.closest?.('.mp-chat-message-bubble, .mp-poll-card');
			const bubble_rect = bubble?.getBoundingClientRect?.();
			this.chat_reaction_picker_message_id = message.message_id;
			this.chat_reaction_picker_style = { visibility: 'hidden' };
			await next_tick();
			const picker = document?.querySelector?.('.mp-chat-reaction-picker');
			if (!bubble_rect || !picker || this.chat_reaction_picker_message_id !== message.message_id)
				return;
			const picker_rect = picker.getBoundingClientRect();
			const viewport_width = globalThis.innerWidth || document.documentElement?.clientWidth || picker_rect.width;
			const left = Math.max(8, Math.min(bubble_rect.left, viewport_width - picker_rect.width - 8));
			this.chat_reaction_picker_style = {
				left: left + 'px',
				top: bubble_rect.bottom + 8 + 'px'
			};
		},

		get_chat_reaction_picker_message() {
			return this.chat_messages.find(message => message.message_id === this.chat_reaction_picker_message_id);
		},

		get_chat_reaction_add_label() {
			return getLangString('MOD_MP_CHAT_ADD_REACTION');
		},

		async toggle_chat_reaction(message, reaction) {
			const conversation = this.selected_chat_conversation;
			if (!conversation || !Number.isSafeInteger(message?.message_id) || message.message_id < 1 ||
				typeof reaction !== 'string')
				return;
			const pending_key = (conversation.conversation_kind ?? 'private') + '\n' + conversation.conversation_id + '\n' +
				message.message_id + '\n' + reaction;
			const toggled_at = now();
			if (this.chat_reaction_pending[pending_key] === true ||
				(this.chat_reaction_throttle_until[pending_key] ?? 0) > toggled_at)
				return;
			const reacted = !(message.reactions ?? []).some(summary => summary.reaction === reaction && summary.reacted === true);
			this.chat_reaction_pending[pending_key] = true;
			this.chat_reaction_throttle_until[pending_key] = toggled_at + reaction_throttle_ms;
			this.chat_reaction_picker_message_id = null;
			this.chat_reaction_picker_style = {};
			let res = null;
			try {
				const endpoint = conversation.conversation_kind === 'polls'
					? '/api/polls/reaction?capabilities=polls-v1'
					: conversation.conversation_kind === 'global'
					? '/api/chat/messages/reaction?capabilities=global-chat-v1'
					: '/api/chat/messages/reaction';
				res = await api_post(endpoint, conversation.conversation_kind === 'polls' ? {
					poll_id: message.poll_id, reaction, reacted
				} : {
					conversation_kind: conversation.conversation_kind ?? 'private',
					conversation_id: conversation.conversation_id,
					message_id: message.message_id,
					reaction,
					reacted
				});
			} catch (e) {
				log('Chat reaction failed (%s)', e);
			}
			delete this.chat_reaction_pending[pending_key];
			if (res?.success && (Array.isArray(res.reactions) || res.poll)) {
				message.reactions = res.poll?.reactions ?? res.reactions;
				if (Number.isSafeInteger(res.reaction_revision))
					message.reaction_revision = res.reaction_revision;
			}
			else if (res !== null)
				this.chat_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
		},

		show_poll_creator(poll = null) {
			if (!this.poll_can_create) return;
			this.poll_creator_content = poll?.content ?? '';
			this.poll_creator_options = [''];
			this.poll_creator_poll_id = poll?.poll_id ?? null;
			queue_modal(poll ? 'MOD_MP_POLLS_ADD_OPTIONS' : 'MOD_MP_POLLS_CREATE', 'poll-creator-modal',
				this.get_chat_participant_icon(), { showConfirmButton: false }, true, false);
		},

		add_poll_creator_option() { this.poll_creator_options.push(''); },

		remove_poll_creator_option(index) {
			if (this.poll_creator_options.length > 1) this.poll_creator_options.splice(index, 1);
		},

		async submit_poll(event) {
			event?.preventDefault();
			const options = this.poll_creator_options.map(option => option.trim()).filter(Boolean);
			if (options.length < 1 || (!this.poll_creator_poll_id && !this.poll_creator_content.trim())) return;
			this.poll_creator_pending = true;
			const editing = Number.isSafeInteger(this.poll_creator_poll_id);
			const res = await api_post((editing ? '/api/polls/options' : '/api/polls/create') + '?capabilities=polls-v1',
				editing ? { poll_id: this.poll_creator_poll_id, options } : {
					idempotency_key: crypto.randomUUID(), content: this.poll_creator_content.trim(), options
				});
			this.poll_creator_pending = false;
			if (!res?.success) return show_modal_error(getLangString('MOD_MP_GENERIC_ERR'));
			const index = this.polls.findIndex(poll => poll.poll_id === res.poll.poll_id);
			if (index < 0) this.polls.push(res.poll); else this.polls[index] = res.poll;
			this.close_modal();
		},

		async toggle_poll_option(poll, option) {
			const key = poll.poll_id + ':' + option.option_id;
			if ((this.poll_vote_throttle_until[key] ?? 0) > now()) return;
			this.poll_vote_throttle_until[key] = now() + 400;
			const res = await api_post('/api/polls/vote?capabilities=polls-v1', {
				poll_id: poll.poll_id, option_id: option.option_id, selected: !option.selected
			});
			if (Number.isFinite(res?.retry_after_ms)) this.poll_vote_throttle_until[key] = now() + res.retry_after_ms;
			if (res?.poll) {
				const index = this.polls.findIndex(entry => entry.poll_id === poll.poll_id);
				if (index >= 0) this.polls[index] = res.poll;
			}
		},

		async open_poll_discussion(poll) {
			await this.open_chat_conversation({ conversation_kind: 'poll-discussion', conversation_id: poll.poll_id,
				participant: { client_id: null, display_name: getLangString('MOD_MP_POLLS_DISCUSSION'), icon_id: 'multiplayer' },
				poll, unread_count: 0, blocked: false });
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

		show_chat_translation_modal() {
			const current = translation_preference(this.selected_chat_conversation);
			this.chat_translation_language_input = current ??
				(typeof setLang === 'string' && setLang === 'zh-CN' ? 'zh-CN' : 'en');
			queue_modal('MOD_MP_CHAT_TRANSLATION_TITLE', 'chat-translation-modal', this.get_chat_participant_icon(), {
				showConfirmButton: false
			}, true, false);
		},

		set_chat_translation_enabled(enabled) {
			const key = get_chat_conversation_key(this.selected_chat_conversation);
			if (key === null) return;
			if (enabled && translation_languages.has(this.chat_translation_language_input))
				this.chat_translation_preferences[key] = this.chat_translation_language_input;
			else
				this.chat_translation_preferences[key] = false;
			this.chat_translation_preferences = { ...this.chat_translation_preferences };
			set_instance_storage_item('chat_translation_preferences', this.chat_translation_preferences);
			this.close_modal();
			void refresh_chat_messages('', false, false);
		},

		get_chat_translation_language() {
			return translation_preference(this.selected_chat_conversation);
		},

		is_chat_translation_language_changed() {
			return this.is_chat_translation_enabled() &&
				this.chat_translation_language_input !== translation_preference(this.selected_chat_conversation);
		},

		get_chat_translation_action_lang_id() {
			if (!this.is_chat_translation_enabled()) return 'MOD_MP_CHAT_TRANSLATION_ENABLE';
			if (this.is_chat_translation_language_changed()) return 'MOD_MP_CHAT_TRANSLATION_APPLY';
			return 'MOD_MP_CHAT_TRANSLATION_DISABLE';
		},

		save_chat_translation() {
			if (!this.is_chat_translation_enabled() || this.is_chat_translation_language_changed())
				return this.set_chat_translation_enabled(true);
			this.set_chat_translation_enabled(false);
		},

		translate_selected_chat_message() {
			const message = this.selected_chat_message;
			if (!message || message.sender_id === this.chat_client_id || message.sent_by_viewer === true) return;
			const language = preferred_manual_language(message);
			if (language) message.manual_translation_language = language;
			this.selected_chat_message = null;
			this.close_modal();
		},

		has_chat_message_translations(message) {
			return Object.values(message?.translations ?? {}).some(translation =>
				typeof translation === 'string' && translation.length > 0);
		},

		get_chat_message_content(message) {
			if (!message || message.sender_id === this.chat_client_id || message.sent_by_viewer === true)
				return message?.content ?? '';
			if (message.sender_id === null) {
				const localized = message.translations?.[localized_welcome_language()];
				if (typeof localized === 'string' && localized.length > 0) return localized;
			}
			const language = message.manual_translation_language ?? translation_preference(this.selected_chat_conversation);
			if (!language) return message.content;
			const translated = message.translations?.[language];
			if (typeof translated === 'string' && translated.length > 0) return translated;
			message.translation_observed_at ??= now();
			if ((message.translation_status === 'queued' || message.translation_status === 'processing') &&
				now() - message.translation_observed_at < translation_wait_ms)
				return getLangString('MOD_MP_CHAT_TRANSLATING');
			return message.content;
		},

		is_chat_message_translation_pending(message) {
			if (!message || message.sender_id === this.chat_client_id || message.sent_by_viewer === true)
				return false;
			const language = message.manual_translation_language ?? translation_preference(this.selected_chat_conversation);
			if (!language || (typeof message.translations?.[language] === 'string' && message.translations[language].length > 0))
				return false;
			return message.translation_status === 'queued' || message.translation_status === 'processing';
		},

		is_chat_message_translation_waiting(message) {
			if (!this.is_chat_message_translation_pending(message))
				return false;
			return Number.isFinite(message.translation_observed_at) &&
				now() - message.translation_observed_at < translation_wait_ms;
		},

		is_chat_translation_enabled() {
			return translation_preference(this.selected_chat_conversation) !== null;
		},

		async show_chat_message_member(message) {
			const sender_id = message?.sender_id;
			if (!Number.isSafeInteger(sender_id) || sender_id < 1 || !message?.sender)
				return;
			const member = [...this.guild_members, ...(this.shadowed_members ?? [])]
				.find(entry => entry.client_id === sender_id);
			let chat_profile = null;
			if (member === undefined) {
				try {
					chat_profile = await api_get('/api/chat/profile?client_id=' + sender_id);
				} catch (e) {
					log('chat profile fetch failed (%s)', e);
				}
			}
			this.show_member_actions({
				...(member ?? chat_profile ?? {}),
				client_id: sender_id,
				display_name: message.sender.display_name,
				icon_id: message.sender.icon_id,
				...(member === undefined ? { profile_source: 'chat' } : {})
			});
		},

		show_chat_message_delete_confirmation() {
			if (!this.selected_chat_message)
				return;
			this.close_modal();
			setTimeout(() => queue_modal('MOD_MP_CHAT_DELETE_MESSAGE_CONFIRM_TITLE', 'chat-message-delete-confirm-modal', this.get_avatar_icon(this.selected_chat_conversation?.participant.icon_id), {
				showConfirmButton: false
			}, true, false), 0);
		},

		show_chat_message_delete_for_all_confirmation() {
			if (!this.selected_chat_message || !this.can_moderate_chat_messages())
				return;
			this.close_modal();
			setTimeout(() => queue_modal('MOD_MP_CHAT_DELETE_MESSAGE_FOR_ALL_CONFIRM_TITLE', 'chat-message-delete-for-all-confirm-modal', this.get_chat_participant_icon(), {
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
				await clipboard.writeText(this.get_chat_plain_content(message));
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
			const $messages = get_chat_messages_element();
			const previous_scroll_top = $messages?.scrollTop ?? 0;
			const previous_scroll_height = $messages?.scrollHeight ?? 0;
			await refresh_chat_messages('&before=' + this.chat_before_cursor, true);
			if ($messages) {
				await next_tick();
				$messages.scrollTop = previous_scroll_top + $messages.scrollHeight - previous_scroll_height;
			}
		},

		select_chat_support_prompt(lang_id) {
			if (!this.show_chat_support_prompts)
				return;
			this.chat_draft = getLangString(lang_id);
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
			const draft_parts = this.get_chat_draft_parts();
			const parts = draft_parts.some(part => part.type === 'item') ? items.compact_parts(draft_parts, true) : undefined;
			const parts_key = JSON.stringify(parts ?? null);
			if (!conversation || conversation_key === null || content.length === 0 || content.length > 1000 ||
				this.chat_sending_conversations[conversation_key] === true || !this.is_chat_item_draft_valid())
				return;
			this.chat_sending_conversations[conversation_key] = true;
			this.chat_error = '';
			const conversation_kind = conversation.conversation_kind ?? 'private';
			const pending = this.chat_pending_sends[conversation_key];
			const idempotency_key = pending?.conversation_kind === conversation_kind &&
				pending?.conversation_id === conversation.conversation_id &&
				pending.support_team_id === conversation.support_team_id &&
				pending.client_id === conversation.participant.client_id && pending.content === content &&
				(pending.parts_key ?? 'null') === parts_key
				? pending.idempotency_key
				: crypto.randomUUID();
			this.chat_pending_sends[conversation_key] = {
				conversation_kind,
				conversation_id: conversation.conversation_id,
				support_team_id: conversation.support_team_id,
				client_id: conversation.participant.client_id,
				content,
				parts_key,
				idempotency_key
			};
			let res = null;
			try {
				const endpoint = conversation_kind === 'global'
					? '/api/chat/messages/send?capabilities=global-chat-v1'
					: conversation_kind === 'poll-discussion'
						? '/api/chat/messages/send?capabilities=polls-v1' : '/api/chat/messages/send';
				res = await api_post(endpoint, {
					conversation_kind,
					conversation_id: conversation.conversation_id,
					support_team_id: conversation.support_team_id,
					client_id: conversation.participant.client_id,
					idempotency_key,
					content,
					...(parts ? { parts } : {})
				});
			} catch (e) {
				log('Chat send failed (%s)', e);
			}
			if (res !== null)
				delete this.chat_pending_sends[conversation_key];
			const is_current_view = () => view_generation === runtime.chat_view_generation &&
				get_chat_conversation_key(this.selected_chat_conversation) === conversation_key;
			try {
				if (conversation_kind === 'global' && Number.isFinite(res?.retry_after_ms) && res.retry_after_ms > 0) {
					clearTimeout(runtime.global_chat_cooldown_timer);
					this.global_chat_cooling_down = true;
					runtime.global_chat_cooldown_timer = setTimeout(() => {
						state.global_chat_cooling_down = false;
					}, res.retry_after_ms);
				}
				if (res?.success) {
					conversation.conversation_id = res.message.conversation_id;
					if (is_current_view() && !this.chat_messages.some(message => message.message_id === res.message.message_id))
						this.chat_messages.push(res.message);
					if (is_current_view())
						await this.scroll_chat_messages_to_bottom();
					if (res.budget)
						this.chat_budget = res.budget;
					this.chat_budget_enabled = res.budget_enabled !== false;
					if (this.chat_drafts[conversation_key]?.trim() === content &&
						JSON.stringify(this.chat_item_drafts?.[conversation_key]?.some(part => part.type === 'item') ?
							items.compact_parts(this.chat_item_drafts[conversation_key], true) : null) === parts_key) {
						this.chat_drafts[conversation_key] = '';
						if (this.chat_item_drafts) delete this.chat_item_drafts[conversation_key];
					}
					await refresh_chat_conversations();
					if (is_current_view())
						start_chat_polling();
				} else if (is_current_view() && !(conversation_kind === 'global' && Number.isFinite(res?.retry_after_ms))) {
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

		async delete_chat_message_for_all(event) {
			const message = this.selected_chat_message;
			const conversation = this.selected_chat_conversation;
			if (!message || !conversation || !this.can_moderate_chat_messages())
				return;
			const $button = event.currentTarget;
			if (is_button_spinning($button))
				return;
			show_button_spinner($button);
			const res = await api_post('/api/chat/messages/delete-for-all', {
				conversation_kind: conversation.conversation_kind,
				message_id: message.message_id
			});
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

		async set_global_chat_enabled(event) {
			if (this.global_chat_participation_pending)
				return;
			event.preventDefault();
			this.global_chat_participation_pending = true;
			this.member_actions_error = '';
			const desired = !this.global_chat_enabled;
			const res = await api_post('/api/chat/global-participation?capabilities=global-chat-v1', { enabled: desired });
			if (res?.success) {
				this.global_chat_enabled = res.enabled;
				if (!res.enabled && this.selected_chat_conversation?.conversation_kind === 'global')
					this.close_chat_conversation();
				await refresh_chat_conversations();
			} else {
				this.member_actions_error = getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			}
			this.global_chat_participation_pending = false;
		},
	};
}
