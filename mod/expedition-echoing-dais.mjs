export const controls = [
	{ key: 'bat_count', label: 'Bats per flight', min: 0, max: 7, step: 1, value: 7 },
	{ key: 'flight_interval', label: 'Time between flights', min: 4, max: 24, step: .5, value: 4 },
	{ key: 'flight_speed', label: 'Flight speed', min: .4, max: 2, step: .05, value: .65 },
	{ key: 'bat_size', label: 'Bat size', min: .45, max: 1.8, step: .05, value: .45 },
	{ key: 'silhouette_opacity', label: 'Silhouette opacity', min: 0, max: 1, step: .05, value: .95 }
];

const defaults = Object.fromEntries(controls.map(({ key, value }) => [key, value]));
const flight_seconds = 4.4;

// Fly through the empty shaft or across the far hazy galleries, fading into their shadows.
const paths = [
	{ x: [.496, .615, .750, .852], y: [.354, .206, .311, .174], depth: [.88, .43] },
	{ x: [.924, .815, .663, .558], y: [.166, .170, .284, .407], depth: [.43, .70] },
	{ x: [.487, .611, .699, .714], y: [.294, .326, .460, .609], depth: [.66, .32] }
];

function sample(settings, index) {
	const { key, min, max, value } = controls[index];
	const input = settings[key];
	return Number.isFinite(input) ? Math.max(min, Math.min(max, input)) : value;
}

function cubic(points, t) {
	const rest = 1 - t;
	return rest ** 3 * points[0] + 3 * rest ** 2 * t * points[1] + 3 * rest * t ** 2 * points[2] + t ** 3 * points[3];
}

function tangent(points, t) {
	const rest = 1 - t;
	return 3 * (rest ** 2 * (points[1] - points[0]) + 2 * rest * t * (points[2] - points[1]) + t ** 2 * (points[3] - points[2]));
}

function smoothstep(value) {
	const t = Math.max(0, Math.min(1, value));
	return t * t * (3 - 2 * t);
}

function draw_wing(context, side, flap, bank) {
	const relative_lift = flap * .43 - side * bank * .15;
	const span = side * (1 - Math.abs(flap) * .20 + side * bank * .10);
	const wrist = -.24 + relative_lift * .58;
	const tip = -.11 + relative_lift;
	context.moveTo(side * .084, -.055);
	context.quadraticCurveTo(span * .26, wrist - .11, span * .55, wrist);
	context.quadraticCurveTo(span * .79, wrist - .035, span, tip);
	context.quadraticCurveTo(span * .80, tip + .012, span * .74, tip + .19);
	context.quadraticCurveTo(span * .63, tip + .06, span * .50, tip + .255);
	context.quadraticCurveTo(span * .39, tip + .125, span * .29, tip + .31);
	context.quadraticCurveTo(span * .19, relative_lift * .26 + .16, side * .055, .255);
	context.closePath();
}

function draw_bat(context, x, y, size, direction, bank, flap, depth, opacity) {
	context.save();
	context.translate(x, y);
	context.rotate(direction);
	context.scale(size, size);
	context.globalAlpha = opacity;
	context.fillStyle = depth > .70 ? '#101721' : '#19222e';
	context.beginPath();
	draw_wing(context, -1, flap, bank);
	draw_wing(context, 1, flap, bank);
	context.moveTo(-.07, -.115);
	context.lineTo(-.09, -.32);
	context.lineTo(-.025, -.224);
	context.lineTo(.025, -.224);
	context.lineTo(.09, -.32);
	context.lineTo(.07, -.115);
	context.quadraticCurveTo(.17, .04, .05, .265);
	context.lineTo(0, .34);
	context.lineTo(-.05, .265);
	context.quadraticCurveTo(-.17, .04, -.07, -.115);
	context.closePath();
	context.fill();
	context.restore();
}

export function create_renderer({ get_settings = () => defaults, random = Math.random } = {}) {
	const flock = Array.from({ length: 7 }, (_, index) => ({
		delay: index * .21 + random() * .12,
		y_offset: (random() - .5) * .070,
		x_offset: (random() - .5) * .044,
		scale: .76 + random() * .42,
		flap_phase: random() * Math.PI * 2,
		flap_rate: 4.6 + random() * 1.3
	}));
	let real_time = 0;
	let flight_time = 0;
	let launch_at = .75;
	let pass = -1;
	let in_flight = false;

	return ({ context, width, height, seconds }) => {
		const settings = get_settings() ?? defaults;
		const count = Math.round(sample(settings, 0));
		const interval = sample(settings, 1);
		const speed = sample(settings, 2);
		const size = sample(settings, 3);
		const opacity = sample(settings, 4);
		real_time += seconds;
		if (in_flight) flight_time += seconds * speed;
		if (flight_time >= flight_seconds + flock.at(-1).delay) in_flight = false;
		if (real_time >= launch_at && !in_flight) {
			pass = (pass + 1) % paths.length;
			in_flight = true;
			flight_time = 0;
			launch_at = real_time + interval * (.85 + random() * .33);
		}
		if (!in_flight || count === 0 || opacity === 0) return;

		const path = paths[pass];
		for (let i = 0; i < count; i++) {
			const bat = flock[i];
			const phase = (flight_time - bat.delay) / flight_seconds;
			if (phase <= 0 || phase >= 1) continue;
			const t = phase ** 1.20;
			const depth = path.depth[0] + (path.depth[1] - path.depth[0]) * t;
			const flap_phase = (flight_time - bat.delay) * Math.PI * 2 * bat.flap_rate + bat.flap_phase;
			const glide = .63 + .37 * Math.sin(phase * Math.PI * 3 + bat.flap_phase) ** 2;
			const envelope = smoothstep(phase / .11) * smoothstep((1 - phase) / .23);
			const x = cubic(path.x, t) + bat.x_offset * (.4 + .6 * Math.sin(t * Math.PI));
			const y = cubic(path.y, t) + bat.y_offset * (.4 + .6 * Math.sin(t * Math.PI)) + Math.sin(flap_phase) * .002;
			const dx = tangent(path.x, t);
			const dy = tangent(path.y, t);
			const bank = Math.max(-.75, Math.min(.75, dy / Math.max(.1, Math.abs(dx)) * .55));
			const pitch = Math.atan2(dy * height, Math.abs(dx) * width);
			const direction = Math.sign(dx) * (.25 + pitch * .58);
			const radius = Math.max(2, width * (.0049 + depth * .010) * bat.scale * size);
			draw_bat(context, x * width, y * height, radius, direction, bank, Math.sin(flap_phase) * glide,
				depth, opacity * envelope * (.64 + depth * .32));
		}
	};
}
