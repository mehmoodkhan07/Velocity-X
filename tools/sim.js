// Headless physics harness: loads the real game scripts (game.js + every extension) in <script> order
// against a tiny DOM stub, so gameplay can be simulated and asserted without a browser.
// usage: node tools/sim.js <scenario>    (run them all with: node tools/simtest.js)
const fs = require('fs'), path = require('path'), vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
const ORDER = [...html.matchAll(/<script src="(js\/[^"?]+)/g)].map(m => m[1]);
const VENDOR = ['vendor/three.min.js', 'vendor/game-core.js'];

// ---------------------------------------------------------------- clock / rAF
let now = 0, rafQ = [];
global.requestAnimationFrame = cb => { rafQ.push(cb); return rafQ.length; };
global.cancelAnimationFrame = () => {};
global.performance = { now: () => now };
global.setInterval = () => 0;
global.devicePixelRatio = 1; global.innerWidth = 1280; global.innerHeight = 720;
global.window = global;
global.location = { href: 'http://localhost/', search: '' };

// ---------------------------------------------------------------- storage
const LS = {};
global.localStorage = {
  getItem: k => (k in LS ? LS[k] : null),
  setItem: (k, v) => { LS[k] = String(v); },
  removeItem: k => { delete LS[k]; },
};

// ---------------------------------------------------------------- DOM stub
const ctxStub = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => {} : undefined)),
  set: (t, k, v) => { t[k] = v; return true; },
});
function classList() {
  const s = new Set();
  return {
    add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c),
    toggle: (c, on) => { const v = on === undefined ? !s.has(c) : !!on; v ? s.add(c) : s.delete(c); return v; },
  };
}
const els = {};
function el() {
  const e = {
    style: {}, dataset: {}, classList: classList(), textContent: '', innerHTML: '', value: '',
    disabled: false, files: [], checked: false, tagName: 'DIV',
    insertAdjacentHTML() {}, appendChild() {}, remove() {}, focus() {}, click() {},
    addEventListener() {}, removeEventListener() {}, setPointerCapture() {},
    getContext: () => ctxStub, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }),
    querySelector: () => el(), querySelectorAll: () => [],
  };
  let next = null, last = null;
  Object.defineProperty(e, 'nextElementSibling', { get: () => (next = next || el()) });
  Object.defineProperty(e, 'previousElementSibling', { get: () => el() });
  Object.defineProperty(e, 'lastElementChild', { get: () => (last = last || el()) });
  Object.defineProperty(e, 'firstElementChild', { get: () => el() });
  return e;
}
const byId = id => (els[id] = els[id] || el());
global.document = {
  getElementById: byId,
  querySelector: () => el(),
  querySelectorAll: () => [],
  createElement: () => el(),
  addEventListener() {}, removeEventListener() {},
  head: el(), body: el(), documentElement: el(),
};
global.navigator = { getGamepads: () => [null], userAgent: 'node', vibrate() {} };
global.Image = class { constructor() { this.onload = null; } set src(v) {} };
global.Audio = class {};
global.Blob = class {}; global.URL = { createObjectURL: () => 'blob:', revokeObjectURL() {} };
global.alert = m => console.log('[alert] ' + m);
global.confirm = () => false;
global.fetch = () => Promise.resolve({ json: () => Promise.resolve([]) });
global.addEventListener = (t, f) => {};
global.removeEventListener = () => {};

// deterministic randomness: traffic / scenery placement is Math.random()-driven, so without a seed
// two runs of the same scenario measure different things and a regression can hide in the noise.
let vxSeed = 0x9e3779b9 | 0;
Math.random = () => { vxSeed ^= vxSeed << 13; vxSeed ^= vxSeed >>> 17; vxSeed ^= vxSeed << 5; return (vxSeed >>> 0) / 4294967296; };

// ---------------------------------------------------------------- load three + stub the GPU
function load(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(root, 'web', rel), 'utf8'), { filename: rel });
}
load('vendor/three.min.js');
if (!global.THREE) throw new Error('three.min.js did not expose THREE');
const REAL = global.THREE;
global.THREE = new Proxy(REAL, {
  get(t, k) {
    if (k === 'WebGLRenderer') {
      return class {
        constructor() { this.shadowMap = {}; }
        setPixelRatio() {} setSize() {} setViewOffset() {} clearViewOffset() {}
        setClearColor() {} dispose() {} render() { this.frames = (this.frames || 0) + 1; }
      };
    }
    return t[k];
  },
});
// VXDBG_WARN=1 prints a stack for every console.warn, so a Three.js warning can be traced to its source
if (process.env.VXDBG_WARN) {
  const w0 = console.warn;
  console.warn = (...a) => { w0(...a); w0('  >> at', (new Error().stack || '').split('\n').slice(2, 6).join(' | ')); };
}
load('vendor/game-core.js');
for (const rel of ORDER) {
  if (rel.endsWith('models.js')) continue;   // needs GLTFLoader + fetch of .glb; physics is unaffected
  load(rel);
}

// ---------------------------------------------------------------- scenarios
// Optional auto-drive: hand the player car to the game's own AI so the physics/systems scenarios are
// not limited by how well a bang-bang keyboard bot can steer. The input path is covered separately
// by the `steer` and `pad` scenarios, which go through the real readInput.
let AUTO = false;
const _stepOuter = step;
step = function (o, dt) { if (AUTO && o.isP) ai(o); return _stepOuter(o, dt); };

const SC = process.argv[2] || 'drive';
const log = [], fails = [];
const ok = (n, c, d) => { log.push((c ? 'PASS ' : 'FAIL ') + n + (d ? '  ' + d : '')); if (!c) fails.push(n); };
const R2 = v => (v == null || !isFinite(v) ? String(v) : +v.toFixed(2));
function frames(n, each) {
  for (let i = 0; i < n; i++) {
    if (each) each(i);
    now += 1000 / 60;
    const q = rafQ; rafQ = [];
    for (const cb of q) cb(now);
  }
}
const adv = (secs, each) => frames(Math.round(secs * 60), each);
function boff(o) {                       // signed lateral offset, without mutating o.idx
  let bi = 0, bd = Infinity;
  for (let i = 0; i < N; i++) { const d = (P[i].x - o.x) ** 2 + (P[i].z - o.z) ** 2; if (d < bd) { bd = d; bi = i; } }
  const n = Nm[bi];
  return (o.x - P[bi].x) * n.x + (o.z - P[bi].z) * n.z;
}
const kmh = o => Math.hypot(o.vx, o.vz) * 3.6;
const dmgMax = o => Math.max(o.dmg.body, o.dmg.engine, o.dmg.aero, o.dmg.tyres);
const msgTxt = () => byId('msg').textContent;

// a keyboard autopilot: steers through keys.KeyA/KeyD, i.e. the real readInput path, and brakes for
// the corners the same way a player has to (binary keys, so it works by bang-bang with a deadband)
function autopilot() {
  const p = player, spd = Math.hypot(p.vx, p.vz);
  const look = Math.min(60, 10 + Math.floor(spd * .6)), ti = (p.idx + look) % N;
  let e = Math.atan2(P[ti].x - p.x, P[ti].z - p.z) - p.h;
  while (e > Math.PI) e -= 6.283; while (e < -Math.PI) e += 6.283;
  keys.KeyA = e > .03 ? 1 : 0;
  keys.KeyD = e < -.03 ? 1 : 0;
  // total bend over the next ~170 m decides whether to lift and brake (never brake from a standstill)
  const a = Tn[p.idx], b = Tn[(p.idx + 45) % N];
  const bend = Math.abs(Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z));
  const brake = bend > .45 && spd > 22;
  keys.KeyS = brake ? 1 : 0;
  keys.KeyW = brake && spd > 30 ? 0 : 1;
}
function start() {
  toMenu();
  startRace({ car: 0, loc: 0, num: 8, diff: 2, laps: 3, wx: 'clear', tod: 'day',
    nitro: true, coll: true, mode: 'race', traffic: 0 });
  frames(60);
}
function untilRace(maxSecs) {                 // countdown is 4 s; never assume an exact frame count
  for (let i = 0; i < (maxSecs || 10) * 60 && state != 'race'; i++) adv(1 / 60);
  return state == 'race';
}

// ---- 1. keyboard steering, both directions, through the shipped input stack ----
if (SC == 'steer') {
  start(); ok('countdown hands over the car', untilRace(), 'state=' + state); keys.KeyW = 1; adv(.3);
  const h0 = player.h, s0 = player.input.s;
  ok('neutral: no steer input', Math.abs(s0) < .05, 's=' + R2(s0));
  keys.KeyA = 1; adv(.25);
  const hL = player.h, sL = player.input.s;
  ok('KeyA -> positive steer input', sL > .8, 's=' + R2(sL));
  ok('KeyA turns the car left (heading increases)', hL > h0, R2(h0) + ' -> ' + R2(hL));
  keys.KeyA = 0; keys.KeyD = 1; adv(.5);
  const hR = player.h, sR = player.input.s;
  ok('KeyD -> negative steer input', sR < -.8, 's=' + R2(sR));
  ok('KeyD turns the car right (heading decreases)', hR < hL, R2(hL) + ' -> ' + R2(hR));
  keys.KeyD = 0; adv(.4);
  ok('release re-centres the wheel', Math.abs(player.input.s) < .1, 's=' + R2(player.input.s));
}

// ---- 2. controller path: stick + analogue triggers, and the horn face button ----
else if (SC == 'pad') {
  start(); untilRace();
  const pad = { id: 'Test Pad', connected: true, axes: [-.85, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
  pad.buttons[7] = { pressed: true, value: 1 };      // RT = throttle
  pad.buttons[1] = { pressed: true, value: 1 };      // B  = horn
  navigator.getGamepads = () => [pad];
  adv(.3);
  ok('pad is detected', VXIN.connected, VXIN.padName);
  ok('RT -> full throttle', player.input.t > .9, 't=' + R2(player.input.t));
  ok('stick left -> positive steer input', player.input.s > .3, 's=' + R2(player.input.s));
  ok('B button fires the horn', /HORN/.test(msgTxt()), JSON.stringify(msgTxt()));
  pad.axes[0] = .85; adv(.3);
  ok('stick right -> negative steer input', player.input.s < -.3, 's=' + R2(player.input.s));
  pad.connected = false; pad.buttons[7] = { pressed: false, value: 0 }; adv(.3);
  ok('unplug falls back to the keyboard', VXIN.connected === false);
}

// ---- 3. full drive: does the car actually race? ----
else if (SC == 'drive') {
  start(); keys.KeyW = 1; AUTO = true;
  let top = 0, wall = 0, nan = false;
  adv(36, () => {
    const k = kmh(player); if (k > top) top = k; if (!isFinite(k)) nan = true;
    if (Math.abs(boff(player)) > 18) wall++;
  });
  ok('no NaN in the car state', !nan);
  ok('car reaches racing speed', top > 150, 'top=' + Math.round(top) + ' km/h');
  ok('car covers ground', player.tot > N * .35, 'tot=' + player.tot + ' of ' + N + ' per lap');
  ok('car stays roughly on the road', wall < 240, wall + ' frames at the barrier');
  ok('tyres wear with use', player.tyre.wear > .05, 'wear=' + R2(player.tyre.wear) + '%');
  ok('tyres heat up with use', player.tyre.temp > 44, 'temp=' + R2(player.tyre.temp));
  ok('fuel is consumed', player.fuel < 19.5, 'fuel=' + R2(player.fuel) + ' L');
  ok('no damage from clean driving', dmgMax(player) < 40, 'dmg=' + R2(dmgMax(player)) + '%');
  ok('rivals were recorded', Object.keys(save.rivals).length > 0, Object.keys(save.rivals).length + ' rivals');
}

// ---- 4. wall contact must not write the car off while it is pinned ----
else if (SC == 'wall') {
  start(); keys.KeyW = 1;                 // no steering: straight into the first barrier
  adv(14);
  ok('car is held by the barrier', Math.abs(boff(player)) > 15, 'off=' + R2(boff(player)));
  ok('pinned car takes no continuous damage', dmgMax(player) < 45, 'dmg=' + R2(dmgMax(player)) + '%');
  const before = dmgMax(player); adv(4);
  ok('sustained scraping is not a death spiral', dmgMax(player) - before < 12, R2(before) + ' -> ' + R2(dmgMax(player)));
}

// ---- 5. horn: audio + grudge + the AI physically gives a side ----
else if (SC == 'horn') {
  start(); keys.KeyW = 1; adv(4, autopilot);
  const o = cars.find(c => !c.isP);
  const fx = Math.sin(player.h), fz = Math.cos(player.h);
  o.x = player.x + fx * 12 + fz * 2; o.z = player.z + fz * 12 - fx * 2;   // dead ahead, 2 m to the player's left
  o.yield = 0;
  const lat0 = (o.x - player.x) * fz - (o.z - player.z) * fx;
  vxHorn();
  const named = save.rivals[o.name];
  ok('horn is heard', /HORN/.test(msgTxt()), JSON.stringify(msgTxt()));
  ok('horned AI is told to yield', o.yield > 0, 'yield=' + R2(o.yield));
  ok('horn builds a grudge', named && named.grudge > 0, named ? 'grudge=' + named.grudge : 'no rival record');
  adv(1.0, autopilot);
  const lat1 = (o.x - player.x) * fz - (o.z - player.z) * fx;
  ok('the car actually gives a side', lat1 - lat0 > 1, 'lateral ' + R2(lat0) + ' -> ' + R2(lat1));
  ok('yield expires', o.yield < 2.4, 'yield=' + R2(o.yield));
}

// ---- 6. nemesis: a grudge changes how the AI drives ----
else if (SC == 'nemesis') {
  start(); keys.KeyW = 1; adv(3, autopilot);
  const o = cars.find(c => !c.isP);
  ai(o);
  const baseT = o.input.t;
  save.rivals[o.name] = { grudge: 90, wins: 0, losses: 0, hits: 0, races: 1 };
  const fx = Math.sin(o.h), fz = Math.cos(o.h);
  o.x = player.x - fx * 10; o.z = player.z - fz * 10;      // nemesis sits behind the player
  ai(o);
  ok('nemesis stays on full throttle', o.input.t > .9, 't=' + R2(baseT) + ' -> ' + R2(o.input.t));
  const rec = save.rivals[o.name];
  ok('rival title escalates to NEMESIS', VXCORE.rivalTitle(rec.grudge) == 'NEMESIS', VXCORE.rivalTitle(rec.grudge));
  ok('rivals persist in the save blob', JSON.parse(JSON.stringify(save)).rivals[o.name].grudge === 90);
  ok('radio taunts are scheduled', VXR.tauntT > 0, 'tauntT=' + R2(VXR.tauntT));
}

// ---- 7. rewind: buffer, charges, time + nitro penalty ----
else if (SC == 'rewind') {
  start(); keys.KeyW = 1; adv(8, autopilot);
  const t0 = raceT, x0 = player.x, z0 = player.z, n0 = player.nit;
  ok('a full race starts with the configured charges', VXR.charges == 3, 'charges=' + VXR.charges);
  ok('the ring buffer fills', VXBUF.length > 80, 'samples=' + VXBUF.length);
  vxRewind();
  ok('rewind spends a charge', VXR.charges == 2, 'charges=' + VXR.charges);
  ok('rewind rolls the race clock back', raceT < t0 - 1.5, R2(t0) + ' -> ' + R2(raceT));
  ok('rewind moves the car back', Math.hypot(player.x - x0, player.z - z0) > 1,
    R2(Math.hypot(player.x - x0, player.z - z0)) + ' m');
  ok('rewind costs nitro', player.nit < n0, R2(n0) + ' -> ' + R2(player.nit));
  ok('rewind is announced', /REWIND/.test(msgTxt()), JSON.stringify(msgTxt()));
  ok('setting off = 0 charges', VXCORE.rewindBudget('off', false) === 0);
  ok('online always disables rewind', VXCORE.rewindBudget('inf', true) === 0);
}

// ---- 8. pit service: tyres, fuel, damage ----
else if (SC == 'pit') {
  start(); keys.KeyW = 1; adv(10, autopilot);
  keys.KeyW = 0; adv(4);                    // coast to a stop
  player.vx = player.vz = 0; player.tyre = { wear: 60, temp: 120 };
  player.dmg = { body: 50, engine: 50, aero: 50, tyres: 50 }; player.fuel = 3;
  vxPit();
  ok('pit service starts', VXR.pitT >= 0, 'pitT=' + R2(VXR.pitT));
  adv(4.5);
  ok('pit rebuilds the tyres', player.tyre.wear < 1, 'wear=' + R2(player.tyre.wear));
  ok('pit refuels the car', player.fuel > 19.9, 'fuel=' + R2(player.fuel));
  ok('pit repairs the damage', dmgMax(player) < 5, 'dmg=' + R2(dmgMax(player)));
  ok('pit service ends', VXR.pitT === -1, 'pitT=' + VXR.pitT);
}

// ---- 9. nitro heat + overheat lock ----
else if (SC == 'nitro') {
  start(); untilRace();
  keys.KeyW = 1; keys.ShiftLeft = 1;
  let maxHeat = 0, sawLock = false, wasUsing = false;
  adv(12, () => {
    autopilot();
    if (player.heat > maxHeat) maxHeat = player.heat;
    if (player.overheat > 0) sawLock = true;
    if (player.useN) wasUsing = true;
  });
  ok('the bottle is actually used', wasUsing, 'wasUsing=' + wasUsing);
  ok('nitro drives the heat gauge up', maxHeat > 20, 'max heat=' + R2(maxHeat));
  ok('a full bottle can overheat', maxHeat >= 99, 'max heat=' + R2(maxHeat));
  ok('overheat locks the bottle', sawLock, 'lock seen=' + sawLock);
  keys.ShiftLeft = 0; adv(6, autopilot);
  ok('heat cools down again', player.heat < 70, 'heat=' + R2(player.heat));
  ok('perfect shift rule is wired', VXCORE.perfectShift(0.95) > 1 && VXCORE.perfectShift(0.5) === 1);
}

// ---- 10. pause -> resume runs a real 3 s countdown ----
else if (SC == 'resume') {
  start(); keys.KeyW = 1; adv(3, autopilot);
  if (state != 'race') untilRace();
  pauseGame();
  ok('pause holds the race', state == 'pause', 'state=' + state);
  resume();
  ok('resume enters the countdown, not the race', state == 'resume', 'state=' + state);
  ok('countdown starts at 3', byId('cd').textContent === '3', 'cd=' + JSON.stringify(byId('cd').textContent));
  const x0 = player.x, z0 = player.z, t0 = raceT;
  adv(1, autopilot);
  ok('car is frozen during the countdown', Math.hypot(player.x - x0, player.z - z0) < .01,
    'moved ' + R2(Math.hypot(player.x - x0, player.z - z0)));
  ok('race clock is frozen too', raceT === t0, R2(t0) + ' -> ' + R2(raceT));
  adv(2.3, autopilot);
  ok('countdown hands the car back', state == 'race', 'state=' + state);
  adv(1, autopilot);
  ok('car drives again after resume', Math.hypot(player.x - x0, player.z - z0) > .5,
    'moved ' + R2(Math.hypot(player.x - x0, player.z - z0)));
}

// ---- 11. the complete controller: every documented button, analogue axes, haptics, hot-unplug ----
else if (SC == 'padfull') {
  start(); untilRace();
  const btns = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  const vibes = [];
  const pad = {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: btns,
    vibrationActuator: { playEffect(type, p) { vibes.push(p); return Promise.resolve('complete'); } }
  };
  navigator.getGamepads = () => [pad];
  keys.KeyW = 0;
  adv(.3);
  ok('pad is detected and identified', VXIN.connected && VXIN.padBrand == 'xbox', VXIN.padName);
  ok('the standard layout maps RT to the throttle', VXIN.map && VXIN.map.accel == 7 && VXIN.map.brake == 6);

  pad.axes[0] = .05; adv(.2);
  ok('stick inside the deadzone does not steer', Math.abs(player.input.s) < .02, 's=' + R2(player.input.s));
  pad.axes[0] = -.8; adv(.35);
  ok('stick left -> positive steer input', player.input.s > .3, 's=' + R2(player.input.s));
  ok('using the pad switches the prompts to controller icons', VXIN.lastDevice == 'gamepad', VXIN.lastDevice);
  pad.axes[0] = .8; adv(.45);
  ok('stick right -> negative steer input', player.input.s < -.3, 's=' + R2(player.input.s));
  pad.axes[0] = 0;

  btns[7] = { pressed: true, value: .45 }; adv(.25);
  ok('half trigger = part throttle', player.input.t > .3 && player.input.t < .85, 't=' + R2(player.input.t));
  btns[7] = { pressed: true, value: 1 }; adv(.2);
  ok('full RT = full throttle', player.input.t > .95, 't=' + R2(player.input.t));
  btns[7] = { pressed: false, value: 0 }; btns[6] = { pressed: true, value: 1 }; adv(.2);
  ok('LT brakes', player.input.b > .9, 'b=' + R2(player.input.b));
  btns[6] = { pressed: false, value: 0 }; btns[7] = { pressed: true, value: 1 }; adv(.2);

  btns[2] = { pressed: true, value: 1 }; adv(.15);
  ok('X/Square = handbrake', player.input.hb == 1, 'hb=' + player.input.hb);
  btns[2] = { pressed: false, value: 0 }; adv(.1);

  btns[0] = { pressed: true, value: 1 }; adv(.2);
  ok('A/Cross = nitro', player.input.n == 1, 'n=' + player.input.n);
  btns[0] = { pressed: false, value: 0 }; adv(.15);

  const cam0 = camMode;
  btns[3] = { pressed: true, value: 1 }; adv(.1); btns[3] = { pressed: false, value: 0 }; adv(.1);
  ok('Y/Triangle changes the camera', camMode != cam0, cam0 + ' -> ' + camMode);

  btns[4] = { pressed: true, value: 1 }; adv(.1);
  ok('LB/L1 looks back', VXIN.lookBack == 1);
  btns[4] = { pressed: false, value: 0 }; adv(.1);
  ok('look back releases', VXIN.lookBack == 0);

  const honks0 = save.honks || 0;
  btns[1] = { pressed: true, value: 1 }; adv(.12);
  ok('B/Circle honks', (save.honks || 0) == honks0 + 1 && /HORN/.test(msgTxt()), JSON.stringify(msgTxt()));
  btns[1] = { pressed: false, value: 0 }; adv(.2);

  btns[9] = { pressed: true, value: 1 }; adv(.12);
  ok('Start/Options pauses', state == 'pause', 'state=' + state);
  btns[9] = { pressed: false, value: 0 }; adv(.15);
  btns[9] = { pressed: true, value: 1 }; adv(.12);
  btns[9] = { pressed: false, value: 0 };
  ok('Start again resumes (countdown)', state == 'resume' || state == 'count' || state == 'race', 'state=' + state);
  untilRace();

  const ch0 = VXR.charges;
  btns[11] = { pressed: true, value: 1 }; adv(.12); btns[11] = { pressed: false, value: 0 }; adv(.1);
  ok('R3 rewinds', VXR.charges == ch0 - 1, ch0 + ' -> ' + VXR.charges);

  btns[8] = { pressed: true, value: 1 }; adv(.12); btns[8] = { pressed: false, value: 0 }; adv(.1);
  ok('Back/Share toggles the minimap', byId('mm').classList.contains('big'));

  keys.KeyW = 1; adv(1.2);
  player.x += 7; player.z += 5;
  btns[5] = { pressed: true, value: 1 }; adv(.12); btns[5] = { pressed: false, value: 0 }; adv(.05);
  ok('RB/R1 puts the car back on the racing line', Math.abs(boff(player)) < 2, 'off=' + R2(boff(player)));

  vibes.length = 0;
  player.x += Nm[player.idx].x * 16; player.z += Nm[player.idx].z * 16;
  adv(.4);
  ok('going off-road vibrates the controller', vibes.length > 0, vibes.length + ' pulses');

  // a pad that only has 6 buttons and no standard mapping must still be driveable
  const gen = { id: 'Generic USB Joystick', mapping: '', connected: true, axes: [0, 0], buttons: Array.from({ length: 6 }, () => ({ pressed: false, value: 0 })) };
  navigator.getGamepads = () => [gen];
  adv(.3);
  ok('a non-standard pad gets the fallback layout', VXIN.map && VXIN.map.accel == 0, JSON.stringify(VXIN.map));
  gen.buttons[0] = { pressed: true, value: 1 }; adv(.25);
  ok('the generic pad still accelerates', player.input.t > .9, 't=' + R2(player.input.t));
  gen.buttons[0] = { pressed: false, value: 0 };

  navigator.getGamepads = () => [pad]; pad.connected = true; keys.KeyW = 0; adv(.3);
  ok('replugging is picked up again', VXIN.connected && VXIN.map.accel == 7);
  pad.connected = false; adv(.8);
  ok('unplugging a controller pauses the race', state == 'pause', 'state=' + state);
  ok('nothing is left holding a button down', player.input.t === 0 && player.input.n === 0,
    't=' + R2(player.input.t) + ' n=' + player.input.n);
}

// ---- 12. on-screen steering wheel: drag, clamp, auto-centre, and the keyboard override ----
else if (SC == 'wheel') {
  start(); untilRace();
  keys.KeyW = 1; adv(1);                       // a stationary car cannot show a heading change
  save.set.steerType = 'wheel'; save.set.wheelOn = 1; save.set.wheelNoCenter = 0;
  VXWHEEL.release(); VXWHEEL.drag(0); VXWHEEL.release(); adv(.25);
  ok('centred wheel = no steering', Math.abs(player.input.s) < .06, 's=' + R2(player.input.s));
  ok('the wheel reports the wheel source', VXTRL.source == 'wheel', VXTRL.source);

  VXWHEEL.drag(225); adv(.4);
  ok('225° (half lock) steers left', player.input.s > .4, 's=' + R2(player.input.s));
  const hL = player.h; adv(.3);
  ok('the car turns left with the wheel', player.h > hL, R2(hL) + ' -> ' + R2(player.h));

  VXWHEEL.drag(-450); adv(.4);
  ok('full lock right steers right', player.input.s < -.8, 's=' + R2(player.input.s));
  VXWHEEL.drag(900);
  ok('the wheel clamps at 450°', VXIN.wheelDeg == 450, VXIN.wheelDeg + '°');

  VXWHEEL.release(); adv(.8);
  ok('releasing auto-centres the wheel', Math.abs(VXIN.wheelDeg) < 60, VXIN.wheelDeg + '°');
  ok('and the steering follows it back', Math.abs(player.input.s) < .2, 's=' + R2(player.input.s));

  save.set.wheelNoCenter = 1; VXWHEEL.drag(180); VXWHEEL.release(); adv(.8);
  ok('"no auto-centre" keeps the angle', VXIN.wheelDeg > 150, VXIN.wheelDeg + '°');
  save.set.wheelNoCenter = 0; VXWHEEL.drag(0); VXWHEEL.release(); adv(.2);

  save.set.wheelOn = 0; adv(.2);
  ok('with the wheel hidden the arrows take over the steering', VXTRL.source == 'wheel');
  VXTOUCH.l = 1; VXTOUCH.r = 0; adv(.3);
  ok('the touch arrows still steer', player.input.s > .3, 's=' + R2(player.input.s));
  VXTOUCH.l = 0; VXTOUCH.r = 1; adv(.5);
  ok('and steer the other way', player.input.s < -.3, 's=' + R2(player.input.s));
  VXTOUCH.r = 0; adv(.3);

  save.set.steerType = 'keyboard'; save.set.wheelOn = 1; adv(.1);
  ok('an explicit keyboard setting overrides the wheel', VXTRL.source == 'keyboard');
  keys.KeyA = 1; adv(.25);
  ok('keyboard still drives', player.input.s > .8, 's=' + R2(player.input.s));
}

// ---- 13. gyro / tilt: calibration, both landscapes, portrait axis, invert ----
else if (SC == 'gyro') {
  start(); untilRace();
  save.set.steerType = 'gyro'; adv(.15);
  ok('the gyro source is selected', VXTRL.source == 'gyro', VXTRL.source);
  VXTRL.tilt(0, 0, 90); VXTRL.calibrate(); adv(.25);
  ok('a level phone in landscape steers straight', Math.abs(player.input.s) < .07, 's=' + R2(player.input.s));
  VXTRL.tilt(25, 0, 90); adv(.4);
  const sL = player.input.s;
  ok('tilting tilts the steering', Math.abs(sL) > .25, 's=' + R2(sL));
  VXTRL.tilt(-25, 0, 90); adv(.5);
  ok('tilting the other way steers the other way', player.input.s * sL < 0, R2(sL) + ' -> ' + R2(player.input.s));
  VXTRL.tilt(0, 0, 270); VXTRL.calibrate(); VXTRL.tilt(25, 0, 270); adv(.4);
  ok('landscape-right keeps the same tilt direction', player.input.s * sL < 0, 's=' + R2(player.input.s));
  VXTRL.tilt(0, 20, 0); VXTRL.calibrate(); adv(.2);
  ok('portrait calibration is neutral again', Math.abs(player.input.s) < .07, 's=' + R2(player.input.s));
  VXTRL.tilt(0, 60, 0); adv(.4);
  ok('portrait steers on the gamma axis', Math.abs(player.input.s) > .5, 's=' + R2(player.input.s));
  save.set.gyroInv = 1; adv(.4);
  ok('invert flips the direction', player.input.s < 0, 's=' + R2(player.input.s));
  save.set.gyroInv = 0;
  ok('auto-detect falls back to the wheel on a touch phone', VXCORE.resolveSteering('auto', { touch: true, gamepad: false }) == 'wheel');
  ok('auto-detect prefers a connected pad', VXCORE.resolveSteering('auto', { touch: true, gamepad: true }) == 'gamepad');
  save.set.steerType = 'auto';
}

// ---- 14. horn: per-car voice, traffic reaction, replay record, stats ----
else if (SC == 'horn2') {
  toMenu();
  startRace({ car: 0, loc: 0, num: 6, diff: 2, laps: 2, wx: 'clear', tod: 'day', nitro: true, coll: true, mode: 'highway', traffic: 2 });
  frames(60); untilRace(); keys.KeyW = 1; adv(2, autopilot);

  ok('four original horn voices are defined', Object.keys(VXHORN.types).length == 4 && VXHORN.order.length == 4,
    VXHORN.order.join(','));
  ok('every voice is synthesised from notes (no samples)', VXHORN.order.every(k => (VXHORN.types[k].notes || []).length >= 2));

  save.cu[sel] = save.cu[sel] || {}; save.cu[sel].horn = 'air';
  const h0 = save.honks || 0;
  vxHorn();
  ok('the horn of the selected car is used', VXHORN.type == 'air', VXHORN.type);
  ok('honks are counted and stored per voice', (save.honks || 0) == h0 + 1 && save.hornT.air > 0,
    'honks=' + save.honks + ' air=' + save.hornT.air);
  ok('the honk is recorded for the replay', VXHORN.events().length > 0 &&
    typeof VXHORN.events()[0].t == 'number' && VXHORN.events()[0].x != null,
    JSON.stringify(VXHORN.events().slice(-1)));
  ok('a ghost achievement tracks the honk stat', ACH.some(a => a[0] == 'horn'));

  const r = TR[0];
  VXHORN.hold(false);                       // release the test honk (a held horn is not re-triggered)
  adv(.45, autopilot);                      // ...and let the anti-spam debounce expire
  r.lane0 = 0; r.lane = 0; r.away = 0; r.s = (player.idx + 2) % N;
  adv(1 / 60);                              // one tick so the traffic car is placed in the world
  const lat0 = r.lane;
  vxHorn();
  ok('traffic in front reacts to the horn', r.away > 0, 'away=' + R2(r.away) + ' dir=' + r.awayDir);
  adv(.5, autopilot);
  ok('the traffic car actually pulls aside', Math.abs(r.lane) - Math.abs(lat0) > 1, 'lane ' + R2(lat0) + ' -> ' + R2(r.lane));
  const awayMax = Math.abs(r.lane);
  adv(3.4, autopilot);
  ok('and eases back into its lane afterwards', Math.abs(r.lane) < awayMax - 3 && Math.abs(r.lane - r.lane0) < 4,
    'lane ' + R2(awayMax) + ' -> ' + R2(r.lane));
}

// ---- 15. AUTO DRIVE: a real AI on the real physics car, plus take-over ----
else if (SC == 'auto') {
  toMenu();
  save.set.autoMode = 'auto';
  startRace({ car: 0, loc: 0, num: 1, diff: 2, laps: 999, wx: 'clear', tod: 'day', nitro: true, coll: true, mode: 'open', traffic: 0 });
  frames(60); untilRace(10);
  ok('Auto engages when the open world starts in Auto mode', VXAUTOAPI.on, 'on=' + VXAUTOAPI.on);
  ok('the AI writes the same input a player would', typeof player.input.t == 'number' && player.input.t > .5, 't=' + R2(player.input.t));
  const xp0 = save.xp;
  let top = 0, offFrames = 0, nan = false, sum = 0, n = 0, stuck = 0;
  adv(300, i => {
    const k = kmh(player); if (k > top) top = k; if (!isFinite(k) || !isFinite(player.x)) nan = true;
    sum += k; n++;
    if (k < 2) stuck++;
    if (i % 6 == 0 && Math.abs(boff(player)) > 18) offFrames++;
    if (process.env.VXDBG_AUTO && i % 60 == 0) console.log('t=' + (i / 60 | 0) + ' spd=' + Math.round(k) + ' off=' + R2(boff(player)) +
      ' lane=' + R2(VXAUTOAPI.stats.lane) + ' resets=' + VXAUTOAPI.stats.resets +
      ' in=' + R2(player.input.t) + '/' + R2(player.input.b) + '/' + R2(player.input.s) + ' idx=' + player.idx);
  });
  ok('no NaN in five minutes of Auto driving', !nan);
  ok('Auto covers real ground', player.tot > N * 2, 'tot=' + Math.round(player.tot) + ' (laps ~' + (player.tot / N).toFixed(1) + ')');
  ok('average speed is racing speed', sum / n > 45, 'avg=' + Math.round(sum / n) + ' km/h  top=' + Math.round(top));
  ok('Auto stays on the road', offFrames < 60, offFrames + ' sampled frames beyond 18 m');
  ok('Auto is never permanently stuck', stuck < 400, stuck + ' frames under 2 km/h');
  ok('recoveries are rare, not routine', VXAUTOAPI.stats.resets < 8, 'resets=' + VXAUTOAPI.stats.resets);
  ok('distance is recorded for the stats', VXAUTOAPI.stats.dist > 1000, VXAUTOAPI.stats.dist + ' m');
  ok('Auto earns XP at the documented 25 % rate', save.xp >= xp0 + 37, 'xp ' + xp0 + ' -> ' + save.xp);
  // instant take-over: any gas input hands control back, and the hand-back is blended over 0.3 s
  keys.KeyW = 1; adv(.2);
  ok('pressing the gas hands control back instantly', !VXAUTOAPI.on, 'on=' + VXAUTOAPI.on);
  ok('the hand-back is blended, not snapped', player.input.t > .3 && player.input.t < 1, 't=' + R2(player.input.t));
  adv(.4);
  ok('the player input is fully live once the blend ends', player.input.t > .95, 't=' + R2(player.input.t));
  keys.KeyW = 0; adv(.3);
  VXAUTOAPI.toggle(); adv(.2);
  ok('T / the button gives the car back to the AI', VXAUTOAPI.on, 'on=' + VXAUTOAPI.on);
  ok('Auto mode and style are saved', save.set.autoMode == 'auto' && !!save.set.autoStyle, save.set.autoMode + '/' + save.set.autoStyle);
  VXAUTOAPI.styleSet('sporty');
  ok('speed styles are applied and persisted', VXAUTOAPI.style == 'sporty' && save.set.autoStyle == 'sporty');
}

// ---- 16. AUTO soak: 30 minutes in traffic with changing weather ----
else if (SC == 'autosoak') {
  toMenu();
  save.set.autoMode = 'auto';
  startRace({ car: 0, loc: 3, num: 1, diff: 2, laps: 999, wx: 'clear', tod: 'day', nitro: true, coll: true, mode: 'open', traffic: 0, dyn: true });
  frames(60); untilRace(10);
  let nan = false, off = 0, cur = 0, worstOff = 0, slow = 0, top = 0, sum = 0, n = 0, tail = 0, tailN = 0;
  let prevHits = 0; const hitCtx = [];
  adv(1800, i => {
    const k = kmh(player);
    if (!isFinite(k) || !isFinite(player.x) || !isFinite(player.z)) nan = true;
    if (k > top) top = k; sum += k; n++;
    if (k < 2) slow++;
    if (i >= 108000 - 300) { tail += k; tailN++; }        // the final 5 s
    const h = VXAUTOAPI.stats.hits;
    if (h > prevHits) { prevHits = h; if (hitCtx.length < 8) hitCtx.push('off=' + R2(boff(player)) + ' lane=' + R2(VXAUTOAPI.stats.lane) + ' kmh=' + Math.round(k)); }
    if (process.env.VXDBG_AUTO && i % 60 == 0 && i < 900) console.log('t=' + (i / 60 | 0) + ' spd=' + Math.round(k) + ' off=' + R2(boff(player)) +
      ' lane=' + R2(VXAUTOAPI.stats.lane) + ' resets=' + VXAUTOAPI.stats.resets + ' in=' + R2(player.input.t) + '/' + R2(player.input.b) + '/' + R2(player.input.s));
    if (i % 10 == 0) {
      const o = Math.abs(boff(player)); if (o > 18) off++;
      if (o > worstOff) worstOff = o;
      cur = o > 17 ? cur + 1 : 0;
    }
  });
  const st = VXAUTOAPI.stats;
  console.log('SOAK dist=' + st.dist + ' m  collisions=' + st.hits + '  resets=' + st.resets +
    '  avg=' + Math.round(sum / n) + ' km/h  top=' + Math.round(top) + '  worstOff=' + R2(worstOff) + ' m' +
    '  offsamples=' + off + '  slow=' + slow + '/108000');
  if (hitCtx.length) console.log('HITS ' + hitCtx.join(' | '));
  ok('30 minutes without a broken simulation', !nan);
  ok('Auto keeps driving the whole soak', st.dist > 20000, st.dist + ' m');
  ok('no long off-road excursions', off < 300, off + ' samples beyond 18 m');
  ok('recoveries stay rare over 30 minutes', st.resets < 40, 'resets=' + st.resets);
  // measured over the last 5 s: sampling a single frame is flaky, because a recovery legitimately
  // re-zeroes the speed for one instant
  ok('the car is still driving at the end', tail / Math.max(1, tailN) > 25, Math.round(tail / Math.max(1, tailN)) + ' km/h avg over the final 5 s');
}

else { console.error('unknown scenario: ' + SC); process.exit(2); }

for (const l of log) console.log(l);
console.log((fails.length ? 'FAILED ' + fails.length : 'OK') + ' - scenario ' + SC);
process.exit(fails.length ? 1 : 0);
