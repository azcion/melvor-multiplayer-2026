import assert from 'node:assert/strict';
import test from 'node:test';
import {
	MAX_STATUS_ACTIVITY_COUNT,
	capture_primary_status_activity,
	capture_status_activities,
	normalize_status_activities
} from '../../mod/status-activities.mjs';

function registered(...skills) {
	return { registeredObjects: skills.map(skill => [skill.id, skill]) };
}

function active_skill(id, action) {
	return { id, isActive: true, masteryAction: action };
}

test('captures one vanilla active skill and preserves it as the legacy primary activity', () => {
	const woodcutting = active_skill('melvorD:Woodcutting', { id: 'melvorD:Oak' });
	const game = { skills: registered(woodcutting), activeAction: woodcutting, combat: {} };
	const activities = capture_status_activities(game);

	assert.deepEqual(activities, [{ type: 'skill', skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Oak' }]);
	assert.deepEqual(capture_primary_status_activity(game, activities), activities[0]);
});

test('preserves the legacy activeAction combat fallback', () => {
	const active_combat = { isCombat: true, selectedArea: { id: 'melvorD:Volcanic_Cave' } };
	const game = { skills: registered(), activeAction: active_combat, combat: {} };

	assert.deepEqual(capture_status_activities(game), [{ type: 'combat', area_id: 'melvorD:Volcanic_Cave' }]);
	assert.deepEqual(capture_primary_status_activity(game), { type: 'combat', area_id: 'melvorD:Volcanic_Cave' });
});

test('captures simultaneous Multitasking skills from generic registered-skill state', () => {
	const astrology = active_skill('melvorD:Astrology', { id: 'melvorD:Aries' });
	const woodcutting = active_skill('melvorD:Woodcutting', { id: 'melvorD:Oak' });
	const multitasking = { id: 'multitasking:multitasking', isActive: true };
	const game = { skills: registered(astrology, woodcutting), activeAction: multitasking, combat: {} };
	const activities = capture_status_activities(game);

	assert.deepEqual(activities, [
		{ type: 'skill', skill_id: 'melvorD:Astrology', action_id: 'melvorD:Aries' },
		{ type: 'skill', skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Oak' }
	]);
	assert.deepEqual(capture_primary_status_activity(game, activities), { type: 'idle' });
});

test('captures Workers skills and Combat without consulting a mod-specific controller', () => {
	const astrology = { id: 'melvorD:Astrology', isActive: true, studiedConstellation: { id: 'melvorD:Aries' } };
	const fishing = active_skill('melvorD:Fishing', { id: 'melvorD:Shrimp' });
	const woodcutting = { id: 'melvorD:Woodcutting', isActive: true, activeTrees: new Set([{ id: 'melvorD:Oak' }]) };
	const combat = { isActive: true, selectedArea: { id: 'melvorD:Volcanic_Cave' } };
	const game = {
		skills: registered(astrology, fishing, woodcutting),
		activeAction: { id: 'multitasking:multitasking', isActive: true },
		combat
	};

	assert.deepEqual(capture_status_activities(game), [
		{ type: 'skill', skill_id: 'melvorD:Astrology', action_id: 'melvorD:Aries' },
		{ type: 'skill', skill_id: 'melvorD:Fishing', action_id: 'melvorD:Shrimp' },
		{ type: 'skill', skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Oak' },
		{ type: 'combat', area_id: 'melvorD:Volcanic_Cave' }
	]);
});

test('captures the three concurrent skill selections used by Multitasking', () => {
	const woodcutting = { id: 'melvorD:Woodcutting', isActive: true, activeTrees: new Set([{ id: 'melvorD:Oak' }]) };
	const astrology = { id: 'melvorD:Astrology', isActive: true, studiedConstellation: { id: 'melvorD:Aries' } };
	const agility = {
		id: 'melvorD:Agility', isActive: true, masteryAction: {}, activeObstacle: { id: 'melvorD:Obstacle_1' }
	};
	const game = { skills: registered(woodcutting, astrology, agility), activeAction: { id: 'multitasking:multitasking' }, combat: {} };

	assert.deepEqual(capture_status_activities(game), [
		{ type: 'skill', skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Oak' },
		{ type: 'skill', skill_id: 'melvorD:Astrology', action_id: 'melvorD:Aries' },
		{ type: 'skill', skill_id: 'melvorD:Agility', action_id: 'melvorD:Obstacle_1' }
	]);
});

test('keeps Alt. Magic as a skill, excludes malformed active state, and bounds duplicates', () => {
	const alt_magic = active_skill('melvorD:Magic', { id: 'melvorD:Wind_Strike' });
	alt_magic.isCombat = true;
	const unknown = { id: 'melvorD:Unknown', isActive: true };
	const game = { skills: registered(alt_magic, unknown), activeAction: alt_magic, altMagic: alt_magic, combat: {} };
	const duplicate = { type: 'skill', skill_id: 'melvorD:Magic', action_id: 'melvorD:Wind_Strike' };
	const many = Array.from({ length: MAX_STATUS_ACTIVITY_COUNT + 1 }, (_, index) => ({
		type: 'skill', skill_id: `test:Skill_${index}`, action_id: `test:Action_${index}`
	}));

	assert.deepEqual(capture_status_activities(game), [duplicate]);
	assert.deepEqual(capture_primary_status_activity(game), duplicate);
	assert.deepEqual(normalize_status_activities([duplicate, duplicate]), [duplicate]);
	assert.equal(normalize_status_activities(many).length, MAX_STATUS_ACTIVITY_COUNT);
	assert.deepEqual(capture_status_activities({ skills: registered(unknown), combat: {} }), []);
});
