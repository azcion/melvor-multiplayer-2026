import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../../tools/expedition-viewer.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const content = JSON.parse(readFileSync(new URL('../../server/expedition-content-v1.json', import.meta.url), 'utf8'));
const prototype = {
	nodes: content.chambers.map(({ exits, tasks, ...data }) => ({ data })),
	edges: content.chambers.flatMap(chamber => chamber.exits.map(exit => ({ data: { source: chamber.id, target: exit.target } })))
};

// A small DOM boundary keeps the standalone inline script testable without browser dependencies.
function viewer(extra = {}) {
	class Element {
		constructor() {
			this.children = []; this.attributes = {}; this.events = {}; this.value = '';
			this.clientWidth = 1000; this.clientHeight = 700; this.scrollLeft = 0; this.scrollTop = 0;
			this.classes = new Set();
			this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
		}
		setAttribute(name, value) { this.attributes[name] = String(value); }
		removeAttribute(name) { delete this.attributes[name]; }
		append(...children) { this.children.push(...children); }
		replaceChildren(...children) { this.children = children; }
		addEventListener(name, handler) { this.events[name] = handler; }
		scrollTo(first, second) {
			this.scrollLeft = typeof first === 'object' ? first.left : first;
			this.scrollTop = typeof first === 'object' ? first.top : second;
		}
	}
	const elements = new Map();
	const document = {
		getElementById: id => {
			if (!elements.has(id)) {
				const element = new Element();
				if (id === 'graph') element.setAttribute('hidden', '');
				elements.set(id, element);
			}
			return elements.get(id);
		},
		createElementNS: () => new Element(), createElement: () => new Element(),
		createTextNode: text => ({ textContent: text }),
		querySelector: () => new Element(), documentElement: { style: { setProperty() {} } }
	};
	const context = vm.createContext({ document, URL, AbortController, setTimeout, clearTimeout,
		requestAnimationFrame: callback => callback(), ResizeObserver: class { observe() {} },
		Option: class extends Element { constructor(text, value) { super(); this.textContent = text; this.value = value; } }, ...extra });
	vm.runInContext(script, context);
	return { context, elements, run: code => vm.runInContext(code, context) };
}

test('current content and prototype produce the same graph connections and seven depth layers', () => {
	const view = viewer({ content, prototype });
	assert.equal(view.run('normalizeContent(content).nodes.length'), 31);
	assert.equal(view.run('normalizeContent(content).edges.length'), prototype.edges.length);
	assert.equal(view.run('layoutGraph(normalizeContent(content)).depths.length'), 7);
	assert.equal(view.run('normalizeContent(prototype).nodes.length'), prototype.nodes.length);
	assert.equal(view.run('JSON.stringify(normalizeContent(content).edges.map(e => [e.source, e.target]))'),
		view.run('JSON.stringify(normalizeContent(prototype).edges.map(e => [e.source, e.target]))'));
});

test('invalid structures fail with actionable errors', () => {
	const view = viewer({ content });
	for (const [mutation, error] of [
		['c.chambers = []', /no chambers/],
		['c.chambers.push(c.chambers[0])', /Duplicate chamber/],
		['c.chambers[0].depth = -1', /Invalid depth/],
		['c.chambers[0].label = ""', /Missing label/],
		['c.chambers[0].exits = null', /exits array/],
		['c.chambers[0].exits[0].target = "missing"', /unknown chamber/],
		['c.chambers[0].exits[0].target = "entrance"', /deeper layer/]
	]) assert.throws(() => view.run(`{ const c = JSON.parse(JSON.stringify(content)); ${mutation}; normalizeContent(c); }`), error);
	assert.throws(() => view.run('normalizeContent({})'), /Expected chambers/);
});

test('layout keeps each layer aligned and every node inside the graph without overlap', () => {
	const view = viewer({ content });
	assert.equal(view.run(`(() => {
		const model = normalizeContent(content), layout = layoutGraph(model);
		for (const layer of layout.layers.values()) {
			let previous = null;
			for (const node of layer) {
				const pos = layout.positions.get(node.id);
				if (pos.x < 0 || pos.y < 0 || pos.x + NODE_WIDTH > layout.width || pos.y + NODE_HEIGHT > layout.height) return false;
				if (previous && (pos.y !== previous.y || pos.x < previous.x + NODE_WIDTH)) return false;
				previous = pos;
			}
		}
		return true;
	})()`), true);
});

test('URLs convert GitHub file links and reject unsupported schemes and credentials', () => {
	const view = viewer();
	assert.equal(view.run('rawUrl("https://github.com/owner/repo/blob/main/server/content.json?raw=true")'),
		'https://raw.githubusercontent.com/owner/repo/main/server/content.json');
	assert.equal(view.run('rawUrl("https://example.com/data.json?q=1")'), 'https://example.com/data.json?q=1');
	assert.throws(() => view.run('rawUrl("file:///tmp/content.json")'), /HTTP or HTTPS/);
	assert.throws(() => view.run('rawUrl("https://user:password@example.com/data.json")'), /credentials/);
});

test('file loading renders names, arrows and details; search and selection highlight connections', async () => {
	const view = viewer({ content });
	await view.run('loadContent(() => Promise.resolve("\\uFEFF" + JSON.stringify(content)), "local.json")');
	assert.match(view.elements.get('status').textContent, /31 chambers/);
	assert.equal(Object.hasOwn(view.elements.get('graph').attributes, 'hidden'), false,
		'Loading must remove the SVG hidden attribute, not assign the HTML-only hidden property');
	assert.equal(view.run('graph.nodeElements.size'), 31);
	assert.equal(view.run('graph.edgeElements.length'), prototype.edges.length);
	view.run('selectNode("entrance")');
	assert.equal(view.run('graph.nodeElements.get("entrance").attributes["aria-pressed"]'), 'true');
	assert.equal(view.run('graph.edgeElements.filter(e => e.element.classes.has("active")).length'), 3);
	assert.equal(view.elements.get('details').children[0].textContent, 'The Rift');
	view.run('$("search").value = "prismatic"; updateMatches()');
	assert.equal(view.run('graph.nodeElements.get("prismatic_descent").classes.has("match")'), true);
	view.run('selectNode(null); setZoom(1)');
	assert.equal(view.elements.get('zoom-label').textContent, '100%');
	view.run('setZoom(100)');
	assert.equal(view.elements.get('zoom-label').textContent, '300%');
});

test('malformed replacement retains the usable graph and reports the failure', async () => {
	const view = viewer({ content });
	await view.run('loadContent(() => Promise.resolve(JSON.stringify(content)), "good.json")');
	await view.run('loadContent(() => Promise.resolve("not json"), "bad.json")');
	assert.equal(view.run('graph.nodes.length'), 31);
	assert.match(view.elements.get('status').textContent, /Previous graph retained/);
	assert.equal(view.elements.get('status').classes.has('error'), true);
});

test('a later load wins when earlier file or URL reads finish out of order', async () => {
	const view = viewer({ content });
	const earlier = view.run('loadContent(() => new Promise(resolve => globalThis.finishEarlier = resolve), "earlier.json")');
	await view.run('loadContent(() => Promise.resolve(JSON.stringify(content)), "latest.json")');
	view.run('finishEarlier("not json")');
	await earlier;
	assert.match(view.elements.get('status').textContent, /latest.json$/);
	assert.equal(view.run('graph.nodes.length'), 31);
});

test('URL form fetches without credentials and reports HTTP failures', async () => {
	let options;
	const view = viewer({ fetch: async (url, input) => { options = input; return { ok: false, status: 404, statusText: 'Not Found' }; } });
	view.run('$("url").value = "https://example.com/content.json"; $("source-form").events.submit({ preventDefault() {} })');
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(options.credentials, 'omit');
	assert.equal(options.referrerPolicy, 'no-referrer');
	assert.match(view.elements.get('status').textContent, /HTTP 404 Not Found/);
});

test('untrusted labels and IDs remain literal text in graph and details', async () => {
	const unsafe = { chambers: [{ id: '<script>evil</script>', label: '<img src=x onerror=evil()>', depth: 0, type: 'start', exits: [] }] };
	const view = viewer({ unsafe });
	await view.run('loadContent(() => Promise.resolve(JSON.stringify(unsafe)), "unsafe.json")');
	view.run('selectNode(unsafe.chambers[0].id)');
	assert.equal(view.elements.get('details').children[0].textContent, unsafe.chambers[0].label);
	assert.equal(view.run('graph.nodeElements.get(unsafe.chambers[0].id).children[0].textContent.startsWith(unsafe.chambers[0].label)'), true);
	assert.doesNotMatch(script, /innerHTML/);
});
