export const DEFAULT_SPORE_SETTINGS = Object.freeze({ spore_count: 240, spore_speed: 2.5, spore_intensity: 0.45, cap_spores: 1, fungal_glow: 1 });

export function create_spore_renderer(){
 const settings=DEFAULT_SPORE_SETTINGS;
 const caps=[[.145,.60,.08,'cyan'],[.72,.64,.055,'cyan'],[.66,.45,.14,'violet'],[.90,.27,.12,'violet'],[.88,.04,.11,'violet'],[.47,.70,.03,'cyan']];
 const motes=Array.from({length:240},(_,i)=>({x:Math.random(),y:Math.random(),depth:.35+Math.random()*.65,speed:.35+Math.random()*.8,phase:Math.random()*6.283,size:.4+Math.random()*1.15,color:i%3?'cyan':'violet'}));
 const falling=Array.from({length:85},(_,i)=>({cap:i%caps.length,x:(Math.random()-.5)*2,phase:Math.random(),speed:.65+Math.random()*.7,size:.35+Math.random()*.7}));
 let t=0,sporeTime=0;return ({context:c,width:w,height:h,seconds})=>{t+=seconds;sporeTime+=seconds*settings.spore_speed;
 // Only the artwork's already-luminous fungi receive a faint breathing halo.
 for(let i=0;i<caps.length;i++){const [x,y,r,color]=caps[i],rad=r*w*(.9+.1*Math.sin(t*.34+i)),g=c.createRadialGradient(x*w,y*h,0,x*w,y*h,Math.max(1,rad));g.addColorStop(0,color==='cyan'?'rgba(64,239,235,.22)':'rgba(184,87,255,.22)');g.addColorStop(1,'rgba(80,80,190,0)');c.globalAlpha=settings.fungal_glow*(.7+.3*Math.sin(t*.4+i*.9));c.fillStyle=g;c.fillRect(x*w-rad,y*h-rad,rad*2,rad*2)}
 // Fine spores rise through the nave at different depths, gently orbiting as they drift.
 for(let i=0;i<settings.spore_count;i++){const p=motes[i],y=(((p.y-sporeTime*.008*p.speed)%1+1)%1)*h,x=(((p.x+Math.sin(sporeTime*.22+p.phase)*.012*p.depth)%1+1)%1)*w,twinkle=.55+.45*Math.sin(t*.65+p.phase)**2;c.globalAlpha=settings.spore_intensity*(.22+.65*p.depth)*twinkle;c.fillStyle=p.color==='cyan'?'#80fff2':'#d6a8ff';c.shadowColor=p.color==='cyan'?'#52d9d4':'#b66bff';c.shadowBlur=4*p.depth;c.beginPath();c.arc(x,y,p.size*(.65+.35*p.depth),0,Math.PI*2);c.fill()}c.shadowBlur=0;
 // Tiny sporulating droplets drift down from the luminous caps and vanish softly.
 for(const p of falling){const cap=caps[p.cap],phase=(p.phase+sporeTime*.045*p.speed)%1,x=(cap[0]+p.x*cap[2]*.7+Math.sin(t*.5+p.phase*6)*.003)*w,y=(cap[1]+phase*.15)*h;c.globalAlpha=settings.cap_spores*Math.sin(Math.PI*phase)*.75;c.fillStyle=cap[3]==='cyan'?'#9bfff5':'#dca6ff';c.beginPath();c.arc(x,y,p.size,0,Math.PI*2);c.fill()}
 c.globalAlpha=1;
 };
}
