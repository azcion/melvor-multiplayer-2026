// Capture clocks may have any fixed offset. Only elapsed durations limit work credit.
export const EXPEDITION_BOUNDARY_TOLERANCE_MS = 30_000;
export const EXPEDITION_FRESH_CAPTURE_MS = 120_000;

export function expedition_capture_time(reported_at: number, received_at: number,
	segment: { started_at: number; start_clock_offset_ms: number | null } | null): number {
	if (!segment) return received_at;
	const reported_elapsed = Math.max(0, reported_at - segment.started_at - (segment.start_clock_offset_ms ?? 0));
	const server_elapsed = Math.max(0, received_at - segment.started_at);
	return segment.started_at + Math.min(server_elapsed, reported_elapsed);
}
