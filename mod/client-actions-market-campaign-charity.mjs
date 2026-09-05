export function install_market_campaign_charity_actions(runtime) {
	const {
		state,
		GIFT_FLAG_RETURNED,
		MARKET_ITEMS_PER_PAGE,
		api_get,
		api_post,
		add_gp_to_transfer,
		apply_charity_state,
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
		is_social_only,
		is_transfer_currency,
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
		show_button_spinner,
		show_modal_error,
		start_status_observer,
		stop_status_observer,
		trade_returns,
		transfer_currency_support,
		transfer_inventory,
		update_campaign_nav,
		update_charitree_nav,
		update_market_listings,
		update_market_haggles,
		update_market_page,
		update_market_search,
		update_transfer_contents,
	} = runtime;
	const get_charity_rule_options = function () {
		return {
			get_currency: item_id => transfer_currency_support?.get_transfer_currency(game, item_id)?.currency ?? null,
			get_supported_currency: currency => transfer_currency_support?.get_transfer_currency_for_currency(game, currency)?.currency ?? null,
			get_currency_amount: currency => currency?.amount,
			get_item: item_id => game.items.getObjectByID(item_id),
			get_sale_price: (game_item, qty) => game.bank.getItemSalePrice(game_item, qty),
			is_discovered: item_id => this.is_charity_item_discovered(item_id)
		};
	};

	return {
		clear_market_filter() {
			this.market_filter_item = null;
			state.market_page_first(true);
		},

		choose_market_filter() {
			this.market_active_tab = 'filter';
			this.market_filter_search = '';

			if (!runtime.has_sorted_market_filter_items)
				load_market_filter_items();

			setTimeout(() => $('mp-market-filter-input').focus(), 1);
		},

		select_market_filter_item(item_id) {
			if (state.market_active_tab === 'create-filter') {
				const item = game.items.getObjectByID(item_id);
				state.market_create_item = item_id;
				state.market_create_price = item ? game.bank.getItemSalePrice(item) : 1;
				state.market_active_tab = 'create';
				return;
			}

			state.market_filter_item = item_id;
			state.market_active_tab = 'search';
			state.market_page_first(true);
		},

		choose_market_create_item() {
			this.market_active_tab = 'create-filter';
			this.market_filter_search = '';

			if (!runtime.has_sorted_market_filter_items)
				load_market_filter_items();

			setTimeout(() => $('mp-market-create-filter-input').focus(), 1);
		},

		switch_market_direction(direction) {
			if (direction !== 'sell' && direction !== 'buy')
				return;

			this.market_direction = direction;
			this.market_sort = 'recent';
			this.market_results = [];
			this.market_total_items = 0;
			this.market_page_first(true);
		},

		switch_market_listing_direction(direction) {
			if (direction !== 'sell' && direction !== 'buy')
				return;

			this.market_listing_direction = direction;
		},

		set_item_slider_max() {
			document.querySelector('mp-item-slider')?.set_max();
		},

		show_market_buy_modal(item) {
			this.market_buy_item = item;

			const item_name = this.get_item_name(item.item_id);
			queue_modal(getLangString('MOD_MP_MARKET_BUY_MODAL_TITLE') + item_name, 'market-buy-modal', this.get_item_icon(item.item_id), {
				showConfirmButton: false
			}, false, false);
		},

		async buy_market_item(event) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
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
				qty: state.item_slider_value,
				command_id: crypto.randomUUID()
			});

			const purchase_succeeded = res?.success && await reconcile_economy_receipts([res.receipt]);
			if (purchase_succeeded) {
				hide_button_spinner($button);
				await this.close_modal_and_wait('market-buy-modal');

				if (res.new_item_qty > 0) {
					state.market_buy_item.available = res.new_item_qty;
				} else {
					remove_sold_out_market_result(state, state.market_buy_item.id, MARKET_ITEMS_PER_PAGE);
					await update_market_search();
				}
			} else {
				notify_error(res?.error_lang ?? 'MOD_MP_MARKET_BUY_ERROR');
			}

			if (!purchase_succeeded) {
				hide_button_spinner($button);
				this.close_modal();
			}
		},

		show_market_fulfill_modal(item) {
			this.market_fulfill_item = item;

			const item_name = this.get_item_name(item.item_id);
			queue_modal(item_name, 'market-fulfill-modal', this.get_item_icon(item.item_id), {
				showConfirmButton: false,
				didOpen: () => {
					const $title = document.getElementById('swal2-title');
					if (!$title)
						return;

					const $prefix = document.createElement('span');
					$prefix.className = 'mp-market-fulfill-modal-title-prefix';
					$prefix.textContent = getLangString('MOD_MP_MARKET_FULFILL_MODAL_TITLE');
					$title.prepend($prefix);
				}
			}, false, false);
		},

		async fulfill_market_order(event) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			const $button = event.currentTarget;

			if (is_button_spinning($button))
				return;

			if (!state.market_fulfill_item)
				return notify_error('MOD_MP_GENERIC_ERR');

			if (state.item_slider_value <= 0)
				return notify_error('MOD_MP_MARKET_FULFILL_NOTHING');

			const item = game.items.getObjectByID(state.market_fulfill_item.item_id);
		if (!item)
			return notify_error('MOD_MP_MARKET_BUY_ERROR_UNKNOWN');

		if (game.bank.getQty(item) < state.item_slider_value)
			return notify_error('MOD_MP_MARKET_NOT_ENOUGH_ITEM');

		show_button_spinner($button);
		const res = await api_post('/api/market/fulfill', {
			id: state.market_fulfill_item.id,
			qty: state.item_slider_value,
			command_id: crypto.randomUUID()
		});
		const fulfillment_succeeded = res?.success && await reconcile_economy_receipts([res.receipt]);
		if (fulfillment_succeeded) {
			await this.close_modal_and_wait('market-fulfill-modal');
			if (res.new_item_qty > 0)
				state.market_fulfill_item.available = res.new_item_qty;
			else
				remove_sold_out_market_result(state, state.market_fulfill_item.id, MARKET_ITEMS_PER_PAGE);
			await update_market_search();
		} else {
			notify_error(res?.error_lang ?? 'MOD_MP_MARKET_FULFILL_ERROR');
			this.close_modal();
		}
		hide_button_spinner($button);
		},

		async create_market_buy_order(event) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			const $button = event.currentTarget;
			if (is_button_spinning($button))
				return;

			const item = this.market_create_item && game.items.getObjectByID(this.market_create_item);
		if (!item)
			return notify_error('MOD_MP_MARKET_CREATE_ITEM_REQUIRED');

			const item_qty = Number(this.market_create_qty);
			const item_buy_price = Number(this.market_create_price);
			const total = item_qty * item_buy_price;
			if (!Number.isSafeInteger(item_qty) || item_qty <= 0)
				return notify_error('MOD_MP_MARKET_CANNOT_BUY_NOTHING');
			if (!Number.isSafeInteger(item_buy_price) || item_buy_price <= 0)
				return notify_error('MOD_MP_MARKET_CANNOT_BUY_FREE');
			if (!Number.isSafeInteger(total))
				return notify_error('MOD_MP_MARKET_VALUE_TOO_LARGE');
			if (game.gp.amount < total)
				return notify_error('MOD_MP_MARKET_INSUFFICIENT_GP');

			show_button_spinner($button);
			const res = await api_post('/api/market/buy-order', {
				item_id: item.id,
				item_qty,
				item_buy_price,
				command_id: crypto.randomUUID()
			});
			if (res?.success && await reconcile_economy_receipts([res.receipt])) {
				queue_modal('MOD_MP_MARKET_BUY_ORDER_CREATED_TITLE', 'market-buy-order-created-modal', 'assets/market.svg', {
					showConfirmButton: false
				});
				this.market_create_qty = 1;
				this.market_create_price = game.bank.getItemSalePrice(item);
				if (this.market_active_tab === 'listing')
					await update_market_listings();
			} else {
				notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			}
			hide_button_spinner($button);
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
			state.market_sort = state.market_sort === 'recent' ? 'price' : 'recent';
			update_market_search();
		},

		open_market_tab() {
			this.market_active_tab = 'search';
			update_market_search();
		},

		open_listing_tab() {
			this.market_active_tab = 'listing';
			update_market_listings();
		},

		show_market_haggle_modal(item) {
			this.market_haggle_item = item;
			this.market_haggle_price = item.price;
			queue_modal(getLangString('MOD_MP_MARKET_HAGGLE_TITLE'), 'market-haggle-modal',
				this.get_item_icon(item.item_id), { showConfirmButton: false }, false, false);
		},

		async create_market_haggle(event) {
			const item = this.market_haggle_item;
			const qty = this.item_slider_value;
			const price = Number(this.market_haggle_price);
			if (!item || !Number.isSafeInteger(qty) || qty <= 0 || !Number.isSafeInteger(price) || price <= 0)
				return notify_error('MOD_MP_MARKET_HAGGLE_INVALID');
			if (!Number.isSafeInteger(qty * price))
				return notify_error('MOD_MP_MARKET_VALUE_TOO_LARGE');
			const local_item = game.items.getObjectByID(item.item_id);
			if (item.direction === 'sell' && game.gp.amount < qty * price)
				return notify_error('MOD_MP_MARKET_INSUFFICIENT_GP');
			if (item.direction === 'buy' && (!local_item || game.bank.getQty(local_item) < qty))
				return notify_error('MOD_MP_MARKET_NOT_ENOUGH_ITEM');
			const $button = event.currentTarget;
			show_button_spinner($button);
			const res = await api_post('/api/market/haggle', { id: item.id, qty, price, command_id: crypto.randomUUID() });
			if (res?.success && await reconcile_economy_receipts([res.receipt])) {
				await close_modal_and_wait('market-haggle-modal');
				await update_market_search();
				await update_market_haggles();
			} else
				notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			hide_button_spinner($button);
		},

		async respond_market_haggle(event, haggle, action, from_modal = false, from_confirmation = false) {
			const $button = event.currentTarget;
			if (is_button_spinning($button))
				return;
			if (action === 'terminate' && !from_confirmation) {
				this.show_transfer_confirmation(!haggle.is_initiator && haggle.is_turn ? 'reject_haggle' : 'cancel_haggle', haggle);
				return;
			}
			if (action === 'counter' && !from_modal) {
				this.market_haggle_counter = haggle;
				this.market_haggle_price = haggle.offer_price;
				if (!queue_modal('MOD_MP_MARKET_HAGGLE_COUNTER', 'market-haggle-counter-modal', this.get_item_icon(haggle.item_id), {
					showConfirmButton: false
				}))
					this.market_haggle_counter = null;
				return;
			}
			show_button_spinner($button);
			let price = haggle.offer_price;
			if (action === 'counter') {
				price = Number(this.market_haggle_price);
				if (!Number.isSafeInteger(price) || price <= 0) {
					hide_button_spinner($button);
					return;
				}
			}
			if (action === 'counter' || action === 'accept') {
				const total = haggle.item_qty * price;
				if (!Number.isSafeInteger(total)) {
					hide_button_spinner($button);
					return notify_error('MOD_MP_MARKET_VALUE_TOO_LARGE');
				}
				const is_payer = haggle.direction === 'sell' ? haggle.is_initiator : !haggle.is_initiator;
				const top_up = Math.max(total - haggle.payer_escrow_gp, 0);
				if (is_payer && game.gp.amount < top_up) {
					hide_button_spinner($button);
					return notify_error('MOD_MP_MARKET_INSUFFICIENT_GP');
				}
			}
			const res = await api_post('/api/market/haggle/' + action, {
				id: haggle.id, revision: haggle.revision, ...(action === 'counter' ? { price } : {}),
				command_id: crypto.randomUUID()
			});
			if (res?.success && await reconcile_economy_receipts([res.receipt])) {
				if (from_modal) {
					await close_modal_and_wait('market-haggle-counter-modal');
					this.market_haggle_counter = null;
				}
				await update_market_haggles();
				await update_market_search();
				await update_market_listings();
			} else
				notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			hide_button_spinner($button);
		},

		async resolve_market_listing(event, item, action) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			const $button = event.currentTarget;

			if ($button.classList.contains('disabled') || is_button_spinning($button))
				return;
			if (item.unresolved && action !== 'destroy')
				return;
			show_button_spinner($button);

			const res = await api_post('/api/market/' + action, { id: item.id, command_id: crypto.randomUUID() });
			if (res?.success && await reconcile_economy_receipts([res.receipt])) {
				if (res.payout > 0) {
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
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			queue_modal('MOD_MP_CAMPAIGN_CONTRIBUTE', 'campaign-contribute-modal', this.campaign_item_icon, {
				showConfirmButton: false
			}, true, false);
		},

		async contribute_to_campaign(event) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
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

			const res = await api_post('/api/campaign/contribute', { item_amount, command_id: crypto.randomUUID() });
			if (res?.success && await reconcile_economy_receipts([res.receipt]) && res?.item_loss > 0) {
				const remove_item = game.items.getObjectByID(res.item_id);
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
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			const $button = event.currentTarget;
			if (is_button_spinning($button))
				return;

			show_button_spinner($button);

			const res = await api_post('/api/campaign/claim', {
				campaign_id: campaign.id,
				command_id: crypto.randomUUID()
			});
			if (res?.success && await reconcile_economy_receipts([res.receipt])) {
				campaign.taken = res.reward_value;
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
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			const item = this.charity_tree_inventory.find(e => e.id === state.selected_charity_item_id);
			if (!item)
				return notify_error('MOD_MP_CHARITY_INVALID_ITEM');
			if (!is_local_item_resolved(item.id))
				return notify_error('MOD_MP_CHARITY_UNKNOWN_ITEM');
			const take_block = this.get_charity_take_block(item);
			if (take_block !== null)
				return notify_error(this.get_charity_take_block_lang(take_block));
			const $button = event.currentTarget;
			if (is_button_spinning($button))
				return;

			show_button_spinner($button);

			const res = await api_post('/api/charity/take', {
				item_id: state.selected_charity_item_id,
				qty: this.get_charity_take_quantity(item),
				command_id: crypto.randomUUID()
			});

			if (res?.success && await reconcile_economy_receipts([res.receipt])) {
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

			apply_charity_state(res?.charity);
			update_charitree_nav();

			hide_button_spinner($button);
		},

		is_charity_item_discovered(item_id) {
			if (item_id === 'melvorD:GP' || is_transfer_currency(item_id))
				return true;
			const item = game.items.getObjectByID(item_id);
			return item !== undefined && game.stats.itemFindCount(item) > 0;
		},

		get_charity_leaf_coverage(item) {
			return charitree_rules.get_charitree_leaf_coverage(
				item,
				this.charity_update_time,
				item_id => item_id === 'melvorD:GP' || is_transfer_currency(item_id),
				item_id => this.is_charity_item_discovered(item_id)
			);
		},

		get_charity_take_block(item) {
			return charitree_rules.get_charitree_take_block(item, get_charity_rule_options.call(this));
		},

		get_charity_take_block_lang(block) {
			return 'MOD_MP_CHARITY_VALUE_LIMIT';
		},

		get_charity_take_block_text(block) {
			return getLangString(this.get_charity_take_block_lang(block));
		},

		get_charity_take_quantity(item) {
			return charitree_rules.get_charitree_take_quantity(item, get_charity_rule_options.call(this));
		},

		format_charity_expiry(expires_at) {
			return charitree_rules.format_charitree_remaining(expires_at, this.charity_update_time);
		},

		async donate_items(event, confirmed = false) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			if (this.has_destroyable_transfer_items)
				return notify_error('MOD_MP_TRANSFER_DESTROY_ITEM_FIRST');

			const items = state.transfer_inventory;
			const donation_value = state.transfer_inventory_donation_value;

			if (items.length === 0)
				return notify_error('MOD_MP_CHARITY_NO_SELECTION');

			if (has_local_unresolved_item(items, item => item.id))
				return notify_error('MOD_MP_CHARITY_UNKNOWN_ITEM');

			const $button = event.currentTarget;
			if (is_button_spinning($button))
				return;
			if (!confirmed)
				return this.show_transfer_confirmation('donate');

			show_button_spinner($button);

			const res = await api_post('/api/charity/donate', { items, donation_value, command_id: crypto.randomUUID() });
			if (res?.success && await reconcile_economy_receipts([res.receipt])) {
				runtime.last_charity_check = 0;

				notify('MOD_MP_CHARITY_DONATED');

				if (typeof res.pet_id === 'string' && !state.owned_pet_ids.includes(res.pet_id))
					state.owned_pet_ids = [...state.owned_pet_ids, res.pet_id];
				update_charitree_nav();
			} else
				notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');

			hide_button_spinner($button);
		},
		// #endregion
	};
}
