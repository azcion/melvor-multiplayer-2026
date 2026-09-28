import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { create_editor_server } from '../../scripts/expedition-editor.mjs';

test('local Chamber editor saves valid task edits and protects the authored graph', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'expedition-editor-'));
	const path = join(directory, 'content.json');
	await writeFile(path, await readFile(new URL('../../server/expedition-content-v1.json', import.meta.url)));
	const server = create_editor_server({ path });
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = `http://127.0.0.1:${server.address().port}`;
	const put = (revision, content, headers = {}) => fetch(`${address}/api/content`, {
		method: 'PUT', headers: { Origin: address, 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify({ revision, content })
	});
	try {
		const page = await fetch(address);
		assert.equal(page.status, 200);
		assert.match(await page.text(), /Expedition Chamber Editor/);
		const skills = (await (await fetch(`${address}/api/skills`)).json()).skills;
		assert.equal(skills.length, 19);
		assert.equal(skills.find(skill => skill.id === 'melvorAoD:Archaeology').group, 'Official DLC');
		assert.match(skills[0].icon, /^https:\/\/melvoridle\.com\/assets\/media\/skills\//);
		const loaded = await (await fetch(`${address}/api/content`)).json();
		assert.equal(loaded.content.chambers.length, 31);
		assert.equal(loaded.preview_route.entrance, 'entrance:exit_1');
		const original = structuredClone(loaded.content);
		const entrance = loaded.content.chambers.find(chamber => chamber.id === 'entrance');
		let task_number = 1;
		while (entrance.tasks.some(task => task.id === `editor_test_${task_number}`)) task_number++;
		entrance.tasks.find(task => task.id === 'arrival_chart').baseline_hours = 15;
		entrance.tasks.find(task => task.id === 'arrival_scout').title = 'Scout the Rift';
		entrance.tasks.find(task => task.id === 'arrival_chart').evidence.skill_ids.push('melvorAoD:Archaeology');
		entrance.tasks.push({ id: `editor_test_${task_number}`, title: 'Inspect the Rift', phase: 'arrival', kind: 'work',
			requirement: 'optional', depends_on: [], baseline_hours: 2,
			evidence: { type: 'skill_time', skill_ids: ['melvorD:Woodcutting'] } });
		const forbidden = structuredClone(loaded.content);
		forbidden.chambers[0].exits.pop();
		assert.equal((await put(loaded.revision, forbidden)).status, 400);
		assert.equal((await put(loaded.revision, loaded.content, { Origin: 'https://example.com' })).status, 403);
		const saved = await put(loaded.revision, loaded.content);
		assert.equal(saved.status, 200);
		const next_revision = (await saved.json()).revision;
		assert.notEqual(next_revision, loaded.revision);
		assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), loaded.content);
		assert.equal((await put(loaded.revision, original)).status, 409);
		const invalid = structuredClone(loaded.content);
		invalid.chambers[0].tasks.find(task => task.id === 'arrival_chart').evidence.skill_ids = ['melvorAoD:Archaeology'];
		assert.equal((await put(next_revision, invalid)).status, 400);
		assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), loaded.content);
	} finally {
		server.close();
		await once(server, 'close');
		await rm(directory, { recursive: true, force: true });
	}
});
