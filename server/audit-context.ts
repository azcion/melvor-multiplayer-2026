import type { Database } from 'bun:sqlite';

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

export function run_with_audit_context<T>(_context: DurableAuditContext, operation: () => T): T {
	return operation();
}

export function make_audit_context(input: Omit<DurableAuditContext, 'context_id' | 'source_key'> & {
	context_id?: string; source_key?: string;
}): DurableAuditContext {
	const context_id = input.context_id ?? crypto.randomUUID();
	return { ...input, context_id, source_key: input.source_key ?? `mutation:${context_id}` };
}

export function instrument_audited_database(database: Database): Database {
	const direct_changes = database.query<{ changes: number }, []>('SELECT changes() AS `changes`');
	const instrument_statement = <T extends object>(statement: T): T => new Proxy(statement, {
		get(target, property, receiver) {
			const member = Reflect.get(target, property, receiver);
			if (typeof member !== 'function') return member;
			return (...args: unknown[]) => {
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
			if (property === 'run')
				return (...args: unknown[]) => {
					const result = Reflect.apply(member, target, args);
					return typeof result === 'object' && result !== null
						? { ...result, changes: direct_changes.get()?.changes ?? 0 } : result;
				};
			return typeof member === 'function' ? member.bind(target) : member;
		}
	}) as Database;
}
