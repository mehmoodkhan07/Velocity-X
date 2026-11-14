// VELOCITY X — playable browser foundation (Three.js, custom fixed-timestep vehicle physics)
const T=THREE,$=id=>document.getElementById(id),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const SAVE='vx_save_v1';
let save=Object.assign({credits:5000,xp:0,wins:0,races:0,podiums:0,topSpeed:0},JSON.parse(localStorage.getItem(SAVE)||'{}'));
const persist=()=>localStorage.setItem(SAVE,JSON.stringify(save));
const CARS=[{n:'Phantom R',c:0xd01010,pw:30,top:78,gr:5.0,hd:2.6},{n:'Apex GT',c:0x2255ff,pw:27,top:74,gr:5.8,hd:2.9},{n:'Sahara X',c:0xff8a00,pw:25,top:68,gr:4.4,hd:2.5},{n:'Silver Arrow',c:0xc8ccd4,pw:33,top:84,gr:4.2,hd:2.3}];
const NAMES=['Kaito','Rhea','Viktor','Zara','Dante','Mina','Luca','Sasha','Omar','Ingrid','Hugo','Yuki','Tariq','Nova','Rex'];
const PERS=['Aggressive','Balanced','Defensive','Technical','Speed-focused'];
const SKILL=[.72,.8,.88,.94,.98,1.0];
let renderer,scene,camera,N=480,P,Tn,Nm,world=[],cars=[],player,cfg,state='menu',keys={},camMode=0,rain,spot,cdT=0,raceT=0,last=0,acc=0,sel=0,aud,msgT=0,sunL,hemi,CURV=[];

// ---------- boot / splash ----------
// Weak GPUs (the Intel HD 5xxx laptops this game is played on) cannot afford 4x MSAA: it doubles the
// fill cost. Probe the adapter on a throwaway canvas so the real one keeps the cheap attributes.
const VXGPU = (() => {
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
    const e = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL) || '') : '';
  } catch (e) { return ''; }
})();
const VX_WEAK_GPU = /SwiftShader|llvmpipe|Microsoft Basic|Intel\(R\)? ?(HD|UHD) Graphics (3|4|5)\d{3}|Mali-?T|Adreno [1-5]\d\d/i.test(VXGPU);
// a phone or a small touch tablet: decides the starting quality preset and the canvas pixel-ratio cap
const VX_MOBILE = (() => {
  try {
    if (/Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent || '')) return true;
    return (navigator.maxTouchPoints | 0) > 1 && Math.min(innerWidth, innerHeight) < 820;
  } catch (e) { return false; }
})();
// Quality: 0 Low · 1 Medium · 2 High · 3 Ultra · 4 Auto (default). Auto resolves to a preset from the
// GPU probe and the device class; the runtime governor then scales the render inside that preset.
// Auto on a phone is Medium with no MSAA: multisampling a dpr-3 framebuffer was the single biggest cost on
// mid-range Android, and the dynamic-resolution governor in controls.js handles the rest.
const VX_QRAW = save.set && save.set.q != null ? +save.set.q : 4;
function vxResolveQual(){
  const q = save.set && save.set.q != null ? +save.set.q : VX_QRAW;
  return q >= 4 ? (VX_WEAK_GPU || VX_MOBILE ? 1 : 3) : q;
}
const VX_QUAL = VX_QRAW >= 4 ? (VX_WEAK_GPU || VX_MOBILE ? 1 : 3) : VX_QRAW;
// never above 2: a phone reporting dpr 3 would render nine times the pixels for no visible gain
function vxBaseRatio() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), q = vxResolveQual();
  const auto = !(save.set && save.set.q != null) || +save.set.q >= 4;
  // a phone's CSS pixel is tiny: 0.85 of it looked soft, 1.25 is sharp and still a third of native dpr 3
  if (auto && VX_MOBILE && !VX_WEAK_GPU) return Math.min(dpr, 1.25);
  return [.6, .85, 1, dpr][q] || 1;
}
// frame-time bookkeeping for the optional debug overlay and for the acceptance tests
const VXSTAT = { fps: 0, n: 0, acc: 0, ms: 0, worst: 0, p1: 0, buf: new Float32Array(240), bi: 0, bn: 0, calls: 0, tris: 0, pr: 1, dt: 0 };
const VXCAM = { ax: null, az: 0, ai: 0, look: 0 };
const VXVEC2 = new T.Vector3();
function boot(){
  const bar=v=>$('barf').style.width=v+'%';
  bar(10);
  // save.set is created later by extras.js — on a first run (empty localStorage) it is still undefined here
  const aa = !VX_WEAK_GPU && VX_QUAL >= 2 && !(save.set && save.set.aa === 0);
  renderer=new T.WebGLRenderer({canvas:$('gl'),antialias:aa,powerPreference:'high-performance',stencil:false});
  renderer.setPixelRatio(vxBaseRatio());
  scene=new T.Scene();camera=new T.PerspectiveCamera(65,1,.5,1500);resize();bar(40);
  const im=new Image();im.onload=()=>{bar(100);const b=$('start');b.disabled=false;b.textContent='START ENGINE'};im.onerror=im.onload;im.src='img/splash.png';
  $('start').onclick=toMenu;$('skip').onclick=toMenu;
}
function toMenu(){try{aud=aud||new (window.AudioContext||window.webkitAudioContext)()}catch(e){}
  $('splash').classList.add('hidden');$('menu').classList.remove('hidden');state='menu';renderMenu();}
function renderMenu(){
  $('prof').innerHTML=`DRIVER · LVL ${1+Math.floor(save.xp/1000)} · XP ${save.xp} · <b>${save.credits} CR</b> · Wins ${save.wins}/${save.races}`;
  $('cars').innerHTML=CARS.map((c,i)=>`<div class="car ${i==sel?'sel':''}" onclick="sel=${i};renderMenu()"><b style="color:#fff">${c.n}</b>Speed<i style="width:${c.top}%"></i>Accel<i style="width:${c.pw*2.8}%"></i>Handling<i style="width:${c.hd*30}%"></i>Grip<i style="width:${c.gr*14}%"></i></div>`).join('');
  const g=readCfg();$('sum').textContent=`${CARS[sel].n} · ${g.num} cars total = 1 player + ${g.num-1} AI · ${g.laps} laps · ${['Beginner','Easy','Normal','Hard','Expert','Professional'][g.diff]} · ${g.wx}/${g.tod} · nitro ${g.nitro?'ON':'OFF'} · reward up to ${g.num*150+500} CR`;
}
function readCfg(){return{car:sel,loc:+$('loc').value,num:+$('num').value,diff:+$('diff').value,laps:+$('laps').value,wx:$('wx').value,tod:$('tod').value,nitro:$('nit').value=='1',coll:$('col').value=='1'}}
document.querySelectorAll('#menu select').forEach(s=>s.onchange=renderMenu);
$('go').onclick=()=>startRace(readCfg());
$('reset').onclick=()=>{if(confirm('Erase all saved progress?')){localStorage.removeItem(SAVE);save={credits:5000,xp:0,wins:0,races:0,podiums:0,topSpeed:0};renderMenu()}};

// ---------- track / world ----------
function buildTrack(loc){
  const K=[[300,80,50,3,2],[260,110,40,2,5],[340,60,90,4,3],[250,60,60,4,3],[330,50,80,2,3],[230,55,45,3,4]][loc],pts=[];
  for(let i=0;i<14;i++){const a=i/14*Math.PI*2,r=K[0]+K[1]*Math.sin(K[3]*a)+K[2]*Math.cos(K[4]*a);pts.push(new T.Vector3(Math.cos(a)*r,0,Math.sin(a)*r))}
  P=new T.CatmullRomCurve3(pts,true).getSpacedPoints(N).slice(0,N);Tn=[];Nm=[];
  for(let i=0;i<N;i++){const a=P[(i+1)%N],b=P[(i+N-1)%N],t=new T.Vector3().subVectors(a,b).normalize();Tn.push(t);Nm.push(new T.Vector3(t.z,0,-t.x))}
  // per-index curvature, used by the AI: precomputed so the physics loop never allocates
  CURV=[];for(let i=0;i<N;i++){const a=Tn[i],b=Tn[(i+30)%N];CURV.push(Math.abs(Math.atan2(a.x*b.z-a.z*b.x,a.x*b.x+a.z*b.z)))}
}
function strip(off,w,col,y){const g=new T.BufferGeometry(),v=[],ix=[];
  for(let i=0;i<=N;i++){const k=i%N,p=P[k],n=Nm[k];v.push(p.x+n.x*(off-w/2),y,p.z+n.z*(off-w/2),p.x+n.x*(off+w/2),y,p.z+n.z*(off+w/2));if(i<N){const a=i*2;ix.push(a,a+1,a+2,a+1,a+3,a+2)}}
  g.setAttribute('position',new T.Float32BufferAttribute(v,3));g.setIndex(ix);g.computeVertexNormals();
  // Lambert instead of Standard: same look on matte asphalt/grass for a fraction of the fill cost
  return new T.Mesh(g,new T.MeshLambertMaterial({color:col,side:T.DoubleSide}))}
function clearWorld(){world.forEach(o=>{scene.remove(o);vxReleaseMesh(o)});world=[];cars=[]}
// Disposal is only safe for resources this game created. A .glb car clone shares its geometry and its
// untinted materials with the cached prototype in VXMODELS, so only the per-instance material clones
// (tagged vxOwn by vxPaint in models.js) are released, never the shared ones.
function vxReleaseMesh(o){
  const shared=!!(o.userData&&o.userData.model);
  if(!o.traverse){if(!shared&&o.geometry)o.geometry.dispose();return}
  o.traverse(c=>{
    if(!shared&&c.geometry&&c.geometry.dispose)c.geometry.dispose();
    const m=c.material;if(!m)return;
    const list=Array.isArray(m)?m:[m];
    for(let i=0;i<list.length;i++){const mm=list[i];if(!mm)continue;
      if(shared?!(mm.userData&&mm.userData.vxOwn):true){
        if(!shared&&mm.map&&mm.map.dispose)mm.map.dispose();
        else if(!shared)
          for(const k in mm){const v=mm[k];if(v&&v.isTexture&&v.dispose)v.dispose()}
        if(mm.dispose)mm.dispose()
      }};
  });
}
const add=o=>{scene.add(o);world.push(o);return o};
function buildWorld(c){
  clearWorld();buildTrack(c.loc);
  const sky={day:0x87b8e8,sunset:0xff8a50,night:0x05070d}[c.tod];
  // one entry per location (6): an out-of-range loc used to leave `ground` undefined, which made
  // three.js warn "'color' parameter is undefined" on every build for that location
  const ground=[0x2f6b2f,0xc9a45c,0x4d6b4a,0x1b2028,0xb9a06a,0x4a453d][c.loc]||0x3a5a3a;
  const fogOn=c.wx=='fog',rainOn=c.wx=='rain';
  const skyC=new T.Color(sky);if(rainOn||fogOn)skyC.lerp(new T.Color(0x777f88),.6);
  scene.background=skyC;scene.fog=fogOn?new T.FogExp2(skyC,.017):new T.Fog(skyC,rainOn?120:300,rainOn?520:1100);
  const dim={day:1,sunset:.65,night:.14}[c.tod]*(rainOn||fogOn?.7:1);
  add(new T.HemisphereLight(0xffffff,0x334433,dim));
  sunL=add(new T.DirectionalLight(c.tod=='sunset'?0xff9955:0xffffff,dim*1.1));sunL.position.set(200,300,100);
  const gm=add(new T.Mesh(new T.PlaneGeometry(4000,4000),new T.MeshLambertMaterial({color:ground})));gm.rotation.x=-Math.PI/2;gm.position.y=-.05;
  const wet=rainOn;add(strip(0,24,wet?0x1a1d22:0x33363c,0.02));
  add(strip(-11.5,.6,0xffffff,.04));add(strip(11.5,.6,0xffffff,.04));
  for(let i=0;i<N;i+=6){const m=add(strip(0,.5,0xdddd66,.045));break}
  const sl=add(new T.Mesh(new T.BoxGeometry(24,.1,2),new T.MeshBasicMaterial({color:0xffffff})));sl.position.set(P[0].x,.06,P[0].z);sl.rotation.y=Math.atan2(Tn[0].x,Tn[0].z);
  // scenery (instanced)
  const tr=new T.InstancedMesh(new T.ConeGeometry(4,16,6),new T.MeshLambertMaterial({color:[0x1d4a1d,0x8a6a3a,0x3b5a3b][c.loc]||0x1d4a1d}),220),d=new T.Object3D();let k=0;
  while(k<220){const a=Math.random()*6.28,r=78+Math.random()*500,x=Math.cos(a)*r,z=Math.sin(a)*r;let ok=true;
    for(let i=0;i<N;i+=4)if((P[i].x-x)**2+(P[i].z-z)**2<35*35){ok=false;break}
    if(ok){d.position.set(x,8,z);d.scale.setScalar(.6+Math.random());d.updateMatrix();tr.setMatrixAt(k++,d.matrix)}}
  add(tr);
  // rain
  rain=null;if(rainOn){const v=[];for(let i=0;i<800;i++){const x=Math.random()*120-60,y=Math.random()*60,z=Math.random()*120-60;v.push(x,y,z,x,y-1.6,z)}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(v,3));rain=add(new T.LineSegments(g,new T.LineBasicMaterial({color:0xaabbcc,transparent:true,opacity:.5})))}
}

// ---------- cars ----------
function mkMesh(col){const g=new T.Group(),m=new T.MeshStandardMaterial({color:col,metalness:.6,roughness:.3});
  const b=new T.Mesh(new T.BoxGeometry(2,.6,4.4),m);b.position.y=.5;g.add(b);
  const cab=new T.Mesh(new T.BoxGeometry(1.6,.5,1.8),new T.MeshStandardMaterial({color:0x111418,metalness:.8,roughness:.1}));cab.position.set(0,1,-.2);g.add(cab);
  const w=new T.Mesh(new T.BoxGeometry(2.2,.1,.5),m);w.position.set(0,1.1,-2);g.add(w);
  [[-1,1.4],[1,1.4],[-1,-1.4],[1,-1.4]].forEach(p=>{const t=new T.Mesh(new T.CylinderGeometry(.42,.42,.35,14),new T.MeshStandardMaterial({color:0x111111}));t.rotation.z=Math.PI/2;t.position.set(p[0]*1.05,.42,p[1]);g.add(t)});
  const tl=new T.Mesh(new T.BoxGeometry(1.6,.15,.1),new T.MeshBasicMaterial({color:0xff2020}));tl.position.set(0,.65,-2.2);g.add(tl);return g}
function mkCar(def,i,isP,c){
  const back=3+Math.floor(i/2)*2,idx=(N-back)%N,side=(i%2?1:-1)*4,p=P[idx].clone().addScaledVector(Nm[idx],side);
  const o={def,isP,x:p.x,z:p.z,h:Math.atan2(Tn[idx].x,Tn[idx].z),vx:0,vz:0,idx,tot:-back,nit:100,fin:null,mesh:mkMesh(def.c),input:{t:0,b:0,s:0,hb:0,n:0},cp:0,
    name:isP?'YOU':NAMES[i%NAMES.length],pers:PERS[Math.floor(Math.random()*5)],lane:(Math.random()-.5)*8,drift:0,px:p.x,pz:p.z,ph:Math.atan2(Tn[idx].x,Tn[idx].z)};
  add(o.mesh);return o}
function startRace(c){
  // every entry point into a race (menu, retry, the test bridge, career) must leave the garage /
  // showroom behind: showGarage() parks the main loop with VX_SUSPEND=1, so a race started straight
  // from there used to sit on the countdown forever with a dead render loop
  if(typeof gOn!='undefined'&&gOn){gOn=0;const gd=$('garage');if(gd)gd.classList.add('hidden')}
  window.VX_SUSPEND=0;
  cfg=c;buildWorld(c);
  const pool=[...CARS.keys()].filter(i=>i!=c.car);
  // player takes last grid slot so rank must be earned
  const slots=[...Array(c.num).keys()];
  slots.forEach(i=>{const isP=i==c.num-1;const def=isP?CARS[c.car]:CARS[pool[i%pool.length]];const o=mkCar(def,i,isP,c);cars.push(o);if(isP)player=o});
  cars.forEach(o=>{o.sk=SKILL[c.diff]*(o.pers=='Speed-focused'?1.02:o.pers=='Technical'?1.0:.985)*(.97+Math.random()*.05)});
  // night: a cheap additive headlight beam instead of a SpotLight — a real spotlight is evaluated
  // per fragment on every lit surface, which costs more than the whole car does on integrated GPUs
  if(c.tod=='night'){const hb=new T.Group(),cone=new T.Mesh(new T.ConeGeometry(9,44,10,1,true),new T.MeshBasicMaterial({color:0xfff2cc,transparent:true,opacity:.10,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending}));
    cone.rotation.x=Math.PI/2;cone.position.z=22;hb.add(cone);spot=add(hb)}else spot=null;
  $('menu').classList.add('hidden');$('res').classList.add('hidden');$('hud').classList.remove('hidden');
  state='count';cdT=4;raceT=0;msg(`${c.num} CARS · ${c.laps} LAPS`);
}
function msg(t){$('msg').textContent=t;msgT=2}

// ---------- physics (fixed timestep) ----------
function nearest(o){let best=1e12,bi=o.idx;for(let k=-8;k<=30;k++){const i=(o.idx+k+N)%N,d=(P[i].x-o.x)**2+(P[i].z-o.z)**2;if(d<best){best=d;bi=i}}
  let dd=bi-o.idx;if(dd>N/2)dd-=N;if(dd<-N/2)dd+=N;o.tot+=dd;o.idx=bi;
  const n=Nm[bi];return(o.x-P[bi].x)*n.x+(o.z-P[bi].z)*n.z}
function step(o,dt){
  const I=o.input,d=o.def,wet=cfg.wx=='rain'?.78:1,fx=Math.sin(o.h),fz=Math.cos(o.h),rx=fz,rz=-fx;
  let vF=o.vx*fx+o.vz*fz,vL=o.vx*rx+o.vz*rz;
  const useN=cfg.nitro&&I.n&&o.nit>0&&I.t>0;if(useN)o.nit=Math.max(0,o.nit-(d.nd||28)*dt);else o.nit=Math.min(100,o.nit+(d.nr||6)*dt);
  const top=d.top*(useN?1.22:1);
  if(I.t>0)vF+=d.pw*(useN?(d.nb||1.8):1)*I.t*clamp(1-vF/top,0,1)*dt*(wet<1?.92:1);
  if(I.b>0){vF>1?vF-=(d.br||42)*wet*I.b*dt:vF-=14*I.b*dt}
  vF-=vF*.05*dt+Math.sign(vF)*1.2*dt+vF*Math.abs(vF)*.00035*dt;
  const grip=d.gr*wet*(I.hb?.22:1)*(1+(d.df||0)*I.t);vL*=Math.exp(-grip*dt);
  o.h+=I.s*d.hd*clamp(vF/12,-1,1)/(1+Math.abs(vF)/38)*dt*(I.hb?1.5:1);
  const sd=nearest(o),off=Math.abs(sd);
  if(off>12.5)vF-=vF*1.4*dt;
  if(off>19){const n=Nm[o.idx],s=Math.sign(sd);o.x-=n.x*s*(off-19);o.z-=n.z*s*(off-19);
    const into=Math.abs(o.vx*n.x*s+o.vz*n.z*s);                      // how hard we press into the barrier
    vF*=into>8?.55:Math.max(.9,1-1.2*dt);                            // a real hit stops you, a graze just scrubs
    if(o.isP)msg('WALL!')}
  const fx2=Math.sin(o.h),fz2=Math.cos(o.h);o.vx=fx2*vF+fz2*vL;o.vz=fz2*vF-fx2*vL;
  o.x+=o.vx*dt;o.z+=o.vz*dt;o.spd=Math.abs(vF);o.drift=Math.abs(vL);o.useN=useN;
  const cpn=Math.floor(o.tot/(N/8));if(o.isP&&cpn>o.cp&&o.tot>0){msg('CHECKPOINT');}o.cp=Math.max(o.cp,cpn);
  if(!o.fin&&o.tot>=cfg.laps*N){o.fin=raceT;o.input={t:0,b:.6,s:0,hb:0,n:0};}
}
// one shared "no input" record: the physics step runs 60x per second for every car, and building a fresh
// object each time (as `o.input={...}` did) threw thousands of short-lived objects a second at the GC —
// the classic source of a periodic 20-40ms hitch during a race
const VX_IDLE = { t: 0, b: 0, s: 0, hb: 0, n: 0 };
function setInput(o, t, b, s, hb, n) {
  const I = o.input || (o.input = { t: 0, b: 0, s: 0, hb: 0, n: 0 });
  I.t = t; I.b = b; I.s = s; I.hb = hb; I.n = n; return I;
}
function ai(o){
  if(o.fin){setInput(o,0,.5,0,0,0);return}
  const spd=Math.hypot(o.vx,o.vz),look=8+Math.floor(spd/6);
  let lane=o.lane;
  // a plain loop, and sin/cos hoisted out of it: this runs once per car 60 times a second and the old
  // version allocated a closure per call and recomputed two trig pairs per rival
  if(cfg.coll){const sh=Math.sin(o.h),ch=Math.cos(o.h),bias=o.pers=='Aggressive'?6:o.pers=='Defensive'?3:5;
    for(let i=0;i<cars.length;i++){const q=cars[i];if(q===o)continue;const dx=q.x-o.x,dz=q.z-o.z,fwd=dx*sh+dz*ch,lat=dx*ch-dz*sh;
      if(fwd>0&&fwd<22&&Math.abs(lat)<3.5)lane+=(lat>0?-1:1)*bias}}
  lane=clamp(lane,-8,8);
  const ti=(o.idx+look)%N,tx=P[ti].x+Nm[ti].x*lane,tz=P[ti].z+Nm[ti].z*lane;
  let e=Math.atan2(tx-o.x,tz-o.z)-o.h;while(e>Math.PI)e-=6.283;while(e<-Math.PI)e+=6.283;
  const a=CURV[o.idx]||0;                                            // precomputed: no vector clones per step
  const vmax=o.def.top*o.sk*(1-Math.min(a*1.5,.55)),v=spd;
  setInput(o,v<vmax?1:0,v>vmax+4?clamp((v-vmax)/20,.2,1):0,clamp(e*2.6,-1,1),0,(a<.06&&o.nit>40&&(o.pers=='Aggressive'||o.pers=='Speed-focused'||o.pers=='Balanced'))?1:0);
}
function collide(){if(!cfg.coll)return;
  for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++){const a=cars[i],b=cars[j],dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);
    if(d<3.4&&d>.01){const p=(3.4-d)/2,nx=dx/d,nz=dz/d;a.x-=nx*p;a.z-=nz*p;b.x+=nx*p;b.z+=nz*p;a.vx*=.97;a.vz*=.97;b.vx*=.97;b.vz*=.97;if((a.isP||b.isP)&&d<3)msg('COLLISION')}}}
const RANKBUF=[];
function rank(){const b=RANKBUF;b.length=0;for(let i=0;i<cars.length;i++)b.push(cars[i]);
  b.sort((a,b)=>(a.fin!=null&&b.fin!=null)?a.fin-b.fin:a.fin!=null?-1:b.fin!=null?1:b.tot-a.tot);return b}

// ---------- input ----------
addEventListener('keydown',e=>{keys[e.code]=1;if(e.code=='KeyC')camMode=(camMode+1)%VX_CAMS;
  if(e.code=='KeyR'&&player&&state=='race'){const i=player.idx;player.x=P[i].x;player.z=P[i].z;player.h=Math.atan2(Tn[i].x,Tn[i].z);player.vx=player.vz=0}
  if(e.code=='Escape'){if(state=='race'){if(typeof pauseGame=='function')pauseGame();else{state='pause';$('pause').classList.remove('hidden')}}else if(state=='pause')resume()}
  if(['Space','ArrowUp','ArrowDown'].includes(e.code))e.preventDefault()});
addEventListener('keyup',e=>keys[e.code]=0);
// A window that loses focus never receives the matching keyup, and a touch that is cancelled by the OS
// never receives its pointerup: both used to leave the throttle or the steering latched, so the car drove
// itself into a wall the moment you came back. Drop every held input on blur / hide.
function vxDropInput(){
  for(const k in keys)keys[k]=0;
  if(typeof VXTRL!='undefined'&&VXTRL.touch)for(const k in VXTRL.touch)VXTRL.touch[k]=0;
  const held=document.querySelectorAll&&document.querySelectorAll('#vxtch .vxbtn.down');
  if(held)for(let i=0;i<held.length;i++)held[i].classList.remove('down');
  if(typeof vxHornHold=='function')vxHornHold(false);
}
addEventListener('blur',vxDropInput);
document.addEventListener('visibilitychange',()=>{if(document.hidden)vxDropInput()});
function resume(){state='race';$('pause').classList.add('hidden')}
$('resume').onclick=resume;$('quit').onclick=quit;$('tomenu').onclick=quit;$('retry').onclick=()=>startRace(cfg);
function quit(){state='menu';clearWorld();$('pause').classList.add('hidden');$('res').classList.add('hidden');$('hud').classList.add('hidden');$('menu').classList.remove('hidden');renderMenu()}
function readInput(){const k=keys,I=player.input||(player.input={t:0,b:0,s:0,hb:0,n:0});
  I.t=(k.KeyW||k.ArrowUp)?1:0;I.b=(k.KeyS||k.ArrowDown)?1:0;I.s=((k.KeyA||k.ArrowLeft)?1:0)-((k.KeyD||k.ArrowRight)?1:0);I.hb=k.Space?1:0;I.n=(k.ShiftLeft||k.ShiftRight)?1:0;
  const g=(navigator.getGamepads&&navigator.getGamepads()[0]);if(g){I.t=Math.max(I.t,g.buttons[7]?.value||0);I.b=Math.max(I.b,g.buttons[6]?.value||0);if(Math.abs(g.axes[0])>.1)I.s=-g.axes[0];if(g.buttons[0]?.pressed)I.n=1}}
// camera cycling is shared with the touch / pad buttons (input.js) and the auto-drive cinematic director;
// 5 angles now, so the % wraps on the count instead of a hard-coded 3
const VX_CAMS=5;


// ---------- audio ----------
let osc,og;function engineSnd(rpm,nit){if(!aud)return;if(!osc){osc=aud.createOscillator();osc.type='sawtooth';og=aud.createGain();og.gain.value=.04;const f=aud.createBiquadFilter();f.frequency.value=700;osc.connect(f);f.connect(og);og.connect(aud.destination);osc.start()}
  osc.frequency.value=45+rpm*90;og.gain.value=state=='race'||state=='count'?.035+(nit?.02:0):0}

// ---------- finish ----------
function finish(){
  state='done';const r=rank(),pos=r.indexOf(player)+1,n=cfg.num;
  const cr=Math.round((n-pos+1)/n*cfg.num*150+(pos==1?500:0)),xp=Math.round((n-pos+1)/n*400+(pos==1?300:0));
  save.credits+=cr;save.xp+=xp;save.races++;if(pos==1)save.wins++;if(pos<=3)save.podiums++;persist();
  $('rt').innerHTML=`<h3>FINAL POSITION ${pos}/${n} · TIME ${fmt(player.fin)}</h3><div>Rewards: +${cr} credits · +${xp} XP</div><table><tr><th>#</th><th>Driver</th><th>Car</th><th>Personality</th><th>Result</th></tr>${r.map((c,i)=>`<tr class="${c.isP?'me':''}"><td>${i+1}</td><td>${c.name}</td><td>${c.def.n}</td><td>${c.isP?'—':c.pers}</td><td>${c.fin!=null?fmt(c.fin):'racing · '+(c.tot/N).toFixed(2)+' laps'}</td></tr>`).join('')}</table>`;
  $('res').classList.remove('hidden');$('hud').classList.add('hidden')}
const fmt=t=>{const m=Math.floor(t/60);return m+':'+(t%60).toFixed(2).padStart(5,'0')};

// ---------- main loop ----------
// The canvas is sized in CSS pixels and the drawing buffer follows the device pixel ratio (capped in
// vxBaseRatio). Resizing on orientationchange matters: a phone fires it before it reports the new
// innerWidth, so the resize is repeated once the browser has settled.
function resize(force){
  if(!renderer||!camera)return;
  const w=Math.max(1,Math.round(innerWidth)),h=Math.max(1,Math.round(innerHeight));
  // setSize reallocates the drawing buffer and clears the canvas. A phone fires resize for every pixel the
  // URL bar slides and visualViewport does it again for scroll, so the work is skipped unless something
  // actually changed — that repeated reallocation was a visible hitch every time the chrome moved.
  if(!force&&w===resize.w&&h===resize.h&&renderer.getSize&&renderer.getSize(VXVEC2)&&VXVEC2.x===w&&VXVEC2.y===h)return;
  resize.w=w;resize.h=h;
  renderer.setSize(w,h,false);
  camera.aspect=w/h;camera.updateProjectionMatrix();
  VXSTAT.pr=renderer.getPixelRatio?renderer.getPixelRatio():1;
}
const vxOnResize=()=>{resize();clearTimeout(vxOnResize.t);vxOnResize.t=setTimeout(resize,200)};
addEventListener('resize',vxOnResize);
addEventListener('orientationchange',()=>{resize();setTimeout(resize,120);setTimeout(resize,420)});
if(window.visualViewport&&visualViewport.addEventListener)visualViewport.addEventListener('resize',vxOnResize);
// A lost WebGL context (driver reset, phone call, another tab eating the GPU) must not leave a black
// screen: the loop stops drawing, and on restore the size and quality are re-applied.
const VXGL={lost:0,restores:0};
(function(){
  const cv=$('gl');if(!cv||!cv.addEventListener)return;
  cv.addEventListener('webglcontextlost',e=>{e.preventDefault();VXGL.lost=1;msg('GRAPHICS CONTEXT LOST · RESTORING');});
  cv.addEventListener('webglcontextrestored',()=>{VXGL.lost=0;VXGL.restores++;resize(1);if(typeof applyQ=='function')applyQ();msg('GRAPHICS RESTORED')});
})();
// A hidden tab does no work at all; coming back must not deliver one enormous delta time.
addEventListener('visibilitychange',()=>{
  if(document.hidden){if(typeof VXAUD!='undefined'&&VXAUD.ctx&&VXAUD.ctx.suspend)VXAUD.ctx.suspend().catch(()=>{})}
  else{last=performance.now();acc=0;if(typeof VXAUD!='undefined'&&VXAUD.ctx&&VXAUD.ctx.resume)VXAUD.ctx.resume().catch(()=>{})}
});
const nitBtn=$('nf');
const VXVEC=new T.Vector3();
const H={pos:$('pos'),lap:$('lap'),tim:$('tim'),cp:$('cp'),spd:$('spd'),gear:$('gear'),rpm:$('rpm')};
function hudTxt(el,v){v=String(v);if(el && el.__v!==v){el.__v=v;el.textContent=v}}
// ---------- cameras (0 chase · 1 close · 2 hood · 3 drone · 4 trackside) ----------
function vxCamera(p,spd,fx,fz,dt){
  let px,py,pz,lx,ly,lz,lag=.18;
  if(camMode==2){                                    // hood / cockpit: rigid, no lag
    px=p.x+fx*.3;py=1.18;pz=p.z+fz*.3;lx=p.x+fx*40;ly=1.15;lz=p.z+fz*40;lag=1;
  }else if(camMode==3){                              // drone: high, behind, drifting outward with speed
    const out=6+Math.min(6,spd*.06);
    px=p.x-fx*(11+out*.5)+fz*4;py=7.5+out*.35;pz=p.z-fz*(11+out*.5)-fx*4;
    lx=p.x+fx*6;ly=.6;lz=p.z+fz*6;lag=.09;
  }else if(camMode==4){                              // trackside: a fixed point on the bank
    const d=Math.abs(((p.idx-VXCAM.ai+N*1.5)%N)-N*.5);
    if(VXCAM.ax==null||d>52){const i=(p.idx+42)%N;VXCAM.ai=i;VXCAM.ax=P[i].x+Nm[i].x*19;VXCAM.az=P[i].z+Nm[i].z*19}
    px=VXCAM.ax;py=2.3;pz=VXCAM.az;lx=p.x;ly=1;lz=p.z;lag=1;
  }else{                                             // chase (0) and close chase (1)
    const back=camMode==1?6:9.5, high=camMode==1?2.6:4.2;
    px=p.x-fx*back;py=high;pz=p.z-fz*back;lx=p.x+fx*20;ly=1.2;lz=p.z+fz*20;
  }
  VXVEC.set(px,py,pz);
  if(lag>=1)camera.position.copy(VXVEC);else camera.position.lerp(VXVEC,Math.min(1,lag*(dt?60*dt:1)));
  camera.lookAt(lx,ly,lz);
}
function vxStatTick(t,dt){
  const ms=dt*1000;
  VXSTAT.ms=VXSTAT.ms?VXSTAT.ms*.85+ms*.15:ms;
  if(ms>VXSTAT.worst&&state=='race')VXSTAT.worst=ms;
  VXSTAT.buf[VXSTAT.bi]=ms;VXSTAT.bi=(VXSTAT.bi+1)%VXSTAT.buf.length;if(VXSTAT.bn<VXSTAT.buf.length)VXSTAT.bn++;
  VXSTAT.n++;VXSTAT.acc+=dt;
  if(VXSTAT.acc>=.5){
    VXSTAT.fps=Math.round(VXSTAT.n/VXSTAT.acc);VXSTAT.n=0;VXSTAT.acc=0;
    // 1% low = the 99th percentile frame time of the window. TypedArray.sort() is numeric and in place,
    // so the scratch copy is sorted directly — the old slice()+sort(cmp) allocated two arrays twice a second
    const n=VXSTAT.bn,s=VXSTAT.scratch||(VXSTAT.scratch=new Float32Array(VXSTAT.buf.length));
    for(let i=0;i<n;i++)s[i]=VXSTAT.buf[i];
    const part=s.subarray(0,n);part.sort();
    VXSTAT.p1=n?Math.round(part[Math.max(0,n-1-Math.floor(n*.01))]*10)/10:0;
  }
  if(renderer&&renderer.info){VXSTAT.calls=renderer.info.render.calls;VXSTAT.tris=renderer.info.render.triangles}
  VXSTAT.pr=renderer&&renderer.getPixelRatio?renderer.getPixelRatio():VXSTAT.pr;
  const dbg=$('vxdbg');
  if(dbg&&save.set&&+save.set.dbg){if(!dbg.classList.contains('on'))dbg.classList.add('on')}
  else if(dbg&&dbg.classList.contains('on'))dbg.classList.remove('on');
  if(dbg&&dbg.classList.contains('on'))hudTxt(dbg,'FPS '+VXSTAT.fps+'  '+Math.round(VXSTAT.ms*10)/10+' ms\n1% low '+VXSTAT.p1+' ms  worst '+Math.round(VXSTAT.worst)+' ms\ndraws '+VXSTAT.calls+'  tris '+(VXSTAT.tris/1000).toFixed(0)+'k\npixelRatio '+VXSTAT.pr.toFixed(2));
}
// One rendering frame. It is wrapped below so that a single exception (a driver hiccup, a GLB that failed
// mid-race) can never leave the player staring at a frozen picture with the loop still spinning.
function vxFrame(t){
  if(window.VX_SUSPEND||VXGL.lost||document.hidden)return;
  const dt=Math.min((t-last)/1000||0,.1);last=t;vxStatTick(t,dt);
  if(state=='menu'||!player){camera.position.set(0,260,400);camera.lookAt(0,0,0);renderer.render(scene,camera);return}
  if(state=='count'||state=='resume'){const rs=state=='resume';cdT-=dt;const c=Math.ceil(cdT-(rs?0:1));
    hudTxt($('cd'),c>0?c:(rs?'':'GO!'));if(cdT<=0){state='race';hudTxt($('cd'),'')}}
  if(state=='race'||state=='done'||state=='count'||state=='resume'){acc+=dt;
    let guard=0;
    while(acc>=1/60&&guard++<8){acc-=1/60;
      // remember the previous physics state: the renderer interpolates between it and the new one
      for(let i=0;i<cars.length;i++){const o=cars[i];o.px=o.x;o.pz=o.z;o.ph=o.h}
      if(state=='resume')continue;                                     // frozen during the 3 s resume countdown
      if(state=='count'){for(let i=0;i<cars.length;i++)setInput(cars[i],0,1,0,0,0)}
      // for loops, not forEach: these run 60x a second and every callback is a fresh closure
      else{for(let i=0;i<cars.length;i++){const o=cars[i];o.isP&&!o.fin?readInput():ai(o)}if(state=='race')raceT+=1/60}
      for(let i=0;i<cars.length;i++){const o=cars[i];if(state=='count'){o.vx=o.vz=0}else step(o,1/60)}collide();
      if(state=='race'&&player.fin!=null)finish()}
    if(acc>1/60)acc=1/60;                                              // no spiral of death
  }
  vxStuckAssist(dt);
  // --- render: interpolate every car between the last two physics states ---
  const alpha=(state=='race'||state=='count'||state=='resume')?Math.min(1,acc*60):1;
  for(let i=0;i<cars.length;i++){const o=cars[i];
    let x=o.x,z=o.z,h=o.h;
    if(o.px!=null){const dx=o.x-o.px,dz=o.z-o.pz;
      if(Math.abs(dx)<6&&Math.abs(dz)<6){x=o.px+dx*alpha;z=o.pz+dz*alpha;
        let dh=(o.h-o.ph+Math.PI*3)%6.283185307- Math.PI;h=o.ph+dh*alpha}}
    o.mesh.position.set(x,0,z);o.mesh.rotation.y=h}
  const p=player,spd=Math.hypot(p.vx,p.vz),fx=Math.sin(p.h),fz=Math.cos(p.h);
  vxCamera(p,spd,fx,fz,dt);
  const fovWant=(save.set.fov||62)+spd*.25+(p.useN?14:0);
  if(Math.abs(camera.fov-fovWant)>.15){camera.fov=fovWant;camera.updateProjectionMatrix();}
  if(spot){spot.position.set(p.x,1.3,p.z);spot.rotation.y=p.h}
  // direct typed-array access: BufferAttribute.getY/setY go through a call plus bounds checks per component,
  // i.e. 3200 of them per frame for 800 drops. The raw array needs one index multiply instead.
  if(rain){rain.position.set(camera.position.x,0,camera.position.z);const a=rain.geometry.attributes.position,ar=a.array,nv=a.count;
    for(let v=0;v<nv;v+=2){let y=ar[v*3+1]-70*dt;if(y<0)y+=60;ar[v*3+1]=y;ar[v*3+4]=y-1.6}
    a.needsUpdate=true}
  // HUD — cached nodes, and every write is skipped when the text has not changed (textContent writes
  // invalidate layout; doing eight of them per frame was pure jank)
  const r=rank(),pos=r.indexOf(p)+1,spdOut=Math.round(spd*(save.set.mph?2.237:3.6));save.topSpeed=Math.max(save.topSpeed,Math.round(spd*3.6));
  const gear=clamp(Math.floor(spd/(p.def.top/6))+1,1,6),rpmf=(spd%(p.def.top/6))/(p.def.top/6);
  const reversing=(p.vx*Math.sin(p.h)+p.vz*Math.cos(p.h))<-1;
  hudTxt(H.pos,'P'+pos+'/'+cfg.num);hudTxt(H.lap,'LAP '+clamp(Math.floor(p.tot/N)+1,1,cfg.laps)+'/'+cfg.laps);hudTxt(H.tim,fmt(raceT));
  hudTxt(H.cp,'CHECKPOINT '+clamp(p.cp,0,8)%8+'/8 · '+Math.round(clamp(p.tot/(cfg.laps*N),0,1)*100)+'% DONE');
  hudTxt(H.spd,spdOut);hudTxt(H.gear,reversing?'R':gear);hudTxt(H.rpm,Math.round(1500+rpmf*6500));
  if(nitBtn.style.width!==p.nit+'%')nitBtn.style.width=p.nit+'%';
  const ncol=p.useN?'#FF6A00':'#00E5FF';if(nitBtn.style.background!==ncol)nitBtn.style.background=ncol;
  if(msgT>0){msgT-=dt;if(msgT<=0)$('msg').textContent=''}
  if(typeof vxAudFrame=='function')vxAudFrame(p,spd,gear,1500+rpmf*6500);else engineSnd(gear*.12+rpmf,p.useN);renderer.render(scene,camera)
}
let vxFrameErrN=0;
// ---------- stuck recovery ----------
// Steering is scaled by speed (step() multiplies by clamp(vF/12)), so a car wedged square against a
// barrier with the throttle held cannot turn away again: the player had to know about R. If the car has
// not moved for three seconds with a pedal pressed, put it back on the racing line — any mode, any car.
let vxStuckT=0;
function vxStuckAssist(dt){
  if(state!='race'||!player||player.fin!=null||!cfg||+save.set.stuckAid===0){vxStuckT=0;return}
  const I=player.input||VX_IDLE;
  if(player.spd<1.5&&(I.t>0||I.b>0))vxStuckT+=dt;else vxStuckT=0;
  if(vxStuckT<3)return;
  vxStuckT=0;
  const i=player.idx,p=P[i];
  player.x=p.x;player.z=p.z;player.h=Math.atan2(Tn[i].x,Tn[i].z);
  player.vx=player.vz=0;player.px=player.x;player.pz=player.z;player.ph=player.h;
  msg('THROTTLE STUCK · RECOVERED');
}
function frame(t){
  requestAnimationFrame(frame);
  try{vxFrame(t);vxFrameErrN=0}
  catch(e){
    if(vxFrameErrN<3&&window.console)console.error('[vx] frame failed',e);
    // 90 consecutive failures is ~1.5 s of a dead picture: leave the race instead of freezing on it
    if(++vxFrameErrN==90){vxFrameErrN=0;try{if(typeof quit=='function')quit()}catch(e2){}}
  }
}
boot();requestAnimationFrame(frame);
