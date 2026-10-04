export const DEFAULT_SNOW_SETTINGS = Object.freeze({ count: 120, speed: 40, opacity: 50, min_size: 0.5, max_size: 1, angle: -60 });

export function normalize_snow_settings(value) {
	const number = (key, min, max) => Math.min(max, Math.max(min, Number(value?.[key]) || 0));
	const min_size = number('min_size', 0.5, 8);
	return {
		count: Math.round(number('count', 0, 120)),
		speed: number('speed', 0, 150),
		opacity: number('opacity', 0, 100),
		min_size,
		max_size: Math.max(min_size, number('max_size', 0.5, 8)),
		angle: number('angle', -60, 60)
	};
}

export function advance_snow_particle(particle, settings, width, height, seconds, random = Math.random) {
	const distance = settings.speed * particle.speed_factor * seconds;
	particle.x += Math.tan(settings.angle * Math.PI / 180) * distance;
	particle.y += distance;
	const radius = settings.min_size + particle.size_factor * (settings.max_size - settings.min_size);
	if (particle.y > height + radius) {
		particle.y = -radius;
		particle.x = random() * width;
	}
	if (particle.x > width + radius) particle.x = -radius;
	if (particle.x < -radius) particle.x = width + radius;
	return radius;
}

export function create_expedition_snow_element({ create_image_particle_element, get_settings, on_stats, measure }) {
	return create_image_particle_element({ on_stats, measure, create_renderer: () => {
		const particles = [];
		return ({ context, width, height, seconds }) => {
			const settings = normalize_snow_settings(get_settings());
			while (particles.length < settings.count) particles.push({
				x: Math.random() * width, y: Math.random() * height,
				size_factor: Math.random(), speed_factor: 0.7 + Math.random() * 0.6
			});
			particles.length = settings.count;
			context.fillStyle = '#fff';
			context.globalAlpha = settings.opacity / 100;
			for (const particle of particles) {
				const radius = advance_snow_particle(particle, settings, width, height, seconds);
				context.beginPath();
				context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
				context.fill();
			}
		};
	} });
}
