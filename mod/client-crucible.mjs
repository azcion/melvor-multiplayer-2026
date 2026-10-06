export function install_crucible_actions(runtime, rules) {
	const { state, game, api_get, run_pending_economy_action, run_pending_crucible_wish_action,
		transfer_currency_support, notify, notify_error, queue_modal, close_modal_and_wait,
		show_button_spinner, hide_button_spinner, is_local_item_available,
		filter_local_available_items } = runtime;
	let last_check = 0;
	let request = null;
	const currencies = () => transfer_currency_support.get_transfer_currencies(game);
	const is_currency = id => transfer_currency_support.is_transfer_currency(game, id);
	const discovered = id => is_currency(id) || state.is_charity_item_discovered(id);
	const rule_options = {
		is_currency, is_discovered: discovered,
		get_sale_currency(id) {
			const direct = transfer_currency_support.get_transfer_currency(game, id);
			if (direct) return direct.currency;
			const item = game.items.getObjectByID(id);
			return transfer_currency_support.get_transfer_currency_for_currency(game, item?.sellsFor?.currency)?.currency ?? null;
		},
		get_currency_balance(currency) { return currency.amount; },
		get_sale_value(id, qty) {
			if (is_currency(id)) return qty;
			const item = game.items.getObjectByID(id);
			return item ? game.bank.getItemSalePrice(item, qty) : 0;
		}
	};
	const quote_clearings = count => {
		const simulation = currencies().map(entry => ({ ...entry, balance: entry.currency.amount }));
		const offers = [];
		for (let index = 0; index < count; index++) {
			const eligible = simulation.filter(entry => Number.isSafeInteger(entry.balance) && entry.balance > 1000);
			if (eligible.length === 0) break;
			const choice = eligible[Math.floor(Math.random() * eligible.length)];
			const cap = transfer_currency_support.get_transfer_currency_cap(game, choice.id);
			const qty = Math.min(Math.floor(choice.balance / 1000), cap);
			offers.push({ currency_id: choice.id, balance: choice.balance, qty });
			choice.balance -= qty;
		}
		return offers;
	};
	async function refresh(force = false) {
		if (!state.is_guild_member || state.is_social_only || !state.is_connected) return;
		if (!force && Date.now() - last_check < 10_000) return;
		if (request) return request;
		state.crucible_loading = true;
		request = (async () => {
			try {
				const data = await api_get('/api/crucible/contents');
				if (data?.enabled === false) {
					state.crucible = null;
					state.crucible_error = '';
					last_check = Date.now();
					return;
				}
				if (!data || data.enabled !== true) throw new Error('Invalid Crucible response');
				state.crucible = { ...data,
					offerings: filter_local_available_items(data.offerings ?? [], row => row.item_id)
						.sort(rules.compare_crucible_offerings)
						.map(row => ({ ...row, id: row.item_id })),
					wishes: filter_local_available_items(data.wishes ?? [], row => row.item_id),
					wish_catalog: filter_local_available_items(data.wish_catalog ?? [], row => row.id) };
				if (!state.crucible.offerings.some(row => row.id === state.crucible_selected_offering_id))
					state.crucible_selected_offering_id = null;
				if (!state.crucible.wishes.some(row => row.id === state.crucible_selected_wish_id))
					state.crucible_selected_wish_id = null;
				state.crucible_error = '';
				last_check = Date.now();
			} catch (error) {
				state.crucible = null;
				state.crucible_error = String(error);
			} finally {
				state.crucible_loading = false;
				request = null;
				runtime.update_charitree_nav();
			}
		})();
		return request;
	}
	async function wish_action(kind, payload = {}) {
		if (state.crucible_busy) return false;
		state.crucible_busy = true;
		try {
			const result = await run_pending_crucible_wish_action(kind, `/api/crucible/wish/${kind}`, payload);
			if (result?.success) {
				notify('MOD_MP_CRUCIBLE_ACTION_DONE');
				await refresh(true);
				return true;
			} else notify_error(result?.error_lang ?? 'MOD_MP_GENERIC_ERR');
		} catch {
			notify_error('MOD_MP_GENERIC_ERR');
		} finally { state.crucible_busy = false; }
		return false;
	}
	return {
		refresh_crucible: refresh,
		crucible_select_offering(item) {
			state.crucible_selected_offering_id = state.crucible_selected_offering_id === item.id ? null : item.id;
		},
		crucible_select_wish(wish) {
			state.crucible_selected_wish_id = state.crucible_selected_wish_id === wish.id ? null : wish.id;
		},
		crucible_wish_progress(wish) {
			return wish.phase === 'forming' ? Math.min(100, wish.formation_points * 100 / 10080) :
				Math.min(100, wish.required_gp > 0 ? wish.progress_gp * 100 / wish.required_gp : 0);
		},
		select_crucible_wish_item(item) { state.crucible_wish_item_id = item.id; },
		adjust_crucible_wish_qty(delta) {
			const current = Number(state.crucible_wish_qty);
			state.crucible_wish_qty = Math.min(100, Math.max(1, (Number.isSafeInteger(current) ? current : 1) + delta));
		},
		show_crucible_wish_modal() {
			if (state.crucible?.active_wish || !state.crucible?.is_open) return;
			const items = state.eligible_crucible_wish_items;
			if (!items.length) return notify_error('MOD_MP_CRUCIBLE_WISH_NO_ITEMS');
			state.crucible_wish_item_id = items[0].id;
			state.crucible_wish_search = '';
			state.crucible_wish_qty = 1;
			queue_modal('MOD_MP_CRUCIBLE_MAKE_WISH', 'crucible-wish-modal', 'assets/crucible.png', {
				showConfirmButton: false, customClass: { popup: 'mp-crucible-wish-modal-popup' }
			});
		},
		crucible_slag(offering) {
			return rules.get_crucible_slag_coverage(offering, discovered(offering.id),
				state.crucible?.level ?? 0, is_currency);
		},
		crucible_reclaim_quantity(offering) {
			return rules.get_crucible_reclaim_quantity(offering, rule_options);
		},
		crucible_reclaim_block(offering) {
			if (!state.crucible?.is_open) return 'sealed';
			if (state.crucible?.next_reclaim_at > state.crucible_clock_time) return 'cooldown';
			if (offering?.blocked_until > state.crucible_clock_time) return 'locked';
			if (!this.crucible_reclaim_quantity(offering)) return 'value';
			return null;
		},
		crucible_time(at) {
			if (!Number.isSafeInteger(at)) return getLangString('MOD_MP_CRUCIBLE_TIME_UNKNOWN');
			const remaining = Math.max(0, at - state.crucible_clock_time);
			if (remaining < 60_000) return getLangString('MOD_MP_CRUCIBLE_TIME_LESS_THAN_MINUTE');
			if (remaining < 3_600_000) return getLangString('MOD_MP_CRUCIBLE_TIME_MINUTES')
				.replace('%s', Math.ceil(remaining / 60_000));
			return getLangString('MOD_MP_CRUCIBLE_TIME_HOURS')
				.replace('%s', Math.ceil(remaining / 3_600_000));
		},
		async crucible_reclaim(offering) {
			const qty = this.crucible_reclaim_quantity(offering);
			if (this.crucible_reclaim_block(offering) || qty < 1 || state.crucible_busy) return;
			state.crucible_busy = true;
			try {
				const result = await run_pending_economy_action(`crucible_reclaim:${offering.id}`,
					'/api/crucible/reclaim', { item_id: offering.id, qty });
				if (result?.success) { notify('MOD_MP_CRUCIBLE_ACTION_DONE'); await refresh(true); }
				else notify_error(result?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			} catch {
				notify_error('MOD_MP_GENERIC_ERR');
			} finally { state.crucible_busy = false; }
		},
		async crucible_make_wish(event) {
			const item_id = state.crucible_wish_item_id;
			const qty = Number(state.crucible_wish_qty);
			if (!is_local_item_available(item_id) || !state.eligible_crucible_wish_items.some(item => item.id === item_id) ||
				!Number.isSafeInteger(qty) || qty < 1 || qty > 100)
				return notify_error('MOD_MP_CRUCIBLE_WISH_INVALID');
			const button = event?.currentTarget;
			if (button) show_button_spinner(button);
			try {
				if (await wish_action('make', { item_id, qty })) await close_modal_and_wait('crucible-wish-modal');
			} finally { if (button) hide_button_spinner(button); }
		},
		async crucible_cancel_wish() { await wish_action('cancel'); },
		async crucible_claim_wish() { await wish_action('claim'); },
		async crucible_clear(max = false) {
			if (state.crucible_busy || !state.crucible?.is_open) return;
			const target = state.crucible.active_wish ? 10 : 20;
			const count = max ? target - state.crucible.level : 1;
			if (count < 1) return;
			const offers = quote_clearings(count);
			if (offers.length !== count) return notify_error('MOD_MP_CRUCIBLE_CLEAR_POOR');
			const totals = new Map();
			for (const offer of offers) totals.set(offer.currency_id, (totals.get(offer.currency_id) ?? 0) + offer.qty);
			state.crucible_clear_offers = offers;
			state.crucible_clear_max = max;
			state.crucible_clear_totals = [...totals].map(([currency_id, qty]) => ({
				currency_id, qty, currency: currencies().find(entry => entry.id === currency_id)
			}));
			queue_modal('MOD_MP_CRUCIBLE_CLEAR', 'crucible-clear-modal', 'assets/crucible.png', {
				showConfirmButton: false
			});
		},
		async crucible_confirm_clear(event) {
			const offers = state.crucible_clear_offers;
			if (state.crucible_busy || !offers?.length) return;
			state.crucible_busy = true;
			const button = event?.currentTarget;
			if (button) show_button_spinner(button);
			try {
				const result = await run_pending_economy_action('crucible_clear', '/api/crucible/clear',
					offers.length === 1 ? offers[0] : { offers });
				if (result?.success) {
					state.crucible_clear_offers = [];
					await close_modal_and_wait('crucible-clear-modal');
					notify('MOD_MP_CRUCIBLE_ACTION_DONE'); await refresh(true);
				}
				else notify_error(result?.error_lang ?? 'MOD_MP_GENERIC_ERR');
			} catch {
				notify_error('MOD_MP_GENERIC_ERR');
			} finally { state.crucible_busy = false; if (button) hide_button_spinner(button); }
		}
	};
}
