import { describe, expect, test } from 'bun:test';
import {
	get_petition_conflict_subject,
	get_petition_resolution,
	is_petition_choice,
	is_petition_type
} from '../../council';

describe('Council petition rules', () => {
	test('grants at exactly half of an even electorate', () => {
		expect(get_petition_resolution(4, 1, 0)).toBeNull();
		expect(get_petition_resolution(4, 2, 0)).toBe('granted');
	});

	test('grants only above half of an odd electorate', () => {
		expect(get_petition_resolution(5, 2, 0)).toBeNull();
		expect(get_petition_resolution(5, 3, 0)).toBe('granted');
	});

	test('denies only above half for even and odd electorates', () => {
		expect(get_petition_resolution(4, 0, 2)).toBeNull();
		expect(get_petition_resolution(4, 0, 3)).toBe('denied');
		expect(get_petition_resolution(5, 0, 2)).toBeNull();
		expect(get_petition_resolution(5, 0, 3)).toBe('denied');
	});

	test('handles a one-member Guild without an automatic ballot', () => {
		expect(get_petition_resolution(1, 0, 0)).toBeNull();
		expect(get_petition_resolution(1, 1, 0)).toBe('granted');
		expect(get_petition_resolution(1, 0, 1)).toBe('denied');
	});

	test('rejects impossible tallies', () => {
		expect(() => get_petition_resolution(0, 0, 0)).toThrow(RangeError);
		expect(() => get_petition_resolution(3, 4, 0)).toThrow(RangeError);
		expect(() => get_petition_resolution(3, 2, 2)).toThrow(RangeError);
	});

	test('accepts only the closed petition and ballot vocabularies', () => {
		expect(is_petition_type('banishment')).toBe(true);
		expect(is_petition_type('execute_sql')).toBe(false);
		expect(is_petition_choice('aye')).toBe(true);
		expect(is_petition_choice('abstain')).toBe(false);
	});

	test('derives stable conflict subjects', () => {
		expect(get_petition_conflict_subject('appellation')).toBe('guild:name');
		expect(get_petition_conflict_subject('heraldry')).toBe('guild:icon');
		expect(get_petition_conflict_subject('banishment', 42)).toBe('membership:42');
	});
});
