// Crystal silhouettes in the uncropped 16:9 artwork: center, tip, base, half-width.
const CRYSTALS = [
	[0.267, 0.105, 0.332, 0.013], [0.298, 0.242, 0.339, 0.008],
	[0.103, 0.378, 0.579, 0.017], [0.126, 0.491, 0.582, 0.007],
	[0.604, 0.672, 0.865, 0.013], [0.634, 0.724, 0.879, 0.011],
	[0.934, 0.219, 0.397, 0.007], [0.912, 0.288, 0.397, 0.006],
	[0.952, 0.743, 0.967, 0.018], [0.918, 0.855, 0.963, 0.011],
	[0.856, 0.897, 0.947, 0.010]
];

export const DEFAULT_GLASSROOT_SETTINGS = Object.freeze({
	haze_speed: 4, haze_opacity: 1, sparkles_per_crystal: 16, sparkle_speed: 1.8, sparkle_brightness: 1
});

export function normalize_glassroot_settings(settings = {}) {
	const bounded = (key, min, max) => Number.isFinite(settings[key])
		? Math.min(max, Math.max(min, settings[key])) : DEFAULT_GLASSROOT_SETTINGS[key];
	return {
		haze_speed: bounded('haze_speed', 0, 12), haze_opacity: bounded('haze_opacity', 0, 1),
		sparkles_per_crystal: Math.round(bounded('sparkles_per_crystal', 0, 32)),
		sparkle_speed: bounded('sparkle_speed', 0, 8), sparkle_brightness: bounded('sparkle_brightness', 0, 1)
	};
}

function create_haze_texture(random) {
	const texture = document.createElement('canvas');
	texture.width = 512; texture.height = 128;
	const context = texture.getContext('2d');
	if (!context) return null;
	const pixels = context.createImageData(texture.width, texture.height);
	const octaves = [
		{ columns: 8, rows: 4, weight: 0.6 },
		{ columns: 16, rows: 8, weight: 0.3 },
		{ columns: 32, rows: 16, weight: 0.1 }
	].map(o => ({ ...o, values: Array.from({ length: o.columns * (o.rows + 1) }, random) }));
	const smooth = t => t * t * (3 - 2 * t);
	for (let y = 0; y < texture.height; y++) {
		// Soft vertical edges; periodic noise joins seamlessly across horizontal tiles.
		const envelope = Math.pow(Math.sin(Math.PI * y / (texture.height - 1)), 2);
		for (let x = 0; x < texture.width; x++) {
			let noise = 0;
			for (const o of octaves) {
				const gx = x / texture.width * o.columns, gy = y / texture.height * o.rows;
				const column = Math.floor(gx), row = Math.floor(gy);
				const fx = smooth(gx - column), fy = smooth(gy - row);
				const at = (dx, dy) => o.values[(row + dy) * o.columns + (column + dx) % o.columns];
				const top = at(0, 0) * (1 - fx) + at(1, 0) * fx;
				const bottom = at(0, 1) * (1 - fx) + at(1, 1) * fx;
				noise += (top * (1 - fy) + bottom * fy) * o.weight;
			}
			const index = (y * texture.width + x) * 4;
			pixels.data[index] = 173; pixels.data[index + 1] = 219; pixels.data[index + 2] = 212;
			pixels.data[index + 3] = Math.round(Math.pow(noise, 1.7) * envelope * 255);
		}
	}
	context.putImageData(pixels, 0, 0);
	return texture;
}

export function create_glassroot_renderer({ create_facet_glint_renderer, random = Math.random,
	get_settings = () => DEFAULT_GLASSROOT_SETTINGS }) {
	// Generate a small reusable fog texture once, rather than noise or blur per frame.
	const texture = create_haze_texture(random);
	// Interleave crystals so every density setting illuminates all eleven silhouettes.
	const facets = Array.from({ length: 32 }, () => CRYSTALS.map(([x, top, bottom, half_width]) => {
		const depth = 0.12 + random() * 0.83;
		return [x + (random() * 2 - 1) * half_width * Math.min(1, depth * 4), top + depth * (bottom - top)];
	})).flat();
	let settings = normalize_glassroot_settings(get_settings());
	const glints = create_facet_glint_renderer(facets, random, () => ({
		count: settings.sparkles_per_crystal * CRYSTALS.length,
		speed: settings.sparkle_speed, brightness: settings.sparkle_brightness
	}));
	const layers = [
		{ y: 0.40, height: 0.22, speed: 0.008, phase: 0.13, opacity: 0.42 },
		{ y: 0.58, height: 0.32, speed: -0.011, phase: 0.57, opacity: 0.56 },
		{ y: 0.79, height: 0.38, speed: 0.006, phase: 0.31, opacity: 0.65 }
	];
	let elapsed = 0;
	return ({ context: c, width, height, seconds }) => {
		settings = normalize_glassroot_settings(get_settings());
		elapsed += seconds * settings.haze_speed;
		if (texture) {
			for (const layer of layers) {
				const offset = ((layer.phase + elapsed * layer.speed) % 1 + 1) % 1 * width;
				const top = (layer.y - layer.height / 2 + Math.sin(elapsed * 0.13 + layer.phase * 6) * 0.012) * height;
				c.globalAlpha = settings.haze_opacity * layer.opacity * (0.92 + Math.sin(elapsed * 0.17 + layer.phase * 6) * 0.08);
				c.drawImage(texture, offset - width, top, width, layer.height * height);
				c.drawImage(texture, offset, top, width, layer.height * height);
			}
		}
		glints({ context: c, width, height, seconds });
	};
}
