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
	}
];
