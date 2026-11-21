export const DEFAULT_SANCTUM_SETTINGS = Object.freeze({ghost_count:24,ghost_opacity:0.4,ghost_speed:0.45,ghost_fade:1.6,ghost_size:0.45,fragment_count:30,fragment_speed:2,fragment_opacity:1,fissure_glow:2,fissure_speed:2});

export function create_sanctum_renderer({ random = Math.random } = {}) {
const settings = DEFAULT_SANCTUM_SETTINGS;
// Same soft head, shoulders and dissolving robe construction as the Tideworn Crypts ghosts.
const ghost=document.createElement('canvas');ghost.width=128;ghost.height=256;const gc=ghost.getContext('2d');
function ghostShape(x,y,rx,ry,alpha){gc.save();gc.translate(x,y);gc.scale(rx,ry);const g=gc.createRadialGradient(0,0,0,0,0,1);g.addColorStop(0,`rgba(0,0,0,${alpha})`);g.addColorStop(.55,`rgba(0,0,0,${alpha*.8})`);g.addColorStop(1,'rgba(0,0,0,0)');gc.fillStyle=g;gc.fillRect(-1,-1,2,2);gc.restore()}
ghostShape(64,44,19,28,.95);ghostShape(64,100,38,46,.85);for(let i=0;i<7;i++)ghostShape(64+Math.sin(i*.9)*4,115+i*15,32-i*3,35,.52-i*.055);
const ghosts=Array.from({length:24},(_,i)=>({side:i%2===0?-1:1,y:.25+Math.floor(i/2)%6*.055+random()*.025,phase:random(),period:18+random()*12,scale:.7+random()*.6}));
const fragments=Array.from({length:60},()=>({x:random(),y:random(),phase:random()*6.283,pace:.5+random()*.7,size:.4+random()*.9,rotation:random()*6.283}));let t=0,ghostTime=0,fadeTime=0,fragmentTime=0,fissureTime=0;
return({context:c,width:w,height:h,seconds})=>{t+=seconds;ghostTime+=seconds*settings.ghost_speed;fadeTime+=seconds*settings.ghost_fade;fragmentTime+=seconds*settings.fragment_speed;fissureTime+=seconds*settings.fissure_speed;
// Whole black figures travel diagonally between the lighter cavern wall and the void.
for(let i=0;i<Math.min(24,settings.ghost_count);i++){const g=ghosts[i],phase=(fadeTime/g.period+g.phase)%1,fade=Math.pow(Math.sin(phase*Math.PI),2),travel=(1-Math.cos(ghostTime/g.period*Math.PI*2+g.phase*6.283))*.5,x=(.5+g.side*(.38-travel*.27))*w,y=(g.y-travel*.12)*h,gh=h*.25*g.scale*settings.ghost_size,gw=gh*.5;c.save();c.globalAlpha=Math.min(1,settings.ghost_opacity*fade);c.drawImage(ghost,x-gw/2,y,gw,gh);c.restore()}
// Dark, angular pieces float gently above the floor; they are not luminous pinpoints.
for(let i=0;i<Math.min(60,settings.fragment_count);i++){const p=fragments[i],x=(.12+p.x*.76+Math.sin(fragmentTime*.22*p.pace+p.phase)*.008)*w,y=(.69+p.y*.24+Math.sin(fragmentTime*.30*p.pace+p.phase)*.012)*h,r=(1.2+p.size*2.3)*w/1000;c.save();c.translate(x,y);c.rotate(p.rotation+fragmentTime*.12*p.pace);c.globalAlpha=Math.min(1,settings.fragment_opacity*(.28+.30*p.size));c.fillStyle='#554b60';c.beginPath();c.moveTo(-r,-r*.5);c.lineTo(r*.6,-r);c.lineTo(r,r*.45);c.lineTo(-r*.4,r);c.closePath();c.fill();c.restore()}
// Existing fissures at the cavern edges pulse with broad transparent falloff.
const anchors=[[.08,.78,.13],[.30,.79,.11],[.90,.78,.11],[.71,.79,.09]];for(let i=0;i<anchors.length;i++){const [x,y,r]=anchors[i],radius=w*r,g=c.createRadialGradient(x*w,y*h,0,x*w,y*h,radius);g.addColorStop(0,'rgba(160,123,196,.12)');g.addColorStop(1,'rgba(88,60,122,0)');c.globalAlpha=Math.min(1,settings.fissure_glow*(.4+.6*Math.sin(fissureTime*.4+i*.8)**2));c.fillStyle=g;c.fillRect(x*w-radius,y*h-radius,radius*2,radius*2)}c.globalAlpha=1;
};
}
