import type { Database } from 'bun:sqlite';
import { db } from './db';
// One process-wide snapshot; retained rows are counted once across distinct tables.
export function create_chat_reaction_picker(database: Database, tables: string[]) {
	let picker_cache: { expires: number; choices: string[] } | null = null;
	return function(now = Date.now()): string[] {
		if (!picker_cache || now >= picker_cache.expires) {
			const union = [...new Set(tables)].map(table => `SELECT reaction FROM ${table}`).join(' UNION ALL ');
			const ranked = database.query<{reaction: string}, []>(`SELECT reaction FROM (${union}) GROUP BY reaction ORDER BY COUNT(*) DESC, reaction COLLATE BINARY ASC LIMIT 18`).all().map(row => row.reaction);
			const fallback = ['👍','👎','❤️','😂','😭','💀','👀','🔥','💯','🎉','🤔','😮','😬','😡','🗿','👋','👏','😎'];
			picker_cache = { expires: now + 24 * 60 * 60 * 1000, choices: [...new Set([...ranked, ...fallback])].slice(0, 18) };
		}
		return [...picker_cache.choices];
	};
}
export const get_chat_reaction_choices = create_chat_reaction_picker(db, ['chat_message_reactions', 'alliance_chat_message_reactions', 'guild_chat_message_reactions', 'global_chat_message_reactions', 'support_message_reactions', 'poll_discussion_message_reactions', 'announcement_reactions', 'petition_discussion_message_reactions']);
