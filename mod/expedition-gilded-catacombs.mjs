export const DEFAULT_CATACOMBS_SETTINGS = Object.freeze({firelight:2,flicker_speed:0.75,flame_intensity:2,ember_count:140,ember_speed:1.95,ember_glow:2,dust_count:160,dust_opacity:2,smoke:2});

export function create_catacombs_renderer({ random = Math.random } = {}) {
const settings = DEFAULT_CATACOMBS_SETTINGS;
const braziers=[[.093,.415,.022],[.312,.375,.045],[.678,.315,.079]];
const embers=Array.from({length:140},(_,i)=>({source:i%3,phase:random(),x:(random()-.5)*2,pace:.6+random()*.8,size:.3+random()*.8}));
const dust=Array.from({length:160},()=>({x:random(),y:random(),size:.3+random()*.7,speed:.5+random()*.7,phase:random()*6.283}));
const smoke=Array.from({length:36},(_,i)=>({source:i%3,phase:random(),offset:(random()-.5),size:.6+random()*.6,pace:.7+random()*.6}));let time=0,emberTime=0,flickerTime=0;
return({context:c,width:w,height:h,seconds})=>{time+=seconds;emberTime+=seconds*settings.ember_speed;flickerTime+=seconds*settings.flicker_speed;
for(let i=0;i<braziers.length;i++){const [x,y,r]=braziers[i],pulse=.65+.18*Math.sin(flickerTime*3+i*2)+.10*Math.sin(flickerTime*6.7+i),radius=w*r*1.9,g=c.createRadialGradient(x*w,y*h,0,x*w,y*h,radius);g.addColorStop(0,'rgba(255,158,48,.25)');g.addColorStop(1,'rgba(236,88,18,0)');c.globalAlpha=Math.min(1,settings.firelight*pulse);c.fillStyle=g;c.fillRect(x*w-radius,y*h-radius,radius*2,radius*2);
// Flicker within the painted flame itself: transparent outer edges preserve the original artwork.
const flame=c.createRadialGradient(x*w,(y-r*.45)*h,0,x*w,(y-r*.45)*h,w*r*.38);flame.addColorStop(0,'rgba(255,217,137,.40)');flame.addColorStop(1,'rgba(255,130,20,0)');c.globalAlpha=Math.min(1,settings.flame_intensity*pulse);c.fillStyle=flame;c.fillRect((x-r)*w,(y-r*2)*h,r*2*w,r*2*h)}
for(let i=0;i<Math.min(140,settings.ember_count);i++){const p=embers[i],[sx,sy,r]=braziers[p.source],age=(p.phase+emberTime*.07*p.pace)%1,x=(sx+p.x*r*.5+Math.sin(age*7+p.x)*r*.25)*w,y=(sy-age*r*3)*h,fade=Math.sin(Math.PI*age)*(1-age);c.save();c.globalAlpha=Math.min(1,fade*.8);c.fillStyle='#ffb868';c.shadowColor='#ff7a20';c.shadowBlur=5*settings.ember_glow;c.beginPath();c.arc(x,y,Math.max(.2,p.size*w/1200),0,6.283);c.fill();c.restore()}
for(let i=0;i<Math.min(160,settings.dust_count);i++){const p=dust[i],x=(((p.x+time*.003*p.speed)%1)+1)%1*w,y=(p.y+Math.sin(time*.2+p.phase)*.007)*h;c.globalAlpha=Math.min(1,settings.dust_opacity*.3);c.fillStyle='#c4a484';c.beginPath();c.arc(x,y,Math.max(.15,p.size*w/1200),0,6.283);c.fill()}
for(const p of smoke){const [sx,sy,r]=braziers[p.source],age=(p.phase+time*.028*p.pace)%1,x=(sx+p.offset*r+Math.sin(time*.3+p.phase*6)*r*.25)*w,y=(sy-age*r*3.2)*h,rad=w*r*(.3+age)*p.size,g=c.createRadialGradient(x,y,0,x,y,Math.max(.1,rad));g.addColorStop(0,'rgba(75,62,55,.17)');g.addColorStop(1,'rgba(75,62,55,0)');c.globalAlpha=Math.min(1,settings.smoke*Math.sin(Math.PI*age));c.fillStyle=g;c.fillRect(x-rad,y-rad,2*rad,2*rad)}c.globalAlpha=1;
};
}
