import assert from 'node:assert/strict';
import test from 'node:test';

import { ModalQueueGuard } from '../../mod/modal-queue.mjs';

test('blocks duplicate modal templates while pending or active', () => {
	const active_templates = new Set();
	const guard = new ModalQueueGuard(template_id => active_templates.has(template_id));

	assert.equal(guard.reserve('leave-guild-modal'), true);
	assert.equal(guard.reserve('leave-guild-modal'), false);

	active_templates.add('leave-guild-modal');
	guard.release('leave-guild-modal');
	assert.equal(guard.reserve('leave-guild-modal'), false);

	active_templates.delete('leave-guild-modal');
	assert.equal(guard.reserve('leave-guild-modal'), true);
});

test('releases sequential modal reservations when each modal mounts', () => {
	const active_templates = new Set();
	const guard = new ModalQueueGuard(template_id => active_templates.has(template_id));

	assert.equal(guard.reserve('change-icon-modal'), true);
	active_templates.add('change-icon-modal');
	guard.release('change-icon-modal');

	active_templates.delete('change-icon-modal');
	assert.equal(guard.reserve('leave-guild-modal'), true);
	active_templates.add('leave-guild-modal');
	guard.release('leave-guild-modal');

	active_templates.delete('leave-guild-modal');
	assert.equal(guard.reserve('change-icon-modal'), true);
});

test('allows a failed modal request to release its reservation for retry', () => {
	const guard = new ModalQueueGuard(() => false);

	assert.equal(guard.reserve('leave-guild-modal'), true);
	guard.release('leave-guild-modal');
	assert.equal(guard.reserve('leave-guild-modal'), true);
});
