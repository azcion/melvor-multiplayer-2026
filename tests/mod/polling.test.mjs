import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	CHAT_INTERVAL,
	EVENT_ACTIVE_INTERVAL,
	EVENT_IDLE_INTERVAL,
	chat_poll_delay,
	event_poll_delay,
	has_pending_events,
	is_foreground,
	jittered_delay
} from '../../mod/polling.mjs';

const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');

test('bounds jitter around each polling interval', () => {
	assert.equal(jittered_delay(1000, () => 0), 900);
	assert.equal(jittered_delay(1000, () => 0.5), 1000);
	assert.equal(jittered_delay(1000, () => 1), 1100);
	assert.equal(event_poll_delay(false, () => 0.5), EVENT_IDLE_INTERVAL);
	assert.equal(event_poll_delay(true, () => 0.5), EVENT_ACTIVE_INTERVAL);
	assert.equal(chat_poll_delay(() => 0.5), CHAT_INTERVAL);
});

test('uses the active interval only for actionable pending events', () => {
	assert.equal(has_pending_events(null), false);
	assert.equal(has_pending_events({ unchanged: true, gifts: [1] }), false);
	assert.equal(has_pending_events({ campaign: { active: true }, gifts: [] }), false);
	for (const events of [
		{ friend_requests: [1] },
		{ guild_applicants: [1] },
		{ gifts: [1] },
		{ trades: [1] },
		{ resolved_trades: [1] },
		{ market_completed: [1] },
		{ banishment_return_pending: true },
		{ chat_unread: 1 }
	])
		assert.equal(has_pending_events(events), true);
});

test('treats only hidden documents as backgrounded', () => {
	assert.equal(is_foreground({ visibilityState: 'visible' }), true);
	assert.equal(is_foreground({ visibilityState: 'prerender' }), true);
	assert.equal(is_foreground({ visibilityState: 'hidden' }), false);
});

test('single-flights event and Guild refreshes and pauses recurring work in the background', () => {
	const events = main.slice(main.indexOf('async function get_client_events'), main.indexOf('// #region SETUP FUNCTIONS'));
	const guild = main.slice(main.indexOf('async function refresh_guild_state'), main.indexOf('async function refresh_guild_members'));
	const visibility_start = main.indexOf('function handle_runtime_visibility_change');
	const visibility = main.slice(visibility_start, main.indexOf('// #region', visibility_start));

	assert.match(events, /if \(client_event_request !== null\)[\s\S]*return client_event_request/);
	assert.match(events, /\/api\/events\?revision=/);
	assert.match(events, /res\.unchanged === true/);
	assert.match(events, /polling\.event_poll_delay\(client_events_have_pending\)/);
	assert.match(guild, /guild_state_refresh_request !== null/);
	assert.match(guild, /GUILD_STATE_FRESHNESS/);
	assert.match(visibility, /client_event_poll_id\+\+/);
	assert.match(visibility, /stop_chat_polling\(\)/);
	assert.match(visibility, /stop_status_observer\(\)/);
	assert.match(visibility, /start_client_event_polling\(\)/);
});
