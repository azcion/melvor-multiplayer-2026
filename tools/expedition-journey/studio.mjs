import { layout_graph, journey_state, route_to, render_graph } from './graph.mjs';
const $ = id => document.getElementById(id);
let content, graph, supported_ids, route = [], revealed = new Set();
function settings() {
	return { column_gap: +$('column-gap').value, row_gap: +$('row-gap').value,
		radius: +$('radius').value, supported_ids };
}
function draw() {
	hide_node_detail();
	graph = layout_graph(content, settings());
	const all_known = $('all-known').checked;
	const state = render_graph($('graph'), graph, route, { ...settings(), revealed, ghosts: all_known || $('ghosts').checked });
	// Authoring-only presentation: disclose all topology without inventing a travelled route.
	if (all_known) {
		$('graph').querySelector('desc').textContent = 'Full authored graph. Every Chamber and passage is known, including unavailable Chambers.';
		for (const element of $('graph').querySelectorAll('.layout-ghost')) element.classList.remove('layout-ghost');
		for (const element of $('graph').querySelectorAll('[data-node]')) {
			const chamber = graph.nodes.find(node => node.id === element.dataset.node);
			element.classList.remove('unknown');
			element.classList.add('visited');
			element.setAttribute('aria-label', chamber.label);
			element.setAttribute('aria-disabled', 'false');
			element.setAttribute('tabindex', '0');
			element.querySelector('.question-mark')?.remove();
		}
	}
	$('ghosts').disabled = all_known;
	document.querySelector('.preview').classList.toggle('mobile', $('mobile').checked);
	const current = graph.nodes.find(node => node.id === state.current);
	$('current').textContent = current?.label ?? 'The journey has yet to begin';
	$('count').textContent = `${state.visited.size} visited`;
	$('route').textContent = route.map(id => graph.nodes.find(node => node.id === id).label).join(' → ');
	$('back').disabled = route.length < 2;
	$('destination').value = state.current ?? '';
	$('exits').replaceChildren();
	for (const edge of state.visible_edges.filter(edge => edge.from === state.current)) {
		const button = document.createElement('button');
		button.textContent = 'Enter revealed passage';
		button.onclick = () => { route.push(edge.to); draw(); };
		$('exits').append(button);
	}
	$('reveal-controls').replaceChildren();
	for (const id of route) {
		const chamber = graph.nodes.find(node => node.id === id);
		const heading = document.createElement('h3'); heading.textContent = chamber.label;
		$('reveal-controls').append(heading);
		for (const edge of graph.edges.filter(edge => edge.from === id)) {
			const target = graph.nodes.find(node => node.id === edge.to);
			const label = document.createElement('label'); label.className = 'check';
			const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
			checkbox.checked = state.travelled.has(edge.id) || revealed.has(edge.id);
			checkbox.disabled = state.travelled.has(edge.id) || !target.available;
			checkbox.onchange = () => { checkbox.checked ? revealed.add(edge.id) : revealed.delete(edge.id); draw(); };
			label.append(checkbox, ` ${target.label}${!target.available ? ' (unavailable)' : ''}${state.travelled.has(edge.id) ? ' (travelled)' : ''}`);
			$('reveal-controls').append(label);
		}
	}
	$('status').textContent = `${graph.nodes.length} fixed layout positions · ${all_known ? graph.nodes.length : state.visible_nodes.size} visible nodes · ${all_known ? graph.edges.length : state.visible_edges.length} visible passages · ${graph.crossings} layout crossings. Simulation controls use authoring names; the player map does not.`;
}
function preset() {
	const mode = $('scenario').value;
	const target = mode === 'deep' ? 'buried_observatory' : mode === 'shared' ? 'prismatic_descent' : 'entrance';
	route = route_to(graph, target); revealed = new Set();
	const exits = graph.edges.filter(edge => edge.from === target && graph.nodes.find(node => node.id === edge.to).available);
	if (mode === 'one' || mode === 'deep') revealed.add(exits[0]?.id);
	if (mode === 'several') exits.forEach(edge => revealed.add(edge.id));
	if (mode === 'shared') {
		// Tideworn Crypts has another incoming passage from unvisited Drowned Cloister.
		revealed.add(exits.find(edge => edge.to === 'tideworn_crypts').id);
	}
	draw();
}
async function load() {
	try {
		const [response, supported_response] = await Promise.all([fetch('/content-v1.json'), fetch('/content-v3.json')]);
		if (!supported_response.ok || !response.ok) throw new Error('Unable to load Chamber content');
		supported_ids = new Set((await supported_response.json()).chambers.map(node => node.id));
		content = await response.json(); graph = layout_graph(content, { supported_ids });
		$('destination').replaceChildren(new Option('No journey', ''), ...graph.nodes.map(node => Object.assign(new Option(node.label + (node.available ? '' : ' · Unavailable'), node.id), { disabled: !node.available })));
		preset();
	} catch (error) { $('status').textContent = error.message; }
}
$('scenario').onchange = preset;
$('destination').onchange = () => { route = $('destination').value ? route_to(graph, $('destination').value) : []; revealed.clear(); draw(); };
$('back').onclick = () => { route.pop(); draw(); };
$('reset').onclick = () => { route = [graph.nodes.find(node => node.type === 'start').id]; revealed.clear(); draw(); };
$('empty').onclick = () => { route = []; revealed.clear(); draw(); };
for (const id of ['column-gap', 'row-gap', 'radius', 'mobile', 'ghosts', 'all-known']) $(id).oninput = draw;
let selected_node = null;
function hide_node_detail() {
	selected_node?.removeAttribute('aria-describedby');
	selected_node = null;
	$('node-detail').hidden = true;
}
function position_node_detail() {
	if (!selected_node) return;
	const detail = $('node-detail'), map = document.querySelector('.viewport');
	const bounds = map.getBoundingClientRect(), node = selected_node.querySelector('.node-circle').getBoundingClientRect();
	const width = detail.getBoundingClientRect().width;
	detail.style.left = `${Math.max(8, Math.min(bounds.width - width - 8, (node.left + node.right) / 2 - bounds.left - width / 2))}px`;
	detail.style.top = `${node.bottom - bounds.top + 10}px`;
}
function select_node(event) {
	const node = event.target.closest('[data-node]');
	if (!node || node.getAttribute('aria-disabled') === 'true') return;
	hide_node_detail();
	selected_node = node;
	const chamber = graph.nodes.find(chamber => chamber.id === node.dataset.node);
	$('node-detail').textContent = ($('all-known').checked || route.includes(chamber.id)) ? chamber.label : 'Unknown Chamber';
	$('node-detail').hidden = false;
	node.setAttribute('aria-describedby', 'node-detail');
	position_node_detail();
}
$('graph').onclick = select_node;
$('graph').onpointerover = select_node;
$('graph').onfocusin = select_node;
$('graph').onpointerleave = () => { if (!selected_node?.matches(':focus')) hide_node_detail(); };
$('graph').onfocusout = hide_node_detail;
$('graph').onkeydown = event => {
	if (event.key === 'Escape') { hide_node_detail(); return; }
	if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select_node(event); }
};
document.addEventListener('pointerdown', event => {
	if (!event.target.closest('#graph [data-node]')) hide_node_detail();
});
// Keep the popup anchored when the card changes width without a layout-control redraw.
new ResizeObserver(position_node_detail).observe(document.querySelector('.viewport'));
$('export').onclick = () => {
	journey_state(graph, route);
	const blob = new Blob([JSON.stringify({ content_version: content.version, route, revealed: [...revealed], settings: { ...settings(), supported_ids: [...supported_ids] } }, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob), link = document.createElement('a');
	link.href = url; link.download = 'expedition-journey-scenario.json'; link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
};
await load();
