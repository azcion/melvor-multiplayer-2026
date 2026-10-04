// Standalone image overlay lifecycle. No framework, game, CSS, or package dependencies.
export function create_image_particle_element({ create_renderer, on_stats = () => {}, measure = () => false }) {
	return class ImageParticles extends HTMLElement {
		connectedCallback() {
			if (!this.canvas) {
				this.canvas = this.querySelector('canvas') ?? document.createElement('canvas');
				this.canvas.setAttribute('aria-hidden', 'true');
				if (!this.canvas.parentElement) this.append(this.canvas);
				for (const canvas of this.querySelectorAll('canvas')) {
					if (canvas !== this.canvas) canvas.remove();
				}
				this.context = this.canvas.getContext('2d');
				this.render_frame = create_renderer();
			}
			this.setAttribute('aria-hidden', 'true');
			this.style.cssText = 'position:absolute;inset:0;display:block;pointer-events:none';
			this.canvas.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%';
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
			if (!this.context) return;
			const scale = Math.min(window.devicePixelRatio || 1, 2);
			if (width === this.width && height === this.height && scale === this.scale) return;
			this.scale = scale;
			this.width = width;
			this.height = height;
			this.canvas.width = Math.round(width * scale);
			this.canvas.height = Math.round(height * scale);
			this.context.setTransform(scale, 0, 0, scale, 0, 0);
			this.sync_running();
		}

		sync_running() {
			if (!this.isConnected || !this.context || !this.width || !this.height || !this.visible || document.hidden || this.motion_query.matches) {
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
			this.sample_frames = 0;
			this.sample_draw_ms = 0;
			if (this.context) this.context.clearRect(0, 0, this.width, this.height);
			on_stats(null);
		}

		draw(time) {
			this.frame = null;
			const seconds = this.last_time === null ? 0 : Math.min((time - this.last_time) / 1000, 0.05);
			this.last_time = time;
			const measuring = measure();
			const started = measuring ? performance.now() : 0;
			this.context.clearRect(0, 0, this.width, this.height);
			this.context.save();
			this.render_frame({ context: this.context, width: this.width, height: this.height, seconds });
			this.context.restore();
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
