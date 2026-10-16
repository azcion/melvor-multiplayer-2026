export function install_crucible_actions(runtime, rules) {
	const { state, game, api_get, run_pending_economy_action, run_pending_crucible_wish_action,
		transfer_currency_support, notify, notify_error, queue_modal, close_modal_and_wait,
		show_button_spinner, hide_button_spinner, is_local_item_available,
		filter_local_available_items } = runtime;
	const error_keys = { insufficient_ep: 'MOD_MP_WISH_INSUFFICIENT_EP', insufficient_gp: 'MOD_MP_WISH_INSUFFICIENT_GP',
		wish_quote_changed: 'MOD_MP_WISH_QUOTE_CHANGED', capacity_expired: 'MOD_MP_WISH_QUOTE_CHANGED', invalid_capacity_tier: 'MOD_MP_WISH_QUOTE_CHANGED' };
	const show_error = result => notify_error(result?.error_lang ?? error_keys[result?.error] ?? 'MOD_MP_GENERIC_ERR');
	let last_check = 0;
	let request = null;
	const currencies = () => transfer_currency_support.get_transfer_currencies(game);
	const is_currency = id => transfer_currency_support.is_transfer_currency(game, id);
	const discovered = id => is_currency(id) || state.is_crucible_item_discovered(id);
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
		const requested_filters = (state.listing_filters ?? []).join(',');
		state.crucible_loading = true;
		request = (async () => {
			try {
				await runtime.recover_paid_wish_actions?.();
				const filters = (state.listing_filters ?? []).join(',');
				const data = await api_get('/api/crucible/contents' + (filters ? '?listing_filters=' + encodeURIComponent(filters) : ''));
				if (filters !== (state.listing_filters ?? []).join(',')) return;
				if (data?.enabled === false) {
					state.crucible = null;
					state.crucible_summary = null;
					state.crucible_error = '';
					last_check = Date.now();
					return;
				}
				if (!data || data.enabled !== true) throw new Error('Invalid Crucible response');
				state.crucible_summary = null;
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
				// Keep the last usable snapshot through transient or invalidated reads.
				state.crucible_error = String(error);
			} finally {
				state.crucible_loading = false;
				request = null;
				runtime.update_crucible_nav();
				if (requested_filters !== (state.listing_filters ?? []).join(',')) void refresh(true);
			}
		})();
		return request;
	}
	async function wish_action(kind, payload = {}) {
		if (state.crucible_busy) return false;
		state.crucible_busy = true;
		try {
			const result = await (['make','capacity','renewal'].includes(kind)
				? run_pending_economy_action(`crucible_wish_${kind}`, `/api/crucible/wish/${kind}`, payload)
				: run_pending_crucible_wish_action(kind, `/api/crucible/wish/${kind}`, payload));
			if (result?.success) {
				notify('MOD_MP_CRUCIBLE_ACTION_DONE');
				await refresh(true);
				return true;
			} else { show_error(result); await refresh(true); }
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
			state.crucible_wish_qty = Math.min(1000, Math.max(1, (Number.isSafeInteger(current) ? current : 1) + delta));
		},
		fill_crucible_wish_qty() {
			const entry = state.crucible?.wish_catalog?.find(item => item.id === state.crucible_wish_item_id);
			const base = state.crucible_capacity.base ?? 100;
			const balance = state.crucible?.capacity?.points_micros ?? 0;
			state.crucible_wish_qty = 1;
			if (!entry) return;
			for (let qty = base; qty >= 1; qty--) {
				const ep = rules.wish_price_micros(qty, base);
				const gp = rules.wish_gp_cost(entry.max_item_value * qty * 5);
				if (ep > 0 && gp > 0 && ep <= balance && gp <= game.gp.amount) {
					state.crucible_wish_qty = qty;
					return;
				}
			}
		},
		async show_crucible_wish_modal() {
			await refresh(true);
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
					'/api/crucible/reclaim', { item_id: offering.id, qty, listing_filters: [...(state.listing_filters ?? [])] });
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
				!Number.isSafeInteger(qty) || qty < 1 || qty > 1000)
				return notify_error('MOD_MP_CRUCIBLE_WISH_INVALID');
			const button = event?.currentTarget;
			if (button) show_button_spinner(button);
			try {
				if (!state.crucible_wish_affordable) return show_error({ error: game.gp.amount < state.crucible_wish_gp_cost ? 'insufficient_gp' : 'insufficient_ep' });
				if (await wish_action('make', { item_id, qty, ep_micros: state.crucible_wish_ep_micros,
					gp: state.crucible_wish_gp_cost, gp_balance: Math.floor(game.gp.amount) })) await close_modal_and_wait('crucible-wish-modal');
			} finally { if (button) hide_button_spinner(button); }
		},
		crucible_exact(value) { return Number.isSafeInteger(value) ? value.toLocaleString() : '0'; },
		crucible_capacity_ep(value) { return Math.floor((value ?? 0) / 1_000_000).toLocaleString(); },
		crucible_capacity_price(tier) { return (tier / 100 - 1) * (tier / 100) / 2 * 10_000_000; },
		crucible_ep(value) { return ((value ?? 0) / 1_000_000).toFixed(3); },
		crucible_expiry(value) { return Number.isSafeInteger(value) ? new Date(value).toLocaleString() : '—'; },
		crucible_capacity_summary() {
			const capacity = state.crucible_capacity;
			return getLangString('MOD_MP_WISH_CAPACITY_STATUS')
				.replace('%base%', capacity.base ?? 100).replace('%expiry%', this.crucible_expiry(capacity.expires_at))
				.replace('%ep%', this.crucible_capacity_ep(capacity.renewal_micros))
				.replace('%balance%', this.expedition_points(state.crucible?.capacity?.points_micros))
				.replace('%renew%', getLangString(capacity.auto_renew ? 'MOD_MP_WISH_RENEW_ON' : 'MOD_MP_WISH_RENEW_OFF'));
		},
		async show_crucible_capacity_modal() {
			await refresh(true);
			state.crucible_capacity_base = state.crucible_capacity.base ?? 100;
			state.crucible_capacity_auto_renew = state.crucible_capacity.auto_renew === true;
			queue_modal('MOD_MP_WISH_CAPACITY', 'crucible-capacity-modal', 'assets/crucible.png', { showConfirmButton: false, customClass: { popup: 'mp-crucible-capacity-popup' } });
		},
		async crucible_confirm_capacity() {
			if (!state.crucible_capacity_can_confirm) return;
			if (state.crucible_capacity_renewal_changed) await this.crucible_save_renewal();
			else await this.crucible_buy_capacity();
		},
		crucible_capacity_tier_cost(tier) {
			const current = state.crucible_capacity.base ?? 100;
			if (tier === 100) return getLangString('MOD_MP_WISH_FREE');
			if (tier < current) return '—';
			if (tier === current) return getLangString('MOD_MP_WISH_ACTIVE');
			return `${this.crucible_capacity_ep(this.crucible_capacity_price(tier) - this.crucible_capacity_price(current))} EP`;
		},
		async crucible_buy_capacity() {
			if (state.crucible_busy || state.crucible_capacity_base <= (state.crucible_capacity.base ?? 100) ||
				!state.crucible_capacity_quote || state.crucible_capacity_quote > (state.crucible?.capacity?.points_micros ?? 0)) return;
			if (await wish_action('capacity', { base: Number(state.crucible_capacity_base),
				ep_micros: state.crucible_capacity_quote, auto_renew: state.crucible_capacity_auto_renew }))
				await close_modal_and_wait('crucible-capacity-modal');
		},
		async crucible_save_renewal() {
			if (await wish_action('renewal', { auto_renew: state.crucible_capacity_auto_renew, ep_micros: state.crucible_capacity.renewal_micros }))
				await close_modal_and_wait('crucible-capacity-modal');
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
