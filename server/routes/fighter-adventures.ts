import { session_get_route, session_post_route } from '../app-runtime';
import { db } from '../db';
import { adventure_action, adventure_state } from '../fighter-adventures';
import type { HandlerResult } from '../http';
export function register_fighter_adventure_routes() {
	session_get_route('/api/adventures/state',(_req,_url,client): HandlerResult => adventure_state(db,client));
	for (const action of ['start','stop','check-in','capacity','reset-capacity','opt-in','seen'])
		session_post_route(`/api/adventures/${action}`, (_req,_url,client,json): HandlerResult => {
			if ('command_id' in json) return 400;
			return db.transaction(() => adventure_action(db,client,action,json)).immediate();
		});
}
