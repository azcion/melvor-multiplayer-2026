import { describe, expect, test } from 'bun:test';
import { request } from '../support/http';
import { BACKEND_VERSION } from '../../version';

describe('test harness', () => {
	test('reaches the live server', async () => {
		const response = await request('/not-found');

		expect(response.status).toBe(404);
		expect(await response.text()).toBe('Not Found');
	});

	test('exposes an explicit health check', async () => {
		const response = await request('/health');

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok', backend_version: BACKEND_VERSION });
	});

	test('exercises authenticated routes through HTTP', async () => {
		const response = await request('/api/events');

		expect(response.status).toBe(401);
		expect(await response.text()).toBe('Unauthorized');
	});
});
