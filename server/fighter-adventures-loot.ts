import { randomInt } from 'node:crypto';
import type { AdventureMonster } from './fighter-adventures-catalog';
export const loot_random=()=>randomInt(0,0x100000000)/0x100000000;
// Lanczos log-gamma keeps the binomial mode probability stable for long offline gaps.
function log_gamma(z:number):number {
	const c=[676.5203681218851,-1259.1392167224028,771.32342877765313,-176.6150291621406,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
	z--;let x=0.99999999999980993;for(let i=0;i<c.length;i++)x+=c[i]/(z+i+1);
	const t=z+7.5;return .9189385332046727+(z+.5)*Math.log(t)-t+Math.log(x);
}
// Enumerate probability mass outwards from the mode: exact binomial distribution,
// no normal/Poisson approximation and no rejection loop. At most n+1 masses.
export function sample_binomial(n:number,p:number,random=loot_random):number {
	if(!Number.isSafeInteger(n)||n<0||!Number.isFinite(p)||p<0||p>1)throw RangeError('Invalid Adventure sample');
	if(!n||p===0)return 0;if(p===1)return n;
	if(n>1_188_000) { let total=0; while(n>1_188_000) { total+=sample_binomial(1_188_000,p,random); n-=1_188_000; } return total+sample_binomial(n,p,random); }
	const mode=Math.floor((n+1)*p),q=1-p;
	let left=mode,right=mode,lp=Math.exp(log_gamma(n+1)-log_gamma(mode+1)-log_gamma(n-mode+1)+mode*Math.log(p)+(n-mode)*Math.log(q)),rp=lp;
	let u=random()-lp;if(u<=0)return mode;
	while(left>0||right<n) {
		if(left>0){lp*=left/(n-left+1)*q/p;left--;u-=lp;if(u<=0)return left;}
		if(right<n){rp*=(n-right)/(right+1)*p/q;right++;u-=rp;if(u<=0)return right;}
		// Remaining tails may underflow. Their mass is below floating-point precision.
		if(lp===0&&rp===0)break;
	}
	return mode;
}
export function sample_quantity(n:number,min:number,max:number,random=loot_random):number {
	let remaining=n,total=0;
	for(let value=min;value<max&&remaining;value++) {const count=sample_binomial(remaining,1/(max-value+1),random);total+=value*count;remaining-=count;}
	return total+max*remaining;
}
export function sample_loot(monster:AdventureMonster,kills:number,discovered:Set<string>,random=loot_random):Record<string,number> {
	const result:Record<string,number>={};
	const add=(id:string,qty:number)=>{if(qty>0)result[id]=(result[id]??0)+qty;};
	let remaining=sample_binomial(kills,monster.lootChance/100,random);
	let weight=monster.lootTable.reduce((sum,row)=>sum+row.weight,0);
	for(const row of monster.lootTable) {
		const count=sample_binomial(remaining,row.weight/weight,random);remaining-=count;weight-=row.weight;
		if(discovered.has(row.itemID))add(row.itemID,sample_quantity(count,row.minQuantity,row.maxQuantity,random));
	}
	if(monster.bones&&discovered.has(monster.bones.itemID))add(monster.bones.itemID,kills*monster.bones.quantity);
	for(const c of monster.currencyDrops)add(c.currencyID,sample_quantity(kills,c.min,c.max,random));
	return result;
}
