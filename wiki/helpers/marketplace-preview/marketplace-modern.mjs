'use strict';
const $ = selector => document.querySelector(selector);
const num = number => number.toLocaleString('en-US');
const money = (number, currency) => num(number) + ' ' + currency;
const button = (action, label, id = '', css = '') =>
  '<button class="' + css + '" data-action="' + action + '" data-id="' + id + '">' + label + '</button>';
const items = [
  ['coal','Coal Ore','🪨',4800], ['potion','Generous Harvest Potion','🧪',64],
  ['essence','Rune Essence','💠',600], ['stardust','Stardust','✨',800],
  ['whale','Raw Whale','🐋',220], ['bars','Dragonite Bar','🧱',160],
  ['dust','Holy Dust','✦',440], ['token','Bank Slot Token','🪙',2]
].map(([id,name,icon,bank]) => ({id,name,icon,bank}));
const byItem = id => items.find(item => item.id === id);
let uid = 0;
const offers = [
 ['coal','sell','Orin',520,'GP',13500,4], ['potion','sell','Mira',7900,'GP',250,7],
 ['coal','buy','Tess',430,'GP',4800,9], ['stardust','buy','Rhea',1850,'GP',1800,10],
 ['coal','sell','Jun',490,'GP',2600,12], ['whale','sell','Iona',5,'SC',200,15],
 ['potion','sell','Arden',6800,'GP',400,21], ['essence','sell','Lark',140,'GP',10000,25],
 ['token','sell','Rowan',1500000,'GP',8,30], ['potion','buy','Rowan',5900,'GP',120,43],
 ['bars','sell','Orin',25000,'GP',190,65], ['essence','buy','Tess',105,'GP',20000,110],
 ['dust','buy','Vale',200,'GP',350,122], ['whale','sell','Vale',3450,'GP',450,160]
].map(([item,side,owner,price,currency,qty,age]) => ({ id:++uid,item,side,owner,price,currency,qty,age }));
const history = {
 coal:{GP:[460,510,8,0]}, potion:{GP:[6400,7800,9,0]}, essence:{GP:[100,135,5,0]},
 whale:{GP:[3400,3400,1,2],SC:[5,5,1,4]}, stardust:{GP:[1700,1700,1,9]}, bars:{GP:[25000,25000,1,12]}
};
const wallet = {GP:40000000,SC:1800};
let view = 'market', exact = null, confirmFn = null, feedbackTimer;
function toast(message) {
 clearTimeout(feedbackTimer);
 $('#feedback').textContent = message;
 feedbackTimer = setTimeout(() => $('#feedback').textContent = '', 4200);
}
const age = n => n === 0 ? 'Just now' : n < 60 ? n + ' min ago' : Math.floor(n/60) + 'h ago';
function priceContext(o) {
 const sample = history[o.item]?.[o.currency];
 if (!sample) return 'No recent ' + o.currency + ' trades';
 const [low,high,count,days] = sample;
 if (count === 1) return 'Last trade: ' + money(low,o.currency) + ' · ' + days + (days===1?' day ago':' days ago');
 return 'Recent trades: ' + num(low) + '–' + money(high,o.currency) + ' · ' + count + ' in 28 days';
}
function row(o) {
 const i = byItem(o.item), isSell = o.side === 'sell';
 return '<article class="listing"><div class="who"><button class="itemlink" data-action="exact" data-id="' + i.id + '" aria-label="Show all listings for ' + i.name + '"><span class="icon" aria-hidden="true">' + i.icon + '</span><strong>' + i.name + '</strong></button><div class="context"><span class="' + (isSell?'selling':'wanted') + '">' + (isSell?'For sale':'Wanted') + '</span> · ' + o.owner + ' · ' + age(o.age) + '</div></div>'+
 '<div class="price"><strong>' + money(o.price,o.currency) + ' each</strong><span class="context">' + priceContext(o) + '</span></div>'+
 '<div class="rowaction"><span class="context">' + num(o.qty) + (isSell?' available':' wanted') + '</span>' +
 (o.owner==='You'?button('remove','Cancel',o.id,'quiet'):button('trade',isSell?'Buy':'Sell',o.id,'primary')) + '</div></article>';
}
function render() {
 const market = view === 'market';
 $('#nav').innerHTML = [['market','Listings'],['orders','My listings']].map(([id,label])=>
  '<button data-action="nav" data-id="' + id + '" aria-pressed="' + (view === id) + '">' + label + '</button>').join('');
 $('#wallet').textContent = money(wallet.GP,'GP') + ' · ' + money(wallet.SC,'SC');
 $('#filters').hidden = !market;
 const search = $('#search'), direction = $('#direction'), currency = $('#currency');
 search.readOnly = !!exact;
 direction.disabled = currency.disabled = !!exact;
 $('#exact').hidden = !market || !exact;
 $('#exact').innerHTML = exact ? '<strong>All offers for ' + byItem(exact.id).name + '</strong>' + button('clear','Clear item filter','','quiet') : '';
 const term = search.value.trim().toLowerCase();
 const list = offers.filter(o=>o.qty>0 && (market ? o.owner!=='You' &&
  (exact ? o.item===exact.id : byItem(o.item).name.toLowerCase().includes(term) &&
   (direction.value==='all'||o.side===direction.value) && (currency.value==='All currencies'||o.currency===currency.value))
  : o.owner==='You')).sort((a,b)=>a.age-b.age||b.id-a.id);
 $('#content').innerHTML='<section class="sheet"><div class="between listing-head"><h2>'+(market?(exact?'Open listings':'Recent listings'):'My listings')+'</h2><small>'+list.length+' open</small></div>'+
  (list.map(row).join('')||'<p class="empty">No open listings match.</p>')+'</section>';
}
function clearExact(restore = true) {
 if (!exact) return;
 const previous=exact;
 exact=null;
 $('#search').value=previous.term;
 render();
 if(restore){
  $('#content [data-action="exact"][data-id="'+previous.id+'"]')?.focus({preventScroll:true});
  window.scrollTo(0,previous.scroll);
 }
}
function selectExact(id){
 if(exact?.id===id)return;
 if(exact)clearExact(false);
 exact={id,term:$('#search').value,scroll:window.scrollY};
 $('#search').value=byItem(id).name; view='market'; render();
 $('#exact button').focus({preventScroll:true});
 window.scrollTo(0,0);
}
function modal(title,html,label){
 $('#dialogTitle').textContent=title;$('#dialogBody').innerHTML=html;$('#confirm').textContent=label;$('#confirm').disabled=false;
 if(!$('#dialog').open)$('#dialog').showModal();
}
function trade(o){
 const i=byItem(o.item), buying=o.side==='sell';
 const cap=()=>Math.min(o.qty,buying?Math.floor(wallet[o.currency]/o.price):i.bank);
 const limit=cap();
 if(o.owner==='You')return;
 modal((buying?'Buy from ':'Sell to ')+o.owner,
 '<p class="muted">'+i.name+' · '+money(o.price,o.currency)+' each</p><div class="fields section"><label>Quantity<input id="tradeQty" type="number" min="1" max="'+limit+'" value="1"></label></div><p id="tradeTotal" class="summary" aria-live="polite"></p>'+
 '',
 buying?'Confirm purchase':'Confirm sale');
 const field=$('#tradeQty');
 const sync=()=>{const q=field.valueAsNumber,valid=Number.isSafeInteger(q)&&q>=1&&q<=limit;
 $('#confirm').disabled=!valid;$('#tradeTotal').textContent=valid?'Total: '+money(q*o.price,o.currency):limit?'Enter 1–'+num(limit)+'.':'Your balance or Bank stock is too low.';};
 field.oninput=sync;sync();
 confirmFn=()=>{const q=field.valueAsNumber;if(!Number.isSafeInteger(q)||q<1||q>cap())return;
 const total=q*o.price;o.qty-=q;i.bank+=buying?q:-q;wallet[o.currency]+=buying?-total:total;
 $('#dialog').close();render();toast((buying?'Bought ':'Sold ')+num(q)+' × '+i.name+(buying?' from ':' to ')+o.owner+'.');};
}
function create(id){
 modal('Create listing','<div class="fields"><label>Type<select id="newSide"><option value="sell">Sell Listing</option><option value="buy">Buy Order</option></select></label>'+
 '<label>Item<select id="newItem">'+items.map(i=>'<option value="'+i.id+'">'+i.name+'</option>').join('')+'</select></label>'+
 '<label>Quantity<input id="newQty" type="number" min="1" value="10"></label><label>Unit price<input id="newPrice" type="number" min="1" value="100"></label>'+
 '<label>Currency<select id="newCurrency"><option>GP</option><option>SC</option></select></label></div><p id="preview" class="summary" aria-live="polite"></p><div id="newGuide" class="section"></div>','Publish listing');
 if(id||exact)$('#newItem').value=id||exact.id;
 const read=()=>({side:$('#newSide').value,i:byItem($('#newItem').value),qty:$('#newQty').valueAsNumber,price:$('#newPrice').valueAsNumber,c:$('#newCurrency').value});
 function sync(){
  const currencyField=$('#newCurrency');
  if($('#newSide').value==='buy')currencyField.value='GP';
  currencyField.disabled=$('#newSide').value==='buy';
  const {side,i,qty,price,c}=read(), total=qty*price, integers=[qty,price,total].every(n=>Number.isSafeInteger(n)&&n>0);
  const valid=integers&&(side==='sell'?qty<=i.bank:total<=wallet[c]);
  $('#preview').textContent=(side==='sell'?num(i.bank)+' in your Bank':money(wallet[c],c)+' available')+(integers?' · '+(side==='sell'?'Total if sold: ':'Set aside now: ')+money(total,c):' · Enter a positive quantity and price.');
  const prices=priceContext({item:i.id,currency:c});
  $('#newGuide').innerHTML='<div class="guide"><strong>Recent '+c+' trades</strong><small>'+prices+'</small></div>';
  $('#confirm').disabled=!valid;return valid;
 }
 $('#dialogBody').oninput=sync;sync();
 confirmFn=()=>{if(!sync())return;const {side,i,qty,price,c}=read();if(side==='sell')i.bank-=qty;else wallet[c]-=qty*price;
 offers.push({id:++uid,item:i.id,side,owner:'You',price,currency:c,qty,age:0});$('#dialog').close();view='orders';render();toast(side==='sell'?'Sell Listing published.':'Buy Order published.');};
}

$('#confirm').onclick=()=>confirmFn?.();
$('#dialog').addEventListener('close',()=>{$('#dialogBody').oninput=null;confirmFn=null;});
document.addEventListener('click',event=>{
 const control=event.target.closest('[data-action]');
 if(!control)return;
 const {action,id}=control.dataset;
 if(action==='exact')selectExact(id);
 if(action==='clear')clearExact();
 if(action==='nav'){clearExact(false);view=id;render();}
 if(action==='create')create(id);
 if(action==='close')$('#dialog').close();
 if(action==='trade')trade(offers.find(o=>o.id===Number(id)));
 if(action==='remove'){
  const o=offers.find(o=>o.owner==='You'&&o.id===Number(id));
  if(!o)return;
  if(o.side==='sell')byItem(o.item).bank+=o.qty;
  else wallet[o.currency]+=o.qty*o.price;
  o.qty=0;render();toast('Listing cancelled.');
 }
});
for(const id of ['search','direction','currency'])$('#'+id).oninput=render;
render();
