export const DEFAULT_BASILICA_SETTINGS = Object.freeze({fish_count:55,fish_speed:0.4,fish_brightness:0.55,fish_glow:2,fish_size:0.6,fish_trails:2});
function waterClip(c,w,h){c.beginPath();function poly(points){c.moveTo(points[0][0]*w,points[0][1]*h);for(const [x,y] of points.slice(1))c.lineTo(x*w,y*h);c.closePath()}
poly([[.10,.47],[.39,.47],[.41,.52],[.43,.68],[.50,.76],[.47,1],[.46,1],[.34,.85],[.18,.72],[.10,.65]]);
poly([[.49,.58],[.58,.57],[.65,.61],[.78,.62],[.93,.61],[1,.60],[1,1],[.46,1],[.51,.87]]);
poly([[.51,.77],[.57,.74],[.64,.74],[.68,.76],[.68,.85],[.60,.88],[.50,.86]]);
poly([[.79,.68],[.92,.64],[.96,.68],[.96,.74],[.82,.74]]);
c.clip('evenodd')}

export function create_basilica_renderer({ random = Math.random } = {}) {
const settings = DEFAULT_BASILICA_SETTINGS;
const fish=Array.from({length:100},(_,i)=>({x:random(),y:random(),phase:random()*6.283,pace:.6+random()*.8,scale:.5+random()*.75,dir:i%2?1:-1,zone:i%3}));let time=0;
return({context:c,width:w,height:h,seconds})=>{time+=seconds*settings.fish_speed;c.save();waterClip(c,w,h);for(let i=0;i<Math.min(100,settings.fish_count);i++){const f=fish[i],t=time*f.pace,offset=f.phase,center=f.zone===0?[.28,.68,.15,.17]:f.zone===1?[.69,.78,.19,.15]:[.90,.83,.09,.12],rx=center[2]*(.45+f.x*.55),ry=center[3]*(.4+f.y*.6),angle=offset+t*(.13+f.x*.10)*f.dir,x=(center[0]+Math.cos(angle)*rx)*w,y=(center[1]+Math.sin(angle)*ry+Math.sin(t*.9+offset)*.004)*h,dx=-Math.sin(angle)*f.dir,dy=Math.cos(angle)*f.dir*.6,rotation=Math.atan2(dy,dx),size=(1.3+f.scale*1.8)*settings.fish_size*(w/1000),pulse=.65+.35*Math.sin(t*1.3+offset)**2,alpha=Math.min(1,settings.fish_brightness*(.30+.4*f.scale)*pulse);c.save();c.translate(x,y);c.rotate(rotation);c.globalAlpha=alpha;c.shadowColor='#70ffdd';c.shadowBlur=9*settings.fish_glow*size;c.fillStyle='#a5ffe7';c.beginPath();c.ellipse(0,0,size*1.25,size*.52,0,0,6.283);c.fill();c.globalAlpha=alpha*.5*settings.fish_trails;c.strokeStyle='#68ddc3';c.lineWidth=Math.max(.3,size*.4);c.beginPath();c.moveTo(-size*.8,0);c.quadraticCurveTo(-size*2.4,Math.sin(t*3+offset)*size*.5,-size*4,0);c.stroke();c.restore()}c.restore()};
}