import { fallback_feature_name, badge_feature } from '../../mod/chat-items.mjs';
import { readable_item } from './transport.mjs';
export const kind_labels = { global: 'Global', guild: 'Guild', alliance: 'Alliance', private: 'Private', support: 'Support', testers: 'Expedition' };
export function node(document, tag, text, class_name) {
	const element = document.createElement(tag);
	if (text !== undefined) element.textContent = String(text);
	if (class_name) element.className = class_name;
	return element;
}
// Paths verified against the game sidebar and mod/data.json. Unknown IDs stay text-only.
const feature_images = { Shop: 'main/shop_header.png', Bank: 'main/bank_header.png', Combat: 'main/combat_header.png',
	Chat: 'bank/message_in_a_bottle.png', Updates: 'main/announcement.png' };
const mod_images = { Guild: 'multiplayer.svg', Transfer_Items: 'transfer_bag.svg', Multiplayer_Market: 'market.svg',
	Crucible: 'crucible.png', Expedition: 'expedition-nav.png', Guild_Raid: 'raid-nav.png' };
const skills = new Set('Attack Strength Defence Hitpoints Ranged Magic Prayer Slayer Corruption Farming Township Woodcutting Fishing Firemaking Cooking Mining Smithing Thieving Fletching Crafting Runecrafting Herblore Agility Summoning Astrology Cartography Archaeology Harvesting'.split(' '));
export function feature_image(id) {
	const [namespace, key] = String(id).split(':');
	if (namespace === 'multiplayer' && Object.hasOwn(mod_images,key)) return `/chat/assets/${mod_images[key]}`;
	if (!['multiplayer','melvorD','melvorF','melvorAoD','melvorItA'].includes(namespace)) return null;
	const skill = key === 'AltMagic' ? 'Magic' : key;
	const path = feature_images[key] ?? (skills.has(skill) ? `skills/${skill.toLowerCase()}/${skill.toLowerCase()}.png` : null);
	return path ? `https://cdn2-main.melvor.net/assets/media/${path}` : null;
}
export function media_node(document, url, class_name = '') {
	if (!safe_media(url) && !Object.values(mod_images).some(file => url === `/chat/assets/${file}`)) return null;
	const image = node(document,'img',undefined,class_name); image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.src = url;
	image.addEventListener('error', () => image.remove(), { once:true }); return image;
}
export function avatar_node(document, id, catalog = [], class_name = 'message-avatar') {
	return media_node(document,catalog.find(item => item.id === id)?.media,class_name);
}
export function conversation_label(c) {
	return c.conversation_kind === 'alliance' ? 'Alliance' : c.participant?.display_name ?? kind_labels[c.conversation_kind ?? 'private'] ?? 'Chat';
}
export function conversation_image(document,c,catalog = []) {
	if (['global','guild','alliance'].includes(c.conversation_kind)) return media_node(document,feature_image('multiplayer:Guild'));
	if (c.conversation_kind === 'testers') return media_node(document,feature_image('multiplayer:Expedition'));
	return avatar_node(document,c.participant?.icon_id,catalog,'');
}
export function safe_media(url) {
	return typeof url === 'string' && /^https:\/\/cdn2-main\.melvor\.net\/assets\/media\/[A-Za-z0-9_./=-]+$/.test(url) && !url.includes('..');
}
export function presentation(message, locale, original = false) {
	const translated = !original && typeof message.translations?.[locale] === 'string';
	return { parts: translated ? message.translation_parts?.[locale] : message.parts,
		text: translated ? message.translations[locale] : message.content,
		status: translated ? `Translated · ${locale}` : original ? 'Original' :
			['queued', 'processing'].includes(message.translation_status) ? 'Translation pending · showing original' :
			message.translation_status === 'failed' ? 'Translation unavailable · showing original' : 'Original' };
}
export function render_parts(document, target, parts, text, items = [], person, avatars = []) {
	if (!Array.isArray(parts) || !parts.length) { target.append(node(document, 'span', text ?? '')); return; }
	for (const part of parts) {
		if (part.type === 'text') target.append(node(document, 'span', part.text ?? ''));
		else if (part.type === 'item') {
			const item = readable_item(String(part.item_id), items), chip = node(document, 'span', undefined, 'tag');
			if (safe_media(item.media)) {
				const image = node(document,'img'); image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.src = item.media;
				image.addEventListener('error', () => image.remove(), { once: true }); chip.append(image);
			}
			chip.title = item.id; chip.append(node(document, 'span', item.name)); target.append(chip);
		} else if (part.type === 'person') {
			const chip = node(document, person ? 'button' : 'span', undefined, 'tag person');
			const avatar = avatar_node(document,part.icon_id,avatars); if (avatar) chip.append(avatar);
			chip.append(node(document,'span',part.display_name ?? 'Character'));
			if (person) { chip.type = 'button'; chip.addEventListener('click', () => person(part.client_id)); }
			target.append(chip);
		} else if (part.type === 'feature') {
			const id = String(part.feature_id), badge = badge_feature(id);
			const chip = node(document,'span',undefined,badge ? `badge ${badge.class_name}` : 'tag feature');
			const icon = !badge && media_node(document,feature_image(id)); if (icon) chip.append(icon);
			chip.append(node(document,'span',fallback_feature_name(id))); target.append(chip);
		} else target.append(node(document,'span', '[Unsupported tag]'));
	}
}
