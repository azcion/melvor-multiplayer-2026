import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

import {
	CHAT_INTERVAL,
	EVENT_ACTIVE_INTERVAL,
	EVENT_MAX_INTERVAL,
	EVENT_WARMUP_CHECK_GROUP,
	EVENT_WARMUP_STEP_INTERVAL,
	RETRY_INITIAL_INTERVAL,
	RETRY_MAX_INTERVAL,
	chat_poll_delay,
	event_poll_delay,
	fetch_with_timeout,
	has_pending_events,
	is_foreground,
	jittered_delay,
	ramped_poll_interval,
	retry_poll_delay
} from '../../mod/polling.mjs';

const main = await read_client_source();

test('bounds jitter around each polling interval', () => {
	assert.equal(jittered_delay(1000, () => 0), 900);
	assert.equal(jittered_delay(1000, () => 0.5), 1000);
	assert.equal(jittered_delay(1000, () => 1), 1100);
	assert.equal(event_poll_delay(false, 0, () => 0.5), EVENT_WARMUP_STEP_INTERVAL);
	assert.equal(event_poll_delay(true, () => 0.5), EVENT_ACTIVE_INTERVAL);
	assert.equal(chat_poll_delay(() => 0.5), CHAT_INTERVAL);
	assert.equal(retry_poll_delay(1, () => 0.5), RETRY_INITIAL_INTERVAL);
	assert.equal(retry_poll_delay(2, () => 0.5), RETRY_INITIAL_INTERVAL * 2);
	assert.equal(retry_poll_delay(99, () => 0.5), RETRY_MAX_INTERVAL);
});

test('ramps successful scheduled checks in four-check groups up to three minutes', () => {
	assert.equal(EVENT_WARMUP_CHECK_GROUP, 4);
	for (const checks of [0, 1, 2, 3])
		assert.equal(ramped_poll_interval(checks), EVENT_WARMUP_STEP_INTERVAL);
	for (const checks of [4, 5, 6, 7])
		assert.equal(ramped_poll_interval(checks), EVENT_WARMUP_STEP_INTERVAL * 2);
	assert.equal(ramped_poll_interval(8), EVENT_WARMUP_STEP_INTERVAL * 3);
	assert.equal(ramped_poll_interval(10_000), EVENT_MAX_INTERVAL);
	assert.equal(event_poll_delay(true, 10_000, () => 0.5), EVENT_ACTIVE_INTERVAL);
	assert.equal(event_poll_delay(false, 10_000, () => 0.5), EVENT_MAX_INTERVAL);
});

test('aborts a transport request that exceeds its timeout', async () => {
	let aborted = false;
	const hung_fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
		signal.addEventListener('abort', () => {
			aborted = true;
			reject(signal.reason);
		}, { once: true });
	});

	await assert.rejects(fetch_with_timeout(hung_fetch, 'https://example.test', {}, { timeout: 1 }));
	assert.equal(aborted, true);
});

test('keeps the timeout active while consuming the response body', async () => {
	let signal = null;
	const fetch_headers_only = async (_url, options) => {
		signal = options.signal;
		return { status: 200 };
	};
	const consume_hung_body = () => new Promise((_resolve, reject) => {
		signal.addEventListener('abort', () => reject(signal.reason), { once: true });
	});

	await assert.rejects(fetch_with_timeout(fetch_headers_only, 'https://example.test', {}, {
		timeout: 1,
		consume: consume_hung_body
	}));
	assert.equal(signal.aborted, true);
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
		{ economy_receipts: [1] },
		{ market_completed: [1] },
		{ haggle_pending: 1 },
		{ banishment_return_pending: true },
		{ inbox_pending: true },
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
	const chat = main.slice(main.indexOf('async function poll_chat_messages'), main.indexOf('async function get_friends'));
	const guild = main.slice(main.indexOf('async function refresh_guild_state'), main.indexOf('async function refresh_guild_members'));
	const visibility_start = main.indexOf('function handle_runtime_visibility_change');
	const visibility = main.slice(visibility_start, main.indexOf('// #region', visibility_start));

	assert.match(events, /if \(client_event_request !== null\)[\s\S]*return client_event_request/);
	assert.match(events, /client_event_trailing = true/);
	assert.match(events, /if \(client_event_trailing\)[\s\S]*void get_client_events\(\)/);
	assert.match(events, /\/api\/events\?revision=/);
	assert.match(events, /res\.unchanged === true/);
	assert.match(events, /request_generation !== session_generation/);
	assert.match(events, /client_event_scheduled_checks\+\+/);
	assert.match(events, /polling\.event_poll_delay\(client_events_have_pending, client_event_scheduled_checks\)/);
	assert.match(events, /finally \{[\s\S]*polling\.retry_poll_delay\(client_event_poll_failures\)/);
	assert.match(chat, /finally \{[\s\S]*polling\.retry_poll_delay\(chat_poll_failures\)/);
	assert.match(guild, /guild_state_refresh_request !== null/);
	assert.match(guild, /GUILD_STATE_FRESHNESS/);
	assert.match(visibility, /client_event_poll_id\+\+/);
	assert.match(visibility, /stop_chat_polling\(\)/);
	assert.match(visibility, /stop_gp_sampling\(\)/);
	assert.match(visibility, /stop_status_observer\(\)/);
	assert.match(visibility, /start_client_event_polling\(\)/);
	assert.match(visibility, /start_gp_sampling\(\)/);
});

test('refreshes event state after relevant navigation and successful mutations only', () => {
	const mutations = main.slice(
		main.indexOf('const EVENT_AFFECTING_MUTATIONS'),
		main.indexOf('async function refresh_identities')
	);

	for (const endpoint of ['/api/gift/send', '/api/trade/accept', '/api/friends/add', '/api/guilds/apply',
		'/api/market/buy', '/api/campaign/contribute', '/api/chat/messages/send'])
		assert.match(mutations, new RegExp(endpoint.replaceAll('/', '\\/')));
	for (const endpoint of ['/api/client/status/sync', '/api/client/equipment/sync', '/api/market/search'])
		assert.doesNotMatch(mutations, new RegExp(endpoint.replaceAll('/', '\\/')));
	assert.match(main, /is_event_affecting_mutation\(endpoint\)[\s\S]*void get_client_events\(\)/);
	assert.match(main, /async function refresh_guild_page\(\)[\s\S]*Promise\.all\(\[get_client_events\(\), refresh_guild_state\(\)\]\)/);
	assert.match(main, /on_page_toggle\('mp-market-page'[\s\S]*Promise\.all\(\[get_client_events\(\), refresh_guild_state\(\)\]\)/);
});

test('bounds requests and releases guarded page loaders from finally blocks', () => {
	const api = main.slice(main.indexOf('async function api_get'), main.indexOf('async function refresh_identities'));
	assert.match(api, /polling\.fetch_with_timeout\(fetch/);
	assert.match(api, /return \{ response: null, json: null \}/);

	for (const [function_name, loading_flag] of [
		['update_market_listings', 'market_listings_loading'],
		['update_market_search', 'market_search_loading'],
		['update_campaign_info', 'campaign_loading'],
		['request_charity_tree_contents', 'charity_tree_loading'],
		['update_transfer_contents', 'is_updating_transfer_contents'],
		['refresh_chat_messages', 'chat_messages_loading'],
		['refresh_chat_page', 'chat_loading'],
		['refresh_guild_state_request', 'guild_state_loading'],
		['refresh_guild_members', 'guild_member_directory_loading'],
		['refresh_shadowed_members', 'shadowed_member_directory_loading'],
		['refresh_raid_state', 'raid_loading'],
		['refresh_council', 'council_loading']
	]) {
		const start = main.indexOf(`async function ${function_name}`);
		const end = main.indexOf('\nasync function ', start + 1);
		const source = main.slice(start, end === -1 ? main.length : end);
		assert.match(source, new RegExp(`finally \\{[\\s\\S]*${loading_flag} = false`), function_name);
	}
});
