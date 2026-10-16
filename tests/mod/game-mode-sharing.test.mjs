import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { install_common_actions } from '../../mod/client-actions-common.mjs';
import * as game_mode_sharing from '../../mod/game-mode-sharing.mjs';
import { read_client_source } from './source.mjs';
import { get_base_game_mode, get_known_game_mode, resolve_game_mode } from '../../mod/game-mode-sharing.mjs';

const root = new URL('../../', import.meta.url);

test('uses the required media for the four supported base game modes', () => {
	assert.deepEqual(get_base_game_mode('melvorD:Standard'), {
		name: 'Standard Mode',
		media: 'assets/media/skills/combat/combat.png'
	});
	assert.deepEqual(get_base_game_mode('melvorF:Hardcore'), {
		name: 'Hardcore Mode',
		media: 'assets/media/main/hardcore.png'
	});
	assert.deepEqual(get_base_game_mode('melvorF:Adventure'), {
		name: 'Adventure Mode',
		media: 'assets/media/main/adventure.png'
	});
	assert.deepEqual(get_base_game_mode('melvorAoD:AncientRelics'), {
		name: 'Ancient Relics Mode',
		media: 'assets/media/main/gamemode_ancient_relic.png'
	});
});

test('uses a question mark and a local name for custom modes when available', () => {
	const resolved = resolve_game_mode(
		'customMode:Iron_Idler',
		id => id === 'customMode:Iron_Idler' ? { name: 'Iron Idler' } : undefined
	);
	const unknown = resolve_game_mode('missingMode:Unknown', () => undefined);

	assert.deepEqual(resolved, {
		name: 'Iron Idler',
		media: 'assets/media/main/question.png',
		is_modded: true
	});
	assert.equal(unknown.name, 'Unknown Mode');
	assert.equal(unknown.media, 'assets/media/main/question.png');
});

test('recognizes supported mod IDs without the viewer installing those mods', async () => {
	const modes = [
		['hcco:hcco', 'Hardcore Combat Only', 'hcco.png'],
		['hcco:mcco', 'Mediumcore Combat Only', 'mcco.png'],
		['hcco:rehcco', 'Rebalance Hardcore Combat Only', 'hrco.png'],
		['hcco:remcco', 'Rebalance Mediumcore Combat Only', 'rmco.png'],
		['RandomAdventure:RandomAdventure', 'Randomized Adventure Mode', 'randomized_adventure.png'],
		['taskman:Taskman', 'Taskman', 'taskman.svg'],
		['gamemodesbyphoenix:adventurenoxpcap', 'Phoenix Adventure Mode', 'phoenix.png'],
		['phoenixgamemodemanager:BirthdayMode', 'Phoenix Birthday Mode', 'phoenix.png']
	];
	for (const [id, name, asset] of modes) {
		const path = 'assets/gamemode_' + asset;
		assert.deepEqual(resolve_game_mode(id, () => undefined, 'Unknown Mode', path => 'bundle://' + path), {
			name, media: 'bundle://' + path, is_modded: true
		});
		await readFile(new URL('mod/' + path, root));
	}
	assert.equal(get_known_game_mode('hcco:remcco_extra'), null);
	assert.equal(get_known_game_mode('melvorD:Unset'), null);
	assert.equal(get_known_game_mode('constructor'), null);
});

test('uses installed custom mode media and localized unknown fallback', () => {
	assert.deepEqual(resolve_game_mode('custom:Mode', () => ({ name: ' Local Mode ', media: 'blob:local-icon' })), {
		name: 'Local Mode', media: 'blob:local-icon', is_modded: true
	});
	assert.deepEqual(resolve_game_mode('missing:Mode', () => ({ name: ' ', media: '' }), 'Unbekannter Modus'), {
		name: 'Unbekannter Modus', media: 'assets/media/main/question.png', is_modded: true
	});
});

test('keeps hidden modes private and resolves bundled icons in both player views', () => {
	const actions = install_common_actions({
		game_mode_sharing,
		ctx: { getResourceUrl: path => 'bundle://' + path },
		game: { gamemodes: { getObjectByID: () => undefined } },
		getLangString: () => 'Unknown Mode'
	});
	for (const visible of [false, undefined]) {
		const member = { game_mode_visible: visible, game_mode_id: 'hcco:remcco' };
		assert.equal(actions.get_shared_game_mode(member), null);
		assert.equal(actions.get_roster_game_mode(member), null);
	}
	const member = { game_mode_visible: true, game_mode_id: 'hcco:remcco' };
	assert.equal(actions.get_shared_game_mode(member).media, 'bundle://assets/gamemode_rmco.png');
	assert.deepEqual(actions.get_roster_game_mode(member), actions.get_shared_game_mode(member));
	assert.equal(actions.get_roster_game_mode({ ...member, game_mode_id: 'missing:Mode' }), null);
});

test('wires game modes into the roster, other-player modal, and Options sharing control', async () => {
	const [templates, main, language, style] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);

	const roster = templates.slice(
		templates.indexOf('<template v-for="(member, member_index) in state.guild_members">'),
		templates.indexOf('<div class="block-content text-center" v-show="state.is_free_fellowship')
	);
	const member_modal = templates.slice(
		templates.indexOf('<template id="template-mp-member-actions-modal">'),
		templates.indexOf('<template id="template-mp-identities-modal">')
	);

	assert.match(roster, /mp-guild-member-name/);
	assert.match(roster, /<img class="mp-guild-member-avatar skill-icon-xs"[\s\S]*mp-guild-member-content/);
	assert.match(roster, /mp-guild-member-content[\s\S]*mp-game-mode-icon/);
	assert.match(roster, /state\.get_roster_game_mode\(member\)/);
	assert.match(roster, /state\.get_roster_game_mode\(member\)\?\.media \|\| 'assets\/media\/main\/question\.png'/);
	assert.match(roster, /state\.get_roster_game_mode\(member\)\?\.name \|\| ''/);
	assert.doesNotMatch(roster, /state\.get_roster_game_mode\(member\)\.(?:media|name)/);
	assert.match(member_modal, /class="mp-game-mode-label" v-if="state\.selected_guild_member\.game_mode_visible && state\.selected_guild_member\.game_mode_id"/);
	assert.match(member_modal, /state\.get_shared_game_mode\(state\.selected_guild_member\)\?\.media \|\| 'assets\/media\/main\/question\.png'/);
	assert.match(member_modal, /state\.get_shared_game_mode\(state\.selected_guild_member\)\?\.name \|\| ''/);
	assert.doesNotMatch(member_modal, /state\.get_shared_game_mode\(state\.selected_guild_member\)\.(?:media|name)/);
	assert.match(templates.slice(templates.indexOf('<template id="template-mp-multiplayer-settings-modal">')), /state\.set_game_mode_visibility\(\$event\)/);
	assert.match(main, /game\.gamemodes\?\.getObjectByID\(id\)/);
	assert.match(main, /'\/api\/client\/game-mode\/visibility'/);
	assert.match(style, /\.mp-game-mode-icon \{[^}]*object-fit: contain;[^}]*position: absolute;[^}]*width: 96px;[^}]*opacity: \.15;[^}]*right: calc\(50% - 48px\);[^}]*height: 96px;[^}]*\}/s);
	assert.doesNotMatch(style, /\.mp-game-mode-icon \{[^}]*top:/s);
	assert.match(style, /\.mp-guild-member-avatar \{[^}]*height: 40px;[^}]*width: 40px;[^}]*\}/s);
	assert.doesNotMatch(style, /\.mp-guild-member-button > img/);
	assert.match(style, /\.mp-guild-member-avatar,[\s\S]*\.mp-guild-member-content \{[\s\S]*position: relative;[\s\S]*z-index: 1;/);
	assert.match(style, /\.mp-game-mode-icon \{[\s\S]*right: calc\(50% - 48px\);[\s\S]*z-index: 0;[\s\S]*pointer-events: none;/);
	assert.match(style, /\.mp-guild-member-last-seen \{[\s\S]*font-size: 10px !important;/);
	assert.match(style, /\.mp-guild-member-gp \{[\s\S]*font-size: 10px;/);
	assert.match(style, /\.mp-guild-member-gp img \{[\s\S]*width: 12px;[\s\S]*height: 12px;/);
	assert.match(style, /\.mp-game-mode-label img \{[^}]*width: 24px;[^}]*height: 24px;[^}]*object-fit: contain;[^}]*\}/s);
	assert.equal(language.MOD_MP_GAME_MODE_VISIBILITY, 'Let others see your game mode');
	assert.equal(language.MOD_MP_GAME_MODE_UNKNOWN, 'Unknown Mode');
});


test('searches known and installed mode names case-insensitively without installing known mods', () => {
	assert.deepEqual(game_mode_sharing.search_game_mode_ids('Rebalance Hardcore'), ['hcco:rehcco']);
	assert.deepEqual(game_mode_sharing.search_game_mode_ids('IRON', [
		{ id: 'custom:Mode', name: 'Iron Idler' },
		{ id: 'custom:Other', name: 'Other' }
	]), ['custom:Mode']);
	assert.deepEqual(game_mode_sharing.search_game_mode_ids(''), []);
	assert.deepEqual(game_mode_sharing.search_game_mode_ids('missing'), []);
});

test('all directory placeholders use the short localized Search label', async () => {
	const { readdir } = await import('node:fs/promises');
	for (const file of await readdir(new URL('mod/data/lang/', root))) {
		if (!file.endsWith('.json')) continue;
		const language = JSON.parse(await readFile(new URL('mod/data/lang/' + file, root), 'utf8'));
		assert.equal(language.MOD_MP_FREE_FELLOWSHIP_SEARCH, language.MOD_MP_PLACEHOLDER_SEARCH_ITEMS, file);
	}
});


test('search reason labels resolve modes, preserve mod names and support older backends', () => {
	const actions = install_common_actions({ state: {}, game_mode_sharing,
		game: {gamemodes: {getObjectByID: () => null}}, ctx: {getResourceUrl: path => path}, getLangString: key => key });
	assert.deepEqual(actions.get_member_search_tags({}), []);
	assert.deepEqual(actions.get_member_search_tags({active_mods_visible: true, game_mode_visible: true, game_mode_id: 'hcco:rehcco', search_matches: [
		{kind: 'mod', label: 'Super Awesome Expansion!'}, {kind: 'mod', label: 'Super Awesome Expansion!'},
		{kind: 'game_mode', label: 'hcco:rehcco'}, {kind: 'dev', label: 'Custom SAE Dev'}, {kind: 'unknown', label: 'Ignore'}
	]}), ['Super Awesome Expansion!', 'Rebalance Hardcore Combat Only', 'Custom SAE Dev']);
	assert.deepEqual(actions.get_member_search_tags({active_mods_visible: false, game_mode_visible: false, search_matches: [
		{kind: 'mod', label: 'Hidden'}, {kind: 'game_mode', label: 'hcco:rehcco'}
	]}), []);
});

test('search tags render plain text with Font Awesome in each searchable member surface', async () => {
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const applicants = templates.slice(templates.indexOf('v-for="application in state.guild_applicants"'), templates.indexOf('v-for="(member, member_index) in state.guild_members"'));
	assert.doesNotMatch(applicants, /get_member_search_tags/);
	assert.equal((templates.match(/class="badge badge-info mp-member-search-tag"/g) ?? []).length, 4);
	assert.equal((templates.match(/<i class="fa fa-search mr-1" aria-hidden="true"><\/i>{{ label }}/g) ?? []).length, 4);
	assert.doesNotMatch(templates, /v-html="label"/);
});
