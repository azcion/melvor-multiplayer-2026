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

export function get_updates(): { sections: UpdatesSection[] } {
	return {
		sections: db.query<UpdateSectionRow, []>(
			'SELECT `id`, `title`, `body` FROM `update_sections` ORDER BY `sort_order`, `id`'
		).all().map(section => ({
			id: section.id.trim(),
			title: section.title.trim(),
			paragraphs: split_paragraphs(section.body)
		})).filter(section => section.id.length > 0 && section.title.length > 0 && section.paragraphs.length > 0)
	};
}
