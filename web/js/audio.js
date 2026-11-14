// VELOCITY X audio (v0.7) — a real RPM-driven engine, plus every speed-dependent layer.
//
// No samples are shipped: the whole engine is synthesised from oscillators + filtered noise, so there
// is no third-party audio to license (see assets/LICENSES.md). Each car index gets a profile (cylinder
// count, harmonic mix, redline, turbo/electric) and the voice's frequencies are derived from the real
// vehicle state (rpm, throttle, gear, speed).
//
// Hard rules honoured here:
//   · every node is created ONCE in vxAudEnsure() and reused — the per-frame path allocates nothing
//   · every parameter moves with setTargetAtTime (no clicks, no zipper noise)
//   · buses: master (vol) > engine (ev) / environment (av) / effects (sv) / UI (uv)
//   · the AudioContext is unlocked by the first gesture and resumed after a tab switch or a call
const VXAUD = { on: 0, ready: 0, voices: 0, rpm: 0, gear: 1, f0: 0, gain: 0, limit: 0, revs: 0 };
Object.defineProperty(VXAUD, 'ctx', { get() { return typeof aud === 'undefined' ? null : aud; } });

save.set = Object.assign({ ev: 1, mv: .5, sv: 1, av: 1, uv: .8 }, save.set);

// ---- per-car sound identity (index matches the RAW table in extras.js) ----
// cyl = cylinders, harm = harmonic mix, red = redline rpm, turbo = whistle amount, el = electric
const VX_AUD_PR = [
  { cyl: 8, harm: [.62, .30, .16, .55], red: 7200, turbo: 0, el: 0, name: 'V8 rumble' },      // Phantom R
  { cyl: 6, harm: [.52, .34, .24, .34], red: 7800, turbo: .2, el: 0, name: 'high-rev six' },   // Apex GT
  { cyl: 4, harm: [.5, .38, .3, .26], red: 7000, turbo: .7, el: 0, name: 'turbo JDM' },        // Sahara X
  { cyl: 12, harm: [.5, .34, .3, .3], red: 8600, turbo: .1, el: 0, name: 'V12 supercar' },     // Silver Arrow
  { cyl: 4, harm: [.48, .4, .32, .24], red: 7400, turbo: .8, el: 0, name: 'turbo JDM' },       // Street Viper
  { cyl: 4, harm: [.5, .36, .28, .3], red: 8000, turbo: .1, el: 0, name: 'NA screamer' },      // Drift King
  { cyl: 8, harm: [.72, .22, .12, .68], red: 6400, turbo: 0, el: 0, name: 'V8 muscle' },       // Muscle V8
  { cyl: 4, harm: [.52, .34, .26, .3], red: 7200, turbo: .6, el: 0, name: 'turbo rally' },     // Rally Pro
  { cyl: 0, harm: [.2, .1, .9, 0], red: 14000, turbo: 0, el: 1, name: 'electric whine' },      // Hyper Volt
  { cyl: 6, harm: [.5, .36, .3, .28], red: 8000, turbo: .85, el: 0, name: 'turbo six' },       // Ghost GT
  { cyl: 8, harm: [.66, .26, .16, .6], red: 6800, turbo: .2, el: 0, name: 'V8' },              // Rocket S
  { cyl: 6, harm: [.74, .2, .1, .7], red: 4600, turbo: .3, el: 0, name: 'diesel six' }         // Titan 4x4
];
function vxAudProfile(i) { return VX_AUD_PR[((i | 0) % 12 + 12) % 12] || VX_AUD_PR[0]; }

// ---- buses ---------------------------------------------------------------------------------
const VXAUD_BUS = { master: null, eng: null, env: null, fx: null, ui: null };
function vxAudBus() {
  const c = aud; if (!c) return null;
  if (VXAUD_BUS.master) return VXAUD_BUS;
  const g = () => { const x = c.createGain(); x.gain.value = 0; return x; };
  VXAUD_BUS.master = g(); VXAUD_BUS.master.connect(c.destination);
  VXAUD_BUS.eng = g(); VXAUD_BUS.env = g(); VXAUD_BUS.fx = g(); VXAUD_BUS.ui = g();
  VXAUD_BUS.eng.connect(VXAUD_BUS.master);
  VXAUD_BUS.env.connect(VXAUD_BUS.master);
  VXAUD_BUS.fx.connect(VXAUD_BUS.master);
  VXAUD_BUS.ui.connect(VXAUD_BUS.master);
  return VXAUD_BUS;
}

// ---- shared noise + one reusable voice ------------------------------------------------
function vxAudNoise(c) {
  const n = c.sampleRate * 2, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// One engine voice = 4 harmonics + an exhaust-noise band, all through a lowpass and a panner.
// gain/frequency/pan are the only things that ever change after creation.
function vxAudVoice(i, dest) {
  const c = aud, pr = vxAudProfile(i);
  const out = c.createGain(); out.gain.value = 0;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = .9;
  const pan = c.createStereoPanner ? c.createStereoPanner() : null;
  lp.connect(out);
  if (pan) { out.connect(pan); pan.connect(dest); } else out.connect(dest);
  const h = [];
  for (let k = 0; k < 4; k++) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = pr.el ? 'sine' : k == 0 ? 'sawtooth' : k == 1 ? 'square' : 'sine';
    o.frequency.value = 40 + k * 30;
    g.gain.value = pr.harm[k] * .25;
    o.connect(g); g.connect(lp); o.start();
    h.push({ o, g, r: [1, 2.01, 3.02, .5][k] });
  }
  const ns = c.createBufferSource(); ns.buffer = VXAUD.nbuf; ns.loop = true;
  const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 520; nf.Q.value = .7;
  const ng = c.createGain(); ng.gain.value = 0;
  ns.connect(nf); nf.connect(ng); ng.connect(lp); ns.start();
  return { h, lp, out, pan, nf, ng, pr, level: 0, f: 0 };
}

// Short reusable noise burst (blow-off, crackle, gear click). Four of them, restarted by envelope —
// a stopped BufferSource cannot be restarted, so a permanently looping one with a gain envelope is
// the only allocation-free way to do this.
function vxAudBurstVoice(dest) {
  const c = aud;
  const s = c.createBufferSource(); s.buffer = VXAUD.nbuf; s.loop = true;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 1.2;
  const g = c.createGain(); g.gain.value = 0;
  const pan = c.createStereoPanner ? c.createStereoPanner() : null;
  s.connect(f); f.connect(g);
  if (pan) { g.connect(pan); pan.connect(dest); } else g.connect(dest);
  s.start();
  return { s, f, g, pan };
}

function vxAudEnsure() {
  if (!aud) return null;
  if (VXAUD.ready) return VXAUD;
  const bus = vxAudBus(); if (!bus) return null;
  if (!VXAUD.nbuf) VXAUD.nbuf = (typeof nbuf !== 'undefined' && nbuf) ? nbuf : vxAudNoise(aud);
  // engine (player + the two nearest rivals)
  VXAUD.pv = vxAudVoice(0, bus.eng);
  VXAUD.rv = [vxAudVoice(1, bus.eng), vxAudVoice(2, bus.eng)];
  // blowing-off / crackle / gear-click pool
  VXAUD.bv = [];
  for (let i = 0; i < 4; i++) VXAUD.bv.push(vxAudBurstVoice(bus.fx));
  // continuous environment layers: wind, tyre roll, tyre screech, brake squeal, nitro whoosh
  const mk = (type, f, q, dest) => {
    const s = aud.createBufferSource(); s.buffer = VXAUD.nbuf; s.loop = true;
    const fl = aud.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = aud.createGain(); g.gain.value = 0;
    s.connect(fl); fl.connect(g); g.connect(dest); s.start();
    return { s, fl, g };
  };
  VXAUD.wind = mk('lowpass', 420, .6, bus.env);
  VXAUD.roll = mk('bandpass', 900, .9, bus.env);
  VXAUD.sq = mk('bandpass', 2400, 8, bus.env);
  const bs = aud.createOscillator(); bs.type = 'sine'; bs.frequency.value = 3100;
  const bg = aud.createGain(); bg.gain.value = 0; bs.connect(bg); bg.connect(bus.env); bs.start();
  VXAUD.squeal = { o: bs, g: bg };
  VXAUD.nos = mk('highpass', 2600, .8, bus.fx);
  // turbo whistle: a narrow sine that only a turbo profile raises
  const to = aud.createOscillator(); to.type = 'sine'; to.frequency.value = 3600;
  const tg = aud.createGain(); tg.gain.value = 0; to.connect(tg); tg.connect(bus.eng); to.start();
  VXAUD.whistle = { o: to, g: tg };
  // cockpit lowpass: sits on the engine bus so the interior mix is one filter, not per-voice work
  VXAUD.ready = 1;
  return VXAUD;
}

// ---- per-frame driver ------------------------------------------------------------------------
// Called once per rendered frame with the player, its speed (m/s) and gear/rpm. Everything below is
// arithmetic on preallocated nodes; the only allocation anywhere is the AudioParam automation.
const VXPAN = { x: 0, z: 0 };
function vxAudFrame(p, spd, gear, rpm) {
  if (!aud) return;
  const A = vxAudEnsure(); if (!A || !p) return;
  const t = aud.currentTime;
  // volumes — master scales everything, then each channel its own slider
  const vol = +save.set.vol || 0, ev = save.set.ev == null ? 1 : +save.set.ev;
  const av = save.set.av == null ? 1 : +save.set.av, sv = save.set.sv == null ? 1 : +save.set.sv;
  const b = VXAUD_BUS;
  b.master.gain.setTargetAtTime(vol <= 0 ? 0 : vol, t, .08);
  b.eng.gain.setTargetAtTime(ev, t, .08);
  b.env.gain.setTargetAtTime(av, t, .12);
  b.fx.gain.setTargetAtTime(sv, t, .08);
  b.ui.gain.setTargetAtTime(save.set.uv == null ? .8 : +save.set.uv, t, .08);

  const live = (state == 'race' || state == 'count' || state == 'resume') && !window.VX_SUSPEND;
  const throttle = p.input ? (p.input.t || 0) : 0, brake = p.input ? (p.input.b || 0) : 0;
  const idx = p.def && p.def.i != null ? p.def.i : 0, pr = vxAudProfile(idx);
  const rpmNow = Math.max(0, Math.min(pr.red * 1.06, rpm || 0));
  const kw = { spd: spd, th: throttle, br: brake, rev: Math.min(1, rpmNow / pr.red), live: live, t: t, gear: gear };
  VXAUD.rpm = rpmNow; VXAUD.gear = gear; VXAUD.f0 = rpmNow; VXAUD.revs = kw.rev;
  VXAUD.on = live ? 1 : 0;

  // --- player engine ---
  const V = VXAUD.pv;
  const f = pr.el ? rpmNow * .11 : (rpmNow / 60) * Math.max(1, pr.cyl / 2);
  VXAUD.f0 = f;
  // rev limiter: the fuel cut makes the note stutter, it does not just get louder
  const over = rpmNow / pr.red;
  VXAUD.limit = over > .985 ? 1 : 0;
  const wobble = VXAUD.limit ? (.55 + .45 * Math.sin(t * 62)) : 1;
  const lvl = live ? (.055 + throttle * .075 + kw.rev * .07) * wobble : 0;
  vxAudVoiceSet(V, f, rpmNow, pr, lvl, kw.rev, throttle, 0, t);

  // --- rivals: two nearest, stereo-panned with distance attenuation (doppler from their speed) ---
  const fx = Math.sin(p.h), fz = Math.cos(p.h), rx = fz, rz = -fx;
  let a = null, c2 = null, da = 1e9, dc = 1e9;
  for (let i = 0; i < cars.length; i++) {
    const o = cars[i]; if (o.isP) continue;
    const dx = o.x - p.x, dz = o.z - p.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d < da) { c2 = a; dc = da; a = o; da = d; } else if (d < dc) { c2 = o; dc = d; }
  }
  vxAudRival(VXAUD.rv[0], a, da, p, fx, fz, rx, rz, live, t);
  vxAudRival(VXAUD.rv[1], c2, dc, p, fx, fz, rx, rz, live, t);

  // --- speed-dependent layers ---
  const sp = Math.abs(spd || 0), sn = Math.min(1, sp / 80);
  A.wind.g.gain.setTargetAtTime(live ? (.015 + sn * sn * .22) : 0, t, .18);
  A.wind.fl.frequency.setTargetAtTime(280 + sn * 1500, t, .2);
  const wet = cfg && cfg.wx == 'rain' ? 1 : (typeof W !== 'undefined' && W ? Math.min(1, W.r) : 0);
  const gravel = cfg && (cfg.loc == 1 || cfg.loc == 5) ? 1 : 0;
  const rolf = gravel ? 320 : wet > .4 ? 1350 : 780;
  A.roll.fl.frequency.setTargetAtTime(rolf + sn * 380, t, .25);
  A.roll.g.gain.setTargetAtTime(live ? Math.min(.16, sp / 90 * .13) * (gravel ? 1.5 : 1) : 0, t, .15);
  // tyre screech from the real slip angle (lateral velocity), only when moving
  const slip = Math.min(1, (p.drift || 0) / 7) * Math.min(1, sp / 12);
  A.sq.g.gain.setTargetAtTime(live ? slip * .14 : 0, t, .07);
  A.sq.fl.frequency.setTargetAtTime(1900 + slip * 900, t, .12);
  // brake squeal: low speed, hard pedal, and it fades out the moment you stop
  const sq = live && brake > .3 && sp < 14 && sp > 1 ? Math.min(.05, brake * .05) : 0;
  A.squeal.g.gain.setTargetAtTime(sq, t, .06);
  A.squeal.o.frequency.setTargetAtTime(2700 + Math.random() * 300, t, .04);
  // turbo whistle + blow-off / crackle / gear clicks
  const turbo = vxAudTurbo(A, V, pr, kw, live, t);
  void turbo;
  // nitro whoosh
  A.nos.g.gain.setTargetAtTime(live && p.useN ? .2 : 0, t, .07);
  A.nos.fl.frequency.setTargetAtTime(p.useN ? 2200 : 3200, t, .1);
  VXAUD.gain = lvl;
}

function vxAudVoiceSet(V, f, rpm, pr, lvl, rev, throttle, pan, t) {
  for (let k = 0; k < 4; k++) {
    const h = V.h[k];
    // waveform only changes when the car class changes (electric = pure sines), never per sample
    const ty = pr.el ? 'sine' : k == 0 ? 'sawtooth' : k == 1 ? 'square' : 'sine';
    if (h.t !== ty) { h.t = ty; h.o.type = ty; }
    const target = pr.el ? f * (1 + k * .5) : f * h.r;
    h.o.frequency.setTargetAtTime(Math.max(20, Math.min(12000, target)), t, .035);
    h.g.gain.setTargetAtTime(pr.harm[k] * (pr.el ? .1 : .22), t, .06);
  }
  V.lp.frequency.setTargetAtTime(pr.el ? 3200 + rev * 4200 : 420 + rev * 2600 + throttle * 900, t, .07);
  V.nf.frequency.setTargetAtTime(420 + rev * 2400, t, .06);
  V.ng.gain.setTargetAtTime(pr.el ? .01 : .05 + throttle * .05, t, .06);
  if (V.pan) V.pan.pan.setTargetAtTime(pan, t, .1);
  V.out.gain.setTargetAtTime(lvl, t, .05);
  V.level = lvl; V.f = f;
}

function vxAudRival(V, o, d, p, fx, fz, rx, rz, live, t) {
  if (!V) return;
  if (!o || !live) { vxAudVoiceSet(V, 40, 0, V.pr, 0, 0, 0, 0, t); return; }
  const pr = vxAudProfile(o.def && o.def.i != null ? o.def.i : 0);
  const sp = Math.hypot(o.vx, o.vz), rpm = 1100 + Math.min(1, sp / (o.def && o.def.top ? o.def.top : 70)) * 6200;
  const f = pr.el ? rpm * .11 : (rpm / 60) * Math.max(1, pr.cyl / 2);
  // lateral offset in the player's frame -> pan; distance -> level
  const dx = o.x - p.x, dz = o.z - p.z;
  const lat = dx * rx + dz * rz;
  const pan = Math.max(-1, Math.min(1, lat / 22));
  const lvl = Math.max(0, 1 - Math.hypot(dx, dz) / 90) * .30;
  vxAudVoiceSet(V, f, rpm, pr, lvl, Math.min(1, rpm / pr.red), 1, pan, t);
  // doppler: a passing car is higher on approach and lower once it is behind you
  const rel = (o.vx * dx + o.vz * dz) / (Math.hypot(dx, dz) + .001);
  V.out.gain.setTargetAtTime(lvl * (1 + Math.max(-.25, Math.min(.25, rel / 90))), t, .08);
}

// turbo whistle, blow-off on lift, exhaust crackle and gear-shift clicks
function vxAudTurbo(A, V, pr, kw, live, t) {
  const on = live && pr.turbo > 0 && kw.th > .25 && kw.rev > .45;
  A.whistle.g.gain.setTargetAtTime(on ? .012 * pr.turbo * kw.rev : 0, t, .05);
  A.whistle.o.frequency.setTargetAtTime(2600 + kw.rev * 3200, t, .06);
  if (!live) { vxAudGearSeen(kw); return; }
  // blow-off: throttle lifted, revs still high, turbo car
  const lifted = VXAUD.lastTh > .4 && kw.th < .1;
  if (lifted && pr.turbo > .3 && kw.rev > .35) vxAudBurst(1500, .28, .22 * pr.turbo);
  // exhaust crackle: off throttle at high revs, sporadic
  if (kw.th < .12 && kw.rev > .55 && Math.random() < .12) vxAudBurst(700 + Math.random() * 900, .05, .1);
  // gear change: a click, plus the 120 ms torque cut the mix already reflects through rpm
  if (VXAUD.gearSeen && VXAUD.gearSeen != kw.gear) vxAudBurst(2600, .04, .13);
  VXAUD.gearSeen = kw.gear;
  VXAUD.lastTh = kw.th;
  return 1;
}
function vxAudGearSeen(kw) { VXAUD.gearSeen = kw.gear; VXAUD.lastTh = kw.th; }

let vxAudBi = 0;
function vxAudBurst(f, dur, vol) {
  if (!VXAUD.bv) return;
  const b = VXAUD.bv[vxAudBi++ % VXAUD.bv.length], t = aud.currentTime;
  b.f.frequency.setTargetAtTime(f, t, .01);
  b.g.gain.cancelScheduledValues(t);
  b.g.gain.setTargetAtTime(vol, t, .012);
  b.g.gain.setTargetAtTime(0, t + dur, .06);
}

// ---- compatibility: the old engineSnd(rpmNorm, nitro) call still works ----
engineSnd = function (rpmNorm, nit) {
  if (typeof player === 'undefined' || !player) return;
  const gear = (typeof VXR !== 'undefined' && VXR.gear) || 1;
  const spd = Math.hypot(player.vx || 0, player.vz || 0);
  vxAudFrame(player, spd, gear, 900 + Math.min(1, (rpmNorm || 0) / 6) * 6800);
  if (nit && player.useN) { /* nitro layer is driven by vxAudFrame */ }
};

// ---- mobile unlock / recovery ---------------------------------------------------------------
function vxAudUnlock() {
  try {
    if (!aud) aud = new (window.AudioContext || window.webkitAudioContext)();
    if (aud.state == 'suspended' && aud.resume) aud.resume();
    vxAudEnsure();
  } catch (e) { }
}
// A phone silences the context on a call or a tab switch and never restores it by itself.
if (typeof addEventListener == 'function') {
  ['pointerdown', 'touchstart', 'keydown', 'gamepadconnected'].forEach(ev =>
    addEventListener(ev, vxAudUnlock, { passive: true }));
  addEventListener('visibilitychange', () => {
    if (!aud) return;
    if (document.hidden) { if (aud.suspend) aud.suspend().catch(() => { }); }
    else if (aud.resume) aud.resume().catch(() => { });
  });
}
// called when a race ends: the rival voices must not keep droning into the results screen
function vxAudIdle() {
  if (!VXAUD.ready) return;
  const t = aud.currentTime;
  VXAUD.pv.out.gain.setTargetAtTime(0, t, .08);
  for (const v of VXAUD.rv) v.out.gain.setTargetAtTime(0, t, .08);
  VXAUD.wind.g.gain.setTargetAtTime(0, t, .1);
  VXAUD.roll.g.gain.setTargetAtTime(0, t, .1);
  VXAUD.sq.g.gain.setTargetAtTime(0, t, .1);
  VXAUD.squeal.g.gain.setTargetAtTime(0, t, .1);
  VXAUD.nos.g.gain.setTargetAtTime(0, t, .1);
  VXAUD.whistle.g.gain.setTargetAtTime(0, t, .1);
  VXAUD.on = 0;
}

window.VXAUD = VXAUD;
window.VXAUDAPI = {
  unlock: vxAudUnlock, idle: vxAudIdle, frame: vxAudFrame,
  // read by the automated audio test: measured fundamental (Hz) and engine gain for the current state
  probe() {
    const V = VXAUD.pv;
    return {
      ready: !!VXAUD.ready, on: VXAUD.on, rpm: Math.round(VXAUD.rpm), gear: VXAUD.gear,
      f0: Math.round(VXAUD.f0 * 10) / 10, gain: Math.round((VXAUD.gain || 0) * 10000) / 10000,
      osc: V ? Math.round(V.h[0].o.frequency.value * 10) / 10 : 0,
      lp: V ? Math.round(V.lp.frequency.value) : 0,
      nodes: aud ? 1 : 0
    };
  }
};
