import type { HandlerResult } from './http';

export const LEGACY_CLIENT_MAX_VERSION = '1.5.1';

const LEGACY_CHAT_CONVERSATION_ID = 0;
const LEGACY_CHAT_TEAM_ID = 0;
const LEGACY_CHAT_ICON_ID = 'multiplayer';
const LEGACY_CHAT_MESSAGE = 'Refresh page to continue using Multiplayer.';

type LegacyClientChatState = {
	client_id: number;
	messaging_enabled: false;
	guild_chat_enabled: false;
	budget_enabled: false;
};

export function is_legacy_client_blocked(mod_version: string | null | undefined): boolean {
	const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(mod_version ?? '');
	if (parts === null)
		return false;
	const [major, minor, patch] = parts.slice(1).map(Number);
	const [max_major, max_minor, max_patch] = LEGACY_CLIENT_MAX_VERSION.split('.').map(Number);
	return major < max_major || (major === max_major && (minor < max_minor || (minor === max_minor && patch < max_patch)));
}

function legacy_chat_message(created_at: number) {
	return {
		message_id: LEGACY_CHAT_CONVERSATION_ID,
		conversation_id: LEGACY_CHAT_CONVERSATION_ID,
		sender_id: null,
		sender: { display_name: 'System', icon_id: LEGACY_CHAT_ICON_ID },
		content: LEGACY_CHAT_MESSAGE,
		created_at,
		author_side: 'team',
		sent_by_viewer: false
	};
}

function legacy_chat_conversation(created_at: number) {
	return {
		conversation_kind: 'support',
		conversation_id: LEGACY_CHAT_CONVERSATION_ID,
		support_team_id: LEGACY_CHAT_TEAM_ID,
		viewer_side: 'player',
		participant: { client_id: null, display_name: 'System', icon_id: LEGACY_CHAT_ICON_ID },
		created_at,
		latest_message: legacy_chat_message(created_at),
		unread_count: 1,
		blocked: false
	};
}

function is_legacy_chat_message_request(url: URL): boolean {
	return url.searchParams.get('conversation_kind') === 'support' &&
		url.searchParams.get('conversation_id') === String(LEGACY_CHAT_CONVERSATION_ID) &&
		url.searchParams.get('support_team_id') === String(LEGACY_CHAT_TEAM_ID);
}

function legacy_client_events() {
	return {
		revision: 0,
		friend_requests: [],
		guild_applicants: [],
		gifts: [],
		trades: [],
		resolved_trades: [],
		economy_receipts: [],
		market_completed: [],
		haggle_pending: 0,
		banishment_return_pending: false,
		inbox_pending: false,
		chat_unread: 1
	};
}

export function legacy_client_chat_state(mod_version: string | null | undefined, client_id: number): LegacyClientChatState | null {
	return is_legacy_client_blocked(mod_version)
		? { client_id, messaging_enabled: false, guild_chat_enabled: false, budget_enabled: false }
		: null;
}

export function legacy_client_compatibility_response(
	req: Request,
	url: URL,
	mod_version: string | null | undefined,
	client_id: number
): HandlerResult | null {
	if (!is_legacy_client_blocked(mod_version))
		return null;

	if (req.method === 'GET' && url.pathname === '/api/chat/state')
		return legacy_client_chat_state(mod_version, client_id);
	if (req.method === 'GET' && url.pathname === '/api/events')
		return legacy_client_events();
	if (req.method === 'GET' && url.pathname === '/api/chat/conversations') {
		const created_at = Date.now();
		return {
			conversations: [legacy_chat_conversation(created_at)],
			guild_chat: { affiliated: false, enabled: false }
		};
	}
	if (req.method === 'GET' && url.pathname === '/api/chat/messages' && is_legacy_chat_message_request(url))
		return { messages: [legacy_chat_message(Date.now())], has_more: false };

	return 403;
}
