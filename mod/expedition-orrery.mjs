// Orbit coordinates follow the uncropped 16:9 Orrery artwork.
export const DEFAULT_ORRERY_SETTINGS = Object.freeze({
	star_count: 120, orbit_speed: 1, star_brightness: 1,
	connection_distance: 0.05, connections_per_star: 3, line_opacity: 1, twinkle_speed: 2
});

export function normalize_orrery_settings(settings = {}) {
	const bounded = (key, min, max) => Number.isFinite(settings[key])
		? Math.max(min, Math.min(max, settings[key])) : DEFAULT_ORRERY_SETTINGS[key];
	return {
		star_count: Math.round(bounded('star_count', 0, 120)), orbit_speed: bounded('orbit_speed', 0, 8),
		star_brightness: bounded('star_brightness', 0, 1), connection_distance: bounded('connection_distance', 0.02, 0.22),
		connections_per_star: Math.round(bounded('connections_per_star', 0, 4)),
		line_opacity: bounded('line_opacity', 0, 1), twinkle_speed: bounded('twinkle_speed', 0, 6)
	};
}

export function create_orrery_renderer({ random = Math.random, get_settings = () => DEFAULT_ORRERY_SETTINGS } = {}) {
	const colors = ['#b7f2ff', '#ded0ff', '#f5dfb0'];
	const stars = Array.from({ length: 120 }, (_, index) => ({
		angle: random() * Math.PI * 2, radius: 0.19 + random() * 0.16,
		inclination: 0.46 + random() * 0.32, lift: (random() - 0.5) * 0.12,
		speed: 0.032 + random() * 0.027, phase: random() * Math.PI * 2,
		size: 0.75 + random() * 0.75, color: colors[index % colors.length],
		x: 0, y: 0, depth: 0
	}));
	const degrees = new Uint8Array(120), edges = new Uint8Array(120 * 120);
	let orbit_time = 0, twinkle_time = 0;
	return ({ context: c, width, height, seconds }) => {
		const s = normalize_orrery_settings(get_settings());
		orbit_time += seconds * s.orbit_speed; twinkle_time += seconds * s.twinkle_speed;
		for (let index = 0; index < s.star_count; index++) {
			const p = stars[index], angle = p.angle + orbit_time * p.speed;
			p.depth = Math.sin(angle);
			const perspective = 1 + p.depth * 0.10;
			p.x = 0.565 + Math.cos(angle) * p.radius * perspective;
			p.y = 0.31 + p.lift + Math.sin(angle) * p.radius * p.inclination * perspective;
		}
		degrees.fill(0); edges.fill(0);
		c.strokeStyle = '#b4d8ff'; c.lineWidth = Math.max(0.55, width / 1400);
		for (let index = 0; index < s.star_count; index++) {
			const p = stars[index];
			while (degrees[index] < s.connections_per_star) {
				let nearest = -1, distance = s.connection_distance;
				for (let other = 0; other < s.star_count; other++) {
					if (other === index || degrees[other] >= s.connections_per_star || edges[index * 120 + other]) continue;
					const q = stars[other];
					// Reject large depth differences so front/back stars do not form a flat web.
					if (Math.abs(p.depth - q.depth) > 0.8) continue;
					const d = Math.hypot(p.x - q.x, (p.y - q.y) * height / width);
					if (d < distance) { nearest = other; distance = d; }
				}
				if (nearest < 0) break;
				const q = stars[nearest];
				edges[index * 120 + nearest] = edges[nearest * 120 + index] = 1;
				degrees[index]++; degrees[nearest]++;
				c.globalAlpha = s.line_opacity * Math.pow(1 - distance / s.connection_distance, 2)
					* (0.6 + (p.depth + q.depth + 2) * 0.1);
				c.beginPath(); c.moveTo(p.x * width, p.y * height); c.lineTo(q.x * width, q.y * height); c.stroke();
			}
		}
		for (let index = 0; index < s.star_count; index++) {
			const p = stars[index], x = p.x * width, y = p.y * height;
			const near = (p.depth + 1) / 2;
			const alpha = s.star_brightness * (0.45 + near * 0.5)
				* (0.78 + Math.sin(twinkle_time * 0.8 + p.phase) * 0.22);
			const radius = p.size * (0.7 + near * 0.5) * Math.min(1, width / 640);
			c.fillStyle = p.color; c.globalAlpha = alpha * 0.10;
			c.beginPath(); c.arc(x, y, radius * 3.5, 0, Math.PI * 2); c.fill();
			c.globalAlpha = alpha; c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill();
			if (near > 0.55) {
				c.globalAlpha = alpha * 0.55;
				c.fillRect(x - radius * 2.3, y - 0.3, radius * 4.6, 0.6);
				c.fillRect(x - 0.3, y - radius * 2.3, 0.6, radius * 4.6);
			}
		}
	};
}
