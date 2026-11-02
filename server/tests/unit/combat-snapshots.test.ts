import { expect, test } from 'bun:test';
import { create_snapshot_stream } from '../../combat/snapshots';
import { create_run, step_run, run_command } from '../../combat/runs';

// Independent reference application verifies the wire representation against the authoritative engine.
function apply(arena: any, changes: any[]) {
	const result = structuredClone(arena);
	for (const [path, ...value] of changes) {
		let target = result;
		for (const key of path.slice(0, -1)) target = target[key];
		if (value.length) target[path.at(-1)] = value[0]; else delete target[path.at(-1)];
	}
	return result;
}
test('delta stream exactly reproduces attacks, stance, food, multi-enemy waves and terminal state', () => {
	for (const encounter of ['golbin', 'plants', 'golbins'] as const) {
		const arena = create_run({ levels: { attack:99,strength:99,defence:99,hitpoints:99 }, gear:{} }, { heal:30 }, 'test', encounter, encounter === 'golbin' ? 'repeat' : 'playlist');
		const stream = create_snapshot_stream(); let rebuilt: any = null, bytes = 0, full_bytes = 0, full = 0;
		for (let tick = 0; tick < 900; tick++) {
			step_run(arena, () => 0.5);
			if (tick === 80) run_command(arena, 'stance', 'defensive');
			if (tick === 100) { arena.player.hp = 10; run_command(arena, 'eat', null); }
			if (tick === 898) run_command(arena, 'flee', null);
			if (tick % 2) continue;
			const message = JSON.parse(JSON.stringify(stream.next(arena, tick * 100)));
			if (message.type === 'state') { rebuilt = message.arena; full++; } else rebuilt = apply(rebuilt, message.changes);
			expect(rebuilt).toEqual(JSON.parse(JSON.stringify(arena)));
			bytes += JSON.stringify(message).length;
			full_bytes += JSON.stringify({ type:'state',arena }).length;
		}
		expect(full).toBe(18);
		expect(bytes).toBeLessThan(full_bytes * 0.4);
		expect(rebuilt.status).toBe('fled');
		console.log(`combat transport ${encounter}: ${bytes}/${full_bytes} JSON bytes (${Math.round(100 * bytes / full_bytes)}%)`);
	}
});
test('new runs and null states use keyframes', () => {
	const stream = create_snapshot_stream();
	expect(stream.next(null, 0)).toEqual({ type:'state',seq:1,arena:null });
});
