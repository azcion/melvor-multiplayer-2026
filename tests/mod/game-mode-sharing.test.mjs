import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';
import { get_base_game_mode, resolve_game_mode } from '../../mod/game-mode-sharing.mjs';

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
	assert.match(roster, /state\.get_roster_game_mode\(member\)/);
	assert.match(roster, /state\.get_roster_game_mode\(member\)\?\.media \|\| 'assets\/media\/main\/question\.png'/);
	assert.match(roster, /state\.get_roster_game_mode\(member\)\?\.name \|\| ''/);
	assert.doesNotMatch(roster, /state\.get_roster_game_mode\(member\)\.(?:media|name)/);
	assert.match(member_modal, /class="mp-game-mode-label" v-if="state\.selected_guild_member\.game_mode_visible && state\.selected_guild_member\.game_mode_id"/);
	assert.match(member_modal, /state\.get_shared_game_mode\(state\.selected_guild_member\)\?\.media \|\| 'assets\/media\/main\/question\.png'/);
	assert.match(member_modal, /state\.get_shared_game_mode\(state\.selected_guild_member\)\?\.name \|\| ''/);
	assert.doesNotMatch(member_modal, /state\.get_shared_game_mode\(state\.selected_guild_member\)\.(?:media|name)/);
	assert.match(member_modal, /state\.set_game_mode_visibility\(\$event\)/);
	assert.match(main, /game\.gamemodes\?\.getObjectByID\(id\)/);
	assert.match(main, /api_post\('\/api\/client\/game-mode\/visibility'/);
	assert.match(style, /\.mp-game-mode-icon \{[^}]*width: 16px;[^}]*height: 16px;[^}]*object-fit: contain;[^}]*\}/s);
	assert.match(style, /\.mp-game-mode-label img,[^}]*\{[^}]*width: 24px;[^}]*height: 24px;[^}]*object-fit: contain;[^}]*\}/s);
	assert.equal(language.MOD_MP_GAME_MODE_VISIBILITY, 'Let others see your game mode');
	assert.equal(language.MOD_MP_GAME_MODE_UNKNOWN, 'Unknown Mode');
});
