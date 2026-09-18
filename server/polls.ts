import { save_chat_parts, same_chat_parts, type ChatPart } from './chat_parts';
import { attach_translations } from './chat_translation';
import { db } from './db';
import { is_client_version_at_least } from './client-version-policy';
import { get_poll_owner_key } from './poll-ownership';

export const POLLS_CAPABILITY = 'polls-v1';
export const POLLS_MINIMUM_CLIENT_VERSION = '1.5.14';
const POLL_VOTE_THROTTLE_MS = 350;
const allowed_creator_identifiers = new Set<string>();

type PollResult<T> = { status: 'ok'; value: T } | { status: 'bad_request' | 'missing' | 'forbidden' } |
	{ status: 'throttled'; retry_after_ms: number };

export function has_polls_capability(url: URL): boolean {
	return url.searchParams.getAll('capabilities').some(value =>
		value.split(',').map(entry => entry.trim()).includes(POLLS_CAPABILITY));
}

export function reconcile_poll_creators(value: string | undefined): void {
	if (value === undefined)
		return;
	const identifiers = value.split(',').map(entry => entry.trim()).filter(Boolean);
	if (identifiers.some(identifier => !/^[0-9a-f-]{36}$/i.test(identifier)))
		throw new Error('POLL_CREATOR_CLIENT_IDENTIFIERS must be a comma-separated list of Client identifiers');
	allowed_creator_identifiers.clear();
	for (const identifier of identifiers)
		allowed_creator_identifiers.add(identifier);
}

export function can_view_polls(mod_version: string | null): boolean {
	return is_client_version_at_least(mod_version, POLLS_MINIMUM_CLIENT_VERSION);
}

export function can_create_poll(client_id: number): boolean {
	const identifier = db.query<{ client_identifier: string }, [number]>(
		'SELECT `client_identifier` FROM `clients` WHERE `id` = ? AND `deleted_at` IS NULL'
	).get(client_id)?.client_identifier;
	return identifier !== undefined && allowed_creator_identifiers.has(identifier);
}

function next_revision(): number {
	const revision = db.query<{ revision: number }, []>(
		"UPDATE `service_settings` SET `value` = CAST(`value` AS INTEGER) + 1 WHERE `key` = 'poll_revision' " +
		'RETURNING CAST(`value` AS INTEGER) AS `revision`'
	).get()?.revision;
	if (revision === undefined)
		throw new Error('Poll revision setting is missing');
	return revision;
}

function poll_view(client_id: number, poll_id: number) {
	const owner_key = get_poll_owner_key(client_id);
	const poll = db.query<{ id: number; creator_id: number; content: string; choice_mode: 'single' | 'multi';
		closed_at: number | null; created_at: number; revision: number;
		reaction_revision: number; display_name: string; icon_id: string }, [number]>(
		'SELECT poll.*, client.`display_name`, client.`icon_id` FROM `polls` AS poll ' +
		'JOIN `clients` AS client ON client.`id` = poll.`creator_id` WHERE poll.`id` = ?'
	).get(poll_id);
	if (!poll)
		return null;
	const interacted = db.query<{ interacted: number }, [number, string]>(
		' SELECT EXISTS(SELECT 1 FROM `poll_interactions` WHERE `poll_id` = ? AND `owner_key` = ?) AS `interacted`'
	).get(poll_id, owner_key)?.interacted === 1;
	const raw_options = db.query<{ option_id: number; content: string; position: number; vote_count: number; selected: number }, [string, number]>(
		'SELECT option.`id` AS `option_id`, option.`content`, option.`position`, COUNT(vote.`owner_key`) AS `vote_count`, ' +
		'MAX(vote.`owner_key` = ?) AS `selected` FROM `poll_options` AS option LEFT JOIN `poll_votes` AS vote ' +
		'ON vote.`option_id` = option.`id` WHERE option.`poll_id` = ? GROUP BY option.`id` ORDER BY option.`position`'
	).all(owner_key, poll_id);
	const options = attach_translations('poll-option', client_id, raw_options.map(option => ({
		...option, message_id: option.option_id, sender_id: poll.creator_id, selected: option.selected === 1
	})));
	const [translated_poll] = attach_translations('poll', client_id, [{
		poll_id: poll.id, message_id: poll.id, content: poll.content, sender_id: poll.creator_id,
		sender: { client_id: poll.creator_id, display_name: poll.display_name, icon_id: poll.icon_id },
		created_at: poll.created_at, revision: poll.revision, reaction_revision: poll.reaction_revision,
		choice_mode: poll.choice_mode, open: poll.closed_at === null, interacted, options,
		can_edit: can_create_poll(client_id),
		can_delete: can_create_poll(client_id),
		can_manage: can_create_poll(client_id)
	}]);
	return translated_poll!;
}

export function list_polls(client_id: number, mod_version: string | null, after_revision: number | null): PollResult<{
	polls: NonNullable<ReturnType<typeof poll_view>>[]; deleted_poll_ids: number[]; revision: number; can_create: boolean
}> {
	if (after_revision !== null && (!Number.isSafeInteger(after_revision) || after_revision < 0))
		return { status: 'bad_request' };
	if (!can_view_polls(mod_version))
		return { status: 'ok', value: { polls: [], deleted_poll_ids: [], revision: 0, can_create: false } };
	const rows = db.query<{ id: number; revision: number; reaction_revision: number }, number[]>(
		after_revision === null ? 'SELECT `id`, `revision`, `reaction_revision` FROM `polls` ORDER BY `id`' :
			'SELECT `id`, `revision`, `reaction_revision` FROM `polls` WHERE MAX(`revision`, `reaction_revision`) > ? ORDER BY `id`'
	).all(...(after_revision === null ? [] : [after_revision]));
	const deleted_poll_ids = after_revision === null ? [] : db.query<{ poll_id: number }, [number]>(
		'SELECT `poll_id` FROM `poll_deletions` WHERE `revision` > ? ORDER BY `revision`'
	).all(after_revision).map(row => row.poll_id);
	const revision = db.query<{ revision: number }, []>(
		"SELECT CAST(`value` AS INTEGER) AS `revision` FROM `service_settings` WHERE `key` = 'poll_revision'"
	).get()?.revision ?? 0;
	return { status: 'ok', value: {
		polls: rows.map(row => poll_view(client_id, row.id)).filter(value => value !== null), deleted_poll_ids,
		revision, can_create: can_create_poll(client_id)
	} };
}

function valid_options(options: unknown): options is string[] {
	return Array.isArray(options) && options.length >= 1 && options.length <= 20 &&
		options.every(option => typeof option === 'string' && option.trim().length >= 1 && option.trim().length <= 200);
}

export function create_poll(client_id: number, mod_version: string | null, idempotency_key: string, content: string, options: unknown,
	choice_mode: unknown = 'multi', now = Date.now()): PollResult<{ poll: NonNullable<ReturnType<typeof poll_view>> }> {
	const trimmed = content.trim();
	if (idempotency_key.length < 1 || idempotency_key.length > 128 || trimmed.length < 1 || trimmed.length > 1000 ||
		!valid_options(options) || (choice_mode !== 'single' && choice_mode !== 'multi'))
		return { status: 'bad_request' };
	if (!can_view_polls(mod_version) || !can_create_poll(client_id))
		return { status: 'forbidden' };
	const poll_id = db.transaction(() => {
		const existing = db.query<{ id: number }, [number, string]>(
			'SELECT `id` FROM `polls` WHERE `creator_id` = ? AND `idempotency_key` = ?'
		).get(client_id, idempotency_key)?.id;
		if (existing !== undefined)
			return existing;
		const revision = next_revision();
		const id = Number(db.query(
			'INSERT INTO `polls` (`creator_id`, `idempotency_key`, `content`, `choice_mode`, `created_at`, `revision`) VALUES (?, ?, ?, ?, ?, ?)'
		).run(client_id, idempotency_key, trimmed, choice_mode, now, revision).lastInsertRowid);
		for (const [position, option] of options.entries())
			db.query('INSERT INTO `poll_options` (`poll_id`, `position`, `content`, `created_at`) VALUES (?, ?, ?, ?)')
				.run(id, position, option.trim(), now);
		return id;
	}).immediate();
	return { status: 'ok', value: { poll: poll_view(client_id, poll_id)! } };
}

export function add_poll_options(client_id: number, mod_version: string | null, poll_id: number, options: unknown, now = Date.now()): PollResult<{ poll: NonNullable<ReturnType<typeof poll_view>> }> {
	if (!can_view_polls(mod_version))
		return { status: 'forbidden' };
	if (!Number.isSafeInteger(poll_id) || poll_id < 1 || !valid_options(options))
		return { status: 'bad_request' };
	const poll = db.query<{ creator_id: number; closed_at: number | null }, [number]>(
		'SELECT `creator_id`, `closed_at` FROM `polls` WHERE `id` = ?').get(poll_id);
	if (!poll)
		return { status: 'missing' };
	if (!can_create_poll(client_id) || poll.closed_at !== null)
		return { status: 'forbidden' };
	db.transaction(() => {
		let position = db.query<{ position: number }, [number]>(
			'SELECT COALESCE(MAX(`position`), -1) + 1 AS `position` FROM `poll_options` WHERE `poll_id` = ?'
		).get(poll_id)!.position;
		for (const option of options)
			db.query('INSERT INTO `poll_options` (`poll_id`, `position`, `content`, `created_at`) VALUES (?, ?, ?, ?)')
				.run(poll_id, position++, option.trim(), now);
		db.query('UPDATE `polls` SET `revision` = ? WHERE `id` = ?').run(next_revision(), poll_id);
	}).immediate();
	return { status: 'ok', value: { poll: poll_view(client_id, poll_id)! } };
}

export function delete_poll(client_id: number, mod_version: string | null, poll_id: number): PollResult<{ deleted: true; poll_id: number; revision: number }> {
	if (!can_view_polls(mod_version))
		return { status: 'forbidden' };
	if (!Number.isSafeInteger(poll_id) || poll_id < 1)
		return { status: 'bad_request' };
	const poll = db.query<{ creator_id: number }, [number]>(
		'SELECT `creator_id` FROM `polls` WHERE `id` = ?').get(poll_id);
	if (!poll)
		return { status: 'missing' };
	if (!can_create_poll(client_id))
		return { status: 'forbidden' };
	const revision = db.transaction(() => {
		const next = next_revision();
		db.query('INSERT INTO `poll_deletions` (`poll_id`, `revision`) VALUES (?, ?)').run(poll_id, next);
		db.query('DELETE FROM `polls` WHERE `id` = ?').run(poll_id);
		return next;
	}).immediate();
	return { status: 'ok', value: { deleted: true, poll_id, revision } };
}

export function set_poll_vote(client_id: number, mod_version: string | null, poll_id: number, option_id: number, selected: boolean,
	now = Date.now()): PollResult<{ poll: NonNullable<ReturnType<typeof poll_view>>; retry_after_ms: number }> {
	if (!can_view_polls(mod_version))
		return { status: 'forbidden' };
	if (![poll_id, option_id].every(value => Number.isSafeInteger(value) && value > 0) || typeof selected !== 'boolean')
		return { status: 'bad_request' };
	const option = db.query<{ id: number; choice_mode: 'single' | 'multi'; closed_at: number | null }, [number, number]>(
		'SELECT option.`id`, poll.`choice_mode`, poll.`closed_at` FROM `poll_options` AS option ' +
		'JOIN `polls` AS poll ON poll.`id` = option.`poll_id` WHERE option.`id` = ? AND option.`poll_id` = ?'
	).get(option_id, poll_id);
	if (!option)
		return { status: 'missing' };
	if (option.closed_at !== null)
		return { status: 'forbidden' };
	const owner_key = get_poll_owner_key(client_id);
	const latest = db.query<{ last_mutated_at: number }, [number, string]>(
		'SELECT `last_mutated_at` FROM `poll_vote_throttles` WHERE `poll_id` = ? AND `owner_key` = ?'
	).get(poll_id, owner_key)?.last_mutated_at;
	if (latest !== undefined && latest + POLL_VOTE_THROTTLE_MS > now)
		return { status: 'throttled', retry_after_ms: latest + POLL_VOTE_THROTTLE_MS - now };
	db.transaction(() => {
		if (selected)
			db.query('INSERT INTO `poll_interactions` (`poll_id`, `owner_key`, `interacted_at`) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
				.run(poll_id, owner_key, now);
		if (selected && option.choice_mode === 'single')
			db.query('DELETE FROM `poll_votes` WHERE `poll_id` = ? AND `owner_key` = ? AND `option_id` <> ?')
				.run(poll_id, owner_key, option_id);
		const changed = selected
			? db.query('INSERT INTO `poll_votes` (`poll_id`, `option_id`, `owner_key`, `client_id`, `created_at`) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
				.run(poll_id, option_id, owner_key, client_id, now).changes
			: db.query('DELETE FROM `poll_votes` WHERE `poll_id` = ? AND `option_id` = ? AND `owner_key` = ?')
				.run(poll_id, option_id, owner_key).changes;
		if (changed > 0)
			db.query('UPDATE `polls` SET `revision` = ? WHERE `id` = ?').run(next_revision(), poll_id);
		db.query('INSERT INTO `poll_vote_throttles` (`poll_id`, `owner_key`, `last_mutated_at`) VALUES (?, ?, ?) ' +
			'ON CONFLICT (`poll_id`, `owner_key`) DO UPDATE SET `last_mutated_at` = excluded.`last_mutated_at`')
			.run(poll_id, owner_key, now);
	}).immediate();
	return { status: 'ok', value: { poll: poll_view(client_id, poll_id)!, retry_after_ms: POLL_VOTE_THROTTLE_MS } };
}

export function set_poll_open(client_id: number, mod_version: string | null, poll_id: number, open: boolean, now = Date.now()): PollResult<{ poll: NonNullable<ReturnType<typeof poll_view>> }> {
	if (!can_view_polls(mod_version) || !can_create_poll(client_id))
		return { status: 'forbidden' };
	if (!Number.isSafeInteger(poll_id) || poll_id < 1 || typeof open !== 'boolean')
		return { status: 'bad_request' };
	const poll = db.query<{ closed_at: number | null }, [number]>('SELECT `closed_at` FROM `polls` WHERE `id` = ?').get(poll_id);
	if (!poll)
		return { status: 'missing' };
	if ((poll.closed_at === null) === open)
		return { status: 'ok', value: { poll: poll_view(client_id, poll_id)! } };
	db.query('UPDATE `polls` SET `closed_at` = ?, `revision` = ? WHERE `id` = ?')
		.run(open ? null : now, next_revision(), poll_id);
	return { status: 'ok', value: { poll: poll_view(client_id, poll_id)! } };
}

type DiscussionMessage = { id: number; poll_id: number; sender_id: number; content: string; created_at: number;
	reaction_revision: number; display_name: string; icon_id: string };

function discussion_message_view(message: DiscussionMessage) {
	return { conversation_id: message.poll_id, message_id: message.id, sender_id: message.sender_id,
		content: message.content, created_at: message.created_at, reaction_revision: message.reaction_revision,
		sender: { client_id: message.sender_id, display_name: message.display_name, icon_id: message.icon_id }, reactions: [] };
}

export function list_poll_discussion_messages(client_id: number, mod_version: string | null, poll_id: number, before: number | null,
	after: number | null): PollResult<{ messages: ReturnType<typeof discussion_message_view>[]; has_more: boolean }> {
	if (!can_view_polls(mod_version))
		return { status: 'forbidden' };
	if (!Number.isSafeInteger(poll_id) || poll_id < 1 || !poll_view(client_id, poll_id) ||
		(before !== null && (!Number.isSafeInteger(before) || before < 1)) ||
		(after !== null && (!Number.isSafeInteger(after) || after < 0)) || (before !== null && after !== null))
		return { status: 'bad_request' };
	const clause = before !== null ? ' AND message.`id` < ?' : after !== null ? ' AND message.`id` > ?' : '';
	const values = before !== null ? [poll_id, before] : after !== null ? [poll_id, after] : [poll_id];
	const rows = db.query<DiscussionMessage, number[]>(
		'SELECT message.*, sender.`display_name`, sender.`icon_id` FROM `poll_discussion_messages` AS message ' +
		'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` WHERE message.`poll_id` = ?' + clause +
		' ORDER BY message.`id` DESC LIMIT 21'
	).all(...values);
	const has_more = rows.length > 20;
	return { status: 'ok', value: { messages: rows.slice(0, 20).reverse().map(discussion_message_view), has_more } };
}

export function send_poll_discussion_message(client_id: number, mod_version: string | null, poll_id: number, idempotency_key: string,
	content: string, now = Date.now(), parts?: ChatPart[]): PollResult<{ message: ReturnType<typeof discussion_message_view> }> {
	if (!can_view_polls(mod_version))
		return { status: 'forbidden' };
	const trimmed = content.trim();
	if (!Number.isSafeInteger(poll_id) || poll_id < 1 || idempotency_key.length < 1 || idempotency_key.length > 128 ||
		trimmed.length < 1 || trimmed.length > 1000 || !poll_view(client_id, poll_id))
		return { status: 'bad_request' };
	const message_id = db.transaction(() => {
		const existing = db.query<{ id: number; poll_id: number; content: string }, [number, string]>(
			'SELECT `id`, `poll_id`, `content` FROM `poll_discussion_messages` WHERE `sender_id` = ? AND `idempotency_key` = ?'
		).get(client_id, idempotency_key);
		if (existing) return existing.poll_id === poll_id && existing.content === trimmed &&
			same_chat_parts('poll-discussion', existing.id, parts) ? existing.id : null;
		const created = Number(db.query(
			'INSERT INTO `poll_discussion_messages` (`poll_id`, `sender_id`, `idempotency_key`, `content`, `created_at`) VALUES (?, ?, ?, ?, ?)'
		).run(poll_id, client_id, idempotency_key, trimmed, now).lastInsertRowid);
		save_chat_parts('poll-discussion', created, parts);
		return created;
	}).immediate();
	if (message_id === null) return { status: 'bad_request' };
	const message = db.query<DiscussionMessage, [number]>(
		'SELECT message.*, sender.`display_name`, sender.`icon_id` FROM `poll_discussion_messages` AS message ' +
		'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` WHERE message.`id` = ?'
	).get(message_id)!;
	return { status: 'ok', value: { message: discussion_message_view(message) } };
}
