import { expect, test } from 'bun:test';
import { create_demo_adapter, DEMO_SOURCES, normalize_demo, normalize_presentation, demo_media, unknown_item } from '../../chat-demo-data';
const resolver = 'return `https://cdn2-main.melvor.net${getPathWithoutFile()}/`';
const demo = { namespace: 'melvorD', data: { items: [{ id: 'Test_Item', media: 'assets/media/items/test.png' }] } };
const english = { ITEM_NAME_Test_Item: 'English item' };
function fixture(path: string) { return path.endsWith('assets.js') ? resolver : JSON.stringify(path.endsWith('melvorDemo.json') ? demo : /melvor(Full|TotH|Expansion2|ItA)\.json$/.test(path) ? {namespace:'melvorF',data:{items:[]}} : path.endsWith('/de.json') ? { ITEM_NAME_Other: 'Andere' } : english); }
test('normalizes namespaced IDs, English fallback, safe media and unknown content', () => {
	expect(normalize_demo(demo, {}, english, resolver)).toEqual([{ id: 'melvorD:Test_Item', name: 'English item', media: 'https://cdn2-main.melvor.net/assets/media/items/test.png' }]);
	for (const path of ['https://evil.test/x', 'assets/media/../x', 'assets/media/x.svg?url=evil', '//evil.test/x'])
		expect(demo_media(path, 'https://cdn2-main.melvor.net/')).toBeNull();
	expect(unknown_item('mod:Unknown_Item')).toEqual({ id: 'mod:Unknown_Item', name: 'Unknown Item', media: null });
	expect(() => normalize_demo({ ...demo, namespace: 'melvorTotH' }, {}, english, resolver)).toThrow();
	expect(() => normalize_demo(demo, {}, english, 'arbitrary JS')).toThrow();
});
test('fixed sources, inflight deduplication, finite cache, freshness and limited stale', async () => {
	let at = 100, calls = 0, fail = false;
	const fetcher = (async (input: any, options: any) => {
		calls++;
		expect(input.origin).toBe('https://steam.melvoridle.com');
		expect(Object.values(DEMO_SOURCES)).toContain(input.pathname.slice(1));
		expect(options.credentials).toBe('omit');
		expect(options.redirect).toBe('error');
		expect(options.headers).toBeUndefined();
		if (fail)
			throw new Error('offline');
		return new Response(fixture(input.pathname));
	});
	const adapter = create_demo_adapter({ fetcher, now: () => at, fresh_ms: 10, stale_ms: 100 });
	const [a, b] = await Promise.all([adapter.load('arbitrary-url'), adapter.load('en')]);
	expect(calls).toBe(7);
	expect(a.locale).toBe('en');
	expect(b.provenance.stale).toBe(false);
	await adapter.load('en');
	expect(calls).toBe(7);
	await adapter.load('de');
	await adapter.load('zh-CN');
	expect(calls).toBe(9);
	fail = true;
	at = 120;
	expect((await adapter.load('de')).provenance.stale).toBe(true);
	at = 201;
	await expect(adapter.load('en')).rejects.toThrow('unavailable');
});
test('rejects streamed oversize before assembly, redirected responses, malformed JSON and drift', async () => {
	let cancelled = false;
	const oversized = create_demo_adapter({ maximum_bytes: 4, fetcher: (async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; } }))) });
	await expect(oversized.load('en')).rejects.toThrow();
	expect(cancelled).toBe(true);
	const redirected = new Response('{}');
	Object.defineProperty(redirected, 'redirected', { value: true });
	await expect(create_demo_adapter({ fetcher: (async () => redirected) }).load('en')).rejects.toThrow();
	await expect(create_demo_adapter({ fetcher: (async () => new Response('{')) }).load('en')).rejects.toThrow();
	await expect(create_demo_adapter({ fetcher: (async (input: any) => new Response(input.pathname.endsWith('assets.js') ? resolver : '{}')) }).load('en')).rejects.toThrow();
});
test('schema and resolver drift retain last good cache only inside stale lifetime; IDs are bounded', async () => {
	let at = 1, drift = false;
	const adapter = create_demo_adapter({ now: () => at, fresh_ms: 10, stale_ms: 100, fetcher: async (input: URL) => new Response(drift ? (input.pathname.endsWith('assets.js') ? 'changed resolver' : '{}') : fixture(input.pathname)) });
	await adapter.load('en');
	drift = true;
	at = 12;
	const stale = await adapter.load('en');
	expect(stale.provenance.stale).toBe(true);
	expect(stale.items[0].id).toBe('melvorD:Test_Item');
	at = 102;
	await expect(adapter.load('en')).rejects.toThrow();
	expect(() => normalize_demo({ namespace: 'melvorD', data: { items: [{ id: 'x'.repeat(249) }] } }, {}, {}, resolver)).toThrow();
});
test('upstream timeout is bounded and missing supported locale falls back to English', async () => {
	const timeout = create_demo_adapter({ timeout_ms: 5, fetcher: async (_input, init) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(Error('timeout')))) });
	await expect(timeout.load('en')).rejects.toThrow('unavailable');
	const adapter = create_demo_adapter({ fetcher: async (input) => { if (input.pathname.endsWith('/de.json'))
			throw Error('offline'); return new Response(fixture(input.pathname)); } });
	const result = await adapter.load('de');
	expect(result.locale).toBe('en');
	expect(result.items[0].name).toBe('English item');
});

test('presentation metadata includes official avatars and strips hostile media without game execution', () => {
 const result = normalize_presentation({namespace:'melvorF',data:{items:[{id:'Ring',name:'Ring',media:'https://evil.test/x'}],monsters:[{id:'Monster',media:'assets/media/monsters/test.png'}],skillData:[{skillID:'melvorD:Thieving',data:{npcs:[{id:'Chef',media:'assets/media/skills/thieving/chef.png'}]}}]}},{});
 expect(result.items[0].media).toBeNull();
 expect(result.avatars.map(value=>value.id)).toEqual(['melvorF:Monster','melvorF:Chef']);
 expect(() => normalize_presentation({namespace:'custom',data:{items:[]}},{})).toThrow();
});
