export const MINIMUM_SUPPORTED_VERSION_FEATURE = '1.5.10';

function parse_version(value: unknown): number[] | null {
	if (typeof value !== 'string')
		return null;
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
	if (match === null)
		return null;
	const parts = match.slice(1).map(Number);
	return parts.every(Number.isSafeInteger) ? parts : null;
}

function compare_versions(left: number[], right: number[]): number {
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index])
			return left[index]! - right[index]!;
	}
	return 0;
}

export function is_minimum_supported_version(value: unknown): value is string {
	const parsed = parse_version(value);
	const feature = parse_version(MINIMUM_SUPPORTED_VERSION_FEATURE)!;
	return parsed !== null && compare_versions(parsed, feature) >= 0;
}

export function is_client_version_unsupported(actual: unknown, minimum: unknown): boolean {
	const parsed_actual = parse_version(actual);
	const parsed_minimum = parse_version(minimum);
	const feature = parse_version(MINIMUM_SUPPORTED_VERSION_FEATURE)!;
	return parsed_actual !== null && parsed_minimum !== null &&
		compare_versions(parsed_actual, feature) >= 0 && compare_versions(parsed_actual, parsed_minimum) < 0;
}
