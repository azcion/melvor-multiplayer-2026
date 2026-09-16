import { createHash } from 'node:crypto';
import { record_audit_event } from './audit';
import { revoke_installation } from './installations';
import { db, get_service_setting } from './db';
import { make_audit_context, run_with_audit_context } from './audit-context';
import { CHARITY_KNOWN_CURRENCY_VALUATIONS } from './charity-values';
import { CHARITY_WISH_PROMO_MATURING_MS } from './charity-wishes';
import { CHARITY_NORMAL_DECAY_MS } from './charity-decay';
import { is_minimum_supported_version } from './client-version-policy';
import { remove_charity_contributor_quantity } from './charity-contributors';
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
const MAX_CHARITREE_VALUE_CATALOG_BYTES = 4 * 1024 * 1024;
const MAX_CHARITREE_VALUE_CATALOG_ITEMS = 100000;
const MAX_CHARITREE_EXPIRY_SECONDS = 31 * 24 * 60 * 60;
const MAX_CHARITY_WISH_PROMO_HOURS = 31 * 24;
const MIN_CHARITY_DECAY_HOURS = 2;
const MAX_CHARITY_DECAY_HOURS = CHARITY_NORMAL_DECAY_MS / (60 * 60 * 1000) - 1;
const MAX_SUPPORT_MESSAGE_LENGTH = 1000;

function usage(output: AdminOutput): number {
	output.error(`Usage:
  bun run admin.ts status
  bun run admin.ts registrations open|close
  bun run admin.ts maintenance on|off
  bun run admin.ts icon-collection on|off
  bun run admin.ts icon-collection-limit icon-bytes|manifest-items|catalog-bytes|observations VALUE
  bun run admin.ts release-version VERSION|clear
  bun run admin.ts minimum-supported-version VERSION|clear
  bun run admin.ts updates get SECTION_ID title|body
  bun run admin.ts updates set SECTION_ID title|body < CONTENT
  bun run admin.ts installation revoke CLIENT_ID INSTALLATION_ID
  bun run admin.ts guild inspect GUILD_ID
  bun run admin.ts identity find DISPLAY_NAME
  bun run admin.ts identity inspect CLIENT_ID
  bun run admin.ts identity enable|disable CLIENT_ID
  bun run admin.ts support-message inspect MESSAGE_ID
  bun run admin.ts support-message correct MESSAGE_ID EXPECTED_SHA256 confirm < REPLACEMENT_TEXT
  bun run admin.ts social-mode enforce|clear identity|account ID
  bun run admin.ts global-chat-throttle server clear|MAX_MESSAGES WINDOW_SECONDS
  bun run admin.ts global-chat-throttle client CLIENT_ID clear|MAX_MESSAGES WINDOW_SECONDS
  bun run admin.ts charity reset CLIENT_ID
  bun run admin.ts charity reset-all
  bun run admin.ts charity repair-bank-receipt CLIENT_ID RECEIPT_ID ITEM_ID QTY confirm
  bun run admin.ts charity set-expiry GUILD_ID ITEM_ID EXPECTED_QTY SECONDS confirm
  bun run admin.ts charity wish-promo status|stop
  bun run admin.ts charity wish-promo stagger confirm
  bun run admin.ts charity wish-promo start PROMO_HOURS [DECAY_HOURS] confirm
  bun run admin.ts charity backfill-values < charitree-item-values.json
  bun run admin.ts economy-receipt rollback-duplicate-charity CLIENT_ID RECEIPT_ID confirm`);
	return 2;
}

type CharitreeValueCatalogEntry = {
	id: string;
	value_currency_id: string | null;
	value_per_item: number;
};

function is_namespaced_id(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
		/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(value);
}

function parse_charitree_value_catalog(input: string): CharitreeValueCatalogEntry[] | null {
	if (Buffer.byteLength(input, 'utf8') > MAX_CHARITREE_VALUE_CATALOG_BYTES)
		return null;
	let value: unknown;
	try {
		value = JSON.parse(input);
	} catch {
		return null;
	}
	if (!Array.isArray(value) || value.length > MAX_CHARITREE_VALUE_CATALOG_ITEMS)
		return null;
	const entries: CharitreeValueCatalogEntry[] = [];
	const item_ids = new Set<string>();
	for (const row of value) {
		if (typeof row !== 'object' || row === null || Array.isArray(row))
			return null;
		const record = row as Record<string, unknown>;
		const id = record.id;
		const value_currency_id = record.value_currency_id;
		const value_per_item = record.value_per_item;
		if (!is_namespaced_id(id) || item_ids.has(id) ||
			(value_currency_id !== null && !is_namespaced_id(value_currency_id)) ||
			typeof value_per_item !== 'number' || !Number.isSafeInteger(value_per_item) || value_per_item < 0 ||
			(value_per_item > 0 && value_currency_id === null))
			return null;
		item_ids.add(id);
		entries.push({ id, value_currency_id, value_per_item });
	}
	return entries;
}

export function backfill_charitree_values(input: string, output: AdminOutput = console_output): number {
	const entries = parse_charitree_value_catalog(input);
	if (entries === null) {
		output.error('Invalid Charitree item-value catalog.');
		return 1;
	}
	const updated = db.transaction(() => {
		let changes = 0;
		const statement = db.query(
			'UPDATE `charity_items` SET `value_currency_id` = ?, `value_per_item` = ? ' +
			'WHERE `item_id` = ? AND `value_per_item` IS NULL'
		);
		for (const [item_id, valuation] of Object.entries(CHARITY_KNOWN_CURRENCY_VALUATIONS))
			changes += statement.run(valuation.value_currency_id, valuation.value_per_item, item_id).changes;
		for (const entry of entries)
			changes += statement.run(entry.value_currency_id, entry.value_per_item, entry.id).changes;
		const remaining_unknown = db.query<{ count: number }, []>(
			' SELECT COUNT(*) AS `count` FROM `charity_items` WHERE `value_per_item` IS NULL'
		).get()?.count ?? 0;
		if (entries.length === 0 && remaining_unknown > 0)
			return null;
		db.query(
			"UPDATE `service_settings` SET `value` = '0' WHERE `key` = 'charity_value_backfill_pending'"
		).run();
		return changes;
	}).immediate();
	if (updated === null) {
		output.error('The Charitree item-value catalog is empty while unknown stacks remain.');
		return 1;
	}
	const remaining = db.query<{ count: number }, []>(
		'SELECT COUNT(*) AS `count` FROM `charity_items` WHERE `value_per_item` IS NULL'
	).get()?.count ?? 0;
	output.log(`catalog_items=${entries.length}`);
	output.log(`charitree_stacks_updated=${updated}`);
	output.log(`charitree_stacks_remaining_unknown=${remaining}`);
	output.log('charitree_value_backfill_pending=0');
	return 0;
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

function run_charity_wish_promo(args: string[], output: AdminOutput): number {
	const [, , action, argument] = args;
	const now = Date.now();
	if (action === 'status' && args.length === 3) {
		const started_at = Number(get_service_setting('charity_wish_promo_started_at'));
		const ends_at = Number(get_service_setting('charity_wish_promo_ends_at'));
		const decay_hours = Number(get_service_setting('charity_wish_promo_decay_hours'));
		output.log(`charity_wish_promo=${Number.isSafeInteger(ends_at) && ends_at > now ? 'active' : 'inactive'}`);
		output.log(`charity_wish_promo_started_at=${Number.isSafeInteger(started_at) && started_at > 0 ? started_at : 0}`);
		output.log(`charity_wish_promo_ends_at=${Number.isSafeInteger(ends_at) && ends_at > 0 ? ends_at : 0}`);
		output.log(`charity_wish_promo_decay_hours=${Number.isSafeInteger(decay_hours) && decay_hours > 0 ? decay_hours : 0}`);
		return 0;
	}
	if (action === 'stop' && args.length === 3) {
		db.transaction(() => {
			set_setting('charity_wish_promo_started_at', '0');
			set_setting('charity_wish_promo_ends_at', '0');
			set_setting('charity_wish_promo_decay_hours', '0');
		}).immediate();
		output.log('Charitree Wish promo stopped. Existing timers were not changed.');
		return 0;
	}
	if (action === 'stagger' && args.length === 4 && argument === 'confirm') {
		const updated = db.query(
			'WITH eligible AS (' +
				'SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `guild_id` ORDER BY `matures_at`, `id`) - 1 AS `wish_index` ' +
				'FROM `charity_wishes` WHERE `matures_at` > ? AND `progress_gp` < `required_gp`' +
			') UPDATE `charity_wishes` SET `matures_at` = ? + 60000 + (' +
				'SELECT `wish_index` * 1000 FROM eligible WHERE eligible.`id` = `charity_wishes`.`id`' +
			') WHERE `id` IN (SELECT `id` FROM eligible)'
		).run(now + 60000, now);
		output.log(`charity_wishes_staggered=${updated.changes}`);
		return 0;
	}
	const promo_hours = parse_positive_integer(argument);
	const decay_hours = args.length === 6 ? parse_positive_integer(args[4]) : 0;
	const confirmation = args.length === 6 ? args[5] : args[4];
	if (action === 'start' && (args.length === 5 || args.length === 6) && confirmation === 'confirm' &&
		promo_hours !== null && promo_hours <= MAX_CHARITY_WISH_PROMO_HOURS && decay_hours !== null &&
		(decay_hours === 0 || (decay_hours >= MIN_CHARITY_DECAY_HOURS && decay_hours <= MAX_CHARITY_DECAY_HOURS))) {
		const previous_ends_at = Number(get_service_setting('charity_wish_promo_ends_at'));
		const previous_started_at = Number(get_service_setting('charity_wish_promo_started_at'));
		const started_at = previous_ends_at > now && Number.isSafeInteger(previous_started_at) &&
			previous_started_at > 0 && previous_started_at <= now ? previous_started_at : now;
		const ends_at = now + promo_hours * 60 * 60 * 1000;
		const updated = db.transaction(() => {
			set_setting('charity_wish_promo_started_at', String(started_at));
			set_setting('charity_wish_promo_ends_at', String(ends_at));
			set_setting('charity_wish_promo_decay_hours', String(decay_hours));
			return db.query(
				'UPDATE `charity_wishes` SET `matures_at` = ? WHERE `matures_at` > ? ' +
				'AND `progress_gp` < `required_gp`'
			).run(now + CHARITY_WISH_PROMO_MATURING_MS, now + CHARITY_WISH_PROMO_MATURING_MS).changes;
		}).immediate();
		output.log(`charity_wish_promo_started_at=${started_at}`);
		output.log(`charity_wish_promo_ends_at=${ends_at}`);
		output.log(`charity_wish_promo_decay_hours=${decay_hours}`);
		output.log(`charity_wishes_accelerated=${updated}`);
		return 0;
	}
	return usage(output);
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
		charitree_enabled: number;
	}, [number]>(
		'SELECT `id`, `name`, `icon_id`, `type`, `charitree_enabled` FROM `guilds` WHERE `id` = ? LIMIT 1'
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
	output.log(`charitree_enabled=${guild.charitree_enabled === 1 ? 'yes' : 'no'}`);
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

function reset_charity_timers(client_id: number, output: AdminOutput): number {
	const result = db.transaction(() => {
		const identity = db.query<{
			id: number;
			display_name: string;
			last_charity: number;
			last_bonus_charity: number;
			charitree_take_available_at: number | null;
		}, [number]>(
			'SELECT c.`id`, c.`display_name`, c.`last_charity`, c.`last_bonus_charity`, ' +
			'm.`charitree_take_available_at` ' +
			'FROM `clients` AS c LEFT JOIN `guild_memberships` AS m ON m.`client_id` = c.`id` ' +
			'WHERE c.`id` = ? LIMIT 1'
		).get(client_id);
		if (identity === null)
			return null;

		db.query('UPDATE `clients` SET `last_charity` = 0, `last_bonus_charity` = 0 WHERE `id` = ?').run(client_id);
		db.query('UPDATE `guild_memberships` SET `charitree_take_available_at` = 0 WHERE `client_id` = ?').run(client_id);
		return identity;
	}).immediate();

	if (result === null) {
		output.error(`Multiplayer identity ${client_id} does not exist.`);
		return 1;
	}

	output.log(`identity_id=${result.id}`);
	output.log(`display_name=${JSON.stringify(result.display_name)}`);
	output.log(`previous_last_charity=${result.last_charity}`);
	output.log(`previous_last_bonus_charity=${result.last_bonus_charity}`);
	output.log(`previous_charitree_take_available_at=${result.charitree_take_available_at ?? 'none'}`);
	output.log('last_charity=0');
	output.log('last_bonus_charity=0');
	output.log('charitree_take_available_at=0');
	return 0;
}

function reset_all_charity_timers(output: AdminOutput): number {
	const result = db.transaction(() => {
		const client_count = db.query<{ count: number }, []>(
			' SELECT COUNT(*) AS `count` FROM `clients`'
		).get()?.count ?? 0;
		const membership_count = db.query<{ count: number }, []>(
			' SELECT COUNT(*) AS `count` FROM `guild_memberships`'
		).get()?.count ?? 0;

		db.query('UPDATE `clients` SET `last_charity` = 0, `last_bonus_charity` = 0').run();
		db.query('UPDATE `guild_memberships` SET `charitree_take_available_at` = 0').run();
		return { client_count, membership_count };
	}).immediate();

	output.log(`charity_clients_reset=${result.client_count}`);
	output.log(`charity_memberships_reset=${result.membership_count}`);
	return 0;
}

function set_charitree_expiry(
	guild_id: number,
	item_id: string,
	expected_qty: number,
	seconds: number,
	output: AdminOutput
): number {
	const result = db.transaction(() => {
		const guild = db.query<{ name: string; charitree_enabled: number }, [number]>(
			' SELECT `name`, `charitree_enabled` FROM `guilds` WHERE `id` = ? LIMIT 1'
		).get(guild_id);
		if (guild === null)
			return { error: 'Guild does not exist.' } as const;
		if (guild.charitree_enabled !== 1)
			return { error: 'Charitree is disabled for this Guild.' } as const;
		if (item_id === 'melvorD:Weird_Gloop')
			return { error: 'Weird Gloop does not expire.' } as const;

		const item = db.query<{ qty: number; expires_at: number }, [number, string]>(
			' SELECT `qty`, `expires_at` FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = ? LIMIT 1'
		).get(guild_id, item_id);
		if (item === null)
			return { error: 'Charitree item stack does not exist.' } as const;
		if (item.qty !== expected_qty)
			return { error: `Charitree item quantity changed; expected ${expected_qty}, found ${item.qty}.` } as const;

		const now = Date.now();
		const expires_at = now + seconds * 1000;
		if (!Number.isSafeInteger(expires_at))
			return { error: 'Requested expiry is outside the safe timestamp range.' } as const;
		db.query('UPDATE `charity_items` SET `expires_at` = ? WHERE `guild_id` = ? AND `item_id` = ?')
			.run(expires_at, guild_id, item_id);
		return { guild_name: guild.name, previous_expires_at: item.expires_at, expires_at } as const;
	}).immediate();

	if ('error' in result && typeof result.error === 'string') {
		output.error(result.error);
		return 1;
	}
	output.log(`guild_id=${guild_id}`);
	output.log(`guild_name=${JSON.stringify(result.guild_name)}`);
	output.log(`item_id=${item_id}`);
	output.log(`qty=${expected_qty}`);
	output.log(`previous_expires_at=${result.previous_expires_at}`);
	output.log(`expires_at=${result.expires_at}`);
	output.log(`expires_in_seconds=${seconds}`);
	return 0;
}

type CharityReceiptEffect = { item_id: string; qty: number };

function parse_charity_receipt_effects(response_json: string, receipt_id: string): CharityReceiptEffect[] | null {
	let response: unknown;
	try {
		response = JSON.parse(response_json);
	} catch {
		return null;
	}
	if (typeof response !== 'object' || response === null || Array.isArray(response))
		return null;
	const receipt = (response as { receipt?: unknown }).receipt;
	if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt))
		return null;
	const value = receipt as { id?: unknown; kind?: unknown; effects?: unknown };
	if (value.id !== receipt_id || value.kind !== 'charity-donate' || !Array.isArray(value.effects) || value.effects.length === 0)
		return null;
	const effects: CharityReceiptEffect[] = [];
	for (const effect of value.effects) {
		if (typeof effect !== 'object' || effect === null || Array.isArray(effect))
			return null;
		const item = effect as { storage?: unknown; item_id?: unknown; qty?: unknown; destroyable?: unknown };
		if (item.storage !== 'transfer' || typeof item.item_id !== 'string' || item.item_id.length === 0 ||
			typeof item.qty !== 'number' || !Number.isSafeInteger(item.qty) || item.qty >= 0 || item.destroyable !== undefined ||
			effects.some(existing => existing.item_id === item.item_id))
			return null;
		effects.push({ item_id: item.item_id, qty: item.qty });
	}
	return effects;
}

function same_charity_receipt_effects(left: CharityReceiptEffect[], right: CharityReceiptEffect[]): boolean {
	if (left.length !== right.length)
		return false;
	const normalized = (effects: CharityReceiptEffect[]) => effects
		.map(effect => `${effect.item_id}\u0000${effect.qty}`)
		.sort()
		.join('\u0001');
	return normalized(left) === normalized(right);
}

function repair_bank_charity_receipt(
	client_id: number,
	receipt_id: string,
	item_id: string,
	qty: number,
	output: AdminOutput
): number {
	const result = db.transaction(() => {
		const pending = db.query<{
			response_json: string;
			acknowledged_at: number | null;
		}, [string, number]>(
			'SELECT `response_json`, `acknowledged_at` FROM `economy_receipts` ' +
			'WHERE `id` = ? AND `client_id` = ? AND `kind` = \'charity-donate\' LIMIT 1'
		).get(receipt_id, client_id);
		if (pending === null || pending.acknowledged_at !== null)
			return { error: 'Receipt is not a pending Charity donation for this identity.' } as const;

		let response: unknown;
		try {
			response = JSON.parse(pending.response_json);
		} catch {
			return { error: 'Receipt response is not valid JSON.' } as const;
		}
		if (typeof response !== 'object' || response === null || Array.isArray(response))
			return { error: 'Receipt response has an invalid shape.' } as const;
		const receipt = (response as { receipt?: unknown }).receipt;
		if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt))
			return { error: 'Receipt response has an invalid receipt.' } as const;
		const effects = (receipt as { effects?: unknown }).effects;
		if (!Array.isArray(effects) || effects.length !== 1)
			return { error: 'Receipt is not a single-item bank Charity donation.' } as const;
		const effect = effects[0];
		if (typeof effect !== 'object' || effect === null || Array.isArray(effect))
			return { error: 'Receipt has an invalid effect.' } as const;
		const stored_effect = effect as { storage?: unknown; item_id?: unknown; qty?: unknown; destroyable?: unknown };
		if (stored_effect.storage !== 'transfer' || stored_effect.item_id !== item_id || stored_effect.qty !== -qty ||
			stored_effect.destroyable !== undefined)
			return { error: 'Receipt does not match the requested blocked bank donation.' } as const;

		const membership = db.query<{ guild_id: number }, [number]>(
			'SELECT `guild_id` FROM `guild_memberships` WHERE `client_id` = ? LIMIT 1'
		).get(client_id);
		if (membership === null)
			return { error: 'Identity has no active Guild for Charity repair.' } as const;
		const stock = db.query<{ qty: number }, [number, string]>(
			'SELECT `qty` FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = ? LIMIT 1'
		).get(membership.guild_id, item_id);
		if (stock === null || stock.qty < qty)
			return { error: 'Charity stock does not contain the committed donation.' } as const;

		const next_receipt = {
			...(receipt as Record<string, unknown>),
			effects: [{ storage: 'bank', item_id, qty: -qty }]
		};
		const next_response = { ...(response as Record<string, unknown>), receipt: next_receipt };
		db.query('UPDATE `economy_receipts` SET `response_json` = ? WHERE `id` = ? AND `client_id` = ?')
			.run(JSON.stringify(next_response), receipt_id, client_id);
		db.query('UPDATE `clients` SET `event_revision` = `event_revision` + 1 WHERE `id` = ?').run(client_id);
		return { guild_id: membership.guild_id } as const;
	}).immediate();

	if ('error' in result && typeof result.error === 'string') {
		output.error(result.error);
		return 1;
	}
	output.log(`client_id=${client_id}`);
	output.log(`receipt_id=${receipt_id}`);
	output.log(`guild_id=${result.guild_id}`);
	output.log(`item_id=${item_id}`);
	output.log(`qty=${qty}`);
	output.log('receipt_effect_storage=bank');
	output.log('receipt_acknowledged=no');
	return 0;
}

function rollback_duplicate_charity_receipt(client_id: number, receipt_id: string, output: AdminOutput): number {
	const result = db.transaction(() => {
		const pending = db.query<{
			kind: string;
			response_json: string;
			created_at: number;
			acknowledged_at: number | null;
		}, [string, number]>(
			'SELECT `kind`, `response_json`, `created_at`, `acknowledged_at` FROM `economy_receipts` ' +
			'WHERE `id` = ? AND `client_id` = ? LIMIT 1'
		).get(receipt_id, client_id);
		if (pending === null || pending.kind !== 'charity-donate' || pending.acknowledged_at !== null)
			return { error: 'Receipt is not a pending Charity donation for this identity.' } as const;
		const pending_effects = parse_charity_receipt_effects(pending.response_json, receipt_id);
		if (pending_effects === null)
			return { error: 'Receipt shape is not an eligible Charity donation duplicate.' } as const;

		const acknowledged_candidates = db.query<{
			id: string;
			response_json: string;
		}, [number, number, number]>(
			'SELECT `id`, `response_json` FROM `economy_receipts` WHERE `client_id` = ? AND `kind` = \'charity-donate\' ' +
			'AND `acknowledged_at` IS NOT NULL AND `created_at` BETWEEN ? AND ? ORDER BY `created_at`, `id`'
		).all(client_id, pending.created_at - 1000, pending.created_at + 1000)
			.map(candidate => ({
				...candidate,
				effects: parse_charity_receipt_effects(candidate.response_json, candidate.id)
			}))
			.filter((candidate): candidate is { id: string; response_json: string; effects: CharityReceiptEffect[] } =>
				candidate.effects !== null && same_charity_receipt_effects(pending_effects, candidate.effects));
		if (acknowledged_candidates.length !== 1)
			return { error: `Expected exactly one acknowledged duplicate receipt; found ${acknowledged_candidates.length}.` } as const;

		const membership = db.query<{ guild_id: number }, [number]>(
			'SELECT `guild_id` FROM `guild_memberships` WHERE `client_id` = ? LIMIT 1'
		).get(client_id);
		if (membership === null)
			return { error: 'Identity has no active Guild for Charity rollback.' } as const;

		for (const effect of pending_effects) {
			const item = db.query<{ qty: number }, [number, string]>(
				'SELECT `qty` FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = ? LIMIT 1'
			).get(membership.guild_id, effect.item_id);
			if (item === null || item.qty < -effect.qty)
				return { error: `Charity stock is insufficient to roll back ${effect.item_id}.` } as const;
		}

		for (const effect of pending_effects) {
			const item = db.query<{ qty: number }, [number, string]>(
				'SELECT `qty` FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = ? LIMIT 1'
			).get(membership.guild_id, effect.item_id);
			remove_charity_contributor_quantity(membership.guild_id, effect.item_id, client_id, -effect.qty);
			if (item?.qty === -effect.qty)
				db.query('DELETE FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = ?').run(membership.guild_id, effect.item_id);
			else
				db.query('UPDATE `charity_items` SET `qty` = `qty` + ? WHERE `guild_id` = ? AND `item_id` = ?')
					.run(effect.qty, membership.guild_id, effect.item_id);
		}
		db.query('UPDATE `economy_receipts` SET `acknowledged_at` = ? WHERE `id` = ?').run(Date.now(), receipt_id);
		db.query('UPDATE `clients` SET `event_revision` = `event_revision` + 1 WHERE `id` = ?').run(client_id);
		return {
			guild_id: membership.guild_id,
			duplicate_receipt_id: acknowledged_candidates[0].id,
			effects: pending_effects
		} as const;
	}).immediate();

	if ('error' in result && typeof result.error === 'string') {
		output.error(result.error);
		return 1;
	}
	output.log(`client_id=${client_id}`);
	output.log(`receipt_id=${receipt_id}`);
	output.log(`duplicate_receipt_id=${result.duplicate_receipt_id}`);
	output.log(`guild_id=${result.guild_id}`);
	output.log(`rolled_back_effects=${JSON.stringify(result.effects)}`);
	output.log('receipt_acknowledged=yes');
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
		case 'updates':
			return run_updates_command(args, output);
		case 'social-mode':
			return set_social_mode_enforcement(args, output);
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
			output.log(`maintenance=${get_service_setting('maintenance') === '1' ? 'on' : 'off'}`);
			output.log(`icon_collection=${get_service_setting('icon_collection_enabled') === '1' ? 'on' : 'off'}`);
			output.log(`icon_collection_max_icon_bytes=${get_service_setting(ICON_CATALOG_SETTING_KEYS.max_icon_bytes)}`);
			output.log(`icon_collection_max_manifest_items=${get_service_setting(ICON_CATALOG_SETTING_KEYS.max_manifest_items)}`);
			output.log(`icon_collection_max_catalog_bytes=${get_service_setting(ICON_CATALOG_SETTING_KEYS.max_catalog_bytes)}`);
			output.log(`icon_collection_max_observations=${get_service_setting(ICON_CATALOG_SETTING_KEYS.max_observations)}`);
			output.log(`released_mod_version=${get_service_setting('released_mod_version') || 'none'}`);
			output.log(`minimum_supported_mod_version=${get_service_setting('minimum_supported_mod_version') || 'none'}`);
			output.log(`charitree_value_backfill_pending=${get_service_setting('charity_value_backfill_pending') ?? '0'}`);
			const wish_promo_started_at = Number(get_service_setting('charity_wish_promo_started_at'));
			const wish_promo_ends_at = Number(get_service_setting('charity_wish_promo_ends_at'));
			const wish_promo_decay_hours = Number(get_service_setting('charity_wish_promo_decay_hours'));
			output.log(`charity_wish_promo=${Number.isSafeInteger(wish_promo_ends_at) && wish_promo_ends_at > Date.now() ? 'active' : 'inactive'}`);
			output.log(`charity_wish_promo_started_at=${Number.isSafeInteger(wish_promo_started_at) && wish_promo_started_at > 0 ? wish_promo_started_at : 0}`);
			output.log(`charity_wish_promo_ends_at=${Number.isSafeInteger(wish_promo_ends_at) && wish_promo_ends_at > 0 ? wish_promo_ends_at : 0}`);
			output.log(`charity_wish_promo_decay_hours=${Number.isSafeInteger(wish_promo_decay_hours) && wish_promo_decay_hours > 0 ? wish_promo_decay_hours : 0}`);
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
		case 'charity': {
			if (action === 'wish-promo')
				return run_charity_wish_promo(args, output);
			if (action === 'reset-all' && args.length === 2)
				return reset_all_charity_timers(output);
			if (action === 'set-expiry' && args.length === 7 && args[6] === 'confirm') {
				const guild_id = parse_positive_integer(args[2]);
				const item_id = args[3];
				const expected_qty = parse_positive_integer(args[4]);
				const seconds = parse_positive_integer(args[5]);
				if (guild_id === null || !is_namespaced_id(item_id) || expected_qty === null || seconds === null ||
					seconds > MAX_CHARITREE_EXPIRY_SECONDS)
					return usage(output);
				return set_charitree_expiry(guild_id, item_id, expected_qty, seconds, output);
			}
			if (action === 'repair-bank-receipt' && args.length === 7 && args[6] === 'confirm') {
				const client_id = parse_positive_integer(args[2]);
				const receipt_id = args[3];
				const item_id = args[4];
				const qty = parse_positive_integer(args[5]);
				if (client_id === null || typeof receipt_id !== 'string' || !/^[0-9a-f-]{36}$/.test(receipt_id) ||
					!is_namespaced_id(item_id) || qty === null)
					return usage(output);
				return repair_bank_charity_receipt(client_id, receipt_id, item_id, qty, output);
			}
			if (action !== 'reset' || args.length !== 3)
				return usage(output);
			const client_id = parse_positive_integer(argument);
			return client_id === null ? usage(output) : reset_charity_timers(client_id, output);
		}
		case 'economy-receipt': {
			const client_id = parse_positive_integer(argument);
			if (action !== 'rollback-duplicate-charity' || args.length !== 5 || args[4] !== 'confirm' ||
				client_id === null || typeof args[3] !== 'string' || !/^[0-9a-f-]{36}$/.test(args[3]))
				return usage(output);
			return rollback_duplicate_charity_receipt(client_id, args[3], output);
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
	} else if (args.length === 2 && args[0] === 'charity' && args[1] === 'backfill-values') {
		const input = await Bun.stdin.text();
		process.exitCode = run_with_audit_context(make_audit_context({
			event_type: 'operator.admin.charity.backfill-values', actor_kind: 'operator',
			actor_client_id: null, actor_display_name: 'admin-cli', details: { command: 'charity.backfill-values' }
		}), () => backfill_charitree_values(input));
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
