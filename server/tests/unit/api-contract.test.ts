import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { create_api_server, ECONOMY_COMMAND_PATHS } from '../../api-contract';
import manifest from '../fixtures/v1-route-manifest.json';
import clients from '../fixtures/supported-client-contracts.json';

test('the frozen inventory covers each released client and every literal route including generated visibility routes', () => {
	const paths = new Set(manifest.map(route => route.path));
	for (const client of clients)
		for (const path of client.endpoints) expect(paths.has(path), `${client.version}: ${path}`).toBe(true);
	const sources = new Set(manifest.map(route => route.source));
	for (const source of sources) {
		const text = readFileSync(new URL(`../../${source}`, import.meta.url), 'utf8');
		for (const match of text.matchAll(/['"](\/api\/[^'"?]+)['"]/g))
			if (match[1] !== '/api/versions') expect(paths.has(match[1]), match[1]).toBe(true);
	}
	expect([...ECONOMY_COMMAND_PATHS].sort()).toEqual(manifest.filter(route => route.command_kinds.length).map(route => route.path).sort());
});

test('registration rejects duplicate methods and emits aliases once', () => {
	const server = create_api_server(0);
	server.route('/api/events', () => ({}), ['GET', 'OPTIONS']);
	server.route('/api/events', () => ({}), ['POST', 'OPTIONS'], { versions: [1] });
	expect(server.manifest.filter(route => route.path === '/api/v2/events').map(route => route.method)).toEqual(['GET', 'OPTIONS']);
	expect(server.manifest.filter(route => route.path === '/api/v1/events').map(route => route.method)).toEqual(['GET', 'OPTIONS', 'POST']);
	expect(() => server.route('/api/events', () => ({}))).toThrow('Duplicate API registration');
});
