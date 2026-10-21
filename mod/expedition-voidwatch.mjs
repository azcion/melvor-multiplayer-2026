// Normalized anchors follow the uncropped 16:9 artwork. The leftmost pillar top is offscreen.
const FLAMES = [[0.372, 0.069, 0.85], [0.518, 0.205, 0.63], [0.618, 0.287, 0.43]];
const MAX_EMBERS = 120;
export const DEFAULT_VOIDWATCH_SETTINGS = Object.freeze({
	color: '#9c8dff', flame_height: 0.25, flame_intensity: 1, flame_speed: 1.5,
	ember_count: 120, ember_speed: 1.1, mist_opacity: 1, mist_speed: 1.4,
	doorway_intensity: 0.16, doorway_speed: 4
});

export function normalize_voidwatch_settings(input = {}) {
	const settings = {};
	for (const [key, max] of Object.entries({ flame_height: 2.5, flame_intensity: 1, flame_speed: 4,
		ember_count: MAX_EMBERS, ember_speed: 4, mist_opacity: 1, mist_speed: 4,
		doorway_intensity: 1, doorway_speed: 4 })) {
		settings[key] = Number.isFinite(input[key]) ? Math.max(0, Math.min(max, input[key])) : DEFAULT_VOIDWATCH_SETTINGS[key];
	}
	settings.ember_count = Math.round(settings.ember_count);
	settings.color = /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : DEFAULT_VOIDWATCH_SETTINGS.color;
	return settings;
}

function create_mist_texture(random) {
	const canvas = document.createElement('canvas');
	canvas.width = 256; canvas.height = 96;
	const context = canvas.getContext('2d');
	if (!context) return null;
	const data = context.createImageData(256, 96);
	const grid = Array.from({ length: 9 * 17 }, random), smooth = t => t * t * (3 - 2 * t);
	for (let y = 0; y < 96; y++) {
		for (let x = 0; x < 256; x++) {
			const gx = x / 256 * 16, gy = y / 96 * 8;
			const ix = Math.floor(gx), iy = Math.floor(gy), fx = smooth(gx - ix), fy = smooth(gy - iy);
			const at = (dx, dy) => grid[(iy + dy) * 17 + (ix + dx) % 16];
			const noise = (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy)
				+ (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
			const index = (y * 256 + x) * 4;
			data.data[index] = 132; data.data[index + 1] = 139; data.data[index + 2] = 190;
			data.data[index + 3] = Math.round(noise * noise * Math.sin(y / 95 * Math.PI) ** 2 * 180);
		}
	}
	context.putImageData(data, 0, 0);
	return canvas;
}

export function create_voidwatch_renderer({ get_settings = () => DEFAULT_VOIDWATCH_SETTINGS, random = Math.random } = {}) {
	const texture = create_mist_texture(random);
	// Interleave the remaining three sources so low densities still cover the visible pillar tops.
	const embers = Array.from({ length: MAX_EMBERS }, (_, index) => ({
		anchor: index % FLAMES.length, phase: random(), sway: random() * Math.PI * 2,
		speed: 0.12 + random() * 0.2, size: 0.45 + random() * 0.7
	}));
	let fire_time = 0, mist_time = 0, ember_time = 0, door_time = 0;
	return ({ context: c, width: w, height: h, seconds }) => {
		const s = normalize_voidwatch_settings(get_settings());
		fire_time += seconds * s.flame_speed; mist_time += seconds * s.mist_speed;
		ember_time += seconds * s.ember_speed; door_time += seconds * s.doorway_speed;
		if (texture) {
			// Confine mist to the chasm, leaving the foreground crossing legible.
			c.save(); c.beginPath(); c.moveTo(0.568 * w, 0.565 * h); c.lineTo(w, 0.439 * h);
			c.lineTo(w, h); c.lineTo(0.725 * w, h); c.lineTo(0.337 * w, 0.713 * h); c.closePath(); c.clip();
			for (let index = 0; index < 3; index++) {
				const offset = ((mist_time * (0.012 + index * 0.003) * (index === 1 ? -1 : 1) + index * 0.33) % 1 + 1) % 1 * w;
				const top = (0.5 + index * 0.19 + Math.sin(mist_time * 0.18 + index) * 0.018) * h;
				c.globalAlpha = s.mist_opacity * (0.7 + index * 0.12);
				c.drawImage(texture, offset - w, top, w, h * 0.34);
				c.drawImage(texture, offset, top, w, h * 0.34);
			}
			c.restore();
		}
		const pulse = 0.68 + 0.32 * Math.sin(door_time * 0.65), gx = 0.812 * w, gy = 0.419 * h;
		c.save(); c.beginPath(); c.rect(0.760 * w, 0.28 * h, 0.104 * w, 0.143 * h); c.clip();
		const glow = c.createRadialGradient(gx, gy, 0, gx, gy, 0.105 * w);
		glow.addColorStop(0, s.color + 'bb'); glow.addColorStop(1, s.color + '00');
		c.fillStyle = glow; c.globalAlpha = s.doorway_intensity * pulse;
		c.fillRect(0.75 * w, 0.27 * h, 0.13 * w, 0.16 * h);
		c.fillStyle = s.color; c.globalAlpha = s.doorway_intensity * (0.65 + 0.35 * pulse);
		c.fillRect(0.761 * w, 0.418 * h, 0.102 * w, 0.004 * h); c.restore();
		for (let index = 0; index < FLAMES.length; index++) {
			const [nx, ny, scale] = FLAMES[index], x = nx * w, y = ny * h;
			const flame_height = h * 0.07 * scale * s.flame_height;
			const flame_width = w * 0.009 * scale * (0.9 + Math.sin(fire_time * 5 + index) * 0.09);
			const flicker = 0.78 + 0.12 * Math.sin(fire_time * 7 + index * 2) + 0.10 * Math.sin(fire_time * 11 + index);
			const halo = c.createRadialGradient(x, y, 0, x, y, Math.max(1, flame_height * 1.2));
			halo.addColorStop(0, s.color + '88'); halo.addColorStop(1, s.color + '00');
			c.globalAlpha = s.flame_intensity * flicker * 0.65; c.fillStyle = halo;
			c.fillRect(x - flame_height * 1.2, y - flame_height * 1.2, flame_height * 2.4, flame_height * 2.4);
			for (let layer = 0; layer < 3; layer++) {
				const f = 1 - layer * 0.24, bend = Math.sin(fire_time * (3 + layer) + index * 2) * flame_width * 0.65;
				c.globalAlpha = s.flame_intensity * flicker * (0.42 + layer * 0.2);
				c.fillStyle = layer === 2 ? '#f0eaff' : s.color;
				c.beginPath(); c.moveTo(x - flame_width * f, y);
				c.bezierCurveTo(x - flame_width * f * 1.4, y - flame_height * 0.35 * f,
					x + bend - flame_width * 0.5, y - flame_height * 0.65 * f, x + bend, y - flame_height * f);
				c.bezierCurveTo(x + bend + flame_width * 0.5, y - flame_height * 0.55 * f,
					x + flame_width * 1.3 * f, y - flame_height * 0.25 * f, x + flame_width * f, y);
				c.closePath(); c.fill();
			}
		}
		for (let index = 0; index < s.ember_count; index++) {
			const p = embers[index], [nx, ny, scale] = FLAMES[p.anchor], t = (p.phase + ember_time * p.speed) % 1;
			const x = (nx + Math.sin(p.sway + t * 5 + fire_time * 0.4) * 0.01 * scale * t) * w;
			const y = (ny - t * 0.16 * scale) * h;
			c.globalAlpha = s.flame_intensity * Math.sin(t * Math.PI) * 0.7; c.fillStyle = s.color;
			c.beginPath(); c.arc(x, y, p.size * Math.min(1, w / 640) * scale, 0, Math.PI * 2); c.fill();
		}
	};
}
