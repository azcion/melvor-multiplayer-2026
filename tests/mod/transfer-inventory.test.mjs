import assert from 'node:assert/strict';
import test from 'node:test';

import { take_returnable_transfer_entry } from '../../mod/transfer-inventory.mjs';

test('persists a selected return so reload cannot credit it twice', () => {
	let stored = JSON.stringify([{ id: 'melvorD:Logs', qty: 5 }, { id: 'melvorD:Fish', qty: 2 }]);
	let bank_logs = 10;

	const first = take_returnable_transfer_entry(JSON.parse(stored), 'melvorD:Logs');
	assert.notEqual(first, null);
	bank_logs += first.entry.qty;
	stored = JSON.stringify(first.inventory);

	const after_reload = take_returnable_transfer_entry(JSON.parse(stored), 'melvorD:Logs');
	assert.equal(after_reload, null);
	assert.equal(bank_logs, 15);
	assert.deepEqual(JSON.parse(stored), [{ id: 'melvorD:Fish', qty: 2 }]);
});

test('does not return a destroy-only entry to the bank', () => {
	assert.equal(take_returnable_transfer_entry([
		{ id: 'missing-mod:Item', qty: 1, destroyable: true }
	], 'missing-mod:Item'), null);
});
