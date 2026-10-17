import { test } from 'node:test';
import assert from 'node:assert/strict';
import { create_chat_controller, conversation_key, poll_delay } from '../../server/chat-assets/controller.mjs';
import { create_transport, allowed_endpoint, ChatError } from '../../server/chat-assets/transport.mjs';
import { render_parts, presentation, safe_media } from '../../server/chat-assets/render.mjs';
const global = { conversation_kind: 'global', conversation_id: 1, participant: { client_id: null, display_name: 'Global' } };
const guild = { conversation_kind: 'guild', conversation_id: 1, participant: { client_id: null, display_name: 'Guild' } };
const private_chat = { conversation_kind:'private',conversation_id:9,participant:{client_id:4,display_name:'Other'} };
const message = (id, content = `message ${id}`) => ({ message_id:id,content,sender_id:5,sender:{display_name:'Sender'},created_at:1,reactions:[] });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise,resolve,reject }; };
function fixture(handler = () => undefined) {
	const calls = [], updates = [], timers = []; let foreground = true, clock = 100;
	const transport = { async request(path, options) {
		calls.push({ path, ...structuredClone(options) }); const value = handler(path,options);
		if (value !== undefined) return value;
		if (path.endsWith('conversations')) return {conversations:[global,guild,private_chat]};
		if (path.endsWith('state')) return {client_id:5,messaging_enabled:true};
		return {messages:[],has_more:false,reaction_revision:0};
	} };
	const controller = create_chat_controller({ transport, changed: v => updates.push({selected:v.selected, link:v.link, notice:v.notice}),
		visible: () => foreground, now: () => clock, key: () => 'fixed-key', random: () => .5,
		schedule: (fn,delay) => {timers.push({fn,delay}); return timers.length;}, cancel() {} });
	return {controller,calls,updates,timers,foreground(value){foreground=value;},clock(value){clock=value;}};
}
test('exact endpoint and query allowlist excludes arbitrary URLs, kinds, duplicates and game authority', async () => {
	for (const path of ['/chat/api/messages?conversation_kind=global&conversation_id=1&after=2&reaction_after=0','/chat/api/profile?people=1']) assert.equal(allowed_endpoint(path,'GET'),true);
	for (const path of ['https://evil/chat/api/state','/chat/api/messages?conversation_kind=poll-discussion','/chat/api/messages?url=https://evil','/chat/api/state?capabilities=admin','/chat/api/profile?client_id=1&client_id=2','/chat/api/messages?after=-1','/chat/api/messages?after=9007199254740992','/chat/api/session#fragment','/chat/api/../api/events']) assert.equal(allowed_endpoint(path,'GET'),false,path);
	assert.equal(allowed_endpoint('/chat/api/messages/send','GET'),false);
	assert.equal(allowed_endpoint('/chat/api/messages/delete-for-all','POST'),false);
});
test('200 domain failures and throttles are errors; Retry-After also guides backoff', async () => {
	const transport = create_transport({fetcher:async () => Response.json({error_lang:'MOD_MP_CHAT_CONVERSATION_MISSING'})});
	await assert.rejects(transport.request('/chat/api/messages?conversation_kind=global&conversation_id=1'), error => error.code === 'MOD_MP_CHAT_CONVERSATION_MISSING');
	const rate = create_transport({fetcher:async () => Response.json({success:false,retry_after_ms:1234})});
	await assert.rejects(rate.request('/chat/api/messages/send',{method:'POST'}), error => error.retry_after_ms === 1234);
	const http = create_transport({fetcher:async () => new Response('wait',{status:429,headers:{'Retry-After':'12'}})});
	await assert.rejects(http.request('/chat/api/state'), error => error.retry_after_ms === 12000);
	assert.equal(poll_delay(9,0,() => 0),54000); assert.equal(poll_delay(0,20000),20000);
});
test('late history and people responses cannot repaint another conversation with colliding message IDs', async () => {
	const history = deferred(), people = deferred();
	const f = fixture(path => path.includes('conversation_kind=global') ? path.includes('people=1') ? people.promise : history.promise : undefined);
	await f.controller.set_identity(1,'csrf'); const old = f.controller.select(global); const people_request = f.controller.people(true);
	await f.controller.select(guild); history.resolve({messages:[message(7,'old global')],reaction_revision:5}); people.resolve({people:[{client_id:100}]});
	await old; assert.deepEqual(await people_request,[]);
	assert.equal(f.controller.view().selected,conversation_key(guild)); assert.deepEqual(f.controller.view().entry.messages,[]);
	f.controller.draft('guild draft'); await f.controller.select(global); // cached resolved request
	assert.equal(f.controller.view().entry.draft,''); await f.controller.select(guild); assert.equal(f.controller.view().entry.draft,'guild draft');
});
test('ambiguous send retains immutable payload and key across conversation and identity switches; explicit retry only', async () => {
	const lost = deferred(); let sends = 0;
	const f = fixture((path, options) => {
		if (path.endsWith('messages/send')) return ++sends === 1 ? lost.promise : {success:true,message:message(11,options.body.content)};
	});
	await f.controller.set_identity(1,'csrf1'); await f.controller.select(global); f.controller.draft('original');
	const sending = f.controller.send(); await f.controller.send(); assert.equal(sends,1);
	await f.controller.select(guild); f.controller.draft('new guild draft'); lost.reject(new Error('Lost response')); await sending;
	assert.equal(f.controller.view().entry.draft,'new guild draft'); assert.equal(f.controller.view().notice,'');
	await f.controller.set_identity(2,'csrf2'); await f.controller.select(global); assert.equal(f.controller.view().entry.pending,null); f.controller.draft('identity 2');
	await f.controller.set_identity(1,'fresh-csrf'); await f.controller.select(global);
	f.controller.draft('cannot overwrite original'); await f.controller.send(); assert.equal(sends,1);
	assert.equal(f.controller.view().entry.pending.body.content,'original');
	await f.controller.send(true); const requests = f.calls.filter(c => c.path.endsWith('messages/send'));
	assert.equal(requests.length,2); assert.deepEqual(requests[0].body,requests[1].body);
	assert.equal(requests[1].link,1); assert.equal(requests[1].csrf,'csrf1'); assert.equal(f.controller.view().entry.pending,null);
	assert.equal(f.controller.view().entry.draft,'');
});
test('late successful send settles only its owner and never clears the new selection draft', async () => {
	const response = deferred(); const f = fixture(path => path.endsWith('messages/send') ? response.promise : undefined);
	await f.controller.set_identity(1,'csrf'); await f.controller.select(global); f.controller.draft('A'); const send = f.controller.send();
	await f.controller.select(guild); f.controller.draft('B'); response.resolve({message:message(9,'A')}); await send;
	assert.equal(f.controller.view().entry.draft,'B'); assert.deepEqual(f.controller.view().entry.messages,[]);
	await f.controller.select(global); assert.equal(f.controller.view().entry.pending,null);
});
test('only foreground selected history acknowledges reads; inbox does not fan out histories and loop rearms after failure', async () => {
	let fail = false; const f = fixture(path => { if (fail && path.endsWith('conversations')) throw new ChatError(503); });
	await f.controller.set_identity(1,'csrf'); assert.equal(f.calls.filter(c => c.path.includes('/messages')).length,0);
	await f.controller.select(global); const count = f.calls.length;
	f.foreground(false); await f.controller.history(); await f.controller.tick(); assert.equal(f.calls.length,count);
	f.foreground(true); fail=true; await f.controller.tick(); assert.equal(f.timers.at(-1).delay,10000);
	fail=false; await f.controller.tick(); assert.equal(f.timers.at(-1).delay,5000);
	assert.ok(f.calls.filter(c => c.path.includes('/messages')).every(c => c.path.includes('conversation_kind=global')));
});
test('older/incremental pages merge by selected scope and apply reaction revisions without replacing messages', async () => {
	const f = fixture(path => {
		if (!path.includes('/messages?')) return;
		if (path.includes('before=5')) return {messages:[message(3),message(4)],has_more:false,reaction_revision:7};
		if (path.includes('after=6')) return {messages:[message(7)],has_more:false,reaction_revision:8,reaction_updates:[{message_id:5,reactions:[{reaction:'👍',count:2,reacted:true}]}]};
		return {messages:[message(5),message(6)],has_more:true,reaction_revision:6};
	});
	await f.controller.set_identity(1,'csrf'); await f.controller.select(global); await f.controller.history('older'); await f.controller.history();
	assert.deepEqual(f.controller.view().entry.messages.map(m => m.message_id),[3,4,5,6,7]);
	assert.equal(f.controller.view().entry.messages.find(m => m.message_id===5).reactions[0].count,2);
	assert.equal(f.controller.view().entry.has_more,false); assert.ok(f.calls.at(-1).path.includes('reaction_after=7'));
});
test('domain denial clears messages and disables composer; virtual Support has no durable details or reaction actions', async () => {
	let denied = false; const f = fixture(path => path.includes('/messages?') ? denied ? Promise.reject(new ChatError(200,{error_lang:'MOD_MP_CHAT_CONVERSATION_MISSING'})) : {messages:[message(1)]} : undefined);
	await f.controller.set_identity(1,'csrf'); await f.controller.select(global); denied=true; await f.controller.history();
	assert.equal(f.controller.view().entry.denied,true); assert.deepEqual(f.controller.view().entry.messages,[]);
	f.controller.draft('no send'); await f.controller.send(); assert.equal(f.calls.some(c => c.path.endsWith('/send')),false);
	const support={conversation_kind:'support',conversation_id:null,support_team_id:2,participant:{client_id:null,display_name:'Team'}};
	denied=false; await f.controller.select(support); const count=f.calls.length;
	assert.equal(await f.controller.details(0),null); await f.controller.reaction(0,'👍',true); assert.equal(f.calls.length,count);
});
test('membership disappearance clears prior history; stale 401 cannot revoke a new identity', async () => {
	const old=deferred(); let disappear=false, revoked=[];
	const f=fixture(path => path.endsWith('conversations') && disappear ? {conversations:[global]} : path.includes('/messages?') && path.includes('guild') ? old.promise : undefined);
	await f.controller.set_identity(1,'csrf'); const loading=f.controller.select(guild);
	await f.controller.set_identity(2,'csrf'); await f.controller.select(global); old.reject(new ChatError(401)); await loading;
	assert.equal(f.controller.view().link,2); assert.equal(f.controller.view().notice,'');
	disappear=true; await f.controller.select(private_chat); await f.controller.tick(); assert.equal(f.controller.view().entry.denied,true);
});
test('single-flight mutations and immutable throttled send require explicit retry after wait', async () => {
	let sends=0; const mutation=deferred();
	const f=fixture(path => path.endsWith('messages/send') ? (++sends===1 ? Promise.reject(new ChatError(200,{success:false,retry_after_ms:1000})) : {message:message(1)}) : path.endsWith('privacy') ? mutation.promise : undefined);
	await f.controller.set_identity(1,'csrf'); await f.controller.select(global); f.controller.draft('limited'); await f.controller.send();
	await f.controller.send(true); assert.equal(sends,1); f.clock(1101); await f.controller.send(true); assert.equal(sends,2);
	const one=f.controller.preference('privacy',{messaging_enabled:false}); await f.controller.preference('privacy',{messaging_enabled:false});
	assert.equal(f.calls.filter(c => c.path.endsWith('privacy')).length,1); mutation.resolve({success:true}); await one;
});
test('rendering uses text nodes for hostile originals, translations and typed parts; only validated demo media renders', () => {
	class Element { constructor(tag){this.tag=tag;this.children=[];} set textContent(v){this.text=v;} append(...nodes){this.children.push(...nodes);} addEventListener(){} }
	const document={createElement:tag=>new Element(tag)}, target=new Element('div');
	const hostile='<img src=x onerror=alert(1)>';
	render_parts(document,target,[{type:'text',text:hostile},{type:'person',client_id:3,display_name:hostile},{type:'item',item_id:'melvorItA:Unknown_Item'},{type:'feature',feature_id:'multiplayer:Badge_New_Member'}],'',[]);
	assert.equal(target.children[0].text,hostile); assert.equal(target.children[1].children[0].text,hostile);
	assert.equal(target.children[2].title,'melvorItA:Unknown_Item');
	assert.equal(target.children[2].children[0].text,'Unknown Item');
	assert.equal(target.children[2].children.some(c => c.tag==='img'),false);
	const p=presentation({content:'original',translations:{en:hostile},translation_parts:{en:[{type:'text',text:hostile}]}},'en');
	assert.equal(p.text,hostile); assert.equal(presentation({content:'original',translations:{en:hostile}},'en',true).text,'original');
	assert.equal(safe_media('https://evil.test/a.png'),false); assert.equal(safe_media('https://cdn2-main.melvor.net/assets/media/../secret'),false);
	assert.equal(safe_media('https://cdn2-main.melvor.net/assets/media/bank/test.png'),true);
});
test('Private and Support history moderation changes rebuild the selected page with a fresh reaction cursor', async () => {
	for (const kind of ['private','support']) {
		let hidden=false; const c=kind==='private'?private_chat:{conversation_kind:'support',conversation_id:9,support_team_id:2,participant:{client_id:null,display_name:'Team'}};
		const f=fixture(path => {
			if (path.endsWith('conversations')) return {conversations:[c]};
			if (path.includes('/messages?')) return hidden ? {messages:/[?&]after=/.test(path)?[]:[message(2)],moderation_count:1,reaction_revision:4} : {messages:[message(1),message(2)],moderation_count:0,reaction_revision:3};
		});
		await f.controller.set_identity(1,'csrf'); await f.controller.select(c); hidden=true; await f.controller.history();
		assert.deepEqual(f.controller.view().entry.messages.map(m=>m.message_id),[2]);
		assert.ok(f.calls.at(-1).path.includes('reaction_after=0')); assert.ok(!/[?&]after=/.test(f.calls.at(-1).path));
	}
});
test('shared-channel inbox moderation invalidates cached rows before fetching fresh selected history', async () => {
	let hidden=false; const f=fixture(path=> {
		if (path.endsWith('conversations')) return {conversations:[{...global,moderation_count:hidden?1:0}]};
		if (path.includes('/messages?')) return {messages:hidden?[message(2)]:[message(1),message(2)],reaction_revision:3};
	});
	await f.controller.set_identity(1,'csrf'); await f.controller.select(f.controller.view().inbox[0]); hidden=true; await f.controller.tick();
	assert.deepEqual(f.controller.view().entry.messages.map(m=>m.message_id),[2]); assert.ok(f.calls.at(-1).path.includes('reaction_after=0'));
});
test('canonical privacy failure stops sending and clears inaccessible content',async()=>{
	const f=fixture(path=>path.endsWith('/send')?Promise.reject(new ChatError(200,{error_lang:'MOD_MP_CHAT_RECIPIENT_UNAVAILABLE'})):undefined);
	await f.controller.set_identity(1,'csrf'); await f.controller.select(private_chat); f.controller.draft('hello'); await f.controller.send();
	assert.equal(f.controller.view().entry.denied,true); assert.match(f.controller.view().notice,/privacy/);
});
test('Support details use only the exact details query allowlist',async()=>{
	const calls=[]; const transport=create_transport({fetcher:async(path)=>{
		calls.push(path); if(path.endsWith('conversations'))return Response.json({conversations:[]});
		if(path.includes('/messages/details'))return Response.json({seen:[],reactions:[]});
		return Response.json(path.includes('/messages?')?{messages:[message(5)]}:{});
	}});
	const controller=create_chat_controller({transport,schedule:()=>1,cancel(){}});
	await controller.set_identity(1,'csrf'); await controller.select({conversation_kind:'support',conversation_id:9,support_team_id:2,participant:{client_id:null}});
	assert.deepEqual(await controller.details(5),{seen:[],reactions:[]}); assert.ok(!calls.at(-1).includes('support_team_id'));
});
test('explicit reopen safely recovers restored access only after history validation; late denial stays with prior selection',async()=>{
	let denied=true, validate=null;
	const f=fixture(path=>{
		if(path.includes('/messages?') && path.includes('conversation_kind=private')) {
			if(denied)return Promise.reject(new ChatError(403));
			if(validate)return validate.promise;
			return {messages:[message(1)]};
		}
	});
	await f.controller.set_identity(1,'csrf'); await f.controller.select(private_chat);
	assert.equal(f.controller.view().entry.denied,true);
	denied=false; validate=deferred(); const reopen=f.controller.select(private_chat);
	assert.equal(f.controller.view().entry.validating,true); f.controller.draft('wait for access'); await f.controller.send();
	assert.equal(f.calls.some(c=>c.path.endsWith('/send')),false);
	validate.resolve({messages:[message(1)]}); await reopen;
	assert.equal(f.controller.view().entry.denied,false); assert.equal(f.controller.view().entry.validating,false);
	assert.equal(f.controller.view().entry.messages[0].message_id,1);
	validate=deferred(); const old=f.controller.select(private_chat); await f.controller.select(global);
	validate.reject(new ChatError(403)); await old;
	assert.equal(f.controller.view().entry.denied,false); assert.equal(f.controller.view().selected,conversation_key(global));
});
test('mutation Retry-After guidance prevents another request until its cooldown expires',async()=>{
	let attempts=0;
	const f=fixture(path=>path.endsWith('privacy') ? (++attempts===1 ? Promise.reject(new ChatError(429,{},2000)) : {success:true}) : undefined);
	await f.controller.set_identity(1,'csrf'); await f.controller.preference('privacy',{messaging_enabled:false});
	await f.controller.preference('privacy',{messaging_enabled:false}); assert.equal(attempts,1);
	f.clock(2101); await f.controller.preference('privacy',{messaging_enabled:false}); assert.equal(attempts,2);
});
test('pending translation polling refreshes persisted presentation only within its bounded wait',async()=>{
	let fresh=false;
	const f=fixture(path=>path.includes('/messages?') ? {messages:[{...message(5),created_at:1,translation_status:fresh?'complete':'queued',translation_enqueued_at:1,...(fresh?{translations:{en:'translated'}}:{})}]} : undefined);
	await f.controller.set_identity(1,'csrf'); await f.controller.select(global); fresh=true; await f.controller.history();
	assert.ok(!/[?&]after=/.test(f.calls.at(-1).path)); assert.equal(f.controller.view().entry.messages[0].translations.en,'translated');
	await f.controller.history(); assert.ok(/[?&]after=5/.test(f.calls.at(-1).path));
});
test('new Private draft uses selected-identity people without acknowledging a nonexistent history; typed tags preserve separators',async()=>{
	const f=fixture(path=>path.includes('profile?people=1')?{people:[{client_id:4,display_name:'Other'}]}:path.endsWith('/send')?{message:message(1)}:undefined);
	await f.controller.set_identity(1,'csrf'); await f.controller.select({...private_chat,conversation_id:null});
	const people=await f.controller.people(true); assert.equal(people[0].client_id,4);
	f.controller.tag({type:'item',item_id:'melvorD:Item'}); f.controller.tag({type:'person',client_id:4,display_name:'Other'}); f.controller.draft('hello');
	await f.controller.send(); const sent=f.calls.find(c=>c.path.endsWith('/send'));
	assert.equal(sent.body.content,'[Item] @Other hello'); assert.deepEqual(sent.body.parts.map(p=>p.type),['item','text','person','text','text']); assert.equal(sent.link,1);
});
test('external Support materialization replaces the virtual welcome while retaining its draft owner',async()=>{
	let materialized=false;
	const support={conversation_kind:'support',conversation_id:null,support_team_id:2,participant:{client_id:null,display_name:'Team'}};
	const f=fixture(path=>path.endsWith('conversations')?{conversations:[{...support,conversation_id:materialized?12:null}]}:path.includes('/messages?')?{messages:[message(materialized?1:0,'welcome')],has_more:false}:undefined);
	await f.controller.set_identity(1,'csrf'); await f.controller.select(support); f.controller.draft('retained draft');
	materialized=true; await f.controller.tick();
	assert.equal(f.controller.view().entry.draft,'retained draft'); assert.deepEqual(f.controller.view().entry.messages.map(m=>m.message_id),[1]);
	assert.equal(f.controller.view().entry.conversation.conversation_id,12);
});
test('missing profile or a newly hidden Message does not revoke the entire selected conversation',async()=>{
	const f=fixture(path=>path.includes('profile?client_id=')||path.includes('messages/details?')?Promise.reject(new ChatError(404)):path.includes('/messages?')?{messages:[message(1),message(2)]}:undefined);
	await f.controller.set_identity(1,'csrf'); await f.controller.select(global);
	assert.equal(await f.controller.profile(99),null); assert.equal(f.controller.view().entry.denied,false);
	assert.equal(await f.controller.details(1),null); assert.equal(f.controller.view().entry.denied,false);
	assert.deepEqual(f.controller.view().entry.messages.map(m=>m.message_id),[2]);
});
test('first Support reply reloads its materialized welcome without acknowledging an offscreen owner',async()=>{
	for (const offscreen of [false,true]) {
		let materialized=false; const send=deferred();
		const support={conversation_kind:'support',conversation_id:null,support_team_id:2,participant:{client_id:null,display_name:'Team'}};
		const welcome={...message(1,'durable welcome'),conversation_id:12}; const reply={...message(2,'reply'),conversation_id:12};
		const f=fixture(path=>{
			if(path.endsWith('conversations'))return {conversations:[global,{...support,conversation_id:materialized?12:null}]};
			if(path.endsWith('/send'))return send.promise;
			if(path.includes('conversation_kind=support'))return {messages:materialized?[welcome,reply]:[message(0,'virtual welcome')],reaction_revision:0};
		});
		await f.controller.set_identity(1,'csrf'); await f.controller.select(support); f.controller.draft('reply');
		const sending=f.controller.send(); if(offscreen)await f.controller.select(global);
		const count=f.calls.filter(c=>c.path.includes('conversation_kind=support')).length;
		materialized=true; send.resolve({message:reply}); await sending;
		if(offscreen){
			assert.equal(f.calls.filter(c=>c.path.includes('conversation_kind=support')).length,count);
			await f.controller.select({...support,conversation_id:12});
		}
		assert.deepEqual(f.controller.view().entry.messages.map(m=>m.message_id),[1,2]);
		const last=f.calls.filter(c=>c.path.includes('conversation_kind=support')).at(-1);
		assert.ok(!/[?&]after=/.test(last.path)); assert.ok(last.path.includes('reaction_after=0'));
		assert.equal(f.controller.view().entry.pending,null); assert.equal(f.controller.view().entry.draft,'');
	}
});
