export const SERVER_OWNED_PETS_MIN_VERSION = '1.5.3';

export function is_server_owned_pets_client(mod_version: string | null | undefined): boolean {
	const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(mod_version ?? '');
	if (parts === null)
		return false;

	const [major, minor, patch] = parts.slice(1).map(Number);
	const [minimum_major, minimum_minor, minimum_patch] = SERVER_OWNED_PETS_MIN_VERSION.split('.').map(Number);
	return major > minimum_major ||
		(major === minimum_major && (minor > minimum_minor ||
			(minor === minimum_minor && patch >= minimum_patch)));
}
