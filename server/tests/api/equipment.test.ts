import { describe, expect, test } from 'bun:test';
import { make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json, register_client } from '../support/http';

type EquipmentSlot = { slot_id: string; item_id: string };

async function sync_equipment(session_token: string, slots: EquipmentSlot[]) {
	return post_json<{ success?: boolean; error_lang?: string }>(
		'/api/client/equipment/sync',
		{ slots },
		session_token
	);
}

async function get_equipment(session_token: string, client_id: number) {
	return get_json_with_session<{
		client_id?: number;
		slots?: EquipmentSlot[];
		error_lang?: string;
	}>(`/api/guilds/equipment?client_id=${client_id}`, session_token);
}

describe('equipment snapshot API', () => {
	test('stores sparse identity-owned snapshots and exposes roster availability hints', async () => {
		const pair = await make_guildmates('Equipment Owner', 'Equipment Viewer');
		const slots = [
			{ slot_id: 'melvorD:Helmet', item_id: 'melvorD:Bronze_Helmet' },
			{ slot_id: 'exampleMod:Gem', item_id: 'exampleMod:Bright_Gem' }
		];

		const saved = await sync_equipment(pair.first.session_token, slots);
		const viewed = await get_equipment(pair.second.session_token, pair.first_id);
		const state = await get_json_with_session<{
			members: Array<{ client_id: number; equipment_visible: boolean; equipment_available: boolean }>;
		}>('/api/guilds/state', pair.second.session_token);
		const owner = state.json.members.find(member => member.client_id === pair.first_id);

		expect(saved.json.success).toBe(true);
		expect(viewed.json).toEqual({
			client_id: pair.first_id,
			slots: [slots[1], slots[0]]
		});
		expect(owner).toMatchObject({ equipment_visible: true, equipment_available: true });
	});

	test('authorizes every read against current same-Guild membership', async () => {
		const pair = await make_guildmates('Private Owner', 'Former Viewer');
		const outsider = await register_client('Outside Viewer');
		await sync_equipment(pair.first.session_token, [
			{ slot_id: 'melvorD:Weapon', item_id: 'melvorD:Bronze_Sword' }
		]);

		const outside = await get_equipment(outsider.session_token, pair.first_id);
		await post_json('/api/guilds/leave', {}, pair.second.session_token);
		const former = await get_equipment(pair.second.session_token, pair.first_id);

		expect(outside.json.error_lang).toBe('MOD_MP_GUILD_MEMBERSHIP_MISSING');
		expect(former.json.error_lang).toBe('MOD_MP_GUILD_MEMBERSHIP_MISSING');
	});

	test('deletes a snapshot on opt-out and requires a new upload after opt-in', async () => {
		const pair = await make_guildmates('Visibility Owner', 'Visibility Viewer');
		await sync_equipment(pair.first.session_token, [
			{ slot_id: 'melvorD:Cape', item_id: 'melvorD:Fire_Cape' }
		]);

		const disabled = await post_json<{ success: boolean; visible: boolean }>(
			'/api/client/equipment/visibility',
			{ visible: false },
			pair.first.session_token
		);
		const hidden = await get_equipment(pair.second.session_token, pair.first_id);
		const rejected_sync = await sync_equipment(pair.first.session_token, []);
		const enabled = await post_json<{ success: boolean; visible: boolean }>(
			'/api/client/equipment/visibility',
			{ visible: true },
			pair.first.session_token
		);
		const missing = await get_equipment(pair.second.session_token, pair.first_id);

		expect(disabled.json).toEqual({ success: true, visible: false });
		expect(hidden.json.error_lang).toBe('MOD_MP_EQUIPMENT_SHARING_DISABLED');
		expect(rejected_sync.json.error_lang).toBe('MOD_MP_EQUIPMENT_SHARING_DISABLED');
		expect(enabled.json).toEqual({ success: true, visible: true });
		expect(missing.json.error_lang).toBe('MOD_MP_EQUIPMENT_NOT_AVAILABLE');
	});

	test('accepts an empty snapshot and rejects malformed, duplicate, or oversized input', async () => {
		const owner = await register_client('Boundary Owner');
		const empty = await sync_equipment(owner.session_token, []);
		const duplicate = await post('/api/client/equipment/sync', {
			slots: [
				{ slot_id: 'melvorD:Ring', item_id: 'melvorD:Gold_Ring' },
				{ slot_id: 'melvorD:Ring', item_id: 'melvorD:Silver_Ring' }
			]
		}, owner.session_token);
		const malformed = await post('/api/client/equipment/sync', {
			slots: [{ slot_id: 'not-namespaced', item_id: 'melvorD:Gold_Ring' }]
		}, owner.session_token);
		const too_many = await post('/api/client/equipment/sync', {
			slots: Array.from({ length: 33 }, (_, index) => ({
				slot_id: `test:Slot_${index}`,
				item_id: `test:Item_${index}`
			}))
		}, owner.session_token);
		const oversized = await post('/api/client/equipment/sync', {
			slots: [{ slot_id: `test:${'x'.repeat(252)}`, item_id: 'test:Item' }]
		}, owner.session_token);

		expect(empty.json.success).toBe(true);
		for (const response of [duplicate, malformed, too_many, oversized])
			expect(response.status).toBe(400);
	});
});
