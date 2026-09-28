import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';
import { create_pending_economy_actions } from '../../mod/pending-economy-actions.mjs';
import { apply_economy_receipt } from '../../mod/economy-receipts.mjs';

const root = new URL('../../', import.meta.url);

test('recovers one Expedition supply command and applies its receipt once after reload', async () => {
	const saved = new Map();
	const sent = [];
	let bank_qty = 12;
	let processed = [];
	let response_lost = true;
	const receipt = { id: 'supply-command', kind: 'expedition-supply-donate',
		effects: [{ storage: 'bank', item_id: 'melvorD:Shrimp', qty: -5 }] };
	const adapter = {
		has_bank_item: id => id === 'melvorD:Shrimp', get_bank_qty: () => bank_qty,
		remove_bank_item: (id, qty) => { bank_qty -= qty; },
		get_transfer_inventory: () => [], maximum_transfer_entries: 6,
		persist_processed_ids: ids => { processed = ids; }
	};
	const options = {
		read: key => saved.get(key), write: (key, value) => saved.set(key, structuredClone(value)),
		remove: key => saved.delete(key), uuid: () => 'supply-command',
		post: async (endpoint, payload) => {
			sent.push({ endpoint, payload: structuredClone(payload) });
			return response_lost ? null : { success: true, receipt };
		},
		reconcile: async receipts => receipts.every(value =>
			['applied', 'already-applied'].includes(apply_economy_receipt(value, processed, adapter)))
	};
	const payload = { expedition_id: 7, item_id: 'melvorD:Shrimp', qty: 5, source: 'bank' };
	await create_pending_economy_actions(options).run('expedition_supply_donate', '/api/expedition/supply/donate', payload);
	assert.equal(bank_qty, 12);
	assert.equal(saved.size, 1);
	response_lost = false;
	await create_pending_economy_actions(options).run('expedition_supply_donate', '/api/expedition/supply/donate', payload);
	assert.deepEqual(sent[1], sent[0]);
	assert.equal(bank_qty, 7);
	assert.equal(saved.size, 0);
	assert.equal(apply_economy_receipt(receipt, processed, adapter), 'already-applied');
	assert.equal(bank_qty, 7);
});

test('renders phased Chamber work, accepted activities, and obscured passages', async () => {
	const [main, templates, style] = await Promise.all([
		read_client_source(root),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);
	const page = templates.slice(templates.indexOf('<template id="template-mp-expedition-page">'),
		templates.indexOf('</template>', templates.indexOf('<template id="template-mp-expedition-page">')));
	const chamber = page.slice(page.indexOf('id="mp-expedition-chamber-view"'),
		page.indexOf('id="mp-expedition-journey-view"'));
	assert.match(main, /ctx\.loadModule\('expedition-view\.mjs'\)/);
	assert.match(main, /expedition_view\.sync_phase_state\(state, result\.expedition\?\.chamber\)/);
	assert.match(page, /state\.toggle_expedition_phase\(phase\)/);
	assert.match(page, /state\.expedition_phase_tasks\(state\.expedition_state\?\.expedition\?\.chamber, phase, group\)/);
	assert.match(page, /\['done', 'active', 'pending'\]/);
	assert.match(page, /state\.expedition_text\('MOD_MP_EXPEDITION_TRACKING_TITLE'/);
	assert.match(page, /v-for="skill_id in task\.evidence\?\.skill_ids \|\| \[\]"/);
	assert.match(page, /mp-expedition-work-icons-only/);
	assert.match(page, /<span v-if="group !== 'done'">\{\{ state\.expedition_work_name\(skill_id\) \}\}<\/span>/);
	assert.match(page, /:aria-label="state\.expedition_work_name\(skill_id\)"/);
	assert.match(page, /fa fa-check-circle/);
	assert.match(page, /fa-chevron-up/);
	assert.match(page, /state\.expedition_remaining\(task\)/);
	assert.match(page, /:disabled="[^\"]*!state\.expedition_can_track\(task\)/);
	assert.match(page, /state\.submit_expedition_work\('start', task\.task_id\)/);
	assert.match(page, /state\.submit_expedition_work\('check-in'\)/);
	assert.match(page, /state\.vote_expedition_exit\(edge\.id\)/);
	assert.match(page, /vote\?\.opened_at != null \|\| state\.expedition_state\?\.expedition\?\.chamber\?\.vote\?\.locked_at != null/);
	assert.doesNotMatch(page, /exits\?\.length > 1 \|\| state\.expedition_state\?\.expedition\?\.chamber\?\.preview_exit_id/);
	assert.match(page, /expedition_check_in_cooldown_until > 0/);
	assert.match(page, /expedition_vote_cooldown_until > 0/);
	assert.match(page, /MOD_MP_EXPEDITION_UI_WHILE_IN_PREVIEW/);
	assert.match(page, /mp-expedition-progress-wrap" :class="\{ 'mp-expedition-progress-done': group === 'done' \}"[\s\S]*?<div v-if="group !== 'done'">/);
	assert.match(style, /\.mp-expedition-progress-done \{[^}]*flex: 0 0 100%/);
	assert.match(main, /else if \(expedition_view\.tracked_task_ended\(result\)\)\s+await submit_expedition_work\('stop', null, true\)/);
	assert.match(main, /EXPEDITION_VOTE_COOLDOWN = 1000/);
	assert.match(main, /EXPEDITION_CHECK_IN_COOLDOWN = 10 \* 1000/);
	assert.match(page, /state\.expedition_passage_name\(edge\.slot/);
	assert.match(page, /state\.expedition_exit_art_url\(edge\.label\)/);
	assert.match(page, /state\.expedition_exit_gateway_url\(state\.expedition_state\?\.expedition\?\.chamber\?\.id, edge\.slot\)/);
	assert.match(page, /mp-expedition-exit-unknown" v-if="edge\.label === '\?\?\?'/);
	assert.match(style, /\.mp-expedition-exit-unknown \{[^}]*radial-gradient/);
	assert.match(style, /\.mp-expedition-exit-art \{[^}]*aspect-ratio: 16 \/ 9/);
	assert.match(style, /\.mp-expedition-exit-art \.mp-expedition-exit-background \{[^}]*blur\(15px\)/);
	assert.match(page, /MOD_MP_EXPEDITION_UI_THE_RIFT/);
	assert.match(chamber, /MOD_MP_EXPEDITION_UI_GATHERING_FOR_THE_EXPEDITION/);
	assert.match(chamber, /<strong>\{\{ state\.expedition_state\?\.expedition\?\.registered_count \}\}<\/strong> <lang-string lang-id="MOD_MP_EXPEDITION_UI_REGISTERED"/);
	assert.match(chamber, /MOD_MP_EXPEDITION_UI_YOU_ARE_REGISTERED/);
	assert.match(chamber, /<h3><lang-string lang-id="MOD_MP_EXPEDITION_UI_EXPEDITION_STASH"/);
	assert.match(chamber, /MOD_MP_EXPEDITION_UI_SUPPLIES_YOU_CONTRIBUTE_CAN_EARN_YOU_EXTRA_EP/);
	assert.doesNotMatch(chamber, /Registration open|Current chamber|The Rift opens after registration closes|The Rift Stash|Visited Chambers/);
	assert.equal(page.match(/<h3><lang-string lang-id="MOD_MP_EXPEDITION_UI_VISITED_CHAMBERS"/g)?.length, 1);
	assert.doesNotMatch(chamber, /Test controls|Complete task for test|Depth |Tracking side/);
	assert.match(page, /role="tablist" :aria-label="getLangString\('MOD_MP_EXPEDITION_VIEWS'\)"/);
	assert.match(page, /mp-expedition-mobile-hidden/);
	assert.match(page, /<details class="mp-expedition-panel mp-expedition-debug-controls"/);
	assert.match(page, /state\.expedition_pending_report/);
	assert.match(main, /EXPEDITION_PENDING_KEY = 'expedition_pending_report'/);
	assert.match(main, /set_instance_storage_item\(EXPEDITION_PENDING_KEY, pending\)/);
	assert.match(main, /remove_instance_storage_item\(EXPEDITION_PENDING_KEY\)/);
	assert.match(main, /refresh_expedition_state\(true\)/);
});

test('continues capturing activities independently of profile sharing', async () => {
	const main = await read_client_source(root);
	const snapshot = main.slice(main.indexOf('function capture_status_snapshot'), main.indexOf('function update_local_status_member'));
	const sync = main.slice(main.indexOf('async function flush_status_sync'), main.indexOf('function observe_status_changes'));

	assert.match(snapshot, /const activities = capture_status_activities\(\);[\s\S]*\bactivities,/);
	assert.match(sync, /payload\.activities = snapshot\.activities/);
	assert.match(sync, /payload\.work_statistics = capture_expedition_work_statistics\(\)/);
	assert.doesNotMatch(sync, /state\.activity_visible/);
});
