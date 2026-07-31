export async function open_transfer_page({
	refresh_events,
	refresh_guild,
	update_contents,
	navigate
}) {
	try {
		await Promise.all([refresh_events(), refresh_guild()]);
		await update_contents();
	} finally {
		navigate();
	}
}
