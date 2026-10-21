import { CHAT_HIGHLIGHT_PRESETS, highlight_input, highlight_color } from '../../mod/chat-highlights.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { create_transport, create_selection, pair_serialized, readable_item } from '../../server/chat-assets/transport.mjs';
test('same-origin scoped requests, no manual Origin, CSRF and selector, no mutation replay', async () => {
	const calls = [];
	const transport = create_transport({ fetcher: async (path, options) => { calls.push({ path, options }); return Response.json({ ok: true }); } });
	await transport.request('/chat/api/session');
	await transport.request('/chat/api/data?locale=de', { csrf: 'memory', link: 8 });
	await transport.request('/chat/api/pair', { method: 'POST', csrf: 'memory', body: { code: 'one use' } });
	assert.equal(calls[0].options.credentials, 'same-origin');
	assert.equal(calls[0].options.headers.Origin, undefined);
	assert.equal(calls[1].options.headers['X-Chat-Link-ID'], '8');
	assert.equal(calls[1].options.headers['X-Chat-CSRF'], 'memory');
	assert.equal(calls.length, 3);
	await assert.rejects(transport.request('https://evil.test'));
	await assert.rejects(transport.request('/api/v2/chat'));
});
test('generation rejects late data even when fetch ignores abort; timeout covers body', async () => {
	let finish;
	const transport = create_transport({ fetcher: () => new Promise(resolve => finish = resolve) });
	const request = transport.request('/chat/api/session');
	transport.invalidate();
	finish(Response.json({ secret: 'late' }));
	await assert.rejects(request, { name: 'AbortError' });
	const timeout = create_transport({ timeout_ms: 5, fetcher: async (_p, { signal }) => ({ ok: true, json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))) }) });
	await assert.rejects(timeout.request('/chat/api/session'));
});
test('tab selection stores only nonsecret ID and tolerates denied storage', () => {
	const values = new Map();
	const selection = create_selection({ getItem: k => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) });
	selection.write(8);
	assert.deepEqual([...values.values()], ['8']);
	assert.equal(selection.read([{ link_id: 8 }]), 8);
	assert.equal(selection.read([{ link_id: 9 }]), 9);
	const denied = create_selection({ getItem() { throw Error(); }, setItem() { throw Error(); } });
	denied.write(9);
	assert.equal(denied.read([]), null);
	assert.deepEqual(readable_item('DLC:Missing_Item'), { id: 'DLC:Missing_Item', name: 'Missing Item', media: null });
});
test('origin lock covers session recheck, pair and bootstrap; fallback is sequential', async () => {
	const order = [];
	const locks = { request: async (name, callback) => { order.push(name); await callback(); order.push('unlock'); } };
	await pair_serialized(locks, async () => order.push('session'), async () => { order.push('pair'); return { link_id: 4 }; }, async (id) => order.push(id));
	assert.deepEqual(order, ['mp.chat.initial-pair', 'session', 'pair', 4, 'unlock']);
});
import { create_chat_controller, conversation_key } from '../../server/chat-assets/controller.mjs';
import { node, kind_labels, presentation, render_parts, avatar_node, conversation_image, conversation_label } from '../../server/chat-assets/render.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
async function shell_fixture(fetcher, messaging = false, touch = false, storage = { getItem() { return null; }, setItem() { }, removeItem() { } }, search = '') {
	class Element {
		constructor(id = '', tag = '') { this.tagName = tag.toUpperCase(); this.id = id; this.value = ''; this.scrollTop = 0; this.clientHeight = 100; this.hidden = false; this.children = []; this.listeners = {}; this.style = {}; this.textContent = ''; }
		get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
		set textContent(value) { this.ownText = value; this.children = []; }
		get scrollHeight() { return this.id === 'messages' ? (elements.get('message-rows')?.children.length ?? 0) * 100 + (elements.get('older')?.hidden ? 0 : 40) : 0; }
		replaceChildren(...children) { this.children = children; }
		append(...children) { this.children.push(...children); }
		remove() { }
		setAttribute(key,value) { this[key] = value; }
		getAttribute(key) { return this[key]; }
		showModal() { this.open = true; }
		close() { this.open = false; }
		set disabled(value) { this.isDisabled = value; if (value && document.activeElement === this) document.activeElement = null; }
		get disabled() { return this.isDisabled; }
		focus() { document.activeElement = this; }
		addEventListener(event, fn) { this.listeners[event] = fn; }
	}
	const elements = new Map();
	const document = { getElementById: id => { if (!elements.has(id))
			elements.set(id, new Element(id)); return elements.get(id); }, createElement: tag => new Element('',tag), querySelectorAll: () => { const found = new Set(); const visit = element => { found.add(element); for (const child of element.children) visit(child); }; for (const element of elements.values()) visit(element); return [...found]; }, addEventListener() { } };
	const source = (await readFile(new URL('../../server/chat-assets/chat.mjs', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
	const context = { CHAT_HIGHLIGHT_PRESETS, highlight_input, highlight_color, document, navigator: { maxTouchPoints: touch === true ? 1 : 0, locks: { request: async (_name, callback) => callback() } }, sessionStorage: storage,
		create_transport: () => create_transport({ fetcher: (path, options) => !messaging && ['/chat/api/state','/chat/api/conversations'].includes(path) ? Promise.resolve(Response.json(path.endsWith('state') ? {} : { conversations: [] })) : fetcher(path,options) }), create_selection, pair_serialized,
		create_chat_controller: options => create_chat_controller({ ...options, schedule: () => 1, cancel() { } }), conversation_key, node, kind_labels, presentation, render_parts, avatar_node, conversation_image, conversation_label,
		window: { innerWidth: touch === 'narrow' ? 390 : 1200, location: { search }, addEventListener() { } }, URLSearchParams, console, Date, Number, Boolean };
	for (const id of ['code'])
		document.getElementById(id);
	vm.runInNewContext(source, context);
	const settle = () => new Promise(resolve => setTimeout(resolve, 20));
	await settle();
	return { elements, settle, document, poll: () => vm.runInNewContext('chat.tick()',context) };
}
const link = (id, name) => ({ link_id: id, client_id: id + 100, display_name: name, expires_at: Date.now() + 100000 });
const demo_data = { items: [{ id: 'melvorD:One', name: 'One', media: null }], provenance: { package: 'melvorDemo', adapter_version: 1, fetched_at: 1, stale: false } };
test('tagging buttons stay hidden unless explicitly enabled for development', async () => {
	for (const search of ['', '?devTags=0', '?devTags', '?devTags=1']) {
		const { elements } = await shell_fixture(async () => Response.json({ links: [] }), false, false, undefined, search);
		for (const id of ['people-tag', 'item-picker']) assert.equal(elements.get(id).hidden, search !== '?devTags=1');
	}
});
test('revoked selected identity reboots session and preserves independently linked identity', async () => {
	let bootstraps = 0;
	const selections = [];
	const { elements } = await shell_fixture(async (path, options) => {
		if (path === '/chat/api/session')
			return Response.json({ links: ++bootstraps === 1 ? [link(1, 'A'), link(2, 'B')] : [link(2, 'B')], csrf_token: 'csrf' });
		selections.push(options.headers['X-Chat-Link-ID']);
		return options.headers['X-Chat-Link-ID'] === '1' ? new Response('', { status: 401 }) : Response.json(demo_data);
	});
	assert.equal(bootstraps, 2);
	assert.deepEqual(selections, ['1', '2']);
	assert.equal(elements.get('identity').value, '2');
	assert.equal(elements.get('identity').children.length, 1);
	assert.match(elements.get('identity-detail').textContent, /B/);
});
test('pair rechecks under lock, passes stable CSRF, clears code and bootstraps selected link', async () => {
	let paired = false;
	const calls = [];
	const { elements, settle } = await shell_fixture(async (path, options) => {
		calls.push({ path, options });
		if (path === '/chat/api/session')
			return Response.json({ links: paired ? [link(1, 'Same'), link(2, 'Same')] : [link(1, 'Same')], csrf_token: 'stable' });
		if (path === '/chat/api/pair') {
			paired = true;
			return Response.json({ link_id: 2 });
		}
		return Response.json(demo_data);
	});
	elements.get('code').value = 'one-use';
	await elements.get('link-form').listeners.submit({ preventDefault() { } });
	await settle();
	const pair = calls.find(call => call.path === '/chat/api/pair');
	assert.equal(pair.options.headers['X-Chat-CSRF'], 'stable');
	assert.equal(elements.get('code').value, '');
	assert.equal(elements.get('identity').value, '2');
	assert.match(elements.get('identity').children[0].textContent, /^Same \(1\)$/);
	assert.match(elements.get('identity').children[1].textContent, /^Same \(2\)$/);
});
test('selected and all logout use explicit scopes and reconcile retained links', async () => {
	let remaining = [link(1, 'A'), link(2, 'B')];
	const calls = [];
	const { elements, settle } = await shell_fixture(async (path, options) => {
		calls.push({ path, options });
		if (path === '/chat/api/session')
			return remaining.length ? Response.json({ links: remaining, csrf_token: 'csrf' }) : new Response('', { status: 401 });
		if (path === '/chat/api/logout') {
			remaining = remaining.filter(link => String(link.link_id) !== options.headers['X-Chat-Link-ID']);
			return Response.json({ ok: true });
		}
		if (path === '/chat/api/logout-all') {
			remaining = [];
			return Response.json({ ok: true });
		}
		return Response.json(demo_data);
	});
	elements.get('logout').listeners.click();
	await settle();
	assert.equal(elements.get('identity').value, '2');
	assert.equal(elements.get('identity').children.length, 1);
	assert.equal(calls.find(call => call.path === '/chat/api/logout').options.headers['X-Chat-Link-ID'], '1');
	elements.get('logout-all').listeners.click();
	await settle();
	assert.equal(elements.get('identity-panel').hidden, true);
	assert.equal(elements.get('link-panel').hidden, false);
	assert.equal(elements.get('items').children.length, 0);
});
test('late unauthorized response from a prior selection is aborted rather than treated as current auth failure', async () => {
	let finish;
	const transport = create_transport({ fetcher: () => new Promise(resolve => finish = resolve) });
	const old = transport.request('/chat/api/data', { csrf: 'csrf', link: 1 });
	transport.invalidate();
	finish(new Response('', { status: 401 }));
	await assert.rejects(old, { name: 'AbortError' });
});

test('switching identity clears content and suppresses a late prior preview response', async () => {
	let finish_old;
	const { elements, settle } = await shell_fixture(async (path, options) => {
		if (path === '/chat/api/session') return Response.json({ links: [link(1, 'A'), link(2, 'B')], csrf_token: 'csrf' });
		if (options.headers['X-Chat-Link-ID'] === '1') return new Promise(resolve => finish_old = resolve);
		return Response.json({ ...demo_data, items: [{ id: 'melvorD:B', name: 'B preview', media: null }] });
	});
	elements.get('identity').value = '2';
	elements.get('identity').listeners.change();
	assert.equal(elements.get('items').children.length, 0);
	await settle();
	finish_old(Response.json({ ...demo_data, items: [{ id: 'melvorD:A', name: 'Old A preview', media: null }] }));
	await settle();
	assert.equal(elements.get('identity').value, '2');
	assert.equal(elements.get('items').children[0].children[0].textContent, 'B previewmelvorD:B');
});

test('switch during delayed auth reconciliation suppresses stale feedback and state changes', async () => {
	let bootstraps = 0;
	let finish_reconciliation;
	const { elements, settle } = await shell_fixture(async (path, options) => {
		if (path === '/chat/api/session') {
			if (++bootstraps === 1) return Response.json({ links: [link(1, 'A'), link(2, 'B')], csrf_token: 'csrf' });
			return new Promise(resolve => finish_reconciliation = resolve);
		}
		if (options.headers['X-Chat-Link-ID'] === '1') return new Response('', { status: 401 });
		return Response.json(demo_data);
	});
	assert.equal(bootstraps, 2);
	elements.get('identity').value = '2';
	elements.get('identity').listeners.change();
	await settle();
	const feedback = elements.get('status').textContent;
	finish_reconciliation(new Response('', { status: 401 }));
	await settle();
	assert.equal(elements.get('status').textContent, feedback);
	assert.equal(elements.get('identity').value, '2');
	assert.equal(elements.get('identity-panel').hidden, false);
	assert.equal(elements.get('items').children.length, 1);
});
test('actual shell keeps inbox keyboard focus across changed poll data and routes composer to selected identity', async () => {
 let unread=1; const calls=[];
 const conversation={conversation_kind:'global',conversation_id:1,participant:{client_id:null,display_name:'Global'},unread_count:unread};
 const {elements,settle,document,poll}=await shell_fixture(async(path,options)=>{
  calls.push({path,options});
  if(path==='/chat/api/session')return Response.json({links:[link(1,'A'),link(2,'B')],csrf_token:'csrf'});
  if(path==='/chat/api/state')return Response.json({client_id:101,messaging_enabled:true});
  if(path==='/chat/api/conversations')return Response.json({conversations:[{...conversation,unread_count:unread}]});
  if(path.startsWith('/chat/api/messages/details?')) return Response.json({seen:[{display_name:'Reader',client_id:9}],reactions:[]});
  if(path === '/chat/api/messages/delete' || path === '/chat/api/messages/reaction' || path === '/chat/api/conversations/delete') return Response.json({success:true});
  if(path.startsWith('/chat/api/messages?'))return Response.json({messages:[],has_more:false});
  if(path==='/chat/api/messages/send')return Response.json({success:true,message:{message_id:1,conversation_id:1,sender_id:101,content:'hello',created_at:1}});
  return Response.json(demo_data);
 },true);
 const first=elements.get('inbox').children[1]; first.focus(); first.listeners.click(); await settle();
 unread=2; await poll(); await settle();
 const replacement=elements.get('inbox').children[1]; assert.notEqual(first,replacement);
 // Focus restore is by an internal stable key, never by a selector derived from server text.
 assert.equal(replacement.chatFocus,first.chatFocus); assert.equal(document.activeElement,replacement);
 elements.get('draft').value='hello'; elements.get('draft').listeners.input();
 elements.get('mobile-inbox').listeners.click();
 assert.equal(elements.get('workspace')['data-mobile-inbox'],'true');
 replacement.listeners.click(); await settle();
 assert.equal(elements.get('workspace')['data-mobile-inbox'],'false');
 assert.equal(elements.get('draft').value,'hello');
 elements.get('composer').listeners.submit({preventDefault(){}}); await settle();
 const sent=calls.find(c=>c.path==='/chat/api/messages/send'); assert.equal(sent.options.headers['X-Chat-Link-ID'],'1');
 assert.equal(JSON.parse(sent.options.body).content,'hello'); assert.equal(elements.get('identity').children[0].textContent,'A');
});

const descendants = element => [element,...element.children.flatMap(descendants)];
async function message_shell(touch = false, id = 7, kind = 'global', send_response) {
 const calls = [];
 const {elements,settle,document} = await shell_fixture(async(path,options) => {
  calls.push({path,options});
  if(path === '/chat/api/session') return Response.json({links:[link(1,'A'),link(2,'B')],csrf_token:'csrf'});
  if(path === '/chat/api/state') return Response.json({client_id:101,messaging_enabled:true});
  if(path === '/chat/api/conversations') return Response.json({conversations:[{conversation_kind:kind,conversation_id:1,participant:{client_id:4,display_name:'Other'},unread_count:0},{conversation_kind:'guild',conversation_id:2,participant:{display_name:'Guild'}}]});
  if(path.startsWith('/chat/api/messages/details?')) return Response.json({seen:[{display_name:'Reader',client_id:9}],reactions:[]});
  if(path === '/chat/api/messages/delete' || path === '/chat/api/messages/reaction' || path === '/chat/api/conversations/delete') return Response.json({success:true});
  if(path.startsWith('/chat/api/messages?')) return Response.json({messages:[{message_id:id,sender_id:4,sender:{display_name:'Other'},created_at:1,content:'original',translations:{en:'translated'},reactions:[{reaction:'👍',count:2,reacted:true}]}],has_more:false});
  if(path === '/chat/api/messages/send') return send_response ? send_response() : Response.json({message:{message_id:8,created_at:2,content:'sent'}});
  return Response.json(demo_data);
 },true,touch);
 descendants(elements.get('inbox')).find(e=>e.className === 'conversation' && e.children.find(child => child.className === 'conversation-copy')?.children[0].textContent === 'Other').listeners.click(); await settle();
 return {elements,settle,document,calls};
}
test('timestamp opens message actions; translation and aggregate toggles stay in modal and close safely', async () => {
 const {elements} = await message_shell();
 elements.get('translation').value = 'en'; elements.get('translation').listeners.change();
 const rows = () => descendants(elements.get('message-rows'));
 assert.equal(elements.get('history-status').textContent,'');
 assert.equal(rows().some(e => ['React','Seen / reactions','Original','Show original'].includes(e.textContent)),false);
 assert.equal(descendants(elements.get('inbox')).some(e => e.textContent === '0 unread'),false);
 const timestamp = rows().find(e => e.className === 'message-timestamp');
 timestamp.listeners.click();
 assert.equal(elements.get('dialog').open,true);
 const actions = elements.get('dialog-content').children;
 assert.equal(actions.some(e => e.textContent === 'React' || e.textContent === '👍 2'),false);
 assert.ok(actions.some(e => e.textContent === 'Show Seen'));
 assert.ok(actions.some(e => e.textContent === 'View Reactions'));
 actions.find(e => e.textContent === 'Show original').listeners.click();
 assert.equal(elements.get('dialog').open,false);
 assert.ok(rows().some(e => e.textContent === 'original'));
 rows().find(e => e.className === 'message-timestamp').listeners.click();
 assert.ok(elements.get('dialog-content').children.some(e => e.textContent === 'Show translation'));
 elements.get('dialog').listeners.cancel();
 assert.equal(elements.get('dialog').open,false);
 assert.equal(elements.get('dialog-content').children.length,0);
});
test('virtual welcome omits timestamp actions', async () => {
 const {elements} = await message_shell(false,0);
 assert.equal(descendants(elements.get('message-rows')).some(e => e.className === 'message-timestamp'),false);
});
test('desktop Enter sends; modifiers, composition and mobile Enter preserve newline input', async () => {
 for (const touch of [false,true,'narrow']) {
  const {elements,calls,settle} = await message_shell(touch);
  const draft = elements.get('draft'); draft.value='hello'; draft.listeners.input();
  let prevented=0;
  const key = extra => draft.listeners.keydown({key:'Enter',preventDefault(){prevented++;},...extra});
  for(const extra of [{shiftKey:true},{ctrlKey:true},{altKey:true},{metaKey:true},{isComposing:true},{keyCode:229}]) key(extra);
  draft.listeners.compositionstart(); key({}); draft.listeners.compositionend();
  assert.equal(prevented,0);
  assert.equal(calls.filter(c=>c.path.endsWith('/send')).length,0);
  key({}); await settle();
  assert.equal(prevented,touch ? 0 : 1);
  assert.equal(calls.filter(c=>c.path.endsWith('/send')).length,touch ? 0 : 1);
  if(touch) { elements.get('composer').listeners.submit({preventDefault(){}}); await settle(); assert.equal(calls.filter(c=>c.path.endsWith('/send')).length,1); }
 }
});

test('shell offers only English and Simplified Chinese with a compact character selector', async () => {
 const html = await readFile(new URL('../../server/chat-assets/index.html',import.meta.url),'utf8');
 assert.deepEqual([...html.matchAll(/<option value="([^"]*)"/g)].map(match=>match[1]),['','en','zh-CN']);
 assert.match(html,/<label for="identity">Character<\/label>/);
 assert.doesNotMatch(html,/Chatting as|Only explicitly linked|composer-identity/);
});
test('resolved item and feature labels omit IDs; unknown items retain canonical fallback and people hide IDs', () => {
 const document = {createElement: tag => ({tagName:tag,children:[],append(...children){this.children.push(...children);}})};
 const target = document.createElement('div');
 render_parts(document,target,[{type:'item',item_id:'melvorD:One'},{type:'item',item_id:'dlc:Missing_Item'},{type:'person',client_id:123},{type:'feature',feature_id:'multiplayer:Badge_New_Member'}],'',demo_data.items);
 assert.equal(target.children[0].children[0].textContent,'One');
 assert.equal(target.children[1].title,'dlc:Missing_Item');
 assert.equal(target.children[1].children[0].textContent,'Missing Item');
 assert.equal(target.children[2].children[0].textContent,'Character');
 assert.equal(target.children[3].children[0].textContent,'New Member');
});

const action = (elements,text) => elements.get('dialog-content').children.find(e=>e.textContent === text);
const timestamp = elements => descendants(elements.get('message-rows')).find(e=>e.className === 'message-timestamp');
test('identity and conversation switching dismiss timestamp and conversation menus', async () => {
 const {elements,settle} = await message_shell(false,7,'private');
 timestamp(elements).listeners.click();
 const other = descendants(elements.get('inbox')).find(e=>e.className === 'conversation' && e.children.find(child => child.className === 'conversation-copy')?.children[0].textContent === 'Guild');
 other.listeners.click(); await settle();
 assert.equal(elements.get('dialog').open,false);
 assert.equal(elements.get('dialog-content').children.length,0);
 const private_button = descendants(elements.get('inbox')).find(e=>e.className === 'conversation' && e.children.find(child => child.className === 'conversation-copy')?.children[0].textContent === 'Other');
 private_button.listeners.click(); await settle();
 elements.get('thread-title').listeners.click();
 assert.equal(elements.get('dialog-title').textContent,'Conversation actions');
 assert.ok(action(elements,'Profile')); assert.ok(action(elements,'Block')); assert.ok(action(elements,'Hide conversation'));
 elements.get('identity').value='2'; elements.get('identity').listeners.change(); await settle();
 assert.equal(elements.get('dialog').open,false);
 assert.equal(elements.get('dialog-content').children.length,0);
});
test('timestamp reaction, details and confirmed Private hide route the selected identity and message', async () => {
 const {elements,calls,settle} = await message_shell(false,7,'private');
 descendants(elements.get('message-rows')).find(e => e['aria-label'] === 'Add reaction').listeners.click();
 action(elements,'🔥').listeners.click(); await settle();
 const reaction = calls.find(c=>c.path === '/chat/api/messages/reaction');
 assert.ok(reaction); assert.equal(reaction.options.headers['X-Chat-Link-ID'],'1');
 assert.equal(JSON.parse(reaction.options.body).message_id,7);
 assert.equal(JSON.parse(reaction.options.body).reaction,'🔥');
 timestamp(elements).listeners.click(); action(elements,'Show Seen').listeners.click(); await settle();
 const details = calls.find(c=>c.path.startsWith('/chat/api/messages/details?'));
 assert.ok(details.path.includes('message_id=7')); assert.equal(details.options.headers['X-Chat-Link-ID'],'1');
 assert.ok(action(elements,'Reader'));
 timestamp(elements).listeners.click(); action(elements,'Hide for me').listeners.click();
 assert.equal(calls.some(c=>c.path === '/chat/api/messages/delete'),false);
 elements.get('dialog-actions').children[0].listeners.click(); await settle();
 const hidden = calls.find(c=>c.path === '/chat/api/messages/delete');
 assert.equal(hidden.options.headers['X-Chat-Link-ID'],'1'); assert.equal(JSON.parse(hidden.options.body).message_id,7);
});

async function inbox_shell({ conversations, storage, messages = () => [{message_id:10,sender_id:4,content:'original',translations:{en:'English text','zh-CN':'Chinese text'},created_at:1}], history = null } = {}) {
 const calls = [];
 const shell = await shell_fixture(async(path,options) => {
  calls.push({path,options});
  if(path === '/chat/api/session') return Response.json({links:[link(1,'A'),link(2,'B')],csrf_token:'secret-csrf'});
  if(path === '/chat/api/state') return Response.json({client_id:101,messaging_enabled:true});
  if(path === '/chat/api/conversations') return Response.json({conversations});
  if(path.startsWith('/chat/api/messages?')) return history ? history(path) : Response.json({messages:messages(),has_more:true});
  return Response.json(demo_data);
 },true,false,storage);
 const choose = async name => { descendants(shell.elements.get('inbox')).find(e=>e.className === 'conversation' && e.children.find(child => child.className === 'conversation-copy')?.children[0].textContent === name).listeners.click(); await shell.settle(); };
 return {...shell,choose,calls};
}
const channels = [
 {conversation_kind:'guild',conversation_id:2,participant:{display_name:'Oak'}},
 {conversation_kind:'support',support_team_id:1,participant:{display_name:'Help'}},
 {conversation_kind:'testers',conversation_id:3,participant:{display_name:'Expedition'}},
 {conversation_kind:'private',conversation_id:4,participant:{client_id:4,display_name:'Other'}},
 {conversation_kind:'alliance',conversation_id:5,participant:{display_name:'Alliance'}},
 {conversation_kind:'global',conversation_id:1,participant:{display_name:'World'}}
];
test('shell groups six domain kinds in four ordered categories and uses plain conversation titles', async () => {
 const {elements,choose} = await inbox_shell({conversations:channels});
 assert.deepEqual(elements.get('inbox').children.map(e=>e.tagName === 'H3' ? e.textContent : e.children.find(child => child.className === 'conversation-copy')?.children[0].textContent),
  ['Global','World','Expedition','Guild','Alliance','Oak','Private','Other','Support','Help']);
 await choose('Alliance'); assert.equal(elements.get('thread-title').textContent,'Alliance');
 const empty = await inbox_shell({conversations:[]}); assert.equal(empty.elements.get('inbox').children.length,0);
 const partial = await inbox_shell({conversations:[channels[0]]});
 assert.deepEqual(partial.elements.get('inbox').children.map(e=>e.tagName === 'H3' ? e.textContent : e.children.find(child => child.className === 'conversation-copy')?.children[0].textContent),['Guild','Oak']);
 const html = await readFile(new URL('../../server/chat-assets/index.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/Participation and privacy|id="preferences"|id="refresh"|id="new-private"|Presentation language|id="locale"/);
 assert.match(html,/<div id="messages"[^>]*><button id="older"[^>]*>Load older messages<\/button><div id="message-rows">/);
 assert.match(html,/class="thread-header"[^]*id="thread-title"[^]*for="translation"[^]*Message translation[^]*<select id="translation"/);
});
test('translation is disabled by default, scoped to logical chat and explicit link, and persists only safe preferences', async () => {
 const values = new Map(); const storage = {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const shell = await inbox_shell({conversations:channels,storage}); const {elements,choose,settle} = shell;
 const text = () => descendants(elements.get('message-rows')).map(e=>e.textContent);
 const set = value => { elements.get('translation').value=value; elements.get('translation').listeners.change(); };
 await choose('World'); assert.equal(elements.get('translation').value,''); assert.ok(text().includes('original'));
 set('en'); assert.ok(text().includes('English text'));
 await choose('Oak'); assert.equal(elements.get('translation').value,''); set('zh-CN'); assert.ok(text().includes('Chinese text'));
 await choose('World'); assert.equal(elements.get('translation').value,'en');
 elements.get('identity').value='2'; elements.get('identity').listeners.change(); await settle(); await choose('World');
 assert.equal(elements.get('translation').value,'');
 elements.get('identity').value='1'; elements.get('identity').listeners.change(); await settle(); await choose('World');
 assert.equal(elements.get('translation').value,'en');
 const reopened = await inbox_shell({conversations:channels,storage}); await reopened.choose('Oak'); assert.equal(reopened.elements.get('translation').value,'zh-CN');
 assert.deepEqual([...values.entries()].filter(([key])=>key.startsWith('mp.chat.translation/')), [['mp.chat.translation/1/global:1','en'],['mp.chat.translation/1/guild:2','zh-CN']]);
 assert.equal([...values.values()].some(v=>String(v).includes('secret-csrf')),false);
 values.set('mp.chat.translation/1/global:1','invalid');
 const invalid = await inbox_shell({conversations:channels,storage}); await invalid.choose('World'); assert.equal(invalid.elements.get('translation').value,'');
 const denied = await inbox_shell({conversations:channels,storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}}});
 await denied.choose('World'); denied.elements.get('translation').value='en'; denied.elements.get('translation').listeners.change(); assert.equal(denied.elements.get('translation').value,'en');
 assert.equal(shell.calls.some(c=>/translation|language/.test(c.path)),false);
});
test('own messages remain original and have no translation toggle for the selected translation', async () => {
 const shell = await inbox_shell({conversations:channels,messages:()=>[{message_id:1,sender_id:101,sent_by_viewer:true,content:'my original',translations:{en:'my translated'},created_at:1}]});
 await shell.choose('World'); const {elements}=shell;
 elements.get('translation').value='en'; elements.get('translation').listeners.change();
 assert.ok(descendants(elements.get('message-rows')).some(e=>e.textContent === 'my original'));
 timestamp(elements).listeners.click(); assert.equal(action(elements,'Show original'),undefined); assert.equal(action(elements,'Show translation'),undefined);
});
test('quiet polling retains rows and enabled older control; actual older fetch disables and preserves prepend anchor', async () => {
 let finish, delay=false, older=false;
 const message = id=>({message_id:id,sender_id:4,content:String(id),created_at:1});
 const shell = await inbox_shell({conversations:channels,history:path=> {
  older=path.includes('before=');
  if(delay) return new Promise(resolve=>finish=resolve);
  return Response.json({messages:[10,11,12,13].map(message),has_more:true});
 }});
 await shell.choose('World'); const {elements,poll,settle}=shell;
 const list=elements.get('messages'), button=elements.get('older'), rows=elements.get('message-rows');
 assert.equal(list.scrollTop,list.scrollHeight); list.scrollTop=80;
 const first=rows.children[0]; delay=true;
 const polling=poll(); await settle(); assert.equal(button.disabled,false); assert.equal(rows.children[0],first);
 finish(Response.json({messages:[],has_more:true})); await polling;
 assert.equal(rows.children[0],first); assert.equal(list.scrollTop,80); assert.equal(button.hidden,false);
 button.listeners.click(); await settle(); assert.equal(older,true); assert.equal(button.disabled,true);
 finish(Response.json({messages:[8,9].map(message),has_more:false})); await settle();
 assert.equal(list.scrollTop,240); assert.equal(button.disabled,false); assert.equal(button.hidden,true); assert.equal(rows.children[0].children[1].children[0].children[0].textContent,'8');
 // Appends while reading history keep the current viewport, rather than shifting it as a prepend would.
 list.scrollTop=80; const next=poll(); await settle(); finish(Response.json({messages:[message(14)],has_more:true})); await next;
 assert.equal(list.scrollTop,80);
});

test('an older click during quiet polling runs once after success and is dropped on failure or selection change', async () => {
 for (const outcome of ['success','switch','failure']) {
  const switch_thread = outcome === 'switch';
  let finish_poll, finish_older, older_calls=0;
  const shell=await inbox_shell({conversations:channels,history:path=> {
   if(/[?&]after=/.test(path)) return new Promise(resolve=>finish_poll=resolve);
   if(path.includes('before=')) { older_calls++; return new Promise(resolve=>finish_older=resolve); }
   return Response.json({messages:[{message_id:10,sender_id:4,content:'ten',created_at:1}],has_more:true});
  }});
  await shell.choose('World'); const {elements,settle}=shell;
  const polling=shell.poll(); await settle();
  assert.equal(elements.get('older').disabled,false);
  elements.get('older').listeners.click(); elements.get('older').listeners.click();
  assert.equal(older_calls,0);
  if(switch_thread) await shell.choose('Oak');
  finish_poll(outcome === 'failure' ? new Response('',{status:429,headers:{'Retry-After':'5'}}) : Response.json({messages:[],has_more:true})); await settle();
  assert.equal(older_calls,outcome === 'success' ? 1 : 0);
  if(outcome === 'success') {
   assert.equal(elements.get('older').disabled,true);
   finish_older(Response.json({messages:[{message_id:9,sender_id:4,content:'nine',created_at:1}],has_more:false}));
  }
  await polling; assert.equal(elements.get('older').disabled,false);
  if(outcome === 'success') assert.equal(elements.get('older').hidden,true);
  if(outcome === 'failure') assert.match(elements.get('chat-notice').textContent,/Wait 5 seconds/);
 }
});

test('ordinary send has no uncertainty warning and confirmed send scrolls from older history to newest', async () => {
 let resolve_send;
 const {elements,settle,document} = await message_shell(false,7,'private',() => new Promise(resolve => { resolve_send = resolve; }));
 const list = elements.get('messages'); list.scrollTop = 0;
 elements.get('draft').value = 'hello';
 elements.get('draft').focus();
 elements.get('draft').listeners.keydown({key:'Enter',preventDefault(){}}); await settle();
 assert.equal(document.activeElement,elements.get('draft'));
 assert.equal(elements.get('draft').readOnly,true);
 assert.equal(elements.get('pending-warning').textContent,'');
 assert.equal(elements.get('retry-send').hidden,true);
 resolve_send(Response.json({message:{message_id:8,created_at:2,content:'sent'}})); await settle();
 assert.equal(list.scrollTop,list.scrollHeight);
 assert.equal(elements.get('draft').value,'');
 assert.equal(document.activeElement,elements.get('draft'));
 assert.equal(elements.get('draft').readOnly,false);
 assert.equal(elements.get('chat-notice').textContent,'');
});

test('unread badges show numeric counters and Inbox excludes the selected conversation', async () => {
 const channels = [
  {conversation_kind:'global',conversation_id:1,participant:{display_name:'World'},unread_count:3,unread_tagged:true},
  {conversation_kind:'guild',conversation_id:2,participant:{display_name:'Oak'},unread_count:2},
 ];
 const {elements,choose,poll} = await inbox_shell({conversations:channels});
 await choose('World');
 assert.equal(elements.get('mobile-inbox-unread').textContent,'2');
 assert.equal(elements.get('mobile-inbox-unread').hidden,false);
 assert.deepEqual(descendants(elements.get('inbox')).filter(e=>e.className === 'unread').map(e=>e.textContent),['3','2']);
 await choose('Oak');
 assert.equal(elements.get('mobile-inbox-unread').textContent,'3');
 channels[0].unread_count = 0;
 await poll();
 assert.equal(elements.get('mobile-inbox-unread').hidden,true);
});

test('Dev highlight dialog normalizes pasted hex, validates RGB, previews and clears after sending', async () => {
 const calls = [];
 const { elements, settle } = await shell_fixture(async (path, options) => {
  calls.push({ path, options });
  if (path === '/chat/api/session') return Response.json({ links: [link(1, 'Dev')], csrf_token: 'csrf' });
  if (path === '/chat/api/state') return Response.json({ client_id: 101, can_highlight: true, messaging_enabled: true });
  if (path === '/chat/api/conversations') return Response.json({ conversations: [{ conversation_kind: 'global', conversation_id: 1, participant: { display_name: 'Global' } }] });
  if (path.startsWith('/chat/api/messages?')) return Response.json({ messages: [] });
  if (path === '/chat/api/messages/send') return Response.json({ message: { message_id: 1, sender_id: 101, content: 'Hello', highlight_color: '#ABC123', created_at: 1 } });
  return Response.json(demo_data);
 }, true);
 descendants(elements.get('inbox')).find(e => e.className === 'conversation').listeners.click(); await settle();
 assert.equal(elements.get('highlight').hidden, false);
 elements.get('highlight').listeners.click();
 const swatches = descendants(elements.get('dialog-content')).filter(e => e.className === 'highlight-swatch');
 assert.equal(swatches.length, 8);
 const input = descendants(elements.get('dialog-content')).find(e => e.tagName === 'INPUT');
 const apply = elements.get('dialog-actions').children.find(e => e.textContent === 'Apply');
 input.value = '#12345678'; input.listeners.input(); assert.equal(apply.disabled, true);
 input.value = '#aBc123'; input.listeners.input(); assert.equal(input.value, 'ABC123'); assert.equal(apply.disabled, false);
 assert.match(descendants(elements.get('dialog-content')).find(e => e.className === 'highlight-sample').style.boxShadow, /#ABC123/);
 apply.listeners.click(); assert.match(elements.get('draft').style.boxShadow, /#ABC123/);
 elements.get('draft').value = 'Hello'; elements.get('draft').listeners.input();
 elements.get('composer').listeners.submit({ preventDefault() {} }); await settle();
 assert.equal(JSON.parse(calls.find(c => c.path === '/chat/api/messages/send').options.body).highlight_color, '#ABC123');
 assert.equal(elements.get('draft').style.boxShadow, '');
 elements.get('highlight').listeners.click(); swatches[0].listeners.click();
 elements.get('dialog-actions').children.find(e => e.textContent === 'Clear highlight').listeners.click();
 assert.equal(elements.get('draft').style.boxShadow, '');
});
