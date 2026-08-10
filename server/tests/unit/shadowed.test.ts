import { describe, expect, test } from 'bun:test';
import { is_shadowed, SHADOWED_AFTER, shadowed_cutoff } from '../../shadowed';

describe('Shadowed state', () => {
	const now = 2_000_000_000_000;

	test('uses a strict seven-day inactivity boundary', () => {
		expect(shadowed_cutoff(now)).toBe(now - SHADOWED_AFTER);
		expect(is_shadowed(0, now)).toBe(true);
		expect(is_shadowed(now - SHADOWED_AFTER - 1, now)).toBe(true);
		expect(is_shadowed(now - SHADOWED_AFTER, now)).toBe(false);
		expect(is_shadowed(now - SHADOWED_AFTER + 1, now)).toBe(false);
	});

	test('rejects invalid timestamps', () => {
		expect(() => is_shadowed(-1, now)).toThrow(RangeError);
		expect(() => is_shadowed(Number.MAX_SAFE_INTEGER + 1, now)).toThrow(RangeError);
		expect(() => is_shadowed(now, -1)).toThrow(RangeError);
	});
});
