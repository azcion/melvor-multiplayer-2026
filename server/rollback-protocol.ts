/** Wire capability is independent of release version (1.6.10-B does not implement it). */
export const SAVE_ROLLBACK_CAPABILITY = 'save-rollback-v1';

export function parse_protocol_capabilities(value: unknown): string[] | null {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > 32) return null;
	if (!value.every(entry => typeof entry === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(entry))) return null;
	// Unknown capabilities are forward compatible; persist only understood protocol promises.
	return value.includes(SAVE_ROLLBACK_CAPABILITY) ? [SAVE_ROLLBACK_CAPABILITY] : [];
}
