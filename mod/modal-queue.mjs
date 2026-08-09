export class ModalQueueGuard {
	constructor(is_template_active) {
		this.is_template_active = is_template_active;
		this.pending_templates = new Set();
	}

	reserve(template_id) {
		if (this.pending_templates.has(template_id) || this.is_template_active(template_id))
			return false;

		this.pending_templates.add(template_id);
		return true;
	}

	release(template_id) {
		this.pending_templates.delete(template_id);
	}
}

export class ModalComponentRegistry {
	constructor(create_component) {
		this.create_component = create_component;
		this.components = new Map();
	}

	get(template_id) {
		let component = this.components.get(template_id);
		if (component === undefined) {
			component = this.create_component(template_id);
			this.components.set(template_id, component);
		}
		return component;
	}

	values() {
		return this.components.values();
	}
}
