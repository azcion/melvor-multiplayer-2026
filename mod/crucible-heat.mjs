// Decorative silhouettes and molten cells use fixed, bounded pools; no item assets or API reads.
export const HEAT_SETTINGS = Object.freeze({ height:16, gearSize:0.6, coinSize:1.2, junkDensity:1,
 meltStart:0.5, meltEnd:0.55, glow:1.5, hotEdge:1, lava:1, speed:1, texture:0.5,
 notchOpacity:0.5, animated:true, notches:true });
const settings = HEAT_SETTINGS;
const cells=Array.from({length:72},(_,i)=>({x:(i+.5)/72,phase:i*2.399,y:((i*17)%23)/23,size:3+(i%5)*2}));
// Small authored silhouettes inspired by the supplied inventory references.
const junk=Array.from({length:48},(_,i)=>({x:(i+.4)/48*.55,y:.15+((i*13)%19)/19*.7,angle:(i*2.399)%6.28,size:5+(i%4)*1.6,kind:i%12,variant:Math.floor(i/12)%3}));
function draw_junk(c,w,h){
 for(const [index,p] of junk.entries()){if(((index*17)%48)/48>=settings.junkDensity)continue;const fade=Math.max(0,Math.min(1,(settings.meltEnd-p.x)/Math.max(.04,settings.meltEnd-settings.meltStart)));if(!fade)continue;
  c.save();c.translate(p.x*w,p.y*h);c.rotate(p.angle);const k=p.kind<3?Math.min(p.size,h*.23)*settings.coinSize:Math.max(h*.48,p.size*2.4)*settings.gearSize;c.scale(k/10,k/10);c.globalAlpha=fade*.9;c.lineWidth=1.2;
  const gold='#e5bd38', variant=p.variant;
  const steel=['#718641','#b58d21','#8562b2'][variant],dark=['#303c23','#514011','#342b43'][variant],trim=['#e8e8b8','#f4ce57','#c8b7e1'][variant];
  const gem=['#40bffc','#f74791','#43d842','#a87eff','#a3e8f1','#ffa920'][Math.floor(p.x*131)%6];
  if(p.kind<3){ // Gold predominates; teal coins are occasional.
   c.fillStyle=p.kind===2?'#208e83':gold;c.strokeStyle=p.kind===2?'#55c5b3':'#ffda65';c.beginPath();c.ellipse(0,0,6,5,0,0,Math.PI*2);c.fill();c.stroke();
   c.strokeStyle=p.kind===2?'#bac4cc':'#aa7626';c.beginPath();c.moveTo(-3,0);c.lineTo(3,0);c.moveTo(0,-3);c.lineTo(0,3);c.stroke();
   if(p.kind===2){c.fillStyle='#e9c75b';c.fillRect(-1,-3,2,2)}
  }else if(p.kind===3||p.kind===4){ // Sword and axe.
   c.fillStyle='#796b51';c.fillRect(-1,0,2,10);c.fillStyle=gold;c.fillRect(-4,0,8,2);c.fillStyle=steel;c.beginPath();
   if(p.kind===3){c.moveTo(-2,0);c.lineTo(-2,-10);c.lineTo(0,-15);c.lineTo(2,-10);c.lineTo(2,0)}else{c.moveTo(-1,-4);c.lineTo(-7,-6);c.lineTo(-7,-12);c.lineTo(-1,-10);c.lineTo(6,-13);c.lineTo(7,-6);c.lineTo(1,-4)}c.closePath();c.fill();c.strokeStyle=trim;c.beginPath();c.moveTo(0,-11);c.lineTo(0,-2);c.stroke();
  }else if(p.kind===5){ // Shield with gold inset.
   c.fillStyle=steel;c.beginPath();c.moveTo(-7,-7);c.lineTo(7,-7);c.lineTo(6,2);c.lineTo(0,9);c.lineTo(-6,2);c.closePath();c.fill();c.strokeStyle=trim;c.lineWidth=1.8;c.stroke();c.fillStyle=dark;c.beginPath();c.moveTo(-3,-4);c.lineTo(3,-4);c.lineTo(0,5);c.closePath();c.fill();
  }else if((p.kind===6||p.kind===11)){ // Chest plate.
   c.fillStyle=steel;c.beginPath();c.moveTo(-3,-7);c.lineTo(-7,-8);c.lineTo(-10,-3);c.lineTo(-6,0);c.lineTo(-5,8);c.lineTo(5,8);c.lineTo(6,0);c.lineTo(10,-3);c.lineTo(7,-8);c.lineTo(3,-7);c.lineTo(0,-4);c.closePath();c.fill();c.strokeStyle=trim;c.lineWidth=1.2;c.stroke();c.beginPath();c.moveTo(-7,-5);c.lineTo(-3,-2);c.lineTo(0,4);c.lineTo(3,-2);c.lineTo(7,-5);c.stroke();c.strokeStyle=dark;c.beginPath();c.moveTo(-4,0);c.lineTo(4,0);c.moveTo(-3,3);c.lineTo(3,3);c.stroke();
   }else if((p.kind===7||p.kind===9||p.kind===10)){ // Bright gemstone ring / pendant, with gold or silver bands.
   c.strokeStyle=variant===0?'#e0e7ed':gold;c.lineWidth=1.8;c.beginPath();c.ellipse(0,2,6,p.kind===10?3:6,0,0,Math.PI*2);c.stroke();
   const gy=p.kind===10?9:-6;c.fillStyle=gem;c.beginPath();c.moveTo(-3,gy-2);c.lineTo(2,gy-3);c.lineTo(4,gy);c.lineTo(0,gy+4);c.lineTo(-4,gy);c.closePath();c.fill();c.strokeStyle='#ffffffa0';c.lineWidth=.7;c.beginPath();c.moveTo(-2,gy-1);c.lineTo(2,gy-1);c.lineTo(0,gy+2);c.stroke();
  }else{ // Ornate helmet, colored armor face, contrasting trim and gemstone.
   c.fillStyle=steel;c.beginPath();c.moveTo(-7,-4);c.lineTo(-10,-9);c.lineTo(-4,-7);c.lineTo(0,-11);c.lineTo(4,-7);c.lineTo(10,-9);c.lineTo(7,-4);c.lineTo(6,7);c.lineTo(2,8);c.lineTo(2,1);c.lineTo(-2,1);c.lineTo(-2,8);c.lineTo(-6,7);c.closePath();c.fill();c.strokeStyle=trim;c.lineWidth=1;c.stroke();c.fillStyle=dark;c.fillRect(-5,-1,10,2);c.fillStyle=gem;c.beginPath();c.moveTo(0,-7);c.lineTo(2,-4);c.lineTo(0,-1);c.lineTo(-2,-4);c.closePath();c.fill();
  }
  // Warm reflections grow toward the melting boundary.
  c.globalCompositeOperation='source-atop';c.fillStyle=`rgba(236,74,8,${Math.max(0,(p.x-.25)*1.4)})`;c.fillRect(-12,-16,24,32);c.restore();
 }
}

export function create_heat_renderer({ get_tier }) {
let time=0;return({context:c,width:w,height:h,seconds})=>{
 const s=settings;time+=seconds*s.speed;const end=w*Math.max(0, Math.min(9, get_tier() || 0))/9;if(!end)return;
 c.save();c.beginPath();c.roundRect(0,0,end,h,h/2);c.clip();
 for(const p of cells){
  const heat=Math.max(0,(p.x-.28)/.72);const motion=.025+heat*heat*1.8;
  const x=p.x*w+Math.sin(time*motion+p.phase)*Math.min(6,w/90);const y=h*(.12+p.y*.76)+Math.cos(time*motion*.7+p.phase)*h*.06;
  const pulse=.65+.35*Math.sin(time*motion*2+p.phase);const r=p.size*(.6+heat*.9);
  if(p.x<.34)continue;
  c.globalCompositeOperation='screen';const g=c.createRadialGradient(x,y,0,x,y,r);const alpha=s.lava*s.texture*heat*pulse;
  g.addColorStop(0,`rgba(255,${Math.round(90+heat*150)},${Math.round(heat*140)},${alpha})`);g.addColorStop(.4,`rgba(255,70,0,${alpha*.6})`);g.addColorStop(1,'rgba(255,45,0,0)');c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);c.globalCompositeOperation='source-over';
 }draw_junk(c,w,h);c.restore();
};
}
