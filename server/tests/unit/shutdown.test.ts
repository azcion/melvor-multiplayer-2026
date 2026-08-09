import { describe, expect, test } from 'bun:test';
import { create_shutdown_handler } from '../../shutdown';

describe('graceful server shutdown', () => {
	test('stops once, flushes buffered work, and exits in order', async () => {
		const calls: string[] = [];
		const shutdown = create_shutdown_handler(
			async () => { calls.push('stop'); },
			async () => { calls.push('flush'); },
			() => { calls.push('exit'); }
		);

		const first = shutdown();
		const second = shutdown();
		await Promise.all([first, second]);

		expect(first).toBe(second);
		expect(calls).toEqual(['stop', 'flush', 'exit']);
	});

	test('still flushes and exits when stopping fails', async () => {
		const calls: string[] = [];
		const shutdown = create_shutdown_handler(
			async () => {
				calls.push('stop');
				throw new Error('stop failed');
			},
			async () => { calls.push('flush'); },
			() => { calls.push('exit'); }
		);

		await expect(shutdown()).rejects.toThrow('stop failed');
		expect(calls).toEqual(['stop', 'flush', 'exit']);
	});
});
