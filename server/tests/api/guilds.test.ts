import { describe, expect, test } from 'bun:test';
import { make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json, register_client } from '../support/http';

type GuildSummary = {
	guild_id: number;
	name: string;
	icon_id: string;
	member_count: number;
};

type GuildState = {
	affiliation: 'none' | 'applicant' | 'member';
	guild?: GuildSummary;
	application?: GuildSummary & { application_id: number };
	members?: Array<{
		client_id: number;
		display_name: string;
		icon_id: string;
	}>;
	applicants?: Array<{
		application_id: number;
		client_id: number;
		display_name: string;
		icon_id: string;
	}>;
};

async function get_guild_state(session_token: string): Promise<GuildState> {
	const { response, json } = await get_json_with_session<GuildState>('/api/guilds/state', session_token);
	expect(response.status).toBe(200);
	return json;
}

describe('guild API', () => {
	test('creates non-unique guilds and exposes only discovery summaries', async () => {
		const [first, second, browser] = await Promise.all([
			register_client('First Rat'),
			register_client('Second Rat'),
			register_client('Guild Browser')
		]);

		const invalid_name = await post('/api/guilds/create', {
			name: '   ',
			icon_id: 'melvorD:Farmlands'
		}, first.session_token);
		const invalid_icon = await post('/api/guilds/create', {
			name: 'Rats',
			icon_id: 'exampleMod:Rat'
		}, first.session_token);
		const first_created = await post_json<{ guild: GuildSummary }>('/api/guilds/create', {
			name: '  Rats  ',
			icon_id: 'melvorD:Farmlands'
		}, first.session_token);
		const second_created = await post_json<{ guild: GuildSummary }>('/api/guilds/create', {
			name: 'Rats',
			icon_id: 'melvorF:Penumbra'
		}, second.session_token);
		const listing = await get_json_with_session<{ guilds: GuildSummary[] }>(
			'/api/guilds/list',
			browser.session_token
		);

		expect(invalid_name.status).toBe(400);
		expect(invalid_icon.status).toBe(400);
		expect(first_created.json.guild).toMatchObject({
			name: 'Rats',
			icon_id: 'melvorD:Farmlands',
			member_count: 1
		});
		expect(second_created.json.guild).toMatchObject({
			name: 'Rats',
			icon_id: 'melvorF:Penumbra',
			member_count: 1
		});
		expect(listing.json.guilds).toEqual(expect.arrayContaining([
			first_created.json.guild,
			second_created.json.guild
		]));
		const discovered = listing.json.guilds.find(guild =>
			guild.guild_id === first_created.json.guild.guild_id
		);
		expect(Object.keys(discovered as GuildSummary).sort()).toEqual([
			'guild_id',
			'icon_id',
			'member_count',
			'name'
		]);
	});

	test('enforces one pending application and supports withdrawal', async () => {
		const [first_guild, second_guild, applicant] = await Promise.all([
			register_client('Guild One Creator'),
			register_client('Guild Two Creator'),
			register_client('Single Applicant')
		]);
		const first = await post_json<{ guild: GuildSummary }>('/api/guilds/create', {
			name: 'One',
			icon_id: 'melvorD:Volcanic_Cave'
		}, first_guild.session_token);
		const second = await post_json<{ guild: GuildSummary }>('/api/guilds/create', {
			name: 'Two',
			icon_id: 'melvorF:StrongholdOfTheUndead'
		}, second_guild.session_token);

		const applied = await post_json<{ success: boolean }>('/api/guilds/apply', {
			guild_id: first.json.guild.guild_id
		}, applicant.session_token);
		const duplicate = await post_json<{ error_lang: string }>('/api/guilds/apply', {
			guild_id: second.json.guild.guild_id
		}, applicant.session_token);
		const pending = await get_guild_state(applicant.session_token);
		const withdrawn = await post_json<{ success: boolean }>('/api/guilds/withdraw', {}, applicant.session_token);

		expect(applied.json.success).toBe(true);
		expect(duplicate.json.error_lang).toBe('MOD_MP_GUILD_AFFILIATION_EXISTS');
		expect(pending).toMatchObject({
			affiliation: 'applicant',
			application: {
				guild_id: first.json.guild.guild_id,
				name: 'One',
				member_count: 1
			}
		});
		expect(withdrawn.json.success).toBe(true);
		expect(await get_guild_state(applicant.session_token)).toEqual({ affiliation: 'none' });
	});

	test('lets equal members decide applications and atomically consumes the first decision', async () => {
		const pair = await make_guildmates('Rat A', 'Rat B', 'Rats');
		const applicant = await register_client('Rat C');
		await post_json('/api/guilds/apply', {
			guild_id: pair.guild_id
		}, applicant.session_token);

		const state = await get_guild_state(pair.first.session_token);
		const application_id = state.applicants?.[0].application_id as number;
		const [first_decision, second_decision] = await Promise.all([
			post_json<{ success?: boolean; error_lang?: string }>('/api/guilds/application/decide', {
				application_id,
				approve: true
			}, pair.first.session_token),
			post_json<{ success?: boolean; error_lang?: string }>('/api/guilds/application/decide', {
				application_id,
				approve: false
			}, pair.second.session_token)
		]);

		const outcomes = [first_decision.json, second_decision.json];
		expect(outcomes.filter(result => result.success)).toHaveLength(1);
		expect(outcomes.filter(result => result.error_lang === 'MOD_MP_GUILD_APPLICATION_MISSING')).toHaveLength(1);

		const applicant_state = await get_guild_state(applicant.session_token);
		expect(['none', 'member']).toContain(applicant_state.affiliation);
	});

	test('rejects applicants and allows only voluntary departure', async () => {
		const pair = await make_guildmates('Peer A', 'Peer B', 'Peers');
		const applicant = await register_client('Rejected Peer');
		await post_json('/api/guilds/apply', {
			guild_id: pair.guild_id
		}, applicant.session_token);

		const state = await get_guild_state(pair.second.session_token);
		const rejected = await post_json<{ success: boolean }>('/api/guilds/application/decide', {
			application_id: state.applicants?.[0].application_id,
			approve: false
		}, pair.second.session_token);
		const removal = await post('/api/guilds/remove_member', {
			client_id: pair.first_id
		}, pair.second.session_token);
		const left = await post_json<{ success: boolean; dissolved: boolean }>(
			'/api/guilds/leave',
			{},
			pair.second.session_token
		);

		expect(rejected.json.success).toBe(true);
		expect(await get_guild_state(applicant.session_token)).toEqual({ affiliation: 'none' });
		expect(removal.status).toBe(404);
		expect(left.json).toEqual({ success: true, dissolved: false });
		expect((await get_guild_state(pair.first.session_token)).members).toHaveLength(1);
	});

	test('dissolves the guild when its final member leaves and releases applicants', async () => {
		const creator = await register_client('Solo Creator');
		const applicant = await register_client('Stranded Applicant');
		const created = await post_json<{ guild: GuildSummary }>('/api/guilds/create', {
			name: 'Temporary',
			icon_id: 'melvorD:Farmlands'
		}, creator.session_token);
		await post_json('/api/guilds/apply', {
			guild_id: created.json.guild.guild_id
		}, applicant.session_token);

		const left = await post_json<{ success: boolean; dissolved: boolean }>(
			'/api/guilds/leave',
			{},
			creator.session_token
		);

		expect(left.json).toEqual({ success: true, dissolved: true });
		expect(await get_guild_state(creator.session_token)).toEqual({ affiliation: 'none' });
		expect(await get_guild_state(applicant.session_token)).toEqual({ affiliation: 'none' });
	});

	test('blocks departure while marketplace listings or transfers remain unresolved', async () => {
		const pair = await make_guildmates('Bound Peer A', 'Bound Peer B', 'Bound Peers');
		const listed = await post_json<{ success: boolean }>('/api/market/sell', {
			item_id: 'melvorD:Guild_Departure_Item',
			item_qty: 1,
			item_sell_price: 10
		}, pair.first.session_token);
		const listings = await get_json_with_session<{
			items: Array<{ id: number }>;
		}>('/api/market/listings', pair.first.session_token);
		const listing_blocked = await post_json<{ error_lang: string }>(
			'/api/guilds/leave',
			{},
			pair.first.session_token
		);
		await post_json('/api/market/cancel', {
			id: listings.json.items[0].id
		}, pair.first.session_token);

		await post_json('/api/gift/send', {
			recipient_id: pair.second_id,
			items: [{ id: 'melvorD:Guild_Departure_Gift', qty: 1 }]
		}, pair.first.session_token);
		const gift_blocked = await post_json<{ error_lang: string }>(
			'/api/guilds/leave',
			{},
			pair.second.session_token
		);

		expect(listed.json.success).toBe(true);
		expect(listing_blocked.json.error_lang).toBe('MOD_MP_GUILD_DEPARTURE_BLOCKED');
		expect(gift_blocked.json.error_lang).toBe('MOD_MP_GUILD_DEPARTURE_BLOCKED');
	});

	test('reserves shared and player-to-player features for guild members', async () => {
		const guildless = await register_client('Guildless Player');
		const [campaign, market, charity, gift, trade] = await Promise.all([
			get_json_with_session<{ error_lang: string }>('/api/campaign/info', guildless.session_token),
			get_json_with_session<{ error_lang: string }>('/api/market/listings', guildless.session_token),
			get_json_with_session<{ error_lang: string }>('/api/charity/contents', guildless.session_token),
			post_json<{ error_lang: string }>('/api/gift/send', {
				recipient_id: -1,
				items: [{ id: 'melvorD:Guildless_Gift', qty: 1 }]
			}, guildless.session_token),
			post_json<{ error_lang: string }>('/api/trade/offer', {
				recipient_id: -1,
				items: [{ id: 'melvorD:Guildless_Trade', qty: 1 }]
			}, guildless.session_token)
		]);

		for (const result of [campaign, market, charity])
			expect(result.json.error_lang).toBe('MOD_MP_GUILD_REQUIRED');
		for (const result of [gift, trade])
			expect(result.json.error_lang).toBe('MOD_MP_GUILD_MEMBERSHIP_MISSING');
	});
});
