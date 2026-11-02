import { test } from 'node:test';
import assert from 'node:assert/strict';
import { create_equipment_catalog_cache } from '../../mod/equipment-catalog.mjs';

const full = revision => ({ equipment_projects: { catalog_revision: revision, catalog: [{ item_id: revision }], access: [{ slot: 'Weapon' }], project: { id: 1 } } });
test('catalog cache negotiates only equipment routes, hydrates fresh player data and isolates sessions', () => {
	let scope = 'server-a:1';
	const cache = create_equipment_catalog_cache(() => scope);
	assert.equal(cache.prepare('/api/events').endpoint, '/api/events');
	const first = cache.prepare('/api/expedition/personal');
	assert.match(first.endpoint, /equipment_catalog=full$/);
	assert.deepEqual(first.hydrate(full('a')), full('a'));
	const read = cache.prepare('/api/expedition/state?view=tracking');
	assert.match(read.endpoint, /view=tracking&equipment_catalog=a$/);
	assert.deepEqual(read.hydrate({ equipment_projects: { catalog_revision: 'a', project: null } }).equipment_projects,
		{ catalog_revision: 'a', catalog: full('a').equipment_projects.catalog, access: full('a').equipment_projects.access, project: null });
	const newer = cache.prepare('/api/combat/inventory'); newer.hydrate(full('b'));
	assert.equal(read.hydrate({ equipment_projects: { catalog_revision: 'a' } }).equipment_projects.catalog[0].item_id, 'a');
	assert.match(cache.prepare('/api/expedition/task/check-in').endpoint, /equipment_catalog=b$/);
	scope = 'server-b:2';
	assert.equal(newer.hydrate(full('b')), null);
	assert.match(cache.prepare('/api/combat/inventory').endpoint, /equipment_catalog=full$/);
});
test('old servers stay usable and unknown compact revisions never apply incomplete state', () => {
	const cache = create_equipment_catalog_cache(() => 'one');
	const read = cache.prepare('/api/expedition/personal');
	const legacy = { equipment_projects: { catalog: [], access: [] } };
	assert.equal(read.hydrate(legacy), legacy);
	assert.throws(() => read.hydrate({ equipment_projects: { catalog_revision: 'missing' } }));
	assert.match(cache.prepare('/api/expedition/personal').endpoint, /equipment_catalog=full$/);
});

test('actual GET and POST transport negotiates the cache without changing saved command payloads', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const calls = [], payload = { operation_id:'saved',source:'equipment',captured_at:123 };
	let response = full('a');
	const context = { state:{},session_generation:1,server_host:'https://one.test',session_token:'fixture',selected_api_major:2,
		transport_diagnostics:null,rollback_client:null,rollback_module:null,resolve_api_endpoint:path=>path,cache_bust_api_endpoint:path=>path,
		handle_session_response(){},is_event_affecting_mutation:()=>false,error:()=>assert.fail('transport failed'),
		coordinated_request:async(url,options,request)=>{calls.push({url,options});return request.consume(Response.json(response));} };
	context.equipment_catalog_cache = create_equipment_catalog_cache(() => context.server_host + ':' + context.session_generation);
	runInNewContext(main.slice(main.indexOf('async function api_get_request('), main.indexOf('async function api_post_response(')) +
		main.slice(main.indexOf('async function api_post_response_raw('),main.indexOf('async function api_post_binary_response(')), context);
	await context.api_get_request('/api/combat/inventory');
	assert.match(calls[0].url,/equipment_catalog=full$/);
	response = { success:true,equipment_work_current:true,equipment_projects:{catalog_revision:'a',project:null} };
	const result = await context.api_post_response_raw('/api/expedition/task/check-in',payload);
	assert.match(calls[1].url,/equipment_catalog=a$/);
	assert.deepEqual(JSON.parse(calls[1].options.body),payload);
	assert.equal(result.json.equipment_projects.catalog[0].item_id,'a');
	context.session_generation++;
	response = full('b'); await context.api_get_request('/api/combat/inventory');
	assert.match(calls[2].url,/equipment_catalog=full$/);
});
