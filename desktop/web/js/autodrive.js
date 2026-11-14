// VELOCITY X free-world AUTO DRIVE (v0.7)
//
// The computer drives the SAME physics car through the SAME input structure a human uses
// ({t,b,s,hb,n}) — no teleporting, no scripting the pose. It looks at the track samples, the
// precomputed curvature, the traffic pool and the other cars, then writes throttle / brake /
// steering exactly like a player would.
//
//   · lanes + overtaking + safe distance + corner braking + speed zones + nitro on straights
//   · stuck / off-road / backwards detection with an automatic reset (5 s hard limit)
//   · instant take-over: any real steering/gas/brake input, the TAKE CONTROL button, or T
//   · cinematic camera cycle while it drives (chase, hood, drone, trackside)
//   · XP accrues at 25 % of the solo rate; credits always 0 (documented, not exploitable)
save.set = Object.assign({ autoMode: 'self', autoStyle: 'normal', autoTraffic: 1, autoCam: 1 }, save.set);

const VXAUTO = {
  on: 0, style: save.set.autoStyle || 'normal', respect: save.set.autoTraffic !== 0,
  lane: 0, stuck: 0, fail: 0, resets: 0, hits: 0, dist: 0, xpT: 0,
  lx: 0, lz: 0, camT: 0, camIdx: 0, camSeen: -1,
  bt: 0, bb: 0, bs: 0, bn: 0, blend: 0, pT: 0, pD: 0,
  styleMul: { relaxed: .62, normal: .8, sporty: .93, fast: 1.0 },
  // a slow zone only where the world really is built up (Neon Metropolis / Industrial District)
  zone: { 3: 19, 5: 21 },
  // three lanes to the right of the centre line, and their occupancy. Both are allocated once and
  // overwritten in place, so the per-frame driver never allocates.
  lanes: [-6, 0, 6], gaps: [999, 999, 999], bgaps: [999, 999, 999], score: [999, 999, 999], bi: 1
};

// ---------------------------------------------------------------- the driver
// Everything below is scalar arithmetic on existing arrays: no vectors, no objects, no allocation.
function vxAutoDrive() {
  const p = player; if (!p || !cfg || !p.def) return;
  const d = p.def, spd = Math.hypot(p.vx, p.vz);
  const dts = (typeof VXIN != 'undefined' && VXIN.dt) || 1 / 60;
  const styleMul = VXAUTO.styleMul[VXAUTO.style] || .8;
  const fx = Math.sin(p.h), fz = Math.cos(p.h), rxv = fz, rzv = -fx;

  // --- 1. lane choice ----------------------------------------------------------------------
  // Traffic drives at +/-6 m, which is wider than the old detection band, so the car never saw
  // what it hit. Every obstacle is now bucketed into one of the three lanes by its ABSOLUTE offset
  // from the road centre (our own offset + its offset from us), and the AI takes the free lane.
  const offNow = typeof VXTRL != 'undefined' ? VXTRL.offTrack(p) : 0;   // + = right of the line
  const dArr = VXAUTO.gaps, bArr = VXAUTO.bgaps, sc = VXAUTO.score;
  dArr[0] = dArr[1] = dArr[2] = 999; bArr[0] = bArr[1] = bArr[2] = 999;
  const react = VXAUTO.respect ? 55 : 24, back = 45;
  // traffic pool (extras.js): {s, lane, v, m} — traffic sits at +/-6 m, so a lane is only safe when
  // nothing is in it AHEAD (we would rear-end it) or BEHIND (it would rear-end us: traffic moves at
  // 58-94 km/h, faster than the AI in a speed zone).
  if (typeof TR !== 'undefined' && TR && TR.length) {
    for (let i = 0; i < TR.length; i++) {
      const t = TR[i], m = t.m; if (!m) continue;
      const dx = m.position.x - p.x, dz = m.position.z - p.z;
      const fwd = dx * fx + dz * fz, lat = dx * rxv + dz * rzv;
      if (fwd >= react || fwd <= -back) continue;
      const ab = offNow + lat, k = ab < -3 ? 0 : ab > 3 ? 2 : 1;
      if (fwd > 1.5) { if (fwd < dArr[k]) dArr[k] = fwd; }
      else { const g = -fwd; if (g < bArr[k]) bArr[k] = g; }
    }
  }
  // other cars (rivals / online) use the same rule so Auto works in any mode
  if (cars && cars.length > 1) {
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i]; if (o === p || o.ko) continue;
      const dx = o.x - p.x, dz = o.z - p.z;
      const fwd = dx * fx + dz * fz, lat = dx * rxv + dz * rzv;
      if (fwd >= react || fwd <= -back) continue;
      const ab = offNow + lat, k = ab < -3 ? 0 : ab > 3 ? 2 : 1;
      if (fwd > 2.5) { if (fwd < dArr[k]) dArr[k] = fwd; }
      else if (fwd < -2.5) { const g = -fwd; if (g < bArr[k]) bArr[k] = g; }
    }
  }
  // a lane with a car closing behind is worth less than its raw gap: 25 m behind scores like 40 m
  sc[0] = Math.min(dArr[0], bArr[0] * 1.6);
  sc[1] = Math.min(dArr[1], bArr[1] * 1.6);
  sc[2] = Math.min(dArr[2], bArr[2] * 1.6);
  // hysteresis: only change lane when another one is clearly freer, which stops the AI flapping
  let bi = VXAUTO.bi, bestV = sc[bi] + 12;
  for (let k = 0; k < 3; k++) if (sc[k] > bestV) { bestV = sc[k]; bi = k; }
  VXAUTO.bi = bi;
  let want = VXAUTO.lanes[bi], nearest = dArr[bi], blocker = nearest < 999 ? 1 : 0;
  // hidden rewards: a nearby orb is worth a small detour, never a trip off the road
  if (!blocker && typeof orbs !== 'undefined' && orbs && orbs.length) {
    for (let i = 0; i < orbs.length; i++) {
      const o = orbs[i]; if (!o || !o.position) continue;
      const dx = o.position.x - p.x, dz = o.position.z - p.z;
      const fwd = dx * fx + dz * fz, lat = dx * rxv + dz * rzv;
      if (fwd > 6 && fwd < 40 && Math.abs(lat) < 9) { want = offNow + lat; break; }
    }
  }
  want = clamp(want, -8, 8);
  // rate-limited lane change (6.5 m/s of lateral travel): fast enough to clear a car, no snapping
  const dl = want - VXAUTO.lane, maxStep = 6.5 * Math.min(dts, .05);
  VXAUTO.lane += clamp(dl, -maxStep, maxStep);

  // --- 2. steering: pure pursuit at the plant's own gain -----------------------------------
  // step() turns the car with  dh/dt = s * hd * (v/12 clamp) / (1 + v/38), so `s` sets a
  // CURVATURE, not an angle. Steering by `e * constant` (the obvious thing) is about 11x too hot
  // on this model: the car swings +/-6 m across the road, corner-cutting one way and over-
  // correcting the other - which is exactly what dragged it into the traffic lane. Pure pursuit
  // wants kappa = 2*sin(alpha)/Ld, so convert that back into the steering the physics expects.
  const look = 5 + Math.floor(spd / 9);
  const Ld = Math.max(14, look * 4.8);                      // look-ahead in metres (4.8 m samples)
  const ti = (p.idx + look) % N;
  const tx = P[ti].x + Nm[ti].x * VXAUTO.lane, tz = P[ti].z + Nm[ti].z * VXAUTO.lane;
  let e = Math.atan2(tx - p.x, tz - p.z) - p.h;
  while (e > Math.PI) e -= 6.283185307;
  while (e < -Math.PI) e += 6.283185307;
  const xt = clamp((VXAUTO.lane - offNow) / 9, -1, 1);      // + = we are below the wanted offset
  const alpha = clamp(e + xt * .25, -1.2, 1.2);             // pursuit angle + cross-track damping
  // omega = v * kappa, and step() turns with omega = s * hd / (1 + v/38), so the steering that
  // realises kappa = 2*sin(alpha)/Ld is  s = 2 * v * alpha * (1 + v/38) / (Ld * hd).
  const kGain = 2 * spd * (1 + spd / 38) / (Ld * (d.hd || 4));
  let s = clamp(kGain * alpha, -1, 1);

  // --- 3. speed: corner braking from the precomputed curvature, plus a real speed zone ----
  let bend = 0;
  for (let k = 0; k < 6; k++) {
    const c = CURV[(p.idx + k * 9) % N] || 0;
    if (c > bend) bend = c;
  }
  let vmax = d.top * styleMul * (1 - Math.min(bend * 1.45, .58));
  const zone = VXAUTO.zone[cfg.loc];
  if (zone) vmax = Math.min(vmax, zone * (VXAUTO.style == 'fast' ? 1.18 : 1.08));
  if (VXAUTO.style == 'relaxed') vmax = Math.min(vmax, 26);
  // following distance: ease off behind the car in OUR lane, stop short of touching it
  if (blocker && nearest < 45) vmax = Math.min(vmax, Math.max(0, (nearest - 9) * 2.2));
  let t = spd < vmax ? 1 : 0;
  let b = 0;
  if (spd > vmax + .5) b = clamp((spd - vmax) / (VXAUTO.style == 'relaxed' ? 9 : 6), .18, 1);
  if (spd > 40 && bend > .5) b = Math.max(b, .55);
  // handbrake only as a genuine stabiliser in a big slide
  const hb = (p.drift || 0) > 7 && spd > 22 ? 1 : 0;
  // nitro on a safe straight, never while cornering or when the bottle is nearly empty
  const n = bend < .055 && !blocker && p.nit > 35 && !(p.overheat > 0) && spd > 18 && VXAUTO.style != 'relaxed' ? 1 : 0;

  // --- 4. self-preservation ----------------------------------------------------------------
  const off = Math.abs(offNow);
  if (spd < 1.2 && t > 0) VXAUTO.stuck += dts; else VXAUTO.stuck = 0;
  if (off > 14) VXAUTO.fail += dts; else VXAUTO.fail = Math.max(0, VXAUTO.fail - 2 * dts);
  // progress watchdog: 6 s without covering ~25 m means the world has defeated us
  VXAUTO.pT += dts;
  if (VXAUTO.pT > 6) {
    if (Math.abs(p.tot - VXAUTO.pD) < 6) VXAUTO.fail = 6;
    VXAUTO.pT = 0; VXAUTO.pD = p.tot;
  }
  let reset = 0;
  if (VXAUTO.stuck > 3 || VXAUTO.fail > 5) reset = 1;     // the hard 5 s contract
  if (reset) {
    VXAUTO.resets++; VXAUTO.stuck = 0; VXAUTO.fail = 0; VXAUTO.lane = 0; VXAUTO.bi = 1; VXAUTO.pT = 0;
    if (typeof vxResetCar == 'function') vxResetCar();
    const i = p.idx;
    p.px = p.x = P[i].x; p.pz = p.z = P[i].z; p.ph = p.h = Math.atan2(Tn[i].x, Tn[i].z);
    p.vx = p.vz = 0; VXAUTO.pD = p.tot;
    if (typeof msg == 'function') msg('AUTO RECOVERY');
    // leave the car accelerating away instead of coasting to a stop after the reset
    if (!p.input) p.input = { t: 0, b: 0, s: 0, hb: 0, n: 0 };
    VXAUTO.bt = 1; VXAUTO.bb = 0; VXAUTO.bs = 0; VXAUTO.bn = 0;
    p.input.t = 1; p.input.b = 0; p.input.s = 0; p.input.hb = 0; p.input.n = 0;
    return;
  }

  // --- 5. write the input exactly like a human would (the object is reused, never re-created) --
  VXAUTO.bt = b > .1 ? 0 : t; VXAUTO.bb = b; VXAUTO.bs = s; VXAUTO.bn = n;
  if (!p.input) p.input = { t: 0, b: 0, s: 0, hb: 0, n: 0 };
  p.input.t = VXAUTO.bt; p.input.b = VXAUTO.bb; p.input.s = VXAUTO.bs;
  p.input.hb = hb; p.input.n = VXAUTO.bn;
}

// ---------------------------------------------------------------- mode switching
function vxAutoSet(on, how) {
  on = on ? 1 : 0;
  if (VXAUTO.on == on) { vxAutoHud(); return; }
  const was = VXAUTO.on;
  VXAUTO.on = on;
  save.set.autoMode = on ? 'auto' : 'self';
  persist();
  if (on) {
    VXAUTO.camT = 0; VXAUTO.camIdx = 0; VXAUTO.camSeen = -1; VXAUTO.lane = 0; VXAUTO.bi = 1;
    VXAUTO.stuck = 0; VXAUTO.fail = 0; VXAUTO.pT = 0;
    VXAUTO.pD = player ? player.tot : 0;
    VXAUTO.lx = player ? player.x : 0; VXAUTO.lz = player ? player.z : 0;
  } else if (player) {
    // take-over: blend from the AI's last input to the player's over 0.3 s so nothing snaps
    VXAUTO.blend = .3;
    if (typeof msg == 'function') msg(how == 'takeover' ? 'YOU HAVE CONTROL' : 'SELF DRIVE');
  }
  if (on && typeof msg == 'function') msg('AUTO DRIVE · ' + VXAUTO.style.toUpperCase());
  if (typeof tone == 'function') tone(on ? 520 : 700, .12, 'sine', .16);
  if (was != VXAUTO.on) vxAutoHud();
}
function vxAutoToggle() {
  if (typeof state == 'undefined' || (state != 'race' && state != 'count' && state != 'pause' && state != 'resume')) return;
  vxAutoSet(VXAUTO.on ? 0 : 1, 'toggle');
}
function vxAutoStyle(v) {
  VXAUTO.style = VXAUTO.styleMul[v] ? v : 'normal';
  save.set.autoStyle = VXAUTO.style; persist(); vxAutoHud();
}
function vxAutoRespect(on) { VXAUTO.respect = !!on; save.set.autoTraffic = on ? 1 : 0; persist(); }

// ---------------------------------------------------------------- HUD + pause + start overlay
let vxAutoHudT = '', vxAutoHudOn = -1;
function vxAutoHud() {
  const el = document.getElementById('vxauto'); if (!el) return;
  const live = typeof state != 'undefined' && (state == 'race' || state == 'count' || state == 'resume') && VXAUTO.on ? 1 : 0;
  if (live != vxAutoHudOn) { vxAutoHudOn = live; el.classList.toggle('hidden', !live); }
  const info = document.getElementById('vxautoinfo');
  if (info && live) {
    const kmh = player ? Math.round(Math.hypot(player.vx, player.vz) * 3.6) : 0;
    const s = 'AUTO · ' + VXAUTO.style.toUpperCase() + ' · ' + kmh + ' KM/H';
    if (s != vxAutoHudT) { vxAutoHudT = s; info.textContent = s; }
  }
}
(function vxAutoBind() {
  const take = document.getElementById('vxtake');
  if (take) take.onclick = e => { e.preventDefault(); vxAutoSet(0, 'takeover'); };
  const ps = document.getElementById('pdeself'), pa = document.getElementById('pdeauto');
  if (ps) ps.onclick = () => { vxAutoSet(0, 'toggle'); vxAutoPauseUi(); };
  if (pa) pa.onclick = () => { vxAutoSet(1, 'toggle'); vxAutoPauseUi(); };
})();

// pause menu: DRIVE MODE switch + Auto options (only in a free/open world)
function vxAutoPauseUi() {
  const box = document.getElementById('pdrive'); if (!box) return;
  const open = typeof cfg !== 'undefined' && cfg && (cfg.mode == 'open' || cfg.mode == 'highway');
  box.classList.toggle('hidden', !open);
  if (!open) return;
  const a = document.getElementById('pdeself'), b = document.getElementById('pdeauto');
  if (a) a.classList.toggle('sel', !VXAUTO.on);
  if (b) b.classList.toggle('sel', !!VXAUTO.on);
  const opts = document.getElementById('pdeopts');
  if (opts && !opts.dataset.on) {
    opts.dataset.on = '1';
    opts.innerHTML =
      '<label>Speed style<select id="pdestyle">' +
      ['relaxed', 'normal', 'sporty', 'fast'].map(v => `<option value="${v}">${v[0].toUpperCase() + v.slice(1)}</option>`).join('') +
      '</select></label><label class=cbl><input type=checkbox id="pdetrf"> Respect traffic</label>' +
      '<div style="color:#5b6678;font-size:11px">T toggles Auto/Self at any time. Any steering, gas or brake input hands control back.</div>';
    const st = document.getElementById('pdestyle'), tr = document.getElementById('pdetrf');
    if (st) { st.value = VXAUTO.style; st.onchange = () => vxAutoStyle(st.value); }
    if (tr) { tr.checked = VXAUTO.respect; tr.onchange = () => vxAutoRespect(tr.checked); }
  }
  const st = document.getElementById('pdestyle'), tr = document.getElementById('pdetrf');
  if (st) st.value = VXAUTO.style;
  if (tr) tr.checked = VXAUTO.respect;
}
// wrap pauseGame so the block is filled every time the menu opens (pauseGame is a plain function
// declaration shared by every script, so the rebinding reaches the ESC/P handlers too)
const _vxAutoPause = pauseGame;
pauseGame = function () { _vxAutoPause(); vxAutoPauseUi(); };

// pre-start choice: the Open World START button asks how you want to drive
const _vxAutoGo = $('go').onclick;
$('go').onclick = function () {
  const c = readCfg();
  if (c.mode != 'open') { _vxAutoGo.call(this); return; }
  vxAutoPick(c);
};
function vxAutoPick(c) {
  const scr = document.getElementById('vxdrive'); if (!scr) { _vxAutoGo.call(null); return; }
  scr.classList.remove('hidden');
  document.getElementById('menu').classList.add('hidden');
  const opts = document.getElementById('vxdriveopts');
  if (opts && !opts.dataset.on) {
    opts.dataset.on = '1';
    opts.innerHTML = '<label>Speed style<select id="vxdyStyle">' +
      ['relaxed', 'normal', 'sporty', 'fast'].map(v => `<option value="${v}">${v[0].toUpperCase() + v.slice(1)}</option>`).join('') +
      '</select></label><label class=cbl><input type=checkbox id="vxdyTrf" checked> Respect traffic</label>';
  }
  const st = document.getElementById('vxdyStyle'), tr = document.getElementById('vxdyTrf');
  if (st) { st.value = VXAUTO.style; st.onchange = () => vxAutoStyle(st.value); }
  if (tr) { tr.checked = VXAUTO.respect; tr.onchange = () => vxAutoRespect(tr.checked); }
  const self = document.getElementById('vxself'), auto = document.getElementById('vxauto2');
  const done = mode => {
    scr.classList.add('hidden');
    save.set.autoMode = mode; persist();
    startRace(c);                     // the startRace wrapper reads save.set.autoMode back
  };
  if (self) self.onclick = () => done('self');
  if (auto) auto.onclick = () => done('auto');
  const back = document.getElementById('vxdriveback');
  if (back) back.onclick = () => { scr.classList.add('hidden'); document.getElementById('menu').classList.remove('hidden'); };
}

// ---------------------------------------------------------------- input takeover + per-frame
// The device layer always runs first: that is what feeds the take-over detector and keeps the
// pad hot-plug / camera / reset edges working while the computer is driving. One wrapper handles
// both directions, because a hand-back must also blend for a moment instead of snapping.
const _vxAutoRI = readInput;
readInput = function () {
  _vxAutoRI();
  if (!player) return;
  if (VXAUTO.on) {
    const L = typeof VXIN !== 'undefined' ? VXIN.layer : null;
    const human = L && (L.throttle > .22 || L.brake > .22 || Math.abs(L.steer) > .28 || L.handbrake > .5);
    if (human) { vxAutoSet(0, 'takeover'); }     // fall through to the blend below
    else { vxAutoDrive(); return; }
  }
  if (VXAUTO.blend <= 0) return;
  // smooth hand-back: for 0.3 s the player's input is blended with what the AI was doing
  VXAUTO.blend = Math.max(0, VXAUTO.blend - 1 / 60);
  const k = VXAUTO.blend / .3;                     // 1 = still AI, 0 = fully player
  const I = player.input || (player.input = { t: 0, b: 0, s: 0, hb: 0, n: 0 });
  I.t = I.t * (1 - k) + VXAUTO.bt * k;
  I.b = I.b * (1 - k) + VXAUTO.bb * k;
  I.s = I.s * (1 - k) + VXAUTO.bs * k;
  I.n = I.n * (1 - k) + VXAUTO.bn * k;
};

// ---------------------------------------------------------------- start / finish hooks
// Re-entering the world (retry, restart, event) honours the mode saved in settings.
const _vxAutoSR = startRace;
startRace = function (c) {
  _vxAutoSR(c);
  const want = c && c.mode == 'open' && save.set.autoMode == 'auto' ? 1 : 0;
  if (want && !VXAUTO.on) vxAutoSet(1, 'start');
  else if (!want && VXAUTO.on) vxAutoSet(0, 'start');
  else { VXAUTO.lane = 0; VXAUTO.stuck = 0; VXAUTO.fail = 0; vxAutoHud(); }
};
// collision counting for the soak report
const _vxAutoMsg = msg;
msg = function (t) {
  if (VXAUTO.on && (t == 'COLLISION' || t == 'TRAFFIC HIT' || t == 'WALL!')) VXAUTO.hits++;
  _vxAutoMsg(t);
};

if (typeof addEventListener == 'function') {
  addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.code == 'KeyT') { vxAutoToggle(); e.preventDefault(); }
  });
}

// per-frame: cinematic camera, distance/XP accrual, HUD refresh, auto-start hook
let vxAutoLast = 0;
function vxAutoTick(t) {
  requestAnimationFrame(vxAutoTick);
  const dt = Math.min(.1, (t - (vxAutoLast || t)) / 1000); vxAutoLast = t;
  const live = typeof state != 'undefined' && state == 'race' && player && cfg;
  if (!live || !VXAUTO.on) {
    if (!live && VXAUTO.on) vxAutoHud();
    return;
  }
  // distance (ignores resets and teleports) + the documented reduced XP rate
  const dx = player.x - VXAUTO.lx, dz = player.z - VXAUTO.lz, d = Math.sqrt(dx * dx + dz * dz);
  if (d > 0 && d < 20) VXAUTO.dist += d;
  VXAUTO.lx = player.x; VXAUTO.lz = player.z;
  VXAUTO.xpT += dt;
  if (VXAUTO.xpT >= 300) {                       // every 5 minutes of Auto driving
    VXAUTO.xpT -= 300;
    save.xp += 37; persist();                    // 25 % of the 150 XP solo open-world reward
    if (typeof msg == 'function') msg('AUTO DRIVE · +37 XP');
  }
  // cinematic cameras: chase -> hood -> drone -> trackside, 8 s each
  if (+save.set.autoCam) {
    if (VXAUTO.camSeen != camMode) { VXAUTO.camSeen = camMode; VXAUTO.camT = 0; }
    VXAUTO.camT += dt;
    if (VXAUTO.camT > 8) {
      VXAUTO.camT = 0;
      const seq = [0, 2, 3, 4];
      camMode = seq[(++VXAUTO.camIdx) % seq.length];
      VXAUTO.camSeen = camMode;
    }
  }
  vxAutoHud();
}
requestAnimationFrame(vxAutoTick);

// resume the saved mode is handled by the startRace wrapper above; nothing to do at load

window.VXAUTOAPI = {
  get on() { return !!VXAUTO.on; },
  get style() { return VXAUTO.style; },
  get stats() { return { on: VXAUTO.on, style: VXAUTO.style, dist: Math.round(VXAUTO.dist), resets: VXAUTO.resets, hits: VXAUTO.hits, lane: Math.round(VXAUTO.lane * 10) / 10, spd: player ? Math.round(Math.hypot(player.vx, player.vz) * 3.6) : 0 }; },
  set: vxAutoSet, toggle: vxAutoToggle, styleSet: vxAutoStyle, respect: vxAutoRespect, pick: vxAutoPick, pause: vxAutoPauseUi
};
