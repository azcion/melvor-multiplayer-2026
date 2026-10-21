import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { install_crucible_actions } from '../../mod/client-crucible.mjs';
import * as rules from '../../mod/crucible-rules.mjs';
import { create_pending_economy_actions } from '../../mod/pending-economy-actions.mjs';
import { apply_economy_receipt } from '../../mod/economy-receipts.mjs';

const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
const pointsFormatter = new Function(main.slice(main.indexOf('function expedition_points('), main.indexOf('function expedition_text(')) + 'return expedition_points;')();
const getters = main.slice(main.indexOf('\tget crucible_wish_requirement()'), main.indexOf('\tget market_buy_price_formatted()'));
function harness() {
	const game = { gp: { amount: 10_000_000 } };
	let capacity = { base: 100, expires_at: null, auto_renew: false, renewal_micros: 0, points_micros: 1_020_000 };
	let active_wish = null;
	const state = { expedition_points: pointsFormatter, is_guild_member: true, is_connected: true, is_social_only: false,
		crucible_clock_time: Date.now(), crucible_wish_item_id: 'chest', crucible_wish_qty: 101,
		crucible_capacity_base: 200, crucible_capacity_auto_renew: false,
		eligible_crucible_wish_items: [{ id: 'chest' }] };
	Object.defineProperties(state, Object.getOwnPropertyDescriptors(new Function('game','crucible_rules', `return ({${getters}});`)(game, rules)));
	const storage = new Map(), requests = [], receipts = new Map(), processed = [], errors = [], closed = [];
	const reviewed = new Set();
	let online = true, lose_response = false, rejection = null;
	const options = {
		read: key => storage.get(key), write: (key,value) => storage.set(key, structuredClone(value)), remove: key => storage.delete(key), uuid: randomUUID,
		post: async (endpoint, payload) => {
			requests.push(structuredClone({ endpoint, payload }));
			if (!online) return null;
			if (rejection) return rejection;
			let receipt = receipts.get(payload.command_id);
			if (!receipt) {
				if (endpoint.endsWith('/make')) {
					capacity.points_micros -= payload.ep_micros;
					active_wish = { qty: payload.qty };
				} else if (endpoint.endsWith('/capacity')) {
					capacity = { ...capacity, base: payload.base, points_micros: capacity.points_micros - payload.ep_micros,
						expires_at: Date.now() + 30 * 86400000, auto_renew: payload.auto_renew, renewal_micros: 10_000_000 };
				} else capacity.auto_renew = payload.auto_renew;
				receipt = { id: payload.command_id, kind: 'crucible-wish-make', effects: endpoint.endsWith('/make') ? [{ storage: 'gp', qty: -payload.gp }] : [] };
				receipts.set(payload.command_id, receipt);
			}
			if (lose_response) { lose_response = false; online = false; return null; }
			return { success: true, receipt };
		},
		reconcile: async receipts => receipts.every(receipt => ['applied','already-applied'].includes(apply_economy_receipt(receipt,processed,{
			get_gp: () => game.gp.amount, remove_gp: qty => { game.gp.amount -= qty; }, add_gp: qty => { game.gp.amount += qty; },
			get_transfer_inventory: () => [], maximum_transfer_entries: 6, persist_processed_ids: () => {}
		})))
	};
	let journal = create_pending_economy_actions(options);
	const recovery = main.slice(main.indexOf('async function recover_paid_wish_actions()'), main.indexOf('\nfunction reconcile_economy_receipts(receipts)'));
	const recover = new Function('get_instance_storage_item','state','run_pending_economy_action','session_generation','server_host','economy_receipt_reviews','remove_instance_storage_item', `${recovery}; return recover_paid_wish_actions;`)(options.read,state,
		(key, endpoint, payload) => journal.run(`${state.chat_client_id}:${key}`,endpoint,payload),1,'test',{ has: id => reviewed.has(id) },options.remove);
	state.chat_client_id = 'character';
	const runtime = { state, game, run_pending_economy_action: (key,endpoint,payload) => journal.run(`character:${key}`,endpoint,payload),
		recover_paid_wish_actions: recover,
		api_get: async () => ({ enabled: true, is_open: true, active_wish, capacity: { ...capacity }, offerings: [], wishes: [], wish_catalog: [{ id: 'chest', max_item_value: 100 }] }),
		filter_local_available_items: rows => rows, is_local_item_available: () => true, update_crucible_nav() {},
		notify() {}, notify_error: key => errors.push(key), queue_modal() {}, close_modal_and_wait: async id => closed.push(id) };
	Object.assign(state, install_crucible_actions(runtime,rules));
	return { state, game, storage, requests, receipts, errors, closed, refresh: () => state.refresh_crucible(true),
		lose: () => { lose_response = true; }, reconnect: () => { online = true; journal = create_pending_economy_actions(options); },
		review: id => reviewed.add(id),
		capacity: value => { capacity = { ...capacity, ...value }; }, reject: value => { rejection = value; } };
}

test('client quotes every rounding boundary and prorated increment without floating point drift', () => {
	for (const base of [100,200,300,400,500]) for (let qty=1; qty<=1000; qty++) {
		const extra = Math.max(0,qty-base);
		const expected_extra = Array.from({length:extra},(_,i)=>(2+Math.floor(i/100))*10_000).reduce((a,b)=>a+b,0);
		const expected = qty<=base ? Math.ceil(qty*1000/base)*1000 : 1_000_000+expected_extra;
		assert.equal(rules.wish_price_micros(qty,base),expected,`${qty}/${base}`);
	}
	assert.equal(rules.wish_price_micros(101,100),1_020_000);
	assert.equal(rules.wish_price_micros(1,500),2000);
	assert.equal(rules.wish_price_micros(1000,500),21_000_000);
	for(const qty of [0,1001,1.1,NaN]) assert.equal(rules.wish_price_micros(qty,100),0);
	assert.equal(rules.wish_gp_cost(3445),1723);
	assert.equal(rules.wish_gp_cost(7_000_000_000),3_500_000_000);
	assert.equal(rules.wish_gp_cost(Number.MAX_SAFE_INTEGER),4503599627370496);
});

test('confirmation shows current exact costs, character capacity, expiry and upgrade differences', async () => {
	const h=harness(); await h.refresh();
	assert.equal(h.state.crucible_wish_requirement,50500);
	assert.equal(h.state.crucible_wish_gp_cost,25250);
	assert.equal(h.state.crucible_wish_ep_micros,1_020_000);
	assert.equal(h.state.crucible_ep(1_020_000),'1.020');
	assert.equal(h.state.crucible_capacity_ep(40_000_000),'40');
	assert.equal(h.state.expedition_points(31_275_000), new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(31.275));
	assert.equal(h.state.crucible_capacity_ep(9_999_999),'9');
	assert.equal(h.state.crucible_wish_affordable,true);
	h.capacity({base:300,expires_at:h.state.crucible_clock_time+1000,renewal_micros:30_000_000});await h.refresh();
	h.state.crucible_capacity_base=500;assert.equal(h.state.crucible_capacity_quote,70_000_000);
	h.state.crucible_capacity_base=300;assert.equal(h.state.crucible_capacity_quote,0);
	h.state.crucible_capacity_base=200;assert.equal(h.state.crucible_capacity_quote,0);
	h.state.crucible_clock_time+=1000;
	assert.equal(h.state.crucible_capacity.base,100);
	h.state.crucible_capacity_base=500;assert.equal(h.state.crucible_capacity_quote,100_000_000);
	h.state.crucible_wish_qty=1001;assert.equal(h.state.crucible_wish_affordable,false);
	h.state.crucible_wish_qty=100;h.game.gp.amount=24999;assert.equal(h.state.crucible_wish_affordable,false);
});

test('lost Make response recovers after reload with zero remaining EP and changed picker, charging GP once', async () => {
	const h=harness();await h.refresh();h.lose();await h.state.crucible_make_wish();
	assert.equal(h.closed.length,0);assert.equal(h.state.crucible_busy,false);
	assert.equal(h.game.gp.amount,10_000_000);assert.equal(h.storage.size,1);
	await h.refresh();assert.equal(h.state.crucible.capacity.points_micros,0);assert.equal(h.state.crucible_wish_affordable,false);
	h.state.crucible_wish_qty=1;h.reconnect();await h.refresh();
	assert.equal(h.storage.size,0);assert.equal(h.receipts.size,1);
	assert.equal(h.game.gp.amount,9_974_750);assert.equal(h.state.crucible.active_wish.qty,101);
	for(const request of h.requests) assert.deepEqual(request,h.requests[0]);
	await h.refresh();assert.equal(h.game.gp.amount,9_974_750);
});

test('automatic paid Wish recovery discards reviewed actions without recreating the purchase', async () => {
	const h=harness();await h.refresh();h.lose();await h.state.crucible_make_wish();
	const pending = [...h.storage.values()][0];
	h.review(pending.payload.command_id);
	const submissions = h.requests.length;
	h.reconnect();await h.refresh();
	assert.equal(h.storage.size,0);
	assert.equal(h.requests.length,submissions);
	assert.equal(h.game.gp.amount,10_000_000);
});

test('capacity purchase and renewal toggle use durable server-only receipts and recover exact purchase', async () => {
	const h=harness();h.capacity({points_micros:10_000_000});await h.refresh();h.lose();await h.state.crucible_buy_capacity();
	assert.equal(h.storage.size,1);h.state.crucible_capacity_base=500;
	h.reconnect();await h.refresh();assert.equal(h.state.crucible_capacity.base,200);
	assert.equal(h.state.crucible.capacity.points_micros,0);assert.equal(h.game.gp.amount,10_000_000);
	h.state.crucible_capacity_auto_renew=true;await h.state.crucible_save_renewal();
	assert.equal(h.state.crucible_capacity.auto_renew,true);assert.equal(h.storage.size,0);
	assert.deepEqual(h.requests.at(-1).payload,{auto_renew:true,ep_micros:10_000_000,command_id:h.requests.at(-1).payload.command_id});
});

test('insufficient balances and invalid quantities prevent submission; stale server quotes refresh without closing', async () => {
	const h=harness();await h.refresh();h.state.crucible_wish_qty=1001;await h.state.crucible_make_wish();
	assert.equal(h.requests.length,0);
	h.state.crucible_wish_qty=101;h.game.gp.amount=0;await h.state.crucible_make_wish();
	assert.equal(h.requests.length,0);assert.equal(h.errors.at(-1),'MOD_MP_WISH_INSUFFICIENT_GP');
	h.game.gp.amount=10_000_000;h.reject({success:false,error:'wish_quote_changed'});await h.state.crucible_make_wish();
	assert.equal(h.storage.size,0);assert.equal(h.closed.length,0);assert.equal(h.errors.at(-1),'MOD_MP_WISH_QUOTE_CHANGED');
});

test('Wish affordability requires both exact GP and EP balances', async () => {
	const h = harness(); await h.refresh();
	const ep = h.state.crucible_wish_ep_micros, gp = h.state.crucible_wish_gp_cost;
	h.capacity({ points_micros: ep }); await h.refresh(); h.game.gp.amount = gp;
	assert.equal(h.state.crucible_wish_affordable, true);
	h.game.gp.amount = gp - 1;
	assert.equal(h.state.crucible_wish_affordable, false);
	await h.state.crucible_make_wish(); assert.equal(h.requests.length, 0);
	h.game.gp.amount = gp; h.capacity({ points_micros: ep - 1 }); await h.refresh();
	assert.equal(h.state.crucible_wish_affordable, false);
	await h.state.crucible_make_wish(); assert.equal(h.requests.length, 0);
});

test('quantity fill caps at capacity and respects exact EP and GP limits', async () => {
	const h = harness();
	h.capacity({ base: 300, expires_at: Date.now() + 86400000, points_micros: 10_000_000 });
	await h.refresh(); h.state.fill_crucible_wish_qty();
	assert.equal(h.state.crucible_wish_qty, 300);
	h.capacity({ points_micros: 50_000 }); await h.refresh(); h.state.fill_crucible_wish_qty();
	assert.equal(h.state.crucible_wish_qty, 15);
	assert.equal(h.state.crucible_wish_affordable, true);
	h.state.adjust_crucible_wish_qty(1); assert.equal(h.state.crucible_wish_affordable, false);
	h.capacity({ points_micros: 10_000_000 }); await h.refresh(); h.game.gp.amount = 7499;
	h.state.fill_crucible_wish_qty(); assert.equal(h.state.crucible_wish_qty, 29);
	h.game.gp.amount = 7500; h.state.fill_crucible_wish_qty(); assert.equal(h.state.crucible_wish_qty, 30);
	h.game.gp.amount = 0; h.state.fill_crucible_wish_qty();
	assert.equal(h.state.crucible_wish_qty, 1); assert.equal(h.state.crucible_wish_affordable, false);
	h.game.gp.amount = 10_000_000; h.capacity({ expires_at: Date.now() - 1 }); await h.refresh();
	h.state.fill_crucible_wish_qty(); assert.equal(h.state.crucible_wish_qty, 100);
	h.state.crucible_wish_item_id = 'missing'; h.state.fill_crucible_wish_qty();
	assert.equal(h.state.crucible_wish_qty, 1); assert.equal(h.state.crucible_wish_affordable, false);
});

test('localized confirmation bindings preserve Wish precision and scroll only the item list', async () => {
	const templates=await readFile(new URL('../../mod/ui/templates.html',import.meta.url),'utf8');
	const css=await readFile(new URL('../../mod/ui/style.css',import.meta.url),'utf8');
	const wish=templates.split('<template id="template-mp-crucible-wish-modal">')[1].split('</template>')[0];
	assert.doesNotMatch(wish,/mp-wish-modal-scroll|crucible_capacity_summary|MOD_MP_WISH_PAYMENT_INFO/);
	assert.match(wish,/MOD_MP_WISH_CURRENT_CAPACITY/);assert.match(wish,/crucible_ep\(/);
	assert.match(wish,/MOD_MP_WISH_COST_LABEL/);
	assert.equal((wish.match(/market_currency_icon\(null\)/g) ?? []).length,2);
	assert.match(wish,/:disabled="state.crucible_busy \|\| !state.crucible_wish_affordable"/);
	const capacity=templates.split('<template id="template-mp-crucible-capacity-modal">')[1].split('</template>')[0];
	assert.doesNotMatch(capacity,/mp-wish-modal-scroll|@touchmove|<select|crucible_save_renewal|crucible_expiry|crucible_renewal_quote|MOD_MP_WISH_BALANCE/);
	assert.match(capacity,/MOD_MP_EXPEDITION_UI_YOUR_EP/);
	assert.match(capacity,/expedition_points\(state.crucible\?\.capacity\?\.points_micros\)/);
	assert.match(capacity,/\[100,200,300,400,500\]/);
	assert.match(capacity,/:aria-pressed="state.crucible_capacity_base === tier"/);
	assert.match(capacity,/crucible_capacity_ep\(state.crucible_capacity_quote\)/);
	assert.match(capacity,/crucible_confirm_capacity\(\)/);
	assert.match(capacity,/MOD_MP_WISH_RENEWAL_QUOTE/);
	assert.match(capacity,/role="switch" :aria-checked="state.crucible_capacity_auto_renew"/);
	assert.match(templates,/crucible_exact\(state.crucible_wish_gp_cost\)/);
	assert.match(css,/\.mp-crucible-wish-grid\s*\{[^}]*flex-shrink:\s*0;[^}]*overflow-y:\s*scroll;[^}]*touch-action:\s*pan-y;[^}]*overscroll-behavior-y:\s*contain;/);
	for(const locale of ['en','de','es','fr','it','ja','ko','pt','pt-br','ru','tr','zh-CN','zh-TW']) {
		const lang=JSON.parse(await readFile(new URL(`../../mod/data/lang/${locale}.json`,import.meta.url),'utf8'));
		for(const key of ['MOD_MP_WISH_QUANTITY_MIN','MOD_MP_WISH_QUANTITY_FILL','MOD_MP_WISH_CAPACITY_DESCRIPTION','MOD_MP_WISH_OVER_CAPACITY_INFO','MOD_MP_WISH_COST_LABEL','MOD_MP_WISH_CAPACITY_INFO','MOD_MP_WISH_RENEWAL_PAUSED']) assert.ok(lang[key],`${locale}:${key}`);
		for(const placeholder of ['base','expiry','ep','renew','balance']) assert.ok(lang.MOD_MP_WISH_CAPACITY_STATUS.includes(`%${placeholder}%`),locale);
		assert.equal(lang.MOD_MP_WISH_CAPACITY_STATUS.split('\n').length,4,locale);
	}
});


test('capacity confirmation buys upgrades or changes renewal without re-buying an active tier', async () => {
	const h=harness();h.capacity({points_micros:100_000_000});await h.refresh();
	h.state.crucible_capacity_base=100;
	assert.equal(h.state.crucible_capacity_can_confirm,false);
	assert.equal(h.state.crucible_capacity_confirm_label,'MOD_MP_WISH_CONFIRM');
	h.state.crucible_capacity_base=200;
	assert.equal(h.state.crucible_capacity_confirm_label,'MOD_MP_WISH_BUY_CAPACITY');
	await h.state.crucible_confirm_capacity();
	const expiry=h.state.crucible_capacity.expires_at;
	const balance=h.state.crucible.capacity.points_micros;
	assert.equal(h.state.crucible_capacity_can_confirm,false);
	await h.state.crucible_buy_capacity();assert.equal(h.requests.length,1);
	h.capacity({points_micros:0});await h.refresh();
	h.state.crucible_capacity_auto_renew=true;
	assert.equal(h.state.crucible_capacity_can_confirm,true);
	assert.equal(h.state.crucible_capacity_confirm_label,'MOD_MP_WISH_AUTO_RENEW');
	await h.state.crucible_confirm_capacity();
	assert.equal(h.requests.at(-1).endpoint,'/api/crucible/wish/renewal');
	assert.equal(h.state.crucible_capacity.expires_at,expiry);
	assert.equal(h.state.crucible.capacity.points_micros,0);
	h.state.crucible_capacity_auto_renew=false;
	assert.equal(h.state.crucible_capacity_confirm_label,'MOD_MP_WISH_DISABLE_RENEWAL');
	await h.state.crucible_confirm_capacity();
	assert.equal(h.state.crucible_capacity.auto_renew,false);
	h.capacity({base:300,points_micros:balance});await h.refresh();
	const oldLang=globalThis.getLangString;
	globalThis.getLangString=key=>({MOD_MP_WISH_FREE:'Free',MOD_MP_WISH_ACTIVE:'Active'})[key];
	try {
		assert.deepEqual([100,200,300,400,500].map(tier=>h.state.crucible_capacity_tier_cost(tier)),
			['Free','—','Active','30 EP','70 EP']);
	} finally {
		if (oldLang === undefined) delete globalThis.getLangString;
		else globalThis.getLangString=oldLang;
	}
	h.state.crucible_capacity_base=400;
	assert.equal(h.state.crucible_capacity_quote,30_000_000);
	h.state.crucible_capacity_base=500;
	assert.equal(h.state.crucible_capacity_quote,70_000_000);
});
