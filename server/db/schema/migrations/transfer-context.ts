import type { Migration } from '../types';

const now = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
const kind = `CASE
	WHEN event_type LIKE 'market-%' THEN 'market'
	WHEN event_type LIKE 'campaign-%' THEN 'campaign'
	WHEN event_type LIKE 'crucible-%' THEN 'crucible'
	WHEN event_type LIKE 'gift-%' OR event_type LIKE 'gift.%' THEN 'gift'
	WHEN event_type LIKE 'trade-%' THEN 'trade'
	ELSE '' END`;

export const transfer_context_migration: Migration = {
	version: 161,
	sql: `
	CREATE TABLE inbox_claim_sources (
		claim_id TEXT NOT NULL REFERENCES inbox_claims(id) ON DELETE CASCADE,
		item_id TEXT NOT NULL,
		source_type TEXT NOT NULL,
		source_name TEXT NOT NULL,
		qty INTEGER NOT NULL CHECK(qty BETWEEN 1 AND 9007199254740991),
		PRIMARY KEY(claim_id,item_id,source_type,source_name)
	);
	-- Only enrich the visible recent window. Retain every older snapshot unchanged.
	UPDATE transfer_history_events SET source_type=${kind}
	WHERE source_type='' AND occurred_at BETWEEN ${now}-1209600000 AND ${now};
	CREATE TRIGGER history_context AFTER INSERT ON transfer_history_events
	WHEN NEW.source_type='' BEGIN
		UPDATE transfer_history_events SET source_type=${kind} WHERE id=NEW.id;
	END;
	-- Claim movements preserve source categories and names, including names containing colons.
	INSERT INTO inbox_claim_sources(claim_id,item_id,source_type,source_name,qty)
	SELECT c.id,m.object_id,
	substr(m.from_key,length(c.client_id || ':')+1,
	 instr(substr(m.from_key,length(c.client_id || ':')+1),':')-1),
	substr(m.from_key,length(c.client_id || ':')+1+
	 instr(substr(m.from_key,length(c.client_id || ':')+1),':')),
	SUM(m.quantity)
	FROM inbox_claims c JOIN audit_events a ON a.source_key='inbox-claim:' || c.id || ':created'
	JOIN audit_value_movements m ON m.event_id=a.id AND m.from_kind='inbox'
	JOIN inbox_claim_items i ON i.claim_id=c.id AND i.item_id=m.object_id
	WHERE COALESCE(c.acknowledged_at,c.created_at) BETWEEN ${now}-1209600000 AND ${now}
	AND substr(m.from_key,1,length(c.client_id || ':'))=c.client_id || ':'
	AND instr(substr(m.from_key,length(c.client_id || ':')+1),':')>0
	GROUP BY c.id,m.object_id,m.from_key
	HAVING SUM(m.quantity)>0 AND SUM(m.quantity)<=i.qty
	AND (SELECT SUM(all_moves.quantity) FROM audit_value_movements all_moves
		WHERE all_moves.event_id=a.id AND all_moves.object_id=m.object_id
		AND all_moves.from_kind='inbox')<=i.qty;
	-- Gift audits retain counterparties even when the source Gift has disappeared.
	UPDATE transfer_history_events AS h SET source_name=(
	SELECT p.display_name FROM audit_events a JOIN audit_event_participants p ON p.event_id=a.id
	WHERE a.command_id=substr(h.source_key,9) AND a.actor_client_id=h.client_id
	AND a.event_type='gift.sent' AND p.role='recipient' LIMIT 1)
	WHERE h.pane='outbox' AND h.event_type='gift-send' AND h.source_name=''
	AND h.occurred_at BETWEEN ${now}-1209600000 AND ${now}
	AND EXISTS(SELECT 1 FROM audit_events a JOIN audit_event_participants p ON p.event_id=a.id
	WHERE a.command_id=substr(h.source_key,9) AND a.actor_client_id=h.client_id
	AND a.event_type='gift.sent' AND p.role='recipient');
	-- Marketplace activity has exact command keys and historical buyer/seller names.
	UPDATE transfer_history_events AS h SET source_name=(
		SELECT CASE WHEN h.event_type='market-buy' THEN g.seller_display_name ELSE g.buyer_display_name END
		FROM guild_activity_events g WHERE g.actor_client_id=h.client_id
		AND g.source_key=(CASE WHEN h.event_type='market-buy' THEN 'market-purchase:' ELSE 'market-fulfillment:' END) || substr(h.source_key,9)
		LIMIT 1)
	WHERE h.pane='outbox' AND h.event_type IN ('market-buy','market-fulfill') AND h.source_name=''
	AND h.occurred_at BETWEEN ${now}-1209600000 AND ${now}
	AND EXISTS(SELECT 1 FROM guild_activity_events g WHERE g.actor_client_id=h.client_id
		AND g.source_key=(CASE WHEN h.event_type='market-buy' THEN 'market-purchase:' ELSE 'market-fulfillment:' END) || substr(h.source_key,9)
		AND CASE WHEN h.event_type='market-buy' THEN g.seller_display_name ELSE g.buyer_display_name END IS NOT NULL);
	-- Retained Haggle creation snapshots identify counterparts without consulting renamed Clients.
	UPDATE transfer_history_events AS h SET source_name=(
		SELECT original.source_name FROM economy_receipts r JOIN transfer_history_events original
		ON original.client_id=h.client_id AND original.source_key='haggle:' || json_extract(r.response_json,'$.haggle_id') || ':created'
		WHERE h.source_key='receipt:' || r.id AND original.source_name!='' LIMIT 1)
	WHERE h.event_type='market-haggle' AND h.source_name=''
	AND h.occurred_at BETWEEN ${now}-1209600000 AND ${now}
	AND EXISTS(SELECT 1 FROM economy_receipts r JOIN transfer_history_events original
		ON original.client_id=h.client_id AND original.source_key='haggle:' || json_extract(r.response_json,'$.haggle_id') || ':created'
		WHERE h.source_key='receipt:' || r.id AND original.source_name!='');
	UPDATE transfer_history_events AS h SET source_name=(
		SELECT original.source_name FROM transfer_history_events original
		WHERE original.client_id=h.client_id AND original.source_key='haggle:' || substr(h.source_key,14) || ':created'
		AND original.source_name!='' LIMIT 1)
	WHERE h.event_type='haggle.claimed' AND h.source_name=''
	AND h.occurred_at BETWEEN ${now}-1209600000 AND ${now}
	AND EXISTS(SELECT 1 FROM transfer_history_events original
		WHERE original.client_id=h.client_id AND original.source_key='haggle:' || substr(h.source_key,14) || ':created'
		AND original.source_name!='');
	UPDATE clients SET event_revision=event_revision+1
	WHERE id IN (SELECT client_id FROM transfer_history_events
	WHERE occurred_at BETWEEN ${now}-1209600000 AND ${now});
	`
};
