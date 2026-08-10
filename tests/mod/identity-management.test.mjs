import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function sources() {
	const [main, templates, language_text] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8')
	]);
	return { main, templates, language: JSON.parse(language_text) };
}

test('sends the authenticated Melvor account pair and preserves account-specific bindings', async () => {
	const { main } = await sources();

	assert.match(main, /typeof cloudManager === 'undefined' \? globalThis\.cloudManager : cloudManager/);
	assert.match(main, /read_melvor_account\(melvor_cloud_manager, globalThis\.localStorage\)/);
	assert.match(main, /find_identity_binding\(stored_bindings, account\)/);
	assert.match(main, /api_post_response\('\/api\/authenticate',[\s\S]*\.\.\.account/);
	assert.match(main, /api_post_response\('\/api\/register',[\s\S]*\.\.\.account/);
	assert.match(main, /melvor_account_mismatch[\s\S]*register_multiplayer_identity\(account, true\)/);
	assert.match(main, /store_account_identity_binding\(account, credentials\)/);
});

test('refuses ambiguous legacy credentials when the Melvor account context is unavailable', async () => {
	const { main } = await sources();
	const guard = main.indexOf('if (account === null && normalized_bindings.entries.length > 0)');
	const credentials = main.indexOf('const credentials = binding ?? legacy_credentials');

	assert.notEqual(guard, -1);
	assert.notEqual(credentials, -1);
	assert.ok(guard < credentials);
	assert.match(main, /refusing to use an ambiguous legacy identity/);
});

test('shows Identities only for discovered siblings and wires the nested deletion flow', async () => {
	const { main, templates, language } = await sources();
	const options = templates.slice(
		templates.indexOf('<template id="template-mp-member-actions-modal">'),
		templates.indexOf('<template id="template-mp-chat-page">')
	);

	assert.match(options, /v-if="state\.identities\.length > 0"[^>]*state\.open_identities_from_options\(\)/);
	assert.match(options, /template-mp-identities-modal/);
	assert.match(options, /state\.show_identity_actions\(identity\)/);
	assert.match(options, /template-mp-identity-actions-modal/);
	assert.match(options, /MOD_MP_IDENTITY_DELETE_ACTION/);
	assert.match(options, /MOD_MP_IDENTITY_CANCEL_DELETION/);
	assert.match(options, /template-mp-identity-delete-confirm-modal/);
	assert.match(main, /api_get\('\/api\/identities'\)/);
	assert.match(main, /api_post\('\/api\/identities\/delete'/);
	assert.match(main, /api_post\('\/api\/identities\/delete\/cancel'/);
	assert.match(language.MOD_MP_IDENTITY_DELETE_CONFIRM_INFO, /72-hour delay/);
	assert.match(language.MOD_MP_IDENTITY_DELETE_CONFIRM_EFFECTS, /Marketplace listings, Trades, and Gifts canceled/);
});

test('keeps identity and Chat modal branches safe while their previous view tears down', async () => {
	const { templates } = await sources();
	const identity_actions = templates.slice(
		templates.indexOf('<template id="template-mp-identity-actions-modal">'),
		templates.indexOf('<template id="template-mp-identity-account-changed-modal">')
	);
	const chat_view = templates.slice(
		templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-profile-modal">')
	);

	assert.match(identity_actions, /state\.selected_identity\?\.deletion/);
	assert.match(identity_actions, /state\.selected_identity\?\.deletion\?\.execute_at/);
	assert.match(identity_actions, /state\.selected_identity\?\.display_name/);
	assert.match(chat_view, /state\.get_chat_participant_icon\(\)/);
	assert.match(chat_view, /state\.selected_chat_conversation\?\.participant\?\.display_name/);
});

test('uses informational alerts after automatic creation, cancellation, and recovery', async () => {
	const { main, templates, language } = await sources();

	assert.match(main, /activate_multiplayer_identity\(registration\.json\);[\s\S]*queue_identity_notice\('account_changed'\)/);
	assert.match(main, /auth\.json\.deletion_cancelled[\s\S]*queue_identity_notice\('deletion_cancelled'/);
	assert.match(main, /auth\.json\.identity_recovered[\s\S]*queue_identity_notice\('recovered'\)/);
	assert.match(templates, /template-mp-identity-account-changed-modal/);
	assert.match(templates, /template-mp-identity-deletion-cancelled-modal/);
	assert.match(templates, /template-mp-identity-recovered-modal/);
	assert.match(language.MOD_MP_IDENTITY_ACCOUNT_CHANGED_INFO, /created automatically/);
	assert.match(language.MOD_MP_IDENTITY_DELETION_CANCELLED_INFO, /was canceled because this identity was loaded/);
	assert.match(language.MOD_MP_IDENTITY_RECOVERED_INFO, /recovered it as Guildless/);
});
