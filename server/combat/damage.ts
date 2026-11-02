// A tick may reorder indivisible damage packets, never attacks or effect application.
// Integer-HP subset sums bound the search by player HP rather than packet permutations.
export function favorable_damage_order(hp: number, max_hp: number, amounts: number[], food: number, heal: number, ready: boolean, percent = 40): number[] {
	const original = amounts.map((_, index) => index);
	const threshold = Math.floor(max_hp * percent / 100);
	const healing = (health: number) => ready && food > 0 && heal > 0 && health > 0 && health <= threshold
		? Math.min(max_hp - health, heal) : 0;
	const survives = (order: number[]) => {
		let health = hp, used = false;
		for (const index of order) {
			if (!used) { const amount = healing(health); health += amount; used = amount > 0; }
			health -= amounts[index];
			if (health <= 0) return false;
		}
		return true;
	};
	if (survives(original) || !ready || food <= 0 || heal <= 0) return original;
	const total = amounts.reduce((sum, amount) => sum + amount, 0);
	const sums = new Map<number, number[]>([[0, []]]);
	for (const index of original) for (const [sum, prefix] of [...sums]) {
		const next = sum + amounts[index];
		if (next < hp && !sums.has(next)) sums.set(next, [...prefix, index]);
	}
	// Stable tie break: smallest pre-heal damage sum, then first input-order subset.
	for (const [sum, prefix] of [...sums].sort(([a], [b]) => a - b)) {
		if (hp - total + healing(hp - sum) <= 0) continue;
		const selected = new Set(prefix);
		return [...prefix, ...original.filter(index => !selected.has(index))];
	}
	return original;
}
