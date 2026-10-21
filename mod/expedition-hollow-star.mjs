// Task-driven Hollow Star atmosphere. The shared image-particles lifecycle owns scheduling and teardown.
export const DEFAULT_HOLLOW_STAR_SETTINGS = Object.freeze({
	blob_size: 1.35,
	turbulence: 1,
	motion_speed: 0.45,
	brightness: 1.6,
	glow: 6,
	cell_intensity: 2.95,
	spark_count: 120,
	spark_speed: 0.25,
	gas_opacity: 3,
	gas_speed: 1.2,
	transition_speed: 4,
	star_count: 900,
	star_speed: 30.6,
	star_brightness: 2.84,
	combat_haze: 1.28,
	tendril_count: 80,
	tendril_height: 0.75,
	tendril_opacity: 1,
	tendril_speed: 1.5,
	molten_color: '#ff782d',
	plasma_color: '#b7aeff',
});
const DEFAULT_TASKS = Object.freeze({ vent: 0, light: 0, defense: 0, melt: 0,
	continued_defense: 0, complete: 0, defense_active: false, continued_defense_active: false });
export const HOLLOW_STAR_LIMITS = Object.freeze({
	blob_size: [0.4, 5.4],
	turbulence: [0, 4],
	motion_speed: [0, 1.8],
	brightness: [0, 6.0],
	glow: [0, 6.0],
	cell_intensity: [0, 6.0],
	spark_count: [0, 480],
	spark_speed: [0, 1.0],
	gas_opacity: [0, 4],
	gas_speed: [0, 4.8],
	transition_speed: [0.1, 16],
	star_count: [0, 3600],
	star_speed: [0, 50],
	star_brightness: [0, 4],
	combat_haze: [0, 6.0],
	tendril_count: [0, 80],
	tendril_height: [0, 6.4],
	tendril_opacity: [0, 4],
	tendril_speed: [0, 12],
});
export function normalize_hollow_star_settings(input = {}) {
	const s = {};
	for (const [key,[min,max]] of Object.entries(HOLLOW_STAR_LIMITS)) s[key] = Number.isFinite(input[key]) ? Math.max(min,Math.min(max,input[key])) : DEFAULT_HOLLOW_STAR_SETTINGS[key];
	for (const key of ['molten_color','plasma_color']) s[key] = /^#[0-9a-f]{6}$/i.test(input[key]) ? input[key] : DEFAULT_HOLLOW_STAR_SETTINGS[key];
	s.star_count = Math.round(s.star_count); s.tendril_count = Math.round(s.tendril_count);
	s.spark_count = Math.round(s.spark_count); return s;
}
export function normalize_hollow_star_tasks(input = {}) {
	const state = {};
	for (const key of ['vent','light','defense','melt','continued_defense','complete']) state[key] = Number.isFinite(input[key]) ? Math.max(0,Math.min(1,input[key])) : 0;
	for (const key of ['defense_active','continued_defense_active']) state[key] = input[key] === true;
	return state;
}
// Snapshot values are authoritative; animation never extrapolates or submits work.
export function hollow_star_tasks(snapshot) {
	const chamber = snapshot?.expedition?.chamber;
	if (chamber?.id !== 'hollow_star') return { ...DEFAULT_TASKS, visit_id: null };
	const result = { ...DEFAULT_TASKS, visit_id: chamber.visit_id };
	const ids = { vent: 'arrival_support', light: 'groundwork', defense: 'initial_defense',
		melt: 'melt_star', continued_defense: 'continued_defense', complete: 'ending_departure' };
	for (const [key, id] of Object.entries(ids)) {
		const task = chamber.tasks?.find(item => item.task_id === id);
		if (!task) continue;
		if (task.completed_at != null) { result[key] = 1; continue; }
		if (task.unlocked_at == null) continue;
		const credited = (Number.isFinite(task.player_ms) ? Math.max(0, task.player_ms) : 0) +
			(Number.isFinite(task.system_ms) ? Math.max(0, task.system_ms) : 0);
		result[key] = Number.isFinite(task.target_ms) && task.target_ms > 0 ? Math.min(1, credited / task.target_ms) : 0;
		if (key === 'defense' || key === 'continued_defense') {
			result[key + '_active'] = credited > 0 || (task.trackers?.length ?? 0) > 0 ||
				(snapshot.tracking?.visit_id === chamber.visit_id && snapshot.tracking?.task_id === id);
		}
	}
	return result;
}
const rgb = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
const mix = (a,b,t) => a.map((v,i) => Math.round(v+(b[i]-v)*t));
// Opacity dials above one increase optical density without invalid Canvas alpha.
const density = (alpha, gain) => 1 - (1 - Math.max(0,Math.min(1,alpha))) ** gain;
const rgba = (color,alpha) => `rgba(${color.join(',')},${Math.max(0,Math.min(1,alpha))})`;
function gas_texture(random, color = [133,141,184]) {
	const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 96;
	const c = canvas.getContext('2d'); if (!c) return null;
	const pixels = c.createImageData(256,96), grid = Array.from({length:17*9},random), smooth = t => t*t*(3-2*t);
	for (let y=0;y<96;y++) for (let x=0;x<256;x++) {
		const gx=x/256*16,gy=y/96*8,ix=Math.floor(gx),iy=Math.floor(gy),fx=smooth(gx-ix),fy=smooth(gy-iy);
		const at=(dx,dy)=>grid[(iy+dy)*17+(ix+dx)%16];
		const n=(at(0,0)*(1-fx)+at(1,0)*fx)*(1-fy)+(at(0,1)*(1-fx)+at(1,1)*fx)*fy;
		const i=(y*256+x)*4; pixels.data[i]=color[0];pixels.data[i+1]=color[1];pixels.data[i+2]=color[2];
		pixels.data[i+3]=Math.round(n*n*Math.sin(y/95*Math.PI)**2*220);
	}
	c.putImageData(pixels,0,0);return canvas;
}
export function create_hollow_star_renderer({get_settings=()=>DEFAULT_HOLLOW_STAR_SETTINGS,get_tasks=()=>DEFAULT_TASKS,random=Math.random}={}) {
	const texture = gas_texture(random), red_texture = gas_texture(random,[187,34,62]);
	const stars = Array.from({length:HOLLOW_STAR_LIMITS.star_count[1]},() => ({x:random(),y:random(),phase:random()*Math.PI*2,
		speed:.35+random()*.65,size:.25+random()*.5,brightness:.3+random()*.7}));
	// Interleave depth and horizontal strata so even small counts occupy the pit's volume.
	// Near strands begin below the visible rim; distant strands emerge higher and finer.
	const tendrils = Array.from({length:HOLLOW_STAR_LIMITS.tendril_count[1]},(_,i)=>{
		const depth=((i*37)%80+random())/80;
		const across=((i*53)%80+random())/80;
		const y=.60+depth*.43;
		const left=y<.74 ? .54-(y-.60)*1.9 : .274+(y-.74)*1.15;
		return {
			x:left+(.98-left)*across, y, depth, phase:random()*Math.PI*2,
			height:(.13+random()*.25)*(.8+depth*.55),
			lean:(random()-.5)*(.07+depth*.07), speed:.3+random()*.35,
			xs:new Float64Array(25),ys:new Float64Array(25)
		};
	});
	// Group by depth once; rendering shares a stroke across similarly sized strands.
	const tendril_groups=Array.from({length:8},()=>[]);
	for(let i=0;i<tendrils.length;i++)tendril_groups[Math.min(7,Math.floor(tendrils[i].depth*8))].push(i);
	const cells = Array.from({length:64},() => ({angle:random()*Math.PI*2,distance:Math.sqrt(random())*.9,
		phase:random()*Math.PI*2,size:.1+random()*.18,speed:.3+random()*.7}));
	const sparks = Array.from({length:HOLLOW_STAR_LIMITS.spark_count[1]},() => ({phase:random(),angle:random()*Math.PI*2,
		speed:.12+random()*.18,size:.5+random()*1.2}));
	const count=96, xs=new Float64Array(count),ys=new Float64Array(count);
	const initial_tasks=get_tasks(), state=normalize_hollow_star_tasks(initial_tasks);
	let visit_id=initial_tasks.visit_id, motion=0,gas_time=0,spark_time=0,star_time=0,tendril_time=0,threat=0;
	return ({context:c,width:w,height:h,seconds}) => {
		const s=normalize_hollow_star_settings(get_settings()),raw_tasks=get_tasks(),target=normalize_hollow_star_tasks(raw_tasks);
		if(raw_tasks.visit_id!==visit_id){
			visit_id=raw_tasks.visit_id;Object.assign(state,target);
			motion=gas_time=spark_time=star_time=tendril_time=threat=0;
		}
		const blend=1-Math.exp(-seconds*2.5*s.transition_speed);
		for(const key of ['vent','light','defense','melt','continued_defense','complete']) state[key]+=(target[key]-state[key])*blend;
		const active = (target.defense_active && target.defense<1 ? 1-target.defense : 0)
			+ (target.continued_defense_active && target.continued_defense<1 ? 1-target.continued_defense : 0);
		motion+=seconds*s.motion_speed;gas_time+=seconds*s.gas_speed;spark_time+=seconds*s.spark_speed;
		star_time+=seconds*s.star_speed; tendril_time+=seconds*s.tendril_speed;
		const fighting = active > 0;
		threat+=((fighting ? 1-target.complete : 0)-threat)*(1-Math.exp(-seconds*1.5));
		// Broad, softly edged fog layers drift across the entire chamber, including the upper arches.
		if(texture) {
			for(let i=0;i<4;i++) {
				const x=((gas_time*(.005+i*.002)*(i===1?-1:1)+i*.31)%1+1)%1*w;
				const y=(-.12+i*.26+Math.sin(gas_time*.14+i)*.018)*h;
				c.globalAlpha=density((1-state.vent*.85)*(.45+i*.09),s.gas_opacity);
				c.drawImage(texture,x-w,y,w,h*.51);c.drawImage(texture,x,y,w,h*.51);
			}
		}
		if(red_texture && threat>.001) {
			c.save(); // Soft texture edges let the rising red haze spill naturally beyond the pit.
			for(let i=0;i<3;i++){
				const t=(gas_time*.018+i/3)%1;
				const x=((gas_time*.009+i*.39)%1)*w;
				c.globalAlpha=density(threat*Math.sin(t*Math.PI)*.85,s.combat_haze);
				c.drawImage(red_texture,x-w,(.78-t*.36)*h,w,h*.38);
				c.drawImage(red_texture,x,(.78-t*.36)*h,w,h*.38);
			}c.restore();
		}
		if(threat>.001){
			c.save();c.lineCap='round';c.lineJoin='round';
			// Clip bases to the far side of the foreground rim; tips can reach into the chamber.
			c.beginPath();c.moveTo(.10*w,.20*h);c.lineTo(w,.20*h);
			c.lineTo(w,.878*h);c.lineTo(.90*w,.91*h);c.lineTo(.58*w,.922*h);
			c.lineTo(.575*w,.89*h);c.lineTo(.45*w,.848*h);c.lineTo(.35*w,.813*h);
			c.lineTo(.26*w,.774*h);c.lineTo(.17*w,.737*h);c.lineTo(.275*w,.69*h);
			c.lineTo(.42*w,.64*h);c.lineTo(.53*w,.568*h);c.lineTo(.10*w,.568*h);c.closePath();c.clip();
			for(let i=0;i<s.tendril_count;i++){
				const p=tendrils[i],time=tendril_time*p.speed+p.phase;
				const reach=p.height*s.tendril_height*(.82+.18*Math.sin(time*.6));
				for(let j=0;j<25;j++){
					const t=j/24;
					p.xs[j]=(p.x+p.lean*t+Math.sin(time-t*6)*.018*t+Math.sin(time*.7-t*10)*.007*t*t)*w;
					p.ys[j]=(p.y-reach*t)*h;
				}
			}
			// Eight depth bands preserve perspective and taper while batching 3,840 strokes
			// into at most 384. The 25-point shapes and all 80 strands remain intact.
			for(let group=0;group<tendril_groups.length;group++){
				const members=tendril_groups[group];
				if(!members.some(i=>i<s.tendril_count))continue;
				const depth=(group+.5)/8;
				for(let j=1;j<25;j++){
					const t=j/24;
					c.globalAlpha=density(threat*(.55+depth*.45)*Math.sin(t*Math.PI)**.7,s.tendril_opacity);
					c.beginPath();
					for(const i of members){
						if(i>=s.tendril_count)continue;
						const p=tendrils[i];c.moveTo(p.xs[j-1],p.ys[j-1]);c.lineTo(p.xs[j],p.ys[j]);
					}
					c.strokeStyle='rgba(213,56,91,.26)';c.lineWidth=Math.max(.6,w*.004*(.55+depth*.75)*(1-t));c.stroke();
					c.strokeStyle='rgba(220,160,188,.68)';c.lineWidth=Math.max(.25,w*.00085*(.55+depth*.75)*(1-t));c.stroke();
				}

			}c.restore();
		}
		// A growing, persistent stellar field, with active-time motion and no per-frame pool rebuilding.
		const progression=Math.min(1,state.light*.22+state.melt*.58+state.complete*.20);
		const star_total=Math.round(s.star_count*(.035+.965*progression));
		c.fillStyle='#d8dfff';
		for(let i=0;i<star_total;i++){
			const p=stars[i],x=((p.x+star_time*.00012*p.speed)%1)*w;
			const y=((p.y-star_time*.00038*p.speed)%1+1)%1*h;
			c.globalAlpha=density(p.brightness*(.72+.28*Math.sin(star_time*.10+p.phase)),s.star_brightness);
			c.beginPath();c.arc(x,y,p.size*Math.min(1,w/750),0,Math.PI*2);c.fill();
		}
		const lit=state.light, melt=state.melt*lit, finish=state.complete;
		if(lit<.001)return;
		const cx=.637*w,cy=.253*h;
		const radius=w*(.014+.027*lit+.030*melt)*s.blob_size;
		const agitation=s.turbulence*(.4+.5*melt+active*.9)*(1-finish*.75);
		const pulse=1+Math.sin(motion*1.5)*(.025+.018*active)*(1-finish*.7);
		const molten=rgb(s.molten_color),plasma=rgb(s.plasma_color);
		const base_color=mix(mix(molten,[255,244,194],melt*.65),plasma,Math.max(0,(melt-.55)/.45));
		const color=mix(base_color,[255,255,247],1-Math.exp(-Math.max(0,s.brightness-1.5)*.35));
		const core=mix(color,[255,255,247],.22+.65*melt);
		const halo_radius=radius*(2.6+Math.max(0,s.glow-1.5));
		const halo=c.createRadialGradient(cx,cy,radius*.3,cx,cy,halo_radius);
		halo.addColorStop(0,rgba(color,.45));halo.addColorStop(.5,rgba(color,.13));halo.addColorStop(1,rgba(color,0));
		c.globalAlpha=Math.min(1,s.glow*lit*s.brightness);c.fillStyle=halo;
		c.fillRect(cx-halo_radius,cy-halo_radius,halo_radius*2,halo_radius*2);
		for(let i=0;i<count;i++) {
			const a=i/count*Math.PI*2;
			const ripple=(Math.sin(a*3+motion*.9)*.060+Math.sin(a*5-motion*1.2)*.035+Math.sin(a*9+motion*1.7)*.018)*agitation;
			const r=radius*(1+ripple)*pulse;xs[i]=cx+Math.cos(a)*r;ys[i]=cy+Math.sin(a)*r*1.05;
		}
		c.save();c.beginPath();c.moveTo((xs[0]+xs[1])/2,(ys[0]+ys[1])/2);
		for(let j=1;j<=count;j++){const i=j%count,next=(i+1)%count;c.quadraticCurveTo(xs[i],ys[i],(xs[i]+xs[next])/2,(ys[i]+ys[next])/2);}c.closePath();
		const body=c.createRadialGradient(cx-radius*.14,cy-radius*.12,0,cx,cy,radius*1.2);
		body.addColorStop(0,rgba(core,1));body.addColorStop(.58,rgba(color,1));body.addColorStop(1,rgba(mix(color,[80,27,54],.35),1));
		c.globalAlpha=Math.min(1,lit*2)*Math.min(1,s.brightness);c.fillStyle=body;c.fill();c.clip();
		// Crucible-style luminous cells, bounded and clipped to the deforming mass.
		c.globalCompositeOperation='screen';
		for(const p of cells){
			const a=p.angle+motion*p.speed*(.1+active*.12),r=p.distance*radius;
			const x=cx+Math.cos(a)*r+Math.sin(motion+p.phase)*radius*.06,y=cy+Math.sin(a)*r;
			const cr=radius*p.size*(1+melt*.8),alpha=(.16+.12*Math.sin(motion*p.speed*2+p.phase))*s.cell_intensity;
			const g=c.createRadialGradient(x,y,0,x,y,cr);g.addColorStop(0,rgba(core,alpha));g.addColorStop(.4,rgba(color,alpha*.65));g.addColorStop(1,rgba(color,0));
			c.fillStyle=g;c.fillRect(x-cr,y-cr,cr*2,cr*2);
		}
		// Flowing luminous seams break up the surface as it becomes plasma.
		c.strokeStyle=rgba(core,.22+.20*melt);c.globalAlpha=Math.min(1,s.brightness*s.cell_intensity);
		c.lineWidth=Math.max(.5,radius*.018);
		for(let i=0;i<9;i++){
			const y=cy-radius+radius*2*i/8,phase=motion*(.35+i*.025)+i;
			c.beginPath();c.moveTo(cx-radius*1.1,y);
			c.bezierCurveTo(cx-radius*.4,y+Math.sin(phase)*radius*.5,cx+radius*.4,y+Math.cos(phase)*radius*.5,cx+radius*1.1,y);c.stroke();
		}
		// Disturbances cross the mass while either defense task is actively being worked.
		if(active>0){c.globalAlpha=Math.min(1,active*.4*s.brightness);c.strokeStyle=rgba(core,.8);c.lineWidth=Math.max(.6,w/1300);
			for(let i=0;i<3;i++){const t=(motion*.4+i/3)%1;c.beginPath();c.ellipse(cx,cy,radius*(.2+t*1.5),radius*(.08+t*.6),-.4,0,Math.PI*2);c.stroke();}}
		c.restore();
		for(let i=0;i<s.spark_count;i++) {
			const p=sparks[i],t=(p.phase+spark_time*p.speed)%1;
			const distance=radius*(.8+t*(.5+melt)),x=cx+Math.cos(p.angle)*distance,y=cy+Math.sin(p.angle)*distance-t*t*radius*.9;
			c.globalAlpha=Math.min(1,lit*s.brightness*(.15+.65*melt)*Math.sin(t*Math.PI)*(1-finish*.7));c.fillStyle=rgba(core,1);
			c.beginPath();c.arc(x,y,p.size*Math.min(1,w/900),0,Math.PI*2);c.fill();
		}
	};
}
