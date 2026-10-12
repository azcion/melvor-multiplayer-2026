import type { Database } from 'bun:sqlite';

export const WISH_CAPACITY_MS = 30 * 24 * 60 * 60_000;
export const WISH_CAPACITY_TIERS = [100, 200, 300, 400, 500] as const;

export function capacity_price_micros(base: number): number {
	if (!WISH_CAPACITY_TIERS.includes(base as typeof WISH_CAPACITY_TIERS[number]))
		throw new RangeError('Invalid Wish capacity');
	const steps = base / 100 - 1;
	return steps * (steps + 1) / 2 * 10_000_000;
}

export function wish_price_micros(qty: number, base = 100): number {
	capacity_price_micros(base);
	if (!Number.isSafeInteger(qty) || qty < 1 || qty > 1000)
		throw new RangeError('Invalid Wish quantity');
	if (qty <= base) return Math.ceil(qty * 1000 / base) * 1000;
	const steps = Math.floor((qty - base) / 100);
	const remainder = (qty - base) % 100;
	// Each remaining item costs 1/100 of the next increment. Integer micros
	// are already exact multiples of 0.001 EP for these +100 price bands.
	return (1 + steps * (steps + 3) / 2) * 1_000_000 + remainder * (steps + 2) * 10_000;
}

type Capacity = { client_id: number; base: number; expires_at: number; auto_renew: number; renewal_paused: number };

export function ep_balance(database: Database, client_id: number): number {
	return database.query<{ points_micros: number }, [number]>(
		'SELECT points_micros FROM expedition_ep_balances WHERE client_id=?').get(client_id)?.points_micros ?? 0;
}

export function spend_ep(database: Database, client_id: number, amount: number, kind: string,
	source_id: string, now: number): boolean {
	if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError('Invalid EP debit');
	const changed = database.query('UPDATE expedition_ep_balances SET points_micros=points_micros-? ' +
		'WHERE client_id=? AND points_micros>=?').run(amount, client_id, amount).changes;
	if (!changed) return false;
	database.query('INSERT INTO wish_ep_spends(client_id,kind,source_id,points_micros,created_at) VALUES(?,?,?,?,?)')
		.run(client_id, kind, source_id, amount, now);
	database.query('UPDATE clients SET event_revision=event_revision+1 WHERE id=?').run(client_id);
	return true;
}

// Call before every EP credit as well as on reads and scheduled maintenance. A later
// earning must never resurrect a renewal which was unaffordable at its deadline.
export function settle_wish_capacity(database: Database, client_id: number, now = Date.now()): void {
	const row = database.query<Capacity, [number]>('SELECT * FROM wish_capacities WHERE client_id=?').get(client_id);
	if (!row || row.expires_at > now) return;
	if (row.auto_renew) {
		const periods = Math.floor((now - row.expires_at) / WISH_CAPACITY_MS) + 1;
		const price = capacity_price_micros(row.base);
		const paid = Math.min(periods, Math.floor(ep_balance(database, client_id) / price));
		if (paid > 0) {
			spend_ep(database, client_id, paid * price, 'renewal', String(row.expires_at), now);
			row.expires_at += paid * WISH_CAPACITY_MS;
			database.query('UPDATE wish_capacities SET expires_at=? WHERE client_id=?').run(row.expires_at, client_id);
		}
		if (paid === periods) return;
		database.query('UPDATE wish_capacities SET auto_renew=0,renewal_paused=1 WHERE client_id=?').run(client_id);
		database.query('UPDATE clients SET event_revision=event_revision+1 WHERE id=?').run(client_id);
	}
}

export function wish_capacity_state(database: Database, client_id: number, now = Date.now()) {
	settle_wish_capacity(database, client_id, now);
	const row = database.query<Capacity, [number]>('SELECT * FROM wish_capacities WHERE client_id=?').get(client_id);
	const active = row !== null && row.expires_at > now;
	const base = active ? row.base : 100;
	return { base, expires_at: active ? row.expires_at : null, auto_renew: active && row.auto_renew === 1,
		renewal_paused: row?.renewal_paused === 1, renewal_micros: active ? capacity_price_micros(base) : 0,
		points_micros: ep_balance(database, client_id),
		tiers: WISH_CAPACITY_TIERS.filter(tier => tier > 100).map(tier => ({ base: tier,
			full_micros: capacity_price_micros(tier),
			purchase_micros: tier > base ? capacity_price_micros(tier) - capacity_price_micros(base) : 0 })) };
}

export function purchase_wish_capacity(database: Database, client_id: number, base: number,
	auto_renew: boolean, expected_micros: number, command_id: string, now = Date.now()) {
	const current = wish_capacity_state(database, client_id, now);
	if (base <= 100 || !WISH_CAPACITY_TIERS.includes(base as typeof WISH_CAPACITY_TIERS[number]) || base <= current.base)
		return { success: false, error: 'invalid_capacity_tier' };
	const price = capacity_price_micros(base) - capacity_price_micros(current.base);
	if (expected_micros !== price) return { success: false, error: 'wish_quote_changed' };
	if (!spend_ep(database, client_id, price, 'capacity', command_id, now))
		return { success: false, error: 'insufficient_ep' };
	database.query('INSERT INTO wish_capacities(client_id,base,expires_at,auto_renew,renewal_paused) VALUES(?,?,?,?,0) ' +
		'ON CONFLICT(client_id) DO UPDATE SET base=excluded.base,expires_at=excluded.expires_at,' +
		'auto_renew=excluded.auto_renew,renewal_paused=0').run(client_id, base, now + WISH_CAPACITY_MS, Number(auto_renew));
	return { success: true, paid_ep_micros: price, capacity: wish_capacity_state(database, client_id, now) };
}

export function set_wish_capacity_renewal(database: Database, client_id: number, enabled: boolean, now = Date.now()) {
	const current = wish_capacity_state(database, client_id, now);
	if (current.base === 100) return { success: false, error: 'capacity_expired' };
	database.query('UPDATE wish_capacities SET auto_renew=?,renewal_paused=0 WHERE client_id=?').run(Number(enabled), client_id);
	database.query('UPDATE clients SET event_revision=event_revision+1 WHERE id=?').run(client_id);
	return { success: true, capacity: wish_capacity_state(database, client_id, now) };
}

export function maintain_wish_capacities(database: Database, now = Date.now()): void {
	const due = database.query<{ client_id: number }, [number]>(
		'SELECT client_id FROM wish_capacities WHERE auto_renew=1 AND expires_at<=?').all(now);
	for (const row of due) database.transaction(() => settle_wish_capacity(database, row.client_id, now)).immediate();
}
