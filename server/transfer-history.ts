import type { Database } from 'bun:sqlite';

export const TRANSFER_HISTORY_WINDOW = 14 * 24 * 60 * 60 * 1000;
export const TRANSFER_HISTORY_PAGE_SIZE = 20;
export type HistoryPane = 'inbox' | 'outbox' | 'pending';
export type HistoryItem = { item_id: string; qty: number; direction?: 'in' | 'out' | 'context' };

type HistoryInput = {
	client_id: number; pane: HistoryPane; event_type: string; source_key: string;
	occurred_at: number; source_name?: string; items?: HistoryItem[];
};

export function record_transfer_history(database: Database, input: HistoryInput): void {
	const inserted = database.query<{ id: number }, [number, string, string, string, number, string]>(
		'INSERT INTO transfer_history_events(client_id,pane,event_type,source_key,occurred_at,source_name) ' +
		'VALUES(?,?,?,?,?,?) ON CONFLICT(client_id,pane,source_key) DO NOTHING RETURNING id'
	).get(input.client_id, input.pane, input.event_type, input.source_key, input.occurred_at, input.source_name ?? '');
	if (!inserted) return;
	for (const [ordinal, item] of (input.items ?? []).entries()) {
		if (item.qty <= 0) continue;
		database.query('INSERT INTO transfer_history_items(event_id,ordinal,item_id,qty,direction) VALUES(?,?,?,?,?)')
			.run(inserted.id, ordinal, item.item_id, item.qty, item.direction ?? 'context');
	}
}

// Call before source rows/items are removed, inside the source action's transaction.
export function record_pending_exchange(database: Database, kind: 'gift' | 'trade', id: number,
	event_type: string, occurred_at = Date.now(), command_id?: unknown): void {
	const table = kind === 'gift' ? 'gifts' : 'trade_offers';
	const id_column = kind === 'gift' ? 'gift_id' : 'trade_id';
	const recipient_column = kind === 'gift' ? 'client_id' : 'recipient_id';
	const exchange = database.query<{ sender_id: number; recipient_id: number }, [number]>(
		`SELECT sender_id,${recipient_column} AS recipient_id FROM ${table} WHERE ${id_column}=?`
	).get(id);
	if (!exchange) return;
	const items = database.query<HistoryItem & { counter?: number }, [number]>(
		`SELECT item_id,qty${kind === 'trade' ? ',counter' : ''} FROM ${kind === 'gift' ? 'gift_items' : 'trade_items'} WHERE ${id_column}=? ORDER BY id`
	).all(id);
	if (typeof command_id === 'string' && ['gift.sent', 'trade-offer', 'trade-counter'].includes(event_type)) {
		const owner = event_type === 'trade-counter' ? exchange.recipient_id : exchange.sender_id;
		const other = owner === exchange.sender_id ? exchange.recipient_id : exchange.sender_id;
		const name = database.query<{ display_name: string }, [number]>('SELECT display_name FROM clients WHERE id=?').get(other);
		const outgoing = kind === 'gift' ? items : items.filter(item => item.counter === (event_type === 'trade-counter' ? 1 : 0));
		if (outgoing.some(item => item.qty > 0)) record_transfer_history(database, { client_id: owner, pane: 'outbox', event_type: kind === 'gift' ? 'gift-send' : event_type,
			source_key: `receipt:${command_id}`, occurred_at, source_name: name?.display_name,
			items: outgoing.map(item => ({ item_id: item.item_id, qty: item.qty, direction: 'out' })) });
	}
	for (const [client_id, other_id] of [[exchange.sender_id, exchange.recipient_id], [exchange.recipient_id, exchange.sender_id]]) {
		const name = database.query<{ display_name: string }, [number]>('SELECT display_name FROM clients WHERE id=?').get(other_id);
		record_transfer_history(database, { client_id, pane: 'pending', event_type,
			source_key: `${kind}:${id}:${event_type}`, occurred_at, source_name: name?.display_name, items: items.map(item => ({ item_id: item.item_id, qty: item.qty,
				direction: (kind === 'gift' ? client_id === exchange.sender_id
					: (client_id === exchange.sender_id) === (item.counter === 0)) ? 'out' : 'in' })) });
	}
}

export function get_transfer_history(database: Database, client_id: number, pane: HistoryPane,
	cursor: { occurred_at: number; id: number } | null = null, now = Date.now()) {
	const rows = database.query<{
		id: number; pane: HistoryPane; event_type: string; occurred_at: number; source_type: string; source_name: string; reconstructed: number;
	}, number[] | (number | string)[]>(
		'SELECT id,pane,event_type,occurred_at,source_type,source_name,reconstructed FROM transfer_history_events ' +
		'WHERE client_id=? AND pane=? AND occurred_at>=? AND occurred_at<=? ' +
		(cursor ? 'AND (occurred_at<? OR (occurred_at=? AND id<?)) ' : '') +
		'ORDER BY occurred_at DESC,id DESC LIMIT ?'
	).all(client_id, pane, now - TRANSFER_HISTORY_WINDOW, now,
		...(cursor ? [cursor.occurred_at, cursor.occurred_at, cursor.id] : []), TRANSFER_HISTORY_PAGE_SIZE + 1);
	const page = rows.slice(0, TRANSFER_HISTORY_PAGE_SIZE);
	const items = database.query<HistoryItem & { event_id: number }, (number | string)[]>(
		'SELECT event_id,item_id,qty,direction FROM transfer_history_items WHERE event_id IN ' +
		`(${page.map(() => '?').join(',') || 'NULL'}) ORDER BY event_id,ordinal`
	).all(...page.map(row => row.id));
	const sources = database.query<{ event_id: number; item_id: string; source_type: string; source_name: string; qty: number }, number[]>(
		'SELECT h.id AS event_id,s.item_id,s.source_type,s.source_name,s.qty FROM transfer_history_events h ' +
		'JOIN inbox_claims c ON h.source_key=\'claim:\' || c.id AND h.client_id=c.client_id ' +
		'JOIN inbox_claim_sources s ON s.claim_id=c.id WHERE h.id IN ' +
		`(${page.map(() => '?').join(',') || 'NULL'}) ORDER BY s.source_type,s.source_name`
	).all(...page.map(row => row.id));
	const last = page[page.length - 1];
	return {
		server_time: now,
		entries: page.map(row => ({ ...row, reconstructed: row.reconstructed === 1,
			items: items.filter(item => item.event_id === row.id).map(({ event_id, ...item }) => {
				const attribution = sources.filter(source => source.event_id === row.id && source.item_id === item.item_id)
					.map(({ event_id, item_id, ...source }) => source);
				return attribution.length ? { ...item, sources: attribution } : item;
			}) })),
		next_cursor: rows.length > TRANSFER_HISTORY_PAGE_SIZE && last ? { occurred_at: last.occurred_at, id: last.id } : null
	};
}
