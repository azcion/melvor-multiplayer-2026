export function install_trading_actions(runtime) {
	const {
		state,
		GIFT_FLAG_RETURNED,
		MARKET_ITEMS_PER_PAGE,
		TRANSFER_INVENTORY_MAX_LIMIT,
		api_get,
		api_post,
		add_gp_to_transfer,
		capture_equipment_snapshot,
		capture_status_snapshot,
		charitree_rules,
		changePage,
		close_account_dropdown,
		close_modal_and_wait,
		crypto,
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
		start_status_observer,
		stop_status_observer,
		trade_returns,
		transfer_inventory,
		update_campaign_nav,
		update_market_listings,
		update_market_page,
		update_market_search,
		update_multiplayer_nav,
		update_transfer_contents,
	} = runtime;

	return {
		// #region TRADE ACTIONS
		async create_trade() {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
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

		async select_trade_recipient(event, recipient) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			const $button = event.currentTarget;
			if (is_button_spinning($button))
				return;

			show_button_spinner($button);

			const res = await api_post('/api/trade/offer', {
				recipient_id: recipient.client_id,
				items: state.transfer_inventory,
				command_id: crypto.randomUUID()
			});
			hide_button_spinner($button);

			if (res?.success && await reconcile_economy_receipts([res.receipt])) {
				this.close_modal();
				state.trades.push({
					trade_id: res.trade_id,
					state: 0,
					data: null
				});
				update_multiplayer_nav();

				update_transfer_contents();
				return;
			}

			show_modal_error(getLangString(res?.error_lang ?? 'MOD_MP_GENERIC_ERR'));
		},

		get_trade_items_value(items) {
			let total_value = 0;

			for (const entry of items) {
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

		filter_trade_items_home(trade) {
			return trade.data.items.filter(item => item.counter === (trade.attending ? 0 : 1));
		},

		filter_trade_items_away(trade) {
			return trade.data.items.filter(item => item.counter === (trade.attending ? 1 : 0));
		},

		async counter_trade(event, trade_id, confirmed = false) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			const trade = state.trades.find(t => t.trade_id === trade_id);
			if (!trade)
				return;

			const $button = event.currentTarget;
			if (is_button_spinning($button))
				return;
			if (!confirmed)
				return this.show_transfer_confirmation('counter_trade', trade_id);

			show_button_spinner($button);

			const res = await api_post('/api/trade/counter', {
				trade_id,
				items: state.transfer_inventory,
				command_id: crypto.randomUUID()
			});

			hide_button_spinner($button);

			if (res?.success && await reconcile_economy_receipts([res.receipt])) {
				state.trades = state.trades.filter(t => t.trade_id !== trade_id);
				update_multiplayer_nav();

				// this needs to happen on the next tick to prevent petite-vue breaking
				// bug: https://github.com/vuejs/core/issues/5657 (element hoisting is not a good solution)
				setTimeout(() => {
					state.trades.push({
						trade_id,
						state: 1,
						attending: false,
						data: null
					});
					update_multiplayer_nav();

					update_transfer_contents();
				}, 1);

			} else {
				notify_error('MOD_MP_GENERIC_ERR');
			}
		},

		async resolve_trade(event, trade_id) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			// prevent resolving a trade with no local data
			const trade = state.resolved_trades.find(t => t.trade_id === trade_id);
			if (!trade?.data)
				return;

			const $button = event.currentTarget;
			if (is_button_spinning($button))
				return;

			show_button_spinner($button);

			const res = await api_post('/api/trade/resolve', { trade_id, command_id: crypto.randomUUID() });

			hide_button_spinner($button);

			if (res?.success === true && await reconcile_economy_receipts([res.receipt])) {
				state.resolved_trades = state.resolved_trades.filter(trade => trade.trade_id !== trade_id);
				update_multiplayer_nav();
			} else {
				notify_error('MOD_MP_GENERIC_ERR');
			}
		},

		async decline_trade(event, trade_id, confirmed = false) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			// prevent declining a trade with no local data
			const trade = state.trades.find(t => t.trade_id === trade_id);
			if (!trade?.data)
				return;

			const $button = event.currentTarget;
			if (is_button_spinning($button))
				return;
			if (!confirmed)
				return this.show_transfer_confirmation('decline_trade', trade_id);

			show_button_spinner($button);

			const res = await api_post('/api/trade/decline', { trade_id, command_id: crypto.randomUUID() });
			hide_button_spinner($button);

			if (res?.success === true && (res.receipt === undefined || await reconcile_economy_receipts([res.receipt]))) {
				state.trades = state.trades.filter(trade => trade.trade_id !== trade_id);
				update_multiplayer_nav();
			} else {
				notify_error('MOD_MP_GENERIC_ERR');
			}
		},

		async accept_trade(event, trade_id) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			// prevent accepting a trade with no local data
			const trade = state.trades.find(t => t.trade_id === trade_id);
			if (!trade?.data)
				return;

			const $button = event.currentTarget;
			if (is_button_spinning($button))
				return;

			show_button_spinner($button);

			const res = await api_post('/api/trade/accept', { trade_id, command_id: crypto.randomUUID() });
			hide_button_spinner($button);

			if (res?.success === true && await reconcile_economy_receipts([res.receipt])) {
				state.trades = state.trades.filter(trade => trade.trade_id !== trade_id);
				update_multiplayer_nav();
			} else {
				notify_error('MOD_MP_GENERIC_ERR');
			}
		},

		async cancel_trade(event, trade_id, confirmed = false) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			// prevent cancelling a trade with no local data
			const trade = state.trades.find(t => t.trade_id === trade_id);
			if (!trade?.data)
				return;

			const $button = event.currentTarget;
			if (is_button_spinning($button))
				return;
			if (!confirmed)
				return this.show_transfer_confirmation('cancel_trade', trade_id);

			show_button_spinner($button);

			const res = await api_post('/api/trade/cancel', { trade_id, command_id: crypto.randomUUID() });
			hide_button_spinner($button);

			if (res?.success === true && (res.receipt === undefined || await reconcile_economy_receipts([res.receipt]))) {
				trade_returns.complete_trade_cancellation(state, trade_id);
				update_multiplayer_nav();
			} else {
				notify_error('MOD_MP_GENERIC_ERR');
			}
		},
		// #endregion

		// #region GIFT ACTIONS
		is_returned_gift(gift) {
			return (gift.data.flags & GIFT_FLAG_RETURNED) !== 0;
		},

		show_discard_returned_gift_confirmation(gift_id) {
			this.unsupported_returned_gift_id = gift_id;
			this.unsupported_returned_gift_command_id = crypto.randomUUID();
			queue_modal('MOD_MP_DISCARD_RETURNED_GIFT_TITLE', 'discard-returned-gift-modal',
				'assets/media/bank/present.png', { showConfirmButton: false });
		},

		async discard_returned_gift(event) {
			const gift_id = this.unsupported_returned_gift_id;
			const command_id = this.unsupported_returned_gift_command_id;
			if (!Number.isSafeInteger(gift_id) || command_id.length === 0 || is_button_spinning(event.currentTarget))
				return;

			show_button_spinner(event.currentTarget);
			const res = await api_post('/api/gift/discard', { gift_id, command_id });
			if (res?.success && await reconcile_economy_receipts([res.receipt])) {
				this.gifts = this.gifts.filter(gift => gift.id !== gift_id);
				update_multiplayer_nav();
				this.unsupported_returned_gift_id = null;
				this.unsupported_returned_gift_command_id = '';
				this.close_modal();
				notify('MOD_MP_DISCARD_RETURNED_GIFT_COMPLETE');
				return;
			}

			hide_button_spinner(event.currentTarget);
			notify_error('MOD_MP_GENERIC_ERR');
		},

		async resolve_gift(event, gift_id, accept, confirmed = false) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			const $button = event.currentTarget;

			if (is_button_spinning($button))
				return;

			const gift = this.gifts.find(g => g.id === gift_id);
			if (gift === undefined)
				return notify_error('MOD_MP_GENERIC_ERR');
			if (!accept && !confirmed)
				return this.show_transfer_confirmation('decline_gift', gift_id);

			show_button_spinner($button);

			const res = await api_post(accept ? '/api/gift/accept' : '/api/gift/decline', {
				gift_id,
				command_id: crypto.randomUUID()
			});
			hide_button_spinner($button);

			if (res?.success && (res.receipt === undefined || await reconcile_economy_receipts([res.receipt]))) {
				this.gifts = this.gifts.filter(g => g.id !== gift_id);
				update_multiplayer_nav();
			} else {
				notify_error('MOD_MP_GENERIC_ERR');
			}
		},

		async gift_friend() {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
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
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			this.close_modal();

			state.gifting_recipient = recipient;

			queue_modal('MOD_MP_TITLE_CONFIRM_GIFT_RECIPIENT', 'confirm-gift-recipient-modal', 'assets/media/bank/present.png', {
				showConfirmButton: false
			}, true, false);
		},

		async confirm_gift(event) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			const $button = event.currentTarget;

			if (is_button_spinning($button))
				return;

			show_button_spinner($button);
			const recipient_id = state.gifting_recipient.client_id;

			const res = await api_post('/api/gift/send', {
				recipient_id,
				items: state.transfer_inventory,
				command_id: crypto.randomUUID()
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

			if (!await reconcile_economy_receipts([res.receipt])) {
				hide_button_spinner($button);
				return show_modal_error(getLangString('MOD_MP_GENERIC_ERR'));
			}

			hide_button_spinner($button);

			notify('MOD_MP_NOTIF_GIFT_SENT');
			state.close_modal();
		},
		// #endregion
	};
}
