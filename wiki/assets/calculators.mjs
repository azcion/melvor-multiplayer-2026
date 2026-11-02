import { wish_price_micros, wish_gp_cost } from './crucible-rules.mjs';
import { supply_quote } from './supply-math.mjs';

const number = value => new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(value);
const exact_ep = micros => (micros/1_000_000).toFixed(6);
const ep = micros => (micros/1_000_000).toFixed(3);
const integer = input => input.validity.valid && input.value.trim() !== '' && Number.isSafeInteger(input.valueAsNumber) ? input.valueAsNumber : NaN;

const wish = document.querySelector('#wish-calculator');
if (wish) {
	const form = wish.querySelector('form'), item = wish.querySelector('#wish-item');
	const quantity = wish.querySelector('#wish-quantity'), base = wish.querySelector('#wish-base');
	const result = wish.querySelector('#wish-quote'), table = wish.querySelector('.reference-table');
	const rows = [...wish.querySelectorAll('tbody tr')];
	function update() {
		const qty = integer(quantity), b = Number(base.value), price = wish_price_micros(qty,b);
		table.hidden = !price;
		if (!price) { result.textContent = 'Enter a whole quantity from 1 to 1,000 to see the costs.'; return; }
		const selected = item.selectedOptions[0], required = Number(selected.dataset.value)*qty*5;
		result.textContent = `${number(qty)} ${selected.textContent}: ${ep(price)} EP + ${number(wish_gp_cost(required))} GP upfront. The Wish needs ${number(required)} GP equivalent from Offerings after forming; a Reclaim bonus can fund it earlier.`;
		wish.querySelector('#wish-table-caption').textContent = `quantity ${number(qty)} · base ${b}`;
		for (const row of rows) {
			const funding = Number(row.dataset.value)*qty*5;
			row.querySelector('[data-cost="ep"]').textContent = ep(price);
			row.querySelector('[data-cost="gp"]').textContent = number(wish_gp_cost(funding));
			row.querySelector('[data-cost="funding"]').textContent = number(funding);
		}
	}
	form.hidden = false;
	form.addEventListener('input',update); form.addEventListener('change',update);
	form.addEventListener('submit',event => event.preventDefault());
	update();
}
const supply = document.querySelector('#supply-calculator');
if (supply) {
	const form = supply.querySelector('form'), item = supply.querySelector('#supply-item');
	const quantity = supply.querySelector('#supply-quantity'), prior = supply.querySelector('#supply-prior');
	const result = supply.querySelector('#supply-quote');
	function update() {
		const selected = item.selectedOptions[0], unit = Number(selected.dataset.unit), qty = integer(quantity);
		const quote = supply_quote(integer(prior),unit,qty);
		if (!quote) { result.textContent = 'Enter a whole quantity from 1 to 1,000,000,000 and a prior value from 0 to 1,000,000,000,000.'; return; }
		result.textContent = `${number(qty)} ${selected.textContent} × ${number(unit)} GP equivalent = ${number(quote.added)} added value. Your total moves from ${number(quote.total-quote.added)} to ${number(quote.total)} GP equivalent. ${exact_ep(quote.after)} − ${exact_ep(quote.before)} = ${exact_ep(quote.earned)} EP earned.`;
	}
	form.hidden = false;
	form.addEventListener('input',update); form.addEventListener('change',update);
	form.addEventListener('submit',event => event.preventDefault());
	update();
}
