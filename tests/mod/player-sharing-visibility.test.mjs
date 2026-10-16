import assert from 'node:assert/strict';
import test from 'node:test';
import { install_transfer_actions } from '../../mod/client-actions-transfer.mjs';

const settings = [
	['equipment', 'equipment'], ['skills', 'skills'], ['activity', 'activity'], ['gp', 'gp'],
	['game_mode', 'game-mode'], ['active_mods', 'active-mods'], ['dev_tag', 'dev-tag']
];

function deferred() {
	let resolve;
	const promise = new Promise(done => { resolve = done; });
	return { promise, resolve };
}

function setup(api_post) {
	const effects = [];
	const state = {
		chat_client_id: 7, guild_client_id: null, dev_tag_eligible: true, member_actions_error: 'old error',
		selected_guild_member: {
			client_id: 7, skills_available: true, total_skill_level: 99,
			activity_available: true, status_activity: { type: 'idle' }, status_activities: [{ type: 'idle' }],
			gp: 123, game_mode_id: 'old:Mode', active_mods_available: true
		}
	};
	for (const [setting] of settings) {
		state[setting + '_visible'] = true;
		state[setting + '_visibility_pending'] = false;
		state.selected_guild_member[setting + '_visible'] = true;
	}
	const runtime = {
		state, api_post, getLangString: id => 'localized:' + id,
		loaded_game_mode_id: 'melvorD:Standard', active_mod_names: ['Example Mod'],
		last_synced_equipment: 'equipment', last_synced_status_skills: 'skills',
		last_synced_status_statistics: 'statistics', last_synced_status_activities: 'activities', last_synced_gp: 123,
		invalidate_status_icon_collection: () => effects.push(['invalidate_icons']),
		schedule_equipment_sync: delay => effects.push(['equipment_sync', delay]),
		start_status_observer: () => effects.push(['status_observer']),
		start_gp_sampling: initial => effects.push(['gp_sampling', initial]),
		schedule_status_sync: delay => effects.push(['status_sync', delay]),
		refresh_guild_state: async force => { effects.push(['guild_refresh', force]); }
	};
	Object.assign(state, install_transfer_actions(runtime));
	return { state, runtime, effects };
}

const event = { preventDefault() {} };

for (const [setting, route] of settings) {
	const visible_key = setting + '_visible';
	const pending_key = setting + '_visibility_pending';
	const handler = 'set_' + setting + '_visibility';

	test(`${setting}: waits for success, blocks repeated clicks, and permits retry after failure`, async () => {
		const response = deferred();
		const calls = [];
		const { state, runtime, effects } = setup((...args) => { calls.push(args); return response.promise; });
		const member_before = structuredClone(state.selected_guild_member);
		const pending = state[handler](event);
		assert.equal(state[pending_key], true);
		assert.equal(state.member_actions_error, '');
		assert.equal(state[visible_key], true);
		assert.deepEqual(state.selected_guild_member, member_before);
		await state[handler]({ preventDefault() { assert.fail('duplicate click reached request'); } });
		assert.deepEqual(calls, [[`/api/client/${route}/visibility`, { visible: false }]]);
		response.resolve({ success: false, visible: false, error_lang: 'SERVER_ERROR' });
		await pending;
		assert.equal(state[pending_key], false);
		assert.equal(state.member_actions_error, 'localized:SERVER_ERROR');
		assert.equal(state[visible_key], true);
		assert.deepEqual(state.selected_guild_member, member_before);
		assert.deepEqual(effects, []);
		assert.equal(runtime.last_synced_equipment, 'equipment');
		assert.equal(runtime.last_synced_status_skills, 'skills');
		assert.equal(runtime.last_synced_status_statistics, 'statistics');
		assert.equal(runtime.last_synced_status_activities, 'activities');
		assert.equal(runtime.last_synced_gp, 123);
		await state[handler](event);
		assert.equal(calls.length, 2);
	});

	for (const response of [null, { success: false }]) {
		test(`${setting}: localizes generic errors for ${JSON.stringify(response)}`, async () => {
			const { state, effects } = setup(async () => response);
			await state[handler](event);
			assert.equal(state.member_actions_error, 'localized:MOD_MP_GENERIC_ERR');
			assert.equal(state[visible_key], true);
			assert.equal(state[pending_key], false);
			assert.deepEqual(effects, []);
		});
	}

	for (const visible of [false, true]) {
		test(`${setting}: applies server visibility ${visible} with only its own success effects`, async () => {
			const { state, runtime, effects } = setup(async () => ({ success: true, visible }));
			// Both responses follow the same request to hide: the server's value is authoritative.
			await state[handler](event);
			assert.equal(state[visible_key], visible);
			assert.equal(state[pending_key], false);
			assert.equal(state.member_actions_error, '');
			const expected_member = setup().state.selected_guild_member;
			const expected_effects = [];
			const caches = { equipment: 'equipment', status_skills: 'skills', status_statistics: 'statistics', status_activities: 'activities', gp: 123 };
			if (setting !== 'dev_tag') expected_member[visible_key] = visible;
			switch (setting) {
				case 'equipment':
					caches.equipment = null;
					if (visible) expected_effects.push(['equipment_sync', 0]);
					break;
				case 'skills':
					if (!visible) {
						expected_effects.push(['invalidate_icons']);
						Object.assign(expected_member, { skills_available: false, total_skill_level: null });
					}
					caches.status_skills = caches.status_statistics = null;
					expected_effects.push(['status_observer'], ['status_sync', 0]);
					break;
				case 'activity':
					if (!visible) Object.assign(expected_member, { activity_available: false, status_activity: null, status_activities: [] });
					caches.status_activities = null;
					expected_effects.push(['status_observer'], ['status_sync', 0]);
					break;
				case 'gp':
					if (!visible) expected_member.gp = null;
					caches.gp = null;
					expected_effects.push(['gp_sampling', true], ['status_sync', 0]);
					break;
				case 'game_mode': expected_member.game_mode_id = runtime.loaded_game_mode_id; break;
				case 'active_mods': expected_member.active_mods_available = visible; break;
				case 'dev_tag': expected_effects.push(['guild_refresh', true]); break;
			}
			assert.deepEqual(state.selected_guild_member, expected_member);
			assert.deepEqual(effects, expected_effects);
			for (const [cache, value] of Object.entries(caches)) assert.equal(runtime['last_synced_' + cache], value);
		});
	}

	test(`${setting}: checks selected-profile ownership when the response arrives, even while Guildless`, async () => {
		const response = deferred();
		const { state } = setup(() => response.promise);
		const pending = state[handler](event);
		state.selected_guild_member = { client_id: 8, private_marker: 'other player' };
		const other_member = structuredClone(state.selected_guild_member);
		response.resolve({ success: true, visible: false });
		await pending;
		assert.deepEqual(state.selected_guild_member, other_member);
		assert.equal(state[visible_key], false);
	});

	test(`${setting}: requests sharing when hidden without waiting for another setting`, async () => {
		const calls = [];
		const { state } = setup(async (...args) => { calls.push(args); return { success: true, visible: true }; });
		state[visible_key] = false;
		for (const [other] of settings) state[other + '_visibility_pending'] = other !== setting;
		await state[handler](event);
		assert.deepEqual(calls, [[`/api/client/${route}/visibility`, { visible: true }]]);
		assert.equal(state[visible_key], true);
		assert.equal(state[pending_key], false);
	});

	test(`${setting}: tolerates a closed selected profile`, async () => {
		const { state } = setup(async () => ({ success: true, visible: false }));
		state.selected_guild_member = null;
		await state[handler](event);
		assert.equal(state.selected_guild_member, null);
		assert.equal(state[visible_key], false);
	});
}

test('active mods require a nonempty loaded list to become available', async () => {
	const { state, runtime } = setup(async () => ({ success: true, visible: true }));
	runtime.active_mod_names = [];
	await state.set_active_mods_visibility(event);
	assert.equal(state.active_mods_visible, true);
	assert.equal(state.selected_guild_member.active_mods_available, false);
});

test('Dev tag eligibility rejects clicks before pending state, event handling or requests', async () => {
	const { state, effects } = setup(() => assert.fail('ineligible request'));
	state.dev_tag_eligible = false;
	await state.set_dev_tag_visibility({ preventDefault() { assert.fail('ineligible event'); } });
	assert.equal(state.dev_tag_visibility_pending, false);
	assert.equal(state.member_actions_error, 'old error');
	assert.deepEqual(effects, []);
});

test('Dev tag stays pending through its forced Guild refresh', async () => {
	const refresh = deferred();
	const refreshing = deferred();
	const { state, runtime } = setup(async () => ({ success: true, visible: false }));
	// Install again to bind the delayed refresh dependency.
	runtime.refresh_guild_state = () => { refreshing.resolve(); return refresh.promise; };
	Object.assign(state, install_transfer_actions(runtime));
	const pending = state.set_dev_tag_visibility(event);
	await refreshing.promise;
	assert.equal(state.dev_tag_visible, false);
	assert.equal(state.dev_tag_visibility_pending, true);
	await state.set_dev_tag_visibility({ preventDefault() { assert.fail('duplicate during refresh'); } });
	refresh.resolve();
	await pending;
	assert.equal(state.dev_tag_visibility_pending, false);
});
