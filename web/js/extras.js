// VELOCITY X extras: 12 cars, 6 locations, 6 modes, traffic, garage, customization, upgrades, career, settings
save=Object.assign({owned:[0],up:{},cu:{},ach:[],rec:{},set:{q:4,vol:.6,mph:0,steer:1},nm:0,dbest:0,champs:0},save);
const LOCS=['Professional Circuit','Desert Frontier','Alpine Pass','Neon Metropolis','Coastal Highway','Industrial District'];
const RAW=[['Phantom R','S',0xd01010,30,78,5,2.6,0,1,4.4,2,.6],['Apex GT','A',0x2255ff,27,74,5.8,2.9,25000,1,4.4,2,.6],['Sahara X','B',0xff8a00,25,68,4.4,2.5,18000,1,4.6,2.1,.8],['Silver Arrow','S',0xc8ccd4,33,84,4.2,2.3,60000,3,4.6,2,.55],['Street Viper','C',0x22aa44,21,60,4.8,2.6,8000,1,4.2,1.9,.6],['Drift King','B',0xeeeeee,23,64,4,3,12000,1,4.3,1.9,.62],['Muscle V8','A',0x222222,28,70,3.8,2.2,22000,2,4.8,2.1,.7],['Rally Pro','B',0x1a5fd0,24,62,5.2,2.8,15000,2,4.2,1.9,.85],['Hyper Volt','X',0x00e5ff,36,92,4.6,2.6,150000,6,4.5,2.1,.5],['Ghost GT','S',0x111111,31,80,5.2,2.7,80000,4,4.5,2,.55],['Rocket S','A',0xffd400,29,72,4.6,2.7,35000,3,4.3,2,.58],['Titan 4x4','D',0x8a6a3a,19,56,4.6,2.2,5000,1,4.7,2.2,1]];
CARS.length=0;RAW.forEach((r,i)=>CARS.push({i,n:r[0],cls:r[1],c:r[2],pw:r[3],top:r[4],gr:r[5],hd:r[6],price:r[7],lvl:r[8],sh:[r[9],r[10],r[11]]}));
const BASE=CARS.map(c=>({...c})),lvl=()=>1+Math.floor(save.xp/1000),hex=n=>'#'+n.toString(16).padStart(6,'0');
function applyUp(){CARS.forEach((c,i)=>{const b=BASE[i],u=save.up[i]||{};c.pw=b.pw*(1+.04*(u.e||0)+.03*(u.w||0));c.top=b.top*(1+.025*(u.t||0));c.gr=b.gr*(1+.05*(u.r||0));c.hd=b.hd*(1+.04*(u.s||0)+.01*(u.w||0));c.pw*=1+.025*(u.x||0);c.br=42*(1+.08*(u.b||0));c.df=.04*(u.d||0);c.nb=1.8*(1+.05*(u.n||0));c.nd=28*(1-.06*(u.n||0));c.nr=6*(1+.1*(u.n||0))})}
applyUp();
const applyQ=()=>{renderer.setPixelRatio(typeof vxBaseRatio=='function'?vxBaseRatio():[.6,.85,1,Math.min(devicePixelRatio||1,2)][save.set.q]||1);resize();
 if(typeof VXPERF!='undefined'&&VXPERF){VXPERF.scale=1;VXPERF.ceiling=1;VXPERF.low=VXPERF.high=VXPERF.cool=0;VXPERF.applied=renderer.getPixelRatio()}};
document.head.insertAdjacentHTML('beforeend','<style>.wc{min-width:110px;height:clamp(64px,12vmin,80px);display:flex;align-items:flex-end;padding:6px;font-weight:700;cursor:pointer;border:2px solid transparent;background:linear-gradient(#0006,#000a),url(img/weather-reference.png);background-size:cover,250%}.wc.sel{border-color:#00E5FF}.gar{align-items:flex-start;justify-content:flex-start;background:none;pointer-events:none}.gar .panel{pointer-events:auto;width:min(440px,100%);max-height:100dvh;overflow:auto;margin:0}#xs{background:#080A0Ff2;overflow:auto;justify-content:flex-start}input[type=color]{width:48px;height:48px}</style>');
document.body.insertAdjacentHTML('beforeend','<div id="garage" class="screen hidden gar"></div><div id="xs" class="screen hidden"></div>');
// position/size come from the responsive CSS layer (safe-area aware); only the paint is inline
$('hud').insertAdjacentHTML('beforeend','<canvas id="mm" width=150 height=150 style="background:#0008"></canvas><div id="xhud" style="width:100%;text-align:center;font-weight:700;color:#FF6A00"></div>');

// ---- environments (6 locations) ----
buildTrack=function(loc){const K=[[300,80,50,3,2],[260,110,40,2,5],[340,60,90,4,3],[250,60,60,4,3],[330,50,80,2,3],[230,55,45,3,4]][loc],pts=[];
 for(let i=0;i<14;i++){const a=i/14*6.2832,r=K[0]+K[1]*Math.sin(K[3]*a)+K[2]*Math.cos(K[4]*a);pts.push(new T.Vector3(Math.cos(a)*r,0,Math.sin(a)*r))}
 P=new T.CatmullRomCurve3(pts,true).getSpacedPoints(N).slice(0,N);Tn=[];Nm=[];
 for(let i=0;i<N;i++){const t=new T.Vector3().subVectors(P[(i+1)%N],P[(i+N-1)%N]).normalize();Tn.push(t);Nm.push(new T.Vector3(t.z,0,-t.x))}
 // the AI reads precomputed curvature; this override must keep it in sync with game.js
 CURV=[];for(let i=0;i<N;i++){const a=Tn[i],b=Tn[(i+30)%N];CURV.push(Math.abs(Math.atan2(a.x*b.z-a.z*b.x,a.x*b.x+a.z*b.z)))}};
const _bw=buildWorld;
// ---- one identity per location: surface, kerbs, shoulders, barriers and scenery ----
const ROADKIT=[
  {sky:0x8ab8e0,ground:0x2f6b2f,road:0x33363c,wet:0x1a1d22,kerb:0xffffff,kerb2:0xd01010,shoulder:null,rail:0xb8c0c8,tree:0x1d4a1d,prop:'stand'},
  {sky:0xe8b57a,ground:0xc9a45c,road:0x8a7550,wet:0x5d4f34,kerb:0xe8d59a,kerb2:0xb08a4a,shoulder:0xbb9c5a,rail:null,tree:0x8a6a3a,prop:'cactus'},
  {sky:0xb9d4ea,ground:0xdfe6ea,road:0x3a3d42,wet:0x26292d,kerb:0xf4f7fa,kerb2:0x2f6ab0,shoulder:0xd6dee4,rail:0x8a929a,tree:0x2b4a33,prop:'pine'},
  {sky:0x2a1f4a,ground:0x23252b,road:0x1d2026,wet:0x14161b,kerb:0x00e5ff,kerb2:0x101318,shoulder:0x171a21,rail:0x2a3550,tree:0x1a2436,prop:'neon'},
  {sky:0x62c6e0,ground:0x2c7a4a,road:0x4a4f55,wet:0x2e3237,kerb:0xffffff,kerb2:0x1e6fa8,shoulder:0x2c7a4a,rail:0xffffff,tree:0x2c7a4a,prop:'palm'},
  {sky:0x9a8f7a,ground:0x545046,road:0x2e2a26,wet:0x201d1a,kerb:0xffb020,kerb2:0x2a2622,shoulder:0x474338,rail:0x8a8578,tree:0x3d4a3c,prop:'drum'}
];
const lam=(col,extra)=>new T.MeshLambertMaterial(Object.assign({color:col},extra||{}));
// kerb: one ribbon, colours alternating every `seg` samples, still a single draw call
function kerbStrip(off,w,a,b,seg,y){const g=new T.BufferGeometry(),v=[],c=[],ix=[],ca=new T.Color(a),cb=new T.Color(b);
  for(let i=0;i<=N;i++){const k=i%N,p=P[k],n=Nm[k];v.push(p.x+n.x*(off-w/2),y,p.z+n.z*(off-w/2),p.x+n.x*(off+w/2),y,p.z+n.z*(off+w/2));
    const col=(Math.floor(i/seg)%2)?ca:cb;c.push(col.r,col.g,col.b,col.r,col.g,col.b);
    if(i<N){const q=i*2;ix.push(q,q+1,q+2,q+1,q+3,q+2)}}
  g.setAttribute('position',new T.Float32BufferAttribute(v,3));g.setAttribute('color',new T.Float32BufferAttribute(c,3));g.setIndex(ix);g.computeVertexNormals();
  return new T.Mesh(g,lam(0xffffff,{vertexColors:true,side:T.DoubleSide}))}
// scatter instanced props off the racing line
function scatterProps(geo,mat,n,minR,maxR,clear,y){const m=new T.InstancedMesh(geo,mat,n),d=new T.Object3D();let k=0,g=0;
  while(k<n&&g++<n*10){const a=Math.random()*6.28,r=minR+Math.random()*(maxR-minR),x=Math.cos(a)*r,z=Math.sin(a)*r;let ok=true;
    for(let i=0;i<N;i+=5)if((P[i].x-x)**2+(P[i].z-z)**2<clear*clear){ok=false;break}
    if(ok){d.position.set(x,y||0,z);d.rotation.set(0,Math.random()*6.28,0);d.scale.set(.85+Math.random()*.5,1,.85+Math.random()*.5);d.updateMatrix();m.setMatrixAt(k++,d.matrix)}}
  m.count=k;return add(m)}
buildWorld=function(c){_bw(c);const L=c.loc,K=ROADKIT[L]||ROADKIT[0],wet=c.wx=='rain';
  world[2].material.color.set(K.ground);                                            // ground
  world[3].material.color.set(wet?K.wet:K.road);                                    // racing surface
  if(world[4]&&world[4].material)world[4].material.color.set(K.kerb);               // edge lines
  if(world[5]&&world[5].material)world[5].material.color.set(K.kerb);
  if(world[8]&&world[8].isInstancedMesh)world[8].material.color.set(K.tree);        // trees
  // each location gets its own atmosphere; the tod still decides how much of it shows
  const skym={day:.62,sunset:.42,night:.12}[c.tod]||0;
  if(K.sky!=null&&scene.background&&scene.background.isColor){scene.background.lerp(new T.Color(K.sky),skym);
    if(scene.fog&&scene.fog.color)scene.fog.color.copy(scene.background)}
  add(kerbStrip(-12.6,1.1,K.kerb,K.kerb2,6,.035));add(kerbStrip(12.6,1.1,K.kerb,K.kerb2,6,.035));
  if(K.shoulder!=null){add(strip(-16.5,7,K.shoulder,.012));add(strip(16.5,7,K.shoulder,.012))}
  if(K.rail!=null){add(strip(-13.5,.14,K.rail,.55));add(strip(13.5,.14,K.rail,.55))}
  const P_=K.prop;
  if(P_=='stand'){ // grandstands + a billboard wall, only on the circuit
    scatterProps(new T.BoxGeometry(1,1,1),lam(0x6b7079),14,60,220,32,0).scale.setScalar(1);
    scatterProps(new T.BoxGeometry(16,7,4),lam(0x8a3a3a),8,90,260,40,3.5);
    scatterProps(new T.BoxGeometry(1,1,1),lam(0xdfe4ea),10,120,320,40,4)}
  if(P_=='cactus'){scatterProps(new T.CylinderGeometry(.8,1.1,7,6),lam(0x2f6b3a),80,42,470,26,3.5);
    scatterProps(new T.IcosahedronGeometry(2.4,0),lam(0xb59a63),60,40,500,26,1.2)}
  if(P_=='pine'){scatterProps(new T.ConeGeometry(3,12,6),lam(0x2b4a33),90,42,480,26,6);
    scatterProps(new T.IcosahedronGeometry(2,0),lam(0xdfe6ea),50,45,420,26,1)}
  if(P_=='neon'){scatterProps(new T.BoxGeometry(2,26,2),lam(0x101827,{emissive:0x00b8d4}),60,45,420,30,13);
    scatterProps(new T.BoxGeometry(1,1,1),lam(0x141a26),50,60,300,42,1)}
  if(P_=='palm'){scatterProps(new T.CylinderGeometry(.6,.9,9,5),lam(0x8a6a3a),50,45,420,26,4.5);
    scatterProps(new T.ConeGeometry(5,3,7),lam(0x2c7a4a),50,45,420,26,9.6)}
  if(P_=='drum'){scatterProps(new T.CylinderGeometry(.9,.9,2.2,8),lam(0xb8622a),60,40,380,22,1.1);
    scatterProps(new T.BoxGeometry(12,5,4),lam(0x6c7178),30,55,320,34,2.5);
    scatterProps(new T.CylinderGeometry(1.8,2.4,26,7),lam(0x8f8578),14,90,340,44,13)}
  if(L==4){const s=add(new T.Mesh(new T.RingGeometry(650,2500,40),lam(0x1e6fa8)));s.rotation.x=-Math.PI/2;s.position.y=-.03}
  if(L==3||L==5){const n=L==3?50:40,b=new T.InstancedMesh(new T.BoxGeometry(1,1,1),lam(L==3?0x151a2a:0x5b6169,L==3?{emissive:0x0a3a55}:null),n),d=new T.Object3D();let k=0;
   while(k<n){const a=Math.random()*6.28,r=70+Math.random()*450,x=Math.cos(a)*r,z=Math.sin(a)*r;let ok=true;for(let i=0;i<N;i+=5)if((P[i].x-x)**2+(P[i].z-z)**2<45*45){ok=false;break}
    if(ok){const h=L==3?60+Math.random()*140:14+Math.random()*16;d.position.set(x,h/2,z);d.scale.set(L==3?22+Math.random()*20:L===5?26:14,h,L==3?22+Math.random()*20:L===5?20:34);d.updateMatrix();b.setMatrixAt(k++,d.matrix)}}add(b)}
};

// ---- car models (parametric + customizable) ----
function carMesh(d,cu){cu=cu||{};const g=new T.Group(),[L,W,H]=d.sh,f=cu.fin||'gloss',mp={gloss:[.6,.3],matte:[.1,.9],metal:[.95,.25],chrome:[1,.05],carbon:[.5,.4]}[f];
 const m=new T.MeshStandardMaterial({color:f=='carbon'?0x15171a:(cu.paint!=null?cu.paint:d.c),metalness:mp[0],roughness:mp[1]}),bx=(w,h,l,mt,x,y,z)=>{const o=new T.Mesh(new T.BoxGeometry(w,h,l),mt);o.position.set(x,y,z);g.add(o);return o};
 bx(W,.55,L,m,0,.5,0);bx(W*.8,H*.75,L*.4,new T.MeshStandardMaterial({color:0x111418,metalness:.8,roughness:.1,transparent:true,opacity:cu.tint||.95}),0,.8+H*.3,-.1);
 if(cu.sp){const h=cu.sp==2?1.35:.95;bx(W*1.05,.1,.6,m,0,h+.3,-L/2+.1);bx(.1,h-.4,.1,m,-W*.35,.75,-L/2+.1);bx(.1,h-.4,.1,m,W*.35,.75,-L/2+.1)}
 if(cu.str)bx(.35,.02,L*.98,new T.MeshBasicMaterial({color:0xffffff}),0,.8,0);
 if(cu.ug){const u=new T.Mesh(new T.PlaneGeometry(W+.8,L+.8),new T.MeshBasicMaterial({color:0x00e5ff,transparent:true,opacity:.55}));u.rotation.x=-Math.PI/2;u.position.y=.06;g.add(u)}
 [[-1,1],[1,1],[-1,-1],[1,-1]].forEach(p=>{const t=new T.Mesh(new T.CylinderGeometry(.42,.42,.36,16),new T.MeshStandardMaterial({color:cu.tire!=null?cu.tire:0x111111})),r=new T.Mesh(new T.CylinderGeometry(.3,.3,.4,12),new T.MeshStandardMaterial({color:cu.rim!=null?cu.rim:0xaaaaaa,metalness:.9,roughness:.2}));
  [t,r].forEach(o=>{o.rotation.z=Math.PI/2;o.position.set(p[0]*(W/2+.05),.42,p[1]*L*.31);g.add(o)})});
 bx(W*.8,.15,.1,new T.MeshBasicMaterial({color:0xff2020}),0,.65,-L/2-.02);return g}

// ---- menu ----
const WX=[['clear','☀ CLEAR','0% 0%'],['rain','🌧 RAIN','50% 60%'],['fog','🌫 FOG','50% 20%'],['dyn','⛈ DYNAMIC','100% 100%']];
$('loc').innerHTML=LOCS.map((n,i)=>`<option value=${i}>${n}</option>`).join('');
$('wx').insertAdjacentHTML('beforeend','<option value="dyn">Dynamic (random)</option>');
document.querySelector('#menu .grid').insertAdjacentHTML('afterbegin','<label>Mode<select id="mode"><option value="race">Circuit Race (AI)</option><option value="champ">Championship (3 races)</option><option value="time">Time Trial</option><option value="drift">Drift Challenge</option><option value="highway">Highway Rush</option><option value="open">Open World (free drive)</option></select></label><label>Traffic<select id="trf"><option value="0">Off</option><option value="1">Low</option><option value="2">High</option></select></label>');
document.querySelector('#menu .grid').insertAdjacentHTML('afterend','<div id="wxc" style="display:flex;gap:10px;flex-wrap:wrap">'+WX.map(w=>`<div class=wc data-v=${w[0]} style="background-position:center,${w[2]}" onclick="$('wx').value='${w[0]}';renderMenu()">${w[1]}</div>`).join('')+'</div>');
document.querySelector('#menu .top').insertAdjacentHTML('afterend','<div style="max-width:980px;width:100%;margin-top:10px"><button onclick="showGarage()">GARAGE / SHOWROOM</button><button class=ghost onclick="showX(\'career\')">CAREER & ACHIEVEMENTS</button><button class=ghost onclick="showX(\'settings\')">SETTINGS</button></div>');
const _rc=readCfg;readCfg=()=>Object.assign(_rc(),{mode:$('mode').value,traffic:+$('trf').value});
renderMenu=function(){if(!save.owned.includes(sel))sel=save.owned[0];
 $('prof').innerHTML=`LVL ${lvl()} · XP ${save.xp} · <b>${save.credits} CR</b> · Wins ${save.wins}/${save.races}`;
 $('cars').innerHTML=save.owned.map(i=>{const c=CARS[i],b=v=>Math.min(100,v);return `<div class="car ${i==sel?'sel':''}" onclick="sel=${i};renderMenu()"><b style="color:#fff">${c.n}</b> [${c.cls}]<br>Speed<i style="width:${b(c.top)}%"></i>Accel<i style="width:${b(c.pw*2.8)}%"></i>Handling<i style="width:${b(c.hd*30)}%"></i>Grip<i style="width:${b(c.gr*14)}%"></i></div>`}).join('');
 const g=readCfg();$('sum').textContent=`${CARS[sel].n} · ${LOCS[g.loc]} · ${g.mode} · ${['time','drift','highway','open'].includes(g.mode)?'solo':g.num+' cars = 1 player + '+(g.num-1)+' AI'} · ${g.laps} laps · ${g.wx}/${g.tod} · nitro ${g.nitro?'ON':'OFF'}`;
 document.querySelectorAll('.wc').forEach(e=>e.classList.toggle('sel',e.dataset.v==$('wx').value))};
document.querySelectorAll('#menu select').forEach(s=>s.onchange=()=>renderMenu());renderMenu();

// ---- race start wrapper (modes, upgrades, custom looks, traffic) ----
let TR=[],orbs=[],ds=0,combo=0,nmS=0,lastLap=0,lastLapT=0,bestLap=0,wallHit=0,nmCd=0;
const _sr=startRace,_m=msg;msg=t=>{if(t=='WALL!'||t=='COLLISION')wallHit=1;_m(t)};
startRace=function(c){c.mode=c.mode||'race';if(['time','drift','open','highway'].includes(c.mode))c.num=1;if(c.mode=='open')c.laps=999;if(c.mode=='drift')c.laps=Math.min(c.laps,3);
 if(c.mode=='champ'&&!c.champ)c.champ={round:1,pts:0,order:[c.loc,(c.loc+1)%6,(c.loc+2)%6]};
 if(c.wx=='dyn')c.wx=['clear','rain','fog'][Math.random()*3|0];if(!save.owned.includes(c.car))c.car=save.owned[0];
 _sr(c);ds=combo=nmS=lastLap=lastLapT=bestLap=wallHit=0;TR=[];orbs=[];
 cars.forEach(o=>{if(!o.isP)o.def={...BASE[o.def.i]};scene.remove(o.mesh);o.mesh=carMesh(o.def,o.isP?save.cu[c.car]:null);add(o.mesh)});
 const tn=c.mode=='open'?14:c.mode=='highway'?26:[0,6,14][c.traffic||0];
 for(let i=0;i<tn;i++){const m=carMesh(BASE[(Math.random()*12)|0]);add(m);TR.push({s:20+Math.random()*(N-50),lane:Math.random()<.5?-6:6,v:16+Math.random()*10,m})}
 if(c.mode=='open')for(let i=0;i<12;i++){const k=(Math.random()*N)|0,o=new T.Mesh(new T.SphereGeometry(1.2,12,12),new T.MeshBasicMaterial({color:0xffd400}));o.position.set(P[k].x+Nm[k].x*(Math.random()*16-8),1.5,P[k].z+Nm[k].z*(Math.random()*16-8));add(o);orbs.push(o)}};
$('retry').onclick=()=>{const c={...cfg};if(c.mode=='champ'&&c.champ){if(c.champ.round<3){c.champ.round++;c.loc=c.champ.order[c.champ.round-1]}else c.champ=null}startRace(c)};
const _ri=readInput;readInput=()=>{_ri();player.input.s=clamp(player.input.s*save.set.steer,-1,1)};
const _q=quit;quit=function(){TR=[];orbs=[];gOn=false;_q()};$('quit').onclick=quit;$('tomenu').onclick=quit;

// ---- achievements / records / finish wrapper ----
const ACH=[['first','First Victory',()=>save.wins>=1],['speed','Speed Demon',()=>save.topSpeed>=300],['drift','Drift Master',()=>save.dbest>=5000],['hw','Highway Legend',()=>save.nm>=50],['col','Car Collector',()=>save.owned.length>=5],['perf','Perfect Lap',()=>save.perfect],['ug','Underground Champion',()=>save.ugw],['champ','Racing Champion',()=>save.champs>=1]];
function chkAch(){const n=[];ACH.forEach(a=>{if(!save.ach.includes(a[0])&&a[2]()){save.ach.push(a[0]);save.credits+=1000;n.push(a[1])}});if(n.length)persist();return n}
const rec=(m,v,low)=>{const k=m+' · '+LOCS[cfg.loc],o=save.rec[k];if(o==null||(low?v<o:v>o))save.rec[k]=v};
const _fin=finish;
finish=function(){_fin();const m=cfg.mode||'race',pos=rank().indexOf(player)+1;
 // solo modes never race the AI, so the race payout finish() granted for a guaranteed P1 is refunded and
 // replaced by a mode payout — the old code subtracted a flat 450 CR / 500 XP and could drive XP negative
  if(cfg.num==1){if(pos==1){save.credits-=650;save.xp-=700;save.wins=Math.max(0,save.wins-1);save.podiums=Math.max(0,save.podiums-1)}
  let cr=200,xp=200,txt='';
  if(m=='time'){txt=`Time ${fmt(player.fin)} · best lap ${fmt(bestLap||player.fin)}`;rec('Time trial',player.fin,1);cr=300;xp=300}
  if(m=='drift'){save.dbest=Math.max(save.dbest,Math.round(ds));txt=`Drift score ${Math.round(ds)}`;rec('Drift',ds,0);cr=200+Math.round(ds/12);xp=200+Math.round(ds/40)}
  if(m=='highway'){txt=`Near misses ${nmS} · ${fmt(player.fin)}`;rec('Highway',nmS,0);cr=200+nmS*6;xp=200+nmS*10}
  if(m=='open'){txt=`Free drive · ${fmt(player.fin)}`;cr=150;xp=150}
  save.credits+=cr;save.xp+=xp;$('rt').innerHTML=`<h3>${m.toUpperCase()} COMPLETE</h3><div>${txt}</div><div>Reward: +${cr} CR · +${xp} XP</div>`;$('retry').textContent='RETRY'}
 else if(m=='champ'){const ch=cfg.champ,p=[10,8,6,5,4,3,2,1][pos-1]||0;ch.pts+=p;let t=`Round ${ch.round}/3 · +${p} pts · total ${ch.pts}`;
  if(ch.round==3){if(ch.pts>=20){save.champs++;save.credits+=2000;t+=' · CHAMPION! +2000 CR'}else t+=' · need 20 pts to win the title'}
  $('rt').insertAdjacentHTML('afterbegin',`<h3>${t}</h3>`);$('retry').textContent=ch.round<3?'NEXT RACE':'RETRY'}else $('retry').textContent='RETRY';
 if(pos==1&&cfg.tod=='night'&&cfg.num>1)save.ugw=1;
 const a=chkAch();if(a.length)$('rt').insertAdjacentHTML('beforeend','<div>🏆 '+a.join(', ')+' (+1000 CR each)</div>');persist()};

// ---- garage / showroom / customization / upgrades ----
let gi=0,gOn=false,gM,gA=0,gZ=11;
function showGarage(){gi=sel;$('menu').classList.add('hidden');$('garage').classList.remove('hidden');clearWorld();scene.background=new T.Color(0x0a0c12);scene.fog=null;window.VX_SUSPEND=1;
 add(new T.HemisphereLight(0xffffff,0x222233,1.1));add(new T.DirectionalLight(0xffffff,1.2)).position.set(5,8,5);add(new T.PointLight(0x00e5ff,1.5,30)).position.set(-5,2,-4);
 const fl=add(new T.Mesh(new T.CircleGeometry(12,48),new T.MeshStandardMaterial({color:0x151a24,metalness:.8,roughness:.25})));fl.rotation.x=-Math.PI/2;gOn=true;gMesh();gRender()}
function leaveGarage(){gOn=false;window.VX_SUSPEND=0;camera.clearViewOffset();camera.updateProjectionMatrix();$('garage').classList.add('hidden');clearWorld();$('menu').classList.remove('hidden');renderMenu()}
function gMesh(){if(gM)scene.remove(gM);gM=carMesh(CARS[gi],save.cu[gi]);scene.add(gM);world.push(gM)}
const gGo=d=>{gi=(gi+d+CARS.length)%CARS.length;gMesh();gRender()};
function gBuy(){const c=CARS[gi];if(save.credits<c.price||lvl()<c.lvl){alert(`Need ${c.price} CR and level ${c.lvl}`);return}save.credits-=c.price;save.owned.push(gi);persist();chkAch();gRender()}
function gUp(k){const u=(save.up[gi]=save.up[gi]||{}),L=u[k]||0,cost=1500*(L+1);if(L>=5||save.credits<cost){alert('Not enough credits');return}save.credits-=cost;u[k]=L+1;applyUp();persist();gRender()}
function cuSet(k,v){(save.cu[gi]=save.cu[gi]||{})[k]=v;persist();gMesh()}
function gRender(){const c=CARS[gi],own=save.owned.includes(gi),cu=save.cu[gi]||{},u=save.up[gi]||{},b=BASE[gi],o=(arr,v)=>arr.map(a=>`<option ${a==v?'selected':''}>${a}</option>`).join('');
 const U=[['e','Engine','+4% power'],['t','Turbo','+2.5% top speed'],['r','Tires','+5% grip'],['s','Suspension','+4% handling'],['w','Lightweight','+3% power'],['b','Brakes','+8% braking'],['x','Exhaust','+2.5% power'],['d','Differential','+4% traction on throttle'],['n','Nitro','stronger, longer, faster recharge']];
 $('garage').innerHTML=`<div class="panel"><h2>GARAGE</h2><b>${c.n}</b> · Class ${c.cls} · <b>${save.credits} CR</b> · LVL ${lvl()}<br>Top ${Math.round(b.top*3.6)}→<b>${Math.round(c.top*3.6)}</b> km/h · Accel ${b.pw.toFixed(1)}→<b>${c.pw.toFixed(1)}</b> · Handling ${b.hd.toFixed(2)}→<b>${c.hd.toFixed(2)}</b> · Grip ${b.gr.toFixed(2)}→<b>${c.gr.toFixed(2)}</b><br>
 <button class=ghost onclick="gGo(-1)">◀</button><button class=ghost onclick="gGo(1)">▶</button><button class=ghost onclick="gZ=Math.max(7,gZ-1)">ZOOM +</button><button class=ghost onclick="gZ=Math.min(20,gZ+1)">ZOOM −</button><br>
 ${own?`<button onclick="sel=${gi};gRender()">${sel==gi?'✔ SELECTED':'SELECT'}</button>`:`<button onclick="gBuy()">BUY ${c.price} CR (needs LVL ${c.lvl})</button>`}
 ${own?`<h3>PAINT</h3><input type=color value="${hex(cu.paint!=null?cu.paint:c.c)}" onchange="cuSet('paint',parseInt(this.value.slice(1),16))"> <select onchange="cuSet('fin',this.value)">${o(['gloss','matte','metal','chrome','carbon'],cu.fin||'gloss')}</select>
 <h3>BODY</h3>Spoiler <select onchange="cuSet('sp',+this.value)"><option value=0>None</option><option value=1 ${cu.sp==1?'selected':''}>Small</option><option value=2 ${cu.sp==2?'selected':''}>Large</option></select> Tint <select onchange="cuSet('tint',+this.value)"><option value=.95>Clear</option><option value=.6 ${cu.tint==.6?'selected':''}>Light</option><option value=.3 ${cu.tint==.3?'selected':''}>Dark</option></select><br><label><input type=checkbox ${cu.str?'checked':''} onchange="cuSet('str',this.checked)"> Racing stripe</label> <label><input type=checkbox ${cu.ug?'checked':''} onchange="cuSet('ug',this.checked)"> Underglow</label>
 <h3>WHEELS</h3>Rim <input type=color value="${hex(cu.rim!=null?cu.rim:0xaaaaaa)}" onchange="cuSet('rim',parseInt(this.value.slice(1),16))"> Tire <input type=color value="${hex(cu.tire!=null?cu.tire:0x111111)}" onchange="cuSet('tire',parseInt(this.value.slice(1),16))">
 <h3>PERFORMANCE UPGRADES</h3>${U.map(([k,n,d])=>{const L=u[k]||0;return `<div style="margin:4px 0">${n} L${L}/5 <small>${d}</small> ${L<5?`<button style="padding:4px 12px" onclick="gUp('${k}')">${1500*(L+1)} CR</button>`:'MAX'}</div>`}).join('')}`:''}
 <br><button class=ghost onclick="leaveGarage()">BACK</button></div>`}

// ---- career / settings ----
function showX(k){const s=save,wp=s.races?Math.round(s.wins/s.races*100):0;let h='<div class="panel">';
 if(k=='career')h+=`<h2>DRIVER PROFILE & CAREER</h2>Level ${lvl()} · XP ${s.xp} · ${s.credits} CR<br>Races ${s.races} · Wins ${s.wins} (${wp}%) · Podiums ${s.podiums} · Top speed ${Math.round(s.topSpeed)} km/h · Cars ${s.owned.length}/12 · Near misses ${s.nm} · Best drift ${s.dbest}<h3>ACHIEVEMENTS</h3>${ACH.map(a=>`<div>${s.ach.includes(a[0])?'🏆':'🔒'} ${a[1]}</div>`).join('')}<h3>LOCAL RECORDS</h3>${Object.entries(s.rec).map(([k,v])=>`<div>${k}: ${k.startsWith('Time')?fmt(v):Math.round(v)}</div>`).join('')||'<div>No records yet</div>'}<small>Online leaderboards: coming soon (architecture only).</small>`;
 else h+=`<h2>SETTINGS</h2><label>Graphics quality<select onchange="save.set.q=+this.value;applyQ();persist()">${['Low','Medium','High','Ultra','Auto'].map((n,i)=>`<option value=${i} ${s.set.q==i?'selected':''}>${n}${i==4?' (recommended)':''}</option>`).join('')}</select></label><label>Master volume<input type=range min=0 max=1 step=.05 value=${s.set.vol} onchange="save.set.vol=+this.value;persist()"></label><label>Units<select onchange="save.set.mph=+this.value;persist()"><option value=0>KM/H</option><option value=1 ${s.set.mph?'selected':''}>MPH</option></select></label><label>Steering sensitivity<input type=range min=.5 max=1.5 step=.1 value=${s.set.steer} onchange="save.set.steer=+this.value;persist()"></label>`;
 $('xs').innerHTML=h+'<br><button class=ghost onclick="$(\'xs\').classList.add(\'hidden\');renderMenu()">BACK</button></div>';$('xs').classList.remove('hidden')}
// ---- engine sound: every car gets its own note and timbre ----
// One sawtooth used to serve the whole grid, so a Titan 4x4 sounded exactly like a Hyper Volt. Each car
// index now owns a two-oscillator voice (fundamental + a quiet upper harmonic through its own filter),
// and the two nearest rivals are mixed in with distance falloff on top of the player's engine.
const VXENGNOTE=[48,56,44,62,40,52,36,46,66,58,54,34];
const VXENGTYPE=['sawtooth','square','sawtooth','triangle','square','sawtooth','square','triangle','sawtooth','square','sawtooth','triangle'];
const VXENGFILT=[900,1200,760,1500,640,980,560,1100,1700,1300,1150,520];
const VXENG={master:null,near:[null,null]};
function vxEngMaster(){if(!VXENG.master&&aud){VXENG.master=aud.createGain();VXENG.master.gain.value=(+save.set.vol||.6)*.9;VXENG.master.connect(aud.destination)}return VXENG.master}
function vxEngFor(o){if(o._eng)return o._eng;const m=vxEngMaster();if(!m)return null;
  const i=(o.def&&o.def.i!=null?o.def.i:0)%12,f=VXENGNOTE[i],t=VXENGTYPE[i];
  const g=aud.createGain();g.gain.value=0;
  const lp=aud.createBiquadFilter();lp.type='lowpass';lp.frequency.value=VXENGFILT[i];lp.Q.value=5;
  const o1=aud.createOscillator();o1.type=t;o1.frequency.value=f;
  const o2=aud.createOscillator();o2.type=t=='square'?'sawtooth':'square';o2.frequency.value=f*2.01;
  const g2=aud.createGain();g2.gain.value=.28;
  o1.connect(lp);o2.connect(g2);g2.connect(lp);lp.connect(g);g.connect(m);o1.start();o2.start();
  o._eng={o1,o2,g2,lp,g,f,fv:VXENGFILT[i],on:0};return o._eng}
function vxEngDrive(v,rpm,nit,level,live){if(!v)return;
  const r=Math.max(0,Math.min(1,rpm||0)),t=aud.currentTime;
  v.o1.frequency.setTargetAtTime(v.f*(.8+r*2.7),t,.04);
  v.o2.frequency.setTargetAtTime(v.f*(.8+r*2.7)*2.01,t,.04);
  v.lp.frequency.setTargetAtTime(v.fv*(.55+r*.9)+(nit?700:0),t,.08);
  const want=live?level*(.028+r*.03+(nit?.02:0)):0;
  v.on=want>.0005?1:0;
  v.g.gain.setTargetAtTime(want,t,.06)}
// a finished race must not leave oscillators droning (or piling up) in the mixer
function vxEngKill(){for(let i=0;i<cars.length;i++){const v=cars[i]._eng;if(!v)continue;try{v.o1.stop();v.o2.stop();v.o1.disconnect();v.o2.disconnect();v.g2.disconnect();v.lp.disconnect();v.g.disconnect()}catch(e){}cars[i]._eng=null}}
engineSnd=function(rpm,nit){
  if(!aud||typeof player=='undefined'||!player)return;
  if(VXENG.master)VXENG.master.gain.value=(+save.set.vol||.6)*.9;
  const live=(state=='race'||state=='count'||state=='resume')&&!window.VX_SUSPEND;
  vxEngDrive(vxEngFor(player),rpm,nit,1,live);
  // two closest rivals: no arrays, no sorting, just one pass for the two smallest distances
  let a=null,b=null,da=1e9,db=1e9;
  for(let i=0;i<cars.length;i++){const o=cars[i];if(o.isP)continue;const d=Math.hypot(o.x-player.x,o.z-player.z);
    if(d<da){b=a;db=da;a=o;da=d}else if(d<db){b=o;db=d}}
  const keep=[a,b];
  for(let i=0;i<cars.length;i++){const o=cars[i];if(o._eng&&o._eng.on&&keep.indexOf(o)<0)vxEngDrive(o._eng,0,false,0,false)}
  const dist=[[a,da],[b,db]];
  for(let i=0;i<2;i++){const o=dist[i][0],d=dist[i][1];if(!o)continue;
    const lvl=Math.max(0,Math.min(1,1-d/95))*.42;
    vxEngDrive(vxEngFor(o),(o.spd||0)/38,o.useN,lvl,live&&lvl>0)}
};

// ---- per-frame extras (traffic, drift, near-miss, minimap, mode HUD) ----
function xtick(t){requestAnimationFrame(xtick);const dt=Math.min((t-(xtick.l||t))/1000,.1);xtick.l=t;
 if(gOn){gA+=dt*.5;camera.fov=42;const off=innerWidth>760?-Math.min(440,innerWidth*.55)/2:0;   // keep the car clear of the 440px panel
  if(off)camera.setViewOffset(innerWidth,innerHeight,off,0,innerWidth,innerHeight);else camera.clearViewOffset();camera.updateProjectionMatrix();
  camera.position.set(Math.cos(gA)*gZ,3.4,Math.sin(gA)*gZ);camera.lookAt(0,.65,0);renderer.render(scene,camera);return}
 if(state=='done'&&!VXENG.done){VXENG.done=1;vxEngKill()}else if(state!='done')VXENG.done=0;
 if(!cfg||!player||!cars.length||!['race','count','pause','done'].includes(state))return;
 if(state=='race'){nmCd-=dt;const p=player;
  if(p.drift>3.5&&p.spd>15){combo=Math.min(5,combo+dt*.5);ds+=p.drift*dt*combo}else combo=Math.max(0,combo-dt*2);
  const li=Math.floor(p.tot/N);if(li>lastLap&&li>0){const lt=raceT-lastLapT;lastLapT=raceT;bestLap=bestLap?Math.min(bestLap,lt):lt;if(!wallHit)save.perfect=1;wallHit=0;lastLap=li;msg('LAP '+li+' · '+fmt(lt))}
  TR.forEach(r=>{if(r.lane0==null)r.lane0=r.lane;   // horn reaction: pull aside, then ease back into the lane
   if(r.away>0){r.away-=dt;r.lane=Math.max(-11,Math.min(11,r.lane+r.awayDir*9*dt));r.v=Math.min(34,r.v+5*dt)}
   else if(Math.abs(r.lane-r.lane0)>.05)r.lane+=(r.lane0-r.lane)*Math.min(1,dt*.9);
   r.s=(r.s+r.v*dt/4.8)%N;const i=r.s|0;r.m.position.set(P[i].x+Nm[i].x*r.lane,0,P[i].z+Nm[i].z*r.lane);r.m.rotation.y=Math.atan2(Tn[i].x,Tn[i].z);
   const d=Math.hypot(r.m.position.x-p.x,r.m.position.z-p.z);
   if(d<3.4){p.vx*=.9;p.vz*=.9;wallHit=1;msg('TRAFFIC HIT')}else if(d<5.5&&p.spd>25&&nmCd<=0){nmS++;save.nm++;nmCd=1;msg('NEAR MISS')}});
  orbs=orbs.filter(o=>{if((o.position.x-p.x)**2+(o.position.z-p.z)**2<16){scene.remove(o);save.credits+=150;persist();msg('+150 CR');return false}return true});
  if(Math.random()<.01)chkAch().forEach(n=>msg('🏆 '+n))}
 const g=$('mm').getContext('2d'),X=x=>75+x*.15,Z=z=>75+z*.15;g.clearRect(0,0,150,150);g.strokeStyle='#00E5FF';g.beginPath();P.forEach((q,i)=>i?g.lineTo(X(q.x),Z(q.z)):g.moveTo(X(q.x),Z(q.z)));g.closePath();g.stroke();
 TR.forEach(r=>{g.fillStyle='#667';g.fillRect(X(r.m.position.x)-1,Z(r.m.position.z)-1,2,2)});orbs.forEach(o=>{g.fillStyle='#ffd400';g.fillRect(X(o.position.x)-2,Z(o.position.z)-2,3,3)});cars.forEach(o=>{g.fillStyle=o.isP?'#FF6A00':'#fff';g.fillRect(X(o.x)-2,Z(o.z)-2,4,4)});
 const m=cfg.mode,ch=cfg.champ,xt=m=='drift'?`DRIFT ${Math.round(ds)}  x${combo.toFixed(1)}`:m=='highway'?`NEAR MISSES ${nmS}`:m=='time'?`TIME TRIAL · BEST LAP ${bestLap?fmt(bestLap):'--'}`:m=='open'?`OPEN WORLD · ${orbs.length} rewards left · ESC to exit`:m=='champ'?`CHAMPIONSHIP ${ch.round}/3 · ${ch.pts} pts`:'';
 if($('xhud').__v!==xt){$('xhud').__v=xt;$('xhud').textContent=xt}}
applyQ();requestAnimationFrame(xtick);
