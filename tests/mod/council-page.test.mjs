import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

const root = new URL('../../', import.meta.url);

test('wires Council petition controls, resolved-history toggle, and action descriptions', async () => {
	const [templates, main, style, language_text] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8')
	]);
	const language = JSON.parse(language_text);

	for (const modal of ['raise', 'appellation', 'heraldry', 'banishment', 'action'])
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
	assert.match(templates, /can_raise_council_petition\('winnowing'\)/);
	assert.match(templates, /MOD_MP_COUNCIL_WINNOWING_DESCRIPTION/);
	assert.match(templates, /petition\.type === 'winnowing'[\s\S]*petition\.proposal\.target_count/);
	assert.match(templates, /can_raise_council_petition\('charitree_ingratitude'\)/);
	assert.match(templates, /can_raise_council_petition\('charitree_sacrilege'\)/);
	assert.match(templates, /can_raise_council_petition\('charitree_beneficence'\)/);
	assert.match(templates, /can_raise_council_petition\('fellowship'\)/);
	assert.match(templates, /can_raise_council_petition\('enclosure'\)/);
	assert.match(templates, /MOD_MP_COUNCIL_INGRATITUDE_DESCRIPTION/);
	assert.match(templates, /MOD_MP_COUNCIL_SACRILEGE_DESCRIPTION/);
	assert.match(templates, /MOD_MP_COUNCIL_BENEFICENCE_DESCRIPTION/);
	assert.match(templates, /submit_council_petition\(\$event, state\.council_type\)/);
	assert.match(style, /\.mp-council-threshold[\s\S]*left: 50%/);
	assert.match(style, /\.mp-council-petition-description[\s\S]*text-align: center/);
	assert.match(style, /\.mp-council-target-list \.mp-guild-person:last-child[\s\S]*border-bottom: 1px solid currentColor/);

	assert.match(main, /api_get\('\/api\/guilds\/council\?page=' \+ page\)/);
	assert.match(main, /api_post\('\/api\/guilds\/petitions\/raise'/);
	assert.match(main, /api_post\('\/api\/guilds\/petitions\/vote'/);
	assert.match(main, /api_post\('\/api\/guilds\/petitions\/withdraw'/);
	assert.match(main, /async function refresh_guild_page\(\)[\s\S]*?if \(state\.is_guild_member\)[\s\S]*?Promise\.all\(\[refresh_council\(\), refresh_shadowed_members\(\), refresh_guild_activity\(\)\]\)/);
	assert.match(main, /async show_raise_petition_modal\(\)[\s\S]*?await refresh_council\(\)/);
	assert.match(main, /petition\.lifecycle === 'active'/);
	assert.match(main, /state\.council_available_petition_types = res\.available_petition_types \?\? \[\]/);
	assert.equal(language.MOD_MP_COUNCIL_TYPE_BANISHMENT, 'Petition for Banishment');
	assert.equal(language.MOD_MP_COUNCIL_TYPE_WINNOWING, 'Petition of Winnowing');
	assert.match(language.MOD_MP_COUNCIL_WINNOWING_CONFIRM, /remains Shadowed/);
	assert.equal(language.MOD_MP_COUNCIL_TYPE_CHARITREE_INGRATITUDE, 'Petition of Ingratitude');
	assert.equal(language.MOD_MP_COUNCIL_TYPE_CHARITREE_SACRILEGE, 'Petition of Sacrilege');
	assert.equal(language.MOD_MP_COUNCIL_TYPE_CHARITREE_BENEFICENCE, 'Petition of Beneficence');
	assert.equal(language.MOD_MP_COUNCIL_TYPE_FELLOWSHIP, 'Petition of Fellowship');
	assert.equal(language.MOD_MP_COUNCIL_TYPE_ENCLOSURE, 'Petition of Enclosure');
	assert.match(language.MOD_MP_COUNCIL_FELLOWSHIP_CONFIRM, /wait 24 hours/);
	assert.match(language.MOD_MP_COUNCIL_ENCLOSURE_DESCRIPTION, /close its gates/);
	assert.equal(language.MOD_MP_COUNCIL_APPELLATION_DESCRIPTION, 'Call for the Guild to take a new name.');
	assert.equal(language.MOD_MP_COUNCIL_HERALDRY_DESCRIPTION, 'Call for the Guild to bear a new emblem.');
	assert.equal(language.MOD_MP_COUNCIL_BANISHMENT_DESCRIPTION, 'Call for a member to be cast out of the Guild. This is no permanent exile; they may apply to rejoin.');
	assert.equal(language.MOD_MP_COUNCIL_PROPOSED_NAME, 'New Guild name');
	assert.equal(language.MOD_MP_COUNCIL_PROPOSED_ICON, 'New Guild emblem');
	assert.equal(language.MOD_MP_GUILD_ICON_REQUIRED, 'Choose an emblem for the Guild.');
	assert.equal(language.MOD_MP_MODAL_DESC_CREATE_GUILD, 'Choose a name and an emblem.');
	assert.match(templates, /:placeholder="getLangString\('MOD_MP_PLACEHOLDER_SEARCH_COMBAT_LOCATIONS'\)"/);
});

test('hides the felled Charitree and its donation action until restored', async () => {
	const [templates, main, style, language_text] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8')
	]);
	const language = JSON.parse(language_text);
	const charitree_page = templates.slice(
		templates.indexOf('<template id="template-mp-charity-page">'),
		templates.indexOf('<template id="template-mp-transfer-page">')
	);

	assert.match(main, /get is_charitree_enabled\(\)/);
	assert.match(main, /sidebar\.category\('Multiplayer'\)\.item\('multiplayer:Charity_Tree'\)/);
	assert.match(main, /nav_item\.rootEl\?\.classList\.toggle\('mp-nav-unavailable', !state\.is_charitree_enabled\)/);
	assert.match(main, /document\.querySelector\('\.mp-charity-nav'\)/);
	assert.match(main, /state\.is_charitree_enabled && state\.can_take_charity/);
	assert.doesNotMatch(main, /nav_item\.(hide|show)\(\)/);
	assert.match(main, /state\.events\.guild_applicants = state\.guild_applicants;\s*update_multiplayer_nav\(\);/);
	assert.match(charitree_page, /v-show="state\.is_guild_member && !state\.is_charitree_enabled"/);
	assert.match(charitree_page, /MOD_MP_CHARITY_DISABLED_INFO/);
	assert.match(charitree_page, /v-show="state\.is_charitree_enabled"/);
	assert.match(charitree_page, /<div class="mp-charitree-timer"><mp-lang-string-f lang-id="MOD_MP_CHARITY_EXPIRES_IN" :lang-arg-1="state\.format_charity_expiry\(item\.expires_at\)"><\/mp-lang-string-f><\/div>/);
	assert.match(style, /div\.mp-charitree-timer\s*\{\s*all: unset;\s*position: absolute;\s*top: 0;\s*left: 2px;\s*font-size: 9px;\s*\}/);
	assert.match(style, /\.mp-charity-nav[\s\S]*background-color: #28a745/);
	assert.equal(language.MOD_MP_CHARITY_EXPIRES_IN, '%s');
	assert.equal(language.MOD_MP_SIDEBAR_CHARITY_READY, 'ready');
	assert.match(templates, /state\.is_guild_member && state\.is_charitree_enabled && !state\.has_destroyable_transfer_items/);
	assert.equal(language.MOD_MP_CHARITY_DISABLED, 'This Guild has forsaken the Charitree.');
});
