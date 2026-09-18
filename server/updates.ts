import { db } from './db';

export type UpdatesSection = {
	id: string;
	title: string;
	paragraphs: string[];
};

type UpdateSectionRow = {
	id: string;
	title: string;
	body: string;
};

function split_paragraphs(body: string): string[] {
	return body
		.split(/\n\s*\n+/)
		.map(paragraph => paragraph.trim())
		.filter(Boolean);
}

export function get_updates(language: string | null = null): { sections: UpdatesSection[] } {
	const localized = language === 'zh-CN';
	return {
		sections: (localized ? db.query<UpdateSectionRow, [string, string]>(
			'SELECT section.`id`, COALESCE(title_translation.`content`, section.`title`) AS `title`, ' +
			'COALESCE(body_translation.`content`, section.`body`) AS `body` FROM `update_sections` AS section ' +
			'LEFT JOIN `update_section_translations` AS title_translation ON title_translation.`section_id` = section.`id` ' +
			"AND title_translation.`field` = 'title' AND title_translation.`language` = ? " +
			"AND title_translation.`state` = 'complete' AND title_translation.`source_content` = section.`title` " +
			'LEFT JOIN `update_section_translations` AS body_translation ON body_translation.`section_id` = section.`id` ' +
			"AND body_translation.`field` = 'body' AND body_translation.`language` = ? " +
			"AND body_translation.`state` = 'complete' AND body_translation.`source_content` = section.`body` " +
			'ORDER BY section.`sort_order`, section.`id`'
		).all(language, language) : db.query<UpdateSectionRow, []>(
			'SELECT `id`, `title`, `body` FROM `update_sections` ORDER BY `sort_order`, `id`'
		).all()).map(section => ({
			id: section.id.trim(),
			title: section.title.trim(),
			paragraphs: split_paragraphs(section.body)
		})).filter(section => section.id.length > 0 && section.title.length > 0 && section.paragraphs.length > 0)
	};
}
