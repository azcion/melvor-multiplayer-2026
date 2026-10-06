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
		set_instance_storage_item,
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
		is_alliance_process_active(proposal) {
			return ['local', 'waiting', 'recipient', 'collective'].includes(proposal.stage);
		},
		get_alliance_view() {
			const real = this.alliance_state;
			if (!this.guild_showcase || real.alliance || !this.alliance_access) return real;
			const now = Date.now(), day = 86400000;
			const ours = { ...this.guild_state.guild, member_count: this.guild_member_count, active_member_count: this.guild_active_member_count };
			const guild = (guild_id, name, member_count) => ({ guild_id, name, member_count, active_member_count: guild_id === -102 ? 0 : Math.max(1, member_count - 2), type: 'private', restricts_cheaters: guild_id === -101, market_discovery_restriction_enabled: false, icon_id: 'melvorD:Golbin', created_at: now - 80 * day, synthetic: true });
			const members = [ours, guild(-101, 'The Criminals', 12), guild(-102, 'The Copper Kettle', 8)];
			const process = (id, kind, stage, extra = {}) => ({ process_id: id, kind, name: 'Wandering Fellowship', stage,
				synthetic: true, governance_version: 2, expires_at: now + day, resolved_at: now - day, own_ballot: stage === 'denied' ? 'nay' : 'aye',
				tally: { eligible: 3, aye: 1, nay: 0 }, can_consider: false, can_withdraw: false, ...extra });
			const no_ballots = { own_ballot: null, tally: { eligible: 0, aye: 0, nay: 0 } };
			const history = [
				process(-204, 'found', 'accepted', { founding_guilds: members.slice(0, 2), ...no_ballots }),
				process(-205, 'remove', 'denied', { target_guild: members[2], tally: { eligible: 3, required_aye: 2, aye: 1, nay: 2 } }),
				process(-210, 'market_disable', 'accepted', { own_ballot: 'nay', tally: { eligible: 3, required_aye: 2, aye: 2, nay: 1 } }),
				process(-211, 'market_enable', 'cancelled', { resolution_reason: 'roster_changed' }),
				process(-212, 'found', 'cancelled', { name: 'Copperleaf Accord', founding_guilds: members.slice(0, 2), resolution_reason: 'affiliated_elsewhere', resolution_guild_name: members[1].name, ...no_ballots }),
				process(-213, 'found', 'cancelled', { name: 'Willow Compact', founding_guilds: [ours, guild(-105, 'Willow Hearth', 5)], resolution_reason: 'guild_unavailable', ...no_ballots }),
				process(-214, 'join', 'cancelled', { name: 'Silver Concord', display_kind: 'apply', applicant: ours, resolution_reason: 'alliance_unavailable', own_ballot: null, tally: { eligible: 3, required_aye: 2, aye: 0, nay: 0 } }),
				process(-215, 'remove', 'cancelled', { target_guild: members[2], resolution_reason: 'target_unavailable' }),
				process(-216, 'found', 'cancelled', { name: 'Wayfarer Pact', founding_guilds: members.slice(0, 2), resolution_reason: 'affiliated_elsewhere', ...no_ballots })
			];
			const processes = this.alliance_preview_affiliated ? [
				process(-201, 'join', 'collective', { applicant: guild(-103, 'Willow Wardens', 6), applicant_consent: 'granted' }),
				process(-202, 'join', 'collective', { applicant: guild(-104, 'Silver Dawn', 19), applicant_consent: 'active', tally: { eligible: 3, required_aye: 2, aye: 2, nay: 0 } }),
				process(-203, 'market_enable', 'collective'),
				process(-207, 'remove', 'collective', { target_guild: members[1], tally: { eligible: 3, aye: 1, nay: 1 } })
			] : [
				process(-206, 'found', 'waiting', { founding_guilds: members.slice(0, 2), own_council: 'granted', can_withdraw: true, ...no_ballots }),
				process(-208, 'found', 'waiting', { name: 'Copperleaf Accord', founding_guilds: [ours, guild(-103, 'Willow Wardens', 6)], own_council: null, can_consider: true, consider_blocked_reason: 'affiliation_pending', ...no_ballots })
			];
			processes.push(...history);
			return { ...real, synthetic: true, affiliation_pending: false, market_proposal_pending: processes.some(p => ['market_enable', 'market_disable'].includes(p.kind) && this.is_alliance_process_active(p)),
				alliance: this.alliance_preview_affiliated ? { id: -1, name: 'Wandering Fellowship', created_at: now - 42 * day, shared_marketplace: false, member_guilds: members } : null,
				processes: [...processes, ...real.processes] };
		},
		alliance_established_days() {
			return this.alliance_age(this.alliance_view.alliance) ?? 0;
		},
		async refresh_alliance() {
			if (!this.alliance_access || !this.is_guild_member) {
				this.alliance_state = { alliance: null, processes: [], affiliation_pending: false };
				this.alliance_error = '';
				runtime.update_guild_nav();
				return;
			}
			if (this.alliance_loading) return;
			this.alliance_loading = true;
			try {
				const res = await api_get('/api/alliances');
				if (res && !res.error && !res.error_lang) { this.alliance_state = res; this.alliance_error = ''; }
				else this.alliance_error = res?.error ?? getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			} finally { this.alliance_loading = false; runtime.update_guild_nav(); }
		},
		async show_alliance_confirmation(kind, target_id = null, process_id = null, picker = false) {
			if (!this.alliance_access || this.alliance_confirmation) return;
			this.alliance_confirmation = { kind, target_id, process_id, picker, synthetic: this.alliance_view?.synthetic === true };
			const confirmation = this.alliance_confirmation;
			this.alliance_modal = 'alliance-confirm-modal';
			const queued = queue_modal(picker ? this.alliance_picker_label(kind) : this.alliance_label(kind), 'alliance-confirm-modal', 'assets/multiplayer.svg', {
				customClass: { popup: 'mp-alliance-modal-popup' },
				showConfirmButton: false,
				didClose: () => {
					if (this.alliance_modal !== 'alliance-confirm-modal' || this.alliance_confirmation !== confirmation) return;
					this.alliance_modal = null;
					this.alliance_confirmation = null;
				}
			}, false);
			if (queued === false) { this.alliance_confirmation = null; this.alliance_modal = null; }
		},
		async close_alliance_confirmation() {
			const confirmation = this.alliance_confirmation;
			if (!confirmation || confirmation.closing) return;
			confirmation.closing = true;
			this.alliance_modal = null;
			await close_modal_and_wait('alliance-confirm-modal');
			if (this.alliance_confirmation === confirmation) this.alliance_confirmation = null;
		},
		async confirm_alliance_proposal(event) {
			const proposal = this.alliance_confirmation;
			const button = event.currentTarget;
			if (!proposal || proposal.closing) return;
			await this.close_alliance_confirmation();
			if (proposal.picker) await this.show_alliance_picker(proposal.kind);
			else if (!proposal.synthetic) await this.alliance_action({ currentTarget: button }, proposal.kind, proposal.target_id, proposal.process_id);
		},
		async show_alliance_picker(mode, page = 0) {
			if (!this.alliance_access) return;
			const previous_modal = this.alliance_modal;
			this.alliance_modal = null;
			if (previous_modal) await close_modal_and_wait(previous_modal);
			this.alliance_picker_mode = mode;
			this.alliance_error = '';
			const preview = this.alliance_view?.synthetic;
			const fixture_details = { type: 'private', created_at: Date.now() - 80 * 86400000, market_discovery_restriction_enabled: false };
			const fixture_guilds = [
				{ ...fixture_details, guild_id: -101, name: 'The Criminals', member_count: 12, active_member_count: 10, restricts_cheaters: true, icon_id: 'melvorD:Golbin', synthetic: true },
				{ ...fixture_details, guild_id: -102, name: 'The Copper Kettle', member_count: 8, active_member_count: 0, restricts_cheaters: false, icon_id: 'melvorD:Golbin', synthetic: true }
			];
			const res = preview ? { entries: mode === 'found' ? fixture_guilds : [
				{ id: -1, name: 'Wandering Fellowship', created_at: Date.now() - 42 * 86400000, shared_marketplace: false, member_guilds: fixture_guilds }
			], has_more: false } : await api_get('/api/alliances/discover?mode=' + mode + '&page=' + page);
			if (!res) return notify_error('MOD_MP_GENERIC_ERR');
			this.alliance_picker_entries = (res.entries ?? []).filter(entry => mode !== 'found' || entry.guild_id !== this.guild_state?.guild?.guild_id);
			this.alliance_picker_page = page;
			this.alliance_picker_has_more = res.has_more === true;
			this.alliance_modal = 'alliance-picker-modal';
			queue_modal(mode === 'found' ? 'MOD_MP_ALLIANCE_FOUND' : 'MOD_MP_ALLIANCE_APPLY', 'alliance-picker-modal', 'assets/multiplayer.svg', { customClass: { popup: 'mp-alliance-modal-popup' }, showConfirmButton: false, didClose: () => { if (this.alliance_modal === 'alliance-picker-modal') this.alliance_modal = null; } });
		},
		async preview_alliance_guild(guild_id, restore_picker = false) {
			if (!this.alliance_access) return;
			const view = this.alliance_view;
			const fixture = [...(this.alliance_picker_entries ?? []).flatMap(entry => entry.member_guilds ?? [entry]), ...(view?.alliance?.member_guilds ?? []), ...(view?.processes ?? []).flatMap(p =>
				[...(p.founding_guilds ?? []), p.applicant, p.target_guild]).filter(Boolean)].find(g => g.guild_id === guild_id);
			if (guild_id < 0 && !fixture?.synthetic) return;
			const res = fixture?.synthetic ? { guild: fixture } : await api_get('/api/alliances/guild-preview?guild_id=' + guild_id);
			if (!res?.guild) return notify_error('MOD_MP_GENERIC_ERR');
			const previous_modal = this.alliance_modal;
			this.alliance_modal = null;
			if (previous_modal) await close_modal_and_wait(previous_modal);
			this.alliance_preview = res.guild;
			this.alliance_preview_restore_picker = restore_picker;
			this.alliance_modal = 'alliance-preview-modal';
			queue_modal(res.guild.name, 'alliance-preview-modal', this.get_guild_icon(res.guild.icon_id), {
				customClass: { popup: 'mp-alliance-modal-popup' },
				showConfirmButton: false,
				didClose: () => {
					if (this.alliance_modal !== 'alliance-preview-modal') return;
					this.alliance_modal = null;
					if (this.alliance_preview_restore_picker) void this.show_alliance_picker(this.alliance_picker_mode, this.alliance_picker_page);
				}
			}, false, false);
		},
		close_alliance_picker() { this.alliance_modal = null; close_modal(); },
		async close_alliance_preview() {
			const restore = this.alliance_preview_restore_picker;
			const previous_modal = this.alliance_modal;
			this.alliance_modal = null;
			if (previous_modal) await close_modal_and_wait(previous_modal);
			if (restore) await this.show_alliance_picker(this.alliance_picker_mode, this.alliance_picker_page);
		},
		async alliance_action(event, kind, target_id = null, process_id = null) {
			if (!this.alliance_access) return;
			const alliance_name = this.alliance_name_input.trim();
			if (process_id === null && kind === 'found' && (alliance_name.length === 0 || alliance_name.length > 20)) {
				this.alliance_error = getLangString('MOD_MP_ALLIANCE_NAME_REQUIRED');
				return;
			}
			if (this.alliance_view?.synthetic || target_id < 0 || process_id < 0) {
				if (this.alliance_modal) {
					const modal = this.alliance_modal;
					this.alliance_modal = null;
					await close_modal_and_wait(modal);
				}
				return notify('MOD_MP_ALLIANCE_PREVIEW_CONFIRM_HINT', 'info');
			}
			const button = event.currentTarget;
			if (is_button_spinning(button)) return;
			show_button_spinner(button);
			this.alliance_error = '';
			try {
				const res = await api_post('/api/alliances/' + (process_id === null ? 'propose' : kind),
					process_id === null ? { kind, ...(target_id === null ? {} : {target_id}), ...(kind === 'found' ? {name:alliance_name} : {}) } : {process_id});
				if (!res?.success) { this.alliance_error = res?.error ?? getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR'); return; }
				if (this.alliance_modal) await close_modal_and_wait(this.alliance_modal);
				this.alliance_modal = null;
				await Promise.all([this.refresh_alliance(), refresh_council()]);
			} finally { hide_button_spinner(button); }
		},
		alliance_picker_label(mode) { return getLangString(mode === 'found' ? 'MOD_MP_ALLIANCE_FOUND' : 'MOD_MP_ALLIANCE_APPLY'); },
		alliance_age(alliance) {
			const created = alliance?.created_at ?? alliance?.established_at;
			return Number.isFinite(created) ? Math.max(0, Math.floor((Date.now() - created) / 86400000)) : null;
		},
		alliance_members_text(alliance) {
			const guilds = alliance?.member_guilds ?? [];
			const members = guilds.reduce((sum, guild) => sum + (guild.member_count ?? 0), 0);
			const active = guilds.reduce((sum, guild) => sum + (guild.active_member_count ?? 0), 0);
			return getLangString(active !== members ? members === 1 ? 'MOD_MP_GUILD_MEMBER_ACTIVE_COUNT_ONE' : 'MOD_MP_GUILD_MEMBER_ACTIVE_COUNT' : members === 1 ? 'MOD_MP_GUILD_MEMBER_COUNT_ONE' : 'MOD_MP_GUILD_MEMBER_COUNT')
				.replace('%s', members).replace('%s', active);
		},
		alliance_guild_count_text(alliance) {
			const guilds = alliance?.member_guilds ?? [];
			const active = guilds.filter(guild => (guild.active_member_count ?? 0) > 0 || guild.type === 'free_fellowship').length;
			return getLangString(active !== guilds.length ? guilds.length === 1 ? 'MOD_MP_ALLIANCE_GUILD_ACTIVE_COUNT_ONE' : 'MOD_MP_ALLIANCE_GUILD_ACTIVE_COUNT' : guilds.length === 1 ? 'MOD_MP_ALLIANCE_GUILD_COUNT_ONE' : 'MOD_MP_ALLIANCE_GUILD_COUNT')
				.replace('%s', guilds.length).replace('%s', active);
		},
		alliance_label(kind) { return getLangString('MOD_MP_ALLIANCE_' + String(kind ?? 'ballot').toUpperCase()); },
		async resolve_alliance_petition_guilds(petitions) {
			if (!this.alliance_access) return;
			const guilds = new Map();
			for (const guild of this.alliance_state?.alliance?.member_guilds ?? []) guilds.set(guild.guild_id, guild);
			for (const process of this.alliance_state?.processes ?? []) {
				for (const guild of [...(process.founding_guilds ?? []), process.applicant, process.target_guild])
					if (guild) guilds.set(guild.guild_id, guild);
			}
			const ids = [...new Set(petitions.flatMap(p => p.type.startsWith('alliance_') ? p.proposal.guild_ids ?? [] : []))];
			// Bound concurrent reads; preview failures must not hide the Council itself.
			for (let offset = 0; offset < ids.length; offset += 4) {
				await Promise.all(ids.slice(offset, offset + 4).map(async id => {
					if (guilds.has(id)) return;
					try {
						const res = await api_get('/api/alliances/guild-preview?guild_id=' + id);
						if (res?.guild) guilds.set(id, res.guild);
					} catch { /* Keep unavailable Guilds out of the preview links. */ }
				}));
			}
			for (const petition of petitions)
				if (petition.type.startsWith('alliance_')) {
					petition.proposal.guilds = (petition.proposal.guild_ids ?? []).map(id => guilds.get(id)).filter(Boolean);
					if (petition.synthetic && !petition.proposal.guilds.length)
						petition.proposal.guilds = [[...guilds.values()].find(guild => guild.guild_id !== this.guild_state?.guild?.guild_id) ?? { name: getLangString('MOD_MP_ALLIANCE_SYNTHETIC_GUILD') }];
					if (petition.synthetic && ['withdraw', 'ballot'].includes(petition.proposal.kind)) petition.proposal.kind = 'found';
				}
		},
		alliance_proposal_heading(kind) {
			return getLangString('MOD_MP_ALLIANCE_HEADING_' + String(kind ?? 'ballot').toUpperCase());
		},
		alliance_petition_kind(petition) {
			const action = petition.type.slice(9);
			return ['consider', 'withdraw'].includes(action) ? action : petition.proposal.kind ?? action;
		},
		alliance_proposal_parts(proposal, kind = proposal.display_kind ?? proposal.kind) {
			const name = proposal.name || this.alliance_state?.alliance?.name || getLangString('MOD_MP_ALLIANCE_UNNAMED');
			const guilds = (proposal.guilds ?? proposal.founding_guilds ?? (proposal.applicant ? [proposal.applicant] : proposal.target_guild ? [proposal.target_guild] : []))
				.filter(guild => guild && (!['found', 'consider'].includes(kind) || guild.guild_id !== this.guild_state?.guild?.guild_id));
			const parts = [];
			const text = getLangString(proposal.governance_version === 2 && kind === 'consider' ? 'MOD_MP_ALLIANCE_PARALLEL_DESCRIPTION_CONSIDER' : 'MOD_MP_ALLIANCE_DESCRIPTION_' + String(kind ?? 'ballot').toUpperCase());
			for (const piece of text.split(/(\{alliance\}|\{guilds\}|\{proposal\})/)) {
				if (piece === '{alliance}') parts.push({ text: name, bold: true });
				else if (piece === '{guilds}') {
					const targets = guilds.length ? guilds : [{ name: getLangString('MOD_MP_ALLIANCE_UNKNOWN_GUILD') }];
					for (const [index, guild] of targets.entries()) {
						if (index) parts.push({ text: ', ' });
						parts.push({ text: guild.name, bold: true, guild_id: guild.guild_id });
					}
				} else if (piece === '{proposal}') {
					const action = ['withdraw', 'ballot'].includes(proposal.kind) ? 'ballot' : proposal.kind === 'join' ? 'apply' : proposal.kind;
					parts.push(...this.alliance_proposal_parts(proposal, action));
				} else if (piece) parts.push({ text: piece });
			}
			return parts;
		},
		alliance_proposal_description(proposal, kind = proposal.display_kind ?? proposal.kind) {
			return this.alliance_proposal_parts(proposal, kind).map(part => part.text).join('');
		},
		alliance_petition_collective(petition) {
			return petition.type === 'alliance_ballot' || ['join', 'remove', 'market_enable', 'market_disable'].includes(this.alliance_petition_kind(petition));
		},
		alliance_outcome(stage) { return getLangString('MOD_MP_ALLIANCE_OUTCOME_' + stage.toUpperCase()); },
		guild_preview_established() {
			const guild = this.alliance_preview;
			const created = guild?.created_at ?? guild?.established_at;
			return Number.isFinite(created) ? Math.max(0, Math.floor((Date.now() - created) / 86400000)) : null;
		},
		alliance_confirmation_hint() {
			const kind = this.alliance_confirmation?.kind;
			const key = ['found', 'consider'].includes(kind) ? 'MOD_MP_ALLIANCE_CONFIRM_FOUNDING'
				: kind === 'join' ? 'MOD_MP_ALLIANCE_CONFIRM_ADMISSION'
				: kind === 'leave' ? 'MOD_MP_ALLIANCE_CONFIRM_LEAVING'
				: kind === 'withdraw' ? 'MOD_MP_ALLIANCE_CONFIRM_WITHDRAWAL'
				: 'MOD_MP_ALLIANCE_CONFIRM_COLLECTIVE';
			return getLangString(key);
		},
		alliance_market_pending() {
			return this.alliance_view?.market_proposal_pending ?? (this.alliance_view?.processes ?? []).some(p =>
				['market_enable', 'market_disable'].includes(p.kind) && this.is_alliance_process_active(p));
		},
		alliance_proposal_status(proposal) {
			if (proposal.governance_version === 2 && this.is_alliance_process_active(proposal)) {
				if (proposal.kind === 'found') return getLangString(proposal.own_council === 'granted'
					? 'MOD_MP_ALLIANCE_FOUNDING_OTHER_COUNCIL' : 'MOD_MP_ALLIANCE_FOUNDING_COUNCILS');
				if (proposal.kind === 'join' && proposal.tally?.aye >= proposal.tally?.required_aye && proposal.applicant_consent !== 'granted')
					return getLangString('MOD_MP_ALLIANCE_AWAITING_APPLICANT_CONSENT');
			}
			return this.alliance_stage(proposal.stage);
		},
		alliance_cancellation_parts(proposal) {
			if (proposal.stage !== 'cancelled') return [];
			const keys = { roster_changed: 'MOD_MP_ALLIANCE_CANCEL_ROSTER', guild_unavailable: 'MOD_MP_ALLIANCE_CANCEL_GUILD',
				alliance_unavailable: 'MOD_MP_ALLIANCE_CANCEL_ALLIANCE', target_unavailable: 'MOD_MP_ALLIANCE_CANCEL_TARGET',
				affiliated_elsewhere: proposal.resolution_guild_name ? 'MOD_MP_ALLIANCE_CANCEL_AFFILIATED_GUILD' : 'MOD_MP_ALLIANCE_CANCEL_AFFILIATED' };
			const key = keys[proposal.resolution_reason];
			if (!key) return [];
			return getLangString(key).split(/(\{guild\})/).map(text => text === '{guild}'
				? { text: proposal.resolution_guild_name, bold: true } : { text });
		},
		alliance_stage(stage) { return getLangString('MOD_MP_ALLIANCE_STAGE_' + stage.toUpperCase()); },
		alliance_guild_tags(guild) {
			if (!guild) return [];
			return [guild.type === 'free_fellowship' ? getLangString('MOD_MP_ALLIANCE_FREE_FELLOWSHIP') : guild.type === 'public' ? getLangString('MOD_MP_GUILD_OPEN') : getLangString('MOD_MP_GUILD_PRIVATE'),
				guild.restricts_cheaters ? getLangString('MOD_MP_ALLIANCE_RESTRICTS_CHEATERS') : '',
				guild.market_discovery_restriction_enabled ? getLangString('MOD_MP_COUNCIL_TYPE_TEMPERANCE') : ''].filter(Boolean);
		},
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
				showConfirmButton: false,
				customClass: { popup: 'mp-name-input-modal-popup' }
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

		show_icon_modal(show_default_avatar_prompt = false) {
			this.close_account_dropdown();
			setup_icons();

			state.picked_icon = '';
			state.show_icon_prompt_info = show_default_avatar_prompt;

			queue_modal(game.characterName, 'change-icon-modal', this.get_avatar_icon(state.profile_icon), {
				showConfirmButton: false,
				customClass: { popup: 'mp-icon-picker-modal-popup' },
				didClose: () => {
					if (show_default_avatar_prompt)
						set_instance_storage_item('default_avatar_prompt_shown', true);
					state.show_icon_prompt_info = false;
				}
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
				showConfirmButton: false,
				customClass: { popup: 'mp-shadowed-members-modal-popup' }
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
			if (application.synthetic || application.application_id < 0) {
				this.guild_preview_decided_applications = [...(this.guild_preview_decided_applications ?? []), application.application_id];
				return;
			}
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
			await Promise.all([refresh_council(), refresh_shadowed_members(0, '')]);
			queue_modal('MOD_MP_COUNCIL_RAISE', 'council-raise-modal', 'assets/multiplayer.svg', {
				showConfirmButton: false
			});
		},

		show_council_petition_modal(type) {
			if (is_social_only() && (type.startsWith('charitree_') || type.startsWith('crucible_')))
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
				customClass: { popup: ['heraldry', 'banishment'].includes(type) ? 'mp-native-scroll-modal-popup' : '' },
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
			if (is_social_only() && (type.startsWith('charitree_') || type.startsWith('crucible_')))
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
			await Promise.all([refresh_guild_state(), refresh_council(), this.refresh_alliance()]);
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
			return type.startsWith('alliance_') ? this.alliance_proposal_heading(type.slice(9)) : getLangString('MOD_MP_COUNCIL_TYPE_' + type.toUpperCase());
		},

		can_raise_council_petition(type) {
			return this.council_available_petition_types.includes(type) &&
				(!is_social_only() || (!type.startsWith('charitree_') && !type.startsWith('crucible_')));
		},

		get_council_action_key(type) {
			return type.startsWith('charitree_') ? type.replace('charitree_', '').toUpperCase() : type.toUpperCase();
		},

		get_council_description_lang_id(type) {
			return 'MOD_MP_COUNCIL_' + this.get_council_action_key(type) + '_DESCRIPTION';
		},

		get_council_action_confirm(type) {
			return getLangString('MOD_MP_COUNCIL_' + this.get_council_action_key(type) + '_CONFIRM');
		},

		get_council_action_proposal(type) {
			return type.startsWith('alliance_') ? this.alliance_label(type.slice(9)) : getLangString('MOD_MP_COUNCIL_' + this.get_council_action_key(type) + '_PROPOSAL');
		},

		get_council_outcome_lang(lifecycle) {
			return getLangString('MOD_MP_COUNCIL_OUTCOME_' + lifecycle.toUpperCase());
		},

		get_council_choice_lang(choice) {
			return getLangString(choice === 'aye' ? 'MOD_MP_COUNCIL_VOTED_AYE' : 'MOD_MP_COUNCIL_VOTED_NAY');
		},

		get_council_execution_lang(execution_state) {
			return execution_state === 'failed'
				? getLangString('MOD_MP_COUNCIL_ACTION_DELAYED')
				: getLangString('MOD_MP_COUNCIL_ACTION_PENDING');
		},

		get_council_tally_width(petition, choice) {
			if (!petition.tally || petition.tally.eligible === 0)
				return '0%';
			const count = choice === 'uncast' ? Math.max(0, petition.tally.eligible - petition.tally.aye - petition.tally.nay) : petition.tally[choice];
			return (count / petition.tally.eligible * 100) + '%';
		},

		get_tally_threshold(petition, alliance = false) {
			const eligible = petition.tally?.eligible ?? 0;
			if (!eligible) return '0%';
			const required = petition.tally.required_aye ?? (alliance
				? Math.floor(eligible / 2) + 1
				: Math.ceil(eligible / 2));
			return Math.min(100, required / eligible * 100) + '%';
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
