import type { Database } from 'bun:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';

export type DurableAuditContext = {
	context_id: string; event_type: string; source_key: string;
	actor_kind: 'client' | 'operator' | 'system';
	actor_client_id: number | null; actor_display_name: string | null;
	guild_id?: number | null; guild_name?: string | null; command_id?: string | null;
	installation_id?: string | null; client_platform?: string | null;
	app_distribution?: string | null; app_channel?: string | null;
	app_version?: string | null; app_build?: string | null;
	details?: Record<string, string | number | boolean | null>;
};

const storage = new AsyncLocalStorage<DurableAuditContext>();
let fallback_context: DurableAuditContext | null = null;

function current(): DurableAuditContext {
	const stored = storage.getStore();
	if (stored !== undefined) return stored;
	if (fallback_context === null) {
		const context_id = crypto.randomUUID();
		fallback_context = {
			context_id, event_type: 'system.database_mutation', source_key: `mutation:${context_id}`,
			actor_kind: 'system', actor_client_id: null, actor_display_name: null,
			details: { source: 'unscoped' }
		};
		queueMicrotask(() => { fallback_context = null; });
	}
	return fallback_context;
}

export function run_with_audit_context<T>(context: DurableAuditContext, operation: () => T): T {
	return storage.run(context, operation);
}

export function make_audit_context(input: Omit<DurableAuditContext, 'context_id' | 'source_key'> & {
	context_id?: string; source_key?: string;
}): DurableAuditContext {
	const context_id = input.context_id ?? crypto.randomUUID();
	return { ...input, context_id, source_key: input.source_key ?? `mutation:${context_id}` };
}

const PRIVATE_COLUMN = /(?:^|_)(?:token|key|secret|password|credential|hash|signature|bytes|content|body)(?:$|_)/i;
const PRIVATE_EXACT = new Set([
	'client_identifier', 'client_key', 'friend_code', 'playfab_id', 'cloud_username',
	'device_diagnostics', 'response_json', 'event_revision', 'last_multiplayer_active_at'
]);
const OPERATIONAL_TABLES = new Set(['charity_decay_activations', 'client_sessions']);

function identifier(value: string): string {
	return `\`${value.replaceAll('`', '``')}\``;
}

function literal(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function json_object(columns: string[], alias: 'OLD' | 'NEW'): string {
	if (columns.length === 0) return "'{}'";
	return `json_object(${columns.map(column => `${literal(column)}, ${alias}.${identifier(column)}`).join(', ')})`;
}

function install_durable_audit_triggers(database: Database): void {
	database.run(`CREATE TEMP TABLE IF NOT EXISTS audit_write_context (
		occurred_at INTEGER NOT NULL, event_type TEXT NOT NULL, actor_kind TEXT NOT NULL,
		actor_client_id INTEGER, actor_display_name TEXT, guild_id INTEGER, guild_name TEXT,
		command_id TEXT, source_key TEXT NOT NULL, installation_id TEXT, client_platform TEXT,
		app_distribution TEXT, app_channel TEXT, app_version TEXT, app_build TEXT, details_json TEXT NOT NULL
	)`);
	const tables = database.query<{ name: string }, []>(
		"SELECT `name` FROM `sqlite_schema` WHERE `type` = 'table' AND `name` NOT LIKE 'sqlite_%' " +
		"AND `name` NOT LIKE 'audit_%' ORDER BY `name`"
	).all().filter(table => !OPERATIONAL_TABLES.has(table.name));
	for (const { name } of tables) {
		const columns = database.query<{ name: string; type: string; pk: number }, []>(
			`PRAGMA table_info(${identifier(name)})`
		).all();
		const public_columns = columns.filter(column =>
			!PRIVATE_EXACT.has(column.name) && !PRIVATE_COLUMN.test(column.name) && !/BLOB/i.test(column.type)
		).map(column => column.name);
		const primary_columns = columns.filter(column => column.pk > 0 && public_columns.includes(column.name))
			.sort((left, right) => left.pk - right.pk).map(column => column.name);
		const keys = primary_columns.length > 0 ? primary_columns : public_columns.slice(0, 1);
		for (const operation of ['INSERT', 'UPDATE', 'DELETE'] as const) {
			const trigger_name = `durable_audit_${name}_${operation.toLowerCase()}`;
			const old_json = operation === 'INSERT' ? 'NULL' : json_object(public_columns, 'OLD');
			const new_json = operation === 'DELETE' ? 'NULL' : json_object(public_columns, 'NEW');
			const key_json = json_object(keys, operation === 'DELETE' ? 'OLD' : 'NEW');
			const when = operation === 'UPDATE' ? ` WHEN ${old_json} IS NOT ${new_json}` : '';
			database.run(`DROP TRIGGER IF EXISTS temp.${identifier(trigger_name)}`);
			database.run(`
				CREATE TEMP TRIGGER ${identifier(trigger_name)} AFTER ${operation} ON main.${identifier(name)}${when} BEGIN
					INSERT INTO audit_events (
						occurred_at, event_type, actor_kind, actor_client_id, actor_display_name,
						guild_id, guild_name, command_id, source_key, installation_id,
						client_platform, app_distribution, app_channel, app_version, app_build, details_json
					) SELECT occurred_at, event_type, actor_kind, actor_client_id, actor_display_name,
						guild_id, guild_name, command_id, source_key, installation_id,
						client_platform, app_distribution, app_channel, app_version, app_build, details_json
					FROM audit_write_context
					WHERE NOT EXISTS (
						SELECT 1 FROM audit_events WHERE source_key = (SELECT source_key FROM audit_write_context)
					);
					INSERT INTO audit_row_changes (event_id, ordinal, table_name, operation, row_key_json, before_json, after_json)
					SELECT id, COALESCE((SELECT MAX(ordinal) + 1 FROM audit_row_changes WHERE event_id = audit_events.id), 0),
						${literal(name)}, ${literal(operation.toLowerCase())}, ${key_json}, ${old_json}, ${new_json}
					FROM audit_events WHERE source_key = (SELECT source_key FROM audit_write_context);
				END
			`);
		}
	}
}

export function instrument_audited_database(database: Database): Database {
	const audit_schema_ready = database.query<{ count: number }, []>(
		"SELECT COUNT(*) AS `count` FROM `sqlite_schema` WHERE `type` = 'table' " +
		"AND `name` IN ('audit_events', 'audit_row_changes')"
	).get()?.count === 2;
	if (!audit_schema_ready) return database;
	install_durable_audit_triggers(database);
	const direct_changes = database.query<{ changes: number }, []>('SELECT changes() AS `changes`');
	const set_context = database.query(
		'INSERT OR REPLACE INTO audit_write_context (rowid, occurred_at, event_type, actor_kind, actor_client_id, ' +
		'actor_display_name, guild_id, guild_name, command_id, source_key, installation_id, client_platform, ' +
		'app_distribution, app_channel, app_version, app_build, details_json) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
	);
	const sync_context = () => {
		const value = current();
		set_context.run(Date.now(), value.event_type, value.actor_kind, value.actor_client_id,
			value.actor_display_name, value.guild_id ?? null, value.guild_name ?? null, value.command_id ?? null,
			value.source_key, value.installation_id ?? null, value.client_platform ?? null,
			value.app_distribution ?? null, value.app_channel ?? null, value.app_version ?? null,
			value.app_build ?? null, JSON.stringify(value.details ?? {}));
	};
	const instrument_statement = <T extends object>(statement: T): T => new Proxy(statement, {
		get(target, property, receiver) {
			const member = Reflect.get(target, property, receiver);
			if (typeof member !== 'function') return member;
			return (...args: unknown[]) => {
				sync_context();
				const result = Reflect.apply(member, target, args);
				if (property !== 'run' || typeof result !== 'object' || result === null) return result;
				return { ...result, changes: direct_changes.get()?.changes ?? 0 };
			};
		}
	});
	return new Proxy(database, {
		get(target, property, receiver) {
			const member = Reflect.get(target, property, receiver);
			if (property === 'query' || property === 'prepare')
				return (...args: unknown[]) => instrument_statement(Reflect.apply(member, target, args) as object);
			if (property === 'run' || property === 'exec')
				return (...args: unknown[]) => {
					sync_context();
					const result = Reflect.apply(member, target, args);
					return property === 'run' && typeof result === 'object' && result !== null
						? { ...result, changes: direct_changes.get()?.changes ?? 0 } : result;
				};
			return typeof member === 'function' ? member.bind(target) : member;
		}
	}) as Database;
}
