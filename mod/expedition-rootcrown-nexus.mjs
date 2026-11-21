export const controls = [
	{ key: 'worm_glow', label: 'Worm glow', min: 0, max: 2, step: 0.05, value: 2 },
	{ key: 'worm_speed', label: 'Pulse speed', min: 0, max: 3, step: 0.05, value: 0.85 },
	{ key: 'worm_halo', label: 'Surrounding glow', min: 0, max: 2, step: 0.05, value: 2 },
	{ key: 'strand_pulse', label: 'Traveling strand light', min: 0, max: 2, step: 0.05, value: 2 },
];

const TAU = Math.PI * 2;

// Measured along the painted strands, from the ceiling attachment to the emissive tip.
const STRANDS = [
	[189, 26, 189, 73, 1.0],
	[306, 30, 306, 76, 1.05],
	[345, 11, 344, 39, 0.43],
	[442, 102, 442, 119, 0.29],
	[592, 74, 592, 97, 0.62],
	[660, 134, 660, 142, 0.28],
	[683, 128, 685, 154, 0.26],
	[752, 76, 752, 106, 0.88],
	[848, 120, 846, 140, 0.48],
	[1128, 42, 1127, 76, 0.81],
	[1211, 1, 1210, 60, 1.05],
	[1264, 126, 1263, 143, 0.21],
].map(([x0, y0, x1, y1, scale]) => ({ x0: x0 / 1280, y0: y0 / 720, x1: x1 / 1280, y1: y1 / 720, scale }));

function paint_light(c, x, y, radius, alpha, center, middle) {
	if (alpha <= 0.002) return;
	const glow = c.createRadialGradient(x, y, 0, x, y, radius);
	glow.addColorStop(0, center);
	glow.addColorStop(0.34, middle);
	glow.addColorStop(1, 'rgba(97,235,183,0)');
	c.globalAlpha = Math.min(1, alpha);
	c.fillStyle = glow;
	c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

export function create_renderer({ get_settings = () => ({}), random = Math.random } = {}) {
	const worms = STRANDS.map((strand, i) => ({
		...strand,
		offset: (i * 0.277 + random() * 0.15) % 1,
		period: 3.8 + random() * 3.6,
		waver: random() * TAU,
	}));
	const settings = {};
	let time = 0;

	return ({ context: c, width: w, height: h, seconds }) => {
		const input = get_settings();
		for (const { key, min, max, value } of controls) {
			settings[key] = Number.isFinite(input?.[key]) ? Math.max(min, Math.min(max, input[key])) : value;
		}
		time += seconds * settings.worm_speed;

		const scale = w / 1280;
		for (const worm of worms) {
			const x = worm.x1 * w;
			const y = worm.y1 * h;
			const phase = (worm.offset + time / worm.period) % 1;
			// The light packet descends first. The tip blooms on arrival, then gently fades.
			const tip_rise = Math.min(1, Math.max(0, (phase - 0.4) / 0.18));
			const tip_fall = Math.max(0, 1 - (phase - 0.57) / 0.43);
			const afterglow = Math.min(tip_rise, tip_fall) ** 1.25;
			const breath = 0.51 + Math.sin(time * 0.73 + worm.waver) * 0.12;
			const intensity = worm.scale * (0.24 * breath + 0.69 * afterglow);
			if (phase < 0.52 && settings.strand_pulse > 0) {
				const travel = phase / 0.52;
				const head = Math.min(1, travel * 7);
				const tail = Math.max(0, travel - 0.28);
				const tx = worm.x0 * w + (x - worm.x0 * w) * travel;
				const ty = worm.y0 * h + (y - worm.y0 * h) * travel;
				const tail_x = worm.x0 * w + (x - worm.x0 * w) * tail;
				const tail_y = worm.y0 * h + (y - worm.y0 * h) * tail;
				const line = c.createLinearGradient(tail_x, tail_y, tx, ty);
				line.addColorStop(0, 'rgba(74,200,160,0)');
				line.addColorStop(0.77, 'rgba(100,246,191,.52)');
				line.addColorStop(1, 'rgba(208,255,225,.83)');
				c.globalAlpha = Math.min(1, settings.strand_pulse * worm.scale * head * 0.77);
				c.lineWidth = Math.max(0.32, scale * (0.65 + worm.scale * 0.45));
				c.strokeStyle = line;
				c.beginPath();
				c.moveTo(tail_x, tail_y);
				c.lineTo(tx, ty);
				c.stroke();
				paint_light(c, tx, ty, Math.max(0.8, scale * (3.3 + worm.scale * 2)),
					settings.strand_pulse * worm.scale * head * 0.48,
					'rgba(190,255,218,.59)', 'rgba(88,240,180,.24)');
			}

			paint_light(c, x, y, Math.max(1.2, scale * (9 + worm.scale * 17)),
				settings.worm_halo * intensity * 0.77,
				'rgba(102,239,182,.54)', 'rgba(62,199,164,.26)');
			paint_light(c, x, y, Math.max(0.75, scale * (2.4 + worm.scale * 3.0)),
				settings.worm_glow * intensity,
				'rgba(214,255,231,.91)', 'rgba(133,255,197,.54)');
		}
		c.globalAlpha = 1;
	};
}
