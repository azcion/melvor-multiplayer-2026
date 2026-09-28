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

export function create_expedition_snow_element({ get_settings, on_stats, measure = () => true }) {
	return class ExpeditionSnow extends HTMLElement {
		connectedCallback() {
			if (!this.canvas) {
				this.canvas = this.querySelector('canvas') ?? document.createElement('canvas');
				this.canvas.setAttribute('aria-hidden', 'true');
				if (!this.canvas.parentElement) this.append(this.canvas);
				for (const canvas of this.querySelectorAll('canvas')) {
					if (canvas !== this.canvas) canvas.remove();
				}
				this.context = this.canvas.getContext('2d');
				this.particles = [];
			}
			this.width = 0;
			this.height = 0;
			this.visible = false;
			this.frame = null;
			this.last_time = null;
			this.sample_time = null;
			this.sample_frames = 0;
			this.sample_draw_ms = 0;
			this.motion_query = window.matchMedia('(prefers-reduced-motion: reduce)');
			this.on_visibility = () => this.sync_running();
			this.resize_observer = new ResizeObserver(() => this.resize());
			this.resize_observer.observe(this);
			this.intersection_observer = new IntersectionObserver(entries => {
				this.visible = entries[0]?.isIntersecting === true;
				this.sync_running();
			});
			this.intersection_observer.observe(this);
			this.motion_query.addEventListener('change', this.on_visibility);
			document.addEventListener('visibilitychange', this.on_visibility);
			this.resize();
		}

		disconnectedCallback() {
			this.stop();
			this.resize_observer.disconnect();
			this.intersection_observer.disconnect();
			this.motion_query.removeEventListener('change', this.on_visibility);
			document.removeEventListener('visibilitychange', this.on_visibility);
		}

		resize() {
			const width = this.clientWidth;
			const height = this.clientHeight;
			if (!width || !height || (width === this.width && height === this.height)) return;
			this.width = width;
			this.height = height;
			const scale = Math.min(window.devicePixelRatio || 1, 2);
			this.canvas.width = Math.round(width * scale);
			this.canvas.height = Math.round(height * scale);
			this.context.setTransform(scale, 0, 0, scale, 0, 0);
		}

		sync_running() {
			if (!this.context || !this.visible || document.hidden || this.motion_query.matches) {
				this.stop();
				return;
			}
			if (this.frame === null) this.frame = requestAnimationFrame(time => this.draw(time));
		}

		stop() {
			if (this.frame !== null) cancelAnimationFrame(this.frame);
			this.frame = null;
			this.last_time = null;
			this.sample_time = null;
			if (this.context) this.context.clearRect(0, 0, this.width, this.height);
			on_stats(null);
		}

		draw(time) {
			this.frame = null;
			const settings = normalize_snow_settings(get_settings());
			const seconds = this.last_time === null ? 0 : Math.min((time - this.last_time) / 1000, 0.05);
			this.last_time = time;
			const measuring = measure();
			const started = measuring ? performance.now() : 0;
			this.context.clearRect(0, 0, this.width, this.height);
			while (this.particles.length < settings.count) this.particles.push({
				x: Math.random() * this.width, y: Math.random() * this.height,
				size_factor: Math.random(), speed_factor: 0.7 + Math.random() * 0.6
			});
			this.particles.length = settings.count;
			this.context.fillStyle = '#fff';
			this.context.globalAlpha = settings.opacity / 100;
			for (const particle of this.particles) {
				const radius = advance_snow_particle(particle, settings, this.width, this.height, seconds);
				this.context.beginPath();
				this.context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
				this.context.fill();
			}
			if (measuring) {
				if (this.sample_time === null) this.sample_time = time;
				this.sample_frames++;
				this.sample_draw_ms += performance.now() - started;
				const elapsed = time - this.sample_time;
				if (elapsed >= 1000) {
					on_stats({ fps: Math.round(this.sample_frames * 1000 / elapsed),
						draw_ms: +(this.sample_draw_ms / this.sample_frames).toFixed(2) });
					this.sample_time = time;
					this.sample_frames = 0;
					this.sample_draw_ms = 0;
				}
			} else {
				this.sample_time = null;
				this.sample_frames = 0;
				this.sample_draw_ms = 0;
			}
			this.frame = requestAnimationFrame(next_time => this.draw(next_time));
		}
	};
}
