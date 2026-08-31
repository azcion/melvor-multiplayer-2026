// Diagnostic labels are untrusted hints, never authentication or authorization inputs.
export const PLATFORMS = ['android', 'ios', 'steam', 'epic', 'browser', 'unknown'] as const;
export const ENGINES = ['gecko', 'chromium', 'webkit', 'unknown'] as const;
export const DISTRIBUTIONS = ['google_play', 'huawei_appgallery', 'apple_app_store', 'steam', 'epic', 'other', 'unknown'] as const;
export const CHANNELS = ['stable', 'beta', 'unknown'] as const;
export type DeviceDiagnostics = {
	installation_id: string;
	platform: typeof PLATFORMS[number];
	engine: typeof ENGINES[number];
	distribution: typeof DISTRIBUTIONS[number];
	app_channel: typeof CHANNELS[number];
	app_version: string | null;
	app_build: string | null;
	// Distribution/channel/version/build are explicitly supplied by the player, not inferred from brand or UA.
	details_source: 'player_reported';
};
export function is_installation_id(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function label<T extends string>(value: unknown, allowed: readonly T[]): T | 'unknown' {
	return allowed.includes(value as T) ? value as T : 'unknown';
}
function version(value: unknown): string | null {
	return typeof value === 'string' && /^[0-9][0-9A-Za-z.+_-]{0,31}$/.test(value) ? value : null;
}
export function parse_device_diagnostics(value: unknown): DeviceDiagnostics | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const d = value as Record<string, unknown>;
	if (!is_installation_id(d.installation_id)) return null;
	return {
		installation_id: d.installation_id.toLowerCase(),
		platform: label(d.platform, PLATFORMS), engine: label(d.engine, ENGINES),
		distribution: label(d.distribution, DISTRIBUTIONS), app_channel: label(d.app_channel, CHANNELS),
		app_version: version(d.app_version), app_build: version(d.app_build), details_source: 'player_reported'
	};
}
export function origin_category(origin: string | null): string {
	switch (origin) {
		case null: return 'absent';
		case 'null': return 'opaque';
		case 'https://android.melvoridle.com': return 'android';
		case 'https://ios.melvoridle.com': return 'ios';
		case 'https://steam.melvoridle.com': return 'steam';
		case 'https://epicgames.melvoridle.com': return 'epic';
		case 'https://melvoridle.com': case 'https://www.melvoridle.com': case 'https://play.melvoridle.com': return 'web';
		default: return 'other';
	}
}
const PREFLIGHT_HEADERS = new Set(['content-type', 'x-session-token', 'x-icon-catalog-upload-token', 'cache-control', 'pragma']);
export function preflight_diagnostics(req: Request): string {
	const method = req.headers.get('Access-Control-Request-Method');
	const requested_method = method === 'GET' || method === 'POST' ? method : 'other';
	const raw = req.headers.get('Access-Control-Request-Headers') ?? '';
	const names = raw.slice(0, 2048).toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
	const known = [...new Set(names.filter(s => PREFLIGHT_HEADERS.has(s)))].sort();
	const other = raw.length > 2048 || names.some(s => !PREFLIGHT_HEADERS.has(s));
	return ` requested_method=${requested_method} requested_headers=${JSON.stringify(known.join(','))} other_headers=${other}`;
}
export type RejectionReason = 'invalid_session' | 'source_rate_limit' | 'identity_rate_limit' |
	'registration_rate_limit' | 'maintenance' | 'invalid_credentials' | 'identity_disabled' |
	'installation_revoked' | 'session_replaced' | 'account_mismatch' | 'account_required' | 'invalid_json' | 'invalid_runtime';
const rejections = new WeakMap<Request, RejectionReason>();
export function mark_rejection(req: Request, reason: RejectionReason): void { rejections.set(req, reason); }
export function rejection_diagnostics(req: Request): string {
	const reason = rejections.get(req);
	return reason ? ` reason=${reason}` : '';
}
export function device_log_fields(device: DeviceDiagnostics | null | undefined): string {
	if (!device) return '';
	return ` installation=${device.installation_id} platform=${device.platform} engine=${device.engine}` +
		` distribution=${device.distribution} app_channel=${device.app_channel} details_source=${device.details_source}` +
		(device.app_version ? ` app_version=${JSON.stringify(device.app_version)}` : '') +
		(device.app_build ? ` app_build=${JSON.stringify(device.app_build)}` : '');
}
