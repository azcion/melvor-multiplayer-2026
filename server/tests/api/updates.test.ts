import { describe, expect, test } from 'bun:test';
import { request, request_json } from '../support/http';

describe('updates API', () => {
	test('serves the three editable update sections without requiring a session', async () => {
		const { response, json } = await request_json<{
			sections: Array<{ id: string; title: string; paragraphs: string[] }>;
		}>('/api/updates');

		expect(response.status).toBe(200);
		expect(json.sections).toHaveLength(3);
		expect(json.sections.map(section => section.id)).toEqual([
			'dev-message',
			'working-on',
			'future-update'
		]);
		expect(json.sections.map(section => section.title)).toEqual([
			'Dev note',
			'In development',
			'On the roadmap'
		]);
		expect(json.sections.every(section => section.paragraphs.length > 0)).toBe(true);
	});

	test('returns CORS headers for browser clients', async () => {
		const response = await request('/api/updates', {
			headers: { Origin: 'https://melvoridle.com' }
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://melvoridle.com');
	});
});
