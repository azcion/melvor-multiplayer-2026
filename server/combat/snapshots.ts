import type { Arena } from './engine';

type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
export type Change = [string[], Value] | [string[]];
const container = (value: Value): value is Value[] | { [key: string]: Value } => value !== null && typeof value === 'object';
// Exact path replacements preserve nulls. Equal-length arrays recurse; changed-length arrays replace atomically.
function difference(previous: Value, next: Value, path: string[] = [], changes: Change[] = []): Change[] {
	if (previous === next) return changes;
	if (container(previous) && container(next) && Array.isArray(previous) === Array.isArray(next) &&
		(!Array.isArray(next) || previous.length === next.length)) {
		const before = previous as Record<string, Value>, after = next as Record<string, Value>;
		for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) changes.push([[...path, key]]);
		for (const [key, value] of Object.entries(after)) {
			if (!Object.hasOwn(before, key)) changes.push([[...path, key], value]);
			else difference(before[key], value, [...path, key], changes);
		}
	} else changes.push([path, next]);
	return changes;
}

export function create_snapshot_stream() {
	let previous: Arena | null = null, sequence = 0, keyframe_at = 0;
	return {
		next(arena: Arena | null, now: number) {
			const seq = ++sequence;
			const keyframe = !previous || !arena || previous.id !== arena.id || now - keyframe_at >= 5000;
			const message = keyframe ? { type: 'state', seq, arena } : {
				type: 'state_delta', seq, base: seq - 1, id: arena.id,
				changes: difference(previous as unknown as Value, arena as unknown as Value)
			};
			if (keyframe) keyframe_at = now;
			previous = arena === null ? null : structuredClone(arena);
			return message;
		}
	};
}
