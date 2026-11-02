import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create_leaderboard } from '../../mod/expedition-view.mjs';

function fixture(fetch_page = async page => ({page,total:22,players:[]})) {
	const state = {};
	let time = 0, session = 1, shown = true;
	const calls = [];
	const controller = create_leaderboard({state,fetch_page: page => { calls.push(page); return fetch_page(page); },
		visible: () => shown, generation: () => session, now: () => time});
	controller.reset();
	return { state, calls, ...controller, time: value => time=value, session: () => session++, visible: value => shown=value };
}

test('five-minute visible refresh preserves the current page; pagination fetches immediately', async () => {
	const f = fixture();
	await f.refresh();
	await f.refresh();
	assert.deepEqual(f.calls,[0]);
	await f.refresh(2);
	f.time(299999); await f.refresh();
	assert.deepEqual(f.calls,[0,2]);
	f.time(300000); f.visible(false); await f.refresh();
	assert.deepEqual(f.calls,[0,2]);
	f.visible(true); await f.refresh();
	assert.deepEqual(f.calls,[0,2,2]);
});

test('reset and session changes reject stale responses and overlapping requests', async () => {
	let resolve;
	const f = fixture(() => new Promise(done => resolve=done));
	const pending = f.refresh();
	await f.refresh(1);
	assert.equal(f.calls.length,1);
	f.reset(); resolve({page:0,total:1,players:[{client_id:42}]}); await pending;
	assert.equal(f.state.expedition_leaderboard,null);
	assert.equal(f.state.expedition_leaderboard_loading,false);
	const second = f.refresh(); f.session(); resolve({page:0,total:1,players:[]}); await second;
	assert.equal(f.state.expedition_leaderboard,null);
});

test('failed refresh retains rows, reports failure and retries after the interval', async () => {
	let fail = false;
	const f = fixture(async page => fail ? null : {page,total:1,players:[{client_id:1}]});
	await f.refresh(); fail = true; f.time(300000); await f.refresh();
	assert.equal(f.state.expedition_leaderboard.players[0].client_id,1);
	assert.equal(f.state.expedition_leaderboard_error,true);
	assert.equal(f.state.expedition_leaderboard_loading,false);
	await f.refresh(); assert.equal(f.calls.length,2);
	fail=false; f.time(600000); await f.refresh();
	assert.equal(f.state.expedition_leaderboard_error,false);
});

test('leaderboard stays in Chamber and pagination reserves hidden button positions', () => {
	const html=readFileSync(new URL('../../mod/ui/templates.html',import.meta.url),'utf8');
	const css=readFileSync(new URL('../../mod/ui/style.css',import.meta.url),'utf8');
	assert.ok(html.indexOf("$template: '#template-mp-expedition-leaderboard'") < html.indexOf('id="mp-expedition-journey-view"'));
	assert.match(html,/state.expedition_leaderboard\?\.total > 10/);
	assert.match(html,/state.format_ep\(player.points_micros\)/);
	assert.match(css,/leaderboard-pages[^}]*justify-content: center; gap: 1.5rem/);
	assert.match(css,/mp-expedition-page-hidden\s*\{ visibility: hidden;/);
});
