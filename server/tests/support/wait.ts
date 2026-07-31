export async function wait_for<T>(
	read: () => Promise<T>,
	accept: (value: T) => boolean,
	timeout_ms = 3000
): Promise<T> {
	const deadline = Date.now() + timeout_ms;
	let value = await read();

	while (!accept(value) && Date.now() < deadline) {
		await Bun.sleep(25);
		value = await read();
	}

	if (!accept(value))
		throw new Error(`Condition was not met within ${timeout_ms}ms: ${JSON.stringify(value)}`);

	return value;
}
