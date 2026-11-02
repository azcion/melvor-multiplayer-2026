import { debug_dungeon, dungeon_debug_options } from '../combat-dungeon-debug';
import { equipment_catalog_response, change_equipment, debug_equipment_project, reset_equipment } from '../equipment-projects';
import { prepare_combat, purchase_combat_levels, reset_combat_levels } from '../combat-progression';
import { session_post_route, session_get_route, is_social_only_client } from '../app-runtime';
import { db } from '../db';
import { COMBAT_PROTOCOL, issue_ticket, read_combat_key } from '../combat/tickets';
import { is_admin } from '../admin_identity';
import { debug_tutorial, tutorial_debug_targets } from '../combat-tutorial';
import { combat_state, combat_inventory_response } from '../combat-inventory';
import { run_economy_command } from '../economy';
import { can_debug_expedition } from '../guild-expedition';
import type { HandlerResult } from '../http';
export function register_combat_routes() {
	session_get_route('/api/combat/inventory', (_req,url,client) => combat_inventory_response(equipment_catalog_response({ ...combat_state(db,client, Number(url.searchParams.get('raid_page') ?? 0)), debug_enabled: can_debug_expedition(client), dungeon_debug_options: is_admin(client) ? dungeon_debug_options() : null, tutorial_debug_targets: is_admin(client) ? tutorial_debug_targets() : [] }, url), url));
	for (const action of ['unlock-slot','unlock-tier','start-project','cancel-project','equip','prepare','level','reset-levels','reset-equipment','debug-project','debug-tutorial','debug-dungeon'] as const) session_post_route(`/api/combat/${action}`, (_req,_url,client,json): HandlerResult => {
		if ((action === 'debug-tutorial' || action === 'debug-dungeon') && !is_admin(client)) return 403;
		if (action === 'debug-project' && !can_debug_expedition(client)) return 403;
		if (is_social_only_client(client)) return 403;
		return run_economy_command(client,json.command_id,`combat-${action}`,() => {
			if (action === 'debug-dungeon') return debug_dungeon(db,client,String(json.command_id),json);
			if (action === 'debug-tutorial') return debug_tutorial(db,client,String(json.command_id),json);
			if (action === 'debug-project') return debug_equipment_project(db,client,String(json.command_id),json);
			if (['unlock-slot','unlock-tier','start-project','cancel-project','equip'].includes(action)) return change_equipment(db,client,String(json.command_id),action,json);
			if (action === 'prepare') {
				const response = prepare_combat(db,client);
				return response;
			}
			if (action === 'level') return purchase_combat_levels(db,client,String(json.command_id),json.upgrades,json.revision);
			if (action === 'reset-equipment') return reset_equipment(db,client,String(json.command_id),json.revision,Date.now(),json.group);
			if (action === 'reset-levels') return reset_combat_levels(db,client,String(json.command_id),json.revision);
			return { success: false, error: 'combat_rejected' };
		}) ?? 400;
	});
	session_post_route('/api/combat/ticket', (_req, _url, client_id): HandlerResult => {
		const key = read_combat_key();
		if (!key || is_social_only_client(client_id)) return { available: false };
		return { available: true, ticket: issue_ticket(client_id, key), socket_path: '/combat/socket', protocol: COMBAT_PROTOCOL };
	});
}
