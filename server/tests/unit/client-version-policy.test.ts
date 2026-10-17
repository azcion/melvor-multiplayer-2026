import { expect, test } from 'bun:test';
import { effective_minimum_client_version, is_client_version_at_least, is_client_version_unsupported, is_minimum_supported_version } from '../../client-version-policy';

test('compares strict semantic client versions', () => {
	expect(is_client_version_at_least('1.5.14', '1.5.14')).toBe(true);
	expect(is_client_version_at_least('1.6.0', '1.5.14')).toBe(true);
	expect(is_client_version_at_least('1.5.13', '1.5.14')).toBe(false);
	expect(is_client_version_at_least('1.5.14-beta.1', '1.5.14')).toBe(false);
	expect(is_client_version_at_least(null, '1.5.14')).toBe(false);
});

test('validates operator support floors at the compiled support baseline', () => {
	expect(is_minimum_supported_version('1.6.14')).toBe(true);
	expect(is_minimum_supported_version('1.6.15')).toBe(true);
	expect(is_minimum_supported_version('2.0.0')).toBe(true);
	expect(is_minimum_supported_version('1.5.9')).toBe(false);
	expect(is_minimum_supported_version('latest')).toBe(false);
});

test('classifies every client below the configured floor, including unknown versions', () => {
	expect(is_client_version_unsupported('1.5.10', '1.5.11')).toBe(true);
	expect(is_client_version_unsupported('1.5.11', '1.5.11')).toBe(false);
	expect(is_client_version_unsupported('1.5.9', '1.5.11')).toBe(true);
	expect(is_client_version_unsupported(null, '1.5.11')).toBe(true);
	expect(is_client_version_unsupported('development', '1.5.11')).toBe(true);
	expect(is_client_version_unsupported('1.5.10', null)).toBe(false);
});

test('operator overrides cannot reopen retired contracts', () => {
	for (const value of [null, '', 'latest', '1.6.13', '1.5.10'])
		expect(effective_minimum_client_version(value)).toBe('1.6.14');
	expect(effective_minimum_client_version('1.6.15')).toBe('1.6.15');
});
