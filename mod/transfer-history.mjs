export const HISTORY_PANES = ['inbox', 'outbox', 'pending'];
export const HISTORY_PAGE_SIZE = 5;
export const HISTORY_WINDOW = 14 * 24 * 60 * 60 * 1000;

export function create_transfer_history_state() {
	return Object.fromEntries(HISTORY_PANES.map(pane => [pane, {
		entries: [], next_cursor: null, visible_count: HISTORY_PAGE_SIZE,
		loading: false, error: false, loaded: false, retry_append: false,
		server_time: 0, loaded_at: 0
	}]));
}

export function visible_transfer_history(page, local_now = performance.now()) {
	// Advance the server clock using monotonic elapsed time, never the local wall clock.
	const elapsed = Math.max(0, local_now - page.loaded_at);
	const now = page.server_time + elapsed;
	const cutoff = now - HISTORY_WINDOW;
	return page.entries.filter(entry => entry.occurred_at >= cutoff && entry.occurred_at <= now);
}

export function create_transfer_history_loader({ state, api_get, scope, now = () => performance.now() }) {
	return async function load(pane, append = false) {
		if (!HISTORY_PANES.includes(pane)) return false;
		const page = state.transfer_history[pane];
		if (page.loading) return false;
		// Reveal cached entries before requesting the next older page.
		if (append && page.entries.length > page.visible_count) {
			page.visible_count += HISTORY_PAGE_SIZE;
			return true;
		}
		if (append && !page.next_cursor) return false;
		const request_scope = scope();
		const is_current_request = () => scope() === request_scope && page === state.transfer_history[pane];
		const cursor = append ? page.next_cursor : null;
		page.loading = true;
		page.error = false;
		page.retry_append = append;
		try {
			const query = cursor ? `&before_at=${cursor.occurred_at}&before_id=${cursor.id}` : '';
			const result = await api_get(`/api/transfers/history?pane=${pane}${query}`);
			if (!is_current_request()) return false;
			// Validate the response envelope before applying entries or pagination state.
			if (!Array.isArray(result?.entries) || !Number.isSafeInteger(result.server_time)) {
				page.error = true;
				return false;
			}
			apply_history_response(page, result, append, now);
			return true;
		} catch {
			if (is_current_request()) page.error = true;
			return false;
		} finally {
			// Release the captured page only; a replacement may have its own request.
			page.loading = false;
		}
	};
}

// Only an overlapping head refresh can retain the already loaded tail. A gap
// starts a new page chain, while an overlap keeps its existing older-page cursor.
function refresh_retains_older_history(entries, incoming) {
	const known = new Set(entries.map(entry => entry.id));
	if (!incoming.some(entry => known.has(entry.id))) return false;
	const last = incoming[incoming.length - 1];
	return entries.some(entry => entry.occurred_at < last.occurred_at ||
		(entry.occurred_at === last.occurred_at && entry.id < last.id));
}

function apply_history_response(page, result, append, now) {
	const keep_older = !append && refresh_retains_older_history(page.entries, result.entries);
	const previous = append || keep_older ? page.entries : [];
	// Incoming snapshots replace cached entries; the last incoming duplicate wins.
	const merged = new Map([...previous, ...result.entries].map(entry => [entry.id, entry]));
	page.server_time = result.server_time;
	page.loaded_at = now();
	page.entries = visible_transfer_history({ ...page, entries: [...merged.values()] }, page.loaded_at)
		.sort((left, right) => right.occurred_at - left.occurred_at || right.id - left.id);
	if (!keep_older) page.next_cursor = result.next_cursor ?? null;
	page.visible_count = append ? page.visible_count + HISTORY_PAGE_SIZE : HISTORY_PAGE_SIZE;
	page.loaded = true;
}

export function transfer_history_items(items, is_currency) {
	const rows = [];
	const currencies = new Map();
	for (const item of items) {
		if (!is_currency(item.item_id)) { rows.push(item); continue; }
		const key = `${item.item_id}:${item.direction}`;
		const existing = currencies.get(key);
		if (existing) existing.qty += item.qty;
		else { const row = { ...item }; currencies.set(key, row); rows.push(row); }
	}
	return rows;
}

const event_labels = {
	'inbox.claimed': 'CLAIMED',
	'gift.sent': 'GIFT_SENT', 'gift-send': 'GIFT_SENT',
	'gift.accepted': 'GIFT_ACCEPTED', 'gift.returned': 'GIFT_RETURNED', 'gift.discarded': 'GIFT_DISCARDED',
	'trade-offer': 'TRADE_OFFER', 'trade-counter': 'TRADE_COUNTER', 'trade-accept': 'TRADE_ACCEPTED',
	'trade-decline': 'TRADE_DECLINED', 'trade-cancel': 'TRADE_CANCELLED', 'trade-resolve': 'CLAIMED',
	'haggle.created': 'HAGGLE_CREATED', 'haggle.countered': 'HAGGLE_COUNTERED', 'haggle.accepted': 'HAGGLE_ACCEPTED',
	'haggle.cancelled': 'HAGGLE_CANCELLED', 'haggle.rejected': 'HAGGLE_REJECTED', 'haggle.expired': 'HAGGLE_EXPIRED', 'haggle.claimed': 'CLAIMED',
	'market-sell': 'MARKET_SELL', 'market-buy-order': 'MARKET_ORDER', 'market-buy': 'MARKET_BUY',
	'market-fulfill': 'MARKET_FULFILL', 'market-payout': 'MARKET_PAYOUT', 'market-cancel': 'MARKET_RETURN',
	'market-claim-legacy-payouts': 'MARKET_PAYOUT', 'market-haggle': 'HAGGLE_ESCROW',
	'market-haggle-counter': 'HAGGLE_ESCROW', 'market-haggle-accept': 'HAGGLE_ACCEPTED',
	'market-haggle-terminate': 'HAGGLE_CANCELLED', 'market-haggle-claim': 'CLAIMED', 'market-destroy': 'MARKET_DESTROY',
	'crucible-wish-make': 'WISH_MADE', 'crucible-cast': 'CRUCIBLE_CAST', 'crucible-reclaim': 'CRUCIBLE_RECLAIM', 'crucible-clear': 'CRUCIBLE_CLEAR',
	'crucible.wish_delivered': 'WISH_GRANTED', 'crucible.wish_claimed': 'WISH_GRANTED',
	'crucible.wish_departure_delivered': 'WISH_GRANTED', 'crucible.reclaimed': 'CRUCIBLE_RECLAIM',
	'gift-accept': 'GIFT_ACCEPTED', 'campaign-claim': 'RECEIVED', 'campaign-contribute': 'SENT'
};

export function transfer_history_label(entry, get_lang, inbox_title) {
	if (entry.event_type === 'inbox.received') return history_source_title(entry, get_lang, inbox_title);
	return get_lang('MOD_MP_TRANSFER_HISTORY_' + (event_labels[entry.event_type] ?? (entry.pane === 'outbox' ? 'SENT' : 'RECEIVED')));
}

// Feature identifiers stay internal; all visible context uses localized labels.
export function transfer_history_context(entry, get_lang) {
	if (entry.event_type === 'inbox.received') return '';
	if (entry.event_type === 'inbox.claimed') return get_lang('MOD_MP_TRANSFER_HISTORY_TO').replace('%s', get_lang('MOD_MP_TRANSFER_HISTORY_BANK'));
	if (entry.pane === 'pending') return entry.source_name
		? get_lang('MOD_MP_TRANSFER_HISTORY_WITH').replace('%s', entry.source_name) : '';
	const labels = { market: 'MOD_MP_PAGE_MARKET', crucible: 'MOD_MP_PAGE_CRUCIBLE',
		campaign: 'MOD_MP_TRANSFER_HISTORY_CAMPAIGN', gift: 'MOD_MP_TRANSFER_HISTORY_GIFT', trade: 'MOD_MP_TRANSFER_HISTORY_TRADE' };
	const feature = labels[entry.source_type] ? get_lang(labels[entry.source_type]) : '';
	const direct_exchange = entry.pane === 'outbox' && ['market-buy', 'market-fulfill'].includes(entry.event_type);
	const destination = direct_exchange && entry.source_name ? entry.source_name
		: [feature, entry.source_name].filter(Boolean).join(' · ');
	return destination ? get_lang(entry.pane === 'outbox' ? 'MOD_MP_TRANSFER_HISTORY_TO' : 'MOD_MP_TRANSFER_HISTORY_FROM').replace('%s', destination) : '';
}

export function transfer_history_sources(item, get_lang, inbox_title) {
	if (!Array.isArray(item.sources) || item.sources.length === 0) return [];
	const known = item.sources.reduce((total, source) => total + source.qty, 0);
	// Reject contradictory attribution rather than display invented quantities.
	if (!Number.isSafeInteger(known) || known > item.qty) return [];
	const rows = item.sources.map(source => ({ ...source, title: history_source_title(source, get_lang, inbox_title) }));
	if (known < item.qty) rows.push({ qty: item.qty - known, title: get_lang('MOD_MP_TRANSFER_HISTORY_UNKNOWN_SOURCE') });
	return rows;
}

function history_source_title(source, get_lang, inbox_title) {
	if (source.source_type === 'crucible') return get_lang('MOD_MP_TRANSFER_HISTORY_' +
		(source.source_name === 'Wish Granted' ? 'WISH_GRANTED' : 'CRUCIBLE_RECLAIM'));
	if (source.source_type === 'campaign') return get_lang('MOD_MP_TRANSFER_HISTORY_CAMPAIGN');
	return inbox_title(source);
}

// Context explains the exchange; it never participates in signed movements or claims.
export function transfer_history_exchange(entry, get_lang, format_item) {
	const exchange = entry.exchange;
	const labels = { purchased: 'PURCHASED', paid: 'PAID', sold: 'SOLD', proceeds: 'PROCEEDS' };
	if (entry.event_type === 'inbox.claimed' || !exchange || !Object.hasOwn(labels, exchange.label) ||
		typeof exchange.item_id !== 'string' || !exchange.item_id.trim() ||
		!Number.isSafeInteger(exchange.qty) || exchange.qty <= 0) return '';
	return get_lang('MOD_MP_TRANSFER_HISTORY_EXCHANGE_' + labels[exchange.label]).replace('%s', format_item(exchange));
}
