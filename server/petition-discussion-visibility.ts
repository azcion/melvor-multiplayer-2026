// Changing show_creator also suppresses already materialized proposal Messages, including
// their sender/profile metadata. It never suppresses a person's independent vote or replies.
export const petition_creator_visibility = `(message.event_type IS NOT 'proposal' OR EXISTS(
	SELECT 1 FROM guild_petitions p WHERE p.id=message.petition_id AND p.show_creator=1))`;

// Viewer IDs originate from authenticated sessions, never request-supplied SQL.
export function petition_discussion_visibility(client_id: number): string {
	if (!Number.isSafeInteger(client_id) || client_id < 1) throw new Error('Invalid discussion viewer');
	return `${petition_creator_visibility} AND (message.event_type IS NULL OR message.event_type NOT IN ('aye','nay')
		OR EXISTS(SELECT 1 FROM guild_petitions p WHERE p.id=message.petition_id AND (p.lifecycle!='active'
		OR EXISTS(SELECT 1 FROM guild_petition_votes v WHERE v.petition_id=p.id AND v.client_id=${client_id}))))`;
}
