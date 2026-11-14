// VELOCITY X gameplay systems (v0.5, GROUP 1):
//   1. Nemesis rivals       - persistent grudges, defending AI, radio taunts
//   2. Rewind / flashback   - ring buffer of the last 10 s, limited charges
//   3. Slipstream / drafting - real drag relief + boost, air-wake visual, HUD
//   4. Tyres / fuel / damage - real grip, power, brake and mass changes + pit service
//   5. Nitro skill          - heat management, perfect start, perfect shift
//   6. Horn                 - audio + rival grudge + AI cars pull aside
//   7. Resume countdown     - 3 s timer before the car is handed back
// All rules live in packages/game-core/src/gameplay.ts (unit tested); this file only wires them in.
const VXCORE = window.VXCORE;
if (!VXCORE) throw new Error('[VX] web/vendor/game-core.js missing — run: node packages/game-core/build.js');
// Fail loudly instead of quietly feeding NaN into the physics if the bundle drifts out of date.
const VX_NEED = ['draftStrength', 'DRAFT_BOOST', 'newTyre', 'tyreGrip', 'tyreStep', 'FUEL_CAPACITY',
  'fuelBurn', 'fuelMassMul', 'newDamage', 'addDamage', 'damageMul', 'brokenParts', 'newRival',
  'rivalEvent', 'rivalPressure', 'rivalTitle', 'grudgeDecay', 'nitroHeatStep', 'OVERHEAT_LOCK',
  'perfectStart', 'perfectShift', 'rewindBudget', 'rewindPenalty'];
const VX_MISSING = VX_NEED.filter(k => VXCORE[k] === undefined);
if (VX_MISSING.length) throw new Error('[VX] game-core bundle is out of date, missing: ' + VX_MISSING.join(', '));

// ---- save extensions (old saves keep working: everything is created if missing) ----
save.rivals = save.rivals || {};                 // name -> {grudge,wins,losses,hits,races}
save.set = Object.assign({ rewind: '3', hornVol: .7 }, save.set);

const TAUNTS = [
  'I remember you.', 'Watch your mirrors.', 'Not today.', 'Nice paint. Shame about the driver.',
  'I owe you one from last time.', 'You drive like my grandmother.', 'Enjoy second place.',
  'That was my corner.'
];
const VX_$ = id => document.getElementById(id);
let VXBUF = [];
const VXR = { charges: 0, online: false, startErr: null, startUsed: 0, tauntT: 0, tauntCd: 0, hitCd: 0,
  gear: 0, rpmf: 0, pitT: -1, acc: 0, draft: 0, wake: null, brokenAlert: 0, subT: 0,
  wallOn: 0, wallT: 0, trOn: 0, trT: 0, otT: 0 };

// ------------------------------------------------------------------ rivals
function rivalRec(o) { return save.rivals[o.name] || null; }
function rivalAdd(o, kind) {
  if (!o || o.isP) return;
  save.rivals[o.name] = VXCORE.rivalEvent(save.rivals[o.name] || VXCORE.newRival(), kind);
}
function nemesisTaunt(o, text) {
  const r = save.rivals[o.name] || { grudge: 0 };
  msg(o.name.toUpperCase() + ' · ' + VXCORE.rivalTitle(r.grudge));
  subtitle(o.name.toUpperCase(), text);
  tone(300, .18, 'sawtooth', .12);
  vxRumble(.35, 120);
}
function subtitle(who, text) {
  const el = VX_$('vxsub'); if (!el) return;
  el.querySelector('b').textContent = who;
  el.querySelector('span').textContent = text;
  el.classList.add('on');
  VXR.subT = 4.2;
}
/** highest-grudge rival near the player gets to say something now and then */
function nemesisTick(dt) {
  VXR.tauntT -= dt;
  if (VXR.tauntT > 0 || !player) return;
  VXR.tauntT = 9 + Math.random() * 7;
  let best = null, bg = 0;
  cars.forEach(o => {
    if (o.isP || o.ko || o.fin) return;
    const r = save.rivals[o.name]; if (!r || r.grudge < 45) return;
    const d = Math.hypot(o.x - player.x, o.z - player.z); if (d > 70) return;
    if (r.grudge > bg) { bg = r.grudge; best = o; }
  });
  if (best) nemesisTaunt(best, TAUNTS[(Math.random() * TAUNTS.length) | 0]);
}

// ------------------------------------------------------------------ condition: tyres / fuel / damage
function condition(o) {
  const b = o.base; if (!b) return;
  const dm = VXCORE.damageMul(o.dmg), tg = VXCORE.tyreGrip(o.tyre.wear, o.tyre.temp);
  const boost = (o.startBoost > 0 ? 1.12 : 1) * (o.shiftBonus > 0 ? 1.12 : 1);
  o.def.pw = b.pw * dm.power * VXCORE.fuelMassMul(o.fuel) * boost;
  o.def.top = b.top * dm.top;
  o.def.gr = b.gr * tg * dm.grip;
  o.def.br = b.br * dm.brake;
  if (o.fuel <= 0) o.def.pw = 0;                      // dry tank: no power at all
  if (o.tyre.wear >= 100) o.def.gr *= .9;
}
function hitPlayer(amount, area) {
  if (!player.base || state != 'race') return;
  const now = performance.now();
  if (now - VXR.hitCd < 700) return;
  VXR.hitCd = now;
  player.dmg = VXCORE.addDamage(player.dmg, area, amount);
  vxRumble(Math.min(1, amount / 16), 170);
  const broken = VXCORE.brokenParts(player.dmg);
  if (broken.length && !VXR.brokenAlert) { VXR.brokenAlert = 1; msg('BROKEN ' + broken.join(' + ').toUpperCase() + ' — PRESS F TO SERVICE'); }
}

// ------------------------------------------------------------------ drafting
function draftOf(o) {
  if (!o.base || o.ko) return 0;
  const spd = Math.hypot(o.vx, o.vz), fx = Math.sin(o.h), fz = Math.cos(o.h);
  let best = 0;
  for (let i = 0; i < cars.length; i++) {
    const q = cars[i];
    if (q === o || q.ko) continue;
    const dx = q.x - o.x, dz = q.z - o.z;
    const fwd = dx * fx + dz * fz;
    if (fwd <= 0) continue;
    const lat = dx * fz - dz * fx;
    const v = VXCORE.draftStrength(fwd, lat, spd);
    if (v > best) best = v;
  }
  return best;
}

// ------------------------------------------------------------------ wake visual
function makeWake() {
  if (VXR.wake) { scene.remove(VXR.wake); VXR.wake = null; }
  const m = new T.Mesh(new T.BoxGeometry(3.4, .06, 1),
    new T.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
  m.visible = false; scene.add(m); VXR.wake = m;
}
function draftVisual() {
  const w = VXR.wake; if (!w) return;
  const d = player.draft || 0;
  if (d < .06 || state != 'race') { w.visible = false; return; }
  // stretch the wake plane across the gap to the car being followed
  const fx = Math.sin(player.h), fz = Math.cos(player.h);
  let gap = 8;
  cars.forEach(o => {
    if (o === player || o.ko) return;
    const dx = o.x - player.x, dz = o.z - player.z, fwd = dx * fx + dz * fz;
    const lat = dx * fz - dz * fx;
    if (fwd > 1 && fwd < 20 && Math.abs(lat) < 3.4 && Math.abs(fwd - gap) < gap) gap = fwd;
  });
  w.visible = true;
  w.rotation.y = player.h;
  w.scale.z = gap;
  w.position.set(player.x + fx * gap * .5, .16, player.z + fz * gap * .5);
  w.material.opacity = .1 + .3 * d;
}

// ------------------------------------------------------------------ rewind
function snapshot() {
  return {
    t: raceT,
    p: [player.x, player.z, player.h, player.vx, player.vz, player.tot, player.idx],
    c: cars.map(o => [o.x, o.z, o.h, o.vx, o.vz, o.tot, o.idx]),
  };
}
function updateRewindHud() {
  const b = VX_$('vxrw');
  if (b) { b.querySelector('b').textContent = VXR.charges >= 999 ? '∞' : VXR.charges; b.classList.toggle('off', VXR.charges <= 0); }
}
function vxRewind() {
  if (!cfg || state != 'race') return;
  if (VXR.online) { msg('REWIND DISABLED ONLINE'); return; }
  if (VXR.charges <= 0) { msg('NO REWINDS LEFT'); return; }
  if (VXBUF.length < 20) { msg('NOTHING TO REWIND'); return; }
  const back = Math.min(60, VXBUF.length - 1);            // 50 ms steps -> 3 s
  const s = VXBUF[VXBUF.length - 1 - back];
  cars.forEach((o, i) => {
    const a = s.c[i]; if (!a) return;
    o.x = a[0]; o.z = a[1]; o.h = a[2]; o.vx = a[3]; o.vz = a[4]; o.tot = a[5]; o.idx = a[6];
  });
  raceT = Math.max(0, s.t);
  VXBUF.length = Math.max(0, VXBUF.length - back);
  if (VXR.charges < 999) VXR.charges--;
  const pen = VXCORE.rewindPenalty(back * .05);
  player.nit = Math.max(0, player.nit - pen.nitro);
  msg('REWIND −' + pen.time.toFixed(1) + 's');
  tone(520, .22, 'sine', .2); tone(340, .3, 'sine', .14, .08);
  updateRewindHud();
}

// ------------------------------------------------------------------ horn
function hornSound() {
  const v = save.set.hornVol == null ? .7 : save.set.hornVol;
  tone(392, .45, 'square', .2 * v);
  tone(494, .45, 'square', .15 * v);
  tone(587, .45, 'sawtooth', .06 * v);
}
function vxHorn() {
  if (!cfg || (state != 'race' && state != 'count')) return;
  const now = performance.now();
  if (now - (VXR.hornT || 0) < 380) return;
  VXR.hornT = now;
  hornSound(); vxRumble(.25, 130);
  let yielding = 0;
  cars.forEach(o => {
    if (o.isP || o.ko || o.fin) return;
    const dx = o.x - player.x, dz = o.z - player.z;
    const fwd = dx * Math.sin(player.h) + dz * Math.cos(player.h);
    const lat = dx * Math.cos(player.h) - dz * Math.sin(player.h);
    if (fwd > 1 && fwd < 30 && Math.abs(lat) < 7) { o.yield = 2.4; yielding++; rivalAdd(o, 'horn'); }
  });
  if (yielding) { msg('HORN · ' + yielding + ' CAR' + (yielding > 1 ? 'S' : '') + ' GAVE A SIDE'); persist(); }
  else msg('HORN');
}

// ------------------------------------------------------------------ pit service (simplified: stationary 4 s)
function vxPit() {
  if (!cfg || state != 'race' || !player.base) return;
  if (Math.hypot(player.vx, player.vz) > 4) { msg('STOP THE CAR TO SERVICE'); return; }
  if (VXR.pitT >= 0) return;
  VXR.pitT = 0; msg('PIT SERVICE…');
}
function pitTick(dt) {
  if (VXR.pitT < 0) return;
  VXR.pitT += dt;
  const left = Math.max(0, 4 - VXR.pitT);
  msg('PIT SERVICE ' + left.toFixed(1) + 's');
  if (VXR.pitT >= 4) {
    player.tyre = { wear: 0, temp: 80 };
    player.fuel = VXCORE.FUEL_CAPACITY;
    player.dmg = VXCORE.newDamage();
    player.heat = 0; player.overheat = 0;
    VXR.pitT = -1; VXR.brokenAlert = 0;
    msg('CAR SERVICED'); tone(680, .18, 'sine', .22);
  }
}

// ------------------------------------------------------------------ race start / step / ai wrappers
const _sr5 = startRace;
startRace = function (c) {
  _sr5(c);
  VXBUF = [];
  VXR.charges = VXCORE.rewindBudget(save.set.rewind, !!c.online);
  VXR.online = !!c.online; VXR.startErr = null; VXR.startUsed = 0;
  VXR.tauntT = 6; VXR.hitCd = 0; VXR.gear = 0; VXR.rpmf = 0; VXR.pitT = -1; VXR.acc = 0; VXR.brokenAlert = 0;
  VXR.wallOn = VXR.trOn = VXR.wallT = VXR.trT = VXR.otT = 0;
  cars.forEach(o => {
    o.def = Object.assign({}, o.def);                    // never mutate the shared CARS table
    o.base = { pw: o.def.pw, top: o.def.top, gr: o.def.gr, br: o.def.br || 42 };
    o.tyre = VXCORE.newTyre(); o.fuel = VXCORE.FUEL_CAPACITY; o.dmg = VXCORE.newDamage();
    o.heat = 0; o.overheat = 0; o.yield = 0; o.shiftBonus = 0; o.startBoost = 0; o.draft = 0;
    o._startDone = 0; o._tyreWarn = 0; o._pa = null;
    if (!o.isP) rivalAdd(o, 'race');                     // racing together is the seed of every grudge
  });
  makeWake();
  updateRewindHud();
};

const _step5 = step;
step = function (o, dt) {
  if (!o.base) { condition_fallback(o); return _step5(o, dt); }
  if (o.isP && VXR.pitT >= 0) { o.vx = o.vz = 0; return; }   // held in the pit box
  condition(o);
  const draft = draftOf(o);
  const spd = Math.hypot(o.vx, o.vz);
  _step5(o, dt);
  if (draft > .02) {
    const fx = Math.sin(o.h), fz = Math.cos(o.h);
    o.vx += fx * VXCORE.DRAFT_BOOST * draft * dt;
    o.vz += fz * VXCORE.DRAFT_BOOST * draft * dt;
  }
  o.draft = draft;
  const slip = Math.min(1, (o.drift || 0) / 8);
  o.tyre = VXCORE.tyreStep(o.tyre, dt, spd, slip);
  o.fuel = Math.max(0, o.fuel - VXCORE.fuelBurn(dt, o.input.t || 0, !!o.useN));
  if (o.tyre.wear >= 100 && o.isP && !o._tyreWarn) { o._tyreWarn = 1; msg('TIRES GONE'); }
  o.heat = VXCORE.nitroHeatStep(o.heat, dt, !!o.useN);
  if (o.heat >= 100) {
    if (!o.overheat) { if (o.isP) { msg('NITRO OVERHEAT'); tone(180, .3, 'sawtooth', .2); } }
    o.overheat = VXCORE.OVERHEAT_LOCK;
  } else if (o.overheat > 0) o.overheat = Math.max(0, o.overheat - dt);
  if (o.shiftBonus > 0) o.shiftBonus = Math.max(0, o.shiftBonus - dt);
  if (o.startBoost > 0) o.startBoost = Math.max(0, o.startBoost - dt);
  if (o.yield > 0) o.yield = Math.max(0, o.yield - dt);
};
function condition_fallback(o) {
  // cars created outside startRace (online join) still get a sane condition block
  o.def = Object.assign({}, o.def);
  o.base = { pw: o.def.pw, top: o.def.top, gr: o.def.gr, br: o.def.br || 42 };
  o.tyre = VXCORE.newTyre(); o.fuel = VXCORE.FUEL_CAPACITY; o.dmg = VXCORE.newDamage();
  o.heat = 0; o.overheat = 0; o.yield = 0; o.shiftBonus = 0; o.startBoost = 0;
}

const _ai5 = ai;
ai = function (o) {
  _ai5(o);
  if (!o.base || o.fin || !player) return;
  const r = rivalRec(o), pressure = r ? VXCORE.rivalPressure(r.grudge) : 0;
  if (pressure > .3) {
    if (pressure > .55) o.input.t = Math.max(o.input.t, 1);          // nemesis does not lift
    const dx = player.x - o.x, dz = player.z - o.z;
    const fwd = dx * Math.sin(o.h) + dz * Math.cos(o.h);
    const lat = dx * Math.cos(o.h) - dz * Math.sin(o.h);
    if (fwd < 0 && fwd > -26 && Math.abs(lat) < 8)                   // covering the line against you
      o.input.s = clamp(o.input.s + clamp(lat * .05, -.5, .5), -1, 1);
  }
  if (o.yield > 0) {                                                  // horned: pull aside and lift
    const dx = player.x - o.x, dz = player.z - o.z;
    const lat = dx * Math.cos(o.h) - dz * Math.sin(o.h);
    o.input.s = clamp(o.input.s + (lat > 0 ? -.9 : .9), -1, 1);   // must be a visible swerve, not a nudge
    o.input.t = Math.min(o.input.t, .6);
  }
};

const _msg5 = msg;
function nearestRival(r) {
  let best = null, bd = r;
  cars.forEach(o => {
    if (o.isP || o.ko) return;
    const d = Math.hypot(o.x - player.x, o.z - player.z);
    if (d < bd) { bd = d; best = o; }
  });
  return best;
}
msg = t => {
  _msg5(t);
  // Damage comes from the IMPACT, not from contact. `step` reports WALL! on every frame the car is
  // held by the barrier and traffic reports on every frame it overlaps, so a latch keeps one charge
  // per contact episode (released once the messages stop) and the speed gate ignores slow scrapes.
  if (!player || !player.base || state != 'race') return;
  const now = performance.now(), hit = Math.hypot(player.vx, player.vz);
  if (t == 'WALL!') {
    VXR.wallT = now;
    if (VXR.wallOn) return;
    VXR.wallOn = 1;
    if (hit > 5) hitPlayer(Math.min(18, 3 + hit * .45), 'body');
  } else if (t == 'COLLISION') {
    const other = nearestRival(4.2);
    if (other) rivalAdd(other, 'ram');               // who you leaned on remembers it
    if (hit > 5) hitPlayer(Math.min(10, 2 + hit * .2), 'body');
  } else if (t == 'TRAFFIC HIT') {
    VXR.trT = now;
    if (VXR.trOn) return;
    VXR.trOn = 1;
    if (hit > 5) hitPlayer(Math.min(12, 3 + hit * .25), 'aero');
  }
};

// ------------------------------------------------------------------ finish: grudge accounting
const _fin5 = finish;
finish = function () {
  const pos = rank().indexOf(player) + 1;
  _fin5();
  const order = rank();
  cars.forEach(o => { if (!o.isP) rivalAdd(o, order.indexOf(o) < pos - 1 ? 'beaten' : 'beat'); });
  Object.keys(save.rivals).forEach(k => { const r = save.rivals[k]; if (r.races > 3) r.grudge = Math.round(VXCORE.grudgeDecay(r.grudge)); });
  persist();
  const nem = Object.keys(save.rivals).filter(k => save.rivals[k].grudge >= 55)
    .sort((a, b) => save.rivals[b].grudge - save.rivals[a].grudge).slice(0, 3);
  if (nem.length) VX_$('rt').insertAdjacentHTML('afterbegin',
    '<div class="badge alt">NEMESIS WATCH</div><div style="color:#A5ADBA;font-size:12px">' +
    nem.map(n => n + ' · ' + VXCORE.rivalTitle(save.rivals[n].grudge) + ' ' + Math.round(save.rivals[n].grudge) + '%').join(' &nbsp;·&nbsp; ') + '</div>');
};

// ------------------------------------------------------------------ pause / resume with 3 s countdown
function vxTogglePause() {
  if (state == 'race' && typeof pauseGame == 'function') pauseGame();
  else if (state == 'pause' || state == 'resume') resume();
}
const _resume5 = resume;
resume = function () {
  if (state != 'pause') return _resume5();
  VX_$('pause').classList.add('hidden');
  cdT = 3; state = 'resume';                    // 3 · 2 · 1, car frozen meanwhile
  VX_$('cd').textContent = '3';
};
VX_$('resume').onclick = resume;

// ------------------------------------------------------------------ settings + rivals screen
const _showX5 = showX;
showX = function (k) {
  _showX5(k);
  if (k != 'settings') return;
  const panel = VX_$('xs').querySelector('.panel'), back = panel.lastElementChild;
  const opt = (v, l) => `<option value="${v}" ${save.set.rewind == v ? 'selected' : ''}>${l}</option>`;
  back.insertAdjacentHTML('beforebegin',
    `<h3>REWIND (FLASHBACK)</h3>
 <label>Charges per race<select onchange="save.set.rewind=this.value;persist()">${opt('off', 'Off')}${opt('3', '3 charges')}${opt('inf', 'Unlimited')}</select></label>
 <div style="color:#5b6678;font-size:11px">Restoring 3 s of racing costs 3 s of race time and 15 nitro. Always off in online/ranked.</div>
 <h3>HORN</h3>
 <label>Volume<input type=range min=0 max=1 step=.05 value=${save.set.hornVol} onchange="save.set.hornVol=+this.value;persist()"></label>
 <button class=ghost onclick="vxHorn()">TEST HORN</button>`);
};
function showRivals() {
  const rows = Object.keys(save.rivals).map(k => ({ k, r: save.rivals[k] }))
    .sort((a, b) => b.r.grudge - a.r.grudge);
  VX_$('xs').innerHTML = '<div class="panel"><h2>RIVALS &amp; NEMESIS</h2>' +
    '<div style="color:#A5ADBA;font-size:12px">Grudges are saved. A nemesis defends harder, targets you and talks on the radio.</div>' +
    (rows.length ? rows.map(({ k, r }) =>
      `<div class="rv"><b>${k}</b><span class="tag2">${VXCORE.rivalTitle(r.grudge)}</span>
        <div class="vxb big"><i style="width:${Math.round(r.grudge)}%"></i></div>
        <div class="rvn">grudge ${Math.round(r.grudge)}% · beat you ${r.wins}× · you beat them ${r.losses}× · collisions ${r.hits} · races ${r.races}</div></div>`).join('')
      : '<div style="margin:12px 0">No history yet — race a few times (or lean on the horn).</div>') +
    '<button class=ghost onclick="$(\'xs\').classList.add(\'hidden\')">BACK</button>' +
    (rows.length ? '<button class=ghost onclick="if(confirm(\'Clear rival history?\')){save.rivals={};persist();showRivals()}">CLEAR HISTORY</button>' : '') +
    '</div>';
  VX_$('xs').classList.remove('hidden');
}
document.querySelector('#menu .top').nextElementSibling.insertAdjacentHTML('beforeend',
  '<button class=ghost onclick="showRivals()">RIVALS &amp; NEMESIS</button>');

// ------------------------------------------------------------------ HUD
const VX_EL = {};
['vxTyre', 'vxTyreV', 'vxFuel', 'vxFuelV', 'vxDmg', 'vxDmgV', 'vxHeat', 'vxHeatV', 'vxdraft', 'vxsub'].forEach(i => VX_EL[i] = VX_$(i));
function vxBar(id, pct) { const e = VX_EL[id]; if (e) e.style.width = Math.max(0, Math.min(100, pct)) + '%'; }
function vxTxt(id, s) { const e = VX_EL[id]; if (e && e.textContent != s) e.textContent = s; }
function hudTick() {
  const p = player; if (!p || !p.tyre) return;
  vxBar('vxTyre', 100 - p.tyre.wear); vxTxt('vxTyreV', Math.round(p.tyre.temp) + '°');
  vxBar('vxFuel', p.fuel / VXCORE.FUEL_CAPACITY * 100); vxTxt('vxFuelV', p.fuel.toFixed(1));
  const dmg = Math.max(p.dmg.body, p.dmg.engine, p.dmg.aero, p.dmg.tyres);
  vxBar('vxDmg', dmg); vxTxt('vxDmgV', Math.round(dmg) + '%');
  vxBar('vxHeat', p.heat); vxTxt('vxHeatV', p.overheat > 0 ? 'LOCK' : Math.round(p.heat) + '%');
  if (VX_EL.vxdraft) {
    const d = p.draft || 0;
    VX_EL.vxdraft.classList.toggle('on', d > .08);
    VX_EL.vxdraft.textContent = d > .08 ? 'DRAFT ' + Math.round(d * 100) + '%' : '';
  }
  if (VXR.subT > 0) { VXR.subT -= 1 / 60; if (VXR.subT <= 0 && VX_EL.vxsub) VX_EL.vxsub.classList.remove('on'); }
}

// ------------------------------------------------------------------ perfect start / shift
function startCheck() {
  if (state != 'count' && state != 'resume') return;
  const padT = typeof VXIN != 'undefined' ? VXIN.throttle : 0;
  const pressed = keys.KeyW || keys.ArrowUp || padT > .5;
  if (pressed && !VXR.startUsed) {
    VXR.startUsed = 1;
    VXR.startErr = state == 'count' ? cdT - 1 : null;              // seconds to the lights going out
  }
}
function shiftCheck() {
  const p = player; if (!p || !p.base) return;
  const spd = Math.hypot(p.vx, p.vz), band = p.def.top / 6;
  const rpmf = (spd % band) / band, gear = clamp(Math.floor(spd / band) + 1, 1, 6);
  if (gear > VXR.gear && VXR.gear > 0 && VXR.rpmf > .88 && VXR.rpmf <= 1.02) {
    p.shiftBonus = 1.5; msg('PERFECT SHIFT'); tone(1400, .07, 'square', .12);
  }
  VXR.gear = gear; VXR.rpmf = rpmf;
}

// ------------------------------------------------------------------ main tick
let vxT = 0;
function vxTick(t) {
  requestAnimationFrame(vxTick);
  const dt = Math.min((t - (vxT || t)) / 1000, .1); vxT = t;
  if (!cfg || !player) return;
  if (state == 'race' || state == 'count' || state == 'resume') { startCheck(); }
  if (state != 'race') return;
  VXR.acc += dt;
  while (VXR.acc >= .05) {
    VXR.acc -= .05;
    VXBUF.push(snapshot());
    if (VXBUF.length > 210) VXBUF.shift();
  }
  if (VXR.startErr != null && player.base && !player._startDone) {
    player._startDone = 1;
    if (VXCORE.perfectStart(VXR.startErr)) { player.startBoost = 2; msg('PERFECT START'); tone(1200, .12, 'sine', .2); }
  }
  nemesisTick(dt);
  pitTick(dt);
  shiftCheck();
  hudTick();
  draftVisual();
  // release the contact latches once the barrier / traffic is no longer touching us
  const now = performance.now();
  if (VXR.wallOn && now - VXR.wallT > 220) VXR.wallOn = 0;
  if (VXR.trOn && now - VXR.trT > 400) VXR.trOn = 0;
  // passing a rival on track is a grudge too (checked at 2 Hz, remembered per car)
  VXR.otT += dt;
  if (VXR.otT >= .5) {
    VXR.otT = 0;
    cars.forEach(o => {
      if (o.isP || o.ko || o.fin) return;
      const ahead = player.tot > o.tot;
      if (ahead && o._pa === 0) rivalAdd(o, 'overtake');
      o._pa = ahead ? 1 : 0;
    });
  }
}
requestAnimationFrame(vxTick);
window.VXGAMEPLAY = { VXR, rivals: () => save.rivals, horn: vxHorn, rewind: vxRewind };
