export function create_journey_runtime({ topology, supported_versions, layout_graph, render_graph }) {
	// Adapt only authoritative snapshots. No client discovery cache or inferred reveal flags.
	function journey_snapshot(expedition, content_version = 3) {
		const by_id = new Map(topology.chambers.map(chamber => [chamber.id, chamber]));
		const visits = (expedition?.history ?? []).filter(visit => by_id.has(visit.chamber_id));
		const chamber = expedition?.chamber;
		const route = visits.map(visit => visit.chamber_id);
		if (chamber && !chamber.preparation && by_id.has(chamber.id) && route.at(-1) !== chamber.id) route.push(chamber.id);
		const revealed = new Set(expedition?.journey?.revealed ?? []);
		for (const visit of visits) if (visit.chosen_exit_id) revealed.add(visit.chosen_exit_id);
		for (const exit of chamber?.exits ?? []) if (exit.label !== '???') revealed.add(exit.id);
		// Tracking reads omit history; debug jumps need not follow passages. Only a saved
		// choice leading to the next visit proves that a passage was travelled.
		const travelled = new Set();
		for (let i = 0; i < visits.length; i++) {
			const visit = visits[i];
			const edge = by_id.get(visit.chamber_id).exits?.find(edge => edge.id === visit.chosen_exit_id);
			if (edge && edge.target === route[i + 1]) travelled.add(edge.id);
		}
		const current = expedition?.status === 'active' && !chamber?.preparation && by_id.has(chamber?.id) ? chamber.id : null;
		return { route, revealed, snapshot_state: { current, visited: new Set(route), travelled }, supported_ids: new Set(expedition?.journey?.supported_ids ?? (supported_versions[content_version] ?? [])),
			current };
	}

	function register_journey_element({ label, getLangString }) {
		if (customElements.get('mp-expedition-journey')) return;
		customElements.define('mp-expedition-journey', class extends HTMLElement {
			static observedAttributes = ['snapshot'];
			connectedCallback() {
				if (this.cleanup) return;
				this.classList.add('mp-journey-map');
				// Adopt an existing clone's owned children before rendering.
				this.svg = this.querySelector('svg') ?? this.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
				this.detail = this.querySelector('.mp-journey-detail') ?? this.appendChild(document.createElement('div'));
				this.detail.className = 'mp-journey-detail';
				this.detail.setAttribute('role', 'tooltip');
				this.detail.id = `mp-journey-detail-${++detail_id}`;
				const hide = () => { this.selected?.removeAttribute('aria-describedby'); this.selected = null; this.detail.hidden = true; };
				this.hide = hide;
				const select = event => {
					const node = event.target.closest('[data-node]');
					if (!node || !this.contains(node)) return;
					hide(); this.selected = node;
					this.detail.textContent = node.getAttribute('aria-label');
					this.detail.hidden = false;
					node.setAttribute('aria-describedby', this.detail.id);
					this.position_detail();
				};
				const key = event => {
					if (event.key === 'Escape') hide();
					if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(event); }
				};
				const outside = event => { if (!this.contains(event.target)) hide(); };
				const leave = () => { if (!this.selected?.matches(':focus')) hide(); };
				const handlers = [['click', select], ['pointerover', select], ['focusin', select], ['focusout', hide], ['pointerleave', leave], ['keydown', key]];
				for (const [name, handler] of handlers) this.addEventListener(name, handler);
				document.addEventListener('pointerdown', outside);
				const observer = new ResizeObserver(() => this.position_detail()); observer.observe(this);
				this.cleanup = () => {
					for (const [name, handler] of handlers) this.removeEventListener(name, handler);
					document.removeEventListener('pointerdown', outside); observer.disconnect(); hide();
				};
				this.draw();
			}
			disconnectedCallback() { this.cleanup?.(); this.cleanup = null; }
			attributeChangedCallback() { if (this.cleanup) this.draw(); }
			position_detail() {
				if (!this.selected) return;
				const bounds = this.getBoundingClientRect(), node = this.selected.querySelector('.node-circle').getBoundingClientRect();
				const width = this.detail.getBoundingClientRect().width;
				this.detail.style.left = `${Math.max(8, Math.min(bounds.width - width - 8, (node.left + node.right) / 2 - bounds.left - width / 2))}px`;
				this.detail.style.top = `${node.bottom - bounds.top + 10}px`;
			}
			draw() {
				this.hide();
				const model = JSON.parse(this.getAttribute('snapshot') || 'null');
				const snapshot = journey_snapshot(model?.expedition, model?.content_version);
				const graph = layout_graph(topology, { column_gap: 45, row_gap: 35, radius: 17, supported_ids: snapshot.supported_ids });
				// IDs and topology are fixed; only visited names may be disclosed.
				for (const node of graph.nodes) node.label = label(node.id === 'entrance' ? 'The Rift' : node.label);
				render_graph(this.svg, graph, snapshot.route, { revealed: snapshot.revealed, current: snapshot.current, snapshot_state: snapshot.snapshot_state,
					unknown_label: getLangString('MOD_MP_EXPEDITION_UNKNOWN_CHAMBER') });
				this.svg.setAttribute('aria-label', getLangString('MOD_MP_EXPEDITION_UI_JOURNEY'));
				const current = this.svg.querySelector('.current');
				if (current) current.setAttribute('aria-label', current.getAttribute('aria-label') + ' · ' + getLangString('MOD_MP_EXPEDITION_CURRENT'));
				// The accessible name serves screen readers; no SVG title/native tooltip.
			}
		});
	}
	let detail_id = 0;

	return { journey_snapshot, register_journey_element };
}
