import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { create_journey_runtime } from '../../mod/expedition-journey.mjs';
import { topology, supported_versions } from '../../mod/expedition-journey-topology.mjs';
import { layout_graph, render_graph, discovery_state } from '../../mod/expedition-journey-graph.mjs';
const { journey_snapshot, register_journey_element } = create_journey_runtime({ topology, supported_versions, layout_graph, render_graph });

test('snapshot preserves earlier discoveries without revealing other incoming or onward passages', () => {
	const graph = layout_graph(topology);
	const snapshot = journey_snapshot({ status: 'active', journey: { supported_ids: topology.chambers.map(n => n.id), revealed: ['entrance:exit_2'] },
		history: [{ chamber_id: 'entrance', chosen_exit_id: 'entrance:exit_1' }],
		chamber: { id: 'prismatic_descent', exits: [{ id: 'prismatic_descent:exit_1', label: '???' }] } });
	assert.deepEqual(snapshot.route, ['entrance', 'prismatic_descent']);
	assert.equal(snapshot.current, 'prismatic_descent');
	const visible = discovery_state(graph, snapshot.route, snapshot.revealed);
	assert.deepEqual(visible.visible_edges.map(e => e.id).sort(), ['entrance:exit_1', 'entrance:exit_2']);
});
test('preparations never appear and terminal snapshots have no current chamber or duplicated final visit', () => {
	assert.deepEqual(journey_snapshot({ chamber: { id: 'preparation', preparation: true } }).route, []);
	const result = journey_snapshot({ status: 'completed', history: [{ chamber_id: 'entrance' }], chamber: { id: 'entrance' } });
	assert.deepEqual(result.route, ['entrance']); assert.equal(result.current, null);
});
test('shipped topology matches authored geometry without task content', async () => {
	const content = JSON.parse(await readFile(new URL('../../server/expedition-content-v1.json', import.meta.url)));
	assert.deepEqual(topology.chambers, content.chambers.map(({id,label,depth,type,exits}) => ({id,label,depth,type,exits})));
});
class Element {
	constructor(tag = '') { this.tag = tag; this.children = []; this.attrs = {}; this.classList = { add() {} }; }
	append(...nodes) { this.children.push(...nodes); }
	appendChild(node) { this.append(node); return node; }
	replaceChildren(...nodes) { this.children = nodes; }
	setAttribute(k,v) { this.attrs[k] = v; }
	getAttribute(k) { return this.attrs[k]; }
	querySelector(selector) { return this.children.find(n => selector === 'svg' ? n.tag === 'svg' : n.className === 'mp-journey-detail'); }
	addEventListener() {} removeEventListener() {}
}
const doc = { createElementNS: (_,tag) => new Element(tag), createElement: tag => new Element(tag), addEventListener() {}, removeEventListener() {} };
test('renderer keeps accessible names and custom popups without native SVG titles', () => {
	const svg = new Element('svg'); svg.ownerDocument = doc;
	render_graph(svg, layout_graph(topology), ['entrance'], { revealed: new Set(['entrance:exit_1']), unknown_label: 'Unknown', current: null });
	assert.equal(svg.children.some(n => n.tag === 'title'), false);
	const nodes = svg.children.filter(n => n.tag === 'g');
	assert.equal(nodes.find(n => n.attrs['data-node'] === 'prismatic_descent').attrs['aria-label'], 'Unknown');
	assert.equal(nodes.some(n => n.children.some(c => c.tag === 'title' || c.attrs.class === 'current-ring')), false);
});
test('custom element reconnects and adopts cloned children with balanced observers', () => {
	let Klass, observed = 0, disconnected = 0;
	globalThis.HTMLElement = Element; globalThis.document = doc;
	globalThis.customElements = { get() {}, define(_, type) { Klass = type; } };
	globalThis.ResizeObserver = class { observe() { observed++; } disconnect() { disconnected++; } };
	register_journey_element({ label: s => s, getLangString: s => s });
	const host = new Klass();
	const svg = new Element('svg'); svg.ownerDocument = doc;
	const detail = new Element('div'); detail.className = 'mp-journey-detail';
	host.append(svg, detail); host.connectedCallback(); host.connectedCallback();
	host.setAttribute('snapshot', JSON.stringify({ expedition: { status: 'active', history: [], chamber: { id: 'prismatic_descent' } } }));
	assert.doesNotThrow(() => host.attributeChangedCallback());
	assert.equal(svg.children.some(node => node.attrs?.['data-node'] === 'prismatic_descent'), true);
	assert.equal(host.children.length, 2); assert.equal(observed, 1);
	host.disconnectedCallback(); host.connectedCallback();
	assert.equal(host.children.length, 2); assert.equal(observed, 2);
	host.disconnectedCallback(); assert.equal(disconnected, 2);
	for (const key of ['HTMLElement', 'document', 'customElements', 'ResizeObserver']) delete globalThis[key];
});

test('tracking-only login renders a current Chamber without inventing earlier visits', () => {
	const snapshot = journey_snapshot({ status: 'active', history: [], chamber: { id: 'prismatic_descent', exits: [] } });
	const svg = new Element('svg'); svg.ownerDocument = doc;
	const state = render_graph(svg, layout_graph(topology), snapshot.route, snapshot);
	assert.equal(state.current, 'prismatic_descent');
	assert.deepEqual([...state.visited], ['prismatic_descent']);
	assert.equal(state.travelled.size, 0);
	assert.equal(state.visible_edges.length, 0);
});

test('snapshot renders debug jumps and repeated visits with only proven passage travel', () => {
	const snapshot = journey_snapshot({ status: 'active', history: [
		{ chamber_id: 'prismatic_descent' },
		{ chamber_id: 'entrance', chosen_exit_id: 'entrance:exit_1' },
		{ chamber_id: 'prismatic_descent' },
	], chamber: { id: 'prismatic_descent' } });
	const svg = new Element('svg'); svg.ownerDocument = doc;
	const state = render_graph(svg, layout_graph(topology), snapshot.route, snapshot);
	assert.deepEqual([...state.travelled], ['entrance:exit_1']);
	assert.equal(state.current, 'prismatic_descent');
	const jump = journey_snapshot({ status: 'active', history: [{ chamber_id: 'entrance' }], chamber: { id: 'prismatic_descent' } });
	assert.equal(jump.snapshot_state.travelled.size, 0);
});

test('legacy hints become dotted without promoting known voting names to revealed passages', () => {
	const snapshot = journey_snapshot({ status: 'active',
		history: [{ chamber_id: 'entrance' }],
		chamber: { id: 'rootforge_passage', exits: [{ id: 'rootforge_passage:exit_1', label: 'Glassroot Terraces' }] },
		journey: {
			revealed: ['entrance:exit_1', 'entrance:exit_2', 'rootforge_passage:exit_1', 'prismatic_descent:exit_1'],
			frontier: ['entrance:exit_2', 'rootforge_passage:exit_1', 'prismatic_descent:exit_1']
		}
	});
	const svg = new Element('svg'); svg.ownerDocument = doc;
	render_graph(svg, layout_graph(topology), snapshot.route, snapshot);
	assert.deepEqual(Object.fromEntries(svg.children.filter(node => node.tag === 'line')
		.map(node => [node.attrs['data-edge'], node.attrs.class])), {
		'entrance:exit_1': 'passage',
		'entrance:exit_2': 'passage frontier',
		'rootforge_passage:exit_1': 'passage frontier'
	});
});
