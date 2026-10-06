import type { JsonObject } from './http';
import { PETITION_TYPES, type PetitionType, type PetitionChoice, type PetitionLifecycle } from './council';
import type { Database } from 'bun:sqlite';

export function is_feature_tester(db: Database, client_id: number, feature: string): boolean {
	return db.query('SELECT 1 FROM character_feature_testers WHERE client_id=? AND feature=?').get(client_id, feature) !== null;
}

// Presentation-only snapshots never create escrow, deliveries, receipts, or counterparties.
// Negative IDs and a non-UUID Haggle namespace cannot address real exchange rows.
export function pending_test_data() {
	const party = { display_name: 'Preview Partner', icon_id: 'melvorD:Golbin' };
	const items = [{ id: -1, item_id: 'melvorD:Bronze_Sword', qty: 12, counter: 0 },
		{ id: -2, item_id: 'melvorD:GP', qty: 123456, counter: 0 }];
	const data = { items, other_player: party };
	const gifts = [
		{ id: -1, unresolved: false, data: { items, sender: party, flags: 0 } },
		{ id: -2, unresolved: false, data: { items, sender: party, flags: 1 } },
		{ id: -3, unresolved: true, data: { items: [{ id: -3, item_id: 'preview:Unavailable_Item', qty: 7, counter: 0 }], sender: party, flags: 1 } }
	];
	const trades = [0, 1].flatMap(state => [true, false].map(attending => ({
		trade_id: -(1 + state * 2 + Number(attending)), state, attending,
		data: { ...data, items: state === 0 ? items : [...items.map(item => ({ ...item, counter: 0 })),
			{ id: -3, item_id: 'melvorD:Raw_Shrimp', qty: 100, counter: 1 }] }
	})));
	const resolved_trades = [false, true].map((declined, index) => ({
		trade_id: -10 - index, data: { ...data, declined }
	}));
	const haggles = ['sell', 'buy'].flatMap(direction => [true, false].flatMap(is_initiator => [
		...[true, false].map(is_turn => ({
			id: `preview:active:${direction}:${is_initiator}:${is_turn}`, direction, status: 'active', is_initiator, is_turn, claim: null
		})),
		...['accepted', 'cancelled', 'rejected', 'expired'].map(status => {
			const is_buyer = direction === 'sell' ? is_initiator : !is_initiator;
			const receives_items = (status === 'accepted') === is_buyer;
			return { id: `preview:${status}:${direction}:${is_initiator}`, direction, status, is_initiator, is_turn: false,
			claim: { item_id: 'melvorD:Bronze_Sword', item_qty: receives_items ? 12 : 0,
				gp: receives_items ? 0 : 1080, claimed: false }
			};
		})
	]));
	for (const claimed of [true, false]) haggles.push({
		id: `preview:active:refund:${claimed}`, direction: 'sell', status: 'active', is_initiator: true, is_turn: true,
		claim: { item_id: 'melvorD:Bronze_Sword', item_qty: 0, gp: 120, claimed }
	});
	return {
		gifts: [...gifts, { id: -4, unresolved: false, data: null }],
		trades: [...trades, { trade_id: -5, state: 0, attending: true, data: null }],
		resolved_trades: [...resolved_trades, { trade_id: -12, data: null }],
		haggles: haggles.map(haggle => ({
			listing_id: -1, item_id: 'melvorD:Bronze_Sword',
			item_qty: 12, listing_price: 100, offer_price: 90, payer_escrow_gp: 1080, revision: 1,
			expires_at: null, counterparty: party, ...haggle
		}))
	};
}

export function valid_pending_test_action(kind: unknown, id: unknown, action: unknown): boolean {
	const data = pending_test_data();
	if (kind === 'gift') return data.gifts.some(row => row.id === id) && ['accept', 'decline', 'discard'].includes(String(action));
	if (kind === 'trade') return [...data.trades, ...data.resolved_trades].some(row => row.trade_id === id) &&
		['counter', 'accept', 'decline', 'cancel', 'resolve'].includes(String(action));
	if (kind === 'haggle') return data.haggles.some(row => row.id === id) && ['accept', 'counter', 'terminate', 'claim'].includes(String(action));
	return false;
}

// Council fixtures use stable negative IDs and never enter the Petition tables.
export function council_test_data(now = Date.now()) {
	const make = (type: PetitionType, index: number, options: {
		lifecycle?: PetitionLifecycle; vote?: PetitionChoice | null; eligible?: boolean;
		withdraw?: boolean; aye?: number; nay?: number;
		execution?: 'succeeded' | 'pending' | 'running' | 'failed';
	} = {}) => {
		const lifecycle = options.lifecycle ?? 'active';
		const active = lifecycle === 'active';
		const eligible = options.eligible ?? true;
		const current_vote = options.vote ?? null;
		const tally_visible = !active || (eligible && current_vote !== null);
		const aye = options.aye ?? 0;
		const nay = options.nay ?? 0;
		const proposal: JsonObject = type === 'appellation' ? { name: 'The Copper Kettle' }
			: type === 'heraldry' ? { icon_id: 'melvorD:Golbin' }
			: type === 'banishment' ? { target: { client_id: -1, display_name: 'Preview Adventurer', icon_id: 'melvorD:Golbin' } }
			: type === 'winnowing' ? { target_count: 7 }
			: type.startsWith('alliance_') ? {
				governance_version: 2, kind: type.slice(9), name: 'The Wandering Fellowship', process_id: -1, guild_ids: []
			} : {};
		const resolved_at = active ? null : now - (index % 100 + 1) * 60 * 60 * 1000;
		return {
			petition_id: -10001 - index, synthetic: true, type, proposal,
			created_at: now - (active ? 2 : 48) * 60 * 60 * 1000,
			expires_at: lifecycle === 'lapsed' ? resolved_at! : now + 22 * 60 * 60 * 1000,
			resolved_at,
			lifecycle, execution_state: lifecycle === 'granted' ? options.execution ?? 'succeeded' : 'not_applicable',
			eligible, current_vote, can_vote: active && eligible && current_vote === null,
			can_withdraw: active && (options.withdraw ?? false), tally_visible,
			...(tally_visible ? { tally: { eligible: 10, aye, nay, uncast: 10 - aye - nay } } : {})
		};
	};
	const active = PETITION_TYPES.map((type, index) => make(type, index));
	const variants = [
		make('appellation', 100, { vote: 'aye', withdraw: true, aye: 1 }),
		make('heraldry', 101, { vote: 'aye', aye: 4, nay: 3 }),
		make('banishment', 102, { vote: 'nay', aye: 2, nay: 4 }),
		make('fellowship', 103, { eligible: false })
	];
	const history = [
		make('appellation', 200, { lifecycle: 'granted', vote: 'aye', aye: 6, nay: 2 }),
		make('heraldry', 201, { lifecycle: 'denied', vote: 'nay', aye: 2, nay: 6 }),
		make('winnowing', 202, { lifecycle: 'lapsed', aye: 3, nay: 2 }),
		make('enclosure', 203, { lifecycle: 'withdrawn', vote: 'aye', aye: 1 }),
		make('crucible_sealing', 204, { lifecycle: 'granted', vote: 'aye', aye: 5, nay: 3, execution: 'pending' }),
		make('banishment', 205, { lifecycle: 'granted', vote: 'nay', aye: 7, nay: 1, execution: 'running' }),
		make('alliance_found', 206, { lifecycle: 'granted', eligible: false, aye: 10, execution: 'failed' })
	];
	return { active: [...active, ...variants], history };
}

export function valid_council_test_action(id: unknown, action: 'vote' | 'withdraw', choice?: unknown): boolean {
	const fixture = council_test_data(0).active.find(row => row.petition_id === id);
	return fixture !== undefined && (action === 'withdraw' ? fixture.can_withdraw
		: fixture.can_vote && (choice === 'aye' || choice === 'nay'));
}
