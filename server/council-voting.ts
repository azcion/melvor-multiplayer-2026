import type { Database } from 'bun:sqlite';
import { db } from './db';
import type { guild_petitions } from './db/types/db_types';

export const COUNCIL_MEMBERSHIP_WAIT = 20 * 60 * 60 * 1000;

// The original activity snapshot sets the requirement, not the lifetime electorate.
export function snapshot_council_threshold(petition_id: number, guild_id: number, now: number, database: Database = db) {
	database.query(`INSERT INTO guild_petition_voters(petition_id, client_id)
		SELECT ?, m.client_id FROM guild_memberships m JOIN clients c ON c.id=m.client_id
		WHERE m.guild_id=? AND c.last_multiplayer_active_at>=?`)
		.run(petition_id, guild_id, now - 4 * 86400000);
	const count = database.query<{ count: number }, [number]>(
		'SELECT COUNT(*) AS count FROM guild_petition_voters WHERE petition_id=?').get(petition_id)!.count;
	database.query('UPDATE guild_petitions SET snapshot_active_count=?, voting_threshold=? WHERE id=?')
		.run(count, Math.max(1, Math.ceil(count / 2)), petition_id);
}

export function can_cast_council_vote(petition: Pick<guild_petitions, 'id' | 'guild_id' | 'voting_threshold'>,
	client_id: number, now: number, database: Database = db): boolean {
	if (petition.voting_threshold === null)
		return database.query(`SELECT 1 FROM guild_petition_voters v JOIN guild_memberships m ON m.client_id=v.client_id
			WHERE v.petition_id=? AND v.client_id=? AND m.guild_id=?`).get(petition.id, client_id, petition.guild_id) !== null;
	return database.query('SELECT 1 FROM guild_memberships WHERE guild_id=? AND client_id=? AND joined_at<=?')
		.get(petition.guild_id, client_id, now - COUNCIL_MEMBERSHIP_WAIT) !== null;
}

// Includes departed members' recorded ballots, so uncast counts never go negative.
export function council_voter_count(petition_id: number, guild_id: number, now: number, database: Database = db): number {
	return database.query<{ count: number }, [number, number, number]>(`SELECT COUNT(*) AS count FROM (
		SELECT client_id FROM guild_memberships WHERE guild_id=? AND joined_at<=?
		UNION SELECT client_id FROM guild_petition_votes WHERE petition_id=?
	)`).get(guild_id, now - COUNCIL_MEMBERSHIP_WAIT, petition_id)!.count;
}

export function resolve_threshold_vote(threshold: number, aye: number, nay: number): 'granted' | 'denied' | null {
	if (!Number.isSafeInteger(threshold) || threshold < 1 ||
		!Number.isSafeInteger(aye) || aye < 0 || !Number.isSafeInteger(nay) || nay < 0 ||
		(aye >= threshold && nay >= threshold))
		throw new RangeError('Invalid threshold vote tally');
	if (aye >= threshold) return 'granted';
	if (nay >= threshold) return 'denied';
	return null;
}

// Ballots remain durable; only current, active, eligible members hold voting open.
export function resolve_council_vote(petition: Pick<guild_petitions, 'id' | 'guild_id' | 'voting_threshold' | 'expires_at'>,
	now: number, database: Database = db): 'granted' | 'denied' | null {
	const tally = database.query<{ aye: number; nay: number }, [number]>(`SELECT
		COALESCE(SUM(choice='aye'), 0) AS aye, COALESCE(SUM(choice='nay'), 0) AS nay
		FROM guild_petition_votes WHERE petition_id=?`).get(petition.id)!;
	if (petition.expires_at > now) {
		// An empty electorate alone must not resolve a newly raised, unvoted Petition.
		if (tally.aye + tally.nay === 0) return null;
		const uncast = database.query(`SELECT 1 FROM guild_memberships m JOIN clients c ON c.id=m.client_id
			WHERE m.guild_id=? AND c.last_multiplayer_active_at>=?
			AND ((? IS NOT NULL AND m.joined_at<=?) OR (? IS NULL AND EXISTS (
				SELECT 1 FROM guild_petition_voters v WHERE v.petition_id=? AND v.client_id=m.client_id)))
			AND NOT EXISTS (SELECT 1 FROM guild_petition_votes v WHERE v.petition_id=? AND v.client_id=m.client_id)
			LIMIT 1`).get(petition.guild_id, now - 4 * 86400000, petition.voting_threshold,
				now - COUNCIL_MEMBERSHIP_WAIT, petition.voting_threshold, petition.id, petition.id);
		if (uncast !== null) return null;
	}
	return tally.aye > tally.nay ? 'granted' : 'denied';
}
