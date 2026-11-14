// VELOCITY X mobile layer (v0.8)
//   · Phone steering is exactly two choices, WHEEL or TILT, picked from the main menu or the pause menu
//   · Tilt is re-armed after a reload (iOS needs a tap for the motion permission) and recalibrated each race;
//     no sensor data -> the wheel takes over instead of a car that cannot turn
//   · DOWNLOAD GAME: installs the PWA (Android / desktop Chrome prompt, iPhone "Add to Home Screen" guide);
//     the service worker keeps every file for offline play
//   · A race is paused when the app goes to the background, so a phone call never ends in a wall
// Loads after controls.js; every name here is vxm* / VXPWA so the shared script scope stays collision-free.

const VXPWA = { evt: null, installed: false };

function vxmIsIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints | 0) > 1);
}
function vxmStandalone() {
  try {
    if (navigator.standalone) return true;
    if (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches) return true;
  } catch (e) { }
  return /Electron/i.test(navigator.userAgent || '');
}
function vxmPhone() { return typeof VXTRL != 'undefined' && VXTRL.isPhone(); }

// ---------------------------------------------------------------- DOM
(function vxmBuild() {
  const steer = where => `<div class="vxsteer hidden" data-where="${where}"><span>STEERING</span>` +
    `<button class="ghost" data-st="wheel" onclick="vxmSteer('wheel')">◎ WHEEL</button>` +
    `<button class="ghost" data-st="gyro" onclick="vxmSteer('gyro')">📱 TILT</button></div>`;
  const panel = document.querySelector('#menu .panel');
  if (panel) panel.insertAdjacentHTML('afterbegin', steer('menu'));
  const pinfo = document.getElementById('pinfo');
  if (pinfo) pinfo.insertAdjacentHTML('afterend', steer('pause'));

  const inst = '<button class="vxinst hidden" onclick="vxmInstall()">⬇ DOWNLOAD GAME</button>';
  const start = document.getElementById('start');
  if (start) start.insertAdjacentHTML('afterend', inst);
  const bar = document.querySelector('#menu .top + div');
  if (bar) bar.insertAdjacentHTML('beforeend', inst.replace('class="vxinst', 'class="ghost vxinst'));

  document.body.insertAdjacentHTML('beforeend',
    '<div id="vxinsthelp" class="screen hidden" onclick="if(event.target===this)vxmHelpClose()"><div class="panel">' +
    '<h2>DOWNLOAD VELOCITY X</h2><div id="vxinstbody"></div>' +
    '<button onclick="vxmHelpClose()">GOT IT</button></div></div>');
})();

// ---------------------------------------------------------------- steering chooser (phones only)
function vxmSteer(v) {
  if (typeof vxApplySteerType == 'function') vxApplySteerType(v);
  else { save.set.steerType = v; persist(); }
  vxmSteerSync();
}
function vxmSteerSync() {
  const phone = vxmPhone(), cur = save.set.steerType == 'gyro' ? 'gyro' : 'wheel';
  const rows = document.querySelectorAll('.vxsteer');
  for (let i = 0; i < rows.length; i++) {
    rows[i].classList.toggle('hidden', !phone);
    const b = rows[i].querySelectorAll('button');
    for (let j = 0; j < b.length; j++) b[j].classList.toggle('on', b[j].dataset.st == cur);
  }
}
vxmSteerSync();
addEventListener('resize', () => { clearTimeout(vxmSteerSync.t); vxmSteerSync.t = setTimeout(vxmSteerSync, 300); });

// Tilt after a reload: the listener is gone and iOS only grants motion inside a tap, so the first tap
// anywhere (START ENGINE, START RACE...) re-arms it.  A denied permission falls back to the wheel.
function vxmGyroArm() {
  if (save.set.steerType != 'gyro' || typeof VXG == 'undefined' || VXG.granted || VXG.denied || VXG.arming) return;
  if (!vxmPhone()) return;
  VXG.arming = 1;
  Promise.resolve(vxGyroEnable(true)).catch(() => { }).then(() => { VXG.arming = 0; });
}
addEventListener('click', vxmGyroArm, true);
addEventListener('touchend', vxmGyroArm, true);

// every race starts level: the neutral angle is taken from the first real sample of the new race
const _vxmStart = startRace;
startRace = function (c) {
  if (typeof VXIN != 'undefined') VXIN.tiltNeutral = null;
  VXPWA.raceT = performance.now();
  vxmSteerSync();
  return _vxmStart(c);
};

// ---------------------------------------------------------------- watchdogs (1 Hz, no per-frame cost)
setInterval(() => {
  if (typeof state == 'undefined' || state != 'race' || !vxmPhone() || typeof VXTRL == 'undefined') return;
  // tilt allowed but the phone sends nothing (no gyro, sensor blocked by the browser): steer with the wheel.
  // Not while a permission dialog is still open (granted is false until the player answers it).
  if (VXTRL.source == 'gyro' && typeof VXG != 'undefined' && VXG.granted && !VXG.on && performance.now() - (VXPWA.raceT || 0) > 6000) {
    vxGyroFallback('No tilt data from this phone');
    vxmSteerSync();
  }
}, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && typeof state != 'undefined' && state == 'race' && vxmPhone() && typeof pauseGame == 'function') pauseGame();
});
addEventListener('pagehide', () => { if (typeof vxTouchRelease == 'function') vxTouchRelease(); });

// ---------------------------------------------------------------- install / download
addEventListener('beforeinstallprompt', e => {
  e.preventDefault();               // keep it for our own button instead of the mini-infobar
  VXPWA.evt = e;
  vxmInstallSync();
});
addEventListener('appinstalled', () => {
  VXPWA.installed = true; VXPWA.evt = null;
  vxmInstallSync();
  if (typeof vxToast == 'function') vxToast('VELOCITY X INSTALLED · open it from your home screen');
});
function vxmInstallSync() {
  const hide = VXPWA.installed || vxmStandalone() || String(location.protocol).indexOf('http') != 0;
  const b = document.querySelectorAll('.vxinst');
  for (let i = 0; i < b.length; i++) b[i].classList.toggle('hidden', hide);
}
vxmInstallSync();

async function vxmInstall() {
  if (VXPWA.evt) {
    const e = VXPWA.evt; VXPWA.evt = null;
    try {
      await e.prompt();
      const r = await e.userChoice;
      if (r && r.outcome == 'accepted') { VXPWA.installed = true; if (typeof vxToast == 'function') vxToast('INSTALLING VELOCITY X…'); }
    } catch (err) { vxmHelp(); }
    vxmInstallSync();
    return;
  }
  vxmHelp();
}
async function vxmOfflineReady() {
  try {
    if (!('caches' in window)) return false;
    const keys = await caches.keys();
    for (const k of keys) {
      if (k.indexOf('vx-') != 0) continue;
      const c = await caches.open(k);
      if (await c.match('models/sports.glb', { ignoreSearch: true })) return true;
    }
  } catch (e) { }
  return false;
}
async function vxmHelp() {
  const body = document.getElementById('vxinstbody'), box = document.getElementById('vxinsthelp');
  if (!body || !box) return;
  const ua = navigator.userAgent || '';
  let steps;
  if (vxmIsIOS()) {
    const safari = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    steps = '<p class="sub">iPhone / iPad</p><ol>' +
      (safari ? '' : '<li>Open this page in <b>Safari</b> (or use your browser\'s Share button)</li>') +
      '<li>Tap the <b>Share</b> button <span class="vxico">⬆</span> in the toolbar</li>' +
      '<li>Scroll down and tap <b>Add to Home Screen</b> <span class="vxico">＋</span></li>' +
      '<li>Tap <b>Add</b> — the VELOCITY X icon appears on your home screen</li></ol>';
  } else if (/Android/i.test(ua)) {
    steps = '<p class="sub">Android</p><ol>' +
      '<li>Tap the browser menu <span class="vxico">⋮</span> (top right in Chrome)</li>' +
      '<li>Tap <b>Install app</b> or <b>Add to Home screen</b></li>' +
      '<li>Tap <b>Install</b> — VELOCITY X opens full-screen like any other app</li></ol>';
  } else {
    steps = '<p class="sub">Computer</p><ol>' +
      '<li>Chrome / Edge: click the install icon <span class="vxico">⊕</span> at the right of the address bar</li>' +
      '<li>or open the browser menu and choose <b>Install VELOCITY X</b></li>' +
      '<li>Safari on Mac: <b>File → Add to Dock</b></li></ol>';
  }
  body.innerHTML = steps + '<p class="sub" id="vxoff">Checking offline files…</p>';
  box.classList.remove('hidden');
  const ok = await vxmOfflineReady();
  const off = document.getElementById('vxoff');
  if (off) off.textContent = ok ? '✔ All game files are saved: after installing it plays with no internet.'
    : 'The game files finish downloading in the background while you play this first session.';
}
function vxmHelpClose() { const b = document.getElementById('vxinsthelp'); if (b) b.classList.add('hidden'); }
