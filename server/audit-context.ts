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
	save_load_id?: number | null;
	details?: Record<string, string | number | boolean | null>;
};

const audit_context = new AsyncLocalStorage<DurableAuditContext>();
export function current_audit_context(): DurableAuditContext | undefined { return audit_context.getStore(); }
export function run_with_audit_context<T>(context: DurableAuditContext, operation: () => T): T {
	return audit_context.run(context, operation);
}

export function make_audit_context(input: Omit<DurableAuditContext, 'context_id' | 'source_key'> & {
	context_id?: string; source_key?: string;
}): DurableAuditContext {
	const context_id = input.context_id ?? crypto.randomUUID();
	return { ...input, context_id, source_key: input.source_key ?? `mutation:${context_id}` };
}

let database_write_guard: ((database:Database,context:DurableAuditContext|undefined)=>void) | undefined;
export function install_database_write_guard(guard:typeof database_write_guard):void {database_write_guard=guard;}

export function instrument_audited_database(database: Database): Database {
	// The guard and individual unwrapped writes share an IMMEDIATE lock. Domain transactions
	// already hold that lock, so a host decision cannot land between their check and mutation.
	const guarded = <T>(sql:unknown,operation:()=>T):T => {
		if(!database_write_guard || typeof sql!=='string' || !/^\s*(?:INSERT|UPDATE|DELETE|REPLACE|WITH)\b/i.test(sql)) return operation();
		const execute=()=>{database_write_guard!(database,current_audit_context());return operation();};
		return database.inTransaction ? execute() : database.transaction(execute).immediate();
	};
	const direct_changes = database.query<{ changes: number }, []>('SELECT changes() AS `changes`');
	const instrument_statement = <T extends object>(statement: T, sql:unknown): T => new Proxy(statement, {
		get(target, property, receiver) {
			const member = Reflect.get(target, property, receiver);
			if (typeof member !== 'function') return member;
			return (...args: unknown[]) => {
				const result = guarded(sql,()=>Reflect.apply(member, target, args));
				if (property !== 'run' || typeof result !== 'object' || result === null) return result;
				return { ...result, changes: direct_changes.get()?.changes ?? 0 };
			};
		}
	});
	return new Proxy(database, {
		get(target, property, receiver) {
			const member = Reflect.get(target, property, receiver);
			if (property === 'query' || property === 'prepare')
				return (...args: unknown[]) => instrument_statement(Reflect.apply(member, target, args) as object,args[0]);
			if (property === 'run')
				return (...args: unknown[]) => {
					const result = guarded(args[0],()=>Reflect.apply(member, target, args));
					return typeof result === 'object' && result !== null
						? { ...result, changes: direct_changes.get()?.changes ?? 0 } : result;
				};
			return typeof member === 'function' ? member.bind(target) : member;
		}
	}) as Database;
}
