import { describe, expect, test } from 'bun:test';
import { EXPEDITION_CONTENT_PREVIEW, EXPEDITION_CONTENT_V1, validate_expedition_content } from '../../expedition-content';
import type { ExpeditionContent } from '../../expedition-content';

function changed(change: (copy: ExpeditionContent) => void): ExpeditionContent {
	const copy = structuredClone(EXPEDITION_CONTENT_V1);
	change(copy);
	return copy;
}

describe('Expedition content v1', () => {
	test('keeps the preview on the seven-Chamber path while retaining poll options', () => {
		expect(() => validate_expedition_content(EXPEDITION_CONTENT_PREVIEW)).not.toThrow();
		expect(EXPEDITION_CONTENT_PREVIEW.version).toBe(2);
		const visited = ['entrance'];
		while (EXPEDITION_CONTENT_PREVIEW.preview_route?.[visited.at(-1)!]) {
			const chamber = EXPEDITION_CONTENT_PREVIEW.chambers.find(entry => entry.id === visited.at(-1))!;
			const edge = chamber.exits.find(entry => entry.id === EXPEDITION_CONTENT_PREVIEW.preview_route?.[chamber.id])!;
			visited.push(edge.target);
		}
		expect(visited).toEqual(['entrance', 'prismatic_descent', 'glassroot_terraces',
			'buried_observatory', 'prismatic_orrery', 'voidwatch_threshold', 'hollow_star']);
		expect(EXPEDITION_CONTENT_PREVIEW.chambers.find(chamber => chamber.id === 'entrance')?.exits).toHaveLength(3);
		for (const chamber of EXPEDITION_CONTENT_PREVIEW.chambers) {
			const selected = EXPEDITION_CONTENT_PREVIEW.preview_route?.[chamber.id];
			if (!selected) continue;
			expect(chamber.tasks.filter(task => task.discovery_target || task.exit_id)
				.every(task => (task.discovery_target ?? task.exit_id) === selected)).toBe(true);
			expect(chamber.exits).toEqual(EXPEDITION_CONTENT_V1.chambers.find(entry => entry.id === chamber.id)!.exits);
		}
		expect(() => validate_expedition_content({ ...EXPEDITION_CONTENT_PREVIEW,
			preview_route: { ...EXPEDITION_CONTENT_PREVIEW.preview_route, entrance: 'entrance:exit_9' }
		})).toThrow('invalid preview exit');
	});
	test('authors fixed base-game tasks for all prototype Chambers and edges', () => {
		expect(() => validate_expedition_content(EXPEDITION_CONTENT_V1)).not.toThrow();
		expect(EXPEDITION_CONTENT_V1.chambers.length).toBe(31);
		expect(EXPEDITION_CONTENT_V1.chambers.filter(chamber => chamber.type === 'ending').length).toBe(6);
		expect(EXPEDITION_CONTENT_V1.chambers.flatMap(chamber => chamber.exits).length).toBe(45);
		for (const chamber of EXPEDITION_CONTENT_V1.chambers) {
			expect(chamber.tasks.some(task => task.kind === 'chart')).toBe(true);
			expect(chamber.tasks.some(task => task.kind === 'scout')).toBe(true);
			expect(chamber.tasks.some(task => task.requirement === 'optional')).toBe(true);
			if (chamber.type === 'ending')
				expect(chamber.tasks.some(task => task.kind === 'completion')).toBe(true);
		}
	});

	test('rejects duplicate, dangling, cyclic, unreachable, and non-official content', () => {
		expect(() => validate_expedition_content(changed(copy => {
			copy.chambers[1].id = 'entrance';
		}))).toThrow('duplicate');
		expect(() => validate_expedition_content(changed(copy => {
			copy.chambers[0].exits[0].target = 'missing';
		}))).toThrow('dangling');
		expect(() => validate_expedition_content(changed(copy => {
			copy.chambers[0].tasks.find(task => task.id === 'groundwork')!.depends_on = ['exploration'];
			copy.chambers[0].tasks.find(task => task.id === 'exploration')!.depends_on = ['groundwork'];
		}))).toThrow('cyclic');
		expect(() => validate_expedition_content(changed(copy => {
			copy.chambers[0].exits.pop();
		}))).toThrow();
		expect(() => validate_expedition_content(changed(copy => {
			copy.chambers[0].tasks[0].evidence.skill_ids = ['melvorD:Farming'];
		}))).toThrow('non-official');
		expect(() => validate_expedition_content(changed(copy => {
			copy.chambers[0].tasks[0].evidence.skill_ids = ['other:Mining'];
		}))).toThrow('non-official');
	});

	test('allows official DLC work while keeping required chains finishable with base skills', () => {
		expect(() => validate_expedition_content(changed(copy => {
			copy.chambers[0].tasks[0].evidence.skill_ids.push('melvorAoD:Archaeology', 'melvorItA:Harvesting');
		}))).not.toThrow();
		expect(() => validate_expedition_content(changed(copy => {
			const ending = copy.chambers.find(chamber => chamber.id === 'hollow_star')!;
			ending.tasks.find(task => task.id === 'arrival_support')!.evidence.skill_ids = ['melvorAoD:Cartography'];
		}))).not.toThrow();
		expect(() => validate_expedition_content(changed(copy => {
			copy.chambers[0].tasks[0].evidence.skill_ids = ['melvorAoD:Archaeology'];
		}))).toThrow('missing base-game evidence');
		expect(() => validate_expedition_content(changed(copy => {
			copy.chambers[0].tasks.find(task => task.id === 'exploration')!.evidence.skill_ids = ['melvorAoD:Cartography'];
		}))).toThrow('missing base-game evidence');
	});

	test('allows independently authored Chart and Scout baselines', () => {
		expect(() => validate_expedition_content(changed(copy => {
			copy.chambers[0].tasks.find(task => task.id === 'arrival_chart')!.baseline_hours = 15;
			copy.chambers[0].tasks.find(task => task.id === 'arrival_scout')!.baseline_hours = 5;
		}))).not.toThrow();
	});

	test('rejects exits without reachable discovery and preparation', () => {
		expect(() => validate_expedition_content(changed(copy => {
			copy.chambers[0].tasks = copy.chambers[0].tasks.filter(task => task.id !== 'reveal_1');
		}))).toThrow();
		expect(() => validate_expedition_content(changed(copy => {
			copy.chambers[0].tasks.find(task => task.id === 'prepare_1')!.evidence.skill_ids = ['melvorD:Township'];
		}))).toThrow('non-official');
		expect(() => validate_expedition_content(changed(copy => {
			copy.chambers[0].tasks.find(task => task.id === 'prepare_1')!.depends_on = ['exploration'];
		}))).toThrow('exit lacks');
	});

	test('keeps the authored preview roles and final defense sequence', () => {
		const preview_ids = ['entrance', 'prismatic_descent', 'glassroot_terraces',
			'buried_observatory', 'prismatic_orrery', 'voidwatch_threshold', 'hollow_star'];
		for (const id of preview_ids) {
			const chamber = EXPEDITION_CONTENT_V1.chambers.find(entry => entry.id === id)!;
			expect(chamber.tasks.some(task => task.id === 'groundwork' && task.requirement === 'required')).toBe(true);
		}
		const threshold = EXPEDITION_CONTENT_V1.chambers.find(chamber => chamber.id === 'voidwatch_threshold')!;
		expect(threshold.tasks.find(task => task.id === 'light_braziers')?.depends_on).toEqual(['groundwork']);
		expect(threshold.tasks.find(task => task.id === 'passage_defense')?.depends_on).toEqual(['reveal_1']);
		const ending = EXPEDITION_CONTENT_V1.chambers.find(chamber => chamber.id === 'hollow_star')!;
		expect(ending.tasks.find(task => task.id === 'initial_defense')?.depends_on).toEqual(['groundwork']);
		expect(ending.tasks.find(task => task.id === 'melt_star')?.depends_on).toEqual(['initial_defense']);
		expect(ending.tasks.find(task => task.id === 'continued_defense')?.depends_on).toEqual(['initial_defense']);
		expect(ending.tasks.find(task => task.id === 'ending_departure')?.depends_on)
			.toEqual(['melt_star', 'continued_defense']);
	});
});
