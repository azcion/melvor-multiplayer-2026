import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { AVAILABLE_CAMPAIGNS } from '../../campaign_data';
import { migrations } from '../../db/schema';
import { get_campaign_item_gp_value, get_campaign_item_gp_values } from '../../campaign_item_values';
import { is_server_owned_pets_client } from '../../pet-compatibility';
import { get_charity_pet_chance } from '../../pets';

test('enables server-owned pets only for exact 1.5.3-or-newer semantic versions', () => {
	expect(is_server_owned_pets_client('1.5.2')).toBe(false);
	expect(is_server_owned_pets_client('1.5.3')).toBe(true);
	expect(is_server_owned_pets_client('1.6.0')).toBe(true);
	expect(is_server_owned_pets_client('2.0.0')).toBe(true);
	expect(is_server_owned_pets_client('development')).toBe(false);
	expect(is_server_owned_pets_client('1.5')).toBe(false);
	expect(is_server_owned_pets_client(null)).toBe(false);
});

test('defines a fixed GP value for every campaign item, including zero-valued items', () => {
	const values = get_campaign_item_gp_values();
	const items = AVAILABLE_CAMPAIGNS.flatMap(campaign => campaign.items);

	expect(items.every(item => get_campaign_item_gp_value(item.id) !== null)).toBe(true);
	expect(get_campaign_item_gp_value('melvorD:Topaz')).toBe(225);
	expect(get_campaign_item_gp_value('melvorD:Rune_Essence')).toBe(0);
	expect(get_campaign_item_gp_value('missing:item')).toBeNull();
	expect(Object.keys(values).length).toBe(items.length);
});

test('calculates the Charitree pet chance on the server', () => {
	expect(get_charity_pet_chance(0)).toBe(0.001);
	expect(get_charity_pet_chance(9_999_999)).toBe(0.001);
	expect(get_charity_pet_chance(10_000_000)).toBe(0.011);
	expect(get_charity_pet_chance(90_000_000)).toBe(0.091);
	expect(get_charity_pet_chance(100_000_000)).toBe(0.1);
	expect(get_charity_pet_chance(Number.POSITIVE_INFINITY)).toBe(0.001);
});

test('backfills campaign pet ownership at four completions and leaves Charitree ownership reset', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations.filter(entry => entry.version < 58)) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
	database.run('PRAGMA foreign_keys = ON');
	database.run(
		"INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id) " +
		"VALUES (1, 'pets-client', 'key', '111-111-111', 'Pets Client', 'melvorD:Plant')"
	);
	for (let state_id = 1; state_id <= 4; state_id++) {
		database.run(
			"INSERT INTO campaign_completions " +
			"(source_campaign_state_id, source_guild_id, client_id, campaign_id, item_id, item_amount, taken, created_at) " +
			"VALUES (?, 1, 1, 'campaign_desert', 'melvorD:Topaz', 1, 0, ?)",
			[state_id, state_id * 1000]
		);
	}
	database.run(
		"INSERT INTO campaign_completions " +
		"(source_campaign_state_id, source_guild_id, client_id, campaign_id, item_id, item_amount, taken, created_at) " +
		"VALUES (5, 1, 1, 'campaign_jungle', 'melvorD:Normal_Logs', 1, 0, 5000)"
	);

	const migration = migrations.find(entry => entry.version === 58);
	expect(migration).toBeDefined();
	database.transaction(() => database.run(migration?.sql ?? '')).immediate();

	expect(database.query(
		'SELECT client_id, pet_id, created_at, updated_at FROM multiplayer_pet_ownership'
	).all()).toEqual([{
		client_id: 1,
		pet_id: 'Multiplayer_Pet_Campaign_Desert',
		created_at: 1000,
		updated_at: 4000
	}]);
	database.close();
});
