import type { Database } from 'bun:sqlite';
import { db } from './db';
import type { PetitionType } from './council';
import type { guild_petitions } from './db/types/db_types';
import { recently_active_cutoff } from './recent-activity';

export const GLOBAL_EXPEDITION_LAUNCH_VOTE_MS = 40 * 60 * 60 * 1000;
export const GLOBAL_EXPEDITION_SWITCH_DELAY_MS = 48 * 60 * 60 * 1000;
export const GLOBAL_EXPEDITION_MINIMUM_CLIENT_VERSION = '1.7.11';

export type GlobalExpeditionLaunchBallot = {
	aye: number;
	nay: number;
	eligible: number;
	can_vote: boolean;
	locks_at: number;
	ends_at: number;
	result: 'aye' | 'nay' | null;
	choice: 'aye' | 'nay' | null;
};

export type GlobalExpeditionGuildState = {
	scope: 'guild' | 'global';
	enabled: boolean;
	ballot: GlobalExpeditionLaunchBallot | null;
	starts_at: number | null;
	registration_pending: boolean;
};

export type GlobalExpeditionLaunchSummary = {
	triggered_at: number;
	vote_closes_at: number;
	switch_at: number;
	applied_at: number | null;
	guilds: Array<{
		guild_id: number;
		vote_result: 'passed' | 'failed' | null;
		aye_count: number | null;
		nay_count: number | null;
		eligible_count: number | null;
	}>;
};

export type GlobalExpeditionParticipationHandler = (guild_id: number, opted_in: boolean, now: number) => void;
let participation_handler: GlobalExpeditionParticipationHandler | null = null;

export function set_global_expedition_participation_handler(handler: GlobalExpeditionParticipationHandler | null): void {
	participation_handler = handler;
}

export function global_expedition_guild_participates(guild_id: number, database: Database = db): boolean {
	return database.query(`SELECT 1 FROM global_expedition_guild_participation p
		JOIN global_expedition_launch l ON l.id=1 AND l.applied_at IS NOT NULL
		WHERE p.guild_id=? AND p.opted_in=1 AND p.effective_at<=?`).get(guild_id, Date.now()) !== null;
}

export function global_expedition_launch_applied(database: Database = db): boolean {
	return database.query('SELECT 1 FROM global_expedition_launch WHERE id=1 AND applied_at IS NOT NULL').get() !== null;
}

export function get_global_expedition_guild_state(
	guild_id: number | null,
	client_id: number,
	now: number,
	database: Database = db
): GlobalExpeditionGuildState | null {
	if (guild_id === null) return null;

	const launch = database.query<{
		triggered_at: number; vote_closes_at: number; switch_at: number; applied_at: number | null
	}, []>('SELECT triggered_at, vote_closes_at, switch_at, applied_at FROM global_expedition_launch WHERE id=1').get();
	if (launch === null) return null;
	const membership = database.query<{ opted_in: number; effective_at: number; source: string }, [number]>(
		'SELECT opted_in, effective_at, source FROM global_expedition_guild_participation WHERE guild_id=?'
	).get(guild_id);
	const launch_guild = database.query<{
		vote_result: 'passed' | 'failed' | null;
		aye_count: number | null; nay_count: number | null; eligible_count: number | null;
	}, [number]>('SELECT vote_result, aye_count, nay_count, eligible_count FROM global_expedition_launch_guilds WHERE guild_id=?')
		.get(guild_id);
	let ballot: GlobalExpeditionLaunchBallot | null = null;
	if (launch_guild !== null && launch.applied_at === null && now < launch.switch_at) {
		const current = launch_guild.vote_result === null
			? database.query<{ aye: number; nay: number; eligible: number }, [number, number, number]>(`SELECT
				COALESCE(SUM(v.choice='aye'), 0) AS aye,
				COALESCE(SUM(v.choice='nay'), 0) AS nay,
				(SELECT COUNT(*) FROM guild_memberships m JOIN clients c ON c.id=m.client_id
				WHERE m.guild_id=? AND c.last_multiplayer_active_at>=?) AS eligible
				FROM global_expedition_launch_votes v WHERE v.guild_id=?`)
				.get(guild_id, recently_active_cutoff(now), guild_id)!
			: { aye: launch_guild.aye_count!, nay: launch_guild.nay_count!, eligible: launch_guild.eligible_count! };
		const own_ballot = database.query<{ choice: 'aye' | 'nay'; guild_id: number }, [number]>(
			'SELECT choice, guild_id FROM global_expedition_launch_votes WHERE client_id=?').get(client_id);
		ballot = {
			aye: current.aye,
			nay: current.nay,
			eligible: current.eligible,
			can_vote: launch_guild.vote_result === null && now < launch.vote_closes_at &&
				database.query(`SELECT 1 FROM guild_memberships m JOIN clients c ON c.id=m.client_id
					WHERE m.client_id=? AND m.guild_id=? AND c.last_multiplayer_active_at>=?`)
					.get(client_id, guild_id, recently_active_cutoff(now)) !== null &&
				(own_ballot === null || own_ballot.guild_id === guild_id),
			locks_at: launch.vote_closes_at,
			ends_at: launch.switch_at,
			result: launch_guild.vote_result === 'passed' ? 'aye' : launch_guild.vote_result === 'failed' ? 'nay' : null,
			choice: own_ballot?.guild_id === guild_id ? own_ballot.choice : null
		};
	}
	const pending = membership !== null && membership.opted_in === 1 && membership.effective_at > now;
	const enabled = launch.applied_at !== null && membership?.opted_in === 1 && membership.effective_at <= now;
	return {
		scope: enabled ? 'global' : 'guild',
		enabled,
		ballot,
		starts_at: pending ? membership.effective_at : null,
		registration_pending: pending && membership?.source === 'launch_default' && launch_guild === null
	};
}

export function trigger_global_expedition_launch(now: number, database: Database = db): boolean {
	if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('now must be a non-negative safe integer');
	return database.transaction(() => {
		if (database.query('SELECT 1 FROM global_expedition_launch WHERE id=1').get() !== null) return false;
		database.query(`INSERT INTO global_expedition_launch(id, triggered_at, vote_closes_at, switch_at)
			VALUES(1, ?, ?, ?)`).run(now, now + GLOBAL_EXPEDITION_LAUNCH_VOTE_MS, now + GLOBAL_EXPEDITION_SWITCH_DELAY_MS);
		database.query('INSERT INTO global_expedition_launch_guilds(guild_id) SELECT id FROM guilds').run();
		return true;
	}).immediate();
}

export function cast_global_expedition_launch_ballot(
	client_id: number,
	choice: unknown,
	now: number,
	database: Database = db
): { success: true } | null {
	if (choice !== 'aye' && choice !== 'nay') return null;
	if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('now must be a non-negative safe integer');
	return database.transaction(() => {
		const launch = database.query<{ vote_closes_at: number }, []>(
			'SELECT vote_closes_at FROM global_expedition_launch WHERE id=1').get();
		if (launch === null || now >= launch.vote_closes_at) return null;
		const member = database.query<{ guild_id: number }, [number, number]>(`SELECT m.guild_id FROM guild_memberships m
			JOIN clients c ON c.id=m.client_id
			JOIN global_expedition_launch_guilds g ON g.guild_id=m.guild_id
			WHERE m.client_id=? AND c.last_multiplayer_active_at>=?`).get(client_id,
			recently_active_cutoff(now));
		if (member === null) return null;
		const ballot = database.query(`INSERT INTO global_expedition_launch_votes(client_id, guild_id, choice, cast_at)
			VALUES(?, ?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET choice=excluded.choice, cast_at=excluded.cast_at
			WHERE global_expedition_launch_votes.guild_id=excluded.guild_id`).run(client_id, member.guild_id, choice, now);
		if (ballot.changes !== 1) return null;
		return { success: true as const };
	}).immediate();
}

export function global_expedition_launch_summary(database: Database = db): GlobalExpeditionLaunchSummary | null {
	const launch = database.query<{
		triggered_at: number; vote_closes_at: number; switch_at: number; applied_at: number | null
	}, []>(
		'SELECT triggered_at, vote_closes_at, switch_at, applied_at FROM global_expedition_launch WHERE id=1').get();
	if (launch === null) return null;
	return {
		...launch,
		guilds: database.query<GlobalExpeditionLaunchSummary['guilds'][number], []>(
			'SELECT guild_id, vote_result, aye_count, nay_count, eligible_count FROM global_expedition_launch_guilds ORDER BY guild_id').all()
	};
}

export function maintain_global_expedition_launch(
	now: number,
	apply: (guild_ids: number[], switch_at: number) => void,
	database: Database = db
): boolean {
	if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('now must be a non-negative safe integer');
	const before = database.query<{ vote_closes_at: number; switch_at: number; applied_at: number | null }, []>(
		'SELECT vote_closes_at, switch_at, applied_at FROM global_expedition_launch WHERE id=1').get();
	if (before === null || before.applied_at !== null || now < before.vote_closes_at) return false;
	const unresolved_before = database.query('SELECT 1 FROM global_expedition_launch_guilds WHERE vote_result IS NULL LIMIT 1').get() !== null;
	if (!unresolved_before && now < before.switch_at) return false;
	return database.transaction(() => {
		const launch = database.query<{ vote_closes_at: number; switch_at: number; applied_at: number | null }, []>(
			'SELECT vote_closes_at, switch_at, applied_at FROM global_expedition_launch WHERE id=1').get();
		if (launch === null || launch.applied_at !== null) return false;
		if (now >= launch.vote_closes_at && unresolved_before) {
			const unresolved = database.query<{ guild_id: number }, []>(
				'SELECT guild_id FROM global_expedition_launch_guilds WHERE vote_result IS NULL ORDER BY guild_id').all();
			const finalize = database.query(`UPDATE global_expedition_launch_guilds SET vote_result=?, aye_count=?, nay_count=?, eligible_count=?
				WHERE guild_id=? AND vote_result IS NULL`);
			const participation = database.query(`INSERT INTO global_expedition_guild_participation
				(guild_id, opted_in, effective_at, changed_at, source) VALUES(?, ?, ?, ?, 'launch_default')
				ON CONFLICT(guild_id) DO UPDATE SET opted_in=excluded.opted_in, effective_at=excluded.effective_at,
				changed_at=excluded.changed_at, source=excluded.source`);
			for (const { guild_id } of unresolved) {
				const tally = database.query<{ aye: number; nay: number; eligible: number }, [number, number, number]>(`SELECT
					COALESCE(SUM(v.choice='aye'), 0) AS aye,
					COALESCE(SUM(v.choice='nay'), 0) AS nay,
					(SELECT COUNT(*) FROM guild_memberships m JOIN clients c ON c.id=m.client_id
						WHERE m.guild_id=? AND c.last_multiplayer_active_at>=?) AS eligible
					FROM global_expedition_launch_votes v WHERE v.guild_id=?`).get(guild_id,
					recently_active_cutoff(now), guild_id)!;
				const passed = tally.aye >= tally.nay;
				finalize.run(passed ? 'passed' : 'failed', tally.aye, tally.nay, tally.eligible, guild_id);
				participation.run(guild_id, passed ? 1 : 0, launch.switch_at, now);
			}
		}
		if (now < launch.switch_at) return false;
		if (database.query('SELECT 1 FROM global_expedition_launch_guilds WHERE vote_result IS NULL LIMIT 1').get() !== null)
			return false;
		const guild_ids = database.query<{ guild_id: number }, [number]>(`SELECT guild_id
			FROM global_expedition_guild_participation WHERE opted_in=1 AND effective_at<=? ORDER BY guild_id`)
			.all(launch.switch_at).map(row => row.guild_id);
		apply(guild_ids, launch.switch_at);
		database.query('UPDATE global_expedition_launch SET applied_at=? WHERE id=1 AND applied_at IS NULL').run(now);
		return true;
	}).immediate();
}

export function apply_global_expedition_participation_petition(
	petition: Pick<guild_petitions, 'id' | 'guild_id' | 'type'> & { type: PetitionType },
	now: number,
	database: Database = db
): string {
	if (petition.type !== 'global_expedition_opt_in' && petition.type !== 'global_expedition_opt_out')
		throw new RangeError('Not a Global Expedition participation petition');
	const opted_in = petition.type === 'global_expedition_opt_in';
	const applied = database.transaction(() => {
		const launch = database.query<{ applied_at: number | null }, []>(
			'SELECT applied_at FROM global_expedition_launch WHERE id=1').get();
		if (launch?.applied_at === null || launch === null) return false;
		const updated = database.query(`INSERT INTO global_expedition_guild_participation
			(guild_id, opted_in, effective_at, changed_at, source) VALUES(?, ?, ?, ?, 'council')
			ON CONFLICT(guild_id) DO UPDATE SET opted_in=excluded.opted_in, effective_at=excluded.effective_at,
			changed_at=excluded.changed_at, source=excluded.source`).run(petition.guild_id,
			opted_in ? 1 : 0, now, now);
		database.query(`UPDATE clients SET event_revision=event_revision+1
			WHERE id IN (SELECT client_id FROM guild_memberships WHERE guild_id=?)`).run(petition.guild_id);
		participation_handler?.(petition.guild_id, opted_in, now);
		return updated.changes > 0;
	}).immediate();
	return applied ? (opted_in ? 'opted_in' : 'opted_out') : 'launch_unavailable';
}
