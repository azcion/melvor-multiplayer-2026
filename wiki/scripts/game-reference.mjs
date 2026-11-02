import { readFile } from 'node:fs/promises';
import { crucible_heat, CRUCIBLE_PROGRESS_MAX } from '../../server/crucible-values.ts';
import { wish_price_micros, capacity_price_micros } from '../../server/wish-capacity.ts';
import { wish_gp_cost } from '../../mod/crucible-rules.mjs';

const number = value => new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(value);
const ep = micros => (micros / 1_000_000).toFixed(3);
export async function load_game_reference() {
	const wishes = JSON.parse(await readFile(new URL('../../server/openable-wish-values.json',import.meta.url),'utf8'));
	wishes.sort((a,b) => a.name.localeCompare(b.name,'en'));
	return {wishes};
}
function table(caption,head,rows,e) {
	return `<div class="reference-table" tabindex="0" role="region" aria-label="${e(caption)}"><table><caption>${e(caption)}</caption><thead><tr>${head.map(h => `<th scope="col">${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell,i) => i === 0 ? `<th scope="row">${e(cell)}</th>` : `<td>${e(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function wish_curve() {
	const x = v => 55+v/1000*530;
	const y = v => 215-v/60*170;
	const points = b => Array.from({length:101},(_,i) => `${x(i*10)},${y(i === 0 ? 0 : wish_price_micros(i*10,b)/1e6)}`).join(' ');
	return `<figure class="formula-chart"><svg viewBox="0 0 620 270" role="img" aria-label="Wish EP costs grow with quantity. At 1000 items, base 100 costs 55 EP and base 500 costs 21 EP."><path class="chart-axis" d="M55 35V215H595"/>${[0,20,40,60].map(v => `<text x="45" y="${y(v)+4}" text-anchor="end">${v}</text>`).join('')}${[0,250,500,750,1000].map(v => `<text x="${x(v)}" y="237" text-anchor="middle">${number(v)}</text>`).join('')}<text x="55" y="20">EP</text><text x="320" y="263" text-anchor="middle">Wish quantity</text><polyline class="chart-line" points="${points(100)}"/><polyline class="chart-line chart-secondary" points="${points(500)}"/></svg><figcaption>Green: base 100. Gold: base 500. Larger Wishes cost progressively more EP; capacity makes the first items cheaper.</figcaption></figure>`;
}
export function render_game_reference(kind, data, e) {
	if (kind === 'heat-table') {
		const thresholds = [0,1,1000,10000,100000,1000000,10000000,100000000,1000000000,10000000000];
		return table('Heat and time from zero progress at a constant tier',['Tier','Heat value at least','Points/min','Time to 10,080 points'],thresholds.map(value => {
			const heat = crucible_heat(value), minutes = heat.points_per_minute ? Math.ceil(CRUCIBLE_PROGRESS_MAX/heat.points_per_minute) : null;
			return [heat.tier,number(value),heat.points_per_minute,minutes === null ? 'Paused' : `${Math.floor(minutes/60)}h ${minutes%60}m`];
		}),e);
	}
	if (kind === 'wish-gp') return `<figure class="worked-wish"><figcaption>Example: wish for 100 Torn Parchment at base 100</figcaption><ol class="formula-flow"><li><span>Item value × quantity</span><strong>100 × 100 = 10,000</strong><small>V = 100 GP equivalent per item</small></li><li><span>Offering requirement: × 5</span><strong>50,000 GP equivalent</strong><small>This much value must fund the Wish</small></li><li><span>GP payment: half, rounded up</span><strong>25,000 GP upfront</strong><small>Plus 1.000 EP to make the Wish</small></li></ol><p>The 25,000 GP becomes an Offering. The Wish still starts with no funding; it needs to form and receive 50,000 GP equivalent.</p></figure>`;
	if (kind === 'wish-ep') return wish_curve()+table('EP examples: exact charges',['Quantity','Base 100','Base 200','Base 300','Base 400','Base 500'],[1,50,100,101,200,201,300,500,1000].map(q => [q,...[100,200,300,400,500].map(b => ep(wish_price_micros(q,b))+' EP')]),e);
	if (kind === 'capacity') return table('Capacity lasts 30 days; renewal costs the full tier price',['Base quantity B','Buy from base 100','Renew each 30 days'],[100,200,300,400,500].map(b => [b,b === 100 ? 'Free' : ep(capacity_price_micros(b))+' EP',b === 100 ? 'Free' : ep(capacity_price_micros(b))+' EP']),e);
	if (kind === 'wish-catalog') {
		const selected = data.wishes.find(w => w.id === 'melvorAoD:Torn_Parchment');
		return `<div class="calculator" id="wish-calculator"><h3>Try a Wish</h3><form class="calculator-controls" hidden><div><label for="wish-item">Wish item</label><select id="wish-item">${data.wishes.map(w => `<option value="${e(w.id)}" data-value="${w.max_item_value}"${w.id === selected.id ? ' selected' : ''}>${e(w.name)}</option>`).join('')}</select></div><div><label for="wish-quantity">Quantity (1–1,000)</label><input id="wish-quantity" type="number" min="1" max="1000" step="1" value="100"></div><div><label for="wish-base">Your capacity base B</label><select id="wish-base">${[100,200,300,400,500].map(b => `<option>${b}</option>`).join('')}</select></div></form><div id="wish-quote" class="formula-result" role="status" aria-live="polite">100 Torn Parchment: 1.000 EP + 25,000 GP upfront. The Wish needs 50,000 GP equivalent from Offerings after forming; a Reclaim bonus can fund it earlier.</div><p>Changing quantity or capacity updates every row below. The EP charge is the same for every item at the same quantity and capacity. Without JavaScript, this table shows 100 items at base 100.</p><div class="reference-table" tabindex="0" role="region" aria-label="All wishable items and costs"><table id="wish-cost-table"><caption>All ${data.wishes.length} wishable items · <span id="wish-table-caption">quantity 100 · base 100</span></caption><thead><tr><th scope="col">Item</th><th scope="col">Value V</th><th scope="col">EP paid</th><th scope="col">GP paid upfront</th><th scope="col">Offering value needed</th></tr></thead><tbody>${data.wishes.map(w => {
			const required = w.max_item_value*100*5;
			return `<tr data-value="${w.max_item_value}"><th scope="row">${e(w.name)}<small>${e(w.id)}</small></th><td>${number(w.max_item_value)}</td><td data-cost="ep">1.000</td><td data-cost="gp">${number(wish_gp_cost(required))}</td><td data-cost="funding">${number(required)}</td></tr>`;
		}).join('')}</tbody></table></div></div>`;
	}

	return '';
}
