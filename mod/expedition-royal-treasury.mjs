export const controls = [
	{ key: 'arc_rate', label: 'Discharge rate', min: 0, max: 3, step: .05, value: 1.6 },
	{ key: 'arc_reach', label: 'Arc reach', min: .25, max: 1.6, step: .05, value: 1.6 },
	{ key: 'arc_brightness', label: 'Arc brightness', min: 0, max: 2, step: .05, value: 2 },
	{ key: 'local_glow', label: 'Ore afterglow', min: 0, max: 2, step: .05, value: 2 }
];

const defaults = Object.fromEntries(controls.map(({ key, value }) => [key, value]));

// The roots follow the painted green cracks, starting with the large near-left ore mass.
const deposits = [
	{ x: .213, y: .797, reach: .066, angle: -1.02 },
	{ x: .706, y: .562, reach: .047, angle: -1.16 },
	{ x: .936, y: .277, reach: .042, angle: -1.98 },
	{ x: .638, y: .388, reach: .030, angle: -1.35 }
];

const point_count = 9;
const lifetime = .57;

function sample(settings, index) {
	const { key, min, max, value } = controls[index];
	const input = settings[key];
	return Number.isFinite(input) ? Math.max(min, Math.min(max, input)) : value;
}

function create_shape() {
	return {
		spine: new Float32Array(point_count * 2),
		fork: new Float32Array(8),
		spur: new Float32Array(8)
	};
}

function trace_shape(shape, angle, random) {
	const along_x = Math.cos(angle);
	const along_y = Math.sin(angle);
	const normal_x = -along_y;
	const normal_y = along_x;
	for (let i = 1; i < point_count; i++) {
		const along = i / (point_count - 1);
		const offset = (random() - .5) * (.22 + along * .04);
		shape.spine[i * 2] = along_x * along + normal_x * offset;
		shape.spine[i * 2 + 1] = along_y * along + normal_y * offset;
	}
	for (let which = 0; which < 2; which++) {
		const branch = which === 0 ? shape.fork : shape.spur;
		const joint = (which === 0 ? 2 : 4) + Math.floor(random() * 2);
		const direction = along_x * (which === 0 ? -1 : 1);
		const branch_angle = angle + (direction >= 0 ? 1 : -1) * (.65 + random() * .42);
		for (let i = 0; i < 4; i++) {
			const travel = i * (which === 0 ? .112 : .077);
			const jitter = i > 0 ? (random() - .5) * .09 : 0;
			branch[i * 2] = shape.spine[joint * 2] + Math.cos(branch_angle) * travel + normal_x * jitter;
			branch[i * 2 + 1] = shape.spine[joint * 2 + 1] + Math.sin(branch_angle) * travel + normal_y * jitter;
		}
	}
}

function stroke_taper(context, points, width, opacity) {
	for (let i = 2; i < points.length; i += 2) {
		const taper = 1 - (i - 2) / (points.length - 2);
		context.lineWidth = width * (.28 + .72 * taper);
		context.globalAlpha = opacity * (.32 + .68 * taper);
		context.beginPath();
		context.moveTo(points[i - 2], points[i - 1]);
		context.lineTo(points[i], points[i + 1]);
		context.stroke();
	}
}

function draw_arc(context, shape, x, y, reach, brightness) {
	context.save();
	context.translate(x, y);
	context.scale(reach, reach);
	context.lineCap = 'round';
	context.lineJoin = 'round';
	context.strokeStyle = '#b6f74c';
	stroke_taper(context, shape.spine, .060, brightness * .38);
	stroke_taper(context, shape.fork, .039, brightness * .30);
	context.strokeStyle = '#d7ffa9';
	stroke_taper(context, shape.spine, .025, brightness);
	stroke_taper(context, shape.fork, .016, brightness * .85);
	context.strokeStyle = '#a6f9d6';
	stroke_taper(context, shape.spur, .011, brightness * .70);
	context.restore();
}

export function create_renderer({ get_settings = () => defaults, random = Math.random } = {}) {
	const shapes = Array.from({ length: 3 }, create_shape);
	let deposit_index = -1;
	let until_discharge = .62;
	let age = lifetime;

	return ({ context, width, height, seconds }) => {
		const settings = get_settings() ?? defaults;
		const rate = sample(settings, 0);
		if (rate === 0) return;
		age += seconds;
		until_discharge -= seconds * rate;
		if (until_discharge <= 0 && age >= lifetime) {
			// Move between deposits instead of synchronizing their discharges.
			deposit_index = deposit_index < 0 ? 0 :
				(deposit_index + 1 + Math.floor(random() * (deposits.length - 1))) % deposits.length;
			const { angle } = deposits[deposit_index];
			const aim = angle + (random() - .5) * .65;
			for (const shape of shapes) trace_shape(shape, aim + (random() - .5) * .35, random);
			until_discharge = 1.50 + random() * 2.85;
			age = 0;
		}
		if (age >= lifetime) return;

		const deposit = deposits[deposit_index];
		const x = deposit.x * width;
		const y = deposit.y * height;
		const reach = deposit.reach * width * sample(settings, 1);
		const brightness = sample(settings, 2);
		const glow = sample(settings, 3);
		if (glow > 0) {
			const radius = reach * .79;
			const light = context.createRadialGradient(x, y, 0, x, y, radius);
			light.addColorStop(0, 'rgba(206,247,100,.39)');
			light.addColorStop(.33, 'rgba(170,222,72,.16)');
			light.addColorStop(1, 'rgba(156,202,58,0)');
			context.save();
			context.globalCompositeOperation = 'screen';
			context.globalAlpha = Math.min(1, glow * Math.exp(-age * 5.5));
			context.fillStyle = light;
			context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
			context.restore();
		}

		// A primary flash, a break, then two progressively shorter reconnections.
		if (age < .087) draw_arc(context, shapes[0], x, y, reach, Math.min(1, brightness * (1 - age * 3)));
		else if (age > .116 && age < .176) draw_arc(context, shapes[1], x, y, reach * .84, Math.min(1, brightness * .74));
		else if (age > .206 && age < .241) draw_arc(context, shapes[2], x, y, reach * .62, Math.min(1, brightness * .42));
	};
}
