export const CHAT_HIGHLIGHT_PRESETS = Object.freeze([
	'#FF6B6B', '#FFAA33', '#FFD93D', '#6BCB77', '#4DDDDD', '#4D96FF', '#B983FF', '#FFFFFF'
]);

// The fixed # lives outside the input; accept a pasted # without duplicating it.
export function highlight_input(value) {
	return typeof value === 'string' ? value.trim().replace(/^#/, '').toUpperCase() : '';
}
export function highlight_color(value) {
	const hex = highlight_input(value);
	return /^[0-9A-F]{6}$/.test(hex) ? '#' + hex : null;
}
export function highlight_style(color, tagged = false) {
	const valid = highlight_color(color);
	return !tagged && valid ? { '--mp-chat-highlight': valid } : {};
}
