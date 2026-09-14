import { expect, test } from 'bun:test';
import { is_client_version_unsupported, is_minimum_supported_version } from '../../client-version-policy';

test('validates operator support floors at the feature boundary', () => {
	expect(is_minimum_supported_version('1.5.10')).toBe(true);
	expect(is_minimum_supported_version('1.5.11')).toBe(true);
	expect(is_minimum_supported_version('2.0.0')).toBe(true);
	expect(is_minimum_supported_version('1.5.9')).toBe(false);
	expect(is_minimum_supported_version('latest')).toBe(false);
});

test('classifies only feature-aware clients below the configured floor', () => {
	expect(is_client_version_unsupported('1.5.10', '1.5.11')).toBe(true);
	expect(is_client_version_unsupported('1.5.11', '1.5.11')).toBe(false);
	expect(is_client_version_unsupported('1.5.9', '1.5.11')).toBe(false);
	expect(is_client_version_unsupported(null, '1.5.11')).toBe(false);
	expect(is_client_version_unsupported('1.5.10', null)).toBe(false);
});
