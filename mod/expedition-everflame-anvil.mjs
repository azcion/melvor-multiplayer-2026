const MAX_EMBERS = 28;
const TAU = Math.PI * 2;

export const controls = [
	{ key: 'heat_intensity', label: 'Heat glow', min: 0, max: 2, step: 0.05, value: 2 },
	{ key: 'heat_speed', label: 'Heat pulse speed', min: 0, max: 3, step: 0.05, value: 1.35 },
	{ key: 'heat_spill', label: 'Warm spill', min: 0, max: 2, step: 0.05, value: 2 },
	{ key: 'ember_count', label: 'Ember density', min: 0, max: MAX_EMBERS, step: 1, value: 28 },
	{ key: 'ember_speed', label: 'Ember speed', min: 0, max: 3, step: 0.05, value: 0.7 },
	{ key: 'ember_glow', label: 'Ember brightness', min: 0, max: 2, step: 0.05, value: 2 },
	{ key: 'fog_opacity', label: 'Crevasse fog', min: 0, max: 2, step: 0.05, value: 2 },
	{ key: 'fog_speed', label: 'Fog drift speed', min: 0, max: 4, step: 0.05, value: 1.95 },
];

// Positive-space masks stop the fog at the cliff walls and below the hammer's ledge.
const CHASM_OPENINGS = [
	[[803, 332], [814, 374], [852, 400], [893, 418], [914, 450], [878, 464], [853, 476],
		[853, 508], [830, 515], [840, 541], [804, 537], [767, 546], [744, 552], [727, 560],
		[715, 577], [706, 603], [693, 596], [703, 514], [724, 445], [752, 397], [782, 368]],
	[[991, 530], [1025, 519], [1059, 506], [1086, 489], [1093, 468], [1118, 462], [1153, 455],
		[1194, 443], [1233, 437], [1259, 451], [1280, 470], [1280, 525], [1228, 512], [1193, 503],
		[1162, 519], [1143, 546], [1125, 557], [1090, 626], [1068, 654], [1049, 654], [997, 633], [981, 602]],
	[[964, 618], [998, 646], [1018, 669], [1065, 662], [1090, 646], [1115, 661], [1148, 674],
		[1197, 686], [1247, 691], [1280, 703], [1280, 720], [891, 720], [907, 685], [925, 657]]
].map(points => points.map(([x, y]) => [x / 1280, y / 720]));

const FOG_LAYERS = [
	{ y: 0.60, height: 0.21, phase: 0.16, rate: 0.019, opacity: 0.49 },
	{ y: 0.76, height: 0.24, phase: 0.51, rate: -0.027, opacity: 0.65 },
	{ y: 0.92, height: 0.26, phase: 0.78, rate: 0.013, opacity: 0.72 },
];

const FOG_WIDTH = 640;
const FOG_ART_TOP = 0.4;
const FOG_HEIGHT = 216;

const wrap = value => ((value % 1) + 1) % 1;
const smooth = t => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

function create_fog_texture(random) {
	const canvas = document.createElement('canvas');
	canvas.width = 320;
	canvas.height = 72;
	const c = canvas.getContext('2d');
	if (!c) return null;

	const octaves = [
		{ cols: 7, rows: 3, weight: 0.66 },
		{ cols: 17, rows: 6, weight: 0.24 },
		{ cols: 35, rows: 12, weight: 0.10 }
	].map(o => ({ ...o, pixels: Array.from({ length: o.cols * (o.rows + 1) }, random) }));
	const image = c.createImageData(canvas.width, canvas.height);
	for (let y = 0; y < canvas.height; y++) {
		const envelope = Math.sin(Math.PI * y / (canvas.height - 1)) ** 1.7;
		for (let x = 0; x < canvas.width; x++) {
			let noise = 0;
			for (const o of octaves) {
				const gx = x * o.cols / canvas.width;
				const gy = y * o.rows / canvas.height;
				const ix = Math.floor(gx);
				const iy = Math.floor(gy);
				const fx = smooth(gx - ix);
				const fy = smooth(gy - iy);
				const at = (dx, dy) => o.pixels[(iy + dy) * o.cols + (ix + dx) % o.cols];
				noise += o.weight * mix(mix(at(0, 0), at(1, 0), fx), mix(at(0, 1), at(1, 1), fx), fy);
			}
			const index = (y * canvas.width + x) * 4;
			image.data[index] = 119;
			image.data[index + 1] = 150;
			image.data[index + 2] = 170;
			image.data[index + 3] = Math.round(noise ** 1.5 * envelope * 189);
		}
	}
	c.putImageData(image, 0, 0);
	return canvas;
}

function create_fog_pass(random) {
	const texture = create_fog_texture(random);
	if (!texture) return null;

	const mask = document.createElement('canvas');
	const buffer = document.createElement('canvas');
	for (const canvas of [mask, buffer]) {
		canvas.width = FOG_WIDTH;
		canvas.height = FOG_HEIGHT;
	}
	const m = mask.getContext('2d');
	const c = buffer.getContext('2d');
	if (!m || !c) return null;

	// Paint only the soft shadow of the openings. Its opacity fades across the rims
	// without leaving a painted line where the source art and mask meet.
	m.shadowColor = '#000';
	m.shadowBlur = 16;
	m.shadowOffsetX = FOG_WIDTH * 2;
	const x = nx => (nx - 2) * FOG_WIDTH;
	const y = ny => (ny - FOG_ART_TOP) * FOG_HEIGHT / (1 - FOG_ART_TOP);
	m.beginPath();
	for (const points of CHASM_OPENINGS) {
		m.moveTo(x(points[0][0]), y(points[0][1]));
		for (let i = 1; i < points.length; i++) m.lineTo(x(points[i][0]), y(points[i][1]));
		m.closePath();
	}
	m.fill();
	return { buffer, context: c, mask, texture };
}

function draw_fog(target, fog, w, h, time, opacity) {
	const { buffer, context: c, mask, texture } = fog;
	const height_scale = FOG_HEIGHT / (1 - FOG_ART_TOP);
	c.clearRect(0, 0, FOG_WIDTH, FOG_HEIGHT);
	for (const layer of FOG_LAYERS) {
		const x = wrap(layer.phase + time * layer.rate) * FOG_WIDTH;
		const y = (layer.y - layer.height / 2 - FOG_ART_TOP + Math.sin(time * 0.32 + layer.phase * TAU) * 0.014) * height_scale;
		c.globalAlpha = Math.min(1, opacity * layer.opacity);
		c.drawImage(texture, x - FOG_WIDTH, y, FOG_WIDTH, layer.height * height_scale);
		c.drawImage(texture, x, y, FOG_WIDTH, layer.height * height_scale);
	}
	c.globalAlpha = 1;
	c.globalCompositeOperation = 'destination-in';
	c.drawImage(mask, 0, 0);
	c.globalCompositeOperation = 'source-over';
	target.drawImage(buffer, 0, h * FOG_ART_TOP, w, h * (1 - FOG_ART_TOP));
}

function draw_glow(c, x, y, rx, ry, angle, alpha, center, edge) {
	c.save();
	c.translate(x, y);
	c.rotate(angle);
	c.scale(rx, ry);
	const gradient = c.createRadialGradient(0, 0, 0, 0, 0, 1);
	gradient.addColorStop(0, center);
	gradient.addColorStop(0.42, edge);
	gradient.addColorStop(1, 'rgba(200,48,23,0)');
	c.fillStyle = gradient;
	c.globalAlpha = Math.min(1, alpha);
	c.fillRect(-1, -1, 2, 2);
	c.restore();
}

export function create_renderer({ get_settings = () => ({}), random = Math.random } = {}) {
	const fog = create_fog_pass(random);
	const embers = Array.from({ length: MAX_EMBERS }, () => ({
		phase: random(),
		pace: 0.16 + random() * 0.16,
		start_x: 0.13 + random() * 0.044,
		start_y: 0.27 + random() * 0.026,
		drift: 0.002 + (random() - 0.2) * 0.038,
		rise: 0.024 + random() * 0.062,
		sway: random() * TAU,
		size: 0.65 + random() * 1.1,
	}));
	const settings = {};
	let heat_time = 0;
	let ember_time = 0;
	let fog_time = 0;

	return ({ context: c, width: w, height: h, seconds }) => {
		const input = get_settings();
		for (const { key, min, max, value } of controls) {
			settings[key] = Number.isFinite(input?.[key]) ? Math.max(min, Math.min(max, input[key])) : value;
		}
		heat_time += seconds * settings.heat_speed;
		ember_time += seconds * settings.ember_speed;
		fog_time += seconds * settings.fog_speed;

		if (fog && settings.fog_opacity > 0) draw_fog(c, fog, w, h, fog_time, settings.fog_opacity);

		const breathing = 0.56 + 0.25 * Math.sin(heat_time * 1.27) + 0.13 * Math.sin(heat_time * 2.15 + 0.9);
		const shimmer = 0.91 + 0.09 * Math.sin(heat_time * 5.75);
		if (settings.heat_spill > 0) {
			draw_glow(c, w * 0.143, h * 0.253, w * 0.042, h * 0.12, 0.38,
				settings.heat_spill * breathing, 'rgba(234,80,57,.36)', 'rgba(226,61,45,.15)');
			draw_glow(c, w * 0.168, h * 0.292, w * 0.095, h * 0.055, -0.11,
				settings.heat_spill * breathing, 'rgba(237,84,53,.32)', 'rgba(231,57,32,.13)');
		}
		if (settings.heat_intensity > 0) {
			draw_glow(c, w * 0.153, h * 0.277, w * 0.039, h * 0.032, -0.08,
				settings.heat_intensity * breathing * shimmer, 'rgba(255,101,55,.66)', 'rgba(237,62,35,.31)');
			draw_glow(c, w * 0.133, h * 0.289, w * 0.016, h * 0.016, -0.19,
				settings.heat_intensity * (0.29 + 0.38 * breathing), 'rgba(255,111,74,.50)', 'rgba(232,56,33,.26)');
		}

		if (settings.ember_glow <= 0) return;
		c.save();
		c.lineCap = 'round';
		const scale = w / 1280;
		for (let i = 0; i < Math.round(settings.ember_count); i++) {
			const p = embers[i];
			const cycle = wrap(p.phase + ember_time * p.pace);
			if (cycle > 0.52) continue;
			const age = cycle / 0.52;
			const travel = 1 - (1 - age) ** 1.75;
			const x = (p.start_x + p.drift * travel + Math.sin(p.sway + age * 6) * 0.004 * age) * w;
			const y = (p.start_y - p.rise * travel) * h;
			const radius = p.size * (0.84 - age * 0.42) * scale;
			const fade = Math.min(1, age * 13) * (1 - age) ** 1.45;
			c.globalAlpha = Math.min(1, fade * settings.ember_glow * (0.61 + 0.29 * breathing));
			c.fillStyle = age < 0.45 ? '#ffab64' : '#e96e43';
			c.shadowColor = '#ee6135';
			c.shadowBlur = radius * 3;
			c.beginPath();
			c.ellipse(x, y, radius * 0.75, radius * (1.25 - age * 0.35), -p.drift * 10, 0, TAU);
			c.fill();
		}
		c.restore();
	};
}
