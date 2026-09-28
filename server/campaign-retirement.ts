import { db, get_service_setting } from './db';
import { add_inbox_gp, add_inbox_items } from './inbox';
import { get_campaign_item_gp_value } from './campaign_item_values';
import { get_campaign_pet_id, grant_campaign_pet_if_eligible, has_owned_pet } from './pets';
import { audit_position_key, create_audit_lot, record_audit_event } from './audit';

export const CAMPAIGN_REFUND_START = Date.UTC(2026, 8, 1);

type Donation = { id: string; client_id: number; acknowledged_at: number | null; item_id: string; qty: number };
type Completion = { source_campaign_state_id: number; client_id: number; campaign_id: string;
	item_id: string; item_amount: number };

export type CampaignRetirementSummary = {
	operation_id: string;
	cutover_at: number;
	completed_at: number;
	refund_receipts: number;
	refund_item_quantity: number;
	pending_receipts: number;
	forced_campaigns: number;
	gp_completions: number;
	gp_total: number;
};

function checked_sum(left: number, right: number): number {
	const total = left + right;
	if (!Number.isSafeInteger(total) || total < 0)
		throw new Error('Campaign retirement quantity exceeds the safe integer range');
	return total;
}

function donations_before(cutover_at: number): Donation[] {
	const receipts = db.query<{ id: string; client_id: number; acknowledged_at: number | null;
		response_json: string }, [number, number]>(
		"SELECT id, client_id, acknowledged_at, response_json FROM economy_receipts " +
		"WHERE kind = 'campaign-contribute' AND created_at >= ? AND created_at < ? ORDER BY created_at, id"
	).all(CAMPAIGN_REFUND_START, cutover_at);
	const donations: Donation[] = [];
	for (const receipt of receipts) {
		let response: unknown;
		try { response = JSON.parse(receipt.response_json); }
		catch { throw new Error(`Invalid Campaign receipt ${receipt.id}`); }
		if (typeof response !== 'object' || response === null || Array.isArray(response))
			throw new Error(`Invalid Campaign receipt ${receipt.id}`);
		const value = response as Record<string, unknown>;
		if (value.success !== true || typeof value.item_loss !== 'number' ||
			!Number.isSafeInteger(value.item_loss) || value.item_loss < 0 ||
			typeof value.item_id !== 'string' || !/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(value.item_id))
			throw new Error(`Invalid Campaign receipt ${receipt.id}`);
		if (value.item_loss > 0)
			donations.push({ id: receipt.id, client_id: receipt.client_id,
				acknowledged_at: receipt.acknowledged_at, item_id: value.item_id, qty: value.item_loss });
	}
	return donations;
}

function active_campaigns(): Array<{ id: number; guild_id: number; campaign_id: string; item_id: string }> {
	const rows = db.query<{ id: number; guild_id: number; campaign_id: string; item_id: string }, []>(
		'SELECT id, guild_id, campaign_id, item_id FROM campaign_state WHERE complete = 0 ORDER BY id'
	).all();
	for (const row of rows) {
		const latest = db.query<{ id: number }, [number]>(
			'SELECT MAX(id) AS id FROM campaign_state WHERE guild_id = ?'
		).get(row.guild_id);
		if (latest?.id !== row.id)
			throw new Error(`Guild ${row.guild_id} has an older unfinished Campaign`);
	}
	return rows;
}

function pending_completions(active: ReturnType<typeof active_campaigns>): Completion[] {
	const completions = db.query<Completion, []>(
		'SELECT source_campaign_state_id, client_id, campaign_id, item_id, item_amount ' +
		'FROM campaign_completions WHERE taken = 0 AND item_amount > 0 ORDER BY source_campaign_state_id, client_id'
	).all();
	for (const state of active) {
		const contributors = db.query<{ client_id: number; item_amount: number }, [number]>(
			'SELECT client_id, item_amount FROM campaign_contributions WHERE campaign_id = ? AND item_amount > 0'
		).all(state.id);
		for (const contributor of contributors)
			if (!completions.some(row => row.source_campaign_state_id === state.id && row.client_id === contributor.client_id))
				completions.push({ source_campaign_state_id: state.id, client_id: contributor.client_id,
					campaign_id: state.campaign_id, item_id: state.item_id, item_amount: contributor.item_amount });
	}
	return completions;
}

export function preview_campaign_retirement(cutover_at = Date.now()): CampaignRetirementSummary {
	if (!Number.isSafeInteger(cutover_at) || cutover_at < CAMPAIGN_REFUND_START)
		throw new Error('Invalid Campaign retirement cutover time');
	const prior = db.query<{ summary_json: string }, []>('SELECT summary_json FROM campaign_retirement WHERE id = 1').get();
	if (prior !== null)
		return JSON.parse(prior.summary_json) as CampaignRetirementSummary;
	if (get_service_setting('campaign_retirement_phase') !== 'draining')
		throw new Error('Campaigns must be draining before retirement');
	const donations = donations_before(cutover_at);
	const active = active_campaigns();
	const completions = pending_completions(active);
	let refund_item_quantity = 0;
	let gp_total = 0;
	for (const donation of donations)
		refund_item_quantity = checked_sum(refund_item_quantity, donation.qty);
	for (const completion of completions) {
		const gp_value = get_campaign_item_gp_value(completion.item_id);
		if (gp_value === null || !Number.isSafeInteger(completion.item_amount) || completion.item_amount <= 0)
			throw new Error(`Invalid Campaign completion ${completion.source_campaign_state_id}`);
		const pet_id = get_campaign_pet_id(completion.campaign_id);
		const completed_count = db.query<{ count: number }, [number, string]>(
			'SELECT COUNT(*) AS count FROM campaign_completions WHERE client_id = ? AND campaign_id = ?'
		).get(completion.client_id, completion.campaign_id)?.count ?? 0;
		const forced_count = completions.filter(row => row.client_id === completion.client_id &&
			row.campaign_id === completion.campaign_id && active.some(state => state.id === row.source_campaign_state_id) &&
			db.query('SELECT 1 FROM campaign_completions WHERE source_campaign_state_id = ? AND client_id = ?')
				.get(row.source_campaign_state_id, row.client_id) === null).length;
		const multiplier = pet_id !== null && (has_owned_pet(completion.client_id, pet_id) ||
			completed_count + forced_count >= 4) ? 15 : 10;
		gp_total = checked_sum(gp_total, Math.max(gp_value, 1) * completion.item_amount * multiplier);
	}
	return { operation_id: '', cutover_at, completed_at: 0,
		refund_receipts: donations.length, refund_item_quantity,
		pending_receipts: donations.filter(row => row.acknowledged_at === null).length,
		forced_campaigns: active.length, gp_completions: completions.length, gp_total };
}

export function settle_campaign_retirement(cutover_at = Date.now()): CampaignRetirementSummary {
	if (cutover_at > Date.now())
		throw new Error('Campaign retirement cutover cannot be in the future');
	return db.transaction(() => {
		const preview = preview_campaign_retirement(cutover_at);
		if (preview.completed_at > 0) return preview;
		const donations = donations_before(cutover_at);
		const active = active_campaigns();
		const completed_at = Date.now();
		const operation_id = crypto.randomUUID();
		for (const state of active) {
			db.query('UPDATE campaign_state SET complete = 1, campaign_next = ? WHERE id = ? AND complete = 0')
				.run(completed_at + 24 * 60 * 60 * 1000, state.id);
			db.query(
				'INSERT INTO campaign_completions (source_campaign_state_id, source_guild_id, client_id, ' +
				'campaign_id, item_id, item_amount, taken, created_at, updated_at) ' +
				'SELECT state.id, state.guild_id, contribution.client_id, state.campaign_id, state.item_id, ' +
				'contribution.item_amount, 0, ?, ? FROM campaign_contributions AS contribution ' +
				'JOIN campaign_state AS state ON state.id = contribution.campaign_id ' +
				'WHERE state.id = ? AND contribution.item_amount > 0 ' +
				'ON CONFLICT (source_campaign_state_id, client_id) DO NOTHING'
			).run(completed_at, completed_at, state.id);
		}
		const completions = pending_completions([]);
		for (const completion of completions)
			grant_campaign_pet_if_eligible(completion.client_id, completion.campaign_id, completed_at);
		let gp_total = 0;
		for (const completion of completions) {
			const gp_value = get_campaign_item_gp_value(completion.item_id);
			if (gp_value === null || completion.item_amount <= 0)
				throw new Error(`Invalid Campaign completion ${completion.source_campaign_state_id}`);
			const pet_id = get_campaign_pet_id(completion.campaign_id);
			const multiplier = pet_id !== null && has_owned_pet(completion.client_id, pet_id) ? 15 : 10;
			const reward = Math.max(gp_value, 1) * completion.item_amount * multiplier;
			gp_total = checked_sum(gp_total, reward);
			add_inbox_gp(completion.client_id, reward, { type: 'campaign' });
			const reward_event = record_audit_event({
				event_type: 'campaign.retirement_reward',
				source_key: `campaign-retirement:${completion.source_campaign_state_id}:${completion.client_id}:reward`,
				actor: { kind: 'system' }, occurred_at: completed_at,
				participants: [{ role: 'recipient', client_id: completion.client_id }],
				values: [{ object_id: 'melvorD:GP', quantity: reward, direction: 'create' }],
				details: { operation_id, campaign_state_id: completion.source_campaign_state_id }
			});
			create_audit_lot(reward_event, 'melvorD:GP', reward, 'inbox',
				audit_position_key('inbox', completion.client_id, 'campaign', ''));
			db.query('UPDATE campaign_completions SET taken = ?, updated_at = ? ' +
				'WHERE source_campaign_state_id = ? AND client_id = ? AND taken = 0')
				.run(reward, completed_at, completion.source_campaign_state_id, completion.client_id);
			db.query('UPDATE campaign_contributions SET taken = ? WHERE campaign_id = ? AND client_id = ?')
				.run(reward, completion.source_campaign_state_id, completion.client_id);
		}
		for (const donation of donations)
			db.query('INSERT INTO campaign_refunds (receipt_id, client_id, item_id, qty) VALUES (?, ?, ?, ?)')
				.run(donation.id, donation.client_id, donation.item_id, donation.qty);
		if (gp_total !== preview.gp_total ||
			db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM campaign_state WHERE complete = 0').get()?.count !== 0 ||
			db.query<{ count: number }, []>(
				'SELECT COUNT(*) AS count FROM campaign_completions WHERE taken = 0 AND item_amount > 0'
			).get()?.count !== 0 ||
			db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM campaign_refunds').get()?.count !== donations.length)
			throw new Error('Campaign retirement settlement did not match its dry run');
		db.query("UPDATE service_settings SET value = 'retired' WHERE key = 'campaign_retirement_phase'").run();
		const summary = { ...preview, operation_id, completed_at, gp_total };
		record_audit_event({ event_type: 'campaign.retired', source_key: `campaign-retirement:${operation_id}`,
			actor: { kind: 'operator', name: 'admin-cli' }, occurred_at: completed_at,
			details: { operation_id, cutover_at, refund_receipts: donations.length,
				forced_campaigns: active.length, gp_completions: completions.length } });
		db.query('INSERT INTO campaign_retirement (id, operation_id, cutover_at, completed_at, summary_json) ' +
			'VALUES (1, ?, ?, ?, ?)').run(operation_id, cutover_at, completed_at, JSON.stringify(summary));
		return summary;
	}).immediate();
}

export function release_campaign_refunds(client_id: number): number {
	return db.transaction(() => {
		if (get_service_setting('campaign_retirement_phase') !== 'retired') return 0;
		const ready = db.query<{ receipt_id: string; item_id: string; qty: number }, [number]>(
			'SELECT refund.receipt_id, refund.item_id, refund.qty FROM campaign_refunds AS refund ' +
			'JOIN economy_receipts AS receipt ON receipt.id = refund.receipt_id ' +
			'WHERE refund.client_id = ? AND refund.released_at IS NULL AND receipt.acknowledged_at IS NOT NULL '
			+ 'ORDER BY refund.receipt_id'
		).all(client_id);
		if (ready.length === 0) return 0;
		const amounts = new Map<string, number>();
		for (const row of ready)
			amounts.set(row.item_id, checked_sum(amounts.get(row.item_id) ?? 0, row.qty));
		const now = Date.now();
		for (const row of ready) {
			const event_id = record_audit_event({ event_type: 'campaign.refund_released',
				source_key: `campaign-refund:${row.receipt_id}`, actor: { kind: 'system' }, occurred_at: now,
				participants: [{ role: 'recipient', client_id }],
				values: [{ object_id: row.item_id, quantity: row.qty, direction: 'create' }],
				details: { receipt_id: row.receipt_id } });
			create_audit_lot(event_id, row.item_id, row.qty, 'inbox',
				audit_position_key('inbox', client_id, 'campaign_refund', ''));
		}
		add_inbox_items(client_id, [...amounts].map(([item_id, qty]) => ({ item_id, qty })),
			{ type: 'campaign_refund' });
		for (const row of ready)
			db.query('UPDATE campaign_refunds SET released_at = ? WHERE receipt_id = ? AND released_at IS NULL')
				.run(now, row.receipt_id);
		return ready.length;
	}).immediate();
}
