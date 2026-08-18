import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { ModalComponentRegistry, ModalQueueGuard } from '../../mod/modal-queue.mjs';

const root = new URL('../../', import.meta.url);

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

test('reuses one mounted component for each modal template', () => {
	const created_templates = [];
	const registry = new ModalComponentRegistry(template_id => {
		created_templates.push(template_id);
		return { template_id };
	});

	const first_member_modal = registry.get('member-actions-modal');
	const second_member_modal = registry.get('member-actions-modal');
	const profile_modal = registry.get('profile-modal');

	assert.equal(second_member_modal, first_member_modal);
	assert.notEqual(profile_modal, first_member_modal);
	assert.deepEqual(created_templates, ['member-actions-modal', 'profile-modal']);
	assert.deepEqual([...registry.values()], [first_member_modal, profile_modal]);
});

test('owns the Petite Vue lifecycle while cached modal elements connect and disconnect', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const modal_component = main.slice(
		main.indexOf('class MPModalComponent'),
		main.indexOf('class LangStringFormattedElement')
	);
	const modal_mount = main.slice(
		main.indexOf('function mount_modal_template'),
		main.indexOf('function unmount_connected_modal_components')
	);

	assert.match(modal_component, /connectedCallback\(\)/);
	assert.match(modal_component, /this\.template_app = mount_modal_template\(template_id, this\)/);
	assert.match(modal_component, /disconnectedCallback\(\)/);
	assert.match(modal_component, /whenDisconnected\(\)/);
	assert.match(modal_component, /this\.disconnect_waiters/);
	assert.match(modal_component, /unmountTemplate\(\)/);
	assert.match(modal_component, /this\.template_app\.unmount\(\)/);
	assert.match(modal_component, /this\.replaceChildren\(\)/);
	assert.match(modal_mount, /PetiteVue\.createApp/);
	assert.match(modal_mount, /app\.mount\(parent\)/);
	assert.doesNotMatch(modal_component, /make_template\(template_id, this\)/);
});

test('unmounts a connected modal before programmatic close', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const close_modal = main.slice(main.indexOf('\tclose_modal()'), main.indexOf('\tclose_account_dropdown()'));

	assert.match(close_modal, /unmount_connected_modal_components\(\);[\s\S]*Swal\.close\(\)/);
});

test('waits for SweetAlert disconnection and queued Petite Vue updates before refreshing shared state', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const close_and_wait = main.slice(main.indexOf('async function close_modal_and_wait'), main.indexOf('function close_account_dropdown'));

	assert.match(close_and_wait, /component\.unmountTemplate\(\)/);
	assert.match(close_and_wait, /Swal\.close\(\)/);
	assert.match(close_and_wait, /await component\.whenDisconnected\(\)/);
	assert.match(close_and_wait, /await PetiteVue\.nextTick\(\)/);
});

test('passes cached modal elements to the modal queue instead of creating HTML strings', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const modal_component = main.slice(
		main.indexOf('function modal_component'),
		main.indexOf('function make_template')
	);

	assert.match(modal_component, /modal_component_registry\.get\(template_id\)/);
	assert.doesNotMatch(modal_component, /<mp-modal-component/);
});

test('routes every modal title through SweetAlert text without permitting an HTML title override', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const queue_modal = main.slice(main.indexOf('function queue_modal'), main.indexOf('function show_modal_error'));

	assert.match(queue_modal, /Object\.assign\([\s\S]*titleText:/);
	assert.match(queue_modal, /delete modal_options\.title/);
	assert.doesNotMatch(queue_modal, /\n\s*title:/);
});

test('destroys modal range sliders when their custom elements disconnect', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const gp_slider = main.slice(main.indexOf('class MPGPSlider'), main.indexOf('class MPItemSlider'));
	const item_slider = main.slice(main.indexOf('class MPItemSlider'),
		main.indexOf("window.customElements.define('mp-lang-string-f'"));

	for (const slider of [gp_slider, item_slider]) {
		assert.match(slider, /disconnectedCallback\(\)/);
		assert.match(slider, /this\.slider\?\.sliderInstance\?\.destroy\(\)/);
		assert.match(slider, /this\.slider = null/);
	}
});

test('ignores late item-slider attribute updates after teardown', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const item_slider = main.slice(main.indexOf('class MPItemSlider'),
		main.indexOf("window.customElements.define('mp-lang-string-f'"));

	assert.match(item_slider, /attributeChangedCallback\(name, oldValue, newValue\)\s*\{\s*if \(this\.slider === null\)\s*return;/);
});
