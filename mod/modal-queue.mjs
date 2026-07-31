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
