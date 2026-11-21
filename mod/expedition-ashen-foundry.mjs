const ASH_COUNT = 100;
const HOT_ASH_COUNT = 15;

// These match the reviewed preview: both kinds fall with the same ash speed.
export function create_ashen_foundry_renderer({ random = Math.random } = {}) {
	const particle = () => ({ x: random(), y: random(), radius: 0.45 + random() * 0.8,
		speed: 0.5 + random(), phase: random() * Math.PI * 2, depth: 0.4 + random() * 0.6 });
	const ash = Array.from({ length: ASH_COUNT }, particle);
	const hot = Array.from({ length: HOT_ASH_COUNT }, () => ({ ...particle(), radius: 0.6 + random() * 0.55 }));
	let elapsed = 0, ash_time = 0;
	return ({ context: c, width: w, height: h, seconds }) => {
		elapsed += seconds;
		ash_time += seconds * 2.5;
		const position = p => ({
			x: (((p.x + Math.sin(ash_time * 0.2 + p.phase) * 0.007 + ash_time * 0.002 * p.depth) % 1 + 1) % 1) * w,
			y: ((p.y + ash_time * 0.012 * p.speed) % 1) * h,
			r: p.radius * (0.7 + 0.3 * p.depth)
		});
		c.fillStyle = '#c2c0b5';
		for (const p of ash) {
			const { x, y, r } = position(p);
			c.globalAlpha = 0.75 * (0.45 + 0.55 * p.depth) * (0.8 + 0.2 * Math.sin(elapsed * 0.45 + p.phase));
			c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
		}
		c.fillStyle = '#ffad5c'; c.shadowColor = 'rgba(255,106,30,1)'; c.shadowBlur = 8;
		for (const p of hot) {
			const { x, y, r } = position(p);
			c.globalAlpha = 0.65 + 0.35 * p.depth;
			c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
		}
		c.shadowBlur = 0; c.globalAlpha = 1;
	};
}
