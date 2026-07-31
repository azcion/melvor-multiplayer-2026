import { isIP } from 'node:net';

type Bucket = {
	tokens: number;
	updated_at: number;
};

export type RequestLimitConfiguration = {
	trust_proxy: boolean;
	source_per_minute: number;
	source_burst: number;
	identity_per_minute: number;
	identity_burst: number;
	registrations_per_source_hour: number;
	registrations_per_service_hour: number;
};

function positive_integer(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined)
		return fallback;

	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed) || parsed < 1)
		throw new Error(`${name} must be a positive integer`);
	return parsed;
}

export function load_request_limit_configuration(): RequestLimitConfiguration {
	return {
		trust_proxy: process.env.TRUST_PROXY === '1',
		source_per_minute: positive_integer('REQUEST_SOURCE_PER_MINUTE', 120),
		source_burst: positive_integer('REQUEST_SOURCE_BURST', 30),
		identity_per_minute: positive_integer('REQUEST_IDENTITY_PER_MINUTE', 60),
		identity_burst: positive_integer('REQUEST_IDENTITY_BURST', 20),
		registrations_per_source_hour: positive_integer('REGISTRATIONS_PER_SOURCE_HOUR', 4),
		registrations_per_service_hour: positive_integer('REGISTRATIONS_PER_SERVICE_HOUR', 32)
	};
}

export class TokenBucketLimiter {
	private readonly buckets = new Map<string, Bucket>();
	private operations = 0;

	constructor(
		private readonly refill_count: number,
		private readonly capacity: number,
		private readonly refill_interval_ms: number
	) {}

	take(key: string, now = Date.now()): number {
		const refill_per_ms = this.refill_count / this.refill_interval_ms;
		const existing = this.buckets.get(key);
		const bucket = existing ?? {
			tokens: this.capacity,
			updated_at: now
		};

		bucket.tokens = Math.min(
			this.capacity,
			bucket.tokens + Math.max(0, now - bucket.updated_at) * refill_per_ms
		);
		bucket.updated_at = now;

		if (bucket.tokens >= 1) {
			bucket.tokens -= 1;
			this.buckets.set(key, bucket);
			this.sweep(now);
			return 0;
		}

		this.buckets.set(key, bucket);
		this.sweep(now);
		return Math.max(1, Math.ceil((1 - bucket.tokens) / refill_per_ms / 1000));
	}

	private sweep(now: number): void {
		this.operations++;
		if (this.operations < 1024)
			return;

		this.operations = 0;
		for (const [key, bucket] of this.buckets)
			if (now - bucket.updated_at >= this.refill_interval_ms)
				this.buckets.delete(key);
	}
}

function throttled(retry_after: number): Response {
	return new Response('Too Many Requests', {
		status: 429,
		headers: {
			'Retry-After': String(retry_after)
		}
	});
}

export class RequestLimitPolicy {
	private readonly source: TokenBucketLimiter;
	private readonly identity: TokenBucketLimiter;
	private readonly registration_source: TokenBucketLimiter;
	private readonly registration_service: TokenBucketLimiter;

	constructor(private readonly configuration: RequestLimitConfiguration) {
		this.source = new TokenBucketLimiter(
			configuration.source_per_minute,
			configuration.source_burst,
			60_000
		);
		this.identity = new TokenBucketLimiter(
			configuration.identity_per_minute,
			configuration.identity_burst,
			60_000
		);
		this.registration_source = new TokenBucketLimiter(
			configuration.registrations_per_source_hour,
			configuration.registrations_per_source_hour,
			3_600_000
		);
		this.registration_service = new TokenBucketLimiter(
			configuration.registrations_per_service_hour,
			configuration.registrations_per_service_hour,
			3_600_000
		);
	}

	limit_source(req: Request): Response | null {
		const retry_after = this.source.take(this.get_source(req));
		return retry_after === 0 ? null : throttled(retry_after);
	}

	limit_registration(req: Request): Response | null {
		const source_retry = this.registration_source.take(this.get_source(req));
		if (source_retry !== 0)
			return throttled(source_retry);

		const service_retry = this.registration_service.take('service');
		return service_retry === 0 ? null : throttled(service_retry);
	}

	limit_identity(client_id: number): Response | null {
		const retry_after = this.identity.take(String(client_id));
		return retry_after === 0 ? null : throttled(retry_after);
	}

	private get_source(req: Request): string {
		if (!this.configuration.trust_proxy)
			return 'direct';

		const candidate = req.headers.get('CF-Connecting-IP')?.trim();
		return candidate !== undefined && isIP(candidate) !== 0 ? candidate : 'unknown';
	}
}
