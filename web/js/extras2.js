// VELOCITY X extras2: audio (music/SFX/ambience), dynamic weather, replay + ghost, tunnels/bridge/pit lane, key remap, touch, online client
save.set=Object.assign({ev:1,mv:.5,sv:1,av:1,touch:0,keys:{}},save.set);save.ghosts=save.ghosts||{};
const KB0={acc:'KeyW',brk:'KeyS',left:'KeyA',right:'KeyD',hb:'Space',nit:'ShiftLeft'},kb=()=>Object.assign({},KB0,save.set.keys),TC={};
let REC=[],GHM=null,GHD=null,W=null,rt=0,remote={},WS=null,olSlot=0,olT=0;
const REPLAY_MAX=2400;   // 4 minutes at 10 samples/s: long enough for a race, bounded for a free-drive soak
// ---- input: remappable keys + touch + gamepad ----
// This is the readInput the race actually calls (game.js' own version is replaced here). It runs 60 times a
// second, so it must not allocate: the old one built a key map with Object.assign, an arrow closure and a
// fresh input object on every physics step — the main source of the periodic GC hitch.
let vxKbMap=null,vxKbRef=null;
function vxKeyMap(){if(vxKbRef!==save.set.keys){vxKbRef=save.set.keys;vxKbMap=Object.assign({},KB0,save.set.keys)}return vxKbMap}
readInput=function(){const k=keys,m=vxKeyMap(),I=player.input||(player.input={t:0,b:0,s:0,hb:0,n:0});
 I.t=(k[m.acc]||k.ArrowUp||TC.t)?1:0;I.b=(k[m.brk]||k.ArrowDown||TC.b)?1:0;
 I.s=((k[m.left]||k.ArrowLeft||TC.l)?1:0)-((k[m.right]||k.ArrowRight||TC.r)?1:0);
 I.hb=(k[m.hb]||TC.h)?1:0;I.n=(k[m.nit]||k.ShiftRight||TC.n)?1:0;
 const g=navigator.getGamepads&&navigator.getGamepads()[0];if(g){I.t=Math.max(I.t,g.buttons[7]?.value||0);I.b=Math.max(I.b,g.buttons[6]?.value||0);if(Math.abs(g.axes[0])>.1)I.s=-g.axes[0];if(g.buttons[0]?.pressed)I.n=1;if(g.buttons[2]?.pressed)I.hb=1}
 I.s=clamp(I.s*save.set.steer,-1,1)};
function remap(a){const h=e=>{e.preventDefault();e.stopPropagation();save.set.keys[a]=e.code;vxKbRef=null;persist();removeEventListener('keydown',h,true);showX('settings')};addEventListener('keydown',h,true)}
document.body.insertAdjacentHTML('beforeend','<div id="tch" class="hidden" style="position:fixed;inset:0;z-index:6;pointer-events:none">'+[['l','◀','left:12px;bottom:90px'],['r','▶','left:110px;bottom:90px'],['t','GAS','right:12px;bottom:90px'],['b','BRK','right:110px;bottom:90px'],['n','NOS','right:12px;bottom:190px'],['h','HB','right:110px;bottom:190px']].map(a=>`<div data-k=${a[0]} style="position:absolute;${a[2]};width:84px;height:84px;border-radius:50%;background:#00E5FF44;border:2px solid #00E5FF;display:flex;align-items:center;justify-content:center;font-weight:800;pointer-events:auto;touch-action:none;user-select:none">${a[1]}</div>`).join('')+'</div><button id="rx" class="hidden" style="position:fixed;top:14px;right:14px;z-index:7" onclick="endReplay()">EXIT REPLAY</button>');
document.querySelectorAll('#tch div').forEach(e=>{const k=e.dataset.k;e.onpointerdown=v=>{TC[k]=1;e.setPointerCapture(v.pointerId)};e.onpointerup=e.onpointercancel=()=>TC[k]=0});
// ---- settings additions ----
const _sx=showX;showX=function(k){_sx(k);if(k!='settings')return;const m=kb(),N2={acc:'Accelerate',brk:'Brake/Reverse',left:'Steer left',right:'Steer right',hb:'Handbrake',nit:'Nitro'},sl=(l,key)=>`<label>${l}<input type=range min=0 max=1 step=.05 value=${save.set[key]} onchange="save.set.${key}=+this.value;persist()"></label>`;
 $('xs').querySelector('.panel button').insertAdjacentHTML('beforebegin',sl('Engine volume','ev')+sl('Music volume','mv')+sl('Effects volume','sv')+sl('Environment volume','av')+`<label><input type=checkbox ${save.set.touch?'checked':''} onchange="save.set.touch=+this.checked;persist()"> Show touch controls</label><h3>CONTROLS — click, then press a key (C camera · R reset · Esc pause fixed; arrows always work)</h3>`+Object.keys(N2).map(a=>`<button class=ghost onclick="remap('${a}')">${N2[a]}: ${m[a]}</button>`).join('')+`<button class=ghost onclick="save.set.keys={};persist();showX('settings')">Reset keys</button>`)};
// ---- audio ----
let bus,nbuf,rainG,windG,scrG,lastCd=0,mus=0;
function AB(){if(!aud)return null;if(bus)return bus;const g=()=>{const x=aud.createGain();x.connect(aud.destination);return x};bus={m:g(),s:g(),a:g()};
 const n=aud.sampleRate*2;nbuf=aud.createBuffer(1,n,aud.sampleRate);const d=nbuf.getChannelData(0);for(let i=0;i<n;i++)d[i]=Math.random()*2-1;
 const lp=(type,f,dst)=>{const s=aud.createBufferSource();s.buffer=nbuf;s.loop=true;const fl=aud.createBiquadFilter();fl.type=type;fl.frequency.value=f;const gn=aud.createGain();gn.gain.value=0;s.connect(fl);fl.connect(gn);gn.connect(dst);s.start();return gn};
 rainG=lp('highpass',2500,bus.a);windG=lp('lowpass',500,bus.a);scrG=lp('bandpass',1800,bus.s);bus.n=lp('highpass',3000,bus.s);return bus}
const tone=(f,d,ty='square',v=.15,at=0,dst)=>{const b=AB();if(!b)return;const o=aud.createOscillator(),g=aud.createGain(),t=aud.currentTime+at;o.type=ty;o.frequency.value=f;g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g);g.connect(dst||b.s);o.start(t);o.stop(t+d)};
const burst=(f,d,v)=>{const b=AB();if(!b)return;const s=aud.createBufferSource(),fl=aud.createBiquadFilter(),g=aud.createGain();s.buffer=nbuf;fl.frequency.value=f;g.gain.setValueAtTime(v,aud.currentTime);g.gain.exponentialRampToValueAtTime(.001,aud.currentTime+d);s.connect(fl);fl.connect(g);g.connect(b.s);s.start();s.stop(aud.currentTime+d)};
setInterval(()=>{if(!AB()||state=='pause')return;const A=[220,262,330,392,330,262,247,294],B=[55,55,65,49];mus++;tone(A[mus%8],.3,'triangle',.12,0,bus.m);if(mus%4==0)tone(B[(mus>>2)%4],.9,'sawtooth',.14,0,bus.m)},260);
const _m2=msg;msg=t=>{_m2(t);if(t=='COLLISION'||t=='TRAFFIC HIT'||t=='WALL!')burst(300,.35,.6);else if(t=='CHECKPOINT')tone(1200,.12,'sine',.25);else if(t=='NEAR MISS')burst(2500,.25,.3)};
document.addEventListener('click',e=>{if(e.target.tagName=='BUTTON')tone(900,.05,'square',.1)});
const _es=engineSnd;
// gain.value was being multiplied by ev on every call, i.e. divided again and again until the engine fell
// silent for the rest of the race. Recompute the level the way engineSnd does and scale it once.
engineSnd=(r,n)=>{_es(r,n);if(og)og.gain.value=((state=='race'||state=='count')?.035+(n?.02:0):0)*save.set.ev};
// ---- dynamic weather (mid-race transitions) ----
function wxInit(c){W=null;if(!c.dyn)return;const base=scene.background.clone();
 if(typeof rain=='undefined'||!rain){const v=[];for(let i=0;i<1800;i++){const x=Math.random()*120-60,y=Math.random()*60,z=Math.random()*120-60;v.push(x,y,z,x,y-1.6,z)}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(v,3));rain=add(new T.LineSegments(g,new T.LineBasicMaterial({color:0xaabbcc,transparent:true,opacity:0})))}
 const r=c.wx=='rain'?1:0,f=c.wx=='fog'?1:0;W={r,f,tr:r,tf:f,t:0,next:35,base,cur:c.wx};scene.fog=new T.FogExp2(base.clone(),.0012)}
function wxStep(dt){W.t+=dt;if(W.t>W.next){W.t=0;W.next=35+Math.random()*25;const o=['clear','rain','fog'].filter(x=>x!=W.cur);W.cur=o[Math.random()*2|0];W.tr=W.cur=='rain'?1:0;W.tf=W.cur=='fog'?1:0;msg('WEATHER → '+W.cur.toUpperCase())}
 const k=Math.min(1,dt*.25);W.r+=(W.tr-W.r)*k;W.f+=(W.tf-W.f)*k;const m=Math.max(W.r,W.f);scene.fog.density=.0012+.0035*W.r+.0155*W.f;scene.background.copy(W.base).lerp(new T.Color(0x777f88),.6*m);scene.fog.color.copy(scene.background);
 if(rain){rain.material.opacity=.5*W.r;rain.visible=W.r>.03}const rd=world[3];if(rd&&rd.material){rd.material.color.setHex(0x33363c).lerp(new T.Color(0x1a1d22),W.r);rd.material.roughness=.85-.55*W.r}cfg.wx=W.r>.5?'rain':W.f>.5?'fog':'clear'}
// ---- tunnels, truss bridge, pit lane ----
const _bw2=buildWorld;buildWorld=function(c){_bw2(c);const L=c.loc,dk=new T.MeshStandardMaterial({color:0x2a2d33,roughness:.9}),lamp=new T.MeshBasicMaterial({color:0xffe9a0}),st=new T.MeshStandardMaterial({color:0x8899aa,metalness:.7,roughness:.4});
 const seg=(i,off,y,w,h,l,mt)=>{const m=new T.Mesh(new T.BoxGeometry(w,h,l),mt);m.position.set(P[i].x+Nm[i].x*off,y,P[i].z+Nm[i].z*off);m.rotation.y=Math.atan2(Tn[i].x,Tn[i].z);add(m)};
 const tun={2:[120,180],3:[200,250]}[L];if(tun)for(let i=tun[0];i<tun[1];i++){seg(i,0,8,40,1,4.4,dk);seg(i,-19.5,4,1,8,4.4,dk);seg(i,19.5,4,1,8,4.4,dk);if(i%6==0)seg(i,0,7.3,2,.2,1,lamp)}
 if(L==4)for(let i=300;i<360;i++){seg(i,-12.7,.7,.4,1.4,4.4,st);seg(i,12.7,.7,.4,1.4,4.4,st);if(i%6==0){seg(i,-13,4.5,.8,9,.8,st);seg(i,13,4.5,.8,9,.8,st);seg(i,0,9,27,.6,.8,st)}}
 if(L==0){const pm=new T.MeshStandardMaterial({color:0x4a4d55});for(let k=-30;k<=30;k++){const i=(k+N)%N;seg(i,-24,.03,9,.06,4.4,pm);if(k%6==0){seg(i,-33,3,10,6,24,dk);seg(i,-28.2,.4,.6,.8,5,new T.MeshBasicMaterial({color:k%12?0xff6a00:0x00e5ff}));seg(i,30,2,10,4,24,dk)}}}};
// ---- race start / finish wrappers ----
const _sr2=startRace;startRace=function(c){c.dyn=c.dyn||c.wx=='dyn';_sr2(c);REC=[];remote={};GHM=GHD=null;wxInit(c);
 if(c.mode=='time'){const g=save.ghosts[c.loc+'|'+c.laps];if(g){GHD=g;GHM=carMesh(CARS[0],{paint:0x00e5ff,fin:'matte'});GHM.traverse(o=>{if(o.material){o.material=o.material.clone();o.material.transparent=true;o.material.opacity=.35}});add(GHM)}}};
const _f2=finish;finish=function(){_f2();const pk=cars.indexOf(player),win=rank().indexOf(player)==0;(win?[523,659,784,1047]:[392,330,262]).forEach((f,i)=>tone(f,.4,'triangle',.25,i*.18));
 const gk=cfg.loc+'|'+cfg.laps,og=save.ghosts[gk];if(cfg.mode=='time'&&(!og||player.fin<og.t)){save.ghosts[gk]={t:player.fin,f:REC.map(f=>[f[pk*3],f[pk*3+1],f[pk*3+2]])};persist()}
 if(WS&&WS.readyState==1&&cfg.online)WS.send(JSON.stringify({t:'fin'}));
 if(cfg.mode=='time'&&save.set.srv)fetch(save.set.srv.replace(/^ws/,'http')+'/score',{method:'POST',body:JSON.stringify({name:save.set.pn||'Driver',loc:cfg.loc,time:player.fin})}).catch(()=>{})};
$('res').querySelector('.panel').insertAdjacentHTML('beforeend','<button id="rpl" class="ghost" onclick="startReplay()">REPLAY</button>');
function startReplay(){if(REC.length<5)return;$('res').classList.add('hidden');state='rep';rt=0;$('rx').classList.remove('hidden')}
function endReplay(){state='done';$('rx').classList.add('hidden');$('res').classList.remove('hidden')}
const _q2=quit;quit=function(){$('rx').classList.add('hidden');if(WS){WS.close();WS=null}_q2()};$('quit').onclick=quit;$('tomenu').onclick=quit;
// ---- online client (beta) ----
document.querySelector('#menu .top').nextElementSibling.insertAdjacentHTML('beforeend','<button class=ghost onclick="showOnline()">ONLINE (BETA)</button>');
function showOnline(){$('xs').innerHTML=`<div class="panel"><h2>ONLINE (BETA)</h2><small>Run the server in /server (npm start). Not tested over the internet.</small><label>Server<input id=srv value="${save.set.srv||'ws://localhost:8080'}"></label><label>Name<input id=pn value="${save.set.pn||'Driver'}"></label><label>Room<input id=rm value="lobby"></label><button onclick="olJoin()">JOIN</button><button class=ghost onclick="WS&&WS.send(JSON.stringify({t:'ready'}))">READY</button><div id=olst>Not connected</div><h3>GLOBAL TIME-TRIAL LEADERBOARD</h3><div id=olb>—</div><button class=ghost onclick="$('xs').classList.add('hidden')">BACK</button></div>`;$('xs').classList.remove('hidden');olLb()}
function olLb(){const u=(save.set.srv||'ws://localhost:8080').replace(/^ws/,'http');fetch(u+'/leaderboard').then(r=>r.json()).then(l=>$('olb').innerHTML=l.map((e,i)=>`<div>${i+1}. ${e.name.replace(/</g,'')} · ${LOCS[e.loc]} · ${fmt(e.time)}</div>`).join('')||'empty').catch(()=>$('olb').textContent='server offline')}
function olJoin(){save.set.srv=$('srv').value;save.set.pn=$('pn').value;persist();WS=new WebSocket(save.set.srv);WS.onopen=()=>WS.send(JSON.stringify({t:'join',room:$('rm').value,name:save.set.pn,car:sel}));WS.onerror=()=>$('olst').textContent='connection failed';
 WS.onmessage=e=>{const d=JSON.parse(e.data);
  if(d.t=='room')$('olst').innerHTML=d.players.map(p=>`<div>${p.ready?'✔':'…'} ${p.name.replace(/</g,'')}</div>`).join('');
  if(d.t=='start'){$('xs').classList.add('hidden');startRace({car:sel,loc:d.cfg.loc,num:1,diff:2,laps:d.cfg.laps,wx:d.cfg.wx,tod:d.cfg.tod,nitro:true,coll:false,mode:'race',traffic:0,online:true});olSlot=d.slot;
   const b=3+Math.floor(d.slot/2)*2,i=(N-b)%N,s=(d.slot%2?1:-1)*4;Object.assign(player,{x:P[i].x+Nm[i].x*s,z:P[i].z+Nm[i].z*s,idx:i,tot:-b});d.players.forEach(p=>{if(p.id!=d.me){const m=carMesh(CARS[p.car%12]);add(m);remote[p.id]=m}})}
  if(d.t=='pos'&&remote[d.id]){remote[d.id].position.set(d.x,0,d.z);remote[d.id].rotation.y=d.h}
  if(d.t=='results')$('rt').insertAdjacentHTML('beforeend','<h3>ONLINE (server clock)</h3>'+d.list.map((p,i)=>`<div>${i+1}. ${p.name.replace(/</g,'')} ${fmt(p.time)}</div>`).join(''))}}
// ---- per-frame: audio mix, ghost, replay, recording, weather, touch ----
function x2(t){requestAnimationFrame(x2);const dt=Math.min((t-(x2.l||t))/1000,.1);x2.l=t;
 const live=cfg&&player&&cars.length&&['race','count'].includes(state);
 // guarded: classList.toggle ran on every single frame even when nothing changed
 // the legacy six-button pad is retired: controls.js owns the touch HUD (GAS / BRAKE / NOS / HORN + wheel or tilt).
 // Showing both used to stack two translucent copies of every pedal on a phone.
 if(x2.tch!==false){x2.tch=false;$('tch').classList.add('hidden')}
 if(bus){const v=save.set.vol;bus.m.gain.value=save.set.mv*v*.5;bus.s.gain.value=save.set.sv*v;bus.a.gain.value=save.set.av*v;
  // audio.js owns wind / tyre / screech / nitro from v0.7: silence the old duplicated noise layers
  const newAud=!!(window.VXAUD&&VXAUD.ready);
  const r=live&&state=='race'?player:null,wet=W?W.r:(cfg&&cfg.wx=='rain'?1:0);rainG.gain.value=newAud?0:r?.25*wet:0;windG.gain.value=newAud?0:r?Math.min(1,r.spd/60)*.2:0;scrG.gain.value=newAud?0:r&&r.drift>4&&r.spd>12?Math.min(.25,r.drift*.02):0;bus.n.gain.value=newAud?0:r&&r.useN?.15:0}
 if(!live&&state!='rep'&&state!='done')return;
 if(state=='count'){const c=Math.ceil(cdT-1);if(c!=lastCd){lastCd=c;if(c>0)tone(440,.2);else if(cdT>0)tone(880,.5)}}
  if(state=='rep'){rt+=dt;const n=REC.length,f=Math.min(rt*10,n-1.001),i=Math.floor(f),u=f-i,pk=cars.indexOf(player);
  for(let k=0;k<cars.length;k++){const o=cars[k],a=REC[i],b=REC[i+1],j=k*3;o.mesh.position.set(a[j]+(b[j]-a[j])*u,0,a[j+1]+(b[j+1]-a[j+1])*u);o.mesh.rotation.y=a[j+2]}
  const tp=cars[pk].mesh.position,sh=Math.floor(rt/4)%3;let bi=0,bd=1e12;for(let j=0;j<N;j++){const d=(P[j].x-tp.x)**2+(P[j].z-tp.z)**2;if(d<bd){bd=d;bi=j}}
  if(sh==0)camera.position.set(tp.x+Math.cos(rt*.6)*12,4,tp.z+Math.sin(rt*.6)*12);else if(sh==1){const j=(bi+30)%N;camera.position.set(P[j].x+Nm[j].x*16,3,P[j].z+Nm[j].z*16)}else camera.position.set(tp.x,35,tp.z+8);
  camera.lookAt(tp);renderer.render(scene,camera);if(rt*10>=n-1.01)endReplay();return}
  if(state=='race'){
   // one flat Float32Array per sample instead of an array of per-car arrays: the old form allocated
   // (cars*3)+2 objects ten times a second and grew without limit in a free-drive session
   if(REC.length<REPLAY_MAX){const want=Math.min(REPLAY_MAX,Math.floor(raceT*10)+1);
    while(REC.length<want){const s=new Float32Array(cars.length*3);for(let i=0;i<cars.length;i++){const o=cars[i],j=i*3;s[j]=Math.round(o.x*10)/10;s[j+1]=Math.round(o.z*10)/10;s[j+2]=Math.round(o.h*100)/100}REC.push(s)}}
  if(W)wxStep(dt);
  if(GHM&&GHD){const f=raceT*10,i=Math.floor(f),A=GHD.f;if(i>=A.length-1)GHM.visible=false;else{const u=f-i,a=A[i],b=A[i+1];GHM.visible=true;GHM.position.set(a[0]+(b[0]-a[0])*u,0,a[1]+(b[1]-a[1])*u);GHM.rotation.y=a[2]}}
  olT+=dt;if(WS&&WS.readyState==1&&cfg.online&&olT>.1){olT=0;WS.send(JSON.stringify({t:'pos',x:player.x,z:player.z,h:player.h,tot:player.tot}))}}}
requestAnimationFrame(x2);
