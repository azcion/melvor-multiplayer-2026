// Coordinates follow the uncropped 16:9 Prismatic Descent artwork.
const CRYSTAL_FACETS = [
	[0.166, 0.155], [0.151, 0.267], [0.097, 0.22], [0.188, 0.293],
	[0.036, 0.663], [0.061, 0.766], [0.108, 0.802],
	[0.54, 0.76], [0.555, 0.829], [0.889, 0.292], [0.898, 0.348]
];

export function create_crystal_renderer(random = Math.random) {
	let elapsed = 0;
	const motes = Array.from({ length: 42 }, () => ({
		x: random(), y: random(), depth: random(), phase: random() * Math.PI * 2
	}));
	const render_glints = create_facet_glint_renderer(CRYSTAL_FACETS, random);
	return ({ context: c, width, height, seconds }) => {
		elapsed += seconds;
		for (const p of motes) {
			// Slow buoyant dust, with independent eddies instead of a uniform snowfall.
			p.x = ((p.x + Math.sin(elapsed * 0.28 + p.phase) * (2 + p.depth * 4) * seconds / width) % 1 + 1) % 1;
			p.y = ((p.y - (2 + p.depth * 5) * seconds / height) % 1 + 1) % 1;
			const x = p.x * width, y = p.y * height;
			const radius = 0.45 + p.depth * 0.75;
			const alpha = (0.18 + p.depth * 0.25) * (0.65 + 0.35 * Math.sin(elapsed * 0.65 + p.phase));
			c.fillStyle = p.depth > 0.65 ? '#c4fff1' : '#8ed9e8';
			c.globalAlpha = alpha * 0.12;
			c.beginPath(); c.arc(x, y, radius * 3.5, 0, Math.PI * 2); c.fill();
			c.globalAlpha = alpha;
			c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill();
		}
		render_glints({ context: c, width, height, seconds });
	};
}

// Each scene supplies anchors in its original artwork's normalized coordinates.
export function create_facet_glint_renderer(facets, random = Math.random, get_settings = () => ({})) {
	let elapsed = 0;
	const glints = facets.map(([x, y]) => ({ x, y, phase: random() * Math.PI * 2,
		period: 5 + random() * 5, size: 2 + random() * 2 }));
	return ({ context: c, width, height, seconds }) => {
		const settings = get_settings();
		elapsed += seconds * (settings.speed ?? 1);
		const count = Math.min(glints.length, settings.count ?? glints.length);
		for (let index = 0; index < count; index++) {
			const p = glints[index];
			// Smooth, infrequent facet catches. No full-image flashes or large bloom.
			const alpha = Math.min(1, Math.pow(Math.max(0, Math.sin(elapsed * Math.PI * 2 / p.period + p.phase)), 10) * (settings.brightness ?? 0.65));
			if (alpha < 0.015) continue;
			const x = p.x * width, y = p.y * height;
			const size = p.size * Math.min(1, width / 640);
			c.fillStyle = '#d8fff5'; c.globalAlpha = alpha;
			c.beginPath();
			c.moveTo(x, y - size * 1.8); c.lineTo(x + size * 0.3, y - size * 0.3);
			c.lineTo(x + size, y); c.lineTo(x + size * 0.3, y + size * 0.3);
			c.lineTo(x, y + size * 1.8); c.lineTo(x - size * 0.3, y + size * 0.3);
			c.lineTo(x - size, y); c.lineTo(x - size * 0.3, y - size * 0.3);
			c.closePath(); c.fill();
		}
	};
}
