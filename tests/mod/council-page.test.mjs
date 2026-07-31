import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('wires Council petition controls, resolved-history toggle, and action descriptions', async () => {
	const [templates, main, style, language_text] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8')
	]);
	const language = JSON.parse(language_text);

	for (const modal of ['raise', 'appellation', 'heraldry', 'banishment'])
		assert.match(templates, new RegExp(`template-mp-council-${modal}-modal`));

	assert.match(templates, /v-if="petition\.tally_visible"/);
	assert.match(templates, /state\.vote_council_petition\(\$event, petition, 'aye'\)/);
	assert.match(templates, /state\.withdraw_council_petition\(\$event, petition\)/);
	assert.match(templates, /v-for="petition in state\.visible_council_petitions"/);
	assert.match(templates, /state\.toggle_resolved_council_petitions\(\)/);
	assert.match(templates, /petition\.current_vote === 'aye' \? 'badge-success' : 'badge-danger'/);
	assert.doesNotMatch(templates, /MOD_MP_COUNCIL_VOTE_RECORDED|MOD_MP_COUNCIL_SUBTITLE/);
	assert.match(templates, /MOD_MP_COUNCIL_APPELLATION_DESCRIPTION/);
	assert.match(templates, /MOD_MP_COUNCIL_HERALDRY_DESCRIPTION/);
	assert.match(templates, /MOD_MP_COUNCIL_BANISHMENT_DESCRIPTION/);
	assert.match(style, /\.mp-council-threshold[\s\S]*left: 50%/);
	assert.match(style, /\.mp-council-petition-description[\s\S]*text-align: center/);
	assert.match(style, /\.mp-council-target-list \.mp-guild-person:last-child[\s\S]*border-bottom: 1px solid currentColor/);

	assert.match(main, /api_get\('\/api\/guilds\/council\?page=' \+ page\)/);
	assert.match(main, /api_post\('\/api\/guilds\/petitions\/raise'/);
	assert.match(main, /api_post\('\/api\/guilds\/petitions\/vote'/);
	assert.match(main, /api_post\('\/api\/guilds\/petitions\/withdraw'/);
	assert.match(main, /if \(guild_state\?\.affiliation === 'member'\)\s*await refresh_council\(\)/);
	assert.match(main, /petition\.lifecycle === 'active'/);
	assert.equal(language.MOD_MP_COUNCIL_TYPE_BANISHMENT, 'Petition for Banishment');
	assert.equal(language.MOD_MP_COUNCIL_BANISHMENT_DESCRIPTION, 'Propose removing a member from the Guild. It is not a permanent ban; they may apply to rejoin.');
});
