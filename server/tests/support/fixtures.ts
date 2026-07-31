import { get_json_with_session, post_json, register_client } from './http';
import type { RegisteredClient } from './http';

export type ClientDisplay = {
	display_name: string;
	icon_id: string;
};

export type FriendRequest = {
	friend: ClientDisplay;
	request_id: number;
};

export type Friend = ClientDisplay & {
	friend_id: number;
};

export type Events = {
	friend_requests: FriendRequest[];
	gifts: number[];
	trades: Array<{
		trade_id: number;
		attending: boolean;
		state: number;
	}>;
	resolved_trades: number[];
	campaign: {
		active: boolean;
		pct: number;
	};
	market_completed: number[];
	banishment_return_pending: boolean;
};

export type FriendPair = {
	first: RegisteredClient;
	first_id: number;
	second: RegisteredClient;
	second_id: number;
};

export type GuildPair = FriendPair & {
	guild_id: number;
};

export type RegisteredGuildClient = RegisteredClient & {
	client_id: number;
	guild_id: number;
};

export async function get_events(client: RegisteredClient): Promise<Events> {
	const { response, json } = await get_json_with_session<Events>('/api/events', client.session_token);

	if (!response.ok)
		throw new Error(`Events request failed with ${response.status}`);

	return json;
}

export async function make_friends(
	first_name = 'First Friend',
	second_name = 'Second Friend'
): Promise<FriendPair> {
	const [first, second] = await Promise.all([
		register_client(first_name),
		register_client(second_name)
	]);

	const added = await post_json<{ success: boolean }>('/api/friends/add', {
		friend_code: second.friend_code
	}, first.session_token);
	if (!added.response.ok || !added.json.success)
		throw new Error(`Friend request failed: ${JSON.stringify(added.json)}`);

	const request = (await get_events(second)).friend_requests[0];
	if (!request)
		throw new Error('Friend request was not visible to its recipient');

	const accepted = await post_json<{
		success: boolean;
		friend: {
			friend_id: number;
			display_name: string;
		};
	}>('/api/friends/accept', {
		request_id: request.request_id
	}, second.session_token);
	if (!accepted.response.ok || !accepted.json.success)
		throw new Error(`Friend acceptance failed: ${JSON.stringify(accepted.json)}`);

	const { response, json } = await get_json_with_session<{
		friends: Friend[];
	}>('/api/friends/get', first.session_token);
	if (!response.ok || json.friends.length !== 1)
		throw new Error(`Friend listing failed: ${JSON.stringify(json)}`);

	return {
		first,
		first_id: accepted.json.friend.friend_id,
		second,
		second_id: json.friends[0].friend_id
	};
}

export async function make_guildmates(
	first_name = 'First Guildmate',
	second_name = 'Second Guildmate',
	guild_name = 'Test Guild'
): Promise<GuildPair> {
	const [first, second] = await Promise.all([
		register_client(first_name),
		register_client(second_name)
	]);

	const created = await post_json<{
		success: boolean;
		guild: { guild_id: number };
	}>('/api/guilds/create', {
		name: guild_name,
		icon_id: 'melvorD:Farmlands'
	}, first.session_token);
	if (!created.response.ok || !created.json.success)
		throw new Error(`Guild creation failed: ${JSON.stringify(created.json)}`);

	const applied = await post_json<{ success: boolean }>('/api/guilds/apply', {
		guild_id: created.json.guild.guild_id
	}, second.session_token);
	if (!applied.response.ok || !applied.json.success)
		throw new Error(`Guild application failed: ${JSON.stringify(applied.json)}`);

	const first_state = await get_json_with_session<{
		members: Array<{ client_id: number }>;
		applicants: Array<{ application_id: number; client_id: number }>;
	}>('/api/guilds/state', first.session_token);
	const application = first_state.json.applicants[0];
	if (!application)
		throw new Error('Guild application was not visible to its members');

	const accepted = await post_json<{ success: boolean }>('/api/guilds/application/decide', {
		application_id: application.application_id,
		approve: true
	}, first.session_token);
	if (!accepted.response.ok || !accepted.json.success)
		throw new Error(`Guild application acceptance failed: ${JSON.stringify(accepted.json)}`);

	return {
		first,
		first_id: first_state.json.members[0].client_id,
		second,
		second_id: application.client_id,
		guild_id: created.json.guild.guild_id
	};
}

export async function register_guild_client(
	display_name = 'Guild Test Idler',
	guild_name = 'Test Guild'
): Promise<RegisteredGuildClient> {
	const client = await register_client(display_name);
	const created = await post_json<{
		success: boolean;
		guild: { guild_id: number };
	}>('/api/guilds/create', {
		name: guild_name,
		icon_id: 'melvorD:Farmlands'
	}, client.session_token);
	if (!created.response.ok || !created.json.success)
		throw new Error(`Guild creation failed: ${JSON.stringify(created.json)}`);

	const state = await get_json_with_session<{
		members: Array<{ client_id: number }>;
	}>('/api/guilds/state', client.session_token);

	return {
		...client,
		client_id: state.json.members[0].client_id,
		guild_id: created.json.guild.guild_id
	};
}

export async function make_guild_group(
	display_names: string[],
	guild_name = 'Test Guild'
): Promise<RegisteredGuildClient[]> {
	if (display_names.length === 0)
		return [];

	const clients = await Promise.all(display_names.map(display_name => register_client(display_name)));
	const created = await post_json<{
		success: boolean;
		guild: { guild_id: number };
	}>('/api/guilds/create', {
		name: guild_name,
		icon_id: 'melvorD:Farmlands'
	}, clients[0].session_token);
	if (!created.response.ok || !created.json.success)
		throw new Error(`Guild creation failed: ${JSON.stringify(created.json)}`);

	await Promise.all(clients.slice(1).map(client => post_json('/api/guilds/apply', {
		guild_id: created.json.guild.guild_id
	}, client.session_token)));
	const state = await get_json_with_session<{
		members: Array<{ client_id: number; display_name: string }>;
		applicants: Array<{ application_id: number; client_id: number; display_name: string }>;
	}>('/api/guilds/state', clients[0].session_token);
	await Promise.all(state.json.applicants.map(application => post_json('/api/guilds/application/decide', {
		application_id: application.application_id,
		approve: true
	}, clients[0].session_token)));

	const client_ids = new Map([
		...state.json.members.map(member => [member.display_name, member.client_id] as const),
		...state.json.applicants.map(applicant => [applicant.display_name, applicant.client_id] as const)
	]);
	return clients.map(client => ({
		...client,
		client_id: client_ids.get(client.display_name) as number,
		guild_id: created.json.guild.guild_id
	}));
}
