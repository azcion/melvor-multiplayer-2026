import { compact_work_reply_batch } from './expedition-work-replies';

if (Bun.argv.slice(2).join(' ') !== '--apply')
	throw new Error('Usage: bun run compact-expedition-replies.ts --apply (create a verified backup first)');

const { db } = await import('./db');
db.run('PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA temp_store=FILE');

let after_row = 0;
let compacted = 0;
let saved_bytes = 0;
try {
	for (;;) {
		const batch = compact_work_reply_batch(db, after_row);
		after_row = batch.after_row;
		compacted += batch.compacted;
		saved_bytes += batch.saved_bytes;
		if (batch.scanned === 0) break;
		if (compacted > 0 && compacted % 1000 === 0)
			console.log(JSON.stringify({ compacted, saved_bytes }));
		// Release the write lock between bounded batches and yield to live traffic.
		await Bun.sleep(25);
	}
	console.log(JSON.stringify({ complete: true, compacted, saved_bytes }));
} finally {
	db.close();
}
