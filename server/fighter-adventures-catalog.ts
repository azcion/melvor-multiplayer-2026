import raw from './fighter-adventures-catalog.json';
export const ADVENTURE_HOUR = 3_600_000;
export const ADVENTURE_INTERVAL = 300_000;
export type AdventureMonster = {
	id: string; name: string; attackType: 'melee' | 'ranged' | 'magic'; unmodeled_mechanics?: true; levels: Record<string,number>;
	equipmentStats: Array<{key:string;value:number}>; lootChance:number;
	lootTable:Array<{itemID:string;minQuantity:number;maxQuantity:number;weight:number}>;
	bones?:{itemID:string;quantity:number}; currencyDrops:Array<{currencyID:string;min:number;max:number}>;
};
export type AdventureArea = {id:string;name:string;monsters:AdventureMonster[]};
export type AdventureCatalog = {version:number;pace:number;spawn_ms:number;areas:AdventureArea[]};
export function validate_adventure_catalog(catalog:AdventureCatalog):AdventureCatalog {
	const integer=(n:number,min:number,max:number)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
	const item=(id:string)=>/^melvor[DF]:[A-Za-z0-9_]+$/.test(id);
	if(!integer(catalog.version,2,1e6)||!Number.isFinite(catalog.pace)||catalog.pace<=0||catalog.pace>10||!integer(catalog.spawn_ms,3000,60000)||!catalog.areas.length||catalog.areas.length>12)throw Error('Invalid Adventure catalog');
	const ids=new Set<string>();
	for(const area of catalog.areas) {
		if(!item(area.id)||ids.has(area.id)||!area.name||!area.monsters.length||area.monsters.length>12)throw Error('Invalid Adventure area');
		ids.add(area.id);
		const monsters=new Set<string>();
		for(const m of area.monsters) {
			if(!item(m.id)||monsters.has(m.id)||!m.name||!['melee','ranged','magic'].includes(m.attackType)||(m.unmodeled_mechanics!==undefined&&m.unmodeled_mechanics!==true)||(m.attackType==='magic'&&!m.unmodeled_mechanics)||!integer(m.lootChance,0,100)||m.lootTable.length>256||m.currencyDrops.length>1||m.equipmentStats.some(s=>!Number.isFinite(s.value)))throw Error('Invalid Adventure monster');
			monsters.add(m.id);
			for(const key of ['Hitpoints','Attack','Strength','Defence','Ranged','Magic'])if(!integer(m.levels[key],1,1000))throw Error('Invalid monster levels');
			for(const row of m.lootTable)if(!item(row.itemID)||!integer(row.minQuantity,1,10000)||!integer(row.maxQuantity,row.minQuantity,10000)||row.maxQuantity-row.minQuantity>100||!integer(row.weight,1,1e6))throw Error('Invalid Adventure loot');
			if(m.bones&&(!item(m.bones.itemID)||!integer(m.bones.quantity,1,10000)))throw Error('Invalid bones');
			for(const c of m.currencyDrops)if(c.currencyID!=='melvorD:GP'||!integer(c.min,0,1e6)||!integer(c.max,c.min,1e6)||c.max-c.min>1000)throw Error('Invalid currency');
		}
	}
	return catalog;
}
export const ADVENTURE_CATALOG=validate_adventure_catalog(raw as AdventureCatalog);
export function adventure_items(area:AdventureArea):string[] {
	return [...new Set(area.monsters.flatMap(m=>[...m.lootTable.map(r=>r.itemID),...(m.bones?[m.bones.itemID]:[])]))];
}
