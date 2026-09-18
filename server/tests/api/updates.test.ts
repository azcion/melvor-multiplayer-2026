import { describe, expect, test } from 'bun:test';
import { get_json_with_session, register_client, request, request_json } from '../support/http';
import { db_all, db_run } from '../support/persistence';

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

	test('serves completed Simplified Chinese translations to zh-CN clients', async () => {
		const client = await register_client('Chinese Updates Reader', undefined, '1.5.14');
		await db_run('UPDATE `client_runtime_snapshots` SET `language` = ? WHERE `client_id` = ?', ['zh-CN', client.client_id]);
		try {
			await db_run("UPDATE `update_section_translations` SET `content` = ?, `state` = 'complete' " +
				"WHERE `section_id` = 'dev-message' AND `field` = 'title' AND `language` = 'zh-CN'", ['开发者说明']);
			await db_run("UPDATE `update_section_translations` SET `content` = ?, `state` = 'complete' " +
				"WHERE `section_id` = 'dev-message' AND `field` = 'body' AND `language` = 'zh-CN'", ['这是一棵树。\n\n它会长出叶子。']);

			const { response, json } = await get_json_with_session<{
				sections: Array<{ id: string; title: string; paragraphs: string[] }>;
			}>('/api/updates', client.session_token);
			const section = json.sections.find(section => section.id === 'dev-message');
			expect(response.status).toBe(200);
			expect(section?.title).toBe('开发者说明');
			expect(section?.paragraphs).toEqual(['这是一棵树。', '它会长出叶子。']);
		} finally {
			await db_run("UPDATE `update_section_translations` SET `content` = NULL, `state` = 'queued' " +
				"WHERE `section_id` = 'dev-message' AND `language` = 'zh-CN'");
		}
	});

	test('invalidates stale translations and falls back to current English content', async () => {
		const client = await register_client('Stale Updates Reader', undefined, '1.5.14');
		await db_run('UPDATE `client_runtime_snapshots` SET `language` = ? WHERE `client_id` = ?', ['zh-CN', client.client_id]);
		try {
			await db_run("UPDATE `update_section_translations` SET `content` = ?, `state` = 'complete' " +
				"WHERE `section_id` = 'dev-message' AND `field` = 'title' AND `language` = 'zh-CN'", ['开发者说明']);
			await db_run('UPDATE `update_sections` SET `title` = ? WHERE `id` = ?', ['Fresh dev note', 'dev-message']);

			const { json } = await get_json_with_session<{
				sections: Array<{ id: string; title: string; paragraphs: string[] }>;
			}>('/api/updates', client.session_token);
			expect(json.sections.find(section => section.id === 'dev-message')?.title).toBe('Fresh dev note');
			expect(await db_all(
				"SELECT `source_content`, `content`, `state`, `attempts` FROM `update_section_translations` " +
				"WHERE `section_id` = 'dev-message' AND `field` = 'title' AND `language` = 'zh-CN'"
			)).toEqual([{ source_content: 'Fresh dev note', content: null, state: 'queued', attempts: 0 }]);
		} finally {
			await db_run('UPDATE `update_sections` SET `title` = ? WHERE `id` = ?', ['Dev note', 'dev-message']);
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
