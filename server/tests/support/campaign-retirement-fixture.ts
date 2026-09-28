import { strict as assert } from 'node:assert';
import { db } from '../../db';
import { CAMPAIGN_REFUND_START, preview_campaign_retirement, release_campaign_refunds,
	settle_campaign_retirement } from '../../campaign-retirement';
import { acknowledge_inbox_claim, create_inbox_claim, get_inbox, get_inbox_claim_view } from '../../inbox';

const cutover_at = CAMPAIGN_REFUND_START + 10_000;

db.run("INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id) " +
	"VALUES (1, 'retirement-client', 'key', '111-111-111', 'Retirement Client', 'melvorD:Plant')");
db.run("INSERT INTO guilds (id, name, icon_id) VALUES (100, 'Retirement Guild', 'multiplayer')");
db.run("INSERT INTO campaign_state (id, guild_id, campaign_id, item_id, item_amount, item_current, " +
	"required_contributors) VALUES (100, 100, 'campaign_jungle', 'melvorD:Rune_Essence', 100, 20, 2)");
db.run('INSERT INTO campaign_contributions (campaign_id, client_id, item_amount) VALUES (100, 1, 20)');
for (const state_id of [90, 91, 92])
	db.query('INSERT INTO campaign_completions (source_campaign_state_id, source_guild_id, client_id, ' +
		'campaign_id, item_id, item_amount, taken) VALUES (?, 100, 1, ?, ?, 1, 10)')
		.run(state_id, 'campaign_jungle', 'melvorD:Rune_Essence');
db.run("UPDATE service_settings SET value = 'draining' WHERE key = 'campaign_retirement_phase'");
const campaign_runtime = await import('../../app-runtime');
assert.equal((await campaign_runtime.start_new_campaign(100))?.active_id, 100);
assert.equal(db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM campaign_state WHERE guild_id = 100').get()?.count, 1);

function receipt(id: string, created_at: number, qty: number, acknowledged: boolean): void {
	db.query('INSERT INTO economy_receipts (id, client_id, kind, response_json, created_at, acknowledged_at) ' +
		'VALUES (?, 1, ?, ?, ?, ?)').run(id, 'campaign-contribute', JSON.stringify({
		success: true, item_id: 'melvorD:Rune_Essence', item_loss: qty,
		receipt: { id, kind: 'campaign-contribute', effects: [] }
	}), created_at, acknowledged ? created_at : null);
}

receipt('before-window', CAMPAIGN_REFUND_START - 1, 3, true);
receipt('window-start', CAMPAIGN_REFUND_START, 7, true);
receipt('pending-debit', CAMPAIGN_REFUND_START + 1, 5, false);
receipt('at-cutover', cutover_at, 11, true);

const preview = preview_campaign_retirement(cutover_at);
assert.equal(preview.refund_receipts, 2);
assert.equal(preview.refund_item_quantity, 12);
assert.equal(preview.pending_receipts, 1);
assert.equal(preview.forced_campaigns, 1);
assert.equal(preview.gp_total, 300);
assert.equal(db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM campaign_refunds').get()?.count, 0);

// Use a historical cutover in this isolated fixture; the live CLI rejects future cutovers.
const settled = settle_campaign_retirement(cutover_at);
assert.equal(settled.gp_total, preview.gp_total);
assert.deepEqual(settle_campaign_retirement(cutover_at), settled);
assert.equal(db.query<{ complete: number }, []>('SELECT complete FROM campaign_state WHERE id = 100').get()?.complete, 1);
assert.equal(db.query<{ taken: number }, []>('SELECT taken FROM campaign_completions WHERE source_campaign_state_id = 100').get()?.taken, 300);
assert.equal(db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM multiplayer_pet_ownership WHERE client_id = 1').get()?.count, 1);
assert.equal((await campaign_runtime.ensure_guild_campaign(100))?.active_id, 0);
assert.equal(db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM campaign_state WHERE guild_id = 100').get()?.count, 1);
assert.equal(db.query<{ value: string }, [string]>('SELECT value FROM service_settings WHERE key = ?').get('campaign_retirement_phase')?.value,
	'retired');

assert.equal(release_campaign_refunds(1), 1);
assert.equal(release_campaign_refunds(1), 0);
process.exit(0);
assert.deepEqual(get_inbox(1, '1.5.16').items, [{ item_id: 'melvorD:GP', qty: 300 }]);
assert.deepEqual(get_inbox(1, '1.6.0').items, [
	{ item_id: 'melvorD:GP', qty: 300 }, { item_id: 'melvorD:Rune_Essence', qty: 7 }
]);

const claim_id = create_inbox_claim(1, [], 1, undefined, '1.6.0')!;
assert.ok(claim_id);
assert.equal(get_inbox_claim_view(claim_id, 1, '1.5.16'), null);
assert.equal(create_inbox_claim(1, [], 1, undefined, '1.5.16'), null);
assert.equal(acknowledge_inbox_claim(1, claim_id, undefined, '1.5.16'), false);
assert.deepEqual(get_inbox_claim_view(claim_id, 1, '1.6.0')?.items, [
	{ id: 'melvorD:GP', qty: 300 }, { id: 'melvorD:Rune_Essence', qty: 7 }
]);
assert.equal(acknowledge_inbox_claim(1, claim_id, undefined, '1.6.0'), true);

db.run('UPDATE economy_receipts SET acknowledged_at = ? WHERE id = ?', [cutover_at + 1, 'pending-debit']);
assert.equal(release_campaign_refunds(1), 1);
assert.deepEqual(get_inbox(1, '1.5.16').items, []);
assert.deepEqual(get_inbox(1, '1.6.0').items, [{ item_id: 'melvorD:Rune_Essence', qty: 5 }]);
assert.equal(release_campaign_refunds(1), 0);
