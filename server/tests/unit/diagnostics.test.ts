import { expect, test } from 'bun:test';
import { parse_device_diagnostics, origin_category, preflight_diagnostics, device_log_fields } from '../../diagnostics';

test('device diagnostics allow only bounded non-secret fields and never infer beta from engine', () => {
	const device = parse_device_diagnostics({ installation_id: crypto.randomUUID(), platform: 'android', engine: 'gecko',
		distribution: 'huawei_appgallery', app_channel: 'beta', app_version: '5.1.2', app_build: '162',
		user_agent: 'SECRET', ip: 'SECRET', device_name: 'SECRET', token: 'SECRET', manufacturer: 'SECRET' });
	expect(device?.app_channel).toBe('beta');
	expect(JSON.stringify(device)).not.toContain('SECRET');
	expect(device_log_fields(device)).toContain('details_source=player_reported');
	const unknown = parse_device_diagnostics({ installation_id: crypto.randomUUID(), engine: 'gecko',
		platform: 'android\nSECRET', app_channel: 'garbage', app_version: '5\nSECRET' });
	expect(unknown?.platform).toBe('unknown');
	expect(unknown?.app_channel).toBe('unknown');
	expect(unknown?.app_version).toBeNull();
	expect(parse_device_diagnostics({ installation_id: 'not-an-id' })).toBeNull();
});

test('preflight logs retain only known header names and coarse origins', () => {
	const request = new Request('https://example.com/api/events', { method: 'OPTIONS', headers: {
		'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'X-Session-Token, SECRET-NAME, Pragma'
	}});
	const fields = preflight_diagnostics(request);
	expect(fields).toContain('requested_method=GET');
	expect(fields).toContain('other_headers=true');
	expect(fields).not.toContain('secret');
	expect(origin_category('https://android.melvoridle.com')).toBe('android');
	expect(origin_category('https://private-personal-host.example')).toBe('other');
	expect(origin_category(null)).toBe('absent');
});
