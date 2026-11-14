// VELOCITY X device layer (v0.6): ONE shared input state fed by keyboard, gamepad (standard + fallback
// mapping, hot-plug, multiple pads), touch buttons, the on-screen wheel and gyro/tilt.
// Every rule that can be tested lives in packages/game-core/src/input.ts (window.VXCORE); this file only
// does the polling, the DOM and the audio/vibration feedback.
const VXA = window.VXCORE;
if (!VXA) throw new Error('[VX] web/vendor/game-core.js missing — run: node packages/game-core/build.js');

// ---------------------------------------------------------------- persisted settings (old saves keep working)
const VX_KBDEF = {
  acc: 'KeyW', brk: 'KeyS', left: 'KeyA', right: 'KeyD', hb: 'Space', nit: 'ShiftLeft',
  cam: 'KeyC', reset: 'KeyR', horn: 'KeyH', rewind: 'KeyZ', map: 'KeyM', pause: 'Escape', lookBack: 'KeyB', pit: 'KeyF'
};
save.set = Object.assign({
  steerType: 'auto',           // auto | keyboard | gamepad | wheel | gyro  (a phone only offers wheel | gyro)
  padDz: .12, padCurve: 'soft', padSmooth: 14, padTrigDz: .06, padCustom: 0,
  vibe: 1, vibeI: .7,
  wheelOn: 1, wheelSize: 230, wheelOpacity: .85, wheelSide: 'left', wheelSkin: 'carbon',
  wheelCenter: 1, wheelNoCenter: 0, wheelHaptic: 1,
  gyroSens: 1, gyroDz: 3, gyroInv: 0, gyroSmooth: .35,
  promptIcons: 1, hudScale: 1
}, save.set);
save.set.keys = Object.assign({}, VX_KBDEF, save.set.keys);
save.set.pad = Object.assign({}, VXA.PAD_DEFAULT, save.set.pad);
save.set.assists = Object.assign({ steer: 0, tc: 0, abs: 0, autoBrake: 0, autoAccel: 0, stab: 0 }, save.set.assists);

// ---------------------------------------------------------------- state
const VXIN = {
  pad: null, padName: '', padBrand: 'generic', connected: false, padCount: 0, mapping: '', map: null,
  throttle: 0, brake: 0, steer: 0, steerTarget: 0,
  wheelDeg: 0, wheelGrab: false, wheelPrev: 0,
  tiltBeta: 0, tiltGamma: 0, tiltOrient: 'portrait', tiltNeutral: null, tilt: 0,
  lastDevice: 'keyboard', source: 'keyboard', horn: false, rewind: false, lookBack: 0,
  edge: {}, dt: 1 / 60, t: 0, vibeT: 0, kerbT: 0, wheelSide: 1, wasPad: 0, goneT: 0,
  layer: VXA.emptyInput()
};
const VXTOUCH = {};                 // touch buttons: t,b,l,r,n,hb,h,cam,reset (0/1)
const VXPREV = {};                  // edge memory for buttons

// touch capability (a laptop with a touchscreen still counts as a keyboard machine until it is used)
function vxIsTouch() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (navigator.maxTouchPoints | 0) > 0 || /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua);
}
function vxIsMobileUA() {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}
// A phone or a tablet held in the hand: touch, and no fine hovering pointer (an iPad reports a desktop UA,
// a touchscreen laptop reports hover).  Those players get exactly two steering choices: wheel or tilt.
// matchMedia is cheap but this runs every frame, so the answer is cached for two seconds.
const VXPHONE = { v: null, t: -1e9 };
function vxIsPhone() {
  const now = typeof performance != 'undefined' ? performance.now() : 0;
  if (VXPHONE.v != null && now - VXPHONE.t < 2000) return VXPHONE.v;
  let v = false;
  if (vxIsTouch()) {
    if (vxIsMobileUA()) v = true;
    else try { v = !matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) { v = true; }
  }
  VXPHONE.v = v; VXPHONE.t = now;
  return v;
}
/** The wheel is the only non-tilt steering on a phone, so there it can never be switched off. */
function vxWheelOn() { return !!+save.set.wheelOn || vxIsPhone(); }

// ---------------------------------------------------------------- gamepad polling
function vxPadList() {
  let g = null;
  try { g = navigator.getGamepads ? navigator.getGamepads() : null; } catch (e) { g = null; }
  const out = [];
  if (g) for (let i = 0; i < g.length; i++) if (g[i] && g[i].connected) out.push(g[i]);
  return out;
}
function vxBtn(g, i) {
  const b = g && g.buttons ? g.buttons[i] : null;
  if (!b) return 0;
  return typeof b.value === 'number' ? b.value : b.pressed ? 1 : 0;
}
function vxPressed(g, i) { const b = g && g.buttons ? g.buttons[i] : null; return !!(b && b.pressed); }

/** Browsers only guarantee the standard mapping for `mapping === 'standard'`; anything else gets the fallback table. */
function vxPadMap(g) {
  if (!g) return save.set.pad;
  if (g.mapping === 'standard' || +save.set.padCustom) return save.set.pad;
  return VXA.padLayout(g.mapping, g.buttons ? g.buttons.length : 0);
}

/** First connected pad wins; hot-plug toasts + auto-pause happen in the listeners below. */
function vxPollPad(dt) {
  const list = vxPadList();
  const g = list[0] || null;
  if (g !== VXIN.pad) {
    if (g) {
      VXIN.padName = g.id || 'gamepad';
      VXIN.padBrand = VXA.detectPadBrand(g.id);
      VXIN.mapping = g.mapping || '';
      vxPadToast('CONTROLLER · ' + VXA.promptIcons(VXA.padPromptSet(VXIN.padBrand), 'select') + ' ' + (g.id || '').slice(0, 26));
    } else if (VXIN.pad) vxPadToast('CONTROLLER DISCONNECTED');
  }
  VXIN.pad = g; VXIN.connected = !!g; VXIN.padCount = list.length;
  if (!g) {
    VXIN.throttle = VXIN.brake = 0; VXIN.steerTarget = 0;
    // the pad vanished: give it 0.4 s (a sleeping pad can miss a frame), then pause the race — the event
    // listener below is the fast path, this is the fallback for browsers that never fire gamepaddisconnected
    if (VXIN.wasPad) {
      VXIN.goneT = (VXIN.goneT || 0) + (dt || 1 / 60);
      if (VXIN.goneT > .4) {
        VXIN.wasPad = 0; VXIN.goneT = 0;
        vxPadToast('CONTROLLER DISCONNECTED · RACE PAUSED');
        if (typeof state != 'undefined' && state == 'race' && typeof pauseGame == 'function') pauseGame();
      }
    }
    return null;
  }
  VXIN.wasPad = 1; VXIN.goneT = 0;
  const map = VXIN.map = vxPadMap(g), tDz = save.set.padTrigDz, dz = save.set.padDz;
  const raw = (g.axes && g.axes.length ? g.axes[0] : 0) || 0;
  const stick = -VXA.applyDeadzone(raw, dz);                 // stick left (+x in the browser) = left
  VXIN.steerTarget = VXA.steerCurve(stick, save.set.padCurve);
  VXIN.throttle = VXA.triggerValue(vxBtn(g, map.accel), tDz);
  VXIN.brake = VXA.triggerValue(vxBtn(g, map.brake), tDz);
  // any pad activity makes the prompts switch to controller icons
  if (VXIN.throttle > .1 || VXIN.brake > .1 || Math.abs(stick) > .3 || vxAnyPadButton(g)) vxSetLast('gamepad');
  return g;
}
/** true when any button of the pad is held (drives the prompt icons, not gameplay) */
function vxAnyPadButton(g) {
  if (!g || !g.buttons) return false;
  for (let i = 0; i < g.buttons.length; i++) if (vxBtn(g, i) > .5) return true;
  return false;
}
function vxPadToast(text) {
  const el = document.getElementById('msg');
  if (el && (typeof state == 'undefined' || state != 'race')) el.textContent = text;
  if (typeof vxToast == 'function') vxToast(text);
  else if (typeof tone == 'function') tone(880, .08, 'sine', .12);
}
function vxPadEdge(g, key, action) {
  const i = (VXIN.map || save.set.pad)[action];
  if (i == null) return false;
  return vxEdge(key, g ? vxPressed(g, i) : false);
}
function vxEdge(key, on) {
  const was = !!VXPREV[key];
  VXPREV[key] = !!on;
  if (on && !was) { VXIN.edge[key] = 1; return true; }
  return false;
}

// hot-plug: the events are the reliable path; polling above is the fallback for browsers that skip them
if (typeof addEventListener == 'function') {
  addEventListener('gamepadconnected', e => {
    VXIN.pad = null;                                   // force the poll to re-read it
    vxPadToast('CONTROLLER CONNECTED');
    if (typeof tone == 'function') tone(660, .12, 'sine', .16), tone(990, .18, 'sine', .12, .1);
    if (VXIN.autoPaused) VXIN.autoPaused = 0;
    if (e && e.gamepad) VXIN.padName = e.gamepad.id || VXIN.padName;
  });
  addEventListener('gamepaddisconnected', () => {
    vxPadToast('CONTROLLER DISCONNECTED · RACE PAUSED');
    VXIN.autoPaused = 1;
    if (typeof pauseGame == 'function' && typeof state != 'undefined' && state == 'race') pauseGame();
  });
}

// ---------------------------------------------------------------- keyboard
function vxKeyState() {
  const k = keys, m = save.set.keys, on = a => !!k[m[a]];
  return VXA.clampInput({
    steer: (on('left') || k.ArrowLeft ? 1 : 0) - (on('right') || k.ArrowRight ? 1 : 0),
    throttle: on('acc') || k.ArrowUp ? 1 : 0,
    brake: on('brk') || k.ArrowDown ? 1 : 0,
    handbrake: on('hb') ? 1 : 0,
    nitro: on('nit') || !!k.ShiftRight,
    horn: on('horn'), camera: false, reset: false
  });
}
function vxTouchState() {
  const t = n => VXTOUCH[n] || (typeof TC != 'undefined' ? TC[n] : 0) ? 1 : 0;
  return VXA.clampInput({
    steer: t('l') - t('r'), throttle: t('t'), brake: t('b'),
    handbrake: t('hb'), nitro: !!t('n'), horn: !!t('h'), camera: !!t('cam'), reset: !!t('reset')
  });
}

// ---------------------------------------------------------------- steering source + wheel / gyro
function vxSteerSource() {
  const st = save.set.steerType || 'auto';
  if (vxIsPhone()) {
    // a controller paired to the phone still drives; otherwise only the two touch choices exist
    if (VXIN.connected && (st == 'gamepad' || st == 'auto')) return 'gamepad';
    return st == 'gyro' ? 'gyro' : 'wheel';
  }
  if (st == 'auto') return VXA.resolveSteering('auto', { touch: vxIsTouch(), gamepad: VXIN.connected });
  if (st == 'touchbtn') return 'wheel';            // the ◀ ▶ buttons were retired in v0.8
  return st;
}
/** Called by the on-screen wheel widget while the player drags it. */
function vxWheelDrag(deg) {
  VXIN.wheelGrab = true;                     // any drag means the rim is held, so it must not auto-centre
  VXIN.wheelPrev = VXIN.wheelDeg;
  VXIN.wheelDeg = Math.max(-VXA.WHEEL_MAX_DEG, Math.min(VXA.WHEEL_MAX_DEG, deg));
  if (save.set.wheelHaptic && VXA.wheelCenterCrossed(VXIN.wheelPrev, VXIN.wheelDeg)) vxRumble(.18, 26);
}
function vxWheelRelease() { VXIN.wheelGrab = false; }
/** Raw device tilt in, calibrated steering out (used by DeviceOrientationEvent and by the tests). */
function vxTiltSample(beta, gamma, angle) {
  VXIN.tiltBeta = beta; VXIN.tiltGamma = gamma; VXIN.tiltSeen = 1;
  VXIN.tiltOrient = VXA.landscapeFromAngle(angle);
}
function vxTiltCalibrate() {
  VXIN.tiltNeutral = VXA.tiltNeutral(VXIN.tiltBeta, VXIN.tiltGamma, VXIN.tiltOrient);
  VXIN.tilt = 0;
  return VXIN.tiltNeutral;
}

// ---------------------------------------------------------------- one frame of the layer
function vxLayerStep(dt) {
  VXIN.dt = dt = Math.max(0, Math.min(.2, dt || 1 / 60));
  const g = vxPollPad(dt);
  const src = vxSteerSource();
  VXIN.source = src;

  // wheel: auto-centres when the finger is off the rim
  const wheelOn = vxWheelOn();
  if (src == 'wheel' && wheelOn && !VXIN.wheelGrab && !save.set.wheelNoCenter) {
    VXIN.wheelDeg = VXA.wheelAutoCenter(VXIN.wheelDeg, dt, 7);
  }
  // gyro: recalibrate the neutral angle once per race, from a real sample (0/0 before the first event
  // arrives would make "level" whatever angle the phone happened to be at)
  if (src == 'gyro' && VXIN.tiltNeutral == null && VXIN.tiltSeen) vxTiltCalibrate();
  const axis = VXA.tiltAxis(VXIN.tiltBeta, VXIN.tiltGamma, VXIN.tiltOrient);
  const tiltTarget = VXA.tiltToSteer(axis, VXIN.tiltNeutral == null ? axis : VXIN.tiltNeutral, VXIN.tilt, {
    sensitivity: save.set.gyroSens, deadzone: save.set.gyroDz, invert: !!save.set.gyroInv, smoothing: save.set.gyroSmooth
  });
  VXIN.tilt = tiltTarget;

  const kb = vxKeyState(), touch = vxTouchState();
  let steer = kb.steer;
  if (Math.abs(touch.steer) > 0) steer = touch.steer;
  if (src == 'gamepad' && g) steer = VXIN.steerTarget;
  else if (src == 'wheel' && wheelOn) {
    // the arrow keys still work on a touchscreen laptop while nobody is holding the rim
    const w = VXA.wheelAngleToSteer(VXIN.wheelDeg);
    steer = !VXIN.wheelGrab && Math.abs(w) < .01 && kb.steer ? kb.steer : w;
  }
  else if (src == 'gyro') steer = tiltTarget;
  else if (g && Math.abs(VXIN.steerTarget) > .02) steer = VXIN.steerTarget;   // a pad still works when not selected
  VXIN.steerTarget = steer;

  const rate = src == 'wheel' ? 30 : src == 'gyro' ? 40 : (src == 'gamepad' ? save.set.padSmooth : 18);
  VXIN.steer = VXA.steerSmoothing(steer, VXIN.steer, dt, rate);

  const layer = VXA.mergeInput(VXA.mergeInput(kb, touch), VXA.emptyInput());
  if (g) {
    const pm = VXIN.map || save.set.pad;
    layer.throttle = Math.max(layer.throttle, VXIN.throttle);
    layer.brake = Math.max(layer.brake, VXIN.brake);
    layer.handbrake = Math.max(layer.handbrake, vxBtn(g, pm.handbrake) > .5 ? 1 : 0);
    layer.nitro = layer.nitro || vxBtn(g, pm.nitro) > .5;
  }
  layer.steer = VXIN.steer;
  VXIN.layer = VXA.clampInput(layer);

  // held buttons
  const pmap = VXIN.map || save.set.pad;
  const lookPad = g ? vxBtn(g, pmap.lookBack) > .5 : false;
  const lookKey = !!keys[save.set.keys.lookBack];
  VXIN.lookBack = lookPad || lookKey ? 1 : 0;
  VXIN.horn = !!(layer.horn || (g && vxBtn(g, pmap.horn) > .5) || VXTOUCH.h);

  // edges
  if (g) {
    if (vxPadEdge(g, 'cam', 'camera')) vxCycleCamera();
    if (vxPadEdge(g, 'reset', 'reset')) vxResetCar();
    if (vxPadEdge(g, 'rewind', 'rewind')) vxRewindBtn();
    if (vxPadEdge(g, 'map', 'map')) vxMapBtn();
    // Start is handled by the menu-navigation tick (controls.js): two handlers for one press would
    // pause and resume in the same frame.
  }
  // horn is a HOLD: press starts the honk, release stops it (tap = a short beep, see horn.js)
  if (VXIN.horn && !VXPREV.horn) { VXPREV.horn = 1; if (typeof vxHornHold == 'function') vxHornHold(true); }
  else if (!VXIN.horn && VXPREV.horn) { VXPREV.horn = 0; if (typeof vxHornHold == 'function') vxHornHold(false); }
  // kerb / off-road / slide rumble
  if (typeof state != 'undefined' && state == 'race' && player && player.def) {
    const off = vxOffTrack(player);
    VXIN.vibeT -= dt;
    if (Math.abs(off) > 12.2 && VXIN.vibeT <= 0) {
      VXIN.vibeT = .09; vxRumble(Math.min(.5, Math.abs(off) > 18 ? .45 : .22), 70);
      if (vxIsMobileUA() && typeof navigator.vibrate == 'function') navigator.vibrate(12);
    } else if ((player.drift || 0) > 6 && player.input && player.input.hb && VXIN.vibeT <= 0) {
      VXIN.vibeT = .12; vxRumble(.28, 60);
    } else if (player.useN && VXIN.vibeT <= 0) {
      VXIN.vibeT = .1; vxRumble(.2, 55);
    }
  }
}
function vxOffTrack(o) {
  if (typeof P == 'undefined' || !P || !P.length) return 0;
  const i = ((o.idx | 0) % N + N) % N, n = Nm[i];
  return (o.x - P[i].x) * n.x + (o.z - P[i].z) * n.z;
}

// ---------------------------------------------------------------- physics input (replaces readInput)
function vxReadInput(dt) {
  if (!player) return;
  const dtf = dt || VXIN.dt || 1 / 60;
  vxLayerStep(dtf);
  const i = VXIN.layer;
  const assist = save.set.assists, on = k => !!assist[k];
  const any = on('steer') || on('tc') || on('abs') || on('autoBrake') || on('autoAccel') || on('stab');
  let out = { t: i.throttle, b: i.brake, s: clamp(i.steer * (save.set.steer == null ? 1 : save.set.steer), -1, 1), hb: i.handbrake, n: i.nitro ? 1 : 0 };
  if (any) {
    const spd = Math.hypot(player.vx, player.vz), cur = vxCurveAhead();
    out = VXA.applyAssists(
      { steer: out.s, throttle: out.t, brake: out.b, handbrake: out.hb, nitro: !!out.n, horn: false, camera: false, reset: false },
      { speed: spd, slip: player.drift || 0, curvature: cur.bend, steerHint: cur.hint },
      { traction: on('tc'), abs: on('abs'), autoBrake: on('autoBrake'), autoAccel: on('autoAccel'), stability: on('stab'), steerAssist: on('steer') }
    );
    out = { t: out.throttle, b: out.brake, s: out.steer, hb: out.handbrake, n: out.nitro ? 1 : 0 };
  }
  player.input = out;
  if (player.overheat > 0) player.input.n = 0;
}
/** road bend in the next ~150 m + a steer hint toward the centre line, for the assists */
function vxCurveAhead() {
  if (typeof P == 'undefined' || !P || !P.length || !player) return { bend: 0, hint: 0 };
  const look = Math.min(N - 1, 12 + Math.floor(Math.hypot(player.vx, player.vz) * .7));
  const a = Tn[player.idx], b = Tn[(player.idx + look) % N];
  const cross = a.x * b.z - a.z * b.x, dot = a.x * b.x + a.z * b.z;
  const bend = Math.min(1, Math.abs(Math.atan2(cross, dot)) / 1.2);
  const t = P[(player.idx + Math.floor(look / 2)) % N];
  let e = Math.atan2(t.x - player.x, t.z - player.z) - player.h;
  while (e > Math.PI) e -= 6.283; while (e < -Math.PI) e += 6.283;
  return { bend, hint: Math.max(-1, Math.min(1, e * 1.6)) };
}

// ---------------------------------------------------------------- actions shared by pad / touch / keys
function vxCycleCamera() { if (typeof camMode != 'undefined') camMode = (camMode + 1) % (typeof VX_CAMS == 'number' ? VX_CAMS : 3); }
function vxTogglePauseBtn() { if (typeof vxTogglePause == 'function') vxTogglePause(); }
function vxResetCar() {
  if (!player || (typeof state != 'undefined' && state != 'race')) return;
  const i = player.idx;
  player.x = P[i].x; player.z = P[i].z; player.h = Math.atan2(Tn[i].x, Tn[i].z);
  player.vx = player.vz = 0;
  if (typeof msg == 'function') msg('CAR RESET');
}
function vxRewindBtn() { if (typeof vxRewind == 'function') vxRewind(); }
function vxMapBtn() { if (typeof vxToggleMap == 'function') vxToggleMap(); else if (typeof msg == 'function') msg('MAP · MINIMAP TOP RIGHT'); }

// ---------------------------------------------------------------- haptics
/** Dual-rumble on the active pad (scaled by the settings slider) + navigator.vibrate on phones. */
function vxRumble(strong, ms) {
  const on = save.set.vibe == null ? 1 : +save.set.vibe;
  if (!on) return;
  const k = Math.max(0, Math.min(1, save.set.vibeI == null ? .7 : +save.set.vibeI));
  const g = VXIN.pad, act = g && g.vibrationActuator;
  if (act && act.playEffect) {
    try {
      act.playEffect('dual-rumble', {
        duration: Math.max(20, ms || 160), startDelay: 0,
        strongMagnitude: Math.min(1, (strong || .4) * k), weakMagnitude: Math.min(1, (strong || .4) * k * .7)
      }).catch(function () { });
    } catch (e) { /* unsupported — silent */ }
  }
  if (vxIsMobileUA() && typeof navigator.vibrate == 'function' && (ms || 0) > 40) {
    try { navigator.vibrate(Math.min(60, Math.round((ms || 0) * k))); } catch (e) { }
  }
}

// ---------------------------------------------------------------- input-device bookkeeping + prompts
function vxSetLast(dev) {
  if (VXIN.lastDevice == dev) return;
  VXIN.lastDevice = dev;
  if (typeof vxPromptRefresh == 'function') vxPromptRefresh();
}
if (typeof addEventListener == 'function') {
  addEventListener('keydown', () => vxSetLast('keyboard'), true);
  addEventListener('pointerdown', e => vxSetLast(e && e.pointerType == 'mouse' ? 'keyboard' : 'touch'), true);
}

// ---------------------------------------------------------------- public API
readInput = function () { vxReadInput(); };
window.VXIN = VXIN;
window.VXWHEEL = { drag: vxWheelDrag, release: vxWheelRelease, get deg() { return VXIN.wheelDeg; }, set deg(v) { VXIN.wheelDeg = v; } };
window.VXTRL = {
  tilt: vxTiltSample, calibrate: vxTiltCalibrate, get neutral() { return VXIN.tiltNeutral; },
  get steer() { return VXIN.tilt; }, get source() { return vxSteerSource(); },
  isTouch: vxIsTouch, isMobile: vxIsMobileUA, isPhone: vxIsPhone, wheelOn: vxWheelOn,
  rumble: vxRumble, layerStep: vxLayerStep, touch: VXTOUCH, setLast: vxSetLast,
  cycleCamera: vxCycleCamera, resetCar: vxResetCar, offTrack: vxOffTrack, curveAhead: vxCurveAhead
};

// keyboard-only actions that game.js does not already handle
if (typeof addEventListener == 'function') {
  addEventListener('keydown', e => {
    if (e.repeat) return;
    vxSetLast('keyboard');
    const m = save.set.keys;
    if (e.code == m.horn && typeof vxHornHold == 'function') vxHornHold(true);
    if (e.code == m.rewind) vxRewindBtn();
    if (e.code == m.pit && typeof vxPit == 'function') vxPit();
    if (e.code == m.map) vxMapBtn();
    if (e.code == m.lookBack) VXIN.lookBack = 1;
  });
  addEventListener('keyup', e => {
    const m = save.set.keys;
    if (e.code == m.horn && typeof vxHornHold == 'function') vxHornHold(false);
    if (e.code == m.lookBack) VXIN.lookBack = 0;
  });
}

// look-back: flip the camera target around the camera without touching the game loop
if (typeof camera != 'undefined' && camera && typeof camera.lookAt == 'function') {
  const _lookAt = camera.lookAt.bind(camera);
  camera.lookAt = function (x, y, z) {
    if (VXIN.lookBack && typeof state != 'undefined' && state != 'menu') {
      const p = x && x.isVector3 ? x.clone() : new T.Vector3(x, y, z);
      p.set(this.position.x * 2 - p.x, p.y, this.position.z * 2 - p.z);
      return _lookAt(p);
    }
    return _lookAt(x, y, z);
  };
}

// per-frame housekeeping (works outside a race too, e.g. on the menu)
let vxLastT = 0;
function vxDevTick(t) {
  requestAnimationFrame(vxDevTick);
  const dt = Math.min(.1, (t - (vxLastT || t)) / 1000); vxLastT = t;
  if (typeof state != 'undefined' && (state == 'race' || state == 'count' || state == 'resume')) return; // readInput drives it
  vxLayerStep(dt);
}
requestAnimationFrame(vxDevTick);

// HUD buttons (mouse + touch). Hidden with #hud during the race, exactly like the rest of the overlay.
const vxHudHost = document.getElementById('hud') || document.body;
if (vxHudHost && vxHudHost.insertAdjacentHTML) {
  vxHudHost.insertAdjacentHTML('beforeend',
    '<div id="vxkeys"><button id="vxhorn" title="Horn (H / controller B)">HORN</button>' +
    '<button id="vxrw" title="Rewind (Z / controller R3)">REWIND <b>0</b></button></div>');
  const h = document.getElementById('vxhorn'), r = document.getElementById('vxrw');
  if (h) {
    h.addEventListener('pointerdown', e => { e.preventDefault(); if (typeof vxHornHold == 'function') vxHornHold(true); });
    h.addEventListener('pointerup', () => { if (typeof vxHornHold == 'function') vxHornHold(false); });
    h.addEventListener('pointercancel', () => { if (typeof vxHornHold == 'function') vxHornHold(false); });
  }
  if (r) r.onclick = vxRewindBtn;
}
