export type Migration = {
	version: number;
	sql: string;
	foreign_keys_disabled?: boolean;
};
