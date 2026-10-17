// Official presentation definitions only. This module never evaluates upstream source.
export const DEMO_SOURCES = Object.freeze({
	items: 'assets/data/melvorDemo.json', full: 'assets/data/melvorFull.json',
	toth: 'assets/data/melvorTotH.json', aod: 'assets/data/melvorExpansion2.json', ita: 'assets/data/melvorItA.json', en: 'lang/en.json', de: 'lang/de.json',
	'zh-CN': 'lang/zh-CN.json', assets: 'assets/js/built/assets.js'
});
export const DEMO_ORIGIN = 'https://steam.melvoridle.com/';
export const MEDIA_ORIGIN = 'https://cdn2-main.melvor.net';
export type DemoItem = {
	id: string;
	name: string;
	media: string | null;
};
export function supported_locale(locale: string): 'en' | 'de' | 'zh-CN' {
	return locale === 'de' || locale === 'zh-CN' ? locale : 'en';
}
export function unknown_item(id: string): DemoItem {
	return { id, name: id.split(':').slice(1).join(':').replaceAll('_', ' ') || id, media: null };
}
export function demo_media(path: unknown, root: string): string | null {
	return root === `${MEDIA_ORIGIN}/` && typeof path === 'string' &&
		/^assets\/media\/[A-Za-z0-9_./=-]+$/.test(path) && !path.includes('..')
		? new URL(path, root).href : null;
}
// Public package names come from Melvor's cloudManager.js data loader. Only presentation
// metadata is returned; no game code is evaluated and no gameplay authority is introduced.
const presentation_packages = new Set(['full', 'toth', 'aod', 'ita']);
function package_data(data: any): boolean {
	return ['melvorD','melvorF','melvorTotH','melvorAoD','melvorItA'].includes(data?.namespace) &&
		Array.isArray(data.data?.items) && data.data.items.length <= 20000;
}
export function normalize_presentation(data: any, language: any): { items: DemoItem[]; avatars: DemoItem[] } {
	if (!package_data(data)) throw new Error('Official presentation schema changed');
	const normalize = (entry: any): DemoItem[] => {
		if (!entry || typeof entry.id !== 'string' || entry.id.length > 248 || !/^[A-Za-z0-9_]+$/.test(entry.id)) return [];
		const name = [language?.[`ITEM_NAME_${entry.id}`],entry.name,entry.id.replaceAll('_',' ')].find(value => typeof value === 'string' && value.length > 0 && value.length <= 500);
		return [{ id: `${data.namespace}:${entry.id}`, name,
			media: demo_media(entry.mediaAnimation ?? entry.media, `${MEDIA_ORIGIN}/`) }];
	};
	const avatars = [...(data.data.monsters ?? []), ...(data.data.pets ?? []),
		...(data.data.skillData ?? []).flatMap((skill: any) => skill.skillID === 'melvorD:Thieving' ? skill.data?.npcs ?? [] : [])];
	return { items: data.data.items.flatMap(normalize), avatars: avatars.flatMap(normalize) };
}
function valid_resolver(source: string): boolean {
	return /return\s+[`'"]https:\/\/cdn2-main\.melvor\.net\$\{getPathWithoutFile\(\)\}\/[`'"]/.test(source);
}
function demo_items(data: any): any[] {
	if (data?.namespace !== 'melvorD' || !Array.isArray(data.data?.items) || data.data.items.length > 10000)
		throw new Error('Official demo schema changed');
	const ids = new Set();
	for (const item of data.data.items) {
		if (typeof item?.id !== 'string' || item.id.length > 248 || !/^[A-Za-z0-9_]+$/.test(item.id) || ids.has(item.id))
			throw new Error('Official item schema changed');
		ids.add(item.id);
	}
	return data.data.items;
}
function language_object(value: any): boolean {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function normalize_demo(data: any, language: any, english: any, source: string): DemoItem[] {
	if (!valid_resolver(source))
		throw new Error('Official asset resolver changed');
	if (!language_object(language) || !language_object(english))
		throw new Error('Official language schema changed');
	return demo_items(data).map((item: any) => {
		const labels = [language[`ITEM_NAME_${item.id}`], english[`ITEM_NAME_${item.id}`], item.name, item.id.replaceAll('_', ' ')];
		const name: string = labels.find(value => typeof value === 'string' && value.length > 0 && value.length <= 500)!;
		return { id: `melvorD:${item.id}`, name, media: demo_media(item.mediaAnimation ?? item.media, `${MEDIA_ORIGIN}/`) };
	});
}
export function create_demo_adapter({ fetcher = fetch as (input: URL, init: RequestInit) => Promise<Response>, now = Date.now, maximum_bytes = 8000000, fresh_ms = 3600000, stale_ms = 86400000, timeout_ms = 15000 } = {}) {
	type Key = keyof typeof DEMO_SOURCES;
	const cache = new Map<Key, {
		text: string;
		at: number;
	}>();
	const pending = new Map<Key, Promise<{
		text: string;
		at: number;
		stale: boolean;
	}>>();
	async function source(key: Key): Promise<{
		text: string;
		at: number;
		stale: boolean;
	}> {
		const old = cache.get(key);
		if (old && now() - old.at < fresh_ms)
			return { ...old, stale: false };
		const existing = pending.get(key);
		if (existing)
			return existing;
		const task = (async () => {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeout_ms);
			try {
				const response = await fetcher(new URL(DEMO_SOURCES[key], DEMO_ORIGIN), {
					redirect: 'error', credentials: 'omit', signal: controller.signal
				});
				if (!response.ok || response.redirected || !response.body)
					throw new Error('Official source unavailable');
				if (Number(response.headers.get('Content-Length')) > maximum_bytes) {
					await response.body.cancel();
					throw new Error('Official source too large');
				}
				const reader = response.body.getReader();
				const chunks: Uint8Array[] = [];
				let size = 0;
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done)
							break;
						size += value.byteLength;
						if (size > maximum_bytes)
							throw new Error('Official source too large');
						chunks.push(value);
					}
				}
				catch (error) {
					await reader.cancel().catch(() => { });
					throw error;
				}
				const bytes = new Uint8Array(size);
				let offset = 0;
				for (const chunk of chunks) {
					bytes.set(chunk, offset);
					offset += chunk.length;
				}
				const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
				// Validate before replacing the last good cache; drift can use bounded stale data.
				if (key === 'assets') {
					if (!valid_resolver(text))
						throw new Error('Resolver drift');
				}
				else {
					const parsed = JSON.parse(text);
					if (key === 'items')
						demo_items(parsed);
					else if (presentation_packages.has(key)) { if (!package_data(parsed)) throw new Error('Official presentation schema changed'); }
					else if (!language_object(parsed) || !Object.entries(parsed).some(([name, value]) => name.startsWith('ITEM_NAME_') && typeof value === 'string'))
						throw new Error('Language drift');
				}
				const value = { text, at: now() };
				cache.set(key, value);
				return { ...value, stale: false };
			}
			catch {
				if (old && now() - old.at <= stale_ms)
					return { ...old, stale: true };
				throw new Error('Official demo data unavailable');
			}
			finally {
				clearTimeout(timer);
			}
		})();
		pending.set(key, task);
		try {
			return await task;
		}
		finally {
			pending.delete(key);
		}
	}
	return { async load(requested_locale: string) {
			const locale = supported_locale(requested_locale);
			const [items, english, localized, assets] = await Promise.all([source('items'), source('en'), source(locale).catch(() => null), source('assets')]);
			const language = localized ?? english;
			const extra = await Promise.all((['full','toth','aod','ita'] as const).map(key => source(key).catch(() => null)));
			const definitions = [items,...extra.filter(value => value !== null)].map(value => normalize_presentation(JSON.parse(value.text),JSON.parse(language.text)));
			return { locale: localized ? locale : 'en', items: [...normalize_demo(JSON.parse(items.text), JSON.parse(language.text), JSON.parse(english.text), assets.text), ...definitions.slice(1).flatMap(value => value.items)],
				avatars: definitions.flatMap(value => value.avatars),
				provenance: { package: 'melvorDemo', adapter_version: 1, source: DEMO_ORIGIN,
					paths: [DEMO_SOURCES.items, DEMO_SOURCES.en, DEMO_SOURCES[localized ? locale : 'en'], DEMO_SOURCES.assets],
					fetched_at: Math.min(items.at, english.at, language.at, assets.at), stale: [items, english, language, assets].some(v => v.stale) } };
		} };
}
