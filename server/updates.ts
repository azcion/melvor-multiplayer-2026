export type UpdatesSection = {
	id: string;
	title: string;
	paragraphs: string[];
};

const UPDATES_SECTIONS: UpdatesSection[] = [
	{
		id: 'dev-message',
		title: 'Message from the devs',
		paragraphs: [
			'There are no situational notices right now. This space will be used for important announcements from the development team.'
		]
	},
	{
		id: 'working-on',
		title: "What we're working on",
		paragraphs: [
			"We're continuing to improve the Multiplayer experience. This space will highlight the features and improvements currently in progress."
		]
	},
	{
		id: 'future-update',
		title: 'Coming in a future update',
		paragraphs: [
			"We're planning a replacement for the current Raid preview feature, along with a complete overhaul of the Campaign."
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
