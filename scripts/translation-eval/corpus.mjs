const item = () => ({ type: 'item', item_id: 'melvorD:Bank_Slot_Token' });
const market = () => ({ type: 'feature', feature_id: 'multiplayer:Multiplayer_Market' });
const text = value => typeof value === 'string' ? { type: 'text', text: value } : value;
const fixture = (id, categories, ...parts) => ({ id, categories, parts: parts.map(text) });
// Stage 3 sources stay unchanged; focused additions are synthetic, never player-history extracts.
export const corpus = [
	fixture('negation', ['negation', 'action'], 'Do not spend 720k GP on the Crucible page yet.'),
	fixture('until-after', ['deadline', 'negation', 'action'], 'Do not spend 640m GP until 24 hours after voting closes on the Crucible page.'),
	fixture('before', ['deadline', 'negation'], 'Spend 320k GP before voting closes on the Crucible page, not after it closes.'),
	fixture('after', ['deadline', 'action'], 'Wait 24 hours after voting closes, then spend 480k GP on the Crucible page.'),
	fixture('eligibility', ['quantity', 'negation', 'deadline'], 'Only members who joined Free Fellowship at least 20 hours before voting began may vote; newer members cannot vote.'),
	fixture('quantity', ['quantity', 'negation'], 'Donate exactly 12 tokens to Crucible; keep at least 250k GP and do not donate all 30 tokens.'),
	fixture('unit-price', ['price', 'quantity', 'negation'], 'Buy two ', item(), ' at ', market(), ' for 175k GP each, not 175k GP in total.'),
	fixture('link-actions', ['action', 'negation'], 'Open ', market(), ' before buying ', item(), '; do not sell it.'),
	fixture('repeated-links', ['price', 'action'], 'Buy one ', item(), ' for 80k GP, then sell a different ', item(), ' for 95k GP at ', market(), '.'),
	fixture('exact-list', ['price', 'action', 'deadline'], 'Enabled mods:\r\n  - add items\r\n  - GOD MODE\r\n  - dev.console\r\n\r\nOpen ', market(), ' and buy one ', item(), ' for 210k gp only after voting closes.'),
	fixture('mixed-en', ['mixed-language', 'negation', 'deadline'], 'Please do not spend 330k GP before voting closes on the Marketplace page; 等待结果。'),
	fixture('mixed-zh', ['mixed-language', 'action', 'negation', 'deadline'], '请不要在投票结束之前花费 440k GP。结束后再打开 Marketplace page，然后购买 ', item(), '。'),
	fixture('ordinary-negative', [], 'The moderator asked a doctor about GP appointments; police raid reports and shopping transfers are unrelated.'),
	fixture('literal-html', ['negation', 'deadline'], 'The mod manager says "<b>do not buy</b>"; wait until tomorrow before spending 120k GP.'),
	fixture('deadline', ['deadline'], 'Voting on the Petition of Interdict closes tomorrow at 18:00 UTC; only votes cast before that time count.'),
	fixture('short-mixed', ['mixed-language', 'deadline', 'price', 'negation'], '不要购买 ', item(), ' until 24 hours after voting closes; price: 150k GP.'),
	fixture('bank-slot-terms', ['terminology', 'quantity', 'price', 'negation'], 'Buy exactly 2 Bank Slot Tokens for 175k GP each; do not sell the last Bank Slot Token.'),
	fixture('guild-member-terms', ['terminology', 'deadline', 'negation'], 'Only members who joined our Guild at least 20 hours ago may vote; newer Guild members cannot vote. VIP members must renew their subscription.'),
	fixture('group-member-terms', ['terminology', 'action'], 'Members of this group can invite a group member. Members of our Guild can open ', item(), '.'),
	fixture('membership-negative', ['terminology'], 'The Guild discussed VIP members and subscription members. Financial banks issue tokens; slot machines accept tokens. Members can renew tomorrow.'),
	fixture('terms-with-mods', ['terminology', 'quantity', 'price', 'negation'], 'Installed Mods:\r\n  - God Mode\r\n  - Add Items\r\n\r\nGuild members must not sell 2 Bank Slot Tokens for 80k GP using the Multitasking mod; open ', item(), '.')
];
