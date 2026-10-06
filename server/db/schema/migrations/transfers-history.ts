import type { Migration } from '../types';

const now = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
const cutoff = `(${now} - 1209600000)`;

// Receipt snapshots survive acknowledgement and retain exact local value effects.
function receipt_history(receipt: string, reconstructed: number): string {
	return ['inbox', 'outbox'].map(pane => {
		const effect = pane === 'outbox' ? "json_extract(effect.value, '$.qty') < 0"
			: "json_extract(effect.value, '$.qty') > 0 AND json_extract(effect.value, '$.storage') IN ('bank', 'gp')";
		return `
		INSERT OR IGNORE INTO transfer_history_events(client_id,pane,event_type,source_key,occurred_at,reconstructed)
		SELECT r.client_id,'${pane}',r.kind,'receipt:' || r.id,r.created_at,${reconstructed}
		FROM ${receipt} r WHERE r.kind NOT LIKE 'charity-%' AND r.created_at >= ${cutoff}
		AND EXISTS (SELECT 1 FROM json_each(r.response_json,'$.receipt.effects') effect WHERE ${effect}) ON CONFLICT(client_id,pane,source_key) DO NOTHING;
		INSERT OR IGNORE INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
		SELECT h.id,CAST(effect.key AS INTEGER),COALESCE(json_extract(effect.value,'$.item_id'),'melvorD:GP'),
		ABS(json_extract(effect.value,'$.qty')),'${pane === 'outbox' ? 'out' : 'in'}'
		FROM ${receipt} r JOIN transfer_history_events h ON h.client_id=r.client_id AND h.pane='${pane}' AND h.source_key='receipt:' || r.id,
		json_each(r.response_json,'$.receipt.effects') effect WHERE ${effect} ON CONFLICT(event_id,ordinal) DO NOTHING;`;
	}).join('\n');
}

function inbox_arrival(row: string, qty: string): string {
	const key = `'inbox:' || json_array(${row}.client_id,${row}.source_type,${row}.source_name,${row}.updated_at)`;
	return `
	INSERT OR IGNORE INTO transfer_history_events(client_id,pane,event_type,source_key,occurred_at,source_type,source_name)
	VALUES(${row}.client_id,'inbox','inbox.received',${key},${row}.updated_at,${row}.source_type,${row}.source_name)
	ON CONFLICT(client_id,pane,source_key) DO NOTHING;
	INSERT INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
	SELECT h.id,COALESCE((SELECT ordinal FROM transfer_history_items WHERE event_id=h.id AND item_id=${row}.item_id AND direction='in'),
	(SELECT COALESCE(MAX(ordinal),-1)+1 FROM transfer_history_items WHERE event_id=h.id)),${row}.item_id,${qty},'in' FROM transfer_history_events h
	WHERE client_id=${row}.client_id AND pane='inbox' AND source_key=${key}
	ON CONFLICT(event_id,ordinal) DO UPDATE SET qty=qty+excluded.qty;`;
}

function haggle_history(table: string, event: string, time: string, suffix: string, reconstructed: number): string {
	return ['initiator_id', 'owner_id'].map((owner, index) => {
		const other = index === 0 ? 'owner_id' : 'initiator_id';
		return `
		INSERT OR IGNORE INTO transfer_history_events(client_id,pane,event_type,source_key,occurred_at,source_name,reconstructed)
		SELECT r.${owner},'pending',${event},'haggle:' || r.id || ':' || ${suffix},${time},c.display_name,${reconstructed}
		FROM ${table} r JOIN clients c ON c.id=r.${other} WHERE ${time} >= ${cutoff};
		INSERT OR IGNORE INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
		SELECT h.id,0,r.item_id,r.item_qty,'context' FROM ${table} r JOIN transfer_history_events h
		ON h.client_id=r.${owner} AND h.pane='pending' AND h.source_key='haggle:' || r.id || ':' || ${suffix};
		INSERT OR IGNORE INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
		SELECT h.id,1,'melvorD:GP',r.item_qty*r.offer_price,'context' FROM ${table} r JOIN transfer_history_events h
		ON h.client_id=r.${owner} AND h.pane='pending' AND h.source_key='haggle:' || r.id || ':' || ${suffix}${reconstructed === 1 && suffix === "'created'" ? ' AND r.revision=1' : ''};`;
	}).join('\n');
}

export const transfers_history_migration: Migration = {
	version: 159,
	sql: `
	CREATE TABLE transfer_history_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
		pane TEXT NOT NULL CHECK(pane IN ('inbox','outbox','pending')),
		event_type TEXT NOT NULL,
		source_key TEXT NOT NULL,
		occurred_at INTEGER NOT NULL CHECK(occurred_at BETWEEN 0 AND 9007199254740991),
		source_type TEXT NOT NULL DEFAULT '',
		source_name TEXT NOT NULL DEFAULT '',
		reconstructed INTEGER NOT NULL DEFAULT 0 CHECK(reconstructed IN (0,1)),
		UNIQUE(client_id,pane,source_key)
	);
	CREATE INDEX idx_transfer_history_feed ON transfer_history_events(client_id,pane,occurred_at DESC,id DESC);
	CREATE TABLE transfer_history_items (
		event_id INTEGER NOT NULL REFERENCES transfer_history_events(id) ON DELETE CASCADE,
		ordinal INTEGER NOT NULL,
		item_id TEXT NOT NULL,
		qty INTEGER NOT NULL CHECK(qty BETWEEN 1 AND 9007199254740991),
		direction TEXT NOT NULL CHECK(direction IN ('in','out','context')),
		PRIMARY KEY(event_id,ordinal)
	);

	${receipt_history('economy_receipts', 1)}

	-- Historical actor-only Trade commands have no retained counterparty snapshot.
	INSERT OR IGNORE INTO transfer_history_events(client_id,pane,event_type,source_key,occurred_at,reconstructed)
	SELECT client_id,'pending',kind,'receipt:' || id,created_at,1 FROM economy_receipts
	WHERE kind IN ('trade-offer','trade-counter','trade-accept','trade-decline','trade-cancel','trade-resolve') AND created_at >= ${cutoff};

	INSERT OR IGNORE INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
	SELECT h.id,CAST(effect.key AS INTEGER),COALESCE(json_extract(effect.value,'$.item_id'),'melvorD:GP'),
	ABS(json_extract(effect.value,'$.qty')),'context'
	FROM economy_receipts r JOIN transfer_history_events h ON h.client_id=r.client_id AND h.pane='pending' AND h.source_key='receipt:' || r.id,
	json_each(r.response_json,'$.receipt.effects') effect WHERE json_extract(effect.value,'$.qty')!=0;

	-- Gift semantic audit preserves both participants and the exact item bundle.
	INSERT OR IGNORE INTO transfer_history_events(client_id,pane,event_type,source_key,occurred_at,source_name,reconstructed)
	SELECT p.client_id,'pending',a.event_type,'audit:' || a.id,a.occurred_at,a.actor_display_name,1
	FROM audit_events a JOIN audit_event_participants p ON p.event_id=a.id
	WHERE a.event_type IN ('gift.sent','gift.accepted') AND a.occurred_at >= ${cutoff}
	AND EXISTS(SELECT 1 FROM clients c WHERE c.id=p.client_id);
	INSERT OR IGNORE INTO transfer_history_events(client_id,pane,event_type,source_key,occurred_at,source_name,reconstructed)
	SELECT a.actor_client_id,'pending',a.event_type,'audit:' || a.id,a.occurred_at,p.display_name,1
	FROM audit_events a JOIN audit_event_participants p ON p.event_id=a.id
	WHERE a.event_type IN ('gift.sent','gift.accepted') AND a.occurred_at >= ${cutoff}
	AND EXISTS(SELECT 1 FROM clients c WHERE c.id=a.actor_client_id);
	INSERT OR IGNORE INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
	SELECT h.id,v.ordinal,v.object_id,v.quantity,'context' FROM transfer_history_events h
	JOIN audit_events a ON h.source_key='audit:' || a.id JOIN audit_event_values v ON v.event_id=a.id
	WHERE v.quantity>0;

	-- Acknowledged claims are exact known Bank deliveries, independent of deleted Inbox stacks.
	INSERT OR IGNORE INTO transfer_history_events(client_id,pane,event_type,source_key,occurred_at,reconstructed)
	SELECT client_id,'inbox','inbox.claimed','claim:' || id,acknowledged_at,1 FROM inbox_claims
	WHERE acknowledged_at >= ${cutoff};
	INSERT OR IGNORE INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
	SELECT h.id,ROW_NUMBER() OVER(PARTITION BY h.id ORDER BY i.item_id)-1,i.item_id,i.qty,'in'
	FROM inbox_claims c JOIN transfer_history_events h ON h.client_id=c.client_id AND h.pane='inbox' AND h.source_key='claim:' || c.id
	JOIN inbox_claim_items i ON i.claim_id=c.id WHERE i.qty>0;

	${haggle_history('market_haggles', "'haggle.created'", 'r.created_at', "'created'", 1)}
	${haggle_history('(SELECT * FROM market_haggles WHERE status != \'active\')', "'haggle.' || r.status", 'r.terminal_at', "'terminal'", 1)}


	-- Retained semantic value movements provide exact deliveries even after source stacks disappeared.
	INSERT OR IGNORE INTO transfer_history_events(client_id,pane,event_type,source_key,occurred_at,reconstructed)
	SELECT DISTINCT CAST(m.to_key AS INTEGER),'inbox',a.event_type,'audit:' || a.id,a.occurred_at,1
	FROM audit_events a JOIN audit_value_movements m ON m.event_id=a.id JOIN clients c ON c.id=CAST(m.to_key AS INTEGER)
	WHERE m.to_kind='inbox' AND a.event_type NOT LIKE 'charitree.%' AND a.occurred_at >= ${cutoff};
	INSERT OR IGNORE INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
	SELECT h.id,ROW_NUMBER() OVER(PARTITION BY h.id ORDER BY m.object_id)-1,m.object_id,SUM(m.quantity),'in'
	FROM transfer_history_events h JOIN audit_events a ON h.source_key='audit:' || a.id
	JOIN audit_value_movements m ON m.event_id=a.id AND CAST(m.to_key AS INTEGER)=h.client_id
	WHERE h.pane='inbox' AND m.to_kind='inbox' GROUP BY h.id,m.object_id;

	-- Existing active Trade offers can still supply the recipient's exact original offer.
	INSERT OR IGNORE INTO transfer_history_events(client_id,pane,event_type,source_key,occurred_at,source_name,reconstructed)
	SELECT t.recipient_id,'pending','trade-offer','trade:' || t.trade_id || ':trade-offer',t.created_at,c.display_name,1
	FROM trade_offers t JOIN clients c ON c.id=t.sender_id WHERE t.created_at >= ${cutoff};
	INSERT OR IGNORE INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
	SELECT h.id,i.id,i.item_id,i.qty,'in' FROM trade_offers t JOIN trade_items i ON i.trade_id=t.trade_id AND i.counter=0
	JOIN transfer_history_events h ON h.client_id=t.recipient_id AND h.pane='pending' AND h.source_key='trade:' || t.trade_id || ':trade-offer';

	INSERT OR IGNORE INTO transfer_history_events(client_id,pane,event_type,source_key,occurred_at,source_name,reconstructed)
	SELECT a.actor_client_id,'outbox','gift-send','audit:' || a.id,a.occurred_at,p.display_name,1
	FROM audit_events a JOIN audit_event_participants p ON p.event_id=a.id
	WHERE a.event_type='gift.sent' AND a.occurred_at >= ${cutoff}
	AND EXISTS(SELECT 1 FROM clients c WHERE c.id=a.actor_client_id)
	AND NOT EXISTS(SELECT 1 FROM economy_receipts r WHERE r.id=a.command_id AND r.client_id=a.actor_client_id AND r.kind='gift-send');
	INSERT OR IGNORE INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
	SELECT h.id,v.ordinal,v.object_id,v.quantity,'out' FROM transfer_history_events h
	JOIN audit_events a ON h.source_key='audit:' || a.id JOIN audit_event_values v ON v.event_id=a.id
	WHERE h.pane='outbox' AND v.quantity>0;

	INSERT OR IGNORE INTO transfer_history_events(client_id,pane,event_type,source_key,occurred_at,reconstructed)
	SELECT client_id,'pending','haggle.claimed','haggle-claim:' || haggle_id,claimed_at,1 FROM market_haggle_claims WHERE claimed_at >= ${cutoff};
	INSERT OR IGNORE INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
	SELECT h.id,0,c.item_id,c.item_qty,'in' FROM market_haggle_claims c JOIN transfer_history_events h
	ON h.client_id=c.client_id AND h.pane='pending' AND h.source_key='haggle-claim:' || c.haggle_id WHERE c.item_qty>0;
	INSERT OR IGNORE INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
	SELECT h.id,1,'melvorD:GP',c.gp,'in' FROM market_haggle_claims c JOIN transfer_history_events h
	ON h.client_id=c.client_id AND h.pane='pending' AND h.source_key='haggle-claim:' || c.haggle_id WHERE c.gp>0;

	CREATE TRIGGER history_receipt AFTER INSERT ON economy_receipts BEGIN
		${receipt_history('(SELECT * FROM economy_receipts WHERE id=NEW.id)', 0)}
	END;
	CREATE TRIGGER history_inbox_insert AFTER INSERT ON inbox_items
	WHEN NEW.qty>0 AND NEW.updated_at IS NOT NULL AND NEW.source_type != 'charitree' BEGIN
		${inbox_arrival('NEW', 'NEW.qty')}
	END;
	CREATE TRIGGER history_inbox_update AFTER UPDATE OF qty ON inbox_items
	WHEN NEW.qty>OLD.qty AND NEW.updated_at IS NOT NULL AND NEW.source_type != 'charitree' BEGIN
		${inbox_arrival('NEW', 'NEW.qty-OLD.qty')}
	END;
	CREATE TRIGGER history_inbox_claim AFTER UPDATE OF acknowledged_at ON inbox_claims
	WHEN OLD.acknowledged_at IS NULL AND NEW.acknowledged_at IS NOT NULL BEGIN
		INSERT INTO transfer_history_events(client_id,pane,event_type,source_key,occurred_at)
		VALUES(NEW.client_id,'inbox','inbox.claimed','claim:' || NEW.id,NEW.acknowledged_at);
		INSERT INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
		SELECT h.id,ROW_NUMBER() OVER(ORDER BY i.item_id)-1,i.item_id,i.qty,'in'
		FROM inbox_claim_items i JOIN transfer_history_events h ON h.client_id=NEW.client_id AND h.pane='inbox' AND h.source_key='claim:' || NEW.id
		WHERE i.claim_id=NEW.id;
	END;
	CREATE TRIGGER history_haggle_created AFTER INSERT ON market_haggles BEGIN
		${haggle_history('(SELECT * FROM market_haggles WHERE id=NEW.id)', "'haggle.created'", 'r.created_at', "'created'", 0)}
	END;
	CREATE TRIGGER history_haggle_updated AFTER UPDATE OF status,revision ON market_haggles
	WHEN NEW.status!=OLD.status OR NEW.revision!=OLD.revision BEGIN
		${haggle_history('(SELECT * FROM market_haggles WHERE id=NEW.id)', "CASE WHEN r.status='active' THEN 'haggle.countered' ELSE 'haggle.' || r.status END", 'r.updated_at', "'revision:' || r.revision || ':' || r.status", 0)}
	END;
	CREATE TRIGGER history_haggle_claimed AFTER UPDATE OF claimed_at ON market_haggle_claims
	WHEN OLD.claimed_at IS NULL AND NEW.claimed_at IS NOT NULL BEGIN
		INSERT INTO transfer_history_events(client_id,pane,event_type,source_key,occurred_at)
		VALUES(NEW.client_id,'pending','haggle.claimed','haggle-claim:' || NEW.haggle_id,NEW.claimed_at);
		INSERT INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
		SELECT id,0,NEW.item_id,NEW.item_qty,'in' FROM transfer_history_events
		WHERE client_id=NEW.client_id AND pane='pending' AND source_key='haggle-claim:' || NEW.haggle_id AND NEW.item_qty>0;
		INSERT INTO transfer_history_items(event_id,ordinal,item_id,qty,direction)
		SELECT id,1,'melvorD:GP',NEW.gp,'in' FROM transfer_history_events
		WHERE client_id=NEW.client_id AND pane='pending' AND source_key='haggle-claim:' || NEW.haggle_id AND NEW.gp>0;
	END;
	CREATE TRIGGER history_feed_changed AFTER INSERT ON transfer_history_events BEGIN
		UPDATE clients SET event_revision=event_revision+1 WHERE id=NEW.client_id;
	END;
	`
};
