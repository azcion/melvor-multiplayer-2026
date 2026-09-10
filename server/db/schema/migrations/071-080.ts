import type { Migration } from '../types';

export const migrations_071_080: Migration[] = [
	{
		version: 71,
		sql: `
			UPDATE \`market_items\`
			SET \`published_at\` = COALESCE(
				(
					SELECT MIN(COALESCE(candidate.\`updated_at\`, candidate.\`published_at\`))
					FROM \`market_items\` AS candidate
					WHERE COALESCE(candidate.\`updated_at\`, candidate.\`published_at\`) >
						CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 1209600000
				),
				CAST(strftime('%s', 'now') AS INTEGER) * 1000
			)
			WHERE \`published_at\` = 0 AND \`updated_at\` IS NULL;
		`
	},
	{
		version: 72,
		sql: `
			CREATE TABLE charity_wishes (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild_id INTEGER NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
				owner_client_id INTEGER NOT NULL REFERENCES clients (id),
				melvor_account_id INTEGER NOT NULL REFERENCES melvor_accounts (id),
				item_id TEXT NOT NULL,
				qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 100),
				required_gp INTEGER NOT NULL CHECK (required_gp > 0),
				progress_gp INTEGER NOT NULL DEFAULT 0 CHECK (progress_gp >= 0 AND progress_gp <= required_gp),
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				matures_at INTEGER NOT NULL CHECK (matures_at >= created_at),
				UNIQUE (melvor_account_id)
			);
			CREATE INDEX idx_charity_wishes_guild_phase
				ON charity_wishes (guild_id, matures_at, progress_gp, required_gp, id);

			CREATE TABLE charity_wish_commands (
				id TEXT PRIMARY KEY,
				client_id INTEGER NOT NULL REFERENCES clients (id),
				kind TEXT NOT NULL CHECK (kind IN ('make', 'forsake', 'pick')),
				response_json TEXT NOT NULL,
				created_at INTEGER NOT NULL CHECK (created_at >= 0)
			);

			CREATE TABLE guild_petition_charity_wishes (
				petition_id INTEGER NOT NULL REFERENCES guild_petitions (id) ON DELETE CASCADE,
				wish_id INTEGER NOT NULL REFERENCES charity_wishes (id) ON DELETE CASCADE,
				PRIMARY KEY (petition_id, wish_id)
			);
		`
	}
];
