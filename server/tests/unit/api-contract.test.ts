import { expect, test } from 'bun:test';
import { create_api_server, ECONOMY_COMMAND_PATHS } from '../../api-contract';

test('publishes journaled mutations only on the v2 wire path', () => {
	expect(ECONOMY_COMMAND_PATHS.has('/api/market/sell')).toBe(true);
	expect(ECONOMY_COMMAND_PATHS.has('/api/gift/decline')).toBe(true);
});

test('registration rejects duplicate methods and emits aliases once', () => {
	const server = create_api_server(0);
	server.route('/api/events', () => ({}), ['GET', 'OPTIONS']);
	server.route('/api/events', () => ({}), ['POST', 'OPTIONS']);
	expect(server.manifest.filter(route => route.path === '/api/v2/events').map(route => route.method)).toEqual(['GET', 'OPTIONS', 'POST']);
	expect(() => server.route('/api/events', () => ({}))).toThrow('Duplicate API registration');
});
