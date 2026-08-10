import { db } from './db';
import type { Database } from 'bun:sqlite';
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_MESSAGE_PAGE_SIZE } from './chat';

const MAX_INCREMENTAL_MESSAGES = 100;
export type SupportResult<T> = { status: 'ok'; value: T } | { status: 'bad_request' | 'missing' };

type Team = { id: number; display_name: string; inbox_label: string; icon_id: string; welcome_content: string };
type Membership = { id: number; team_id: number; cloud_username: string };
type Conversation = { id: number; team_id: number; player_client_id: number; created_at: number };
type Message = {
	id: number; conversation_id: number; author_kind: 'automated' | 'player' | 'member';
	membership_id: number | null; sending_client_id: number | null; content: string; created_at: number;
};

function active_memberships(client_id: number): Membership[] {
	return db.query<Membership, [number]>(
		'SELECT membership.`id`, membership.`team_id`, account.`cloud_username` ' +
		'FROM `clients` AS client JOIN `support_team_memberships` AS membership ' +
		'ON membership.`melvor_account_id` = client.`melvor_account_id` AND membership.`active` = 1 ' +
		'JOIN `melvor_accounts` AS account ON account.`id` = membership.`melvor_account_id` ' +
		'WHERE client.`id` = ?'
	).all(client_id);
}

function membership_for(client_id: number, team_id: number): Membership | null {
	return db.query<Membership, [number, number]>(
		'SELECT membership.`id`, membership.`team_id`, account.`cloud_username` ' +
		'FROM `clients` AS client JOIN `support_team_memberships` AS membership ' +
		'ON membership.`melvor_account_id` = client.`melvor_account_id` AND membership.`active` = 1 ' +
		'JOIN `melvor_accounts` AS account ON account.`id` = membership.`melvor_account_id` ' +
		'WHERE client.`id` = ? AND membership.`team_id` = ? LIMIT 1'
	).get(client_id, team_id);
}

function team(team_id: number): Team | null {
	return db.query<Team, [number]>(
		'SELECT `id`, `display_name`, `inbox_label`, `icon_id`, `welcome_content` FROM `support_teams` WHERE `id` = ?'
	).get(team_id);
}

function ensure_virtual_welcomes(client_id: number, now = Date.now()): void {
	db.query(
		'INSERT INTO `support_virtual_welcomes` (`team_id`, `client_id`, `presented_at`) ' +
		'SELECT team.`id`, ?, ? FROM `support_teams` AS team ' +
		'WHERE NOT EXISTS (SELECT 1 FROM `support_conversations` AS conversation ' +
			'WHERE conversation.`team_id` = team.`id` AND conversation.`player_client_id` = ?) ' +
		'AND NOT EXISTS (SELECT 1 FROM `clients` AS client JOIN `support_team_memberships` AS membership ' +
			'ON membership.`melvor_account_id` = client.`melvor_account_id` ' +
			'WHERE client.`id` = ? AND membership.`team_id` = team.`id` AND membership.`active` = 1) ' +
		'ON CONFLICT DO NOTHING'
	).run(client_id, now, client_id, client_id);
}

function message_sender(message: Message, conversation: Conversation, support_team: Team) {
	if (message.author_kind === 'automated')
		return { display_name: support_team.display_name, icon_id: support_team.icon_id };
	if (message.author_kind === 'player')
		return db.query<{ display_name: string; icon_id: string }, [number]>(
			'SELECT `display_name`, `icon_id` FROM `clients` WHERE `id` = ?'
		).get(conversation.player_client_id) as { display_name: string; icon_id: string };
	return db.query<{ display_name: string; icon_id: string }, [number]>(
		'SELECT account.`cloud_username` AS `display_name`, team.`icon_id` ' +
		'FROM `support_team_memberships` AS membership JOIN `melvor_accounts` AS account ' +
		'ON account.`id` = membership.`melvor_account_id` JOIN `support_teams` AS team ON team.`id` = membership.`team_id` ' +
		'WHERE membership.`id` = ?'
	).get(message.membership_id as number) as { display_name: string; icon_id: string };
}

function message_view(message: Message, conversation: Conversation, support_team: Team, viewer_side: 'player' | 'team') {
	const author_side = message.author_kind === 'player' ? 'player' : 'team';
	return {
		message_id: message.id,
		conversation_id: conversation.id,
		sender_id: message.sending_client_id,
		sender: message_sender(message, conversation, support_team),
		content: message.content,
		created_at: message.created_at,
		author_side,
		sent_by_viewer: author_side === viewer_side
	};
}

function conversation_access(client_id: number, conversation_id: number) {
	const conversation = db.query<Conversation, [number]>(
		'SELECT * FROM `support_conversations` WHERE `id` = ?'
	).get(conversation_id);
	if (conversation === null)
		return null;
	if (conversation.player_client_id === client_id)
		return { conversation, membership: null, viewer_side: 'player' as const };
	const membership = membership_for(client_id, conversation.team_id);
	return membership === null ? null : { conversation, membership, viewer_side: 'team' as const };
}

export function parse_support_membership_ids(raw: string | undefined): string[] | undefined {
	if (raw === undefined)
		return undefined;
	const values = raw.split(',').map(value => value.trim());
	if (values.some(value => value.length > 128 || (value.length === 0 && raw.trim().length > 0)))
		throw new Error('SUPPORT_TEAM_PLAYFAB_IDS must be a comma-separated list of PlayFab IDs');
	return [...new Set(values.filter(Boolean))];
}

export function reconcile_support_memberships(raw: string | undefined, now = Date.now(), database: Database = db): void {
	const ids = parse_support_membership_ids(raw);
	if (ids === undefined)
		return;
	const reconcile = database.transaction(() => {
		const support_team = database.query<{ id: number }, []>(
			"SELECT `id` FROM `support_teams` WHERE `system_key` = 'multiplayer_mod_team'"
		).get() as { id: number };
		database.query('UPDATE `support_team_memberships` SET `active` = 0 WHERE `team_id` = ?').run(support_team.id);
		for (const playfab_id of ids) {
			const account = database.query<{ id: number }, [string]>(
				'SELECT `id` FROM `melvor_accounts` WHERE `playfab_id` = ?'
			).get(playfab_id);
			if (account !== null)
				database.query(
					'INSERT INTO `support_team_memberships` (`team_id`, `melvor_account_id`, `created_at`) VALUES(?, ?, ?) ' +
					'ON CONFLICT (`team_id`, `melvor_account_id`) DO UPDATE SET `active` = 1'
				).run(support_team.id, account.id, now);
		}
	});
	reconcile.immediate();
}

export function list_support_conversations(client_id: number, now = Date.now()): any[] {
	ensure_virtual_welcomes(client_id, now);
	const result: any[] = [];
	const memberships = active_memberships(client_id);
	for (const membership of memberships) {
		const rows = db.query<Conversation, [number]>(
			'SELECT conversation.* FROM `support_conversations` AS conversation JOIN `clients` AS player ' +
			'ON player.`id` = conversation.`player_client_id` WHERE conversation.`team_id` = ? ' +
			'AND player.`deleted_at` IS NULL ORDER BY conversation.`id` DESC'
		).all(membership.team_id);
		for (const conversation of rows)
			result.push(conversation_summary(conversation, 'team', membership));
	}
	const player_rows = db.query<Conversation, [number]>(
		'SELECT conversation.* FROM `support_conversations` AS conversation WHERE conversation.`player_client_id` = ? ' +
		'AND NOT EXISTS (SELECT 1 FROM `clients` AS client JOIN `support_team_memberships` AS membership ' +
		'ON membership.`melvor_account_id` = client.`melvor_account_id` WHERE client.`id` = conversation.`player_client_id` ' +
		'AND membership.`team_id` = conversation.`team_id` AND membership.`active` = 1) ORDER BY conversation.`id` DESC'
	).all(client_id);
	for (const conversation of player_rows)
		result.push(conversation_summary(conversation, 'player', null));
	const virtuals = db.query<{ team_id: number; presented_at: number; read_at: number | null }, [number]>(
		'SELECT welcome.* FROM `support_virtual_welcomes` AS welcome ' +
		'WHERE welcome.`client_id` = ? AND NOT EXISTS (SELECT 1 FROM `support_conversations` AS conversation ' +
		'WHERE conversation.`team_id` = welcome.`team_id` AND conversation.`player_client_id` = welcome.`client_id`) ' +
		'AND NOT EXISTS (SELECT 1 FROM `clients` AS client JOIN `support_team_memberships` AS membership ' +
		'ON membership.`melvor_account_id` = client.`melvor_account_id` WHERE client.`id` = welcome.`client_id` ' +
		'AND membership.`team_id` = welcome.`team_id` AND membership.`active` = 1)'
	).all(client_id);
	for (const welcome of virtuals) {
		if (membership_for(client_id, welcome.team_id) !== null)
			continue;
		const support_team = team(welcome.team_id) as Team;
		result.push({ conversation_kind: 'support', conversation_id: null, support_team_id: support_team.id,
			viewer_side: 'player', participant: { client_id: null, display_name: support_team.display_name, icon_id: support_team.icon_id },
			created_at: welcome.presented_at, latest_message: { message_id: 0, conversation_id: null, sender_id: null,
				sender: { display_name: support_team.display_name, icon_id: support_team.icon_id }, content: support_team.welcome_content,
				created_at: welcome.presented_at, author_side: 'team', sent_by_viewer: false },
			unread_count: welcome.read_at === null ? 1 : 0, blocked: false });
	}
	return result.sort((a, b) => Number((b.latest_message as { created_at: number }).created_at) -
		Number((a.latest_message as { created_at: number }).created_at));
}

function conversation_summary(conversation: Conversation, viewer_side: 'player' | 'team', membership: Membership | null) {
	const support_team = team(conversation.team_id) as Team;
	const player = db.query<{ display_name: string; icon_id: string }, [number]>(
		'SELECT `display_name`, `icon_id` FROM `clients` WHERE `id` = ?'
	).get(conversation.player_client_id) as { display_name: string; icon_id: string };
	const latest = db.query<Message, [number]>(
		'SELECT * FROM `support_messages` AS message WHERE `conversation_id` = ? AND NOT EXISTS ' +
		'(SELECT 1 FROM `support_message_moderation` AS moderation WHERE moderation.`message_id` = message.`id`) ' +
		'ORDER BY `id` DESC LIMIT 1'
	).get(conversation.id);
	const unread = viewer_side === 'player'
		? db.query<{ count: number }, [number, number]>(
			'SELECT COUNT(*) AS `count` FROM `support_messages` AS message WHERE message.`conversation_id` = ? ' +
			'AND message.`author_kind` != \'player\' AND NOT EXISTS (SELECT 1 FROM `support_message_moderation` AS moderation ' +
			'WHERE moderation.`message_id` = message.`id`) AND NOT EXISTS (SELECT 1 FROM `support_player_message_reads` AS read ' +
			'WHERE read.`message_id` = message.`id` AND read.`client_id` = ?)'
		).get(conversation.id, conversation.player_client_id)?.count ?? 0
		: db.query<{ count: number }, [number, number]>(
			'SELECT COUNT(*) AS `count` FROM `support_messages` AS message WHERE message.`conversation_id` = ? ' +
			'AND message.`author_kind` = \'player\' AND NOT EXISTS (SELECT 1 FROM `support_message_moderation` AS moderation ' +
			'WHERE moderation.`message_id` = message.`id`) AND NOT EXISTS (SELECT 1 FROM `support_member_message_reads` AS read ' +
			'WHERE read.`message_id` = message.`id` AND read.`membership_id` = ?)'
		).get(conversation.id, (membership as Membership).id)?.count ?? 0;
	return { conversation_kind: 'support', conversation_id: conversation.id, support_team_id: conversation.team_id,
		viewer_side, participant: viewer_side === 'player'
			? { client_id: null, display_name: support_team.display_name, icon_id: support_team.icon_id }
			: { client_id: conversation.player_client_id, display_name: `${player.display_name} @${support_team.inbox_label}`, icon_id: player.icon_id },
		created_at: conversation.created_at, latest_message: latest === null ? null : message_view(latest, conversation, support_team, viewer_side),
		unread_count: unread, blocked: false };
}

export function get_support_unread_count(client_id: number): number {
	return list_support_conversations(client_id).reduce((sum, conversation) => sum + Number(conversation.unread_count), 0);
}

export function list_support_messages(client_id: number, conversation_id: number | null, team_id: number | null,
	before: number | null, after: number | null): SupportResult<{ messages: any[]; has_more: boolean }> {
	if ((conversation_id !== null && (!Number.isSafeInteger(conversation_id) || conversation_id < 1)) ||
		(team_id !== null && (!Number.isSafeInteger(team_id) || team_id < 1)) ||
		(before !== null && (!Number.isSafeInteger(before) || before < 1)) ||
		(after !== null && (!Number.isSafeInteger(after) || after < 0)) || (before !== null && after !== null))
		return { status: 'bad_request' };
	if (conversation_id === null) {
		if (team_id === null || membership_for(client_id, team_id) !== null)
			return { status: 'missing' };
		ensure_virtual_welcomes(client_id);
		const welcome = db.query<{ presented_at: number }, [number, number]>(
			'SELECT `presented_at` FROM `support_virtual_welcomes` WHERE `team_id` = ? AND `client_id` = ?'
		).get(team_id, client_id);
		const support_team = team(team_id);
		if (welcome === null || support_team === null)
			return { status: 'missing' };
		db.query('UPDATE `support_virtual_welcomes` SET `read_at` = COALESCE(`read_at`, ?) WHERE `team_id` = ? AND `client_id` = ?')
			.run(Date.now(), team_id, client_id);
		return { status: 'ok', value: { messages: [{ message_id: 0, conversation_id: null, sender_id: null,
			sender: { display_name: support_team.display_name, icon_id: support_team.icon_id }, content: support_team.welcome_content,
			created_at: welcome.presented_at, author_side: 'team', sent_by_viewer: false }], has_more: false } };
	}
	const access = conversation_access(client_id, conversation_id);
	if (access === null)
		return { status: 'missing' };
	const values: number[] = [conversation_id];
	let cursor = '';
	let order = 'DESC';
	let limit = CHAT_MESSAGE_PAGE_SIZE + 1;
	if (before !== null) { cursor = ' AND `id` < ?'; values.push(before); }
	else if (after !== null) { cursor = ' AND `id` > ?'; values.push(after); order = 'ASC'; limit = MAX_INCREMENTAL_MESSAGES + 1; }
	const rows = db.query<Message, number[]>(
		'SELECT * FROM `support_messages` AS message WHERE `conversation_id` = ? AND NOT EXISTS ' +
		'(SELECT 1 FROM `support_message_moderation` AS moderation WHERE moderation.`message_id` = message.`id`)' +
		cursor.replaceAll('`id`', 'message.`id`') + ` ORDER BY message.\`id\` ${order} LIMIT ${limit}`
	).all(...values);
	const page_limit = after === null ? CHAT_MESSAGE_PAGE_SIZE : MAX_INCREMENTAL_MESSAGES;
	const page = rows.slice(0, page_limit);
	if (order === 'DESC') page.reverse();
	const read_at = Date.now();
	for (const message of page) {
		if (access.viewer_side === 'player' && message.author_kind !== 'player')
			db.query('INSERT INTO `support_player_message_reads` VALUES(?, ?, ?) ON CONFLICT DO NOTHING')
				.run(message.id, client_id, read_at);
		if (access.viewer_side === 'team' && message.author_kind === 'player')
			db.query('INSERT INTO `support_member_message_reads` VALUES(?, ?, ?) ON CONFLICT DO NOTHING')
				.run(message.id, (access.membership as Membership).id, read_at);
	}
	const support_team = team(access.conversation.team_id) as Team;
	return { status: 'ok', value: { messages: page.map(message => message_view(message, access.conversation, support_team,
		access.viewer_side)), has_more: rows.length > page_limit } };
}

export function send_support_message(client_id: number, conversation_id: number | null, team_id: number | null,
	idempotency_key: string, content: string, now = Date.now()): SupportResult<{ message: any }> {
	const trimmed = typeof content === 'string' ? content.trim() : '';
	if ((conversation_id !== null && (!Number.isSafeInteger(conversation_id) || conversation_id < 1)) ||
		(team_id !== null && (!Number.isSafeInteger(team_id) || team_id < 1)) || typeof idempotency_key !== 'string' ||
		idempotency_key.length < 1 || idempotency_key.length > 128 || trimmed.length < 1 || trimmed.length > CHAT_MESSAGE_MAX_LENGTH)
		return { status: 'bad_request' };
	const send = db.transaction((): SupportResult<{ message_id: number; viewer_side: 'player' | 'team' }> => {
		let conversation = conversation_id === null ? null : db.query<Conversation, [number]>(
			'SELECT * FROM `support_conversations` WHERE `id` = ?'
		).get(conversation_id);
		let membership = conversation === null ? null : membership_for(client_id, conversation.team_id);
		let viewer_side: 'player' | 'team';
		if (conversation !== null) {
			if (conversation.player_client_id === client_id) viewer_side = 'player';
			else if (membership !== null) viewer_side = 'team';
			else return { status: 'missing' };
		} else {
			if (team_id === null || membership_for(client_id, team_id) !== null || team(team_id) === null)
				return { status: 'missing' };
			viewer_side = 'player';
			conversation = db.query<Conversation, [number, number]>(
				'SELECT * FROM `support_conversations` WHERE `team_id` = ? AND `player_client_id` = ?'
			).get(team_id, client_id);
			if (conversation === null) {
				ensure_virtual_welcomes(client_id, now);
				const welcome = db.query<{ presented_at: number; read_at: number | null }, [number, number]>(
					'SELECT `presented_at`, `read_at` FROM `support_virtual_welcomes` WHERE `team_id` = ? AND `client_id` = ?'
				).get(team_id, client_id);
				if (welcome === null) return { status: 'missing' };
				const created = db.query('INSERT INTO `support_conversations` (`team_id`, `player_client_id`, `created_at`) VALUES(?, ?, ?)')
					.run(team_id, client_id, now);
				conversation = { id: Number(created.lastInsertRowid), team_id, player_client_id: client_id, created_at: now };
				const welcome_content = (team(team_id) as Team).welcome_content;
				const welcome_message = db.query('INSERT INTO `support_messages` (`conversation_id`, `author_kind`, `idempotency_scope`, `idempotency_key`, `content`, `created_at`) VALUES(?, \'automated\', ?, ?, ?, ?)')
					.run(conversation.id, `welcome:${team_id}:${client_id}`, 'welcome', welcome_content, welcome.presented_at);
				if (welcome.read_at !== null)
					db.query('INSERT INTO `support_player_message_reads` VALUES(?, ?, ?)')
						.run(Number(welcome_message.lastInsertRowid), client_id, welcome.read_at);
			}
		}
		membership = viewer_side === 'team' ? membership_for(client_id, conversation.team_id) : null;
		const scope = viewer_side === 'player' ? `player:${client_id}` : `membership:${(membership as Membership).id}`;
		const duplicate = db.query<Message, [string, string]>(
			'SELECT * FROM `support_messages` WHERE `idempotency_scope` = ? AND `idempotency_key` = ?'
		).get(scope, idempotency_key);
		if (duplicate !== null) {
			if (duplicate.conversation_id !== conversation.id || duplicate.content !== trimmed) return { status: 'bad_request' };
			return { status: 'ok', value: { message_id: duplicate.id, viewer_side } };
		}
		const created = db.query(
			'INSERT INTO `support_messages` (`conversation_id`, `author_kind`, `membership_id`, `sending_client_id`, `idempotency_scope`, `idempotency_key`, `content`, `created_at`) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'
		).run(conversation.id, viewer_side === 'player' ? 'player' : 'member', membership?.id ?? null, client_id,
			scope, idempotency_key, trimmed, now);
		return { status: 'ok', value: { message_id: Number(created.lastInsertRowid), viewer_side } };
	});
	const result = send.immediate();
	if (result.status !== 'ok') return result;
	const message = db.query<Message, [number]>('SELECT * FROM `support_messages` WHERE `id` = ?').get(result.value.message_id) as Message;
	const conversation = db.query<Conversation, [number]>('SELECT * FROM `support_conversations` WHERE `id` = ?').get(message.conversation_id) as Conversation;
	return { status: 'ok', value: { message: message_view(message, conversation, team(conversation.team_id) as Team,
		result.value.viewer_side) } };
}
