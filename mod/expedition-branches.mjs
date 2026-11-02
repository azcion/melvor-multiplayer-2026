// Tunable atmosphere for the new 1.7.0 branches. Coordinates use uncropped 16:9 art.
// No work-driven light is baked in here: these are water reflections, dust and furnace embers.
const SCENES = Object.freeze({
	drowned_cloister: {
		color: '#83c8c7',
		water: true,
		polygon: [
			[0.24, 0.58],
			[1, 0.54],
			[1, 1],
			[0.4, 1],
			[0.34, 0.82],
			[0.2, 0.76],
		],
		count: 28,
	},
	rootforge_passage: {
		color: '#e3a575',
		sources: [
			[0.3, 0.56],
			[0.8, 0.49],
		],
		count: 18,
	},
	embervein_machinery: {
		color: '#e3a575',
		sources: [
			[0.29, 0.76],
			[0.5, 0.81],
			[0.82, 0.87],
		],
		count: 24,
	},
	mossbound_reliquary: {
		color: '#c6d6ac',
		sources: [
			[0.59, 0.2],
			[0.79, 0.2],
		],
		count: 26,
		dust: true,
	},
});
export const DEFAULT_BRANCH_SETTINGS = Object.freeze({
	density: 1,
	speed: 1,
	brightness: 0.6,
	reflection_width: 1,
	reflection_height: 1,
	drift: 1,
});
export const DROWNED_CLOISTER_SETTINGS = Object.freeze({
	density: 2.2,
	speed: 1,
	brightness: 1.8,
	reflection_width: 12.3,
	reflection_height: 0.9,
	drift: 10,
});
export function normalize_branch_settings(settings = {}) {
	return Object.fromEntries(
		Object.entries(DEFAULT_BRANCH_SETTINGS).map(([key, value]) => [
			key,
			Number.isFinite(settings[key])
				? Math.max(
						0,
						Math.min(
							{
								density: 40,
								speed: 30,
								brightness: 8,
								reflection_width: 30,
								reflection_height: 30,
								drift: 30,
							}[key],
							settings[key],
						),
					)
				: value,
		]),
	);
}
function create_basic_branch_renderer(
	scene_id,
	{
		random = Math.random,
		get_settings = () =>
			scene_id === 'tideworn_crypts'
				? DEFAULT_FOG_SETTINGS
				: scene_id === 'drowned_cloister'
					? DROWNED_CLOISTER_SETTINGS
					: DEFAULT_BRANCH_SETTINGS,
	} = {},
) {
	if (scene_id === 'tideworn_crypts') return create_fog_renderer({ random, get_settings });
	const scene = SCENES[scene_id];
	if (!scene) throw new Error(`Unknown Expedition atmosphere: ${scene_id}`);
	const particles = Array.from({ length: scene.count * 40 }, (_, index) => ({
		x: random(),
		y: random(),
		phase: random(),
		period: 4 + random() * 6,
		source: scene.sources?.[index % scene.sources.length],
	}));
	let elapsed = 0;
	return ({ context: c, width: w, height: h, seconds }) => {
		const s = normalize_branch_settings(get_settings());
		elapsed += seconds * s.speed;
		c.save();
		if (scene.polygon) {
			c.beginPath();
			scene.polygon.forEach(([x, y], i) => (i ? c.lineTo(x * w, y * h) : c.moveTo(x * w, y * h)));
			c.closePath();
			c.clip();
		}
		c.fillStyle = scene.color;
		for (let i = 0; i < Math.floor(scene.count * s.density); i++) {
			const p = particles[i],
				t = (elapsed / p.period + p.phase) % 1;
			c.globalAlpha = Math.min(1, Math.sin(t * Math.PI) * s.brightness * (scene.water ? 0.25 : 0.5));
			if (scene.water) {
				const y = 0.54 + p.y * 0.46;
				c.fillRect(
					(p.x + Math.sin(elapsed * 0.15 + p.phase) * 0.012 * s.drift) * w,
					y * h,
					(((2 + p.y * 6) * w) / 1280) * s.reflection_width,
					Math.max(0.5, h / 900) * s.reflection_height,
				);
			} else {
				const [sx, sy] = p.source;
				const x = (sx + (p.x - 0.5) * 0.1 + Math.sin(elapsed * 0.3 + p.phase) * 0.008) * w;
				const y = (sy + (scene.dust ? p.y * 0.36 : -t * 0.1)) * h;
				c.beginPath();
				c.arc(x, y, Math.max(0.35, w / 1600), 0, Math.PI * 2);
				c.fill();
			}
		}
		c.restore();
	};
}

export const DEFAULT_FOG_SETTINGS = Object.freeze({
	density: 3,
	opacity: 0.35,
	speed: 10.4,
	spread: 1.82,
	middle_strength: 1,
	right_strength: 1.15,
	vertical_position: 0.22,
	drift: 0.8,
	ghost_count: 10,
	ghost_opacity: 0.325,
	ghost_size: 0.75,
	ghost_speed: 2.2,
});
const LIMITS = {
	density: 12,
	opacity: 4,
	speed: 30,
	spread: 3,
	middle_strength: 5,
	right_strength: 5,
	vertical_position: 1,
	drift: 10,
	ghost_count: 24,
	ghost_opacity: 1,
	ghost_size: 6,
	ghost_speed: 15,
};
export function normalize_fog_settings(s = {}) {
	return Object.fromEntries(
		Object.entries(DEFAULT_FOG_SETTINGS).map(([k, v]) => [
			k,
			Number.isFinite(s[k]) ? Math.max(0, Math.min(LIMITS[k], s[k])) : v,
		]),
	);
}
export function create_fog_renderer({
	get_settings = () => DEFAULT_FOG_SETTINGS,
	random = Math.random,
} = {}) {
	// Cache a soft cloud once. Every sprite has transparent edges; no per-frame blur or texture allocation.
	const texture = document.createElement('canvas');
	texture.width = 256;
	texture.height = 128;
	const tc = texture.getContext('2d');
	for (let i = 0; i < 60; i++) {
		const x = 40 + random() * 176,
			y = 25 + random() * 78,
			r = 15 + random() * 30;
		const g = tc.createRadialGradient(x, y, 0, x, y, r);
		g.addColorStop(0, 'rgba(175,197,201,.16)');
		g.addColorStop(1, 'rgba(175,197,201,0)');
		tc.fillStyle = g;
		tc.fillRect(x - r, y - r, r * 2, r * 2);
	}
	const patches = Array.from({ length: 96 }, (_, i) => ({
		right: i % 2 === 0,
		x: random(),
		y: random(),
		phase: random() * Math.PI * 2,
		scale: 0.7 + random() * 0.6,
	}));
	// A faceless suggestion of head, shoulders and a dissolving robe; cached soft edges.
	const ghost = document.createElement('canvas');
	ghost.width = 128;
	ghost.height = 256;
	const gc = ghost.getContext('2d');
	function glow(x, y, rx, ry, alpha) {
		gc.save();
		gc.translate(x, y);
		gc.scale(rx, ry);
		const g = gc.createRadialGradient(0, 0, 0, 0, 0, 1);
		g.addColorStop(0, `rgba(213,231,228,${alpha})`);
		g.addColorStop(0.5, `rgba(191,214,212,${alpha * 0.55})`);
		g.addColorStop(1, 'rgba(191,214,212,0)');
		gc.fillStyle = g;
		gc.fillRect(-1, -1, 2, 2);
		gc.restore();
	}
	glow(64, 44, 19, 28, 0.9);
	glow(64, 100, 38, 46, 0.65);
	for (let i = 0; i < 7; i++) glow(64 + Math.sin(i * 0.9) * 4, 115 + i * 15, 32 - i * 3, 35, 0.3 - i * 0.035);
	const ghosts = Array.from({ length: 24 }, () => ({
		x: random(),
		y: random(),
		phase: random(),
		period: 22 + random() * 24,
		scale: 0.65 + random() * 0.7,
		direction: random() < 0.5 ? -1 : 1,
	}));
	let elapsed = 0,
		ghost_time = 0;
	return ({ context: c, width: w, height: h, seconds }) => {
		const s = normalize_fog_settings(get_settings());
		elapsed += seconds * s.speed;
		ghost_time += seconds * s.ghost_speed;
		c.save();
		for (let i = 0; i < Math.floor(s.density * 8); i++) {
			const p = patches[i],
				strength = p.right ? s.right_strength : s.middle_strength;
			const center = p.right ? 0.85 : 0.52;
			const x = center + (p.x - 0.5) * 0.28 * s.spread + Math.sin(elapsed * 0.07 + p.phase) * 0.06 * s.drift;
			const y =
				s.vertical_position +
				(p.right ? -0.1 : 0.06) +
				(p.y - 0.5) * 0.22 * s.spread +
				Math.sin(elapsed * 0.045 + p.phase) * 0.025 * s.drift;
			const sw = w * 0.48 * p.scale * s.spread,
				sh = h * 0.34 * p.scale * s.spread;
			c.globalAlpha = Math.min(1, s.opacity * strength * (0.75 + 0.25 * Math.sin(elapsed * 0.12 + p.phase)));
			if (sw > 0 && sh > 0) c.drawImage(texture, x * w - sw / 2, y * h - sh / 2, sw, sh);
		}
		for (let i = 0; i < Math.floor(s.ghost_count); i++) {
			const g = ghosts[i],
				t = (ghost_time / g.period + g.phase) % 1;
			const fade = Math.pow(Math.sin(t * Math.PI), 3);
			const x = 0.4 + g.x * 0.54 + (t - 0.5) * 0.18 * g.direction;
			const y = s.vertical_position - 0.05 + g.y * 0.18 + Math.sin(t * Math.PI * 2 + g.phase * 6) * 0.025;
			const gh = h * 0.28 * g.scale * s.ghost_size,
				gw = gh * 0.5 * (0.88 + 0.12 * Math.sin(ghost_time * 0.3 + g.phase * 6));
			c.globalAlpha = s.ghost_opacity * fade;
			// Narrow horizontal strips gently disagree, making the figure shift like a fog impression.
			for (let strip = 0; strip < 16; strip++) {
				const bend = Math.sin(ghost_time * 0.35 + strip * 0.38 + g.phase * 6) * gw * 0.055 * (strip / 16);
				if (gw > 0 && gh > 0)
					c.drawImage(
						ghost,
						0,
						strip * 16,
						128,
						16,
						x * w - gw / 2 + bend,
						y * h - gh * 0.25 + (strip * gh) / 16,
						gw,
						gh / 16 + 0.3,
					);
			}
		}
		c.restore();
	};
}

export const DEFAULT_ROOTFORGE_SETTINGS = Object.freeze({
	heat_strength: 1.9,
	heat_speed: 0.9,
	smoke_density: 7,
	smoke_opacity: 0.44,
	smoke_size: 1.75,
	smoke_speed: 1.4,
	glow_strength: 1.28,
	glow_speed: 0.3,
	ember_count: 40,
	ember_brightness: 0.65,
	ember_speed: 0.5,
});
const ROOTFORGE_LIMITS = {
	heat_strength: 40,
	heat_speed: 20,
	smoke_density: 20,
	smoke_opacity: 2,
	smoke_size: 4,
	smoke_speed: 15,
	glow_strength: 3,
	glow_speed: 15,
	ember_count: 1000,
	ember_brightness: 4,
	ember_speed: 20,
};
export function normalize_rootforge_settings(s = {}) {
	return Object.fromEntries(
		Object.entries(DEFAULT_ROOTFORGE_SETTINGS).map(([k, v]) => [
			k,
			Number.isFinite(s[k]) ? Math.max(0, Math.min(ROOTFORGE_LIMITS[k], s[k])) : v,
		]),
	);
}
export function create_rootforge_renderer({
	image,
	get_settings,
	random = Math.random,
	scene = 'rootforge_passage',
}) {
	const smoke = document.createElement('canvas');
	smoke.width = 128;
	smoke.height = 128;
	const sc = smoke.getContext('2d');
	for (let i = 0; i < 30; i++) {
		const x = 35 + random() * 58,
			y = 35 + random() * 58,
			r = 15 + random() * 22;
		const g = sc.createRadialGradient(x, y, 0, x, y, r);
		g.addColorStop(0, 'rgba(19,17,14,.25)');
		g.addColorStop(1, 'rgba(19,17,14,0)');
		sc.fillStyle = g;
		sc.fillRect(x - r, y - r, r * 2, r * 2);
	}
	const clouds = Array.from({ length: 120 }, () => ({
		phase: random(),
		side: random() < 0.5 ? 0 : 1,
		x: random(),
		scale: 0.7 + random() * 0.6,
	}));
	const embers = Array.from({ length: 1000 }, () => ({
		phase: random(),
		x: random(),
		depth: random(),
		period: 3 + random() * 6,
	}));
	const machinery = scene === 'embervein_machinery';
	const zones = machinery
		? [
				[0.12, 0.5, 0.23, 0.3],
				[0.4, 0.57, 0.18, 0.43],
				[0.72, 0.53, 0.22, 0.47],
			]
		: [
				[0.22, 0.28, 0.18, 0.33],
				[0.66, 0.22, 0.3, 0.31],
				[0.43, 0.63, 0.17, 0.37],
				[0.76, 0.64, 0.2, 0.36],
			];
	let heat = 0,
		smokeTime = 0,
		glow = 0,
		fire = 0;
	return ({ context: c, width: w, height: h, seconds }) => {
		const s = normalize_rootforge_settings(get_settings());
		heat += seconds * s.heat_speed;
		smokeTime += seconds * s.smoke_speed;
		glow += seconds * s.glow_speed;
		fire += seconds * s.ember_speed;
		c.save();
		const artwork = image ?? c.canvas?.parentElement?.parentElement?.querySelector('img');
		if (artwork?.complete && artwork.naturalWidth && s.heat_strength > 0) {
			for (const [zx, zy, zw, zh] of zones) {
				c.save();
				// Fade the top and bottom of each distortion region.
				for (let row = 0; row < Math.ceil(zh * h); row += 3) {
					const y = zy * h + row;
					const envelope = Math.sin((row / (zh * h)) * Math.PI);
					const dx = Math.sin(y * 0.065 - heat * 3) * s.heat_strength * (w / 1280) * envelope;
					const stripH = Math.min(3, zh * h - row);
					c.globalAlpha = envelope * 0.65;
					c.drawImage(
						artwork,
						zx * artwork.naturalWidth,
						(y / h) * artwork.naturalHeight,
						zw * artwork.naturalWidth,
						(stripH / h) * artwork.naturalHeight,
						zx * w + dx,
						y,
						zw * w,
						stripH,
					);
				}
				c.restore();
			}
		}
		c.globalCompositeOperation = 'screen';
		for (const [x, y, rx, ry] of machinery
			? [
					[0.2, 0.7, 0.23, 0.3],
					[0.48, 0.82, 0.18, 0.32],
					[0.85, 0.78, 0.22, 0.37],
				]
			: [
					[0.29, 0.53, 0.18, 0.25],
					[0.8, 0.46, 0.15, 0.29],
					[0.61, 0.87, 0.3, 0.28],
				]) {
			const pulse = 0.65 + 0.18 * Math.sin(glow * 1.8 + x * 12) + 0.12 * Math.sin(glow * 4.3 + y * 9);
			c.globalAlpha = Math.min(1, s.glow_strength * pulse);
			c.save();
			c.translate(x * w, y * h);
			c.scale(rx * w, ry * h);
			const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
			g.addColorStop(0, 'rgba(255,123,25,.65)');
			g.addColorStop(1, 'rgba(255,79,8,0)');
			c.fillStyle = g;
			c.fillRect(-1, -1, 2, 2);
			c.restore();
		}
		c.globalCompositeOperation = 'source-over';
		for (let i = 0; i < Math.floor(s.smoke_density * 6); i++) {
			const p = clouds[i],
				t = (smokeTime * 0.045 + p.phase) % 1;
			const x =
				(machinery ? (p.side ? 0.84 : 0.23) : p.side ? 0.8 : 0.29) +
				(p.x - 0.5) * 0.14 +
				Math.sin(t * 4 + p.phase * 8) * 0.05;
			const y = (machinery ? 0.8 : p.side ? 0.48 : 0.56) - t * 0.65;
			const size = (0.11 + t * 0.28) * p.scale * s.smoke_size;
			c.globalAlpha = Math.min(1, s.smoke_opacity * Math.pow(Math.sin(t * Math.PI), 0.7));
			c.drawImage(smoke, (x - size / 2) * w, (y - size * 0.6) * h, size * w, size * h);
		}
		c.globalCompositeOperation = 'screen';
		c.fillStyle = '#ffb65a';
		for (let i = 0; i < Math.floor(s.ember_count); i++) {
			const p = embers[i],
				t = (fire / p.period + p.phase) % 1;
			const x = 0.23 + p.x * 0.71 + Math.sin(t * 5 + p.phase * 8) * 0.025;
			const y = 0.96 - t * (0.25 + p.depth * 0.55);
			c.globalAlpha = Math.min(1, Math.sin(t * Math.PI) * s.ember_brightness);
			const size = ((0.5 + p.depth * 1.5) * w) / 1280;
			c.beginPath();
			c.ellipse(x * w, y * h, size, size * (1.2 + p.depth), -0.2, 0, Math.PI * 2);
			c.fill();
		}
		c.restore();
	};
}

export const DEFAULT_MOSS_SETTINGS = Object.freeze({
	window_fog_density: 3.8,
	window_fog_opacity: 0.23,
	window_fog_brightness: 0.41,
	window_fog_size: 2.4,
	window_fog_speed: 8,
	firefly_count: 128,
	firefly_brightness: 3.82,
	firefly_speed: 1,
	firefly_size: 0.8,
	drip_count: 16,
	drip_speed: 3.4,
	drip_brightness: 0.56,
	drip_length: 1,
	mist_opacity: 0.25,
	mist_speed: 6.3,
});
const MOSS_LIMITS = {
	window_fog_density: 20,
	window_fog_opacity: 3,
	window_fog_brightness: 1,
	window_fog_size: 4,
	window_fog_speed: 20,
	firefly_count: 500,
	firefly_brightness: 4,
	firefly_speed: 20,
	firefly_size: 8,
	drip_count: 1000,
	drip_speed: 15,
	drip_brightness: 4,
	drip_length: 12,
	mist_opacity: 3,
	mist_speed: 20,
};
export function normalize_moss_settings(s = {}) {
	return Object.fromEntries(
		Object.entries(DEFAULT_MOSS_SETTINGS).map(([k, v]) => [
			k,
			Number.isFinite(s[k]) ? Math.max(0, Math.min(MOSS_LIMITS[k], s[k])) : v,
		]),
	);
}
export function create_moss_renderer({ get_settings, random = Math.random }) {
	// Cache a neutral cloud with transparent outer edges; tint once when the brightness control changes.
	const cloud = document.createElement('canvas');
	cloud.width = 256;
	cloud.height = 128;
	const mc = cloud.getContext('2d');
	for (let i = 0; i < 70; i++) {
		const x = 45 + random() * 166,
			y = 35 + random() * 58,
			r = 15 + random() * 28;
		const g = mc.createRadialGradient(x, y, 0, x, y, r);
		g.addColorStop(0, 'rgba(255,255,255,.15)');
		g.addColorStop(1, 'rgba(255,255,255,0)');
		mc.fillStyle = g;
		mc.fillRect(x - r, y - r, r * 2, r * 2);
	}
	const tint = document.createElement('canvas');
	tint.width = 256;
	tint.height = 128;
	const tc = tint.getContext('2d');
	let lastBrightness = -1;
	const flies = Array.from({ length: 500 }, () => ({
		x: random(),
		y: random(),
		phase: random() * 6.28,
		period: 3 + random() * 6,
		depth: 0.5 + random() * 0.8,
	}));
	const drips = Array.from({ length: 1000 }, () => ({
		x: random(),
		phase: random(),
		depth: random(),
		period: 1.4 + random() * 3.5,
	}));
	const fog = Array.from({ length: 120 }, (_, i) => ({
		right: i % 2 === 0,
		x: random(),
		y: random(),
		phase: random() * 6.28,
		size: 0.7 + random() * 0.6,
	}));
	let fogTime = 0,
		flyTime = 0,
		rainTime = 0,
		haze = 0;
	return ({ context: c, width: w, height: h, seconds }) => {
		const s = normalize_moss_settings(get_settings());
		fogTime += seconds * s.window_fog_speed;
		flyTime += seconds * s.firefly_speed;
		rainTime += seconds * s.drip_speed;
		haze += seconds * s.mist_speed;
		c.save();
		if (lastBrightness !== s.window_fog_brightness) {
			lastBrightness = s.window_fog_brightness;
			tc.clearRect(0, 0, 256, 128);
			tc.globalCompositeOperation = 'source-over';
			tc.drawImage(cloud, 0, 0);
			tc.globalCompositeOperation = 'source-in';
			const v = Math.round(15 + lastBrightness * 220);
			tc.fillStyle = `rgb(${v},${Math.round(v * 1.04)},${Math.round(v * 0.92)})`;
			tc.fillRect(0, 0, 256, 128);
			tc.globalCompositeOperation = 'source-over';
		}
		for (let i = 0; i < Math.floor(s.window_fog_density * 6); i++) {
			const p = fog[i],
				x = (p.right ? 0.79 : 0.59) + (p.x - 0.5) * 0.12 + Math.sin(fogTime * 0.09 + p.phase) * 0.025,
				y = 0.13 + (p.y - 0.5) * 0.16 + Math.sin(fogTime * 0.07 + p.phase) * 0.025;
			const sw = w * 0.28 * p.size * s.window_fog_size,
				sh = h * 0.39 * p.size * s.window_fog_size;
			c.globalAlpha = Math.min(1, s.window_fog_opacity);
			if (sw > 0 && sh > 0) c.drawImage(tint, x * w - sw / 2, y * h - sh / 2, sw, sh);
		}
		// Each band is a periodic train of identical soft tiles. Both copies remain present at the wrap.
		for (let layer = 0; s.mist_opacity > 0 && layer < 3; layer++) {
			const tileW = w * 0.85,
				offset = ((((haze * 0.012 * (layer % 2 ? -1 : 1) + layer * 0.31) % 1) + 1) % 1) * tileW;
			const y = (0.7 + layer * 0.035 + Math.sin(haze * 0.08 + layer) * 0.015) * h;
			c.globalAlpha = Math.min(1, s.mist_opacity * 0.7);
			for (let tile = -1; tile < 3; tile++) c.drawImage(cloud, offset + tile * tileW, y, tileW, h * 0.24);
		}
		c.strokeStyle = '#bbd6d1';
		c.lineCap = 'round';
		for (let i = 0; i < Math.floor(s.drip_count); i++) {
			const p = drips[i],
				t = (rainTime / p.period + p.phase) % 1;
			const y = -0.03 + t * t * 1.12,
				x = p.x + Math.sin(p.phase * 6) * 0.003 * t;
			const length = (0.008 + p.depth * 0.014) * s.drip_length * h;
			c.globalAlpha = Math.min(1, s.drip_brightness * (0.25 + p.depth * 0.65) * Math.min(1, t * 10));
			c.lineWidth = ((0.6 + p.depth * 0.9) * w) / 1280;
			c.beginPath();
			c.moveTo(x * w, y * h);
			c.lineTo(x * w, y * h + length);
			c.stroke();
		}
		c.globalCompositeOperation = 'screen';
		for (let i = 0; i < Math.floor(s.firefly_count); i++) {
			const p = flies[i],
				x = p.x + Math.sin(flyTime * 0.28 + p.phase) * 0.025,
				y = 0.25 + p.y * 0.65 + Math.sin(flyTime * 0.19 + p.phase * 2) * 0.02;
			const blink = Math.pow(Math.max(0, Math.sin((flyTime * 6.28) / p.period + p.phase)), 4),
				alpha = Math.min(1, s.firefly_brightness * blink);
			const r = (1.1 * p.depth * s.firefly_size * w) / 1280;
			if (r <= 0 || alpha < 0.005) continue;
			c.globalAlpha = alpha * 0.18;
			c.fillStyle = '#c9f26b';
			c.beginPath();
			c.arc(x * w, y * h, r * 4, 0, Math.PI * 2);
			c.fill();
			c.globalAlpha = alpha;
			c.fillStyle = '#edffb4';
			c.beginPath();
			c.arc(x * w, y * h, r, 0, Math.PI * 2);
			c.fill();
		}
		c.restore();
	};
}

export const DEFAULT_CLOISTER_SETTINGS = Object.freeze({
	density: 2.2,
	speed: 1,
	brightness: 1.8,
	reflection_width: 12.3,
	reflection_height: 0.9,
	drift: 10,
	arch_fog_density: 3,
	arch_fog_opacity: 0.08,
	arch_fog_brightness: 1,
	arch_fog_size: 4,
	arch_fog_speed: 17.8,
	drip_count: 33,
	drip_speed: 2,
	drip_brightness: 0.5,
	drip_length: 1,
});
const CLOISTER_LIMITS = {
	density: 40,
	speed: 30,
	brightness: 8,
	reflection_width: 30,
	reflection_height: 30,
	drift: 30,
	arch_fog_density: 20,
	arch_fog_opacity: 3,
	arch_fog_brightness: 1,
	arch_fog_size: 4,
	arch_fog_speed: 20,
	drip_count: 1000,
	drip_speed: 15,
	drip_brightness: 4,
	drip_length: 12,
};
export function normalize_cloister_settings(s = {}) {
	return Object.fromEntries(
		Object.entries(DEFAULT_CLOISTER_SETTINGS).map(([k, v]) => [
			k,
			Number.isFinite(s[k]) ? Math.max(0, Math.min(CLOISTER_LIMITS[k], s[k])) : v,
		]),
	);
}
export function create_cloister_renderer({ get_settings }) {
	const water = create_basic_branch_renderer('drowned_cloister', { get_settings });
	const atmosphere = create_moss_renderer({
		get_settings: () => {
			const s = get_settings();
			return {
				...s,
				window_fog_density: s.arch_fog_density,
				window_fog_opacity: s.arch_fog_opacity,
				window_fog_brightness: s.arch_fog_brightness,
				window_fog_size: s.arch_fog_size,
				window_fog_speed: s.arch_fog_speed,
				firefly_count: 0,
				mist_opacity: 0,
				mist_speed: 0,
			};
		},
	});
	return (frame) => {
		water(frame);
		atmosphere(frame);
	};
}
export const APPROVED_BRANCH_SETTINGS = Object.freeze({
	drowned_cloister: DEFAULT_CLOISTER_SETTINGS,
	tideworn_crypts: DEFAULT_FOG_SETTINGS,
	rootforge_passage: DEFAULT_ROOTFORGE_SETTINGS,
	embervein_machinery: Object.freeze({
		...DEFAULT_ROOTFORGE_SETTINGS,
		smoke_density: 2,
		smoke_size: 2.65,
		ember_count: 120,
		ember_brightness: 0.45,
	}),
	mossbound_reliquary: DEFAULT_MOSS_SETTINGS,
});
export function create_branch_renderer(scene_id, options = {}) {
	const get_settings = options.get_settings ?? (() => APPROVED_BRANCH_SETTINGS[scene_id]);
	const settings = { ...options, get_settings };
	switch (scene_id) {
		case 'drowned_cloister':
			return create_cloister_renderer(settings);
		case 'tideworn_crypts':
			return create_fog_renderer(settings);
		case 'rootforge_passage':
		case 'embervein_machinery':
			return create_rootforge_renderer({ ...settings, scene: scene_id });
		case 'mossbound_reliquary':
			return create_moss_renderer(settings);
		default:
			throw new Error(`Unknown Expedition atmosphere: ${scene_id}`);
	}
}
