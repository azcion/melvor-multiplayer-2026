import { describe, expect, test } from 'bun:test';
import { make_guild_group, make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json, register_client } from '../support/http';
import { db_count, db_run } from '../support/persistence';
import { SHADOWED_AFTER } from '../../shadowed';

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
		last_seen_at: number | null;
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

	test('hides Shadowed members and Guilds until an authenticated return', async () => {
		const pair = await make_guildmates('Visible Member', 'Shadowed Member', 'Shadowed Guild');
		const browser = await register_client('Shadowed Guild Browser');
		const stale_at = Date.now() - SHADOWED_AFTER - 1_000;
		await db_run(
			'UPDATE `clients` SET `last_multiplayer_active_at` = ? WHERE `id` IN (?, ?)',
			[stale_at, pair.first_id, pair.second_id]
		);

		const hidden = await get_json_with_session<{ guilds: GuildSummary[] }>(
			'/api/guilds/list', browser.session_token
		);
		expect(hidden.json.guilds.some(guild => guild.guild_id === pair.guild_id)).toBe(false);

		await db_run(
			'UPDATE `clients` SET `last_multiplayer_active_at` = ? WHERE `id` = ?',
			[Date.now(), pair.first_id]
		);
		const returned_state = await get_guild_state(pair.first.session_token);
		expect(returned_state.guild?.member_count).toBe(2);
		expect(returned_state.members?.map(member => member.display_name)).toEqual(['Visible Member']);

		const shadowed = await get_json_with_session<{
			members: Array<{ client_id: number; display_name: string }>;
			total: number;
		}>('/api/guilds/members/shadowed?page=0&search=', pair.first.session_token);
		expect(shadowed.json.total).toBe(1);
		expect(shadowed.json.members).toEqual([
			expect.objectContaining({ client_id: pair.second_id, display_name: 'Shadowed Member' })
		]);

		const visible = await get_json_with_session<{ guilds: GuildSummary[] }>(
			'/api/guilds/list', browser.session_token
		);
		expect(visible.json.guilds).toEqual(expect.arrayContaining([
			expect.objectContaining({ guild_id: pair.guild_id, member_count: 2 })
		]));

		await db_run(
			'UPDATE `clients` SET `last_multiplayer_active_at` = ? WHERE `id` = ?',
			[Date.now(), pair.second_id]
		);
		await get_guild_state(pair.second.session_token);
		const restored = await get_guild_state(pair.first.session_token);
		expect(restored.members?.map(member => member.display_name).sort()).toEqual([
			'Shadowed Member',
			'Visible Member'
		]);
	});

	test('orders Guild members by latest multiplayer activity with unknown activity last', async () => {
		const [newest, older, shadowed, unknown] = await make_guild_group([
			'Zulu Newest',
			'Alpha Older',
			'Beta Shadowed',
			'Aardvark Unknown'
		], 'Activity Order Guild');
		const now = Date.now();
		const older_at = now - 60_000;
		const shadowed_at = now - SHADOWED_AFTER - 60_000;
		await db_run(
			'UPDATE `clients` SET `last_multiplayer_active_at` = CASE `id` ' +
			'WHEN ? THEN ? WHEN ? THEN ? WHEN ? THEN 0 END WHERE `id` IN (?, ?, ?)',
			[
				older.client_id, older_at,
				shadowed.client_id, shadowed_at,
				unknown.client_id,
				older.client_id, shadowed.client_id, unknown.client_id
			]
		);

		const state = await get_guild_state(newest.session_token);
		expect(state.members?.map(member => member.display_name)).toEqual([
			'Zulu Newest',
			'Alpha Older'
		]);

		const shadowed_directory = await get_json_with_session<{
			members: NonNullable<GuildState['members']>;
		}>('/api/guilds/members/shadowed?page=0&search=', newest.session_token);
		expect(shadowed_directory.json.members.map(member => ({
			display_name: member.display_name,
			last_seen_at: member.last_seen_at
		}))).toEqual([
			{ display_name: 'Beta Shadowed', last_seen_at: shadowed_at },
			{ display_name: 'Aardvark Unknown', last_seen_at: null }
		]);
	});

	test('immediately restores a never-active Shadowed member on their first authenticated request', async () => {
		const founder = await register_client('Return Founder');
		const created = await post_json<{ guild: GuildSummary }>('/api/guilds/create', {
			name: 'Return Guild',
			icon_id: 'melvorD:Farmlands'
		}, founder.session_token);
		const returning = await register_client('Never Active Return');
		await db_run(
			'INSERT INTO `guild_memberships` (`client_id`, `guild_id`) VALUES(?, ?)',
			[returning.client_id, created.json.guild.guild_id]
		);

		const before = await get_guild_state(founder.session_token);
		expect(before.members?.map(member => member.display_name)).toEqual(['Return Founder']);
		const returned = await get_guild_state(returning.session_token);
		expect(returned.members?.map(member => member.display_name).sort()).toEqual([
			'Never Active Return',
			'Return Founder'
		]);
	});

	test('seeds one permanent Free Fellowship with direct membership and a searchable directory', async () => {
		const [first, second, browser] = await Promise.all([
			register_client('Fellowship First'),
			register_client('Fellowship Second'),
			register_client('Fellowship Browser')
		]);
		const listing = await get_json_with_session<{ guilds: Array<GuildSummary & {
			is_free_fellowship?: boolean;
		}> }>('/api/guilds/list', browser.session_token);
		const fellowship = listing.json.guilds[0];

		expect(fellowship).toMatchObject({
			name: 'Free Fellowship',
			icon_id: 'multiplayer',
			member_count: 0,
			is_free_fellowship: true
		});
		expect(await db_count(
			"SELECT COUNT(*) AS `count` FROM `guilds` WHERE `type` = 'free_fellowship'"
		)).toBe(1);
		expect(await db_count(
			'SELECT COUNT(*) AS `count` FROM `campaign_state` WHERE `guild_id` = ?',
			[fellowship.guild_id]
		)).toBe(0);

		const joined = await post_json<{ success: boolean; guild: GuildSummary }>(
			'/api/guilds/join-free', {}, first.session_token
		);
		const second_application = await post_json<{ error_lang: string }>(
			'/api/guilds/apply', { guild_id: fellowship.guild_id }, second.session_token
		);
		const second_joined = await post_json<{ success: boolean }>(
			'/api/guilds/join-free', {}, second.session_token
		);
		const state = await get_guild_state(first.session_token);
		const searched = await get_json_with_session<{
			members: Array<{ display_name: string }>;
			page: number;
			page_size: number;
			search: string;
			total: number;
			has_more: boolean;
		}>('/api/guilds/members?search=second', first.session_token);

		expect(joined.json.success).toBe(true);
		expect(second_application.json.error_lang).toBe('MOD_MP_GUILD_APPLICATION_FORBIDDEN');
		expect(second_joined.json.success).toBe(true);
		expect(state.guild).toMatchObject({
			name: 'Free Fellowship',
			icon_id: 'multiplayer',
			capabilities: {
				roster: true,
				marketplace: true,
				council: false,
				member_search: true
			}
		});
		expect(await db_count(
			' SELECT COUNT(*) AS `count` FROM `campaign_state` WHERE `guild_id` = ?',
			[fellowship.guild_id]
		)).toBe(1);
		expect(searched.json).toEqual({
			members: [expect.objectContaining({ display_name: 'Fellowship Second' })],
			page: 0,
			page_size: 50,
			search: 'second',
			total: 1,
			has_more: false
		});

		const no_council = await get_json_with_session<{ error_lang: string }>(
			'/api/guilds/council', first.session_token
		);
		const no_petition = await post_json<{ error_lang: string }>('/api/guilds/petitions/raise', {
			type: 'appellation',
			name: 'Not Allowed'
		}, first.session_token);
		expect(no_council.json.error_lang).toBe('MOD_MP_GUILD_COUNCIL_UNAVAILABLE');
		expect(no_petition.json.error_lang).toBe('MOD_MP_GUILD_COUNCIL_UNAVAILABLE');

		await post_json('/api/guilds/leave', {}, first.session_token);
		await post_json('/api/guilds/leave', {}, second.session_token);
		const after_empty = await get_json_with_session<{ guilds: GuildSummary[] }>(
			'/api/guilds/list', browser.session_token
		);
		const persisted = after_empty.json.guilds.find(guild => guild.guild_id === fellowship.guild_id);
		expect(persisted).toMatchObject({ name: 'Free Fellowship', member_count: 0 });
		expect(await db_count(
			"SELECT COUNT(*) AS `count` FROM `guilds` WHERE `type` = 'free_fellowship'"
		)).toBe(1);
		expect(await db_count(
			'SELECT COUNT(*) AS `count` FROM `campaign_state` WHERE `guild_id` = ?',
			[fellowship.guild_id]
		)).toBe(1);
	});
});
