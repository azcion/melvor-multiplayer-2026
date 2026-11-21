export const controls = [
	{ key: 'fish_count', label: 'Fish', min: 0, max: 24, step: 1, value: 12 },
	{ key: 'fish_speed', label: 'Swimming speed', min: 0, max: 2.5, step: 0.05, value: 1 },
	{ key: 'fish_opacity', label: 'Fish visibility', min: 0, max: 1, step: 0.05, value: 0.75 },
	{ key: 'ray_opacity', label: 'Ray visibility', min: 0, max: 1, step: 0.05, value: 0.55 },
	{ key: 'bubbles', label: 'Bubbles per release', min: 0, max: 8, step: 1, value: 8 },
	{ key: 'bubble_speed', label: 'Bubble rise speed', min: 0, max: 2.5, step: 0.05, value: 1 },
	{ key: 'bubble_opacity', label: 'Bubble visibility', min: 0, max: 1, step: 0.05, value: 0.9 }
];

const defaults = Object.freeze(Object.fromEntries(controls.map(({ key, value }) => [key, value])));
const limits = Object.freeze(Object.fromEntries(controls.map(({ key, min, max }) => [key, [min, max]])));
const TAU = 2 * Math.PI;

// The open chasm follows the foreground pier, buttress and near ledge. Bell and
// yoke are holes so passing silhouettes disappear behind them instead of painting over bronze.
const CHASM = [
	[0.421, 0], [1, 0], [1, 1], [0.544, 1], [0.483, 0.963], [0.497, 0.891],
	[0.456, 0.729], [0.412, 0.529], [0.401, 0.482], [0.398, 0.306], [0.423, 0.309]
];
const BELL = [
	[0.779, 0.121], [0.84, 0.112], [0.837, 0.215], [0.874, 0.265],
	[0.885, 0.354], [0.891, 0.426], [0.91, 0.513], [0.921, 0.555], [0.865, 0.611],
	[0.752, 0.585], [0.669, 0.554], [0.679, 0.502], [0.729, 0.435],
	[0.736, 0.347], [0.753, 0.25], [0.791, 0.22]
];
const FAR_PIER = [
	[0.931, 0.124], [0.949, 0.125], [0.94, 0.255], [0.93, 0.365],
	[0.915, 0.489], [0.909, 0.612], [0.893, 0.597], [0.907, 0.483],
	[0.909, 0.375], [0.921, 0.255]
];

// Independent curving corridors, offset in depth. Each pass fades at its endpoints.
const FISH_PATHS = [
	{ points: [[0.39, 0.39], [0.52, 0.33], [0.67, 0.30], [0.84, 0.38]], size: 7, duration: 17, depth: 0.48 },
	{ points: [[0.96, 0.70], [0.81, 0.76], [0.64, 0.64], [0.48, 0.69]], size: 15, duration: 21, depth: 0.78 },
	{ points: [[0.42, 0.58], [0.60, 0.68], [0.80, 0.58], [1.00, 0.50]], size: 10, duration: 20, depth: 0.62 },
	{ points: [[1.01, 0.76], [0.85, 0.86], [0.66, 0.77], [0.46, 0.88]], size: 19, duration: 20, depth: 0.8 },
	{ points: [[0.42, 0.51], [0.52, 0.44], [0.70, 0.45], [0.88, 0.53]], size: 7, duration: 18, depth: 0.50 }
];
const RAY_PATH = [[1.05, 0.83], [0.88, 0.84], [0.69, 0.72], [0.49, 0.66]];
const VENTS = [
	{ x: 0.492, y: 0.862, rise: 0.27, duration: 11.8, offset: 2 },
	{ x: 0.70, y: 0.879, rise: 0.25, duration: 16.1, offset: 8.5 },
	{ x: 0.944, y: 0.943, rise: 0.20, duration: 18.3, offset: 13.2 }
];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smooth = (value) => {
	const t = clamp(value, 0, 1);
	return t * t * (3 - 2 * t);
};

function read_setting(settings, key) {
	const value = settings[key];
	return Number.isFinite(value) ? clamp(value, ...limits[key]) : defaults[key];
}

function append_polygon(context, points, width, height) {
	context.moveTo(points[0][0] * width, points[0][1] * height);
	for (let index = 1; index < points.length; index++) {
		const [x, y] = points[index];
		context.lineTo(x * width, y * height);
	}
	context.closePath();
}

function water_clip(context, width, height) {
	context.beginPath();
	append_polygon(context, CHASM, width, height);
	append_polygon(context, BELL, width, height);
	context.clip('evenodd');
	context.beginPath();
	context.rect(0, 0, width, height);
	append_polygon(context, FAR_PIER, width, height);
	context.clip('evenodd');
}

function sample_path(points, t, width, height, pose) {
	const [a, b, c, d] = points;
	const u = 1 - t;
	const first = u ** 3;
	const second = 3 * u * u * t;
	const third = 3 * u * t * t;
	const fourth = t ** 3;
	pose.x = (first * a[0] + second * b[0] + third * c[0] + fourth * d[0]) * width;
	pose.y = (first * a[1] + second * b[1] + third * c[1] + fourth * d[1]) * height;
	const dx = u * u * (b[0] - a[0]) + 2 * u * t * (c[0] - b[0]) + t * t * (d[0] - c[0]);
	const dy = u * u * (b[1] - a[1]) + 2 * u * t * (c[1] - b[1]) + t * t * (d[1] - c[1]);
	pose.angle = Math.atan2(dx < 0 ? -dy * height : dy * height, Math.abs(dx) * width);
	pose.direction = dx < 0 ? -1 : 1;
}

function draw_fish(context, pose, size, tail, alpha, depth) {
	context.save();
	context.translate(pose.x, pose.y);
	context.rotate(pose.angle);
	context.scale(pose.direction * size, size);
	context.globalAlpha = alpha;
	context.fillStyle = depth > 0.7 ? '#3a7480' : '#285a6a';
	context.beginPath();
	context.moveTo(0.49, 0.012);
	context.bezierCurveTo(0.39, -0.106, 0.14, -0.17, -0.04, -0.137);
	context.quadraticCurveTo(-0.14, -0.243, -0.26, -0.147);
	context.quadraticCurveTo(-0.38, -0.056, -0.57, tail * 0.11);
	context.lineTo(-0.81, -0.155 + tail * 0.18);
	context.quadraticCurveTo(-0.75, tail * 0.18, -0.84, 0.12 + tail * 0.18);
	context.lineTo(-0.57, tail * 0.11);
	context.quadraticCurveTo(-0.21, 0.135, -0.05, 0.12);
	context.quadraticCurveTo(0.28, 0.15, 0.49, 0.012);
	context.fill();
	context.globalAlpha = alpha * 0.34;
	context.strokeStyle = '#78b6b6';
	context.lineWidth = 0.025;
	context.beginPath();
	context.moveTo(0.27, -0.088);
	context.quadraticCurveTo(0, -0.157, -0.27, -0.095);
	context.stroke();
	context.restore();
}

function draw_ray(context, pose, size, wing, alpha) {
	context.save();
	context.translate(pose.x, pose.y);
	context.rotate(pose.angle - 0.08);
	context.scale(pose.direction * size, size);
	context.globalAlpha = alpha;
	context.fillStyle = '#061f2e';
	context.strokeStyle = '#0b2938';
	context.lineWidth = 0.046;
	context.beginPath();
	context.moveTo(-0.31, 0.013);
	context.bezierCurveTo(-0.57, 0.055, -0.71, -0.07 - wing * 0.08, -0.99, 0.004 - wing * 0.07);
	context.stroke();
	context.beginPath();
	context.moveTo(0.50, -0.013);
	context.quadraticCurveTo(0.29, -0.16, 0.05, -0.155);
	context.quadraticCurveTo(-0.087, -0.242, -0.23, -0.46 + wing * 0.13);
	context.quadraticCurveTo(-0.37, -0.34, -0.30, -0.12);
	context.lineTo(-0.45, 0.01);
	context.quadraticCurveTo(-0.29, 0.15, -0.14, 0.34 + wing * 0.17);
	context.quadraticCurveTo(0.04, 0.17, 0.24, 0.097);
	context.quadraticCurveTo(0.42, 0.066, 0.50, -0.013);
	context.fill();
	context.globalAlpha = alpha * 0.24;
	context.strokeStyle = '#548395';
	context.lineWidth = 0.025;
	context.beginPath();
	context.moveTo(-0.23, -0.40 + wing * 0.13);
	context.quadraticCurveTo(-0.05, -0.16, 0.43, -0.028);
	context.stroke();
	context.restore();
}

function draw_bubble(context, x, y, radius, alpha) {
	context.globalAlpha = alpha * 0.48;
	context.fillStyle = '#15596b';
	context.beginPath();
	context.ellipse(x, y, radius, radius * 0.91, 0.18, 0, TAU);
	context.fill();
	context.globalAlpha = alpha * 0.66;
	context.strokeStyle = '#7dced3';
	context.lineWidth = Math.max(0.4, radius * 0.21);
	context.beginPath();
	context.ellipse(x, y, radius, radius * 0.91, 0.18, -2.9, -1.3);
	context.stroke();
	context.globalAlpha = alpha * 0.32;
	context.strokeStyle = '#71becd';
	context.beginPath();
	context.ellipse(x, y, radius, radius * 0.91, 0.18, 0.04, 1.35);
	context.stroke();
}

export function create_renderer({ get_settings = () => defaults, random = Math.random } = {}) {
	const fish = Array.from({ length: limits.fish_count[1] }, (_, index) => {
		const path = FISH_PATHS[index % FISH_PATHS.length];
		const school_member = Math.floor(index / FISH_PATHS.length);
		return {
			path,
			phase: index * 1.873 + school_member * 0.41 + random() * 1.2,
			size: 0.66 + random() * 0.51,
			offset: (random() - 0.5) * 0.035,
			pace: 0.88 + random() * 0.24
		};
	});
	const bubbles = VENTS.map(() => Array.from({ length: limits.bubbles[1] }, (_, index) => ({
		delay: index * 0.25 + random() * 0.14,
		size: 0.9 + random() * 2.4,
		drift: (random() - 0.3) * 0.03,
		phase: random() * TAU
	})));
	const pose = { x: 0, y: 0, angle: 0, direction: 1 };
	let fish_time = 0;
	let bubble_time = 0;

	return ({ context, width, height, seconds }) => {
		if (width <= 0 || height <= 0) return;
		const settings = get_settings() ?? defaults;
		const dt = clamp(seconds || 0, 0, 0.05);
		const scale = width / 1280;
		fish_time += dt * read_setting(settings, 'fish_speed');
		bubble_time += dt * read_setting(settings, 'bubble_speed');
		const fish_count = Math.trunc(read_setting(settings, 'fish_count'));
		const fish_opacity = read_setting(settings, 'fish_opacity');
		const ray_opacity = read_setting(settings, 'ray_opacity');
		const bubbles_per_vent = Math.trunc(read_setting(settings, 'bubbles'));
		const bubble_opacity = read_setting(settings, 'bubble_opacity');

		context.save();
		water_clip(context, width, height);
		for (let i = 0; i < fish_count && fish_opacity > 0; i++) {
			const { path, phase, size, offset, pace } = fish[i];
			const clock = fish_time * pace + phase;
			const progress = (clock % (path.duration + 6)) / path.duration;
			if (progress >= 1) continue;
			const fade = smooth(progress * 6) * smooth((1 - progress) * 6);
			const tail = Math.sin(clock * 7.2);
			sample_path(path.points, progress, width, height, pose);
			pose.y += (offset + tail * 0.0006) * height;
			draw_fish(context, pose, path.size * size * scale, tail, fade * fish_opacity * path.depth, path.depth);
		}
		const ray_progress = ((fish_time + 4.8) % 34) / 14.5;
		if (ray_progress < 1 && ray_opacity > 0) {
			const wing = Math.sin(fish_time * 2.3);
			sample_path(RAY_PATH, ray_progress, width, height, pose);
			pose.y += wing * scale * 1.3;
			const fade = smooth(ray_progress * 6) * smooth((1 - ray_progress) * 6);
			draw_ray(context, pose, (52 - 22 * ray_progress) * scale, wing, fade * ray_opacity);
		}
		for (let vent_index = 0; vent_index < VENTS.length && bubbles_per_vent > 0 && bubble_opacity > 0; vent_index++) {
			const vent = VENTS[vent_index];
			const age = (bubble_time + vent.offset) % vent.duration;
			for (let i = 0; i < bubbles_per_vent; i++) {
				const bubble = bubbles[vent_index][i];
				const progress = (age - bubble.delay) / (5.7 + i * 0.14);
				if (progress <= 0 || progress >= 1) continue;
				const alpha = bubble_opacity * smooth(progress * 12) * smooth((1 - progress) * 4);
				const rise = progress * (0.68 + progress * 0.32);
				const x = vent.x + rise * bubble.drift + Math.sin(progress * 8 + bubble.phase) * rise * 0.009;
				const y = vent.y - vent.rise * rise;
				draw_bubble(context, x * width, y * height, bubble.size * (0.65 + rise * 0.54) * scale, alpha);
			}
		}
		context.restore();
	};
}
