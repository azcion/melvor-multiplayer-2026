import { describe, expect, test } from 'bun:test';
import { RequestLimitPolicy, TokenBucketLimiter, load_auth_response_delay } from '../../security';

describe('authentication response delay', () => {
	test('defaults to one second and accepts the isolated-test override', () => {
		const original = process.env.AUTH_RESPONSE_DELAY_MS;

		try {
			delete process.env.AUTH_RESPONSE_DELAY_MS;
			expect(load_auth_response_delay()).toBe(1000);

			process.env.AUTH_RESPONSE_DELAY_MS = '0';
			expect(load_auth_response_delay()).toBe(0);
		} finally {
			if (original === undefined)
				delete process.env.AUTH_RESPONSE_DELAY_MS;
			else
				process.env.AUTH_RESPONSE_DELAY_MS = original;
		}
	});

	test('rejects malformed or excessive overrides', () => {
		const original = process.env.AUTH_RESPONSE_DELAY_MS;

		try {
			for (const value of ['-1', '1.5', '10001', 'invalid']) {
				process.env.AUTH_RESPONSE_DELAY_MS = value;
				expect(() => load_auth_response_delay()).toThrow(
					'AUTH_RESPONSE_DELAY_MS must be an integer from 0 to 10000'
				);
			}
		} finally {
			if (original === undefined)
				delete process.env.AUTH_RESPONSE_DELAY_MS;
			else
				process.env.AUTH_RESPONSE_DELAY_MS = original;
		}
	});
});

describe('request limits', () => {
	test('allows the configured burst and refills at the configured rate', () => {
		const limiter = new TokenBucketLimiter(60, 2, 60_000);

		expect(limiter.take('source', 0)).toBe(0);
		expect(limiter.take('source', 0)).toBe(0);
		expect(limiter.take('source', 0)).toBe(1);
		expect(limiter.take('source', 1000)).toBe(0);
	});

	test('uses the trusted Cloudflare source without accepting forwarded or invalid addresses', async () => {
		const policy = new RequestLimitPolicy({
			trust_proxy: true,
			source_per_minute: 1,
			source_burst: 1,
			identity_per_minute: 1,
			identity_burst: 1,
			registrations_per_source_hour: 1,
			registrations_per_service_hour: 2
		});

		const first = new Request('http://localhost', {
			headers: {
				'CF-Connecting-IP': '192.0.2.1',
				'X-Forwarded-For': '198.51.100.1'
			}
		});
		const second = new Request('http://localhost', {
			headers: {
				'CF-Connecting-IP': '192.0.2.2',
				'X-Forwarded-For': '198.51.100.1'
			}
		});
		const spoofed = new Request('http://localhost', {
			headers: {
				'CF-Connecting-IP': '192.0.2.1',
				'X-Forwarded-For': '198.51.100.2'
			}
		});
		const invalid = new Request('http://localhost', {
			headers: {
				'CF-Connecting-IP': '203.0.113.1, 203.0.113.2',
				'X-Forwarded-For': '203.0.113.1'
			}
		});
		const missing = new Request('http://localhost', {
			headers: { 'X-Forwarded-For': '203.0.113.2' }
		});

		expect(policy.limit_source(first)).toBeNull();
		expect(policy.limit_source(spoofed)?.status).toBe(429);
		expect(policy.limit_source(second)).toBeNull();
		expect(policy.limit_source(invalid)).toBeNull();
		expect(policy.limit_source(missing)?.status).toBe(429);
	});

	test('ignores proxy source headers when proxy trust is disabled', () => {
		const policy = new RequestLimitPolicy({
			trust_proxy: false,
			source_per_minute: 1,
			source_burst: 1,
			identity_per_minute: 1,
			identity_burst: 1,
			registrations_per_source_hour: 1,
			registrations_per_service_hour: 1
		});
		const first = new Request('http://localhost', {
			headers: { 'CF-Connecting-IP': '192.0.2.1' }
		});
		const second = new Request('http://localhost', {
			headers: { 'CF-Connecting-IP': '192.0.2.2' }
		});

		expect(policy.limit_source(first)).toBeNull();
		expect(policy.limit_source(second)?.status).toBe(429);
	});

	test('limits registration by both source and service', () => {
		const policy = new RequestLimitPolicy({
			trust_proxy: true,
			source_per_minute: 100,
			source_burst: 100,
			identity_per_minute: 100,
			identity_burst: 100,
			registrations_per_source_hour: 1,
			registrations_per_service_hour: 2
		});
		const first = new Request('http://localhost', {
			headers: { 'CF-Connecting-IP': '192.0.2.1' }
		});
		const second = new Request('http://localhost', {
			headers: { 'CF-Connecting-IP': '192.0.2.2' }
		});
		const third = new Request('http://localhost', {
			headers: { 'CF-Connecting-IP': '192.0.2.3' }
		});

		expect(policy.limit_registration(first)).toBeNull();
		expect(policy.limit_registration(first)?.status).toBe(429);
		expect(policy.limit_registration(second)).toBeNull();
		const limited = policy.limit_registration(third);
		expect(limited?.status).toBe(429);
		expect(Number(limited?.headers.get('Retry-After'))).toBeGreaterThan(0);
	});

	test('limits authenticated identities independently', () => {
		const policy = new RequestLimitPolicy({
			trust_proxy: false,
			source_per_minute: 100,
			source_burst: 100,
			identity_per_minute: 1,
			identity_burst: 1,
			registrations_per_source_hour: 100,
			registrations_per_service_hour: 100
		});

		expect(policy.limit_identity(1)).toBeNull();
		expect(policy.limit_identity(1)?.status).toBe(429);
		expect(policy.limit_identity(2)).toBeNull();
	});
});
