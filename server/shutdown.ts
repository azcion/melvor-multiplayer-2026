type AsyncOperation = () => void | Promise<void>;

export function create_shutdown_handler(
	stop_server: AsyncOperation,
	flush_pending: AsyncOperation,
	exit_process: () => void
): () => Promise<void> {
	let shutdown: Promise<void> | null = null;

	return () => {
		shutdown ??= (async () => {
			try {
				await stop_server();
			} finally {
				try {
					await flush_pending();
				} finally {
					exit_process();
				}
			}
		})();
		return shutdown;
	};
}
