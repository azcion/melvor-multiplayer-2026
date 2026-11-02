import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { layout_graph, journey_state, route_to, discovery_state } from '../../tools/expedition-journey/graph.mjs';
import { create_journey_server } from '../../scripts/expedition-journey.mjs';
for (const version of ['v1', 'v3']) {
	const content = JSON.parse(await readFile(new URL(`../../server/expedition-content-${version}.json`, import.meta.url)));
	test(`${version}: every authored Chamber and passage has a stable position across every reachable route`, () => {
		const graph = layout_graph(content), before = JSON.stringify(graph);
		assert.equal(graph.nodes.length, content.chambers.length);
		assert.equal(graph.edges.length, content.chambers.reduce((n, c) => n + c.exits.length, 0));
		assert.equal(new Set(graph.nodes.map(n => `${n.x},${n.y}`)).size, graph.nodes.length);
		for (const node of graph.nodes) {
			const route = route_to(graph, node.id), state = journey_state(graph, route);
			assert.equal(state.current, node.id);
			assert.equal(state.travelled.size, route.length - 1);
			assert.equal(state.visited.size, route.length);
		}
		assert.equal(JSON.stringify(graph), before);
		assert.deepEqual(layout_graph({ chambers: [...content.chambers].reverse() }), graph);
		assert.equal(journey_state(graph, []).current, null);
	});
}
test('shared destinations highlight only the actual incoming passage', () => {
	const graph = layout_graph({ chambers: [
		{ id: 'start', type: 'start', depth: 0, exits: [{ id: 'sa', target: 'a' }, { id: 'sb', target: 'b' }] },
		{ id: 'a', depth: 1, exits: [{ id: 'ac', target: 'c' }] },
		{ id: 'b', depth: 1, exits: [{ id: 'bc', target: 'c' }] }, { id: 'c', depth: 2, exits: [] }
	] });
	assert.deepEqual([...journey_state(graph, ['start', 'b', 'c']).travelled], ['sb', 'bc']);
	assert.throws(() => journey_state(graph, ['start', 'c']), /existing passages/);
	assert.throws(() => journey_state(graph, ['a']), /start Chamber/);
});
test('invalid forward targets fail clearly', () => {
	assert.throws(() => layout_graph({ chambers: [{ id: 'a', depth: 0, exits: [{ target: 'missing' }] }] }), /Invalid forward passage/);
});
test('harness serves only its read-only allowlisted files', async t => {
	const server = create_journey_server();
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	t.after(() => new Promise(resolve => server.close(resolve)));
	const origin = `http://127.0.0.1:${server.address().port}`;
	for (const path of ['/', '/studio.mjs', '/graph.mjs', '/studio.css', '/content-v3.json', '/content-v1.json']) {
		assert.equal((await fetch(origin + path)).status, 200);
	}
	assert.equal((await fetch(origin + '/server/backend-version.txt')).status, 404);
	assert.equal((await fetch(origin + '/content-v3.json', { method: 'POST' })).status, 404);
});
test('full graph ordering reduces crossings while availability and zero gaps preserve all nodes', async () => {
	const content = JSON.parse(await readFile(new URL('../../server/expedition-content-v1.json', import.meta.url)));
	const supported = JSON.parse(await readFile(new URL('../../server/expedition-content-v3.json', import.meta.url)));
	const normal = layout_graph(content);
	assert.ok(normal.crossings < normal.crossings_before);
	const compact = layout_graph(content, { column_gap: 0, row_gap: 0, supported_ids: new Set(supported.chambers.map(n => n.id)) });
	assert.equal(compact.nodes.length, 31);
	assert.equal(compact.nodes.filter(n => !n.available).length, 19);
	assert.deepEqual(compact.nodes.map(n => n.id), normal.nodes.map(n => n.id));
	assert.ok(compact.height < normal.height);
	assert.ok(compact.width < normal.width);
	for (const a of compact.nodes) {
		assert.ok(a.x > 0 && a.x < compact.width && a.y > 0 && a.y < compact.height);
		for (const b of compact.nodes) if (a.id !== b.id) assert.ok(Math.hypot(a.x-b.x, a.y-b.y) >= 40);
	}
});

test('question marks expose only individually revealed edges, never their other incoming or onward edges', () => {
	const graph = layout_graph({ chambers: [
		{ id: 'start', type: 'start', depth: 0, exits: [{ id: 'sa', target: 'a' }, { id: 'sb', target: 'b' }] },
		{ id: 'a', depth: 1, exits: [{ id: 'ac', target: 'c' }] },
		{ id: 'b', depth: 1, exits: [{ id: 'bc', target: 'c' }] },
		{ id: 'c', depth: 2, exits: [{ id: 'cd', target: 'd' }] }, { id: 'd', depth: 3, exits: [] }
	] });
	const before = JSON.stringify(graph);
	const view = discovery_state(graph, ['start', 'a'], new Set(['ac', 'bc', 'cd']));
	assert.deepEqual(view.visible_edges.map(e => e.id), ['sa', 'ac']);
	assert.deepEqual([...view.visible_nodes], ['start', 'a', 'c']);
	assert.equal(view.visited.has('c'), false);
	assert.deepEqual(discovery_state(graph, ['start'], new Set()).visible_edges, []);
	assert.equal(discovery_state(graph, [], new Set(['sa'])).visible_nodes.size, 0);
	assert.equal(JSON.stringify(graph), before);
});
test('unavailable Chambers and their passages remain invisible even with reveal flags', () => {
	const graph = layout_graph({ chambers: [
		{ id: 'start', type: 'start', depth: 0, exits: [{ id: 'hidden', target: 'locked' }] },
		{ id: 'locked', depth: 1, exits: [] }
	] }, { supported_ids: new Set(['start']) });
	const view = discovery_state(graph, ['start'], new Set(['hidden']));
	assert.deepEqual([...view.visible_nodes], ['start']);
	assert.equal(view.visible_edges.length, 0);
	assert.equal(graph.nodes.length, 2);
	assert.throws(() => route_to(graph, 'locked'), /No route/);
});
