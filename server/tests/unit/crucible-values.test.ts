import { expect, test } from 'bun:test';
import { crucible_gloop_quantity, crucible_heat, crucible_heat_value, crucible_known_valuation,
	crucible_stack_value, crucible_estimated_completion_at } from '../../crucible-values';

test('Heat uses timed stack value and one stack bonus, excluding Gloop', () => {
	expect(crucible_heat_value([
		{ item_id: 'test:ore', qty: 9, value_currency_id: 'melvorD:GP', value_per_item: 100, is_untimed: 0 }
	])).toBe(1_000);
	expect(crucible_heat_value([
		{ item_id: 'test:ore', qty: 1, value_currency_id: null, value_per_item: null, is_untimed: 0 },
		{ item_id: 'melvorD:Weird_Gloop', qty: 100_000, value_currency_id: null, value_per_item: null, is_untimed: 1 }
	])).toBe(101);
});

test('Heat thresholds and rate cover the full tier table', () => {
	for (const [value, tier, points_per_minute] of [
		[0, 0, 0], [1, 1, 1], [999, 1, 1], [1_000, 2, 2], [10_000, 3, 3],
		[100_000, 4, 5], [1_000_000, 5, 8], [10_000_000, 6, 12],
		[100_000_000, 7, 17], [1_000_000_000, 8, 22], [10_000_000_000, 9, 28]
	])
		expect(crucible_heat(value)).toEqual({ tier, points_per_minute });
});

test('Meld value converts non-GP and unknown valuation without clipping', () => {
	expect(crucible_stack_value(3, crucible_known_valuation('melvorD:SlayerCoins')!)).toBe(30);
	expect(crucible_stack_value(3, { value_currency_id: null, value_per_item: null })).toBe(3);
	expect(crucible_stack_value(3, { value_currency_id: 'melvorD:GP', value_per_item: 0 })).toBe(3);
	expect(crucible_stack_value(1, { value_currency_id: 'melvorD:GP', value_per_item: Number.MAX_SAFE_INTEGER }))
		.toBe(Number.MAX_SAFE_INTEGER);
	expect(() => crucible_stack_value(2, { value_currency_id: 'melvorD:GP',
		value_per_item: Number.MAX_SAFE_INTEGER })).toThrow(RangeError);
	expect(crucible_gloop_quantity(1)).toBe(1);
	expect(crucible_gloop_quantity(1_001)).toBe(2);
});

test('one-point and maximum-rate completion estimates', () => {
	expect(crucible_estimated_completion_at(0, 1, 0)).toBe(7 * 24 * 60 * 60_000);
	expect(crucible_estimated_completion_at(0, 28, 0)).toBe(6 * 60 * 60_000);
	expect(crucible_estimated_completion_at(0, 0, 0)).toBeNull();
});
