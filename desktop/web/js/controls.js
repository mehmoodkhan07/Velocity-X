// VELOCITY X controls & mobile layer (v0.6)
//   · Steering Type (keyboard / gamepad / touch buttons / on-screen wheel / gyro / auto) — applies instantly
//   · Draggable, multi-touch on-screen steering wheel (±450° -> ±1.0) with auto-centre, skins, size, opacity
//   · Gyro / tilt with iOS permission, CALIBRATE, live preview and automatic fallback to the wheel
//   · Touch HUD layout editor (drag / resize / opacity per control, saved per profile)
//   · Button remapping for keyboard AND controller with conflict detection + reset
//   · Button prompts that follow the last used device, full controller menu navigation
//   · Mobile: fullscreen + landscape lock, wake lock, PWA, battery saver, dynamic resolution, haptics
// All maths lives in packages/game-core/src/input.ts; this file is DOM + gestures + persistence.
const VXB = window.VXCORE;
if (!VXB) throw new Error('[VX] web/vendor/game-core.js missing — run: node packages/game-core/build.js');

save.set = Object.assign({ layout: null, layoutEdit: 0, dynres: 1, battery: 0, pwa: 1, dbg: 0, autoCam: 1 }, save.set);
save.layout = save.layout || null;          // per-profile touch layout
save.set.keys = Object.assign({}, save.set.keys);   // ensure a stable object for remapping

// Positions are percentages of the viewport so the same layout works at 320px and on a tablet.
// v0.8: four buttons only, all under the right thumb (the left thumb owns the wheel, or nothing in tilt
// mode): GAS biggest and lowest, BRAKE beside it, NOS above GAS, HORN above BRAKE.  The speedometer
// owns the bottom centre in landscape; in portrait it is a chip in the top-right column.
const VX_LAYOUT_V = 2;
const VX_LAYOUT_DEF = {
  gas: { x: 88, y: 71, s: 100, o: .55, t: 'GAS' },
  brake: { x: 71, y: 82, s: 86, o: .52, t: 'BRAKE' },
  nitro: { x: 88, y: 46, s: 68, o: .5, t: 'NOS' },
  horn: { x: 73, y: 60, s: 60, o: .46, t: 'HORN' }
};
// a tall screen has room further down and less across: the same cluster, re-spaced
const VX_LAYOUT_PORT = { gas: { x: 84, y: 84 }, brake: { x: 62, y: 90 }, nitro: { x: 86, y: 70 }, horn: { x: 64, y: 77 } };
function vxLayout() {
  // a layout saved before v0.8 still carries HB / CAM / RST / arrows at old spots: start clean
  if (save.layout && save.layoutV !== VX_LAYOUT_V) save.layout = null;
  save.layoutV = VX_LAYOUT_V;
  if (!save.layout) { save.layout = {}; for (const k in VX_LAYOUT_DEF) save.layout[k] = Object.assign({}, VX_LAYOUT_DEF[k]); }
  for (const k in VX_LAYOUT_DEF) if (!save.layout[k]) save.layout[k] = Object.assign({}, VX_LAYOUT_DEF[k]);
  for (const k in save.layout) if (!VX_LAYOUT_DEF[k]) delete save.layout[k];
  return save.layout;
}

// ---------------------------------------------------------------- toast
function vxToast(text) {
  let el = document.getElementById('vxtoast');
  if (!el) {
    document.body.insertAdjacentHTML('beforeend', '<div id="vxtoast"></div>');
    el = document.getElementById('vxtoast');
  }
  if (!el) return;
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(vxToast.t);
  vxToast.t = setTimeout(() => { el.classList.remove('on'); }, 2400);
}

// ---------------------------------------------------------------- DOM: wheel, touch pad, prompts
document.body.insertAdjacentHTML('beforeend',
  '<canvas id="vxwheel" class="hidden"></canvas>' +
  '<div id="vxtch" class="hidden"></div>' +
  '<div id="vxprompt"></div>' +
  '<div id="vxedit" class="hidden"></div>');

const VXW = { canvas: document.getElementById('vxwheel'), down: false, id: null, angle0: 0, deg0: 0, size: 0 };
const VXT = document.getElementById('vxtch');

function vxBuildTouchPad() {
  if (!VXT) return;
  vxTouchRelease();                       // the old nodes are about to vanish: nothing may stay held
  const L = vxLayout();
  // --s is the player's own size; the CSS layer multiplies it by --tb and floors the result at the 48px
  // tap minimum.  Sizing must not go through transform:scale() — that changed the box without a reflow
  // and left the previous raster on screen for a frame, i.e. two copies of every button.
  VXT.innerHTML = Object.keys(L).map(k =>
    `<div class="vxbtn" data-act="${k}" style="--s:${L[k].s};opacity:${L[k].o}">${VX_LAYOUT_DEF[k].t}</div>`).join('');
  VXT.querySelectorAll('.vxbtn').forEach(bindTouchBtn);
  // the default layout follows the screen (portrait / landscape) and the wheel side; a layout the player
  // dragged into place is theirs and is used exactly as saved
  let def = true;
  for (const k in VX_LAYOUT_DEF) {
    const a = L[k], b = VX_LAYOUT_DEF[k];
    if (!a || a.x != b.x || a.y != b.y || a.s != b.s) { def = false; break; }
  }
  VXT.classList.toggle('vxdef', def);
  VXT._def = def; VXT._shape = '';
  vxPlacePad();
}
/** Moves the existing buttons (no rebuild, so a held pedal is never dropped by a rotation). */
function vxPlacePad() {
  if (!VXT) return;
  const L = vxLayout();
  const port = VXT._def && innerHeight > innerWidth;
  const mir = VXT._def && save.set.wheelSide == 'right';
  // tablet portrait keeps the speedo at the bottom centre: BRAKE steps right, clear of it
  const wide = port && innerWidth >= 600;
  const shape = (port ? 'p' : 'l') + (mir ? 'm' : '') + (wide ? 'w' : '');
  if (VXT._shape === shape) return;
  VXT._shape = shape;
  const els = VXT.querySelectorAll('.vxbtn');
  for (let i = 0; i < els.length; i++) {
    const k = els[i].dataset.act, p = wide && k == 'brake' ? { x: 72, y: 91 } : port && VX_LAYOUT_PORT[k] ? VX_LAYOUT_PORT[k] : L[k];
    els[i].style.left = (mir ? 100 - p.x : p.x) + '%';
    els[i].style.top = p.y + '%';
  }
}
addEventListener('resize', () => { if (VXT && VXT._def) vxPlacePad(); });
/** Lets go of every touch control: used on rebuild, when the pad hides, on blur and when the app is backgrounded. */
function vxTouchRelease() {
  if (typeof VXTRL == 'undefined') return;
  for (const k in VXT_ACT) VXTRL.touch[VXT_ACT[k]] = 0;
  if (VXT) { const d = VXT.querySelectorAll('.vxbtn.down'); for (let i = 0; i < d.length; i++) d[i].classList.remove('down'); }
  if (VXT && VXT._horn && typeof vxHornHold == 'function') vxHornHold(false);
  if (VXT) VXT._horn = 0;
  if (VXW.down) { VXW.down = false; VXW.id = null; if (VXW.canvas) VXW.canvas.classList.remove('grab'); if (typeof VXWHEEL != 'undefined') VXWHEEL.release(); }
}
// layout button -> shared input slot (the layout names are readable, the input state is short)
const VXT_ACT = { gas: 't', brake: 'b', nitro: 'n', horn: 'h' };
function bindTouchBtn(el) {
  const act = el.dataset.act;
  const on = e => {
    e.preventDefault();
    if (save.set.layoutEdit) { vxDragStart(el, e); return; }
    if (el.setPointerCapture) try { el.setPointerCapture(e.pointerId); } catch (err) { }
    if (act == 'horn') { if (typeof vxHornHold == 'function') vxHornHold(true); VXT._horn = 1; el.classList.add('down'); return; }
    VXTRL.touch[VXT_ACT[act] || act] = 1; el.classList.add('down');
    if (typeof VXTRL != 'undefined') VXTRL.setLast('touch');
  };
  const off = () => {
    if (!el.classList.contains('down')) return;
    if (act == 'horn') { if (typeof vxHornHold == 'function') vxHornHold(false); VXT._horn = 0; el.classList.remove('down'); return; }
    VXTRL.touch[VXT_ACT[act] || act] = 0; el.classList.remove('down');
  };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
  el.addEventListener('lostpointercapture', off);     // the pad was hidden under the finger
  el.addEventListener('contextmenu', e => e.preventDefault());   // Android long-press must not cancel GAS
}

// ---------------------------------------------------------------- on-screen steering wheel
function vxWheelVisible() {
  if (typeof VXTRL == 'undefined' || !VXTRL.wheelOn()) return false;
  if (typeof state == 'undefined' || (state != 'race' && state != 'count' && state != 'resume')) return false;
  return VXTRL.source == 'wheel';
}
function vxWheelGeom() {
  // clamp to the screen: a 230px wheel is 72% of a 320px phone and used to cover both the road and the
  // brake pedal.  Keep at least 132px so it stays grabbable, and never exceed the player's own setting.
  const vw = innerWidth || 360, vh = innerHeight || 640;
  const cap = Math.max(132, Math.round(Math.min(vw, vh) * (vw < 600 ? .5 : .46)));
  const s = Math.max(132, Math.min(360, save.set.wheelSize | 0, cap));
  const side = save.set.wheelSide == 'left' ? 'left' : 'right';
  return { s, side };
}
function vxDrawWheel() {
  const c = VXW.canvas; if (!c) return;
  const { s } = vxWheelGeom();
  const dpr = Math.min((typeof devicePixelRatio == 'number' ? devicePixelRatio : 1), 2);
  const px = Math.round(s * dpr);
  if (c.width != px) { c.width = c.height = px; c.style.width = c.style.height = s + 'px'; }
  // It is called at 30 Hz, but the picture only changes when the angle, the size, the skin or the
  // opacity change. Clearing and repainting the whole wheel for an identical frame was wasted work
  // that landed in the middle of the render loop.
  const deg0 = (typeof VXIN != 'undefined' ? VXIN.wheelDeg : 0) || 0;
  const opa = save.set.wheelOpacity == null ? .85 : +save.set.wheelOpacity;
  const key = px + '|' + (Math.round(deg0 * 2) / 2) + '|' + (save.set.wheelSkin || '') + '|' + opa;
  if (VXW.paint === key) return;
  VXW.paint = key;
  let g = null;
  try { g = c.getContext('2d'); } catch (e) { return; }
  if (!g) return;
  try {
    const R = px / 2, deg = deg0;
    const skin = { carbon: ['#14181f', '#00E5FF', '#2a3240'], sport: ['#101a26', '#FF6A00', '#1d2b3d'], classic: ['#2a1d12', '#e8c98a', '#4a3620'] }[save.set.wheelSkin] || ['#14181f', '#00E5FF', '#2a3240'];
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, px, px);
    g.translate(R, R);
    g.globalAlpha = Math.max(.15, Math.min(1, opa));
    g.lineWidth = R * .12; g.strokeStyle = skin[0]; g.beginPath(); g.arc(0, 0, R * .84, 0, 6.2832); g.stroke();
    g.lineWidth = R * .03; g.strokeStyle = skin[1]; g.beginPath(); g.arc(0, 0, R * .93, 0, 6.2832); g.stroke();
    g.save(); g.rotate(deg * Math.PI / 180);
    // three spokes + a top marker so the absolute angle is readable
    for (let i = 0; i < 3; i++) {
      g.save(); g.rotate(i * 2.0944);
      g.fillStyle = skin[2]; g.fillRect(-R * .07, 0, R * .14, R * .82);
      g.restore();
    }
    g.fillStyle = skin[1]; g.beginPath(); g.arc(0, -R * .8, R * .07, 0, 6.2832); g.fill();
    g.beginPath(); g.arc(0, 0, R * .3, 0, 6.2832); g.fill();
    g.fillStyle = '#0b1018'; g.beginPath(); g.arc(0, 0, R * .16, 0, 6.2832); g.fill();
    g.restore();
  } catch (e) { /* a canvas that cannot draw must never break the race */ }
}
function vxWheelAngleFromEvent(e) {
  const r = VXW.canvas.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  return Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
}
function vxWheelBind() {
  const c = VXW.canvas; if (!c) return;
  c.addEventListener('pointerdown', e => {
    if (!vxWheelVisible() || save.set.layoutEdit) return;
    e.preventDefault();
    if (typeof VXTRL != 'undefined') VXTRL.setLast('touch');
    VXW.down = true; VXW.id = e.pointerId; VXW.angle0 = vxWheelAngleFromEvent(e);
    VXW.deg0 = VXIN.wheelDeg; VXIN.wheelGrab = true;
    if (c.setPointerCapture) try { c.setPointerCapture(e.pointerId); } catch (err) { }
    c.classList.add('grab');
  });
  c.addEventListener('pointermove', e => {
    if (!VXW.down || e.pointerId !== VXW.id) return;     // one thumb steers, the other can press gas
    e.preventDefault();
    let d = vxWheelAngleFromEvent(e) - VXW.angle0;
    while (d > 180) d -= 360; while (d < -180) d += 360;  // shortest way round the rim
    VXWHEEL.drag(Math.max(-VXB.WHEEL_MAX_DEG, Math.min(VXB.WHEEL_MAX_DEG, VXW.deg0 + d)));
  });
  const up = e => {
    if (!VXW.down || (e && e.pointerId !== VXW.id)) return;
    VXW.down = false; VXW.id = null; c.classList.remove('grab');
    VXWHEEL.release();
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', up);
  c.addEventListener('pointerleave', up);
}
vxWheelBind();

// ---------------------------------------------------------------- gyro / tilt
const VXG = { on: false, granted: false, denied: false, support: false };
function vxOrientAngle() {
  try {
    if (typeof screen != 'undefined' && screen.orientation && typeof screen.orientation.angle == 'number') return screen.orientation.angle;
    if (typeof window != 'undefined' && typeof window.orientation == 'number') return window.orientation;
  } catch (e) { }
  return 0;
}
function vxGyroHandler(e) {
  if (e.beta == null && e.gamma == null) return;
  VXTRL.tilt(e.beta || 0, e.gamma || 0, vxOrientAngle());
  VXG.on = true;
}
async function vxGyroEnable(silent) {
  if (typeof DeviceOrientationEvent == 'undefined') {
    VXG.support = false;
    if (!silent) vxGyroFallback('This device has no motion sensor');
    return false;
  }
  VXG.support = true;
  try {
    if (typeof DeviceOrientationEvent.requestPermission == 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res != 'granted') { VXG.denied = true; vxGyroFallback('Motion permission denied'); return false; }
    }
    addEventListener('deviceorientation', vxGyroHandler);
    VXG.granted = true;
    if (!silent) vxToast('TILT STEERING ON · hold the phone flat, then CALIBRATE');
    return true;
  } catch (e) {
    VXG.denied = true;
    if (!silent) vxGyroFallback('Motion permission was blocked');
    return false;
  }
}
function vxGyroFallback(why) {
  vxToast(why + ' — switching to the on-screen wheel');
  save.set.steerType = 'wheel'; persist();
  VXG.denied = true;
  if (typeof vxmSteerSync == 'function') vxmSteerSync();
  if (typeof showX == 'function' && document.getElementById('xs') && !document.getElementById('xs').classList.contains('hidden')) showX('settings');
}

// ---------------------------------------------------------------- touch layout editor
function vxEditPanel() {
  const el = document.getElementById('vxedit'); if (!el) return;
  if (!save.set.layoutEdit) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = '<b>LAYOUT EDITOR</b> <span>drag a control · tap +/- to resize</span>' +
    '<div id="vxedsize"></div><button class="ghost" onclick="vxLayoutSave()">SAVE</button>' +
    '<button class="ghost" onclick="vxLayoutReset()">RESET</button>' +
    '<button class="ghost" onclick="vxLayoutEdit(0)">DONE</button>';
  const wrap = document.getElementById('vxedsize');
  if (wrap) wrap.innerHTML = Object.keys(vxLayout()).map(k => {
    const L = vxLayout()[k];
    return `<div class="vxer"><span>${L.t}</span><button class="ghost" onclick="vxLayoutResize('${k}',-10)">−</button>` +
      `<i>${L.s}</i><button class="ghost" onclick="vxLayoutResize('${k}',10)">+</button>` +
      `<input type=range min=0.15 max=1 step=0.05 value="${L.o}" onchange="vxLayoutOpacity('${k}',this.value)"></div>`;
  }).join('');
}
function vxLayoutEdit(on) {
  save.set.layoutEdit = on ? 1 : 0;
  vxLayout();
  VXT.classList.toggle('edit', !!on);
  vxEditPanel();
  if (on) vxToast('LAYOUT EDITOR: drag the controls, then SAVE');
  else { persist(); vxBuildTouchPad(); }
}
function vxDragStart(el, e) {
  e.preventDefault();
  const act = el.dataset.act;
  let moved = false;
  const move = ev => {
    const x = Math.max(3, Math.min(97, ev.clientX / innerWidth * 100));
    const y = Math.max(6, Math.min(96, ev.clientY / innerHeight * 100));
    const L = vxLayout()[act]; L.x = Math.round(x); L.y = Math.round(y);
    el.style.left = L.x + '%'; el.style.top = L.y + '%'; moved = true;
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    if (moved) { persist(); vxToast(act.toUpperCase() + ' MOVED'); }
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}
function vxLayoutResize(act, d) {
  const L = vxLayout()[act];
  L.s = Math.max(38, Math.min(150, (L.s | 0) + d));
  persist(); vxBuildTouchPad(); vxEditPanel();
}
function vxLayoutOpacity(act, v) {
  vxLayout()[act].o = Math.max(.15, Math.min(1, +v));
  persist(); vxBuildTouchPad();
}
function vxLayoutSave() { persist(); vxBuildTouchPad(); vxToast('TOUCH LAYOUT SAVED'); }
function vxLayoutReset() {
  save.layout = null; vxLayout(); persist(); vxBuildTouchPad(); vxEditPanel(); vxToast('LAYOUT RESET TO DEFAULT');
}

// ---------------------------------------------------------------- button prompts
function vxPromptRefresh() {
  const el = document.getElementById('vxprompt'); if (!el) return;
  if (!+save.set.promptIcons) { el.innerHTML = ''; return; }
  const dev = typeof VXIN == 'undefined' ? 'keyboard'
    : VXIN.lastDevice == 'gamepad' ? VXB.padPromptSet(VXIN.padBrand)
      : VXIN.lastDevice == 'touch' ? 'touch' : 'keyboard';
  const race = typeof state != 'undefined' && (state == 'race' || state == 'count' || state == 'resume');
  const acts = race ? ['accel', 'brake', 'steer', 'nitro', 'handbrake', 'horn', 'camera', 'pause']
    : ['select', 'back', 'up', 'down'];
  el.innerHTML = acts.map(a => {
    const ic = VXB.promptIcons(dev, a);
    const lbl = { accel: 'GAS', brake: 'BRAKE', steer: 'STEER', nitro: 'NOS', handbrake: 'HB', horn: 'HORN', camera: 'CAM', pause: 'PAUSE', select: 'SELECT', back: 'BACK', up: 'MOVE', down: 'MOVE' }[a] || a;
    return `<span class="vxp"><b>${ic}</b>${lbl}</span>`;
  }).join('');
}
vxPromptRefresh();

// ---------------------------------------------------------------- map toggle (Back / M)
function vxToggleMap() {
  const mm = document.getElementById('mm');
  if (!mm) return;
  mm.classList.toggle('big');
  vxToast(mm.classList.contains('big') ? 'MAP' : 'MAP CLOSED');
}

// ---------------------------------------------------------------- remapping (keyboard + pad)
function vxRemapKey(action) {
  vxToast('PRESS A KEY FOR ' + action.toUpperCase() + '  (Esc cancels)');
  const h = e => {
    e.preventDefault(); e.stopPropagation();
    removeEventListener('keydown', h, true);
    if (e.code == 'Escape') { vxToast('REMAP CANCELLED'); return; }
    const cur = Object.assign({}, save.set.keys);
    const res = VXB.rebind(cur, action, e.code);
    if (res.conflict) { vxToast('ALREADY USED BY ' + res.conflict.toUpperCase()); return; }
    save.set.keys = res.binds; persist(); vxToast(action.toUpperCase() + ' → ' + e.code); showX('settings');
  };
  addEventListener('keydown', h, true);
}
function vxRemapPad(action) {
  vxToast('PRESS A CONTROLLER BUTTON FOR ' + action.toUpperCase());
  let done = false;
  const start = performance.now();
  const tick = () => {
    if (done) return;
    const g = typeof VXIN != 'undefined' ? VXIN.pad : null;
    if (!g) { if (performance.now() - start > 6000) { done = true; vxToast('NO CONTROLLER DETECTED'); } else requestAnimationFrame(tick); return; }
    for (let i = 0; i < g.buttons.length; i++) {
      if (g.buttons[i] && g.buttons[i].pressed) {
        done = true;
        const cur = Object.assign({}, save.set.pad);
        const res = VXB.rebind(cur, action, String(i));
        if (res.conflict) { vxToast('BUTTON ' + i + ' IS ALREADY ' + res.conflict.toUpperCase()); return; }
        cur[action] = i; save.set.pad = cur; save.set.padCustom = 1; persist();
        vxToast(action.toUpperCase() + ' → BUTTON ' + i); showX('settings');
        return;
      }
    }
    if (performance.now() - start > 6000) { done = true; vxToast('REMAP TIMED OUT'); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function vxRemapReset(what) {
  if (what == 'pad') { save.set.pad = Object.assign({}, VXB.PAD_DEFAULT); save.set.padCustom = 0; }
  else save.set.keys = Object.assign({ acc: 'KeyW', brk: 'KeyS', left: 'KeyA', right: 'KeyD', hb: 'Space', nit: 'ShiftLeft', cam: 'KeyC', reset: 'KeyR', horn: 'KeyH', rewind: 'KeyZ', map: 'KeyM', pause: 'Escape', lookBack: 'KeyB', pit: 'KeyF' });
  persist(); vxToast('DEFAULTS RESTORED'); showX('settings');
}

// ---------------------------------------------------------------- controller menu navigation
const VXNAV = { i: -1, t: 0, rep: 0, last: 0 };
function vxNavItems() {
  const screens = ['#menu', '#xs', '#garage', '#pause', '#res', '#splash'];
  let root = null;
  for (const s of screens) {
    const el = document.querySelector(s);
    if (el && !el.classList.contains('hidden')) { root = el; break; }
  }
  if (!root) return [];
  const items = [...root.querySelectorAll('button:not(:disabled), select, input[type=range], input[type=checkbox], .car, .wc')];
  return items.filter(e => {
    if (e.closest('.hidden')) return false;
    if (e.offsetParent === null && !e.getClientRects().length) return typeof e.getBoundingClientRect == 'function' && e.getBoundingClientRect().width > 0;
    return true;
  });
}
function vxNavFocus(idx) {
  const items = vxNavItems();
  if (!items.length) return;
  items.forEach(e => e.classList && e.classList.remove('navfocus'));
  VXNAV.i = (idx + items.length) % items.length;
  const el = items[VXNAV.i];
  if (!el || !el.classList) return;
  el.classList.add('navfocus');
  if (el.scrollIntoView) try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { }
}
function vxNavMove(d) {
  const items = vxNavItems();
  if (!items.length) return;
  vxNavFocus(VXB.navStep(VXNAV.i, items.length, d));
}
function vxNavSelect() {
  const items = vxNavItems();
  if (!items.length) return;
  let el = items[VXNAV.i < 0 ? 0 : VXNAV.i];
  if (!el) return;
  if (el.tagName == 'SELECT') {                       // A on a select cycles its options
    el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (el.type == 'range') { el.value = Math.min(+el.max, +el.value + (+el.step || 1)); el.dispatchEvent(new Event('change', { bubbles: true })); return; }
  if (el.type == 'checkbox') { el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })); return; }
  if (el.click) el.click();
}
function vxNavBack() {
  if (typeof state != 'undefined' && state == 'race') { if (typeof pauseGame == 'function') pauseGame(); return; }
  if (typeof state != 'undefined' && state == 'pause') { if (typeof resume == 'function') resume(); return; }
  const xs = document.getElementById('xs'), gar = document.getElementById('garage');
  if (gar && !gar.classList.contains('hidden')) { if (typeof leaveGarage == 'function') leaveGarage(); return; }
  if (xs && !xs.classList.contains('hidden')) {
    const b = [...xs.querySelectorAll('button')].pop();
    if (b) b.click();
    return;
  }
  if (typeof state != 'undefined' && state == 'done') { const b = document.getElementById('tomenu'); if (b) b.click(); }
}
const VXPADNAV = {};
function vxNavPad(g) {
  if (!g) { VXNAV.i = -1; return; }
  const b = i => !!(g.buttons[i] && g.buttons[i].pressed);
  const map = (typeof VXIN != 'undefined' && VXIN.map) || save.set.pad;
  const edge = (k, on) => { const was = !!VXPADNAV[k]; VXPADNAV[k] = !!on; return on && !was; };
  // Start / Options pauses and resumes from one place only. If the race loop also reacted to it,
  // a single press would pause and resume in the same frame.
  if (edge('start', b(map.pause))) { VXIN.lastDevice = 'gamepad'; if (typeof vxTogglePause == 'function') vxTogglePause(); }
  const inRace = typeof state != 'undefined' && (state == 'race' || state == 'count' || state == 'resume' || state == 'rep');
  if (inRace) return;
  const ax = g.axes[0] || 0, ay = g.axes[1] || 0;
  const now = performance.now();
  const up = b(12) || ay < -.6, dn = b(13) || ay > .6;
  const act = up ? -1 : dn ? 1 : 0;
  if (act && VXB.navRepeatReady(now, VXNAV.last, !!VXNAV.rep)) {
    VXNAV.last = now; VXNAV.rep = 1; VXIN.lastDevice = 'gamepad'; vxNavMove(act);
  }
  if (!act) VXNAV.rep = 0;
  if (edge('a', b(map.nitro))) { VXIN.lastDevice = 'gamepad'; vxNavSelect(); }
  if (edge('b', b(map.horn))) { VXIN.lastDevice = 'gamepad'; vxNavBack(); }
}

// ---------------------------------------------------------------- settings UI
const VX_SETUP = [
  ['steerType', 'Steering Type', [['auto', 'Auto-detect (default)'], ['keyboard', 'Keyboard'], ['gamepad', 'Gamepad'], ['wheel', 'On-screen wheel'], ['gyro', 'Gyro / Tilt']]],
];
// a phone gets exactly two: the on-screen wheel or tilting the phone
const VX_PHONE_STEER = [['wheel', 'Steering wheel (on screen)'], ['gyro', 'Tilt / Gyro (move the phone)']];
const VX_PAD_ACTIONS = { accel: 'Accelerate', brake: 'Brake / Reverse', nitro: 'Nitro', handbrake: 'Handbrake', horn: 'Horn', camera: 'Change camera', lookBack: 'Look back', reset: 'Reset car', pause: 'Pause', map: 'Map', rewind: 'Rewind' };

function vxApplySteerType(v) {
  save.set.steerType = v;
  if (v == 'gyro') { vxGyroEnable(); if (typeof VXIN != 'undefined') VXIN.tiltNeutral = null; }
  persist();
  if (typeof vxmSteerSync == 'function') vxmSteerSync();
  vxToast('STEERING: ' + (v == 'auto' ? 'AUTO (' + (typeof VXTRL != 'undefined' ? VXTRL.source : 'keyboard') + ')' : v == 'gyro' ? 'TILT' : v.toUpperCase()));
}
const _showXCtrl = showX;
showX = function (k) {
  _showXCtrl(k);
  if (k != 'settings' && k != 'controls') return;
  const xs = document.getElementById('xs'); if (!xs) return;
  const panel = xs.querySelector('.panel'); if (!panel) return;
  const back = panel.lastElementChild;
  const sel = (v, l, cur) => `<option value="${v}" ${cur == v ? 'selected' : ''}>${l}</option>`;
  const rng = (label, key, min, max, step, suffix) => `<label>${label}<input type=range min=${min} max=${max} step=${step} value=${save.set[key]} onchange="save.set.${key}=+this.value;persist();vxSettingsRefresh()"> <i>${save.set[key]}${suffix || ''}</i></label>`;
  const chk = (label, key) => `<label class=cbl><input type=checkbox ${+save.set[key] ? 'checked' : ''} onchange="save.set.${key}=+this.checked;persist();vxSettingsRefresh()"> ${label}</label>`;
  const kb = save.set.keys, pad = save.set.pad;
  const phone = typeof VXTRL != 'undefined' && VXTRL.isPhone();
  const steerOpts = phone ? VX_PHONE_STEER : VX_SETUP[0][2];
  const steerCur = phone ? (save.set.steerType == 'gyro' ? 'gyro' : 'wheel') : save.set.steerType;
  const html = `
  <h3>CONTROLS · STEERING TYPE <small>applies instantly</small></h3>
  <label>Steering type<select onchange="vxApplySteerType(this.value)">${steerOpts.map(o => sel(o[0], o[1], steerCur)).join('')}</select></label>
  <div style="color:#5b6678;font-size:11px">Active now: <b id="vxsrc">${typeof VXTRL != 'undefined' ? VXTRL.source : 'keyboard'}</b> · controller: <b id="vxpadst">${VXIN.connected ? VXIN.padName.slice(0, 26) : 'none'}</b></div>
  ${phone ? '' : chk('Show on-screen steering wheel', 'wheelOn')}
  ${chk('Wheel auto-centres when released', 'wheelCenter')}
  ${chk('Wheel: no auto-centre', 'wheelNoCenter')}
  ${chk('Wheel: haptic tick at centre', 'wheelHaptic')}
  <label>Wheel size<input type=range min=120 max=360 step=10 value=${save.set.wheelSize} onchange="save.set.wheelSize=+this.value;persist()"></label>
  <label>Wheel opacity<input type=range min=.15 max=1 step=.05 value=${save.set.wheelOpacity} onchange="save.set.wheelOpacity=+this.value;persist()"></label>
  <label>Wheel side<select onchange="save.set.wheelSide=this.value;persist();vxBuildTouchPad()">${sel('left', 'Left handed (wheel left)', save.set.wheelSide)}${sel('right', 'Right handed (wheel right)', save.set.wheelSide)}</select></label>
  <label>Wheel skin<select onchange="save.set.wheelSkin=this.value;persist()">${sel('carbon', 'Carbon', save.set.wheelSkin)}${sel('sport', 'Sport', save.set.wheelSkin)}${sel('classic', 'Classic', save.set.wheelSkin)}</select></label>

  <h3>CONTROLS · GYRO / TILT</h3>
  ${rng('Sensitivity', 'gyroSens', .3, 3, .1, 'x')}
  ${rng('Deadzone', 'gyroDz', 0, 12, 1, '°')}
  ${rng('Smoothing (low-pass)', 'gyroSmooth', 0, .9, .05)}
  ${chk('Invert tilt', 'gyroInv')}
  <div class="vxgyro"><div id="vxgyrobar"><i></i></div><b id="vxgyrov">0.00</b><span id="vxgyroo">—</span></div>
  <button class=ghost onclick="vxGyroEnable()">ENABLE MOTION</button>
  <button class=ghost onclick="vxCalibrate()">CALIBRATE (hold still)</button>

  <h3>CONTROLS · CONTROLLER</h3>
  ${rng('Stick deadzone', 'padDz', .02, .4, .01)}
  <label>Response curve<select onchange="save.set.padCurve=this.value;persist()">${sel('linear', 'Linear', save.set.padCurve)}${sel('soft', 'Soft (precise centre)', save.set.padCurve)}${sel('aggressive', 'Aggressive', save.set.padCurve)}</select></label>
  ${rng('Steering smoothing', 'padSmooth', 6, 30, 1)}
  ${rng('Trigger deadzone', 'padTrigDz', 0, .3, .01)}
  ${chk('Vibration / haptics', 'vibe')}
  ${rng('Vibration intensity', 'vibeI', 0, 1, .05)}
  <button class=ghost onclick="vxRemapReset('pad')">RESET CONTROLLER LAYOUT</button>

  ${phone ? '' : `<h3>CONTROLS · REMAP — KEYBOARD</h3>
  <div class=vxremap>${Object.keys(VX_PAD_ACTIONS).filter(k => kb[k]).map(k => `<button class=ghost onclick="vxRemapKey('${k}')">${VX_PAD_ACTIONS[k]}<b>${kb[k]}</b></button>`).join('')}</div>
  <button class=ghost onclick="vxRemapReset('key')">RESET KEYBOARD</button>`}

  <h3>CONTROLS · REMAP — CONTROLLER</h3>
  <div class=vxremap>${Object.keys(VX_PAD_ACTIONS).filter(k => pad[k] != null).map(k => `<button class=ghost onclick="vxRemapPad('${k}')">${VX_PAD_ACTIONS[k]}<b>B${pad[k]}</b></button>`).join('')}</div>

  <h3>MOBILE ASSISTS</h3>
  <div class="vxassist"></div>

  <h3>TOUCH HUD LAYOUT</h3>
  <button class=ghost onclick="vxLayoutEdit(${save.set.layoutEdit ? 0 : 1})">${save.set.layoutEdit ? 'STOP EDITING' : 'EDIT TOUCH LAYOUT'}</button>
  <button class=ghost onclick="vxLayoutReset()">RESET TOUCH LAYOUT</button>

  <h3>MOBILE &amp; PERFORMANCE</h3>
  ${chk('Dynamic resolution scaling', 'dynres')}
  ${chk('Battery saver graphics', 'battery')}
  ${chk('FPS / frame-time debug overlay', 'dbg')}
  ${chk('Auto-drive cinematic cameras', 'autoCam')}
  ${chk('Show button prompts', 'promptIcons')}
  <label>Quality preset<select onchange="save.set.q=+this.value;applyQ();persist();vxSettingsRefresh()">${['Low', 'Medium', 'High', 'Ultra', 'Auto (recommended)'].map((n, i) => sel(i, n, save.set.q)).join('')}</select></label>
  <label>Open-world drive mode<select onchange="save.set.autoMode=this.value;persist()">${sel('self', 'Self drive', save.set.autoMode)}${sel('auto', 'Auto drive', save.set.autoMode)}</select></label>
  <label>Auto-drive speed style<select onchange="save.set.autoStyle=this.value;if(typeof VXAUTOAPI!=='undefined')VXAUTOAPI.styleSet(this.value);persist()">${['relaxed', 'normal', 'sporty', 'fast'].map(v => sel(v, v[0].toUpperCase() + v.slice(1), save.set.autoStyle)).join('')}</select></label>
  ${rng('HUD scale', 'hudScale', .8, 1.4, .05)}
  <button class=ghost onclick="vxMobileSetup()">FULLSCREEN + LOCK LANDSCAPE</button>
  <button class=ghost onclick="vxWakeLock()">KEEP SCREEN AWAKE</button>`;
  if (back && back.insertAdjacentHTML) back.insertAdjacentHTML('beforebegin', html);
  else panel.insertAdjacentHTML('beforeend', html);
  vxAssistUI(panel, back);
  vxGyroPreview(panel);
};
/** assists are stored as a nested object, so they get their own block instead of the flat chk() helper */
function vxAssistUI(panel, back) {
  const a = save.set.assists;
  const rows = [['steer', 'Steering assist'], ['tc', 'Traction control'], ['abs', 'ABS'], ['autoBrake', 'Auto-brake'], ['autoAccel', 'Auto-accelerate (one pedal)'], ['stab', 'Stability control']];
  const html = rows.map(([k, l]) => `<label class=cbl><input type=checkbox ${a[k] ? 'checked' : ''} onchange="vxAssist('${k}',this.checked)"> ${l}</label>`).join('');
  const holder = panel.querySelector('.vxassist');
  if (holder) holder.innerHTML = html;
}
function vxAssist(k, on) { save.set.assists[k] = on ? 1 : 0; persist(); vxToast((on ? 'ON · ' : 'OFF · ') + k.toUpperCase()); }
function vxGyroPreview() {
  const bar = document.getElementById('vxgyrobar');
  if (!bar) return;
  VXG.preview = bar;
}
function vxSettingsRefresh() {
  if (typeof showX == 'function' && document.getElementById('xs') && !document.getElementById('xs').classList.contains('hidden')) showX('settings');
}
function vxCalibrate() {
  if (typeof VXTRL == 'undefined') return;
  const n = VXTRL.calibrate();
  vxToast('TILT CALIBRATED · neutral ' + (n == null ? '—' : Math.round(n)) + '°');
}

// ---------------------------------------------------------------- mobile: fullscreen, wake lock, PWA, quality
const VXMOB = { lock: null, ws: null, fs: false };
async function vxMobileSetup() {
  const de = document.documentElement;
  try { if (de && de.requestFullscreen) { await de.requestFullscreen(); VXMOB.fs = true; } } catch (e) { }
  // no forced landscape lock: the HUD has a dedicated portrait shape (see css --tb / #hb chip), so the
  // player keeps the phone the way they are holding it.  Locking also fails outside fullscreen and used
  // to pop a toast over the countdown.
  vxWakeLock();
}
async function vxWakeLock() {
  // a refused wake lock is normal (no permission, background tab, headless) — never cover the HUD with
  // an error toast about a nice-to-have; only a positive result is worth reporting, and only in debug
  try {
    if (navigator.wakeLock && navigator.wakeLock.request) {
      VXMOB.ws = await navigator.wakeLock.request('screen');
      if (+save.set.dbg) vxToast('SCREEN WILL STAY AWAKE');
      VXMOB.ws.addEventListener('release', () => { VXMOB.ws = null; });
    }
  } catch (e) { /* denied: the screen may dim, nothing else breaks */ }
}
function vxReacquireWake() { if (!VXMOB.ws && document.visibilityState == 'visible' && typeof navigator.wakeLock != 'undefined') vxWakeLock(); }
document.addEventListener('visibilitychange', vxReacquireWake);
// PWA: installable + offline cache (only over http(s); file:// has no service workers)
if ('serviceWorker' in navigator && String(location.protocol || '').indexOf('http') == 0 && +save.set.pwa) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
}

// ---------------------------------------------------------------- dynamic resolution
// Resizing the drawing buffer is expensive and visibly flashes the canvas, so the governor only
// ever moves one 0.05 step, waits a full second between changes and never re-applies a value it
// already has. Stepping down is quick (two bad seconds); stepping back up needs eight good ones.
const VXPERF = { n: 0, acc: 0, fps: 60, scale: 1, applied: 0, cool: 0, low: 0, high: 0, ceiling: 1 };
function vxPerfBase() {
  // Auto (q=4) resolves through the same device/GPU probe the renderer boots with, so the governor
  // and the initial pixel ratio can never disagree (that mismatch used to resize the canvas every second)
  if (typeof vxBaseRatio == 'function') return vxBaseRatio();
  const q = save.set.q == null ? 3 : +save.set.q;
  return [.6, .85, 1, Math.min(devicePixelRatio || 1, 1.5)][q] || 1;
}
function vxPerfApply(force) {
  if (typeof renderer == 'undefined' || !renderer || !renderer.setPixelRatio) return;
  const base = vxPerfBase();
  const want = Math.max(.5, Math.round(base * Math.min(VXPERF.scale, VXPERF.ceiling) * 20) / 20);
  if (!force && Math.abs(want - VXPERF.applied) < .049) return;   // same size: do not touch the buffer
  VXPERF.applied = want;
  renderer.setPixelRatio(want);
}
function vxPerfTick(dt) {
  VXPERF.n++; VXPERF.acc += dt;
  if (VXPERF.acc < 1) return;
  const fps = VXPERF.n / VXPERF.acc; VXPERF.n = 0; VXPERF.acc = 0;
  VXPERF.fps = VXPERF.fps ? VXPERF.fps * .5 + fps * .5 : fps;      // smoothed: one hitch must not move it
  if (typeof renderer == 'undefined' || !renderer || !renderer.setPixelRatio) return;
  if (+save.set.battery) { VXPERF.scale = .55; vxPerfApply(); return; }
  if (!+save.set.dynres) { VXPERF.scale = 1; VXPERF.ceiling = 1; vxPerfApply(); return; }
  if (VXPERF.cool > 0) { VXPERF.cool--; return; }
  if (VXPERF.fps < 48 && VXPERF.scale > .5) {
    if (++VXPERF.low >= 2) {
      VXPERF.low = 0; VXPERF.high = 0;
      VXPERF.scale = Math.max(.5, VXPERF.scale - .05);
      VXPERF.ceiling = VXPERF.scale;                                // do not climb back into the bad zone
      VXPERF.cool = 2; vxPerfApply();
    }
  } else if (VXPERF.fps > 58 && VXPERF.scale < VXPERF.ceiling - .001) {
    if (++VXPERF.high >= 8) {
      VXPERF.high = 0; VXPERF.low = 0;
      VXPERF.ceiling = 1;
      VXPERF.scale = Math.min(1, VXPERF.scale + .05);
      VXPERF.cool = 3; vxPerfApply();
    }
  } else { VXPERF.low = 0; VXPERF.high = 0; }
}
VXPERF.applied = typeof renderer != 'undefined' && renderer && renderer.getPixelRatio ? renderer.getPixelRatio() : 0;

// ---------------------------------------------------------------- per-frame UI
let vxUiT = 0, vxUiLast = 0;
function vxUiTick(t) {
  requestAnimationFrame(vxUiTick);
  const dt = Math.min(.1, (t - (vxUiT || t)) / 1000); vxUiT = t;
  vxPerfTick(dt);
  // the wheel, prompts and touch pad only need ~30 Hz; doing their DOM work on every frame was
  // overlapping with the renderer and stealing time from the physics step
  if (t - vxUiLast < 33) return;
  vxUiLast = t;

  const live = typeof state != 'undefined' && (state == 'race' || state == 'count' || state == 'resume');
  // wheel
  if (VXW.canvas) {
    const showW = vxWheelVisible();
    // classList.toggle on an unchanged class still touches the element, and the two style writes below
    // used to happen 30 times a second with the same values: both are now guarded
    if (VXW.wasShow !== showW) { VXW.wasShow = showW; VXW.canvas.classList.toggle('hidden', !showW); }
    if (showW) {
      const g = vxWheelGeom(), c = VXW.canvas;
      if (VXW.gs !== g.s || VXW.gside !== g.side) {
        VXW.gs = g.s; VXW.gside = g.side;
        c.style[g.side] = '16px';
        c.style[g.side == 'left' ? 'right' : 'left'] = 'auto';
        c.style.bottom = '14px';
      }
      vxDrawWheel();
    }
  }
  // touch pad
  if (VXT) {
    const wantTouch = live && (typeof VXTRL != 'undefined') && (VXTRL.isTouch() || +save.set.touch);
    if (VXT._want !== wantTouch) { VXT._want = wantTouch; VXT.classList.toggle('hidden', !wantTouch); if (!wantTouch) vxTouchRelease(); }
  }
  // prompts follow the device
  if (VXPROMPT_LAST != VXIN.lastDevice) { VXPROMPT_LAST = VXIN.lastDevice; vxPromptRefresh(); }
  // scalable UI
  if (vxUiTick.scale != save.set.hudScale) {
    vxUiTick.scale = save.set.hudScale;
    const hud = document.getElementById('hud');
    if (hud && hud.style) hud.style.zoom = Math.max(.8, Math.min(1.4, +save.set.hudScale || 1));
  }
  // gyro preview
  if (VXG.preview) {
    const v = typeof VXIN != 'undefined' ? VXIN.tilt : 0;
    const fill = VXG.preview.querySelector('i');
    if (fill) { fill.style.left = (v < 0 ? 50 + v * 50 : 50) + '%'; fill.style.width = Math.abs(v) * 50 + '%'; }
    const val = document.getElementById('vxgyrov'); if (val) val.textContent = v.toFixed(2);
    const o = document.getElementById('vxgyroo'); if (o) o.textContent = VXIN.tiltOrient.replace('landscape-', 'land-');
  }
  // controller menu navigation (outside the race the race loop is not polling edges)
  const g = typeof VXIN != 'undefined' ? VXIN.pad : null;
  if (g) vxNavPad(g);
  // fullscreen nudge on a phone: start the race fullscreen
  if (!VXMOB.fs && (state == 'race') && vxIsMobileScreen()) { VXMOB.fs = true; vxMobileSetup(); }
}
let VXPROMPT_LAST = null;
function vxIsMobileScreen() {
  try { return innerWidth <= 900 && innerHeight <= 900 && (navigator.maxTouchPoints | 0) > 0; } catch (e) { return false; }
}
requestAnimationFrame(vxUiTick);

// ---------------------------------------------------------------- start
vxBuildTouchPad();
persist();
window.VXCTRL = {
  steerType: vxApplySteerType, gyro: vxGyroEnable, calibrate: vxCalibrate, layout: { edit: vxLayoutEdit, reset: vxLayoutReset, data: vxLayout },
  remapKey: vxRemapKey, remapPad: vxRemapPad, remapReset: vxRemapReset, nav: { move: vxNavMove, select: vxNavSelect, back: vxNavBack, focus: vxNavFocus },
  toast: vxToast, map: vxToggleMap, mobile: vxMobileSetup, wake: vxWakeLock, perf: VXPERF, prompts: vxPromptRefresh
};

// ---------------------------------------------------------------- test / debug bridge
// `state`, `player` and `save` are script-scoped, not properties of window, so the automated browser
// tests would have nothing to assert on. This exposes a small read-only view of the live game.
window.VXDBG = {
  get state() { return typeof state == 'undefined' ? 'none' : state; },
  get save() { return save; },
  get cfg() { return typeof cfg == 'undefined' ? null : cfg; },
  get cam() { return typeof camMode == 'undefined' ? -1 : camMode; },
  get player() {
    if (typeof player == 'undefined' || !player) return null;
    return { x: player.x, z: player.z, spd: player.spd, h: player.h, input: Object.assign({}, player.input || {}) };
  },
  start(extra) {
    toMenu();
    startRace(Object.assign({ car: 0, loc: 0, num: 2, diff: 1, laps: 1, wx: 'clear', tod: 'day', nitro: true, coll: true, mode: 'race', traffic: 0 }, extra || {}));
  },
  menu() { toMenu(); },
  settings() { if (typeof showX == 'function') showX('settings'); },
  // attach the orientation listener the way a granted permission would (used by the browser tests)
  attachGyro() { addEventListener('deviceorientation', vxGyroHandler); VXG.granted = true; return VXG; },
  wheel() {
    const c = document.getElementById('vxwheel');
    return { deg: typeof VXIN == 'undefined' ? 0 : VXIN.wheelDeg, visible: !!c && !c.classList.contains('hidden') };
  },
  input() {
    if (typeof VXIN == 'undefined') return null;
    return { source: typeof vxSteerSource == 'function' ? vxSteerSource() : VXIN.source, last: VXIN.lastDevice, connected: VXIN.connected, pad: VXIN.padName,
      steer: VXIN.steer, throttle: VXIN.throttle, brake: VXIN.brake, tilt: VXIN.tilt, beta: VXIN.tiltBeta, layer: Object.assign({}, VXIN.layer) };
  },
  // measured performance: the acceptance tests read these instead of guessing from the FPS counter
  get perf() {
    return {
      fps: VXSTAT.fps, ms: Math.round(VXSTAT.ms * 100) / 100, p1: VXSTAT.p1, worst: Math.round(VXSTAT.worst * 10) / 10,
      calls: VXSTAT.calls, tris: VXSTAT.tris, pixelRatio: Math.round(VXSTAT.pr * 100) / 100,
      heap: (performance && performance.memory) ? performance.memory.usedJSHeapSize : 0,
      govScale: Math.round(VXPERF.scale * 100) / 100, govCeiling: Math.round(VXPERF.ceiling * 100) / 100,
      restores: typeof VXGL == 'undefined' ? 0 : VXGL.restores
    };
  },
  get audio() { return typeof VXAUDAPI == 'undefined' ? null : VXAUDAPI.probe(); },
  get auto() { return typeof VXAUTOAPI == 'undefined' ? null : VXAUTOAPI.stats; },
  autoSet(on) { if (typeof VXAUTOAPI != 'undefined') VXAUTOAPI.set(on); },
  autoToggle() { if (typeof VXAUTOAPI != 'undefined') VXAUTOAPI.toggle(); },
  get camMode() { return typeof camMode == 'undefined' ? -1 : camMode; },
  setCam(m) { if (typeof camMode != 'undefined') camMode = m | 0; }
};
