import { readFileSync } from 'node:fs';

export const EXPEDITION_BASE_SKILLS = new Set([
	'melvorD:Woodcutting', 'melvorD:Fishing', 'melvorD:Firemaking', 'melvorD:Cooking',
	'melvorD:Mining', 'melvorD:Smithing', 'melvorD:Thieving', 'melvorD:Fletching',
	'melvorD:Crafting', 'melvorD:Runecrafting', 'melvorD:Herblore', 'melvorD:Agility',
	'melvorD:Summoning', 'melvorD:Astrology', 'melvorD:AltMagic', 'melvorD:Combat'
]);
export const EXPEDITION_DLC_SKILLS = new Set([
	'melvorAoD:Archaeology', 'melvorAoD:Cartography', 'melvorItA:Harvesting'
]);
export const EXPEDITION_WORK_SKILLS = new Set([...EXPEDITION_BASE_SKILLS, ...EXPEDITION_DLC_SKILLS]);

export type ExpeditionTask = {
	id: string;
	title: string;
	phase: 'arrival' | 'exploration' | 'departure';
	kind: 'chart' | 'scout' | 'work' | 'discovery' | 'exit_preparation' | 'completion';
	requirement: 'required' | 'optional' | 'conditional';
	depends_on: string[];
	baseline_hours: number;
	evidence: { type: 'skill_time'; skill_ids: string[] };
	discovery_target?: string;
	exit_id?: string;
};

export type ExpeditionChamber = {
	id: string;
	label: string;
	depth: number;
	type: 'start' | 'chamber' | 'ending';
	theme: string;
	exits: { id: string; slot: number; target: string }[];
	tasks: ExpeditionTask[];
};

export type ExpeditionContent = {
	version: number;
	status: 'authored_placeholder';
	chambers: ExpeditionChamber[];
	preview_route?: Record<string, string>;
};

const content_id = /^[a-z][a-z0-9_]*$/;

export function preview_task_available(content: ExpeditionContent, chamber: ExpeditionChamber,
	task: ExpeditionTask): boolean {
	const preview_exit_id = content.preview_route?.[chamber.id];
	if (!preview_exit_id) return true;
	return (!task.discovery_target || task.discovery_target === preview_exit_id) &&
		(!task.exit_id || task.exit_id === preview_exit_id);
}

export function validate_expedition_content(content: ExpeditionContent): void {
	function fail(message: string): never { throw new Error(`Invalid Expedition content: ${message}`); }
	if (!Number.isSafeInteger(content.version) || content.version < 1 || content.status !== 'authored_placeholder')
		fail('invalid version or status');
	const chambers = new Map<string, ExpeditionChamber>();
	for (const chamber of content.chambers) {
		if (!content_id.test(chamber.id) || chambers.has(chamber.id)) fail(`duplicate or invalid Chamber ${chamber.id}`);
		if (!chamber.label || !chamber.theme || !Number.isSafeInteger(chamber.depth) || chamber.depth < 0)
			fail(`invalid Chamber metadata ${chamber.id}`);
		if (!['start', 'chamber', 'ending'].includes(chamber.type)) fail(`invalid Chamber type ${chamber.id}`);
		chambers.set(chamber.id, chamber);
	}
	const starts = content.chambers.filter(chamber => chamber.type === 'start');
	const endings = content.chambers.filter(chamber => chamber.type === 'ending');
	if (starts.length !== 1 || starts[0].id !== 'entrance' || starts[0].depth !== 0 || endings.length === 0)
		fail('expected one Entrance and at least one ending');
	const edge_ids = new Set<string>();
	for (const chamber of content.chambers) {
		if (chamber.type === 'ending' ? chamber.exits.length !== 0 : chamber.exits.length < 1 || chamber.exits.length > 3)
			fail(`invalid exit count at ${chamber.id}`);
		const tasks = new Map<string, ExpeditionTask>();
		for (const [index, edge] of chamber.exits.entries()) {
			if (edge.slot !== index + 1 || edge.id !== `${chamber.id}:exit_${edge.slot}` || edge_ids.has(edge.id))
				fail(`invalid exit slot at ${chamber.id}`);
			edge_ids.add(edge.id);
			const target = chambers.get(edge.target);
			if (!target || target.depth <= chamber.depth) fail(`dangling or non-increasing exit ${edge.id}`);
		}
		for (const task of chamber.tasks) {
			if (!content_id.test(task.id) || tasks.has(task.id) || !task.title)
				fail(`duplicate or invalid task at ${chamber.id}`);
			if (!['arrival', 'exploration', 'departure'].includes(task.phase) ||
				!['chart', 'scout', 'work', 'discovery', 'exit_preparation', 'completion'].includes(task.kind) ||
				!['required', 'optional', 'conditional'].includes(task.requirement))
				fail(`invalid task contract at ${chamber.id}/${task.id}`);
			if (!Number.isSafeInteger(task.baseline_hours) || task.baseline_hours < 1 || task.baseline_hours > 200)
				fail(`invalid baseline at ${chamber.id}/${task.id}`);
			if (task.evidence.type !== 'skill_time' || task.evidence.skill_ids.length === 0 ||
				task.evidence.skill_ids.some(skill => !EXPEDITION_WORK_SKILLS.has(skill)))
				fail(`non-official or passive evidence at ${chamber.id}/${task.id}`);
			tasks.set(task.id, task);
		}
		const chart = tasks.get('arrival_chart');
		const scout = tasks.get('arrival_scout');
		if (chart?.kind !== 'chart' || scout?.kind !== 'scout' || chart.phase !== 'arrival' || scout.phase !== 'arrival' ||
			chart.requirement !== 'required' || scout.requirement !== 'required')
			fail(`missing Chart/Scout variants at ${chamber.id}`);
		const visiting = new Set<string>();
		const visited = new Set<string>();
		function visit(task_id: string): void {
			if (visiting.has(task_id)) fail(`cyclic dependency at ${chamber.id}/${task_id}`);
			if (visited.has(task_id)) return;
			const task = tasks.get(task_id);
			if (!task) fail(`dangling dependency at ${chamber.id}/${task_id}`);
			visiting.add(task_id);
			for (const dependency of task.depends_on) {
				if (dependency === 'arrival') {
					if (task.phase === 'arrival') fail(`arrival depends on itself at ${chamber.id}/${task_id}`);
					continue;
				}
				const prerequisite = tasks.get(dependency);
				if (!prerequisite || prerequisite.kind === 'scout' || prerequisite.kind === 'chart')
					fail(`invalid dependency at ${chamber.id}/${task_id}`);
				const phase_order = { arrival: 0, exploration: 1, departure: 2 };
				if (phase_order[prerequisite.phase] > phase_order[task.phase])
					fail(`backward phase dependency at ${chamber.id}/${task_id}`);
				visit(dependency);
			}
			visiting.delete(task_id);
			visited.add(task_id);
		}
		for (const task of chamber.tasks) visit(task.id);
		const needs_base = new Set<string>();
		function require_base(task_id: string): void {
			if (needs_base.has(task_id)) return;
			needs_base.add(task_id);
			for (const dependency of tasks.get(task_id)!.depends_on)
				if (dependency !== 'arrival') require_base(dependency);
		}
		for (const task of chamber.tasks)
			if (task.requirement !== 'optional' || task.kind === 'discovery' || task.kind === 'exit_preparation')
				require_base(task.id);
		for (const task_id of needs_base)
			if (!tasks.get(task_id)!.evidence.skill_ids.some(skill => EXPEDITION_BASE_SKILLS.has(skill)))
				fail(`missing base-game evidence at ${chamber.id}/${task_id}`);
		for (const edge of chamber.exits) {
			if (content.preview_route?.[chamber.id] && content.preview_route[chamber.id] !== edge.id) continue;
			const reveal = chamber.tasks.filter(task => task.discovery_target === edge.id);
			const prepare = chamber.tasks.filter(task => task.exit_id === edge.id);
			if (reveal.length !== 1 || reveal[0].kind !== 'discovery' ||
				prepare.length !== 1 || prepare[0].kind !== 'exit_preparation' ||
				prepare[0].phase !== 'departure' || prepare[0].depends_on.length !== 1 ||
				prepare[0].depends_on[0] !== reveal[0].id)
				fail(`exit lacks discovery or preparation at ${edge.id}`);
		}
		for (const task of chamber.tasks) {
			if (task.discovery_target && !chamber.exits.some(edge => edge.id === task.discovery_target))
				fail(`dangling discovery at ${chamber.id}/${task.id}`);
			if (task.exit_id && !chamber.exits.some(edge => edge.id === task.exit_id))
				fail(`dangling preparation at ${chamber.id}/${task.id}`);
			if (task.kind === 'exit_preparation' && task.requirement !== 'conditional')
				fail(`exit preparation requirement at ${chamber.id}/${task.id}`);
		}
		if (chamber.type === 'ending' && !chamber.tasks.some(task =>
			task.kind === 'completion' && task.phase === 'departure' && task.requirement === 'required'))
			fail(`ending lacks completion work at ${chamber.id}`);
	}
	const reachable = new Set<string>();
	function walk(id: string): void {
		if (reachable.has(id)) return;
		reachable.add(id);
		for (const edge of chambers.get(id)!.exits) walk(edge.target);
	}
	walk('entrance');
	if (reachable.size !== chambers.size) fail('unreachable Chamber or ending');
	const reaches_ending = new Set(endings.map(chamber => chamber.id));
	for (const chamber of [...content.chambers].sort((a, b) => b.depth - a.depth))
		if (chamber.exits.some(edge => reaches_ending.has(edge.target))) reaches_ending.add(chamber.id);
	if (reaches_ending.size !== chambers.size) fail('Chamber has no route to an ending');
	if (content.preview_route) {
		const visited = new Set<string>();
		let chamber = starts[0];
		while (chamber.type !== 'ending') {
			if (visited.has(chamber.id)) fail('cyclic preview route');
			visited.add(chamber.id);
			const edge = chamber.exits.find(exit => exit.id === content.preview_route![chamber.id]);
			if (!edge) fail(`invalid preview exit at ${chamber.id}`);
			chamber = chambers.get(edge.target)!;
		}
		if (Object.keys(content.preview_route).length !== visited.size ||
			Object.keys(content.preview_route).some(id => !visited.has(id)))
			fail('preview route contains an unused Chamber');
	}
}

export const EXPEDITION_CONTENT_V1 = JSON.parse(readFileSync(
	new URL('./expedition-content-v1.json', import.meta.url), 'utf8'
)) as ExpeditionContent;
validate_expedition_content(EXPEDITION_CONTENT_V1);

const preview_route: Record<string, string> = {
	entrance: 'entrance:exit_1',
	prismatic_descent: 'prismatic_descent:exit_1',
	glassroot_terraces: 'glassroot_terraces:exit_3',
	buried_observatory: 'buried_observatory:exit_1',
	prismatic_orrery: 'prismatic_orrery:exit_3',
	voidwatch_threshold: 'voidwatch_threshold:exit_1'
};

const preview_content: ExpeditionContent = { ...EXPEDITION_CONTENT_V1, version: 2, preview_route };
export const EXPEDITION_CONTENT_PREVIEW: ExpeditionContent = {
	...preview_content,
	chambers: EXPEDITION_CONTENT_V1.chambers.map(chamber => ({
		...chamber,
		tasks: chamber.tasks.filter(task => preview_task_available(preview_content, chamber, task))
	}))
};
validate_expedition_content(EXPEDITION_CONTENT_PREVIEW);
