(() => {
const scenarios = [
 [
  ['Buyer · Item search','Amulet of Torture','No active Sell Listings.','Post request · 2 million GP'],
  ['Buyer · My requests','Request posted','1 Amulet of Torture · 2,000,000 GP set aside.','See seller’s next login'],
  ['Seller · Wanted items I own','Amulet of Torture','1 in your Bank · Nora wants 1 for 2,000,000 GP.','Sell to Nora'],
  ['Trade complete','Request filled','Nora can claim the amulet when she next logs in. The seller receives 2,000,000 GP.']
 ],
 [
  ['Buyer · Item search','Ancient Ring of Mastery','No active Sell Listings. Watching costs nothing.','Watch item'],
  ['Buyer · Watchlist','Watching Ancient Ring of Mastery','Notify me when a seller lists it.','Simulate new listings'],
  ['Buyer · Marketplace alert','Two listings are available','Ancient Ring of Mastery',null,[['Arden','8,000,000 GP'],['Mira','9,000,000 GP']]],
  ['Trade complete','Ring purchased','You bought from SELLER.']
 ],
 [
  ['Buyer · Supplier catalog','The Potion Garden','Mira supplies Generous Harvest Potions. Currently out of stock.','Request 100 potions · 8 EP'],
  ['Buyer · My requests','Batch requested','100 potions for 8 EP. Waiting for Mira to accept.','See supplier’s next login'],
  ['Mira · Batch requests','Nora wants 100 potions','8 EP for the batch. Accept to take on the order.','Accept request'],
  ['Mira · Accepted request','Batch ready','100 potions in your Bank · 8 EP payable on delivery.','Deliver from Bank'],
  ['Trade complete','Batch delivered','Nora can claim 100 potions. Mira receives 8 EP.']
 ]
];
const root=document.getElementById('market-alternatives');
Array.from(root.querySelectorAll('[data-variant]')).forEach((panel,index)=>{
 let step=0,seller='';
 const states=scenarios[index], view=panel.querySelector('.view'), actions=panel.querySelector('.actions');
 const makeButton=(label,onClick,back=false)=>{
  const button=document.createElement('button');button.type='button';button.textContent=label;
  if(back)button.className='back';
  button.onclick=()=>{onClick();render();(actions.querySelector('button')||view.querySelector('button'))?.focus();};
  return button;
 };
 function render(){
  const [role,title,summary,next,offers]=states[step];
  panel.querySelector('[data-role]').textContent=role;
  const heading=document.createElement('h3'); heading.textContent=title;
  const line=document.createElement('p'); line.textContent=summary.replace('SELLER',seller);
  view.replaceChildren(heading,line);actions.replaceChildren();
  for(const [name,price] of offers||[]){
   const row=document.createElement('div');row.className='offer';
   const info=document.createElement('span');info.textContent=name+' · '+price;
   row.append(info,makeButton('Buy from '+name,()=>{seller=name;step++;}));view.append(row);
  }
  if(next)actions.append(makeButton(next,()=>step++));
  if(step)actions.append(makeButton(step===states.length-1?'Try again':'Back',()=>{step=step===states.length-1?0:step-1;},true));
 }
 render();
});
})();
