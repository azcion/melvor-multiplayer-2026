import { register_alliance_routes } from './routes/alliances';
import { register_market_routes } from './routes/market';
import { register_campaign_routes } from './routes/campaign';
import { register_charity_routes } from './routes/charity';
import { register_crucible_routes } from './routes/crucible';
import { register_banishment_returns_routes } from './routes/banishment_returns';
import { register_inbox_routes } from './routes/inbox';
import { register_transfer_routes } from './routes/transfer';
import { register_trade_routes } from './routes/trade';
import { register_gifting_routes } from './routes/gifting';
import { register_guilds_routes } from './routes/guilds';
import { register_raids_routes } from './routes/raids';
import { register_equipment_routes } from './routes/equipment';
import { register_player_status_routes } from './routes/player_status';
import { register_icon_catalog_routes } from './routes/icon_catalog';
import { register_chat_routes } from './routes/chat';
import { register_friends_routes } from './routes/friends';
import { register_identities_routes } from './routes/identities';
import { register_general_routes } from './routes/general';
import { register_auth_routes } from './routes/auth';
import { register_updates_routes } from './routes/updates';
import { register_social_mode_routes } from './routes/social_mode';
import { register_haggle_routes } from './routes/haggle';
import { register_poll_routes } from './routes/polls';
import { register_expedition_routes } from './routes/expedition';
import { register_guild_expedition_routes } from './routes/guild_expedition';
import { maintain_market_listings } from './market-expiry';
import { chat_translation_worker, default_handler, expire_charity_items_now, flush_logs, report_error, server } from './app-runtime';
import { create_shutdown_handler } from './shutdown';
import { maintain_inactive_expeditions } from './guild-expedition';
import { maintain_crucibles } from './crucible-service';
import { maintain_raids } from './raid';

register_market_routes();
register_campaign_routes();
register_charity_routes();
register_crucible_routes();
register_banishment_returns_routes();
register_inbox_routes();
register_transfer_routes();
register_trade_routes();
register_gifting_routes();
register_guilds_routes();
register_alliance_routes();
register_raids_routes();
register_equipment_routes();
register_player_status_routes();
register_icon_catalog_routes();
register_chat_routes();
register_friends_routes();
register_identities_routes();
register_general_routes();
register_auth_routes();
register_updates_routes();
register_social_mode_routes();
register_haggle_routes();
register_poll_routes();
register_expedition_routes();
register_guild_expedition_routes();
maintain_market_listings();
maintain_inactive_expeditions(expire_charity_items_now);
const crucible_maintenance_timer = setInterval(() => {
	try { maintain_crucibles(); }
	catch (error) { report_error('Crucible maintenance failed', error); }
}, 60_000);
crucible_maintenance_timer.unref();
try { maintain_crucibles(); }
catch (error) { report_error('Crucible startup maintenance failed', error); }
const expedition_maintenance_timer = setInterval(() => {
	try {
		maintain_inactive_expeditions(expire_charity_items_now);
	} catch (error) {
		report_error('Expedition inactivity maintenance failed', error);
	}
}, 6 * 60 * 60 * 1000);
expedition_maintenance_timer.unref();
const raid_maintenance_timer = setInterval(() => {
	try { maintain_raids(); }
	catch (error) { report_error('Raid schedule maintenance failed', error); }
}, 30_000);
raid_maintenance_timer.unref();
try { maintain_raids(); }
catch (error) { report_error('Raid startup maintenance failed', error); }
chat_translation_worker.start();

server.error((err: Error) => {
	report_error('unhandled request error', err);
	return default_handler(500);
});

server.default((req, status_code) => default_handler(status_code));

server.start();
const shutdown = create_shutdown_handler(
	() => {
		clearInterval(expedition_maintenance_timer);
		clearInterval(raid_maintenance_timer);
		chat_translation_worker.stop();
		return server.stop();
	},
	flush_logs,
	() => process.exit(0)
);
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
