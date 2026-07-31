import { describe, expect, test } from 'bun:test';
import { RequestLimitPolicy, TokenBucketLimiter } from '../../security';

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
