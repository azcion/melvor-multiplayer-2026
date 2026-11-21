export const DEFAULT_BLACKWATER_SETTINGS = Object.freeze({ root_opacity: 0.1, pulse_intensity: 0.55, pulse_speed: 0.8, bubble_count: 32, bubble_speed: 1.7, bubble_intensity: 0.4, gas_opacity: 1 });

export function create_blackwater_renderer(){
 const settings=DEFAULT_BLACKWATER_SETTINGS;
 // Cubic curves trace the image's piers and vault. Secondary branches split from the main stems.
 const branches=[
  [[.16,.57],[.17,.38],[.07,.24],[.08,.07],5], [[.16,.57],[.19,.39],[.18,.18],[.28,.05],3.7],
  [[.20,.34],[.25,.24],[.32,.10],[.43,.055],2.7], [[.15,.31],[.13,.21],[.13,.13],[.10,.08],1.8],
  [[.40,.56],[.36,.37],[.32,.15],[.43,.05],4], [[.37,.35],[.41,.20],[.52,.09],[.61,.06],2.8],
  [[.43,.05],[.50,.04],[.53,.14],[.61,.19],2], [[.36,.37],[.31,.31],[.29,.22],[.28,.13],1.7],
  [[.65,.55],[.62,.40],[.67,.20],[.74,.08],4.3], [[.64,.35],[.56,.26],[.54,.17],[.49,.09],2.5],
  [[.74,.08],[.81,.08],[.84,.16],[.88,.24],2.4], [[.68,.26],[.73,.25],[.79,.19],[.82,.12],1.7],
  [[.91,.56],[.90,.39],[.95,.20],[.98,.09],4.1], [[.91,.35],[.86,.24],[.83,.16],[.75,.09],2.5],
  [[.86,.25],[.81,.26],[.79,.34],[.78,.40],1.6], [[.48,.16],[.46,.23],[.46,.30],[.48,.34],1.4],
  [[.30,.15],[.26,.18],[.26,.26],[.27,.30],1.5], [[.77,.13],[.76,.19],[.76,.25],[.75,.29],1.2]
 ];
 const paths=branches.map(([a,b,d,e,width],index)=>{const points=[];for(let i=0;i<=56;i++){let t=i/56,u=1-t;let x=u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*d[0]+t*t*t*e[0],y=u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*d[1]+t*t*t*e[1];const wobble=Math.sin(t*33+index*2.1)*.0025*Math.sin(t*Math.PI);points.push([x+wobble,y+wobble*.6])}return {points,width,index,offset:(index*.197)%1}});
 // Bubble positions sit in exposed water corridors, away from the crossing and foreground stones.
 const sources=[[.20,.61],[.23,.64],[.28,.61],[.34,.63],[.37,.66],[.44,.69],[.51,.73],[.60,.76],[.69,.80],[.78,.85],[.87,.90],[.96,.94],[.83,.78],[.92,.80],[.57,.71],[.19,.59]];
 const bubbles=Array.from({length:32},(_,i)=>({x:sources[i%sources.length][0]+(Math.random()-.5)*.025,y:sources[i%sources.length][1]+(Math.random()-.5)*.015,phase:Math.random(),speed:.68+Math.random()*.6,size:.7+Math.random()*.7,drift:(Math.random()-.5)*.025}));
 let t=0;return ({context:c,width:w,height:h,seconds})=>{t+=seconds;
 // Transparent segmented strands, with uneven widths and soft dissolution towards the tips.
 for(const path of paths){const pts=path.points;
 // Fine, crooked side roots emerge along the main strands and taper into the stone.
 for(let i=8;i<pts.length-6;i+=8){const q=i/(pts.length-1),point=pts[i],side=((i+path.index)%2?1:-1),length=(.008+.008*(1-q)),bend=Math.sin(path.index*4+i)*.004;c.globalAlpha=settings.root_opacity*(1-q)*.38;c.strokeStyle='#a6d7b7';c.lineWidth=Math.max(.35,path.width*.24*w/1280);c.beginPath();c.moveTo(point[0]*w,point[1]*h);c.quadraticCurveTo((point[0]+side*length*.4)*w,(point[1]-.009+bend)*h,(point[0]+side*length)*w,(point[1]-.020+bend)*h);c.stroke()}
 for(let i=1;i<pts.length;i++){let q=i/(pts.length-1),fade=(1-q*.78)*(.67+.33*Math.sin(q*29+path.index)**2);c.globalAlpha=settings.root_opacity*fade*.65;c.strokeStyle='#a6d7b7';c.lineWidth=Math.max(.45,path.width*(1-q*.7)*w/1280);c.beginPath();c.moveTo(pts[i-1][0]*w,pts[i-1][1]*h);c.lineTo(pts[i][0]*w,pts[i][1]*h);c.stroke();
 // Uneven packets travel from the water upwards, fading as they spread along each branch.
 let phase=(t*settings.pulse_speed*.045+path.offset+Math.sin(t*.11+path.index)*.045)%1,dist=Math.abs(q-phase);dist=Math.min(dist,1-dist);let pulse=Math.exp(-dist*dist/.0018)*(0.72+.28*Math.sin(t*.8+path.index)**2);if(pulse>.01){c.globalAlpha=settings.pulse_intensity*pulse*fade;c.strokeStyle='#c3ffd4';c.lineWidth=Math.max(.7,path.width*(1-q*.55)*1.2*w/1280);c.shadowColor='#80e8a0';c.shadowBlur=10*settings.pulse_intensity;c.beginPath();c.moveTo(pts[i-1][0]*w,pts[i-1][1]*h);c.lineTo(pts[i][0]*w,pts[i][1]*h);c.stroke();c.shadowBlur=0}}
 }
 // Each bubble inflates at the surface, briefly pops, then releases a rising fading gas cloud.
 for(let i=0;i<settings.bubble_count;i++){const p=bubbles[i],phase=(t*settings.bubble_speed*.075*p.speed+p.phase)%1,x=p.x*w,y=p.y*h,r=(2.5+4*p.size)*w/1280;
 if(phase<.42){let growth=phase/.42;c.globalAlpha=settings.bubble_intensity*(.3+.5*growth);c.strokeStyle='#a3edb2';c.fillStyle='rgba(90,173,117,.18)';c.lineWidth=1;c.beginPath();c.ellipse(x,y-r*growth*.35,r*growth,r*growth*.55,0,0,Math.PI*2);c.fill();c.stroke()}
 else if(phase<.49){let pop=(phase-.42)/.07;c.globalAlpha=settings.bubble_intensity*(1-pop);c.strokeStyle='#b9f9c1';c.beginPath();c.ellipse(x,y,r*(1+pop),r*.35*(1+pop),0,0,Math.PI*2);c.stroke()}
 else {let q=(phase-.49)/.51,gy=y-q*h*.12,gx=x+p.drift*w*q,rad=(7+q*22)*w/1280*p.size;let g=c.createRadialGradient(gx,gy,0,gx,gy,Math.max(.1,rad));g.addColorStop(0,'rgba(142,210,161,.35)');g.addColorStop(.5,'rgba(127,190,148,.13)');g.addColorStop(1,'rgba(127,190,148,0)');c.globalAlpha=settings.gas_opacity*(1-q)*Math.min(1,q*5);c.fillStyle=g;c.fillRect(gx-rad,gy-rad,rad*2,rad*2)}
 }
 c.globalAlpha=1;c.shadowBlur=0;
 };
}
