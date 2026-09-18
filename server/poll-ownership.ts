import type { Database } from 'bun:sqlite';
import { db } from './db';

export function get_poll_owner_key(client_id: number, database: Database = db): string {
	const client = database.query<{ melvor_account_id: number | null }, [number]>(
		'SELECT `melvor_account_id` FROM `clients` WHERE `id` = ?'
	).get(client_id);
	if (client === null)
		throw new Error(`Poll owner Client ${client_id} is missing`);
	return client.melvor_account_id === null ? `client:${client_id}` : `account:${client.melvor_account_id}`;
}

export function reassign_poll_owner(source_owner_key: string, target_owner_key: string, database: Database = db): void {
	if (source_owner_key === target_owner_key)
		return;

	const single_polls = database.query<{ poll_id: number }, [string, string]>(
		"SELECT DISTINCT vote.`poll_id` FROM `poll_votes` AS vote JOIN `polls` AS poll ON poll.`id` = vote.`poll_id` " +
		"WHERE poll.`choice_mode` = 'single' AND vote.`owner_key` IN (?, ?)"
	).all(source_owner_key, target_owner_key);
	for (const { poll_id } of single_polls) {
		const winner = database.query<{
			poll_id: number;
			option_id: number;
			client_id: number;
			created_at: number;
		}, [number, string, string]>(
			'SELECT `poll_id`, `option_id`, `client_id`, `created_at` FROM `poll_votes` ' +
			'WHERE `poll_id` = ? AND `owner_key` IN (?, ?) ' +
			'ORDER BY `created_at` DESC, `client_id` DESC, `option_id` DESC LIMIT 1'
		).get(poll_id, source_owner_key, target_owner_key);
		database.query('DELETE FROM `poll_votes` WHERE `poll_id` = ? AND `owner_key` IN (?, ?)')
			.run(poll_id, source_owner_key, target_owner_key);
		if (winner !== null)
			database.query(
				'INSERT INTO `poll_votes` (`poll_id`, `option_id`, `owner_key`, `client_id`, `created_at`) ' +
				'VALUES (?, ?, ?, ?, ?)'
			).run(winner.poll_id, winner.option_id, target_owner_key, winner.client_id, winner.created_at);
	}

	const multi_votes = database.query<{
		poll_id: number;
		option_id: number;
		client_id: number;
		created_at: number;
	}, [string]>(
		'SELECT vote.`poll_id`, vote.`option_id`, vote.`client_id`, vote.`created_at` FROM `poll_votes` AS vote ' +
		"JOIN `polls` AS poll ON poll.`id` = vote.`poll_id` WHERE poll.`choice_mode` = 'multi' AND vote.`owner_key` = ?"
	).all(source_owner_key);
	for (const vote of multi_votes)
		database.query(
			'INSERT INTO `poll_votes` (`poll_id`, `option_id`, `owner_key`, `client_id`, `created_at`) VALUES (?, ?, ?, ?, ?) ' +
			'ON CONFLICT (`option_id`, `owner_key`) DO UPDATE SET `client_id` = excluded.`client_id`, ' +
			'`created_at` = excluded.`created_at` WHERE excluded.`created_at` > `poll_votes`.`created_at`'
		).run(vote.poll_id, vote.option_id, target_owner_key, vote.client_id, vote.created_at);
	database.query('DELETE FROM `poll_votes` WHERE `owner_key` = ?').run(source_owner_key);

	const interactions = database.query<{ poll_id: number; interacted_at: number }, [string]>(
		'SELECT `poll_id`, `interacted_at` FROM `poll_interactions` WHERE `owner_key` = ?'
	).all(source_owner_key);
	for (const interaction of interactions)
		database.query(
			'INSERT INTO `poll_interactions` (`poll_id`, `owner_key`, `interacted_at`) VALUES (?, ?, ?) ' +
			'ON CONFLICT (`poll_id`, `owner_key`) DO UPDATE SET `interacted_at` = ' +
			'MIN(`poll_interactions`.`interacted_at`, excluded.`interacted_at`)'
		).run(interaction.poll_id, target_owner_key, interaction.interacted_at);
	database.query('DELETE FROM `poll_interactions` WHERE `owner_key` = ?').run(source_owner_key);

	const throttles = database.query<{ poll_id: number; last_mutated_at: number }, [string]>(
		'SELECT `poll_id`, `last_mutated_at` FROM `poll_vote_throttles` WHERE `owner_key` = ?'
	).all(source_owner_key);
	for (const throttle of throttles)
		database.query(
			'INSERT INTO `poll_vote_throttles` (`poll_id`, `owner_key`, `last_mutated_at`) VALUES (?, ?, ?) ' +
			'ON CONFLICT (`poll_id`, `owner_key`) DO UPDATE SET `last_mutated_at` = ' +
			'MAX(`poll_vote_throttles`.`last_mutated_at`, excluded.`last_mutated_at`)'
		).run(throttle.poll_id, target_owner_key, throttle.last_mutated_at);
	database.query('DELETE FROM `poll_vote_throttles` WHERE `owner_key` = ?').run(source_owner_key);
}
