// Choose a deterministic ordering from topology alone; route and tuning never change it.
const order_cache = new WeakMap();
export function crossing_count(rows) {
	const positions = new Map(rows.flatMap((row, depth) => row.map((node, i) => [node.id, { x: i - (row.length - 1) / 2, y: depth }])));
	const edges = rows.flat().flatMap(node => (node.exits || []).map(edge => [positions.get(node.id), positions.get(edge.target)]));
	const cross = (a, b, c) => (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
	let count = 0;
	for (let i = 0; i < edges.length; i++) for (let j = i+1; j < edges.length; j++) {
		const [a,b] = edges[i], [c,d] = edges[j];
		if (a && b && c && d && cross(a,b,c)*cross(a,b,d) < 0 && cross(c,d,a)*cross(c,d,b) < 0) count++;
	}
	return count;
}
function *permutations(row, prefix = []) {
	if (!row.length) { yield prefix; return; }
	for (let i = 0; i < row.length; i++) yield* permutations([...row.slice(0,i), ...row.slice(i+1)], [...prefix, row[i]]);
}
export function order_layers(content) {
	if (order_cache.has(content)) return order_cache.get(content);
	const chambers = [...content.chambers].sort((a,b) => a.depth-b.depth || a.id.localeCompare(b.id, 'en'));
	const rows = [...new Set(chambers.map(c => c.depth))].map(depth => chambers.filter(c => c.depth === depth));
	const before = crossing_count(rows);
	let best = before;
	// Exhaustive within each small depth, coordinate descent across depths. Strict improvements
	// prevent oscillation; this reduces crossings without claiming a global optimum.
	for (let pass = 0; pass < 6; pass++) {
		let improved = false;
		for (let n = 0; n < rows.length; n++) {
			const i = pass % 2 ? rows.length - 1 - n : n;
			let winner = rows[i];
			// Bound work for future, much wider content: use pair swaps instead of factorial search.
			const candidates = rows[i].length <= 7 ? permutations(rows[i]) : rows[i].flatMap((_, a) => rows[i].slice(a+1).map((_, k) => {
				const candidate = [...rows[i]], b = a+k+1; [candidate[a],candidate[b]] = [candidate[b],candidate[a]]; return candidate;
			}));
			for (const candidate of candidates) {
				rows[i] = candidate;
				const score = crossing_count(rows);
				if (score < best) { best = score; winner = candidate; improved = true; }
			}
			rows[i] = winner;
		}
		if (!improved) break;
	}
	const result = { rows, crossings_before: before, crossings: best };
	order_cache.set(content, result);
	return result;
}
export function layout_graph(content, { column_gap = 80, row_gap = 90, radius = 13, supported_ids } = {}) {
	if (!Array.isArray(content?.chambers) || !content.chambers.length) throw new Error('Content needs Chambers.');
	const ids = new Set();
	for (const chamber of content.chambers) {
		if (!chamber.id || ids.has(chamber.id) || !Number.isInteger(chamber.depth) || chamber.depth < 0)
			throw new Error('Chambers need unique IDs and non-negative integer depths.');
		ids.add(chamber.id);
	}
	for (const chamber of content.chambers) for (const exit of chamber.exits || []) {
		if (!ids.has(exit.target) || content.chambers.find(c => c.id === exit.target).depth <= chamber.depth)
			throw new Error(`Invalid forward passage: ${chamber.id} → ${exit.target}`);
	}
	const { rows, crossings_before, crossings } = order_layers(content);
	// Sliders set clear space between circle boundaries, including the current ring.
	const diameter = 2 * (radius + 7), padding = radius + 17;
	const dx = diameter + Math.max(0, row_gap), dy = diameter + Math.max(0, column_gap);
	const span = Math.max(...rows.map(row => row.length)) - 1;
	const nodes = rows.flatMap((row, layer) => row.map((chamber, index) => ({ ...chamber,
		x: padding + (span / 2 + index - (row.length - 1) / 2) * dx,
		y: padding + layer * dy, available: !supported_ids || supported_ids.has(chamber.id) })));
	const edges = nodes.flatMap(node => (node.exits || []).map(exit => ({ id: exit.id, from: node.id, to: exit.target })));
	return { nodes, edges, width: padding * 2 + span * dx, height: padding * 2 + (rows.length - 1) * dy,
		crossings_before, crossings };
}

export function journey_state(graph, route) {
	const by_id = new Map(graph.nodes.map(node => [node.id, node]));
	if (route.length && by_id.get(route[0])?.type !== 'start') throw new Error('A journey must begin at the start Chamber.');
	const travelled = new Set();
	for (let i = 0; i < route.length; i++) {
		if (!by_id.has(route[i])) throw new Error(`Unknown Chamber: ${route[i]}`);
		if (i) {
			const edge = graph.edges.find(edge => edge.from === route[i - 1] && edge.to === route[i]);
			if (!edge) throw new Error('The route must follow existing passages.');
			travelled.add(edge.id);
		}
	}
	return { current: route.at(-1) ?? null, visited: new Set(route), travelled };
}

export function route_to(graph, target) {
	const start = graph.nodes.find(node => node.type === 'start');
	const queue = start ? [[start.id]] : [];
	const seen = new Set();
	for (let i = 0; i < queue.length; i++) {
		const route = queue[i], id = route.at(-1);
		if (id === target) return route;
		if (seen.has(id)) continue;
		seen.add(id);
		for (const edge of graph.edges.filter(edge => edge.from === id && graph.nodes.find(node => node.id === edge.to).available)) queue.push([...route, edge.to]);
	}
	throw new Error(`No route to ${target}`);
}

// Discovery belongs to each passage, never to all edges incident to a visible node.
export function discovery_state(graph, route, revealed = new Set(), snapshot_state) {
	const state = snapshot_state ?? journey_state(graph, route);
	const by_id = new Map(graph.nodes.map(node => [node.id, node]));
	const visible_edges = graph.edges.filter(edge => by_id.get(edge.from).available && by_id.get(edge.to).available
		&& state.visited.has(edge.from) && (state.travelled.has(edge.id) || revealed.has(edge.id)));
	const visible_nodes = new Set([...state.visited].filter(id => by_id.get(id).available));
	for (const edge of visible_edges) visible_nodes.add(edge.to);
	return { ...state, visible_edges, visible_nodes };
}

export function render_graph(svg, graph, route, { radius = 17, revealed = new Set(), ghosts = false, current, snapshot_state, unknown_label = 'Unknown Chamber' } = {}) {
	const state = discovery_state(graph, route, revealed, snapshot_state);
	if (current !== undefined) state.current = current;
	const doc = svg.ownerDocument;
	function el(tag, attributes, text) {
		const element = doc.createElementNS('http://www.w3.org/2000/svg', tag);
		for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
		if (text !== undefined) element.textContent = text;
		return element;
	}
	svg.replaceChildren();
	svg.setAttribute('viewBox', `0 0 ${graph.width} ${graph.height}`);
	svg.setAttribute('width', graph.width);
	svg.setAttribute('height', graph.height);
	svg.append(el('desc', {}, 'Only visited Chambers and individually revealed passages are shown. Question marks are unvisited destinations. Gold lines show the travelled route. A bright ring marks the current Chamber. Dashed circles are unvisited.'));
	const by_id = new Map(graph.nodes.map(node => [node.id, node]));
	for (const edge of graph.edges) {
		const visible = state.visible_edges.some(candidate => candidate.id === edge.id);
		if (!visible && !ghosts) continue;
		const from = by_id.get(edge.from), to = by_id.get(edge.to);
		svg.append(el('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y,
			class: `passage${state.travelled.has(edge.id) ? ' travelled' : ''}${visible ? '' : ' layout-ghost'}`, 'data-edge': edge.id }));
	}
	for (const node of graph.nodes) {
		const visible = state.visible_nodes.has(node.id);
		if (!visible && !ghosts) continue;
		const status = node.id === state.current ? 'current' : state.visited.has(node.id) ? 'visited' : 'unknown';
		const label = !visible ? 'Hidden layout position' : status === 'unknown' ? unknown_label : node.label;
		const group = el('g', { class: `chamber ${status}${visible ? '' : ' layout-ghost'}`, transform: `translate(${node.x} ${node.y})`,
			'data-node': node.id, tabindex: visible ? 0 : -1, role: 'button', 'aria-disabled': !visible ? 'true' : 'false', 'aria-label': label });
		if (status === 'current') group.append(el('circle', { r: radius + 7, class: 'current-ring' }));
		group.append(el('circle', { r: radius, class: 'node-circle' }));
		if (status === 'visited') group.append(el('circle', { r: 3, class: 'visited-dot' }));
		if (status === 'unknown' && visible) group.append(el('text', { class: 'question-mark', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': radius * 1.25 }, '?'));
		svg.append(group);
	}
	return state;
}
