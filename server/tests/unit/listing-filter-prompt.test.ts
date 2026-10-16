import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { acknowledge_listing_filter_prompt, listing_filter_prompt_pending } from '../../listing-filters';

test('prompt views cover linked and future characters and survive later account association', () => {
	const db = create_test_database();
	try {
		db.run("INSERT INTO melvor_accounts(id, cloud_username, playfab_id, created_at) VALUES(1, 'Account', 'account', 1)");
		const add_client = (id: number, account: number | null) => db.query(`INSERT INTO clients
			(id, client_identifier, client_key, friend_code, display_name, icon_id, melvor_account_id)
			VALUES (?, ?, ?, ?, 'Prompt Player', 'melvorD:Plant', ?)`).run(id, `client-${id}`, `key-${id}`, `code-${id}`, account);
		add_client(1, 1); add_client(2, 1); add_client(3, null); add_client(4, null);
		expect(listing_filter_prompt_pending(db, 1)).toBe(true);
		expect(listing_filter_prompt_pending(db, 2)).toBe(true);
		acknowledge_listing_filter_prompt(db, 1);
		acknowledge_listing_filter_prompt(db, 1);
		expect(db.query('SELECT COUNT(*) AS count FROM listing_filter_prompt_views').get()).toEqual({ count: 1 });
		expect(listing_filter_prompt_pending(db, 1)).toBe(false);
		expect(listing_filter_prompt_pending(db, 2)).toBe(false);
		add_client(5, 1);
		expect(listing_filter_prompt_pending(db, 5)).toBe(false);
		expect(listing_filter_prompt_pending(db, 3)).toBe(true);
		acknowledge_listing_filter_prompt(db, 3);
		expect(listing_filter_prompt_pending(db, 4)).toBe(true);
		db.run("INSERT INTO melvor_accounts(id, cloud_username, playfab_id, created_at) VALUES(2, 'Later', 'later', 1)");
		db.run('UPDATE clients SET melvor_account_id=2 WHERE id IN (3,4)');
		expect(listing_filter_prompt_pending(db, 4)).toBe(false);
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { db.close(); }
});
