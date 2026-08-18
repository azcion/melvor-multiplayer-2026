export function take_returnable_transfer_entry(inventory, selected_id) {
	const entry = inventory.find(item => item.id === selected_id);
	if (entry === undefined || entry.destroyable === true)
		return null;
	return {
		entry: { ...entry },
		inventory: inventory.filter(item => item.id !== selected_id)
	};
}
