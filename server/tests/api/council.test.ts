import { describe, expect, test } from 'bun:test';
import { make_guild_group, make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post_json, register_client } from '../support/http';
import { db_count, db_run } from '../support/persistence';

type PetitionView = {
	petition_id: number;
	type: 'appellation' | 'heraldry' | 'banishment' | 'charitree_ingratitude' |
		'charitree_sacrilege' | 'charitree_beneficence';
	proposal: Record<string, unknown>;
	lifecycle: 'active' | 'granted' | 'denied' | 'lapsed';
	execution_state: 'not_applicable' | 'pending' | 'running' | 'succeeded' | 'failed';
	eligible: boolean;
	current_vote: 'aye' | 'nay' | null;
	can_vote: boolean;
	can_withdraw: boolean;
	tally_visible: boolean;
	tally?: { eligible: number; aye: number; nay: number; uncast: number };
};

async function get_council(session_token: string, page = 0) {
	const result = await get_json_with_session<{
		petitions: PetitionView[];
		available_petition_types: PetitionView['type'][];
		resolved_page: number;
		has_more: boolean;
	}>(`/api/guilds/council?page=${page}`, session_token);
	expect(result.response.status).toBe(200);
	return result.json;
}

async function raise_appellation(session_token: string, name: string) {
	return post_json<{ success?: boolean; petition_id?: number; error_lang?: string }>(
		'/api/guilds/petitions/raise',
		{ type: 'appellation', name },
		session_token
	);
}

describe('Council API', () => {
	test('snapshots voters and hides active tallies until the current member votes', async () => {
		const members = await make_guild_group(['Council A', 'Council B', 'Council C'], 'Council Guild');
		const raised = await raise_appellation(members[0].session_token, 'New Council Guild');
		const petition_id = raised.json.petition_id as number;

		const before_vote = (await get_council(members[1].session_token)).petitions[0];
		expect(before_vote).toMatchObject({
			petition_id,
			lifecycle: 'active',
			eligible: true,
			current_vote: null,
			can_vote: true,
			tally_visible: false
		});
		expect(before_vote).not.toHaveProperty('tally');
		expect(before_vote).not.toHaveProperty('petitioner_id');

		const voted = await post_json<{ success: boolean; lifecycle: string }>(
			'/api/guilds/petitions/vote',
			{ petition_id, choice: 'aye' },
			members[1].session_token
		);
		expect(voted.json).toEqual({ success: true, lifecycle: 'active' });

		const voter_view = (await get_council(members[1].session_token)).petitions[0];
		expect(voter_view).toMatchObject({
			current_vote: 'aye',
			can_vote: false,
			tally_visible: true,
			tally: { eligible: 3, aye: 1, nay: 0, uncast: 2 }
		});
		const other_view = (await get_council(members[2].session_token)).petitions[0];
		expect(other_view.tally_visible).toBe(false);
		expect(other_view).not.toHaveProperty('tally');
	});

	test('atomically grants at the threshold and rejects duplicate or final votes', async () => {
		const members = await make_guild_group(['Threshold A', 'Threshold B', 'Threshold C'], 'Threshold Guild');
		const petition_id = (await raise_appellation(members[0].session_token, 'Threshold Renamed')).json.petition_id as number;

		const first = await post_json<{ success: boolean; lifecycle: string }>(
			'/api/guilds/petitions/vote',
			{ petition_id, choice: 'aye' },
			members[0].session_token
		);
		const duplicate = await post_json<{ error_lang: string }>(
			'/api/guilds/petitions/vote',
			{ petition_id, choice: 'nay' },
			members[0].session_token
		);
		const second = await post_json<{ success: boolean; lifecycle: string }>(
			'/api/guilds/petitions/vote',
			{ petition_id, choice: 'aye' },
			members[1].session_token
		);
		const after_final = await post_json<{ error_lang: string }>(
			'/api/guilds/petitions/vote',
			{ petition_id, choice: 'nay' },
			members[2].session_token
		);

		expect(first.json.lifecycle).toBe('active');
		expect(duplicate.json.error_lang).toBe('MOD_MP_COUNCIL_ALREADY_VOTED');
		expect(second.json.lifecycle).toBe('granted');
		expect(after_final.json.error_lang).toBe('MOD_MP_COUNCIL_PETITION_FINAL');
		const resolved = (await get_council(members[2].session_token)).petitions[0];
		expect(resolved).toMatchObject({
			lifecycle: 'granted',
			execution_state: 'succeeded',
			tally_visible: true,
			tally: { eligible: 3, aye: 2, nay: 0, uncast: 1 }
		});
	});

	test('executes Appellation and Heraldry through restart-safe idempotent claims', async () => {
		const member = await register_guild_client('Action Member', 'Action Guild');
		const appellation_id = (await raise_appellation(member.session_token, 'Action Renamed')).json.petition_id as number;
		await post_json('/api/guilds/petitions/vote', {
			petition_id: appellation_id,
			choice: 'aye'
		}, member.session_token);
		let guild = await get_json_with_session<{ guild: { name: string; icon_id: string } }>(
			'/api/guilds/state', member.session_token
		);
		expect(guild.json.guild.name).toBe('Action Renamed');

		const heraldry = await post_json<{ success: boolean; petition_id: number }>(
			'/api/guilds/petitions/raise',
			{ type: 'heraldry', icon_id: 'melvorF:Penumbra' },
			member.session_token
		);
		await post_json('/api/guilds/petitions/vote', {
			petition_id: heraldry.json.petition_id,
			choice: 'aye'
		}, member.session_token);
		guild = await get_json_with_session<{ guild: { name: string; icon_id: string } }>(
			'/api/guilds/state', member.session_token
		);
		expect(guild.json.guild.icon_id).toBe('melvorF:Penumbra');

		await db_run("UPDATE `guilds` SET `icon_id` = 'melvorD:Farmlands' WHERE `id` = ?", [member.guild_id]);
		await db_run(
			"UPDATE `guild_petitions` SET `execution_state` = 'running', `execution_last_attempt_at` = 0, " +
			'`subject_locked` = 1 WHERE `id` = ?',
			[heraldry.json.petition_id]
		);
		await get_council(member.session_token);
		guild = await get_json_with_session<{ guild: { name: string; icon_id: string } }>('/api/guilds/state', member.session_token);
		expect(guild.json.guild.icon_id).toBe('melvorF:Penumbra');
		expect(await db_count(
			"SELECT COUNT(*) AS `count` FROM `guild_petitions` WHERE `id` = ? AND `execution_state` = 'succeeded' " +
			'AND `execution_attempts` = 2 AND `subject_locked` = 0',
			[heraldry.json.petition_id]
		)).toBe(1);
	});

	test('renames Ingratitude and preserves donations made after its snapshot', async () => {
		const member = await register_guild_client('Charitree Councillor', 'Charitree Council');
		await post_json('/api/charity/donate', {
			items: [
				{ id: 'melvorD:Old_Charitree_Item', qty: 10 },
				{ id: 'melvorD:Refreshed_Charitree_Item', qty: 20 }
			]
		}, member.session_token);
		const raised = await post_json<{ success: boolean; petition_id: number }>(
			'/api/guilds/petitions/raise',
			{ type: 'charitree_ingratitude' },
			member.session_token
		);
		expect(raised.json.success).toBe(true);
		expect((await get_council(member.session_token)).petitions[0]).toMatchObject({
			petition_id: raised.json.petition_id,
			type: 'charitree_ingratitude',
			proposal: {}
		});

		await post_json('/api/charity/donate', {
			items: [
				{ id: 'melvorD:Refreshed_Charitree_Item', qty: 1 },
				{ id: 'melvorD:New_Charitree_Item', qty: 30 }
			]
		}, member.session_token);
		const vote = await post_json<{ success: boolean; lifecycle: string }>(
			'/api/guilds/petitions/vote',
			{ petition_id: raised.json.petition_id, choice: 'aye' },
			member.session_token
		);
		expect(vote.json.lifecycle).toBe('granted');

		const contents = await get_json_with_session<{
			items: Array<{ id: string; qty: number }>;
		}>('/api/charity/contents', member.session_token);
		expect(contents.json.items).not.toContainEqual(expect.objectContaining({ id: 'melvorD:Old_Charitree_Item' }));
		expect(contents.json.items).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: 'melvorD:Refreshed_Charitree_Item', qty: 21 }),
			expect.objectContaining({ id: 'melvorD:New_Charitree_Item', qty: 30 })
		]));
		expect(await db_count(
			"SELECT COUNT(*) AS `count` FROM `guild_petitions` WHERE `id` = ? " +
			"AND `execution_state` = 'succeeded' AND `execution_effect` = 'cleared'",
			[raised.json.petition_id]
		)).toBe(1);
	});

	test('offers only fitting Charitree Petitions and toggles the feature through the Council', async () => {
		const member = await register_guild_client('Charitree Steward', 'Petition Grove');
		let council = await get_council(member.session_token);
		expect(council.available_petition_types).toContain('charitree_sacrilege');
		expect(council.available_petition_types).not.toContain('charitree_ingratitude');
		expect(council.available_petition_types).not.toContain('charitree_beneficence');

		const unavailable = await post_json<{ error_lang: string }>(
			'/api/guilds/petitions/raise',
			{ type: 'charitree_ingratitude' },
			member.session_token
		);
		expect(unavailable.json.error_lang).toBe('MOD_MP_COUNCIL_CHARITREE_UNAVAILABLE');

		await post_json('/api/charity/donate', {
			items: [{ id: 'melvorD:Sacrilege_Offering', qty: 7 }]
		}, member.session_token);
		council = await get_council(member.session_token);
		expect(council.available_petition_types).toContain('charitree_ingratitude');
		const ingratitude = await post_json<{ petition_id: number }>(
			'/api/guilds/petitions/raise',
			{ type: 'charitree_ingratitude' },
			member.session_token
		);
		await post_json('/api/charity/take', {
			item_id: 'melvorD:Sacrilege_Offering'
		}, member.session_token);
		const emptied_vote = await post_json<{ lifecycle: string }>('/api/guilds/petitions/vote', {
			petition_id: ingratitude.json.petition_id,
			choice: 'aye'
		}, member.session_token);
		expect(emptied_vote.json.lifecycle).toBe('granted');
		expect(await db_count(
			"SELECT COUNT(*) AS `count` FROM `guild_petitions` WHERE `id` = ? " +
			"AND `execution_state` = 'succeeded' AND `execution_effect` = 'already_empty'",
			[ingratitude.json.petition_id]
		)).toBe(1);

		await post_json('/api/charity/donate', {
			items: [{ id: 'melvorD:Sacrilege_Offering', qty: 7 }]
		}, member.session_token);

		const sacrilege = await post_json<{ petition_id: number }>(
			'/api/guilds/petitions/raise',
			{ type: 'charitree_sacrilege' },
			member.session_token
		);
		await post_json('/api/guilds/petitions/vote', {
			petition_id: sacrilege.json.petition_id,
			choice: 'aye'
		}, member.session_token);

		const disabled = await get_json_with_session<{ enabled: boolean; items: unknown[] }>(
			'/api/charity/contents', member.session_token
		);
		expect(disabled.json).toEqual({ enabled: false, items: [] });
		expect(await db_count(
			'SELECT COUNT(*) AS `count` FROM `charity_items` WHERE `guild_id` = ?',
			[member.guild_id]
		)).toBe(0);
		const rejected_donation = await post_json<{ error_lang: string }>('/api/charity/donate', {
			items: [{ id: 'melvorD:Rejected_Offering', qty: 1 }]
		}, member.session_token);
		expect(rejected_donation.json.error_lang).toBe('MOD_MP_CHARITY_DISABLED');

		council = await get_council(member.session_token);
		expect(council.available_petition_types).toContain('charitree_beneficence');
		expect(council.available_petition_types).not.toContain('charitree_sacrilege');
		expect(council.available_petition_types).not.toContain('charitree_ingratitude');

		const beneficence = await post_json<{ petition_id: number }>(
			'/api/guilds/petitions/raise',
			{ type: 'charitree_beneficence' },
			member.session_token
		);
		await post_json('/api/guilds/petitions/vote', {
			petition_id: beneficence.json.petition_id,
			choice: 'aye'
		}, member.session_token);
		const enabled = await get_json_with_session<{ enabled: boolean; items: unknown[] }>(
			'/api/charity/contents', member.session_token
		);
		expect(enabled.json).toEqual({ enabled: true, items: [] });
	});

	test('keeps post-snapshot members ineligible and conceals the active tally', async () => {
		const pair = await make_guildmates('Snapshot A', 'Snapshot B', 'Snapshot Guild');
		const petition_id = (await raise_appellation(pair.first.session_token, 'Snapshot Renamed')).json.petition_id as number;
		const later = await register_client('Snapshot Later');
		await post_json('/api/guilds/apply', { guild_id: pair.guild_id }, later.session_token);
		const state = await get_json_with_session<{ applicants: Array<{ application_id: number }> }>(
			'/api/guilds/state', pair.first.session_token
		);
		await post_json('/api/guilds/application/decide', {
			application_id: state.json.applicants[0].application_id,
			approve: true
		}, pair.first.session_token);

		const vote = await post_json<{ error_lang: string }>('/api/guilds/petitions/vote', {
			petition_id,
			choice: 'aye'
		}, later.session_token);
		const view = (await get_council(later.session_token)).petitions[0];
		expect(vote.json.error_lang).toBe('MOD_MP_COUNCIL_INELIGIBLE');
		expect(view).toMatchObject({ eligible: false, can_vote: false, tally_visible: false });
		expect(view).not.toHaveProperty('tally');
	});

	test('serializes conflict subjects and releases them on withdrawal', async () => {
		const member = await register_guild_client('Conflict Member', 'Conflict Guild');
		const first = await raise_appellation(member.session_token, 'First Proposal');
		const conflict = await raise_appellation(member.session_token, 'Second Proposal');
		const withdrawn = await post_json<{ success: boolean }>('/api/guilds/petitions/withdraw', {
			petition_id: first.json.petition_id
		}, member.session_token);
		const replacement = await raise_appellation(member.session_token, 'Second Proposal');

		expect(conflict.json.error_lang).toBe('MOD_MP_COUNCIL_CONFLICT');
		expect(withdrawn.json.success).toBe(true);
		expect(replacement.json.success).toBe(true);
		expect((await get_council(member.session_token)).petitions).toHaveLength(1);
	});

	test('validates banishment against an exact current membership tenure', async () => {
		const pair = await make_guildmates('Banishment A', 'Banishment B', 'Banishment Guild');
		const missing = await post_json<{ error_lang: string }>('/api/guilds/petitions/raise', {
			type: 'banishment',
			target_client_id: 999999
		}, pair.first.session_token);
		const raised = await post_json<{ success: boolean; petition_id: number }>('/api/guilds/petitions/raise', {
			type: 'banishment',
			target_client_id: pair.second_id
		}, pair.first.session_token);

		expect(missing.json.error_lang).toBe('MOD_MP_COUNCIL_TARGET_MISSING');
		expect(raised.json.success).toBe(true);
		expect(await db_count(
			'SELECT COUNT(*) AS `count` FROM `guild_petitions` AS p JOIN `guild_memberships` AS m ' +
			'ON m.`id` = p.`target_membership_id` WHERE p.`id` = ? AND m.`client_id` = ?',
			[raised.json.petition_id, pair.second_id]
		)).toBe(1);
	});

	test('lapses expired petitions during request-time catch-up without recording a vote', async () => {
		const member = await register_guild_client('Expiry Member', 'Expiry Guild');
		const petition_id = (await raise_appellation(member.session_token, 'Expired Name')).json.petition_id as number;
		await db_run('UPDATE `guild_petitions` SET `expires_at` = ? WHERE `id` = ?', [Date.now() - 1, petition_id]);

		const vote = await post_json<{ error_lang: string }>('/api/guilds/petitions/vote', {
			petition_id,
			choice: 'aye'
		}, member.session_token);
		const view = (await get_council(member.session_token)).petitions[0];
		expect(vote.json.error_lang).toBe('MOD_MP_COUNCIL_PETITION_FINAL');
		expect(view).toMatchObject({
			lifecycle: 'lapsed',
			tally_visible: true,
			tally: { eligible: 1, aye: 0, nay: 0, uncast: 1 }
		});
		expect(await db_count(
			'SELECT COUNT(*) AS `count` FROM `guild_petition_votes` WHERE `petition_id` = ?',
			[petition_id]
		)).toBe(0);
	});

	test('serializes concurrent threshold votes into one immutable result', async () => {
		const members = await make_guild_group(['Race A', 'Race B', 'Race C'], 'Race Guild');
		const petition_id = (await raise_appellation(members[0].session_token, 'Race Renamed')).json.petition_id as number;
		const [first, second] = await Promise.all([
			post_json<{ success?: boolean; lifecycle?: string; error_lang?: string }>(
				'/api/guilds/petitions/vote',
				{ petition_id, choice: 'aye' },
				members[0].session_token
			),
			post_json<{ success?: boolean; lifecycle?: string; error_lang?: string }>(
				'/api/guilds/petitions/vote',
				{ petition_id, choice: 'aye' },
				members[1].session_token
			)
		]);

		expect([first.json.lifecycle, second.json.lifecycle].sort()).toEqual(['active', 'granted']);
		expect(await db_count(
			'SELECT COUNT(*) AS `count` FROM `guild_petition_votes` WHERE `petition_id` = ?',
			[petition_id]
		)).toBe(2);
		expect((await get_council(members[2].session_token)).petitions[0].lifecycle).toBe('granted');
	});

	test('restores identity-based Council rights after readmission to the same Guild', async () => {
		const pair = await make_guildmates('Readmit A', 'Readmit B', 'Readmit Guild');
		const petition_id = (await raise_appellation(pair.second.session_token, 'Readmit Renamed')).json.petition_id as number;
		await post_json('/api/guilds/leave', {}, pair.second.session_token);

		const while_absent = await post_json<{ error_lang: string }>('/api/guilds/petitions/vote', {
			petition_id,
			choice: 'aye'
		}, pair.second.session_token);
		expect(while_absent.json.error_lang).toBe('MOD_MP_GUILD_REQUIRED');

		await post_json('/api/guilds/apply', { guild_id: pair.guild_id }, pair.second.session_token);
		const state = await get_json_with_session<{ applicants: Array<{ application_id: number }> }>(
			'/api/guilds/state', pair.first.session_token
		);
		await post_json('/api/guilds/application/decide', {
			application_id: state.json.applicants[0].application_id,
			approve: true
		}, pair.first.session_token);

		const readmitted = (await get_council(pair.second.session_token)).petitions[0];
		expect(readmitted).toMatchObject({ eligible: true, can_vote: true, can_withdraw: true });
		const withdrawn = await post_json<{ success: boolean }>('/api/guilds/petitions/withdraw', {
			petition_id
		}, pair.second.session_token);
		expect(withdrawn.json.success).toBe(true);
	});
});
