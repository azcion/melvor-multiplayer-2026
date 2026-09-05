export type UpdatesSection = {
	id: string;
	title: string;
	paragraphs: string[];
};

const UPDATES_SECTIONS: UpdatesSection[] = [
	{
		id: 'dev-message',
		title: 'Dev note',
		paragraphs: [
			"It's a tree - it's gonna have leaves. 🍃"
		]
	},
	{
		id: 'working-on',
		title: 'In development',
		paragraphs: [
			"Many of you have sent us some fun suggestions for things to add. Now that 1.5 is out of the way, we can finally start shifting our focus toward some of those ideas and getting more new stuff into the mod."
		]
	},
	{
		id: 'future-update',
		title: 'On the roadmap',
		paragraphs: [
			"We're also planning a replacement for the current Raid preview, along with a complete rework of Campaigns."
		]
	}
];

export function get_updates(): { sections: UpdatesSection[] } {
	return {
		sections: UPDATES_SECTIONS.map(section => ({
			...section,
			paragraphs: [...section.paragraphs]
		}))
	};
}
