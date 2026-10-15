// All discussion entry points use the same creator and vote disclosure boundary.
export const petition_creator_visibility = `((message.event_type IS NOT 'proposal' AND message.idempotency_key NOT LIKE 'alliance-reason:%') OR EXISTS(
	SELECT 1 FROM petition_discussions d WHERE d.id=message.petition_id AND d.show_creator=1))`;

export function petition_votes_visible_sql(client_id: number): string {
	if (!Number.isSafeInteger(client_id) || client_id < 1) throw new Error('Invalid discussion viewer');
	return `EXISTS(SELECT 1 FROM petition_discussions d WHERE d.id=message.petition_id AND
	(d.closed_at IS NOT NULL OR EXISTS(SELECT 1 FROM petition_discussion_voters v WHERE v.discussion_id=d.id AND v.client_id=${client_id})))`;
}

export function petition_discussion_visibility(client_id: number): string {
	return `${petition_creator_visibility} AND (message.event_type IS NULL OR message.event_type NOT IN ('aye','nay') OR ${petition_votes_visible_sql(client_id)})`;
}
