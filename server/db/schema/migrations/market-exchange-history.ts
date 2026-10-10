import type { Migration } from '../types';

const now = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

function arrival(qty: string): string {
	const key = "COALESCE(NEW.history_key,'inbox:' || json_array(NEW.client_id,NEW.source_type,NEW.source_name,NEW.updated_at))";
	return `
		INSERT INTO transfer_history_events(client_id,pane,event_type,source_key,occurred_at,source_type,source_name)
		VALUES(NEW.client_id,'inbox','inbox.received',${key},NEW.updated_at,NEW.source_type,NEW.source_name)
		ON CONFLICT(client_id,pane,source_key) DO NOTHING;
		INSERT INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
		SELECT h.id,COALESCE((SELECT ordinal FROM transfer_history_items WHERE event_id=h.id AND item_id=NEW.item_id AND direction='in'),
		(SELECT COALESCE(MAX(ordinal),-1)+1 FROM transfer_history_items WHERE event_id=h.id)),NEW.item_id,${qty},'in'
		FROM transfer_history_events h WHERE client_id=NEW.client_id AND pane='inbox' AND source_key=${key}
		ON CONFLICT(event_id,ordinal) DO UPDATE SET qty=qty+excluded.qty;`;
}

export const market_exchange_history_migration: Migration = {
	version: 170,
	sql: `
	ALTER TABLE transfer_history_events ADD COLUMN exchange_json TEXT
		CHECK(exchange_json IS NULL OR json_valid(exchange_json));
	ALTER TABLE inbox_items ADD COLUMN history_key TEXT;
	DROP TRIGGER history_inbox_insert;
	DROP TRIGGER history_inbox_update;
	CREATE TRIGGER history_inbox_insert AFTER INSERT ON inbox_items
	WHEN NEW.qty>0 AND NEW.updated_at IS NOT NULL AND NEW.source_type != 'charitree' BEGIN
		${arrival('NEW.qty')}
	END;
	CREATE TRIGGER history_inbox_update AFTER UPDATE OF qty ON inbox_items
	WHEN NEW.qty>OLD.qty AND NEW.updated_at IS NOT NULL AND NEW.source_type != 'charitree' BEGIN
		${arrival('NEW.qty-OLD.qty')}
	END;
	-- Only exact actor receipts identify the other half of an older exchange.
	-- Inbox arrivals have no retained command link: do not guess from names or times.
	UPDATE transfer_history_events AS h SET exchange_json=(
		SELECT CASE WHEN h.event_type='market-buy' THEN json_object(
			'label','purchased','item_id',json_extract(r.response_json,'$.item_id'),
			'qty',json_extract(r.response_json,'$.item_qty'))
		ELSE json_object('label','proceeds','item_id','melvorD:GP',
			'qty',json_extract(r.response_json,'$.gp_gain')) END
		FROM economy_receipts r WHERE h.source_key='receipt:' || r.id AND r.client_id=h.client_id)
	WHERE h.pane='outbox' AND h.event_type IN ('market-buy','market-fulfill')
	AND h.occurred_at BETWEEN ${now}-1209600000 AND ${now}
	AND EXISTS(SELECT 1 FROM economy_receipts r WHERE h.source_key='receipt:' || r.id AND r.client_id=h.client_id
		AND r.kind=h.event_type AND json_type(r.response_json,'$.item_id')='text'
		AND length(json_extract(r.response_json,'$.item_id'))>0
		AND json_type(r.response_json,'$.item_qty')='integer'
		AND json_extract(r.response_json,'$.item_qty') BETWEEN 1 AND 9007199254740991
		AND (h.event_type='market-buy' OR (json_type(r.response_json,'$.gp_gain')='integer'
			AND json_extract(r.response_json,'$.gp_gain') BETWEEN 1 AND 9007199254740991)));
	UPDATE clients SET event_revision=event_revision+1 WHERE id IN (
		SELECT client_id FROM transfer_history_events WHERE exchange_json IS NOT NULL);
	`
};
