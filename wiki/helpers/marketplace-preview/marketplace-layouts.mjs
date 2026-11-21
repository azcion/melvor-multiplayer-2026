'use strict';
const mode=document.body.className;
const $=s=>document.querySelector(s);
const num=n=>new Intl.NumberFormat('en').format(n);
const money=(n,c)=>num(n)+' '+c;
const items=[
 ['potion','Generous Harvest Potion','Herblore','🧪',64],
 ['coal','Coal Ore','Mining','🪨',4800],
 ['essence','Rune Essence','Runecrafting','💠',600],
 ['stardust','Stardust','Astrology','✨',800],
 ['whale','Raw Whale','Fishing','🐋',220],
 ['token','Bank Slot Token','Utility','🪙',2],
 ['bars','Dragonite Bar','Smithing','🧱',160],
 ['dust','Holy Dust','Prayer','✦',440]
].map(([id,name,category,icon,bank])=>({id,name,category,icon,bank}));
const stalls=[
 {id:'garden',name:'The Potion Garden',owner:'Mira',specialty:'Herblore supplies',icon:'🌿'},
 {id:'forge',name:'The Ember Forge',owner:'Orin',specialty:'Ore and bars',icon:'⚒️'}
];
let uid=0;
const offers=[
 ['potion','sell','Arden',6800,'GP',400],['potion','sell','Mira',7900,'GP',250,'garden'],
 ['potion','sell','Mira',2,'EP',180,'garden'],['potion','sell','Ember',1,'EP',500,'',true],
 ['potion','buy','Rowan',5900,'GP',120],['potion','buy','Iona',1,'EP',75],
 ['coal','sell','Orin',520,'GP',13500,'forge'],['coal','sell','Jun',490,'GP',2600],
 ['coal','buy','Tess',430,'GP',4800],['essence','sell','Lark',140,'GP',10000],['essence','buy','Tess',105,'GP',20000],
 ['stardust','buy','Rhea',1850,'GP',1800],['whale','sell','Vale',3450,'GP',450],
 ['whale','sell','Iona',5,'SC',200],['token','sell','Rowan',6,'EP',8],
 ['bars','sell','Orin',25000,'GP',190,'forge'],['dust','buy','Vale',3,'SC',350]
].map(([item,side,owner,price,currency,qty,stall='',sibling=false])=>({id:++uid,item,side,owner,price,currency,qty,stall,sibling}));
const history={
 potion:{GP:[6400,6500,6700,6850,7000,7100,7500,7600,7800],EP:[1,2]},
 coal:{GP:[420,450,460,470,480,490,500,520]},essence:{GP:[100,105,115,125,135]},
 whale:{GP:[3200,3400],SC:[5]},stardust:{GP:[1700]},bars:{GP:[21500,25000]},dust:{SC:[3]}
};
const titles={catalog:'Browse grouped items and open an item to compare offers.',desk:'Compare Buy Orders, Sell Listings, and recent prices side by side.',bazaar:'Browse the Guild market or shop with a specialist.'};
const wallet={GP:40000000,SC:1800,EP:36};
let epLeft=24, view='market', selected=mode==='desk'?'potion':'', stallId='', personalStall=null, confirmFn=null, feedbackTimer;
const itemFor=id=>items.find(i=>i.id===id);
const currency=()=>$('#currency').value;
const currentOffers=id=>offers.filter(o=>o.item===id&&o.qty>0&&(currency()==='All currencies'||o.currency===currency()));
const own=o=>o.owner==='You';
const cap=(o,i)=>o.sibling||own(o)?0:Math.min(o.qty,o.side==='sell'?Math.floor(wallet[o.currency]/o.price):i.bank,o.currency==='EP'?Math.floor(epLeft/o.price):Infinity);
const toast=msg=>{clearTimeout(feedbackTimer);$('#feedback').textContent=msg;feedbackTimer=setTimeout(()=>$('#feedback').textContent='',4200)};
const button=(action,label,id='',css='')=>'<button class="'+css+'" data-action="'+action+'" data-id="'+id+'">'+label+'</button>';
function nav(){
 const tabs=mode==='bazaar'?[['market','Guild market'],['stalls','Vendor stalls'],['orders','My listings']]:[['market','Browse'],['orders','My listings'],['stalls','Vendor stalls']];
 $('#nav').innerHTML=tabs.map(([id,label])=>'<button data-action="nav" data-id="'+id+'" aria-pressed="'+(view===id)+'">'+label+'</button>').join('');
 $('#wallet').textContent=money(wallet.EP,'EP')+' balance · '+money(epLeft,'EP')+' left to trade';
}
function card(i){
 const os=currentOffers(i.id), sells=os.filter(o=>o.side==='sell').length, buys=os.filter(o=>o.side==='buy').length;
 return '<button class="tile '+(selected===i.id?'selected':'')+'" data-action="item" data-id="'+i.id+'"><span class="titleline"><span class="icon" aria-hidden="true">'+i.icon+'</span><span><strong>'+i.name+'</strong><small>'+i.category+'</small></span></span><span class="line"><span>'+sells+' for sale</span><span>'+buys+' buy orders</span></span></button>';
}
function guide(i){
 const offered=[...new Set(currentOffers(i.id).map(o=>o.currency))];
 const cs=currency()==='All currencies'?[...new Set([...offered,...Object.keys(history[i.id]||{})])]:[currency()];
 return '<div class="guide"><div class="between"><strong>Recent trade prices</strong><small>Last 28 days</small></div>'+
 (cs.map(c=>{
  const ps=(history[i.id]||{})[c]||[];
  const median=ps.length?(ps[Math.floor((ps.length-1)/2)]+ps[Math.ceil((ps.length-1)/2)])/2:0;
  return '<div class="statline"><b class="gold">'+c+'</b><span>'+(!ps.length?'No recent trades':ps.length<5?'Last trade '+money(ps.at(-1),c):'Typical '+money(median,c))+'</span>'+
  '<small>'+(ps.length?ps.length+' '+(ps.length===1?'trade':'trades')+(ps.length<5?' · limited history':' · '+num(ps[0])+'–'+num(ps.at(-1))+' '+c):'')+'</small></div>';
 }).join('')||'<small>No recent trades</small>')+'</div>';
}
function row(o){
 const ownOffer=own(o), ps=(history[o.item]||{})[o.currency]||[];
 const label=ps.length>=5?(o.price<ps[0]?'Below recent range':o.price>ps.at(-1)?'Above recent range':'Within recent range'):'';
 const text=o.sibling?'Same Melvor account':ownOffer?'Your listing':num(o.qty)+' available';
 return '<div class="offer"><div><strong>'+o.owner+'</strong><small>'+text+'</small>'+(o.stall?'<small>'+stalls.find(s=>s.id===o.stall).name+'</small>':'')+'</div><div><b>'+money(o.price,o.currency)+'</b><small>'+label+'</small></div>'+
 (o.sibling?'<button disabled>Blocked</button>':ownOffer?button('remove','Cancel',o.id,'quiet'):button('trade',o.side==='sell'?'Buy':'Sell',o.id))+'</div>';
}
function detail(i,back=true){
 const os=currentOffers(i.id);
 return '<section class="sheet" id="itemDetail">'+(back?button('back','← Browse items','','quiet'):'')+
 '<div class="between detailtitle"><div class="titleline"><span class="icon" aria-hidden="true">'+i.icon+'</span><div><h2>'+i.name+'</h2><small>'+num(i.bank)+' in your Bank</small></div></div>'+button('create','+ List this item',i.id)+'</div>'+guide(i)+
 '<div class="offers">'+[['sell','Sell Listings'],['buy','Buy Orders']].map(([side,title])=>{
 const list=os.filter(o=>o.side===side).sort((a,b)=>a.currency.localeCompare(b.currency)||(side==='sell'?a.price-b.price:b.price-a.price));
 return '<section class="box"><h3>'+title+'</h3>'+(list.map(row).join('')||'<p class="empty">No open '+title.toLowerCase()+'.</p>')+'</section>';
 }).join('')+'</div></section>';
}
function stallTiles(){
 return '<div class="stalls">'+stalls.map(s=>'<article class="stall"><div class="titleline"><span class="icon" aria-hidden="true">'+s.icon+'</span><div><h3>'+s.name+'</h3><small>'+s.owner+' · '+s.specialty+'</small></div></div>'+button('stall','Shop stall',s.id)+'</article>').join('')+'</div>';
}
function availableItems(){
 const term=$('#search').value.trim().toLowerCase(), side=$('#direction').value;
 return items.filter(i=> (i.name+' '+i.category).toLowerCase().includes(term)&&currentOffers(i.id).some(o=>side==='all'||o.side===side));
}
function render(){
 nav(); $('#filters').hidden=view!=='market';
 const out=$('#content');
 if(view==='orders'){
  const os=offers.filter(o=>own(o)&&o.qty>0);
  out.innerHTML='<section class="sheet"><div class="between"><h2>My listings</h2>'+button('create','+ Create listing','','primary')+'</div>'+
  (os.map(o=>'<div class="section"><h3>'+(o.side==='sell'?'Sell Listing':'Buy Order')+' · '+itemFor(o.item).name+'</h3>'+row(o)+'</div>').join('')||'<p class="empty">You have no open listings.</p>')+'</section>'; return;
 }
 if(view==='stalls'){
  const s=stalls.find(s=>s.id===stallId);
  if(s){
   const os=offers.filter(o=>o.stall===s.id&&o.qty>0);
   out.innerHTML='<section class="sheet">'+button('stall-back','← Vendor stalls','','quiet')+'<div class="detailtitle"><h2>'+s.name+'</h2><small>'+s.owner+' · '+s.specialty+'</small></div>'+
   (os.map(o=>'<div class="section"><h3>'+itemFor(o.item).name+'</h3>'+row(o)+'</div>').join('')||'<p class="empty">No stock available.</p>')+'</section>';return;
  }
  out.innerHTML='<section class="section"><div class="between"><h2>Vendor stalls</h2>'+button('subscribe',personalStall?'Manage your stall':'Open a stall · 5 EP/week','','primary')+'</div>'+stallTiles()+
  (personalStall?'<article class="section box"><h3>Your stall</h3><p class="muted">'+itemFor(personalStall.item).name+' · '+(personalStall.auto?'Restock to '+num(personalStall.target)+' on login':'Automatic restock off')+'</p><div class="section">'+button('login','Simulate login')+'</div></article>':'')+'</section>';return;
 }
 const list=availableItems(), grid=list.length?list.map(card).join(''):'<p class="empty">No items match these filters.</p>';
 if(mode==='desk'){
  if(!list.some(i=>i.id===selected))selected=list[0]?.id||'';
  out.innerHTML='<div class="split"><aside aria-label="Grouped items" class="rail">'+(list.length?list.map(card).join(''):grid)+'</aside>'+(selected?detail(itemFor(selected),false):'')+'</div>';return;
 }
 if(selected){out.innerHTML=detail(itemFor(selected));return;}
 const showStalls=mode==='bazaar'&&!$('#search').value&&$('#direction').value==='all'&&currency()==='All currencies';
 out.innerHTML=(showStalls?'<section class="section"><div class="between"><h2>Guild vendors</h2>'+button('nav','All stalls','stalls','quiet')+'</div>'+stallTiles()+'</section>':'')+
 '<section class="section"><div class="between"><h2>'+(mode==='bazaar'?'Market goods':'Browse items')+'</h2><small>'+list.length+' items</small></div><div class="grid">'+grid+'</div></section>';
}
function modal(title,html,label){
 $('#dialogTitle').textContent=title;$('#dialogBody').innerHTML=html;$('#confirm').textContent=label;$('#confirm').disabled=false;
 if(!$('#dialog').open)$('#dialog').showModal();
}
function trade(o){
 const i=itemFor(o.item),limit=cap(o,i), buying=o.side==='sell';
 if(o.sibling||own(o))return;
 modal((buying?'Buy from ':'Sell to ')+o.owner,
 '<p class="muted">'+i.name+' · '+money(o.price,o.currency)+' each</p><div class="fields section"><label>Quantity<input id="tradeQty" type="number" min="1" max="'+limit+'" value="1"></label></div><p id="tradeTotal" class="summary" aria-live="polite"></p>'+
 (o.currency==='EP'?'<p class="muted">'+money(epLeft,'EP')+' left in your 20-hour trade allowance.</p>':''),
 buying?'Confirm purchase':'Confirm sale');
 const field=$('#tradeQty');
 const sync=()=>{const q=field.valueAsNumber,valid=Number.isSafeInteger(q)&&q>=1&&q<=limit;
 $('#confirm').disabled=!valid;$('#tradeTotal').textContent=valid?'Total: '+money(q*o.price,o.currency):limit?'Enter 1–'+num(limit)+'.':'Your balance, stock, or trade allowance is too low.';};
 field.oninput=sync;sync();
 confirmFn=()=>{const q=field.valueAsNumber;if(!Number.isSafeInteger(q)||q<1||q>cap(o,i))return;
 const total=q*o.price;o.qty-=q;i.bank+=buying?q:-q;wallet[o.currency]+=buying?-total:total;if(o.currency==='EP')epLeft-=total;
 $('#dialog').close();render();toast((buying?'Bought ':'Sold ')+num(q)+' × '+i.name+(buying?' from ':' to ')+o.owner+'.');};
}
function create(id){
 modal('Create listing','<div class="fields"><label>Type<select id="newSide"><option value="sell">Sell Listing</option><option value="buy">Buy Order</option></select></label>'+
 '<label>Item<select id="newItem">'+items.map(i=>'<option value="'+i.id+'">'+i.name+'</option>').join('')+'</select></label>'+
 '<label>Quantity<input id="newQty" type="number" min="1" value="10"></label><label>Unit price<input id="newPrice" type="number" min="1" value="100"></label>'+
 '<label>Currency<select id="newCurrency"><option>GP</option><option>SC</option><option>EP</option></select></label></div><p id="preview" class="summary" aria-live="polite"></p><div id="newGuide" class="section"></div>','Publish listing');
 if(id||selected)$('#newItem').value=id||selected;
 const read=()=>({side:$('#newSide').value,i:itemFor($('#newItem').value),qty:$('#newQty').valueAsNumber,price:$('#newPrice').valueAsNumber,c:$('#newCurrency').value});
 function sync(){
  const {side,i,qty,price,c}=read(), total=qty*price, integers=[qty,price,total].every(n=>Number.isSafeInteger(n)&&n>0);
  const valid=integers&&(side==='sell'?qty<=i.bank:total<=wallet[c]);
  $('#preview').textContent=(side==='sell'?num(i.bank)+' in your Bank':money(wallet[c],c)+' available')+(integers?' · '+(side==='sell'?'Total if sold: ':'Set aside now: ')+money(total,c):' · Enter a positive quantity and price.');
  const prices=history[i.id]?.[c]||[];
  $('#newGuide').innerHTML='<div class="guide"><strong>Recent '+c+' trades</strong><small>'+(prices.length?num(prices[0])+(prices.length>1?'–'+num(prices.at(-1)):'')+' '+c+' each · '+prices.length+' '+(prices.length===1?'trade':'trades')+(prices.length<5?' · limited history':''):'No recent trades')+'</small></div>';
  $('#confirm').disabled=!valid;return valid;
 }
 $('#dialogBody').oninput=sync;sync();
 confirmFn=()=>{if(!sync())return;const {side,i,qty,price,c}=read();if(side==='sell')i.bank-=qty;else wallet[c]-=qty*price;
 offers.push({id:++uid,item:i.id,side,owner:'You',price,currency:c,qty});$('#dialog').close();view='orders';render();toast(side==='sell'?'Sell Listing published.':'Buy Order published.');};
}
function subscribe(){
 const existing=personalStall;
 modal(existing?'Manage your stall':'Open a vendor stall',
 '<p class="muted">5 EP per week. An optional login restock moves items from your Bank into your stall.</p><div class="fields section">'+
 '<label>Stock item<select id="stallItem">'+items.map(i=>'<option value="'+i.id+'">'+i.name+'</option>').join('')+'</select></label>'+
 '<label>Target stock<input id="stallTarget" type="number" min="1" max="99999" value="'+(existing?.target??100)+'"></label>'+
 '<label>Price each (GP)<input id="stallPrice" type="number" min="1" max="99999999" value="'+(existing?.price??7500)+'"></label>'+
 '<label class="stall-auto"><input id="stallAuto" type="checkbox" '+((existing?.auto??true)?'checked':'')+'> Restock on login</label></div><p id="stallPreview" class="summary" aria-live="polite"></p>',
 existing?'Save changes':'Open stall · 5 EP');
 $('#stallItem').value=existing?.item??'potion';
 if(existing?.listing)$('#stallItem').disabled=true;
 const sync=()=>{const item=$('#stallItem').value,target=$('#stallTarget').valueAsNumber,price=$('#stallPrice').valueAsNumber,auto=$('#stallAuto').checked,
 stock=offers.find(o=>o.id===existing?.listing)?.qty||0, amount=auto?Math.min(itemFor(item).bank,Math.max(0,target-stock)):0;
 const valid=Number.isSafeInteger(target)&&target>0&&target<=99999&&Number.isSafeInteger(price)&&price>0&&price<=99999999&&(existing||wallet.EP>=5);
 $('#stallPreview').textContent=valid?'A login now would move '+num(amount)+' × '+itemFor(item).name+' from your Bank.':'Check your target, price, and EP balance.';
 $('#confirm').disabled=!valid;return valid?{item,target,price,auto,listing:existing?.listing}:null;};
 $('#dialogBody').oninput=sync;sync();
 confirmFn=()=>{const s=sync();if(!s)return;if(!existing)wallet.EP-=5;personalStall=s;
 const offer=offers.find(o=>o.id===s.listing);if(offer)offer.price=s.price;$('#dialog').close();render();toast(existing?'Stall settings saved.':'Stall opened for one week.');};
}
function restock(){
 const s=personalStall;if(!s?.auto){toast('Automatic restock is off.');return;}
 const i=itemFor(s.item);let o=offers.find(o=>o.id===s.listing);
 const q=Math.min(i.bank,Math.max(0,s.target-(o?.qty??0)));
 if(q<1){toast(i.bank?'Your stall is already stocked.':'No stock in your Bank.');return;}
 if(!o){o={id:++uid,item:s.item,side:'sell',owner:'You',price:s.price,currency:'GP',qty:0};offers.push(o);s.listing=o.id;}
 i.bank-=q;o.qty+=q;render();toast('Restocked '+num(q)+' × '+i.name+' from your Bank.');
}
$('#confirm').onclick=()=>confirmFn?.();
$('#dialog').addEventListener('close',()=>{$('#dialogBody').oninput=null;confirmFn=null;});
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-action]');if(!b)return;
 const {action,id}=b.dataset;
 if(action==='nav'){view=id;stallId='';if(view==='market'&&mode!=='desk')selected='';render();}
 if(action==='item'){selected=id;render();if(mode!=='desk'){const el=$('#itemDetail h2');el.tabIndex=-1;el.focus();}}
 if(action==='back'){selected='';render();$('#search').focus();}
 if(action==='create')create(id);
 if(action==='close')$('#dialog').close();
 if(action==='trade')trade(offers.find(o=>o.id===Number(id)));
 if(action==='stall'){view='stalls';stallId=id;render();}
 if(action==='stall-back'){stallId='';render();}
 if(action==='subscribe')subscribe();
 if(action==='login')restock();
 if(action==='remove'){
  const o=offers.find(o=>own(o)&&o.id===Number(id));if(!o)return;
  if(o.side==='sell')itemFor(o.item).bank+=o.qty;else wallet[o.currency]+=o.qty*o.price;
  o.qty=0;render();toast('Listing cancelled. Remaining stock or funds returned.');
 }
});
for(const id of ['search','direction','currency'])$('#'+id).oninput=()=>{if(mode!=='desk')selected='';render();};
$('#tagline').textContent=titles[mode];
[...document.querySelectorAll('.variants a')][['catalog','desk','bazaar'].indexOf(mode)].setAttribute('aria-current','page');
render();
