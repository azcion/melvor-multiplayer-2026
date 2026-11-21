export const DEFAULT_COURT_SETTINGS = Object.freeze({spore_count:260,spore_speed:1.05,spore_glow:2,mushroom_glow:2,root_pulses:2,root_speed:0.2,cap_spores:2});

export function create_court_renderer({ random = Math.random } = {}) {
const settings = DEFAULT_COURT_SETTINGS;
const spores=Array.from({length:260},(_,i)=>({x:random(),y:random(),speed:.5+random()*.8,phase:random()*6.283,size:.3+random()*.9,depth:.35+random()*.65}));
const caps=[[.095,.705,.07],[.905,.81,.075],[.24,.305,.045],[.68,.295,.045],[.95,.31,.045]];
const released=Array.from({length:85},(_,i)=>({cap:i%caps.length,phase:random(),x:(random()-.5)*2,speed:.6+random()*.8,size:.3+random()*.6}));
const roots=[[[.29,.105],[.44,.18],[.53,.06],[.69,.15]],[[.69,.15],[.64,.20],[.59,.33],[.48,.43]],[[.89,.02],[.82,.16],[.78,.29],[.62,.42]],[[.83,.13],[.86,.18],[.79,.28],[.69,.39]]];let time=0,sporeTime=0,rootTime=0;
return({context:c,width:w,height:h,seconds})=>{time+=seconds;sporeTime+=seconds*settings.spore_speed;rootTime+=seconds*settings.root_speed;
// A soft breathing light only over the existing luminous mushroom clusters.
for(let i=0;i<caps.length;i++){const [x,y,r]=caps[i],radius=w*r,gradient=c.createRadialGradient(x*w,y*h,0,x*w,y*h,radius);gradient.addColorStop(0,'rgba(255,185,83,.22)');gradient.addColorStop(1,'rgba(255,150,45,0)');c.globalAlpha=Math.min(1,settings.mushroom_glow*(.6+.4*Math.sin(time*.4+i)**2));c.fillStyle=gradient;c.fillRect(x*w-radius,y*h-radius,radius*2,radius*2)}
for(let i=0;i<Math.min(260,settings.spore_count);i++){const p=spores[i],y=(((p.y-sporeTime*.012*p.speed)%1+1)%1)*h,x=(((p.x+Math.sin(sporeTime*.4+p.phase)*.012*p.depth)%1+1)%1)*w;c.globalAlpha=Math.min(1,settings.spore_glow*(.14+.46*p.depth)*(.65+.35*Math.sin(time*.6+p.phase)**2));c.fillStyle=i%5?'#ffe5a6':'#fff5d4';c.shadowColor='#ffd488';c.shadowBlur=4*p.depth;c.beginPath();c.arc(x,y,p.size*(w/1000),0,6.283);c.fill()}c.shadowBlur=0;
// Luminous dots travel along the painted canopy roots rather than lighting the empty air.
for(let i=0;i<roots.length;i++){const p=roots[i];for(let j=0;j<4;j++){let t=(rootTime*.045+j*.25+i*.15)%1,mt=1-t,x=(mt**3*p[0][0]+3*mt**2*t*p[1][0]+3*mt*t*t*p[2][0]+t**3*p[3][0])*w,y=(mt**3*p[0][1]+3*mt**2*t*p[1][1]+3*mt*t*t*p[2][1]+t**3*p[3][1])*h,r=w*.007,g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,'rgba(255,226,161,.8)');g.addColorStop(1,'rgba(255,187,99,0)');c.globalAlpha=Math.min(1,settings.root_pulses*Math.sin(Math.PI*t)*.55);c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2)}}
for(const p of released){const cap=caps[p.cap],age=(p.phase+sporeTime*.045*p.speed)%1,x=(cap[0]+p.x*cap[2]*.6+Math.sin(time*.6+p.phase*6)*.004)*w,y=(cap[1]-age*.14)*h;c.globalAlpha=Math.min(1,settings.cap_spores*Math.sin(Math.PI*age)*.75);c.fillStyle='#ffdaa0';c.beginPath();c.arc(x,y,p.size*w/1000,0,6.283);c.fill()}c.globalAlpha=1;
};
}
