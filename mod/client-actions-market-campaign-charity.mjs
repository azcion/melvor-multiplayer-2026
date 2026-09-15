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
		get_charity_item_valuation,
		game,
		get_client_events,
		getLangString,
		is_social_only,
		is_transfer_currency,
		has_local_unresolved_item,
		hide_button_spinner,
		is_button_spinning,
		is_local_item_available = () => true,
		is_local_item_resolved,
		load_market_filter_items,
		numberWithCommas,
		notify,
		notify_error,
		notify_item,
		open_transfer_page,
		queue_modal,
		reconcile_economy_receipts,
		run_pending_economy_action,
		run_pending_charity_wish_action,
		request_charity_tree_contents,
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
		setTimeout = globalThis.setTimeout,
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
	let charity_shuffle_confirming = false;

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
			if (!is_local_item_available(item_id))
				return;
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
			if (!is_local_item_available(item?.item_id))
				return;
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
			if (!is_local_item_available(state.market_buy_item.item_id))
				return;

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
			if (!is_local_item_available(item?.item_id))
				return;
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
			if (!is_local_item_available(state.market_fulfill_item.item_id))
				return;

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
			if (!is_local_item_available(item.id))
				return;

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
			if (!is_local_item_available(item?.item_id))
				return;
			this.market_haggle_item = item;
			this.market_haggle_price = item.price;
			queue_modal(getLangString('MOD_MP_MARKET_HAGGLE_TITLE'), 'market-haggle-modal',
				this.get_item_icon(item.item_id), { showConfirmButton: false }, false, false);
		},

		get_market_haggle_cap_notice() {
			const item = state.market_haggle_item;
			const qty = Number(this.item_slider_value);
			const price = Number(this.market_haggle_price);
			const listing_price = Number.isSafeInteger(item?.price) && item.price > 0 ? item.price : price;
			const cap = transfer_currency_support?.get_transfer_currency_cap(game, 'melvorD:GP') ?? 1_000_000_000;
			return item && Number.isSafeInteger(qty) && qty > 0 && Number.isSafeInteger(price) && price > 0 &&
				qty * Math.max(price, listing_price) > cap ? `GP: ${numberWithCommas(cap)}` : '';
		},

		get_market_haggle_counter_cap_notice() {
			const haggle = state.market_haggle_counter;
			const price = Number(this.market_haggle_price);
			const cap = transfer_currency_support?.get_transfer_currency_cap(game, 'melvorD:GP') ?? 1_000_000_000;
			return haggle && Number.isSafeInteger(price) && price > 0 && haggle.item_qty * price > cap
				? `GP: ${numberWithCommas(cap)}` : '';
		},

		async create_market_haggle(event) {
			const item = this.market_haggle_item;
			if (!is_local_item_available(item?.item_id))
				return;
			const requested_qty = this.item_slider_value;
			const price = Number(this.market_haggle_price);
			if (!item || !Number.isSafeInteger(requested_qty) || requested_qty <= 0 || !Number.isSafeInteger(price) || price <= 0)
				return notify_error('MOD_MP_MARKET_HAGGLE_INVALID');
			if (!Number.isSafeInteger(requested_qty * price))
				return notify_error('MOD_MP_MARKET_VALUE_TOO_LARGE');
			const cap = transfer_currency_support?.get_transfer_currency_cap(game, 'melvorD:GP') ?? 1_000_000_000;
			const listing_price = Number.isSafeInteger(item.price) && item.price > 0 ? item.price : price;
			const qty = Math.min(requested_qty, Math.floor(cap / Math.max(price, listing_price)));
			if (qty < 1)
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
				let total = haggle.item_qty * price;
				if (!Number.isSafeInteger(total)) {
					hide_button_spinner($button);
					return notify_error('MOD_MP_MARKET_VALUE_TOO_LARGE');
				}
				if (action === 'counter') {
					const cap = transfer_currency_support?.get_transfer_currency_cap(game, 'melvorD:GP') ?? 1_000_000_000;
					price = Math.min(price, Math.floor(cap / haggle.item_qty));
					if (price < 1) {
						hide_button_spinner($button);
						return notify_error('MOD_MP_MARKET_VALUE_TOO_LARGE');
					}
					total = haggle.item_qty * price;
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
		charity_shuffle_price() {
			return numberWithCommas(state.charity_shuffle_offer?.qty ?? 0);
		},

		charity_shuffle_currency() {
			return transfer_currency_support.get_transfer_currency(game, state.charity_shuffle_offer?.currency_id) ?? null;
		},

		charity_shuffle_max_totals() {
			const totals = new Map();
			for (const offer of state.charity_shuffle_max_offers)
				totals.set(offer.currency_id, (totals.get(offer.currency_id) ?? 0) + offer.qty);
			return [...totals].map(([currency_id, qty]) => ({
				currency_id,
				qty,
				currency: transfer_currency_support.get_transfer_currency(game, currency_id)
			}));
		},

		charity_shuffle_bonus() {
			const count = state.charity_shuffle_count;
			return Number.isSafeInteger(count) ? Math.max(-10, Math.min(20, count)) : 0;
		},

		select_charity_wish(wish) {
			state.selected_charity_wish_id = wish.wish_id;
			state.selected_charity_item_id = '';
		},

		select_charity_wish_item(item) {
			if (this.eligible_charity_wish_items.some(entry => entry.id === item.id))
				state.charity_wish_item_id = item.id;
		},

		adjust_charity_wish_qty(delta) {
			const current_qty = Number(this.charity_wish_qty);
			const qty = Number.isSafeInteger(current_qty) ? current_qty : 1;
			this.charity_wish_qty = Math.min(100, Math.max(1, qty + delta));
		},

		select_charity_offering(item) {
			state.selected_charity_item_id = item.id;
			state.selected_charity_wish_id = 0;
		},

		show_charity_wish_modal() {
			if (state.charity_active_wish) return notify_error('MOD_MP_CHARITY_WISH_ACTIVE');
			const items = state.eligible_charity_wish_items;
			if (items.length === 0) return notify_error('MOD_MP_CHARITY_WISH_NO_ITEMS');
			state.charity_wish_item_id = items[0].id;
			state.charity_wish_search = '';
			state.charity_wish_qty = 1;
			queue_modal('MOD_MP_CHARITY_WISH_MAKE', 'charity-wish-modal', 'assets/charity_tree.svg', {
				showConfirmButton: false,
				customClass: { popup: 'mp-charity-wish-modal-popup' }
			});
		},

		async make_charity_wish(event) {
			const qty = Number(state.charity_wish_qty);
			if (!is_local_item_available(state.charity_wish_item_id))
				return;
			if (!state.eligible_charity_wish_items.some(item => item.id === state.charity_wish_item_id) ||
				!Number.isSafeInteger(qty) || qty < 1 || qty > 100)
				return notify_error('MOD_MP_CHARITY_WISH_INVALID');
			const $button = event.currentTarget;
			show_button_spinner($button);
			const res = await run_pending_charity_wish_action('make', '/api/charity/wish/make', {
				item_id: state.charity_wish_item_id, qty
			});
			if (res?.success) {
				await close_modal_and_wait('charity-wish-modal');
				await request_charity_tree_contents(true, false);
				notify('MOD_MP_CHARITY_WISH_MADE');
			} else notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			hide_button_spinner($button);
		},

		show_charity_wish_forsake_confirmation() {
			queue_modal('MOD_MP_CHARITY_WISH_FORSAKE', 'charity-wish-forsake-confirm-modal', 'assets/charity_tree.svg', {
				showConfirmButton: false
			});
		},

		confirm_charity_wish_forsake(event) {
			this.close_modal();
			return this.resolve_charity_wish(event, 'forsake', true);
		},

		async resolve_charity_wish(event, action, confirmed = false) {
			const wish = state.selected_charity_wish;
			if (!is_local_item_available(wish?.item_id))
				return;
			if (!wish?.owned || (action === 'forsake' && wish.phase !== 'maturing') ||
				(action === 'pick' && wish.phase !== 'ripe')) return;
			if (action === 'forsake' && !confirmed)
				return this.show_charity_wish_forsake_confirmation();
			const $button = event.currentTarget;
			show_button_spinner($button);
			const res = await run_pending_charity_wish_action(action, `/api/charity/wish/${action}`);
			if (res?.success) {
				state.selected_charity_wish_id = 0;
				await request_charity_tree_contents(true, false);
				notify(action === 'pick' ? 'MOD_MP_CHARITY_WISH_GRANTED' : 'MOD_MP_CHARITY_WISH_FORSAKEN');
			} else notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			hide_button_spinner($button);
		},

		show_charity_shuffle() {
			if (is_social_only()) return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			if (state.charity_shuffle_offer !== null) return;
			const offer = charitree_rules.get_charitree_shuffle_offer(
				transfer_currency_support.get_transfer_currencies(game));
			state.charity_shuffle_offer = offer === null ? null : {
				...offer,
				qty: Math.min(offer.qty, transfer_currency_support.get_transfer_currency_cap(game, offer.currency_id))
			};
			try {
				const queued = queue_modal('MOD_MP_CHARITY_SHUFFLE', 'charity-shuffle-modal', 'assets/charity_tree.svg', {
					showConfirmButton: false,
					didClose: () => { state.charity_shuffle_offer = null; }
				});
				if (queued === false)
					state.charity_shuffle_offer = null;
			} catch (error) {
				state.charity_shuffle_offer = null;
				throw error;
			}
		},

		async show_charity_shuffle_max() {
			if (this.charity_shuffle_bonus() >= 20 || charity_shuffle_confirming) return;
			const offers = charitree_rules.get_charitree_max_shuffle_offers(
				transfer_currency_support.get_transfer_currencies(game),
				state.charity_shuffle_count,
				currency_id => transfer_currency_support.get_transfer_currency_cap(game, currency_id)
			);
			if (offers.length < 20 - this.charity_shuffle_bonus())
				return notify_error('MOD_MP_CHARITY_SHUFFLE_POOR');
			await close_modal_and_wait('charity-shuffle-modal');
			state.charity_shuffle_offer = null;
			state.charity_shuffle_max_offers = offers;
			try {
				const queued = queue_modal('MOD_MP_CHARITY_SHUFFLE_MAX_TITLE', 'charity-shuffle-max-modal', 'assets/charity_tree.svg', {
					showConfirmButton: false,
					didClose: () => { state.charity_shuffle_max_offers = []; }
				});
				if (queued === false) state.charity_shuffle_max_offers = [];
			} catch (error) {
				state.charity_shuffle_max_offers = [];
				throw error;
			}
		},

		async confirm_charity_shuffle(event, max = false) {
			const offers = max ? state.charity_shuffle_max_offers : [state.charity_shuffle_offer].filter(Boolean);
			if (offers.length === 0 || charity_shuffle_confirming) return;
			charity_shuffle_confirming = true;
			const $button = event.currentTarget;
			const width = $button?.getBoundingClientRect?.().width ?? $button?.offsetWidth;
			if ($button?.style && width > 0) $button.style.width = `${width}px`;
			if ($button) {
				$button.disabled = true;
				show_button_spinner($button);
			}
			const minimum_loader = new Promise(resolve => setTimeout(resolve, 2000));
			let res = null;
			try {
				res = await run_pending_economy_action('charity_shuffle', '/api/charity/shuffle', max
					? { offers: offers.map(({ currency_id, balance }) => ({ currency_id, balance })) }
					: { currency_id: offers[0].currency_id, balance: offers[0].balance });
				await minimum_loader;
				await close_modal_and_wait(max ? 'charity-shuffle-max-modal' : 'charity-shuffle-modal');
				if (res?.success) {
					if (typeof res.pet_id === 'string' && !state.owned_pet_ids.includes(res.pet_id))
						state.owned_pet_ids = [...state.owned_pet_ids, res.pet_id];
					notify('MOD_MP_CHARITY_SHUFFLED');
					await request_charity_tree_contents(true, false);
				} else {
					notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
					if (res?.error_lang === 'MOD_MP_CHARITY_SHUFFLE_MAX_CHANGED')
						await request_charity_tree_contents(true, false);
				}
			} finally {
				await minimum_loader;
				charity_shuffle_confirming = false;
			}
		},

		async charity_take_item(event) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			const item = this.charity_tree_inventory.find(e => e.id === state.selected_charity_item_id);
			if (!item)
				return notify_error('MOD_MP_CHARITY_INVALID_ITEM');
			if (!is_local_item_available(item.id))
				return;
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
				item_id => this.is_charity_item_discovered(item_id),
				this.charity_shuffled_at,
				this.charity_shuffle_count
			);
		},

		get_charity_take_block(item) {
			if (this.charity_currency_locks?.some(lock => lock.currency_id === item.id && lock.locked_until > this.charity_update_time))
				return 'shuffle_lock';
			return charitree_rules.get_charitree_take_block(item, get_charity_rule_options.call(this));
		},

		get_charity_take_block_lang(block) {
			return block === 'shuffle_lock' ? 'MOD_MP_CHARITY_SHUFFLE_LOCK' : 'MOD_MP_CHARITY_VALUE_LIMIT';
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

			const items = transfer_currency_support.cap_transfer_items(game, state.transfer_inventory.map(item => ({
				...item,
				...get_charity_item_valuation(item.id)
			})));
			const donation_value = Math.max(0, state.transfer_inventory_donation_value -
				transfer_currency_support.get_transfer_currency_overages(game, state.transfer_inventory)
					.reduce((total, entry) => total + entry.overage, 0));

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

			const res = await run_pending_economy_action('charity_donate', '/api/charity/donate', { items, donation_value });
			if (res?.success) {
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
