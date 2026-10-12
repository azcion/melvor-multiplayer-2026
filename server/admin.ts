import { rollback_policy, preview_rollback_policy, set_rollback_policy, set_rollback_hold, rollback_admission_revision, type RollbackPolicy } from './rollback-policy';
import { decide_rollback_incident } from './rollback-admission';
import { inspect_rollback_benefits, release_rollback_benefit } from './rollback-benefits';
import { inspect_save_rollback } from './save-rollback';
import { createHash } from 'node:crypto';
import { record_audit_event } from './audit';
import { EXPEDITION_TESTER_TAG, is_expedition_tester } from './account_tags';
import { revoke_installation } from './installations';
import { db, get_service_setting } from './db';
import { make_audit_context, run_with_audit_context } from './audit-context';
import { is_minimum_supported_version } from './client-version-policy';
import { preview_campaign_retirement, settle_campaign_retirement } from './campaign-retirement';
import { preview_raid_cutover, settle_raid_cutover } from './raid';
import { BACKEND_VERSION } from './version';
import {
	ICON_CATALOG_SETTING_KEYS,
	MAX_ICON_CATALOG_BYTES,
	MAX_ICON_CATALOG_ICON_BYTES,
	MAX_ICON_CATALOG_MANIFEST_COUNT,
	MAX_ICON_CATALOG_OBSERVATIONS
} from './icon-catalog';

type AdminOutput = {
	log: (message: string) => void;
	error: (message: string) => void;
};

const console_output: AdminOutput = {
	log: message => console.log(message),
	error: message => console.error(message)
};

const MAX_GUILD_DIAGNOSTIC_MEMBERS = 512;
const MAX_GUILD_DIAGNOSTIC_CONTRIBUTIONS = 512;
const MAX_GUILD_DIAGNOSTIC_ACTIVITY = 20;
const MAX_SUPPORT_MESSAGE_LENGTH = 1000;

function usage(output: AdminOutput): number {
	output.error(`Usage:
  bun run admin.ts save-rollback inspect|benefits CLIENT_ID
  bun run admin.ts save-rollback config
  bun run admin.ts save-rollback preview CONFIG_JSON
  bun run admin.ts save-rollback set|activate EXPECTED_REVISION CONFIG_JSON COMMAND_UUID REASON
  bun run admin.ts save-rollback confirm|dismiss INCIDENT_ID EXPECTED_DECISION_ID COMMAND_UUID REASON
  bun run admin.ts save-rollback reviewhold CLIENT_ID EXPECTED_HOLD_ID COMMAND_UUID REASON
  bun run admin.ts save-rollback release CLIENT_ID EXPECTED_HOLD_ID EXPECTED_ADMISSION_ID COMMAND_UUID REASON
  bun run admin.ts save-rollback benefit-release ROOT_KEY EXPECTED_QUANTITY COMMAND_UUID REASON
  bun run admin.ts status
  bun run admin.ts registrations open|close
  bun run admin.ts maintenance on|off
  bun run admin.ts alliance-preview on|off
  bun run admin.ts icon-collection on|off
  bun run admin.ts icon-collection-limit icon-bytes|manifest-items|catalog-bytes|observations VALUE
  bun run admin.ts release-version VERSION|clear
  bun run admin.ts minimum-supported-version VERSION|clear
  bun run admin.ts updates get SECTION_ID title|body
  bun run admin.ts updates set SECTION_ID title|body < CONTENT
  bun run admin.ts installation revoke CLIENT_ID INSTALLATION_ID
  bun run admin.ts alliance inspect ALLIANCE_ID
  bun run admin.ts alliance-process inspect PROCESS_ID
  bun run admin.ts guild inspect GUILD_ID
  bun run admin.ts identity find DISPLAY_NAME
  bun run admin.ts identity inspect CLIENT_ID
  bun run admin.ts identity enable|disable CLIENT_ID
  bun run admin.ts support-message inspect MESSAGE_ID
  bun run admin.ts support-message correct MESSAGE_ID EXPECTED_SHA256 confirm < REPLACEMENT_TEXT
  bun run admin.ts social-mode enforce|clear identity|account ID
  bun run admin.ts chat-shadowban enforce|clear CLIENT_ID
  bun run admin.ts chat-shadow-observer grant|revoke CLIENT_ID
  bun run admin.ts feature-tester grant|revoke pending|council CLIENT_ID
  bun run admin.ts tester-tag grant|revoke CLIENT_ID
  bun run admin.ts global-chat-message hide|restore MESSAGE_ID
  bun run admin.ts global-chat-throttle server clear|MAX_MESSAGES WINDOW_SECONDS
  bun run admin.ts global-chat-throttle client CLIENT_ID clear|MAX_MESSAGES WINDOW_SECONDS
  bun run admin.ts campaign drain confirm
  bun run admin.ts campaign preview CUTOVER_MS
  bun run admin.ts campaign settle CUTOVER_MS confirm
  bun run admin.ts raid preview CUTOVER_MS
  bun run admin.ts raid cutover CUTOVER_MS confirm`);
	return 2;
}

function parse_positive_integer(value: string | undefined): number | null {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

type UpdateSectionField = 'title' | 'body';

type UpdateSection = {
	id: string;
	title: string;
	body: string;
};

function parse_update_section_field(value: string | undefined): UpdateSectionField | null {
	return value === 'title' || value === 'body' ? value : null;
}

function get_update_section(section_id: string, field: UpdateSectionField, output: AdminOutput): number {
	const section = db.query<UpdateSection, [string]>(
		'SELECT `id`, `title`, `body` FROM `update_sections` WHERE `id` = ? LIMIT 1'
	).get(section_id);
	if (section === null) {
		output.error(`Update section ${section_id} does not exist.`);
		return 1;
	}
	output.log(JSON.stringify({ section_id: section.id, field, value: section[field] }));
	return 0;
}

export function set_update_section(args: string[], input: string, output: AdminOutput = console_output): number {
	if (args.length !== 4 || args[0] !== 'updates' || args[1] !== 'set')
		return usage(output);
	const section_id = args[2];
	const field = parse_update_section_field(args[3]);
	if (section_id === undefined || !/^[A-Za-z0-9_-]{1,64}$/.test(section_id) || field === null)
		return usage(output);
	let content = input;
	if (content.endsWith('\r\n')) content = content.slice(0, -2);
	else if (content.endsWith('\n')) content = content.slice(0, -1);
	const max_length = field === 'title' ? 128 : 8192;
	const content_length = [...content].length;
	if (content_length < 1 || content_length > max_length || content.trim().length < 1 || content.includes('\0')) {
		output.error(`Update section ${field} must contain 1-${max_length} characters and at least one non-whitespace character.`);
		return 1;
	}

	const result = db.transaction(() => {
		const section = db.query<{ id: string }, [string]>(
			'SELECT `id` FROM `update_sections` WHERE `id` = ? LIMIT 1'
		).get(section_id);
		if (section === null)
			return 'missing' as const;
		db.query(`UPDATE \`update_sections\` SET \`${field}\` = ? WHERE \`id\` = ?`).run(content, section_id);
		return 'updated' as const;
	}).immediate();

	if (result === 'missing') {
		output.error(`Update section ${section_id} does not exist.`);
		return 1;
	}
	output.log(`Update section ${section_id} ${field} updated.`);
	return 0;
}

function run_updates_command(args: string[], output: AdminOutput): number {
	if (args.length === 4 && args[1] === 'get') {
		const field = parse_update_section_field(args[3]);
		return args[2] === undefined || !/^[A-Za-z0-9_-]{1,64}$/.test(args[2]) || field === null
			? usage(output)
			: get_update_section(args[2], field, output);
	}
	return usage(output);
}

type OperatorSupportMessage = {
	id: number;
	conversation_id: number;
	team_id: number;
	player_client_id: number;
	author_kind: 'automated' | 'player' | 'member';
	sending_client_id: number | null;
	content: string;
	moderated: number;
	read_by_player: number;
};

function support_message_digest(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}

function operator_support_message(message_id: number): OperatorSupportMessage | null {
	return db.query<OperatorSupportMessage, [number]>(
		'SELECT message.`id`, message.`conversation_id`, conversation.`team_id`, conversation.`player_client_id`, ' +
		'message.`author_kind`, message.`sending_client_id`, message.`content`, ' +
		'EXISTS(SELECT 1 FROM `support_message_moderation` AS moderation ' +
			'WHERE moderation.`message_id` = message.`id`) AS `moderated`, ' +
		'EXISTS(SELECT 1 FROM `support_player_message_reads` AS message_read ' +
			'WHERE message_read.`message_id` = message.`id` ' +
			'AND message_read.`client_id` = conversation.`player_client_id`) AS `read_by_player` ' +
		'FROM `support_messages` AS message ' +
		'JOIN `support_conversations` AS conversation ON conversation.`id` = message.`conversation_id` ' +
		'WHERE message.`id` = ?'
	).get(message_id);
}

function inspect_support_message(message_id: number, output: AdminOutput): number {
	const message = operator_support_message(message_id);
	if (message === null) {
		output.error(`Support Message ${message_id} does not exist.`);
		return 1;
	}
	output.log(`message_id=${message.id}`);
	output.log(`conversation_id=${message.conversation_id}`);
	output.log(`player_client_id=${message.player_client_id}`);
	output.log(`author_kind=${message.author_kind}`);
	output.log(`moderated=${message.moderated === 1 ? 'yes' : 'no'}`);
	output.log(`read_by_player=${message.read_by_player === 1 ? 'yes' : 'no'}`);
	output.log(`content_length=${[...message.content].length}`);
	output.log(`content_sha256=${support_message_digest(message.content)}`);
	return 0;
}

export function correct_support_message(message_id: number, expected_digest: string, replacement_input: string,
	output: AdminOutput = console_output): number {
	let replacement = replacement_input;
	if (replacement.endsWith('\r\n')) replacement = replacement.slice(0, -2);
	else if (replacement.endsWith('\n')) replacement = replacement.slice(0, -1);
	const replacement_length = [...replacement].length;
	if (replacement_length < 1 || replacement_length > MAX_SUPPORT_MESSAGE_LENGTH || replacement.includes('\0')) {
		output.error(`Replacement Support Message must contain 1-${MAX_SUPPORT_MESSAGE_LENGTH} characters.`);
		return 1;
	}

	const result = db.transaction(() => {
		const message = operator_support_message(message_id);
		if (message === null) return { status: 'missing' as const };
		if (message.author_kind !== 'member' || message.sending_client_id === null)
			return { status: 'wrong_author' as const };
		if (message.moderated === 1) return { status: 'moderated' as const };
		if (message.read_by_player === 1) return { status: 'read' as const };
		if (support_message_digest(message.content) !== expected_digest)
			return { status: 'changed' as const };
		if (message.content === replacement) return { status: 'unchanged' as const };

		const updated = db.query(
			'UPDATE `support_messages` SET `content` = ? WHERE `id` = ? AND `content` = ? ' +
			'AND `author_kind` = \'member\' ' +
			'AND NOT EXISTS(SELECT 1 FROM `support_message_moderation` AS moderation ' +
				'WHERE moderation.`message_id` = `support_messages`.`id`) ' +
			'AND NOT EXISTS(SELECT 1 FROM `support_player_message_reads` AS message_read ' +
				'JOIN `support_conversations` AS conversation ' +
					'ON conversation.`id` = `support_messages`.`conversation_id` ' +
				'WHERE message_read.`message_id` = `support_messages`.`id` ' +
				'AND message_read.`client_id` = conversation.`player_client_id`)'
		).run(replacement, message_id, message.content);
		if (updated.changes !== 1) return { status: 'changed' as const };

		db.query(
			'UPDATE `clients` SET `event_revision` = `event_revision` + 1 ' +
			'WHERE `id` = ? OR `id` IN (SELECT `client_id` FROM `support_team_memberships` ' +
				'WHERE `team_id` = ? AND `active` = 1 AND `client_id` IS NOT NULL)'
		).run(message.player_client_id, message.team_id);
		record_audit_event({
			event_type: 'support.message.corrected',
			source_key: `operator:support-message-correction:${message_id}:${crypto.randomUUID()}`,
			actor: { kind: 'operator', name: 'admin-cli' },
			participants: [
				{ role: 'player', client_id: message.player_client_id },
				{ role: 'support-member', client_id: message.sending_client_id }
			],
			details: { message_id, conversation_id: message.conversation_id, team_id: message.team_id }
		});
		return { status: 'corrected' as const };
	}).immediate();

	switch (result.status) {
		case 'missing': output.error(`Support Message ${message_id} does not exist.`); return 1;
		case 'wrong_author': output.error('Only member-authored Support Messages can be corrected.'); return 1;
		case 'moderated': output.error(`Support Message ${message_id} is moderated and cannot be corrected.`); return 1;
		case 'read': output.error(`Support Message ${message_id} has already been read by the player.`); return 1;
		case 'changed': output.error(`Support Message ${message_id} no longer matches the expected SHA-256.`); return 1;
		case 'unchanged': output.log(`Support Message ${message_id} already has the replacement content.`); return 0;
		case 'corrected': output.log(`Support Message ${message_id} corrected.`); return 0;
	}
}

function set_social_mode_enforcement(args: string[], output: AdminOutput): number {
	const [, action, scope, raw_id] = args;
	const id = parse_positive_integer(raw_id);
	if (args.length !== 4 || !['enforce', 'clear'].includes(action ?? '') ||
		!['identity', 'account'].includes(scope ?? '') || id === null)
		return usage(output);
	const table = scope === 'identity' ? 'clients' : 'melvor_accounts';
	const affected = db.transaction(() => {
		const updated = db.query(`UPDATE \`${table}\` SET \`social_mode_enforced\` = ? WHERE \`id\` = ?`)
			.run(action === 'enforce' ? 1 : 0, id);
		if (updated.changes !== 1) return 0;
		if (scope === 'identity')
			db.query('UPDATE `clients` SET `event_revision` = `event_revision` + 1 WHERE `id` = ?').run(id);
		else
			db.query('UPDATE `clients` SET `event_revision` = `event_revision` + 1 WHERE `melvor_account_id` = ?').run(id);
		return scope === 'identity' ? 1 : (db.query<{ count: number }, [number]>(
			'SELECT COUNT(*) AS `count` FROM `clients` WHERE `melvor_account_id` = ?'
		).get(id)?.count ?? 0);
	}).immediate();
	if (affected === 0 && db.query(`SELECT 1 FROM \`${table}\` WHERE \`id\` = ?`).get(id) === null) {
		output.error(`${scope === 'identity' ? 'Multiplayer identity' : 'Melvor account'} ${id} does not exist.`);
		return 1;
	}
	output.log(`Social Only enforcement ${action === 'enforce' ? 'enabled' : 'cleared'} for ${scope} ${id}.`);
	output.log(`affected_identities=${affected}`);
	return 0;
}

function set_chat_shadowban(args: string[], output: AdminOutput): number {
	const [, action, raw_client_id] = args;
	const client_id = parse_positive_integer(raw_client_id);
	if (args.length !== 3 || !['enforce', 'clear'].includes(action ?? '') || client_id === null)
		return usage(output);
	const result = db.transaction(() => {
		const client = db.query<{ account_id: number | null }, [number]>(
			'SELECT `melvor_account_id` AS `account_id` FROM `clients` WHERE `id` = ? LIMIT 1'
		).get(client_id);
		if (client === null) return { status: 'missing' as const };
		if (client.account_id === null) return { status: 'unlinked' as const };
		db.query('UPDATE `melvor_accounts` SET `chat_shadowbanned` = ? WHERE `id` = ?')
			.run(action === 'enforce' ? 1 : 0, client.account_id);
		db.query('UPDATE `clients` SET `event_revision` = `event_revision` + 1 WHERE `melvor_account_id` = ?')
			.run(client.account_id);
		const identities = db.query<{ count: number }, [number]>(
			'SELECT COUNT(*) AS `count` FROM `clients` WHERE `melvor_account_id` = ?'
		).get(client.account_id)?.count ?? 0;
		return { status: 'ok' as const, account_id: client.account_id, identities };
	}).immediate();
	if (result.status === 'missing') {
		output.error(`Multiplayer identity ${client_id} does not exist.`);
		return 1;
	}
	if (result.status === 'unlinked') {
		output.error(`Multiplayer identity ${client_id} is not linked to a Melvor account.`);
		return 1;
	}
	output.log(`Chat shadowban ${action === 'enforce' ? 'enabled' : 'cleared'} for account ${result.account_id}.`);
	output.log(`affected_identities=${result.identities}`);
	return 0;
}

function set_chat_shadow_observer(args: string[], output: AdminOutput): number {
	const [, action, raw_client_id] = args;
	const client_id = parse_positive_integer(raw_client_id);
	if (args.length !== 3 || !['grant', 'revoke'].includes(action ?? '') || client_id === null)
		return usage(output);
	const result = db.transaction(() => {
		const client = db.query<{ account_id: number | null }, [number]>(
			'SELECT `melvor_account_id` AS `account_id` FROM `clients` WHERE `id` = ? LIMIT 1'
		).get(client_id);
		if (client === null) return { status: 'missing' as const };
		if (client.account_id === null) return { status: 'unlinked' as const };
		const changed = action === 'grant'
			? db.query(
				'INSERT INTO `chat_shadow_observers` (`observer_account_id`, `granted_at`) VALUES(?, ?) ' +
				'ON CONFLICT DO NOTHING'
			).run(client.account_id, Date.now()).changes
			: db.query('DELETE FROM `chat_shadow_observers` WHERE `observer_account_id` = ?')
				.run(client.account_id).changes;
		db.query('UPDATE `clients` SET `event_revision` = `event_revision` + 1 WHERE `melvor_account_id` = ?')
			.run(client.account_id);
		const identities = db.query<{ count: number }, [number]>(
			'SELECT COUNT(*) AS `count` FROM `clients` WHERE `melvor_account_id` = ?'
		).get(client.account_id)?.count ?? 0;
		return { status: 'ok' as const, account_id: client.account_id, identities, changed };
	}).immediate();
	if (result.status === 'missing') {
		output.error(`Multiplayer identity ${client_id} does not exist.`);
		return 1;
	}
	if (result.status === 'unlinked') {
		output.error(`Multiplayer identity ${client_id} is not linked to a Melvor account.`);
		return 1;
	}
	output.log(`Chat shadow observer access ${action === 'grant' ? 'granted to' : 'revoked from'} account ${result.account_id}.`);
	output.log(`affected_identities=${result.identities}`);
	output.log(`observer_${action === 'grant' ? 'added' : 'removed'}=${result.changed === 1 ? 'yes' : 'already_' + (action === 'grant' ? 'granted' : 'revoked')}`);
	return 0;
}

function set_global_chat_message_moderation(args: string[], output: AdminOutput): number {
	const action = args[1];
	const message_id = parse_positive_integer(args[2]);
	if (args.length !== 3 || !['hide', 'restore'].includes(action ?? '') || message_id === null)
		return usage(output);
	const result = db.transaction(() => {
		const message = db.query<{ sender_id: number; account_id: number | null; shadow_hidden: number }, [number]>(
			'SELECT message.`sender_id`, sender.`melvor_account_id` AS `account_id`, ' +
			'message.`shadow_hidden` ' +
			'FROM `global_chat_messages` AS message JOIN `clients` AS sender ON sender.`id` = message.`sender_id` ' +
			"WHERE message.`id` = ? AND message.`channel` = 'global' LIMIT 1"
		).get(message_id);
		if (message === null) return { status: 'missing' as const };
		if (action === 'restore' && (message.account_id === null || message.shadow_hidden !== 1))
			return { status: 'not_shadow_hidden' as const };
		const changed = action === 'hide'
			? db.query('INSERT INTO `global_chat_message_moderation` (`message_id`, `deleted_at`) VALUES(?, ?) ON CONFLICT DO NOTHING')
				.run(message_id, Date.now()).changes
			: db.query('DELETE FROM `global_chat_message_moderation` WHERE `message_id` = ?').run(message_id).changes;
		if (action === 'hide')
			db.query('UPDATE `clients` SET `event_revision` = `event_revision` + 1 WHERE `global_chat_enabled` = 1').run();
		else
			db.query('UPDATE `clients` SET `event_revision` = `event_revision` + 1 WHERE `melvor_account_id` = ?')
				.run(message.account_id);
		return { status: 'ok' as const, sender_id: message.sender_id, account_id: message.account_id, changed };
	}).immediate();
	if (result.status === 'missing') {
		output.error(`Global Message ${message_id} does not exist.`);
		return 1;
	}
	if (result.status === 'not_shadow_hidden') {
		output.error(`Global Message ${message_id} cannot be restored unless it was sent during a Chat shadowban.`);
		return 1;
	}
	output.log(`Global Message ${message_id} is ${action === 'hide' ? 'hidden for everyone' : 'sender-account-only'}.`);
	output.log(`sender_id=${result.sender_id}`);
	output.log(`account_id=${result.account_id}`);
	output.log(`moderation_${action === 'hide' ? 'added' : 'removed'}=${result.changed === 1 ? 'yes' : action === 'hide' ? 'already_hidden' : 'already_restored'}`);
	return 0;
}

function parse_icon_collection_limit(kind: string | undefined, value: string | undefined): {
	key: string;
	value: number;
} | null {
	const maximums: Record<string, { key: string; maximum: number }> = {
		'icon-bytes': { key: ICON_CATALOG_SETTING_KEYS.max_icon_bytes, maximum: MAX_ICON_CATALOG_ICON_BYTES },
		'manifest-items': { key: ICON_CATALOG_SETTING_KEYS.max_manifest_items, maximum: MAX_ICON_CATALOG_MANIFEST_COUNT },
		'catalog-bytes': { key: ICON_CATALOG_SETTING_KEYS.max_catalog_bytes, maximum: MAX_ICON_CATALOG_BYTES },
		observations: { key: ICON_CATALOG_SETTING_KEYS.max_observations, maximum: MAX_ICON_CATALOG_OBSERVATIONS }
	};
	const definition = maximums[kind ?? ''];
	const parsed = Number(value);
	if (definition === undefined || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > definition.maximum)
		return null;
	return { key: definition.key, value: parsed };
}

function set_setting(key: string, value: string): void {
	db.query('UPDATE `service_settings` SET `value` = ? WHERE `key` = ?').run(value, key);
}

function is_release_version(value: string | undefined): value is string {
	return typeof value === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(value) && value.length <= 64;
}

function parse_stored_json(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function inspect_guild(guild_id: number, output: AdminOutput): number {
	const guild = db.query<{
		id: number;
		name: string;
		icon_id: string;
		type: string;
	}, [number]>(
		'SELECT `id`, `name`, `icon_id`, `type` FROM `guilds` WHERE `id` = ? LIMIT 1'
	).get(guild_id);
	if (guild === null) {
		output.error(`Guild ${guild_id} does not exist.`);
		return 1;
	}

	const members = db.query<{
		membership_id: number;
		client_id: number;
		display_name: string;
		disabled: number;
		deleted_at: number | null;
		last_multiplayer_active_at: number;
		mod_version: string | null;
		active_mods: string | null;
		game_mode_id: string | null;
		language: string | null;
		reported_at: number | null;
	}, [number, number]>(
		'SELECT m.`id` AS `membership_id`, c.`id` AS `client_id`, c.`display_name`, c.`disabled`, c.`deleted_at`, ' +
		'c.`last_multiplayer_active_at`, runtime.`mod_version`, runtime.`active_mods`, runtime.`game_mode_id`, ' +
		'runtime.`language`, runtime.`reported_at` FROM `guild_memberships` AS m ' +
		'JOIN `clients` AS c ON c.`id` = m.`client_id` ' +
		'LEFT JOIN `client_runtime_snapshots` AS runtime ON runtime.`client_id` = c.`id` ' +
		'WHERE m.`guild_id` = ? ORDER BY m.`id` LIMIT ?'
	).all(guild_id, MAX_GUILD_DIAGNOSTIC_MEMBERS).map(member => ({
		membership_id: member.membership_id,
		client_id: member.client_id,
		display_name: member.display_name,
		disabled: member.disabled === 1,
		deleted: member.deleted_at !== null,
		last_multiplayer_active_at: member.last_multiplayer_active_at,
		runtime: member.mod_version === null ? null : {
			mod_version: member.mod_version,
			active_mods: member.active_mods === null ? null : parse_stored_json(member.active_mods),
			game_mode_id: member.game_mode_id,
			language: member.language,
			reported_at: member.reported_at
		}
	}));

	const campaign = db.query<{
		id: number;
		campaign_id: string;
		item_id: string;
		item_amount: number;
		item_current: number;
		required_contributors: number;
		auto_contribution: number;
		campaign_next: number;
		complete: number;
	}, [number]>(
		'SELECT `id`, `campaign_id`, `item_id`, `item_amount`, `item_current`, `required_contributors`, ' +
		'`auto_contribution`, `campaign_next`, `complete` FROM `campaign_state` ' +
		'WHERE `guild_id` = ? ORDER BY `id` DESC LIMIT 1'
	).get(guild_id);
	const contributions = campaign === null ? [] : db.query<{
		client_id: number;
		display_name: string;
		item_amount: number;
		taken: number;
	}, [number, number]>(
		'SELECT contribution.`client_id`, client.`display_name`, contribution.`item_amount`, contribution.`taken` ' +
		'FROM `campaign_contributions` AS contribution JOIN `clients` AS client ON client.`id` = contribution.`client_id` ' +
		'WHERE contribution.`campaign_id` = ? ORDER BY contribution.`client_id` LIMIT ?'
	).all(campaign.id, MAX_GUILD_DIAGNOSTIC_CONTRIBUTIONS);

	const activity = db.query<{
		id: number;
		event_type: string;
		actor_client_id: number | null;
		actor_display_name: string | null;
		metadata: string;
		created_at: number;
		buyer_client_id: number | null;
		buyer_display_name: string | null;
		seller_client_id: number | null;
		seller_display_name: string | null;
		item_id: string | null;
		quantity: number | null;
	}, [number, number]>(
		'SELECT `id`, `event_type`, `actor_client_id`, `actor_display_name`, `metadata`, `created_at`, ' +
		'`buyer_client_id`, `buyer_display_name`, `seller_client_id`, `seller_display_name`, `item_id`, `quantity` ' +
		'FROM `guild_activity_events` WHERE `guild_id` = ? ORDER BY `created_at` DESC, `id` DESC LIMIT ?'
	).all(guild_id, MAX_GUILD_DIAGNOSTIC_ACTIVITY).map(event => ({
		id: event.id,
		event_type: event.event_type,
		actor_client_id: event.actor_client_id,
		actor_display_name: event.actor_display_name,
		metadata: parse_stored_json(event.metadata),
		created_at: event.created_at,
		buyer_client_id: event.buyer_client_id,
		buyer_display_name: event.buyer_display_name,
		seller_client_id: event.seller_client_id,
		seller_display_name: event.seller_display_name,
		item_id: event.item_id,
		quantity: event.quantity
	}));

	output.log(`guild_id=${guild.id}`);
	output.log(`name=${JSON.stringify(guild.name)}`);
	output.log(`type=${guild.type}`);
	output.log(`icon_id=${JSON.stringify(guild.icon_id)}`);
	output.log(`members=${JSON.stringify(members)}`);
	output.log(`latest_campaign=${campaign === null ? 'none' : JSON.stringify(campaign)}`);
	output.log(`campaign_contributions=${JSON.stringify(contributions)}`);
	output.log(`recent_activity=${JSON.stringify(activity)}`);
	return 0;
}

function find_identities(display_name: string, output: AdminOutput): number {
	const identities = db.query<{
		id: number;
		display_name: string;
		guild_id: number | null;
		guild_name: string | null;
	}, [string]>(
		'SELECT c.`id`, c.`display_name`, m.`guild_id`, g.`name` AS `guild_name` ' +
		'FROM `clients` AS c ' +
		'LEFT JOIN `guild_memberships` AS m ON m.`client_id` = c.`id` ' +
		'LEFT JOIN `guilds` AS g ON g.`id` = m.`guild_id` ' +
		'WHERE c.`display_name` = ? ORDER BY c.`id` LIMIT 32'
	).all(display_name);
	output.log(`identities=${JSON.stringify(identities.map(identity => ({
		id: identity.id,
		display_name: identity.display_name,
		guild_id: identity.guild_id,
		guild_name: identity.guild_name
	})))}`);
	return 0;
}

function set_global_chat_throttle(args: string[], output: AdminOutput): number {
	const scope = args[1];
	const client_id = scope === 'client' ? parse_positive_integer(args[2]) : null;
	const value_offset = scope === 'client' ? 3 : 2;
	if ((scope !== 'server' && scope !== 'client') || (scope === 'client' && client_id === null))
		return usage(output);
	const clear = args[value_offset] === 'clear';
	const max_messages = parse_positive_integer(args[value_offset]);
	const window_seconds = parse_positive_integer(args[value_offset + 1]);
	if ((clear && args.length !== value_offset + 1) ||
		(!clear && (args.length !== value_offset + 2 || max_messages === null || max_messages > 1000 ||
			window_seconds === null || window_seconds > 86400)))
		return usage(output);
	if (scope === 'server') {
		if (clear)
			db.query('DELETE FROM `global_chat_server_throttle` WHERE `id` = 1').run();
		else
			db.query(
				'INSERT INTO `global_chat_server_throttle` (`id`, `max_messages`, `window_seconds`) VALUES(1, ?, ?) ' +
				'ON CONFLICT (`id`) DO UPDATE SET `max_messages` = excluded.`max_messages`, ' +
				'`window_seconds` = excluded.`window_seconds`'
			).run(max_messages as number, window_seconds as number);
	} else {
		if (db.query<{ found: number }, [number]>('SELECT 1 AS `found` FROM `clients` WHERE `id` = ?')
			.get(client_id as number) === null) {
			output.error(`Multiplayer identity ${client_id} does not exist.`);
			return 1;
		}
		if (clear)
			db.query('DELETE FROM `global_chat_client_throttles` WHERE `client_id` = ?').run(client_id as number);
		else
			db.query(
				'INSERT INTO `global_chat_client_throttles` (`client_id`, `max_messages`, `window_seconds`) VALUES(?, ?, ?) ' +
				'ON CONFLICT (`client_id`) DO UPDATE SET `max_messages` = excluded.`max_messages`, ' +
				'`window_seconds` = excluded.`window_seconds`'
			).run(client_id as number, max_messages as number, window_seconds as number);
	}
	output.log(clear ? `Global Chat ${scope} throttle cleared.` :
		`Global Chat ${scope} throttle set to ${max_messages} messages per ${window_seconds} seconds.`);
	return 0;
}

function run_admin_command(args: string[], output: AdminOutput = console_output): number {
	const [command, action, argument] = args;

	switch (command) {
		case 'save-rollback': {
			try {
				let result:unknown;
				if(action==='config' && args.length===2) result=rollback_policy(db);
				else if(action==='preview' && args.length===3) result=preview_rollback_policy(db,JSON.parse(argument!) as RollbackPolicy);
				else if((action==='set'||action==='activate') && args.length===6) {
					const expected=Number(args[2]);
					if(!Number.isSafeInteger(expected)||expected<0) return usage(output);
					result=set_rollback_policy(db,args[4]!,expected,JSON.parse(args[3]!) as RollbackPolicy,args[5]!,action==='activate');
				} else if((action==='confirm'||action==='dismiss')&&args.length===6) {
					result=decide_rollback_incident(db,args[4]!,Number(args[2]),Number(args[3]),action==='confirm'?'confirmed':'dismissed',args[5]!);
				} else if(action==='reviewhold'&&args.length===6) {
					result=set_rollback_hold(db,args[4]!,Number(args[2]),Number(args[3]),action==='reviewhold',args[5]!);
				} else if(action==='release'&&args.length===7) {
					result=set_rollback_hold(db,args[5]!,Number(args[2]),Number(args[3]),false,args[6]!,Number(args[4]));
				} else if(action==='benefit-release'&&args.length===6) {
					result=release_rollback_benefit(db,args[4]!,args[2]!,Number(args[3]),args[5]!);
				} else if((action==='inspect'||action==='benefits')&&args.length===3) {
					const client=parse_positive_integer(argument);if(client===null) return usage(output);
					result=action==='inspect'?{...inspect_save_rollback(db,client),policy:rollback_policy(db),admission_revision:rollback_admission_revision(db,client),
						holds:db.query('SELECT * FROM economy_client_holds WHERE client_id=? ORDER BY id DESC LIMIT 100').all(client),
						admissions:db.query('SELECT a.* FROM economy_admissions a JOIN economy_load_observations l ON l.id=a.save_load_id WHERE l.client_id=? ORDER BY a.id DESC LIMIT 100').all(client),
						notices:db.query('SELECT n.*,a.acknowledged_at FROM economy_player_notices n LEFT JOIN economy_notice_acknowledgements a ON a.notice_id=n.notice_id WHERE n.client_id=? ORDER BY n.created_at DESC LIMIT 100').all(client)}:inspect_rollback_benefits(db,client);
				} else return usage(output);
				output.log(JSON.stringify(result,null,2));return 0;
			} catch(error) {output.error(error instanceof Error?error.message:'Invalid rollback command');return 2;}
		}
		case 'raid': {
			const cutover_at = parse_positive_integer(argument);
			if (cutover_at === null || (action === 'preview' && args.length !== 3) ||
				(action === 'cutover' && (args.length !== 4 || args[3] !== 'confirm')) ||
				(action !== 'preview' && action !== 'cutover')) return usage(output);
			try {
				output.log(JSON.stringify(action === 'preview'
					? preview_raid_cutover(cutover_at) : settle_raid_cutover(cutover_at)));
				return 0;
			} catch (error) {
				output.error(error instanceof Error ? error.message : 'Raid cutover failed');
				return 1;
			}
		}
		case 'campaign': {
			if (action === 'drain' && argument === 'confirm' && args.length === 3) {
				if (get_service_setting('campaign_retirement_phase') === 'retired') {
					output.error('Campaign retirement has already settled.');
					return 1;
				}
				set_setting('campaign_retirement_phase', 'draining');
				output.log('Campaigns are draining; active Campaigns continue, and no new Campaign can start.');
				return 0;
			}
			const cutover_at = parse_positive_integer(argument);
			if (cutover_at === null || (action === 'preview' && args.length !== 3) ||
				(action === 'settle' && (args.length !== 4 || args[3] !== 'confirm')) ||
				(action !== 'preview' && action !== 'settle'))
				return usage(output);
			if (action === 'settle' && BACKEND_VERSION <= 217) {
				output.error('Campaign retirement requires a backend version after preparation version 217.');
				return 1;
			}
			try {
				output.log(JSON.stringify(action === 'preview'
					? preview_campaign_retirement(cutover_at) : settle_campaign_retirement(cutover_at)));
				return 0;
			} catch (error) {
				output.error(error instanceof Error ? error.message : 'Campaign retirement failed');
				return 1;
			}
		}
		case 'updates':
			return run_updates_command(args, output);
		case 'social-mode':
			return set_social_mode_enforcement(args, output);
		case 'chat-shadowban':
			return set_chat_shadowban(args, output);
		case 'chat-shadow-observer':
			return set_chat_shadow_observer(args, output);
		case 'feature-tester': {
			const client_id = parse_positive_integer(args[3]);
			if (args.length !== 4 || (action !== 'grant' && action !== 'revoke') || !['pending', 'council'].includes(argument) || client_id === null)
				return usage(output);
			if (!db.query('SELECT 1 FROM clients WHERE id=? AND deleted_at IS NULL').get(client_id)) {
				output.error(`Identity ${client_id} does not exist or is deleted.`);
				return 1;
			}
			if (action === 'grant') db.query('INSERT OR IGNORE INTO character_feature_testers(client_id,feature) VALUES (?,?)').run(client_id, argument);
			else db.query('DELETE FROM character_feature_testers WHERE client_id=? AND feature=?').run(client_id, argument);
			output.log(JSON.stringify({ client_id, feature: argument, granted: action === 'grant' }));
			return 0;
		}
		case 'tester-tag': {
			const client_id = parse_positive_integer(argument);
			if (args.length !== 3 || (action !== 'grant' && action !== 'revoke') || client_id === null)
				return usage(output);
			const account = db.query<{ account_id: number; cloud_username: string }, [number]>(
				'SELECT account.id AS account_id, account.cloud_username FROM clients AS client ' +
				'JOIN melvor_accounts AS account ON account.id = client.melvor_account_id WHERE client.id = ?'
			).get(client_id);
			if (account === null) {
				output.error(`Identity ${client_id} has no linked Melvor account.`);
				return 1;
			}
			if (action === 'grant') {
				db.query('INSERT INTO melvor_account_tags (account_id, tag, granted_at) VALUES (?, ?, ?) ' +
					'ON CONFLICT (account_id, tag) DO NOTHING').run(account.account_id, EXPEDITION_TESTER_TAG, Date.now());
			} else {
				db.query('DELETE FROM melvor_account_tags WHERE account_id = ? AND tag = ?')
					.run(account.account_id, EXPEDITION_TESTER_TAG);
			}
			output.log(JSON.stringify({ account_id: account.account_id, account: account.cloud_username,
				tag: EXPEDITION_TESTER_TAG, granted: is_expedition_tester(client_id) }));
			return 0;
		}
		case 'global-chat-message':
			return set_global_chat_message_moderation(args, output);
		case 'global-chat-throttle':
			return set_global_chat_throttle(args, output);
		case 'status': {
			if (args.length !== 1)
				return usage(output);

			const identity_count = db.query<{ count: number }, []>(
				'SELECT COUNT(*) AS `count` FROM `clients`'
			).get()?.count ?? 0;
			const disabled_count = db.query<{ count: number }, []>(
				'SELECT COUNT(*) AS `count` FROM `clients` WHERE `disabled` = 1'
			).get()?.count ?? 0;

			output.log(`registrations=${get_service_setting('registrations_open') === '1' ? 'open' : 'closed'}`);
			output.log(`alliance_preview=${get_service_setting('alliance_preview_enabled') === '0' ? 'off' : 'on'}`);
			output.log(`maintenance=${get_service_setting('maintenance') === '1' ? 'on' : 'off'}`);
			output.log(`icon_collection=${get_service_setting('icon_collection_enabled') === '1' ? 'on' : 'off'}`);
			output.log(`icon_collection_max_icon_bytes=${get_service_setting(ICON_CATALOG_SETTING_KEYS.max_icon_bytes)}`);
			output.log(`icon_collection_max_manifest_items=${get_service_setting(ICON_CATALOG_SETTING_KEYS.max_manifest_items)}`);
			output.log(`icon_collection_max_catalog_bytes=${get_service_setting(ICON_CATALOG_SETTING_KEYS.max_catalog_bytes)}`);
			output.log(`icon_collection_max_observations=${get_service_setting(ICON_CATALOG_SETTING_KEYS.max_observations)}`);
			output.log(`released_mod_version=${get_service_setting('released_mod_version') || 'none'}`);
			output.log(`minimum_supported_mod_version=${get_service_setting('minimum_supported_mod_version') || 'none'}`);
			output.log(`campaign_retirement_phase=${get_service_setting('campaign_retirement_phase') ?? 'active'}`);
			const raid_cutover = db.query<{ cutover_at: number; resume_at: number }, []>(
				'SELECT `cutover_at`, `resume_at` FROM `raid_cutover` WHERE `id` = 1').get();
			output.log(`raid_cutover_at=${raid_cutover?.cutover_at ?? 'none'}`);
			output.log(`raid_resume_at=${raid_cutover?.resume_at ?? 'none'}`);
			output.log(`active_raids=${(db.query<{ count: number }, [number]>(
				'SELECT COUNT(*) AS `count` FROM `guild_raids` WHERE `expires_at` > ?').get(Date.now()))?.count ?? 0}`);
			output.log(`identities=${identity_count}`);
			output.log(`disabled_identities=${disabled_count}`);
			return 0;
		}
		case 'installation': {
			const client_id = parse_positive_integer(argument);
			if (action !== 'revoke' || args.length !== 4 || client_id === null) return usage(output);
			if (!revoke_installation(client_id, args[3]!)) { output.error('Installation not found.'); return 1; }
			output.log('Installation revoked. Other installation credentials remain valid.');
			return 0;
		}
		case 'registrations':
			if (args.length !== 2 || (action !== 'open' && action !== 'close'))
				return usage(output);
			set_setting('registrations_open', action === 'open' ? '1' : '0');
			output.log(`Registrations ${action}.`);
			return 0;
		case 'alliance-preview':
			if (args.length !== 2 || (action !== 'on' && action !== 'off'))
				return usage(output);
			db.transaction(() => {
				db.query('INSERT INTO service_settings (key, value) VALUES (?, ?) ' +
					'ON CONFLICT (key) DO UPDATE SET value = excluded.value')
					.run('alliance_preview_enabled', action === 'on' ? '1' : '0');
				db.query('UPDATE clients SET event_revision = event_revision + 1').run();
			}).immediate();
			output.log(`Alliance preview ${action}.`);
			return 0;
		case 'maintenance':
			if (args.length !== 2 || (action !== 'on' && action !== 'off'))
				return usage(output);
			set_setting('maintenance', action === 'on' ? '1' : '0');
			output.log(`Maintenance mode ${action}.`);
			return 0;
		case 'icon-collection':
			if (args.length !== 2 || (action !== 'on' && action !== 'off'))
				return usage(output);
			set_setting('icon_collection_enabled', action === 'on' ? '1' : '0');
			output.log(`Icon collection ${action}.`);
			return 0;
		case 'icon-collection-limit': {
			if (args.length !== 3)
				return usage(output);
			const limit = parse_icon_collection_limit(action, argument);
			if (limit === null)
				return usage(output);
			set_setting(limit.key, String(limit.value));
			output.log(`Icon collection ${action} limit set to ${limit.value}.`);
			return 0;
		}
		case 'release-version':
			if (args.length !== 2 || (action !== 'clear' && !is_release_version(action)))
				return usage(output);
			set_setting('released_mod_version', action === 'clear' ? '' : action);
			output.log(action === 'clear'
				? 'Released mod version cleared.'
				: `Released mod version set to ${action}.`);
			return 0;
		case 'minimum-supported-version':
			if (args.length !== 2 || (action !== 'clear' && !is_minimum_supported_version(action)))
				return usage(output);
			set_setting('minimum_supported_mod_version', action === 'clear' ? '' : action);
			output.log(action === 'clear'
				? 'Minimum supported mod version cleared.'
				: `Minimum supported mod version set to ${action}.`);
			return 0;
		case 'alliance':
		case 'alliance-process': {
			const id = parse_positive_integer(argument);
			if (action !== 'inspect' || id === null || args.length !== 3) return usage(output);
			const alliance = command === 'alliance';
			const record = db.query(alliance ? 'SELECT * FROM alliances WHERE id=?' : 'SELECT * FROM alliance_processes WHERE id=?').get(id);
			if (!record) { output.error('Alliance record not found.'); return 1; }
			output.log(JSON.stringify({record, ...(alliance ? {
				members: db.query('SELECT * FROM alliance_memberships WHERE alliance_id=? ORDER BY guild_id').all(id),
				processes: db.query('SELECT * FROM alliance_processes WHERE alliance_id=? ORDER BY id DESC LIMIT 60').all(id)
			} : {
				ballots:db.query('SELECT * FROM alliance_ballots WHERE process_id=? ORDER BY guild_id').all(id),
				petitions:db.query('SELECT p.*,l.role FROM guild_petitions p JOIN alliance_process_petitions l ON l.petition_id=p.id WHERE l.process_id=? ORDER BY p.id').all(id)
			})}));
			return 0;
		}
		case 'guild': {
			if (action !== 'inspect' || args.length !== 3)
				return usage(output);
			const guild_id = parse_positive_integer(argument);
			return guild_id === null ? usage(output) : inspect_guild(guild_id, output);
		}
		case 'support-message': {
			const message_id = parse_positive_integer(argument);
			if (action !== 'inspect' || args.length !== 3 || message_id === null)
				return usage(output);
			return inspect_support_message(message_id, output);
		}
		case 'identity': {
			if (args.length !== 3 || !['find', 'inspect', 'enable', 'disable'].includes(action ?? ''))
				return usage(output);

			if (action === 'find') {
				if (typeof argument !== 'string' || argument.length === 0 || argument.length > 20)
					return usage(output);
				return find_identities(argument, output);
			}

			const client_id = parse_positive_integer(argument);
			if (client_id === null)
				return usage(output);

			if (action === 'inspect') {
				const identity = db.query<{
					id: number;
					display_name: string;
					disabled: number;
					deleted_at: number | null;
					last_multiplayer_active_at: number;
					melvor_account_id: number | null;
					manual_melvor_account_link: number;
					social_mode: string;
					social_mode_enforced: number;
					account_social_mode_enforced: number;
					session_count: number;
					guild_id: number | null;
					guild_name: string | null;
					guild_type: string | null;
				}, [number]>(
					'SELECT c.`id`, c.`display_name`, c.`disabled`, c.`deleted_at`, ' +
					'c.`last_multiplayer_active_at`, c.`melvor_account_id`, c.`manual_melvor_account_link`, c.`social_mode`, ' +
					'c.`social_mode_enforced`, COALESCE(account.`social_mode_enforced`, 0) AS `account_social_mode_enforced`, ' +
					'(SELECT COUNT(*) FROM `client_sessions` AS s WHERE s.`client_id` = c.`id`) AS `session_count`, ' +
					'm.`guild_id`, g.`name` AS `guild_name`, g.`type` AS `guild_type` ' +
					'FROM `clients` AS c ' +
					'LEFT JOIN `melvor_accounts` AS account ON account.`id` = c.`melvor_account_id` ' +
					'LEFT JOIN `guild_memberships` AS m ON m.`client_id` = c.`id` ' +
					'LEFT JOIN `guilds` AS g ON g.`id` = m.`guild_id` ' +
					'WHERE c.`id` = ? LIMIT 1'
				).get(client_id);
				if (identity === null) {
					output.error(`Multiplayer identity ${client_id} does not exist.`);
					return 1;
				}

				output.log(`identity_id=${identity.id}`);
				const installations = db.query(`SELECT i.installation_id, i.device_diagnostics, i.mod_version,
					first_seen_at, last_seen_at, c.revoked_at, (c.credential_hash IS NOT NULL) AS credential_enrolled
					FROM client_installations i LEFT JOIN installation_credentials c
					ON c.client_id=i.client_id AND c.installation_id=i.installation_id WHERE i.client_id = ?
					ORDER BY last_seen_at DESC LIMIT 32`).all(client_id);
				output.log(`installations=${JSON.stringify(installations)}`);
				const credential_installations = db.query(`SELECT installation_id, revoked_at FROM installation_credentials
					WHERE client_id = ? LIMIT 32`).all(client_id);
				output.log(`credential_installations=${JSON.stringify(credential_installations)}`);
				output.log(`display_name=${JSON.stringify(identity.display_name)}`);
				output.log(`disabled=${identity.disabled === 1 ? 'yes' : 'no'}`);
				output.log(`deleted=${identity.deleted_at === null ? 'no' : 'yes'}`);
				output.log(`active_sessions=${identity.session_count}`);
				output.log(`last_multiplayer_active_at=${identity.last_multiplayer_active_at}`);
				output.log(`melvor_account_id=${identity.melvor_account_id ?? 'none'}`);
				output.log(`melvor_account_linked=${identity.melvor_account_id === null ? 'no' : 'yes'}`);
				output.log(`social_mode=${identity.social_mode}`);
				output.log(`social_mode_enforcement=${identity.social_mode_enforced === 1 ? 'identity' : identity.account_social_mode_enforced === 1 ? 'account' : 'none'}`);
				output.log(`manual_account_link=${identity.manual_melvor_account_link === 1 ? 'yes' : 'no'}`);
				output.log(`guild_id=${identity.guild_id ?? 'none'}`);
				output.log(`guild_name=${identity.guild_name === null ? 'none' : JSON.stringify(identity.guild_name)}`);
				output.log(`guild_type=${identity.guild_type ?? 'none'}`);
				return 0;
			}

			const result = db.transaction(() => {
				const updated = db.query('UPDATE `clients` SET `disabled` = ? WHERE `id` = ?')
					.run(action === 'disable' ? 1 : 0, client_id);
				if (action === 'disable')
					db.query('DELETE FROM `client_sessions` WHERE `client_id` = ?').run(client_id);
				return updated.changes;
			}).immediate();

			if (result !== 1) {
				output.error(`Multiplayer identity ${client_id} does not exist.`);
				return 1;
			}

			output.log(`Multiplayer identity ${client_id} ${action}d.`);
			return 0;
		}
		default:
			return usage(output);
	}
}

export function run_admin(args: string[], output: AdminOutput = console_output): number {
	const action = args.slice(0, 3).join('.') || 'unknown';
	return run_with_audit_context(make_audit_context({
		event_type: `operator.admin.${action}`,
		actor_kind: 'operator', actor_client_id: null, actor_display_name: 'admin-cli',
		details: { command: action }
	}), () => run_admin_command(args, output));
}

if (import.meta.main) {
	const args = Bun.argv.slice(2);
	if (args.length === 5 && args[0] === 'support-message' && args[1] === 'correct') {
		const message_id = parse_positive_integer(args[2]);
		const expected_digest = args[3];
		if (message_id === null || !/^[0-9a-f]{64}$/.test(expected_digest ?? '') || args[4] !== 'confirm') {
			process.exitCode = usage(console_output);
		} else {
			const input = await Bun.stdin.text();
			process.exitCode = run_with_audit_context(make_audit_context({
				event_type: 'operator.admin.support-message.correct', actor_kind: 'operator',
				actor_client_id: null, actor_display_name: 'admin-cli',
				details: { command: 'support-message.correct', message_id }
			}), () => correct_support_message(message_id, expected_digest as string, input));
		}
	} else if (args.length === 4 && args[0] === 'updates' && args[1] === 'set') {
		const input = await Bun.stdin.text();
		process.exitCode = run_with_audit_context(make_audit_context({
			event_type: 'operator.admin.updates.set', actor_kind: 'operator',
			actor_client_id: null, actor_display_name: 'admin-cli',
			details: { command: 'updates.set', section_id: args[2], field: args[3] }
		}), () => set_update_section(args, input));
	} else {
		process.exitCode = run_admin(args);
	}
	db.close();
}
