// Normalized anchors match the uncropped 16:9 Buried Observatory artwork.
const BEAMS = [
	{ tip: [0.112, 0.155], left: [0.102, 0.40], right: [0.242, 0.458] },
	{ tip: [0.351, 0.267], left: [0.343, 0.424], right: [0.455, 0.470] },
	{ tip: [0.613, 0.295], left: [0.533, 0.470], right: [0.624, 0.442] },
	{ tip: [0.810, 0.269], left: [0.700, 0.464], right: [0.821, 0.418] },
	{ tip: [0.980, 0.180], left: [0.895, 0.423], right: [0.965, 0.379] }
];
const GOLD_FACETS = [
	[0.736, 0.126], [0.792, 0.164], [0.839, 0.245], [0.871, 0.344],
	[0.861, 0.447], [0.827, 0.538], [0.781, 0.600], [0.711, 0.625],
	[0.639, 0.595], [0.606, 0.508], [0.600, 0.470],
	[0.293, 0.650], [0.400, 0.738], [0.596, 0.767], [0.756, 0.752], [0.846, 0.713]
];

export const DEFAULT_OBSERVATORY_SETTINGS = Object.freeze({
	dust_density: 120, dust_speed: 4, beam_intensity: 1, beam_speed: 1.7,
	glint_frequency: 3, glint_brightness: 1
});

export function normalize_observatory_settings(settings = {}) {
	const bounded = (key, min, max) => Number.isFinite(settings[key])
		? Math.max(min, Math.min(max, settings[key])) : DEFAULT_OBSERVATORY_SETTINGS[key];
	return {
		dust_density: Math.round(bounded('dust_density', 0, 360)), dust_speed: bounded('dust_speed', 0, 8),
		beam_intensity: bounded('beam_intensity', 0, 1), beam_speed: bounded('beam_speed', 0, 6),
		glint_frequency: bounded('glint_frequency', 0, 6), glint_brightness: bounded('glint_brightness', 0, 1)
	};
}

export function create_observatory_renderer({ random = Math.random,
	get_settings = () => DEFAULT_OBSERVATORY_SETTINGS } = {}) {
	const dust = Array.from({ length: 360 }, (_, index) => ({
		beam: index % BEAMS.length, progress: random(), across: random(),
		phase: random() * Math.PI * 2, speed: 0.014 + random() * 0.025,
		radius: 0.45 + random() * 0.65
	}));
	const glints = GOLD_FACETS.map(([x, y]) => ({ x, y, phase: random() * Math.PI * 2,
		period: 6 + random() * 6, size: 1.5 + random() * 1.7 }));
	let dust_time = 0, beam_time = 0, glint_time = 0;
	return ({ context: c, width, height, seconds }) => {
		const s = normalize_observatory_settings(get_settings());
		dust_time += seconds * s.dust_speed;
		beam_time += seconds * s.beam_speed;
		glint_time += seconds * s.glint_frequency;
		for (let index = 0; index < BEAMS.length; index++) {
			const b = BEAMS[index];
			const breath = 0.55 + 0.45 * Math.sin(beam_time * 0.55 + index * 1.9);
			c.globalAlpha = s.beam_intensity * breath * 0.28;
			const light = c.createLinearGradient(b.left[0] * width, b.left[1] * height,
				b.right[0] * width, b.right[1] * height);
			light.addColorStop(0, 'rgba(188,223,255,0)');
			light.addColorStop(0.45, 'rgba(188,223,255,0.85)');
			light.addColorStop(1, 'rgba(188,223,255,0)');
			c.fillStyle = light;
			c.beginPath(); c.moveTo(b.tip[0] * width, b.tip[1] * height);
			c.lineTo(b.left[0] * width, b.left[1] * height);
			c.lineTo(b.right[0] * width, b.right[1] * height); c.closePath(); c.fill();
		}
		for (let index = 0; index < s.dust_density; index++) {
			const p = dust[index], b = BEAMS[p.beam];
			const t = (p.progress + dust_time * p.speed) % 1;
			const across = Math.max(0.05, Math.min(0.95, p.across + Math.sin(dust_time * 0.4 + p.phase) * 0.06));
			const base_x = b.left[0] * (1 - across) + b.right[0] * across;
			const base_y = b.left[1] * (1 - across) + b.right[1] * across;
			const x = (b.tip[0] * (1 - t) + base_x * t) * width;
			const y = (b.tip[1] * (1 - t) + base_y * t) * height;
			const alpha = Math.sin(t * Math.PI) * (0.20 + 0.40 * p.across);
			const radius = p.radius * Math.min(1, width / 640);
			c.fillStyle = '#e0eeff'; c.globalAlpha = alpha * 0.13;
			c.beginPath(); c.arc(x, y, radius * 3, 0, Math.PI * 2); c.fill();
			c.globalAlpha = alpha;
			c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill();
		}
		for (const p of glints) {
			// Frequency zero disables highlights rather than freezing a bright glint.
			const alpha = s.glint_frequency === 0 ? 0 :
				Math.pow(Math.max(0, Math.sin(glint_time * Math.PI * 2 / p.period + p.phase)), 12) * s.glint_brightness;
			if (alpha < 0.015) continue;
			const x = p.x * width, y = p.y * height, size = p.size * Math.min(1, width / 640);
			c.globalAlpha = alpha; c.fillStyle = '#ffe6a8';
			c.beginPath(); c.moveTo(x, y - size); c.lineTo(x + size * 0.2, y - size * 0.2);
			c.lineTo(x + size * 1.5, y); c.lineTo(x + size * 0.2, y + size * 0.2);
			c.lineTo(x, y + size); c.lineTo(x - size * 0.2, y + size * 0.2);
			c.lineTo(x - size * 1.5, y); c.lineTo(x - size * 0.2, y - size * 0.2);
			c.closePath(); c.fill();
		}
	};
}
