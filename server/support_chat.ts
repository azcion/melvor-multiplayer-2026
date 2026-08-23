import { db } from './db';
import type { Database } from 'bun:sqlite';
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_MESSAGE_PAGE_SIZE } from './chat';

const MAX_INCREMENTAL_MESSAGES = 100;
export type SupportResult<T> = { status: 'ok'; value: T } | { status: 'bad_request' | 'missing' };

type Team = {
	id: number; system_key: string; display_name: string; inbox_label: string; icon_id: string; welcome_content: string;
	required_active_mod_name: string | null; minimum_client_version: string | null;
};
type Membership = { id: number; team_id: number; member_display_name: string };
type Conversation = { id: number; team_id: number; player_client_id: number; created_at: number };
type Message = {
	id: number; conversation_id: number; author_kind: 'automated' | 'player' | 'member';
	membership_id: number | null; sending_client_id: number | null; content: string; created_at: number;
};

function membership_for(client_id: number, team_id: number): Membership | null {
	return db.query<Membership, [number, number]>(
		'SELECT membership.`id`, membership.`team_id`, membership.`member_display_name` ' +
		'FROM `support_team_memberships` AS membership ' +
		'WHERE membership.`client_id` = ? AND membership.`team_id` = ? AND membership.`active` = 1 LIMIT 1'
	).get(client_id, team_id);
}

function team(team_id: number): Team | null {
	return db.query<Team, [number]>(
		'SELECT `id`, `system_key`, `display_name`, `inbox_label`, `icon_id`, `welcome_content`, ' +
		'`required_active_mod_name`, `minimum_client_version` FROM `support_teams` WHERE `id` = ?'
	).get(team_id);
}

function version_at_least(actual: string, minimum: string): boolean {
	const actual_parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(actual)?.slice(1).map(Number);
	const minimum_parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(minimum)?.slice(1).map(Number);
	if (actual_parts === undefined || minimum_parts === undefined)
		return false;
	for (let index = 0; index < minimum_parts.length; index++) {
		if (actual_parts[index] !== minimum_parts[index])
			return actual_parts[index] > minimum_parts[index];
	}
	return true;
}

function player_is_eligible_for_team(client_id: number, support_team: Team): boolean {
	if (support_team.required_active_mod_name === null && support_team.minimum_client_version === null)
		return true;
	const runtime = db.query<{ mod_version: string; active_mods: string }, [number]>(
		'SELECT `mod_version`, `active_mods` FROM `client_runtime_snapshots` WHERE `client_id` = ?'
	).get(client_id);
	if (runtime === null)
		return false;
	if (support_team.minimum_client_version !== null &&
		!version_at_least(runtime.mod_version, support_team.minimum_client_version))
		return false;
	if (support_team.required_active_mod_name !== null) {
		const active_mods = JSON.parse(runtime.active_mods) as unknown;
		if (!Array.isArray(active_mods) || !active_mods.includes(support_team.required_active_mod_name))
			return false;
	}
	return true;
}

function ensure_virtual_welcomes(client_id: number, now = Date.now()): void {
	const teams = db.query<Team, []>('SELECT * FROM `support_teams`').all();
	const insert = db.query(
		'INSERT INTO `support_virtual_welcomes` (`team_id`, `client_id`, `presented_at`) ' +
		'SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM `support_conversations` AS conversation ' +
			'WHERE conversation.`team_id` = ? AND conversation.`player_client_id` = ?) ' +
		'AND NOT EXISTS (SELECT 1 FROM `support_team_memberships` AS membership ' +
			'WHERE membership.`client_id` = ? AND membership.`team_id` = ? AND membership.`active` = 1) ' +
		'ON CONFLICT DO NOTHING'
	);
	for (const support_team of teams) {
		if (player_is_eligible_for_team(client_id, support_team))
			insert.run(support_team.id, client_id, now, support_team.id, client_id, client_id, support_team.id);
	}
}

function message_sender(message: Message, conversation: Conversation, support_team: Team) {
	if (message.author_kind === 'automated')
		return { display_name: support_team.display_name, icon_id: support_team.icon_id };
	if (message.author_kind === 'player')
		return db.query<{ display_name: string; icon_id: string }, [number]>(
			'SELECT `display_name`, `icon_id` FROM `clients` WHERE `id` = ?'
		).get(conversation.player_client_id) as { display_name: string; icon_id: string };
	return db.query<{ display_name: string; icon_id: string }, [number]>(
		'SELECT membership.`member_display_name` AS `display_name`, team.`icon_id` ' +
		'FROM `support_team_memberships` AS membership ' +
		'JOIN `support_teams` AS team ON team.`id` = membership.`team_id` ' +
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
	if (conversation.player_client_id === client_id) {
		const support_team = team(conversation.team_id);
		return support_team !== null && player_is_eligible_for_team(client_id, support_team)
			? { conversation, membership: null, viewer_side: 'player' as const } : null;
	}
	const membership = membership_for(client_id, conversation.team_id);
	return membership === null ? null : { conversation, membership, viewer_side: 'team' as const };
}

export function parse_support_membership_client_identifiers(raw: string | undefined): string[] | undefined {
	if (raw === undefined)
		return undefined;
	const values = raw.split(',').map(value => value.trim());
	if (values.some(value => value.length > 128 || (value.length === 0 && raw.trim().length > 0)))
		throw new Error('SUPPORT_TEAM_CLIENT_IDENTIFIERS must be a comma-separated list of Client identifiers');
	return [...new Set(values.filter(Boolean))];
}

export function reconcile_support_memberships(raw: string | undefined, now = Date.now(), database: Database = db): void {
	const ids = parse_support_membership_client_identifiers(raw);
	if (ids === undefined)
		return;
	const reconcile = database.transaction(() => {
		const support_team = database.query<{ id: number }, []>(
			"SELECT `id` FROM `support_teams` WHERE `system_key` = 'multiplayer_mod_team'"
		).get() as { id: number };
		database.query('UPDATE `support_team_memberships` SET `active` = 0 WHERE `team_id` = ?').run(support_team.id);
		for (const client_identifier of ids) {
			const client = database.query<{ id: number; display_name: string }, [string]>(
				'SELECT `id`, `display_name` FROM `clients` WHERE `client_identifier` = ? AND `deleted_at` IS NULL'
			).get(client_identifier);
			if (client !== null)
				database.query(
					'INSERT INTO `support_team_memberships` ' +
					'(`team_id`, `client_id`, `member_display_name`, `created_at`) VALUES(?, ?, ?, ?) ' +
					'ON CONFLICT (`team_id`, `client_id`) DO UPDATE SET ' +
					'`member_display_name` = excluded.`member_display_name`, `active` = 1'
				).run(support_team.id, client.id, client.display_name, now);
		}
	});
	reconcile.immediate();
}

export function parse_support_team_memberships(raw: string | undefined): Record<string, string[]> | undefined {
	if (raw === undefined)
		return undefined;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new Error('SUPPORT_TEAM_MEMBERSHIPS must be a JSON object of team keys to Client identifier arrays');
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value))
		throw new Error('SUPPORT_TEAM_MEMBERSHIPS must be a JSON object of team keys to Client identifier arrays');
	const result: Record<string, string[]> = {};
	for (const [system_key, identifiers] of Object.entries(value)) {
		if (!/^[a-z0-9_]{1,64}$/.test(system_key) || !Array.isArray(identifiers) ||
			identifiers.some(identifier => typeof identifier !== 'string' || identifier.length < 1 || identifier.length > 128))
			throw new Error('SUPPORT_TEAM_MEMBERSHIPS contains an invalid team key or Client identifier array');
		result[system_key] = [...new Set(identifiers as string[])];
	}
	return result;
}

export function reconcile_support_team_memberships(raw: string | undefined, now = Date.now(), database: Database = db): void {
	const configured = parse_support_team_memberships(raw);
	if (configured === undefined)
		return;
	const reconcile = database.transaction(() => {
		for (const [system_key, identifiers] of Object.entries(configured)) {
			const support_team = database.query<{ id: number }, [string]>(
				'SELECT `id` FROM `support_teams` WHERE `system_key` = ?'
			).get(system_key);
			if (support_team === null)
				throw new Error(`SUPPORT_TEAM_MEMBERSHIPS names an unknown Support Team: ${system_key}`);
			database.query('UPDATE `support_team_memberships` SET `active` = 0 WHERE `team_id` = ?').run(support_team.id);
			for (const client_identifier of identifiers) {
				const client = database.query<{ id: number; display_name: string }, [string]>(
					'SELECT `id`, `display_name` FROM `clients` WHERE `client_identifier` = ? AND `deleted_at` IS NULL'
				).get(client_identifier);
				if (client !== null)
					database.query(
						'INSERT INTO `support_team_memberships` ' +
						'(`team_id`, `client_id`, `member_display_name`, `created_at`) VALUES(?, ?, ?, ?) ' +
						'ON CONFLICT (`team_id`, `client_id`) DO UPDATE SET ' +
						'`member_display_name` = excluded.`member_display_name`, `active` = 1'
					).run(support_team.id, client.id, client.display_name, now);
			}
		}
	});
	reconcile.immediate();
}

export function list_support_conversations(client_id: number, now = Date.now()): any[] {
	ensure_virtual_welcomes(client_id, now);
	type SummaryRow = Conversation & {
		viewer_side: 'player' | 'team'; viewer_membership_id: number | null;
		team_display_name: string; team_inbox_label: string; team_icon_id: string;
		player_display_name: string; player_icon_id: string;
		latest_id: number | null; latest_author_kind: Message['author_kind'] | null;
		latest_membership_id: number | null; latest_sending_client_id: number | null;
		latest_content: string | null; latest_created_at: number | null;
		latest_member_display_name: string | null; unread_count: number;
	};
	const summaries = db.query<SummaryRow, [number]>(`
		WITH viewer_conversations AS (
			SELECT conversation.*, 'team' AS viewer_side, membership.id AS viewer_membership_id
			FROM support_conversations AS conversation
			JOIN support_team_memberships AS membership
				ON membership.team_id = conversation.team_id
				AND membership.client_id = ?1 AND membership.active = 1
			JOIN clients AS player ON player.id = conversation.player_client_id AND player.deleted_at IS NULL
			UNION ALL
			SELECT conversation.*, 'player' AS viewer_side, NULL AS viewer_membership_id
			FROM support_conversations AS conversation
			WHERE conversation.player_client_id = ?1
			AND NOT EXISTS(SELECT 1 FROM support_team_memberships AS membership
				WHERE membership.client_id = ?1 AND membership.team_id = conversation.team_id
				AND membership.active = 1)
		), visible_messages AS (
			SELECT message.*,
				ROW_NUMBER() OVER (PARTITION BY message.conversation_id ORDER BY message.id DESC) AS message_rank
			FROM support_messages AS message
			JOIN viewer_conversations AS conversation ON conversation.id = message.conversation_id
			WHERE NOT EXISTS(SELECT 1 FROM support_message_moderation AS moderation
				WHERE moderation.message_id = message.id)
		), unread AS (
			SELECT conversation.id AS conversation_id,
				SUM(CASE
					WHEN conversation.viewer_side = 'player' AND message.author_kind != 'player'
						AND NOT EXISTS(SELECT 1 FROM support_player_message_reads AS read
							WHERE read.message_id = message.id AND read.client_id = ?1) THEN 1
					WHEN conversation.viewer_side = 'team' AND message.author_kind = 'player'
						AND NOT EXISTS(SELECT 1 FROM support_member_message_reads AS read
							WHERE read.message_id = message.id
							AND read.membership_id = conversation.viewer_membership_id) THEN 1
					ELSE 0
				END) AS unread_count
			FROM viewer_conversations AS conversation
			LEFT JOIN visible_messages AS message ON message.conversation_id = conversation.id
			GROUP BY conversation.id
		)
		SELECT conversation.*, team.display_name AS team_display_name,
			team.inbox_label AS team_inbox_label, team.icon_id AS team_icon_id,
			player.display_name AS player_display_name, player.icon_id AS player_icon_id,
			latest.id AS latest_id, latest.author_kind AS latest_author_kind,
			latest.membership_id AS latest_membership_id,
			latest.sending_client_id AS latest_sending_client_id,
			latest.content AS latest_content, latest.created_at AS latest_created_at,
			author_membership.member_display_name AS latest_member_display_name,
			COALESCE(unread.unread_count, 0) AS unread_count
		FROM viewer_conversations AS conversation
		JOIN support_teams AS team ON team.id = conversation.team_id
		JOIN clients AS player ON player.id = conversation.player_client_id
		LEFT JOIN visible_messages AS latest
			ON latest.conversation_id = conversation.id AND latest.message_rank = 1
		LEFT JOIN support_team_memberships AS author_membership ON author_membership.id = latest.membership_id
		LEFT JOIN unread ON unread.conversation_id = conversation.id
	`).all(client_id);
	const result: any[] = summaries.filter(conversation => conversation.viewer_side === 'team' ||
		player_is_eligible_for_team(client_id, team(conversation.team_id) as Team)).map(conversation => {
		const latest_author_side = conversation.latest_author_kind === 'player' ? 'player' : 'team';
		let latest_sender: { display_name: string; icon_id: string } | null = null;
		if (conversation.latest_author_kind === 'automated')
			latest_sender = { display_name: conversation.team_display_name, icon_id: conversation.team_icon_id };
		else if (conversation.latest_author_kind === 'player')
			latest_sender = { display_name: conversation.player_display_name, icon_id: conversation.player_icon_id };
		else if (conversation.latest_author_kind === 'member')
			latest_sender = { display_name: conversation.latest_member_display_name as string, icon_id: conversation.team_icon_id };
		return {
			conversation_kind: 'support', conversation_id: conversation.id, support_team_id: conversation.team_id,
			viewer_side: conversation.viewer_side,
			participant: conversation.viewer_side === 'player'
				? { client_id: null, display_name: conversation.team_display_name, icon_id: conversation.team_icon_id }
				: { client_id: conversation.player_client_id,
					display_name: `${conversation.player_display_name} @${conversation.team_inbox_label}`,
					icon_id: conversation.player_icon_id },
			created_at: conversation.created_at,
			latest_message: conversation.latest_id === null ? null : {
				message_id: conversation.latest_id, conversation_id: conversation.id,
				sender_id: conversation.latest_sending_client_id, sender: latest_sender,
				content: conversation.latest_content, created_at: conversation.latest_created_at,
				author_side: latest_author_side, sent_by_viewer: latest_author_side === conversation.viewer_side
			},
			unread_count: conversation.unread_count, blocked: false
		};
	});
	type VirtualRow = Team & { presented_at: number; read_at: number | null };
	const virtuals = db.query<VirtualRow, [number]>(`
		SELECT team.*, welcome.presented_at, welcome.read_at
		FROM support_virtual_welcomes AS welcome
		JOIN support_teams AS team ON team.id = welcome.team_id
		WHERE welcome.client_id = ?1
		AND NOT EXISTS(SELECT 1 FROM support_conversations AS conversation
			WHERE conversation.team_id = welcome.team_id AND conversation.player_client_id = welcome.client_id)
		AND NOT EXISTS(SELECT 1 FROM support_team_memberships AS membership
			WHERE membership.client_id = welcome.client_id AND membership.team_id = welcome.team_id
			AND membership.active = 1)
	`).all(client_id);
	for (const welcome of virtuals) {
		if (!player_is_eligible_for_team(client_id, welcome))
			continue;
		result.push({ conversation_kind: 'support', conversation_id: null, support_team_id: welcome.id,
			viewer_side: 'player', participant: { client_id: null, display_name: welcome.display_name, icon_id: welcome.icon_id },
			created_at: welcome.presented_at, latest_message: { message_id: 0, conversation_id: null, sender_id: null,
				sender: { display_name: welcome.display_name, icon_id: welcome.icon_id }, content: welcome.welcome_content,
				created_at: welcome.presented_at, author_side: 'team', sent_by_viewer: false },
			unread_count: welcome.read_at === null ? 1 : 0, blocked: false });
	}
	return result.sort((a, b) => Number((b.latest_message as { created_at: number } | null)?.created_at ?? 0) -
		Number((a.latest_message as { created_at: number } | null)?.created_at ?? 0));
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
		if (welcome === null || support_team === null || !player_is_eligible_for_team(client_id, support_team))
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
			if (conversation.player_client_id === client_id) {
				const support_team = team(conversation.team_id);
				if (support_team === null || !player_is_eligible_for_team(client_id, support_team))
					return { status: 'missing' };
				viewer_side = 'player';
			}
			else if (membership !== null) viewer_side = 'team';
			else return { status: 'missing' };
		} else {
			const requested_team = team_id === null ? null : team(team_id);
			if (team_id === null || membership_for(client_id, team_id) !== null || requested_team === null ||
				!player_is_eligible_for_team(client_id, requested_team))
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
