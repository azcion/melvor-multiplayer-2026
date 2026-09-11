import { describe, expect, test } from 'bun:test';
import { request, request_json } from '../support/http';
import { db_run } from '../support/persistence';

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

	test('reads independently editable titles and bodies from the database', async () => {
		try {
			await db_run('UPDATE `update_sections` SET `title` = ? WHERE `id` = ?', ['Edited dev note', 'dev-message']);
			let result = await request_json<{
				sections: Array<{ id: string; title: string; paragraphs: string[] }>;
			}>('/api/updates');
			let section = result.json.sections.find(section => section.id === 'dev-message');
			expect(section?.title).toBe('Edited dev note');
			expect(section?.paragraphs).toEqual(["It's a tree - it's gonna have leaves. 🍃"]);

			await db_run('UPDATE `update_sections` SET `body` = ? WHERE `id` = ?', ['First edited paragraph.\n\nSecond edited paragraph.', 'dev-message']);
			result = await request_json('/api/updates');
			section = result.json.sections.find(section => section.id === 'dev-message');
			expect(section?.title).toBe('Edited dev note');
			expect(section?.paragraphs).toEqual(['First edited paragraph.', 'Second edited paragraph.']);
		} finally {
			await db_run('UPDATE `update_sections` SET `title` = ?, `body` = ? WHERE `id` = ?', [
				'Dev note',
				"It's a tree - it's gonna have leaves. 🍃",
				'dev-message'
			]);
		}
	});

	test('returns CORS headers for browser clients', async () => {
		const response = await request('/api/updates', {
			headers: { Origin: 'https://melvoridle.com' }
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://melvoridle.com');
	});
});
