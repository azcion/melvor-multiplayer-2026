// Expected output is informational; the server samples independent native drops.
export function update_area_estimate(area) {
 const selected=(area.monsters??[]).filter(m=>area.selected_ids.includes(m.id));
 area.ready=selected.length>0&&selected.every(m=>m.eligible);
 const seconds=selected.reduce((sum,m)=>sum+m.seconds,0);
 const kills_per_monster=area.ready&&seconds>0?3600/seconds*(area.kill_multiplier??1):0;
 area.kills_per_hour=kills_per_monster*selected.length;
 const items=new Map();
 const eligible=new Set(area.items.filter(i=>i.eligible).map(i=>i.item_id));
 for(const m of selected)for(const reward of m.rewards??[]) {
  items.set(reward.item_id,(items.get(reward.item_id)??0)+reward.per_kill*kills_per_monster);
 }
 area.expected_items=[...items].map(([item_id,per_hour])=>({item_id,per_hour,eligible:item_id==='melvorD:GP'||eligible.has(item_id)}));
}
export function capacity_cost(current, target) {
	if (!Number.isInteger(target) || target <= current || target > 99) return 0;
	let cost=0; for(let h=current+1;h<=target;h++) cost+=Math.floor(h/10)+1;
	return cost;
}
export function adventure_inbox_count(groups, unread) {
	return new Set(groups.filter(g=>g.source_type!=='fighter_adventures').flatMap(g=>g.items.map(i=>i.item_id))).size+(unread?1:0);
}
export function create_adventure_view() {
	return {supported:false,busy:false,error:'',areas:[],active_area:null,active_monsters:[],capacity:1,target:2,editing_limit:false,revision:0,ep_micros:0,invested_micros:0,reset_refund_micros:0,free_reset:false,social_only:false,opted_in:false,character_ready:false,tutorial_complete:null,unread:false,haul_revision:0,seen_revision:0,inbox_open:false,has_items:false};
}
export function create_adventures({view,scope,supported,ready,request,discovered,owned_dlc,changed,read_selections=()=>({}),write_selections=()=>{},now=Date.now}) {
	let current='',epoch=0,login=true,last=0,refresh_sequence=0;
	const edited_areas=new Set();
	function sync() {
		const next=scope(); if(next===current) {view.supported=supported();return;}
		current=next;epoch++;login=true;last=0;edited_areas.clear();Object.assign(view,create_adventure_view(),{supported:supported()});
	}
	async function refresh() {
		sync(); if(!supported()) return false;
		const generation=epoch, sequence=++refresh_sequence;
		const data=await request('/api/adventures/state'); sync();
		if(generation!==epoch||sequence!==refresh_sequence||!data?.supported) return false;
		for(const area of data.areas) {
			for(const item of area.items) item.eligible=discovered(item.item_id)&&(!item.dlc||owned_dlc().includes(item.dlc));
			const previous=view.areas.find(a=>a.id===area.id);
			const saved=read_selections();
			area.monsters??=[];
			const initial=area.id===data.active_area&&Array.isArray(data.active_monsters)?data.active_monsters:saved?.[area.id];
			const assignment_changed=area.id===data.active_area&&Array.isArray(data.active_monsters)&&
				(view.active_area!==data.active_area||view.active_monsters.length!==data.active_monsters.length||
					data.active_monsters.some(id=>!view.active_monsters.includes(id)));
			const selection=assignment_changed&&!edited_areas.has(area.id)?data.active_monsters:previous?.selected_ids;
			area.selected_ids=(selection??(Array.isArray(initial)?initial:[]))
				.filter(id=>area.monsters.some(m=>m.id===id));
			update_area_estimate(area);
		}
		data.areas.sort((a,b)=>(b.fighter_count??0)-(a.fighter_count??0));
		Object.assign(view,data,{supported:true});view.target=Math.min(99,Math.max(view.capacity+1,Number(view.target)||2));
		changed();return true;
	}
	function eligibility() {
		return {discovered:[...new Set(view.areas.flatMap(a=>a.items.map(i=>i.item_id)))].filter(discovered),owned_dlc:owned_dlc()};
	}
	async function action(name,payload={}) {
		const generation=epoch;
		sync(); if(generation!==epoch||view.busy||!supported()) return false;
		view.busy=true;view.error='';
		try {
			if(!ready()) {view.error='MOD_MP_ADVENTURE_SYNC_ERROR';return false;}
			const input=name==='seen'?payload:{...payload,revision:view.revision};
			const result=await request(`/api/adventures/${name}`,input);sync();
			if(generation!==epoch) return false;
			if(!result?.success) {
				await refresh();
				if(generation===epoch && name!=='check-in') {
					if(name==='capacity' && view.revision!==input.revision) view.editing_limit=false;
					view.error='MOD_MP_ADVENTURE_CONFIRM_ERROR';
				}
				return false;
			}
			if(name==='capacity') view.editing_limit=false;
			if(name==='start') {
				const selected_area=view.areas.find(a=>a.id===payload.area_id);
				if(selected_area)selected_area.selected_ids=[...payload.monster_ids];
				edited_areas.delete(payload.area_id);
			}
			await refresh();return generation===epoch;
		} catch {sync();if(generation===epoch&&name!=='check-in')view.error='MOD_MP_ADVENTURE_REOPEN_ERROR';return false;}
		finally {if(generation===epoch)view.busy=false;}
	}
	return {
		refresh,
		reset() { current=scope();epoch++;login=true;last=0;edited_areas.clear();Object.assign(view,create_adventure_view(),{supported:supported()}); },
		apply_selections() {
			sync();const saved=read_selections();let updated=false;
			for(const area of view.areas) {
				if(area.id===view.active_area||edited_areas.has(area.id)||!Array.isArray(saved?.[area.id]))continue;
				area.selected_ids=saved[area.id].filter(id=>area.monsters.some(m=>m.id===id));
				update_area_estimate(area);updated=true;
			}
			if(updated)changed();
		},
		async tick() {
			sync();if(!supported()||!ready()||view.busy||(!login&&now()-last<300000))return;
			try {
				const generation=epoch;
				if(!await refresh())return;
				sync();if(generation!==epoch)return;
				if(!view.character_ready){last=now();return;}
				if(!view.active_area){login=false;last=now();return;}
				if(await action('check-in',{reason:login?'login':'online',eligibility:eligibility()})){login=false;last=now();}
			} catch { /* The next foreground poll retries. */ }
		},
		start:async area_id=>{
			sync();
			const area=view.areas.find(a=>a.id===area_id);
			if(!area?.ready)return false;
			return action('start',{area_id,monster_ids:[...area.selected_ids],eligibility:eligibility()});
		},
		select(area_id,monster_id,enabled) {
			sync();
			if(view.busy)return;
			const area=view.areas.find(a=>a.id===area_id);
			if(!area?.monsters.some(m=>m.id===monster_id))return;
			area.selected_ids=area.monsters.filter(m=>m.id===monster_id?enabled:area.selected_ids.includes(m.id)).map(m=>m.id);
			edited_areas.add(area_id);
			write_selections({[area_id]:[...area.selected_ids]});
			update_area_estimate(area);changed();
		},
		stop:()=>action('stop'),
		opt_in:enabled=>action('opt-in',{enabled}),
		upgrade:()=>action('capacity',{target:Number(view.target)}),
		reset_capacity:()=>action('reset-capacity'),
		seen:()=>action('seen',{haul_revision:view.haul_revision}),
		cost:()=>capacity_cost(view.capacity,Number(view.target))
	};
}
