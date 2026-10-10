export function install_market_actions(runtime) {
	const {
		state,
		GIFT_FLAG_RETURNED,
		api_get,
		api_post,
		add_gp_to_transfer,
		capture_equipment_snapshot,
		capture_status_snapshot,
		changePage,
		close_account_dropdown,
		close_modal_and_wait,
		crypto,
		destroy_selected_transfer_inventory,
		document,
		formatNumber,
		get_offering_item_valuation,
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
		is_market_item_discovered,
		load_market_filter_items,
		numberWithCommas,
		notify,
		notify_error,
		notify_item,
		open_transfer_page,
		queue_modal,
		reconcile_economy_receipts,
		run_pending_economy_action,
		refresh_guild_state,
		refresh_identities,
		refresh_raid_state,
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
		update_market_listings,
		update_market_haggles,
		update_market_page,
		update_market_search,
		update_transfer_contents,
	} = runtime;

	return {
		clear_market_filter() {
			this.market_filter_item = null;
			state.market_page_first(true);
		},

		async choose_market_filter() {
			this.market_active_tab = 'filter';
			this.market_filter_search = '';

			if (!runtime.has_sorted_market_filter_items) {
				await update_market_listings();
				load_market_filter_items();
			}

			setTimeout(() => $('mp-market-filter-input').focus(), 1);
		},

		select_market_filter_item(item_id) {
			if (!is_local_item_available(item_id))
				return;
			if (state.market_active_tab === 'create-filter') {
				if (state.market_discovery_restriction_enabled && !is_market_item_discovered(item_id))
					return notify_error('MOD_MP_MARKET_DISCOVERY_REQUIRED');
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

		async choose_market_create_item() {
			this.market_active_tab = 'create-filter';
			this.market_filter_search = '';

			if (!runtime.has_sorted_market_filter_items) {
				await update_market_listings();
				load_market_filter_items();
			}

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
			if (!item || state.market_buyable(item) <= 0)
				return;
			if (!is_local_item_available(item?.item_id))
				return;
			if (state.market_discovery_restriction_enabled && !is_market_item_discovered(item.item_id))
				return notify_error('MOD_MP_MARKET_DISCOVERY_REQUIRED');
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
			if (state.market_discovery_restriction_enabled &&
				!is_market_item_discovered(state.market_buy_item.item_id))
				return notify_error('MOD_MP_MARKET_DISCOVERY_REQUIRED');

			if (state.item_slider_value <= 0)
				return notify_error('MOD_MP_MARKET_BUY_NOTHING');

			const item = game.items.getObjectByID(state.market_buy_item.item_id);
			if (!item)
				return notify_error('MOD_MP_MARKET_BUY_ERROR_UNKNOWN');

			if (state.market_currency_amount(state.market_buy_item) < state.item_slider_value * state.market_buy_item.price)
				return notify_error('MOD_MP_MARKET_INSUFFICIENT_GP');

			show_button_spinner($button);

			const res = await api_post('/api/market/buy', {
				id: state.market_buy_item.id,
				qty: state.item_slider_value,
				expected_price: state.market_buy_item.price, expected_currency_id: state.market_buy_item.currency_id ?? 'melvorD:GP',
				item_discovered: is_market_item_discovered(state.market_buy_item.item_id),
				command_id: crypto.randomUUID()
			});

			const purchase_succeeded = res?.success && await reconcile_economy_receipts([res.receipt]);
			if (purchase_succeeded) {
				hide_button_spinner($button);
				await this.close_modal_and_wait('market-buy-modal');

				state.market_buy_item.available = res.new_item_qty;
				await update_market_search();
			} else {
				notify_error(res?.error_lang ?? 'MOD_MP_MARKET_BUY_ERROR');
			}

			if (!purchase_succeeded) {
				hide_button_spinner($button);
				this.close_modal();
			}
		},

		show_market_fulfill_modal(item) {
			if (!item || state.market_buyable(item) <= 0 || state.get_market_item_owned_qty(item.item_id) <= 0)
				return;
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
			state.market_fulfill_item.available = res.new_item_qty;
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
			if (state.market_discovery_restriction_enabled && !is_market_item_discovered(item.id))
				return notify_error('MOD_MP_MARKET_DISCOVERY_REQUIRED');

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
				item_discovered: is_market_item_discovered(item.id),
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

		toggle_market_availability() {
			state.market_available_only = !state.market_available_only;
			state.market_page_first(true);
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
			if (!item || item.available <= 0)
				return;
			if (!is_local_item_available(item?.item_id))
				return;
			if (item.direction === 'sell' && state.market_discovery_restriction_enabled &&
				!is_market_item_discovered(item.item_id))
				return notify_error('MOD_MP_MARKET_DISCOVERY_REQUIRED');
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
			const cap = transfer_currency_support?.get_transfer_currency_cap(game, item?.currency_id ?? 'melvorD:GP') ?? 1_000_000_000;
			return item && Number.isSafeInteger(qty) && qty > 0 && Number.isSafeInteger(price) && price > 0 &&
				qty * Math.max(price, listing_price) > cap ? `${state.market_currency_shorthand(item)}: ${numberWithCommas(cap)}` : '';
		},

		get_market_haggle_counter_cap_notice() {
			const haggle = state.market_haggle_counter;
			const price = Number(this.market_haggle_price);
			const cap = transfer_currency_support?.get_transfer_currency_cap(game, haggle?.currency_id ?? 'melvorD:GP') ?? 1_000_000_000;
			return haggle && Number.isSafeInteger(price) && price > 0 && haggle.item_qty * price > cap
				? `${state.market_currency_shorthand(haggle)}: ${numberWithCommas(cap)}` : '';
		},

		async create_market_haggle(event) {
			const item = this.market_haggle_item;
			if (!is_local_item_available(item?.item_id))
				return;
			if (item.direction === 'sell' && state.market_discovery_restriction_enabled &&
				!is_market_item_discovered(item.item_id))
				return notify_error('MOD_MP_MARKET_DISCOVERY_REQUIRED');
			const requested_qty = this.item_slider_value;
			const price = Number(this.market_haggle_price);
			if (!item || !Number.isSafeInteger(requested_qty) || requested_qty <= 0 || !Number.isSafeInteger(price) || price <= 0)
				return notify_error('MOD_MP_MARKET_HAGGLE_INVALID');
			if (!Number.isSafeInteger(requested_qty * price))
				return notify_error('MOD_MP_MARKET_VALUE_TOO_LARGE');
			const cap = transfer_currency_support?.get_transfer_currency_cap(game, item?.currency_id ?? 'melvorD:GP') ?? 1_000_000_000;
			const listing_price = Number.isSafeInteger(item.price) && item.price > 0 ? item.price : price;
			const qty = Math.min(requested_qty, Math.floor(cap / Math.max(price, listing_price)));
			if (qty < 1)
				return notify_error('MOD_MP_MARKET_VALUE_TOO_LARGE');
			const local_item = game.items.getObjectByID(item.item_id);
			if (item.direction === 'sell' && state.market_currency_amount(item) < qty * price)
				return notify_error('MOD_MP_MARKET_INSUFFICIENT_GP');
			if (item.direction === 'buy' && (!local_item || game.bank.getQty(local_item) < qty))
				return notify_error('MOD_MP_MARKET_NOT_ENOUGH_ITEM');
			const $button = event.currentTarget;
			show_button_spinner($button);
			const res = await api_post('/api/market/haggle', {
				id: item.id, qty, price, expected_currency_id: item.currency_id ?? 'melvorD:GP', item_discovered: is_market_item_discovered(item.item_id),
				command_id: crypto.randomUUID()
			});
			if (res?.success && await reconcile_economy_receipts([res.receipt])) {
				await close_modal_and_wait('market-haggle-modal');
				await update_market_search();
				await update_market_haggles();
			} else
				notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			hide_button_spinner($button);
		},

		async respond_market_haggle(event, haggle, action, from_modal = false, from_confirmation = false) {
			if (this.is_pending_preview?.('haggle', haggle.id)) return this.pending_preview_action('haggle', haggle.id, action);
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
					const cap = transfer_currency_support?.get_transfer_currency_cap(game, haggle?.currency_id ?? 'melvorD:GP') ?? 1_000_000_000;
					price = Math.min(price, Math.floor(cap / haggle.item_qty));
					if (price < 1) {
						hide_button_spinner($button);
						return notify_error('MOD_MP_MARKET_VALUE_TOO_LARGE');
					}
					total = haggle.item_qty * price;
				}
				const is_payer = haggle.direction === 'sell' ? haggle.is_initiator : !haggle.is_initiator;
				const top_up = Math.max(total - haggle.payer_escrow_gp, 0);
				if (is_payer && state.market_currency_amount(haggle) < top_up) {
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

		is_crucible_item_discovered(item_id) {
			if (item_id === 'melvorD:GP' || is_transfer_currency(item_id))
				return true;
			const item = game.items.getObjectByID(item_id);
			return item !== undefined && game.stats.itemFindCount(item) > 0;
		},

		async donate_items(event, confirmed = false) {
			if (is_social_only())
				return notify_error('MOD_MP_SOCIAL_ONLY_DISABLED');
			if (this.has_destroyable_transfer_items)
				return notify_error('MOD_MP_TRANSFER_DESTROY_ITEM_FIRST');

			const items = transfer_currency_support.cap_transfer_items(game, state.transfer_inventory.map(item => ({
				...item,
				...get_offering_item_valuation(item.id)
			})));
			const donation_value = Math.max(0, state.transfer_inventory_donation_value -
				transfer_currency_support.get_transfer_currency_overages(game, state.transfer_inventory)
					.reduce((total, entry) => total + entry.overage, 0));

			if (items.length === 0)
				return notify_error('MOD_MP_CRUCIBLE_NO_SELECTION');

			if (has_local_unresolved_item(items, item => item.id))
				return notify_error('MOD_MP_CRUCIBLE_UNKNOWN_ITEM');

			const $button = event.currentTarget;
			if (is_button_spinning($button))
				return;
			if (!confirmed)
				return this.show_transfer_confirmation('donate');

			show_button_spinner($button);

			await state.refresh_crucible();
			if (!state.crucible?.is_open) {
				hide_button_spinner($button);
				return notify_error('MOD_MP_CRUCIBLE_SEALED');
			}
			const res = await run_pending_economy_action('crucible_cast_transfer', '/api/crucible/cast',
				{ items, donation_value, source: 'transfer' });
			if (res?.success) {
				notify('MOD_MP_CRUCIBLE_CAST_DONE');

				if (typeof res.pet_id === 'string' && !state.owned_pet_ids.includes(res.pet_id))
					state.owned_pet_ids = [...state.owned_pet_ids, res.pet_id];
				await state.refresh_crucible(true);
			} else
				notify_error(res?.error_lang ?? 'MOD_MP_GENERIC_ERR');

			hide_button_spinner($button);
		},
		// #endregion
	};
}
