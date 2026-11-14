// VELOCITY X features (v0.4): elimination mode, daily challenge, lap timing HUD, real pause menu,
// save export/import, and the shared TypeScript rules from packages/game-core.
save.set = Object.assign({ fov: 62, fps: 0 }, save.set);
save.daily = save.daily || {};
const $f = id => document.getElementById(id);
const dayKey = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// ---- shared rules bundle (built by packages/game-core/build.js, loaded as a classic script) ----
const CORE = window.VXCORE || null;
if (!CORE) console.warn('[VX] game-core bundle missing — run: node packages/game-core/build.js');

// ---- menu wiring ----
$f('mode').insertAdjacentHTML('beforeend', '<option value="ko">Elimination (KO)</option>');
document.querySelector('#menu .top').nextElementSibling.insertAdjacentHTML('beforeend', '<button class=ghost onclick="fxDailyStart()">DAILY CHALLENGE</button>');
document.querySelector('#sum').insertAdjacentHTML('afterend', '<div id="dailyc"></div>');
$f('hud').insertAdjacentHTML('beforeend', '<div id="dan"></div>');

const _rm = renderMenu;
renderMenu = function () {
  _rm();
  const el = $f('dailyc'), best = save.daily[dayKey()];
  el.textContent = !CORE ? 'Daily challenge: run "npm run build" in packages/game-core'
    : best && best.bonus ? `Daily challenge ${dayKey()} · cleared in ${fmt(best.t)} · come back tomorrow`
      : `Daily challenge ${dayKey()} · par ${fmt(CORE.dailyChallenge(dayKey()).target)} · one 2500 CR bonus per day`;
  const s = $f('sum'); if (s && s.textContent.includes(' · ko · ')) s.textContent = s.textContent.replace(' · ko · ', ' · ELIMINATION · ');
};

// ---- per-race feature state ----
let KO = { on: false }, FX = { laps: [], best: 0, delta: 0, lastLap: 0, lapStart: 0, top: 0, koT: 0, koNext: 0, out: [], done: 0, eliminated: 0 };

const _sr3 = startRace;
startRace = function (c) {
  const loan = c.daily && !save.owned.includes(c.car);   // the daily gives you a loaner car
  if (loan) save.owned.push(c.car);
  if (c.mode == 'ko') c.num = Math.max(4, c.num | 0);
  _sr3(c);
  if (loan) save.owned = save.owned.filter(i => i !== c.car);
  FX = { laps: [], best: 0, delta: 0, lastLap: 0, lapStart: 0, top: 0, koT: 0, koNext: CORE ? CORE.KO_START : 15, out: [], done: 0, eliminated: 0 };
  KO.on = c.mode == 'ko';
  $f('lapd').textContent = ''; $f('dan').classList.remove('on');
};

// frozen cars (knocked out of a KO race) must stop consuming physics
const _step3 = step;
step = function (o, dt) { if (o.ko) { o.vx = o.vz = 0; return; } _step3(o, dt); };

function koOut(o) {
  o.ko = 1; o.vx = o.vz = 0; o.x = 9999; o.z = 9999;      // park it far away: no collisions, off the minimap
  if (o.mesh) scene.remove(o.mesh);
  FX.out.push(o.name); msg(o.name + ' OUT'); tone(240, .35, 'sawtooth', .22);
}
function endRace() { if (FX.done) return; FX.done = 1; player.fin = raceT; finish(); }

// ---- finish enrichment: KO badge, daily bonus, lap stats ----
const _fin3 = finish;
finish = function () {
  _fin3();
  const rt = $f('rt');
  if (cfg.mode == 'ko') rt.insertAdjacentHTML('afterbegin', '<div class="badge">ELIMINATION</div><div>' + (FX.eliminated ? 'Knocked out in round ' + FX.out.length : 'LAST CAR STANDING') + '</div>');
  if (cfg.daily) {
    const k = cfg.daily, prev = save.daily[k] || {}, t = player.fin == null ? Infinity : player.fin;
    let extra = '';
    if (t <= cfg.dailyTarget && !prev.bonus) { save.credits += 2500; save.xp += 800; prev.bonus = 1; extra = '<div class="badge">PAR BEATEN</div><div>Bonus +2500 CR · +800 XP</div>'; }
    save.daily[k] = { bonus: prev.bonus || 0, t: Math.min(prev.t || Infinity, t) };
    persist();
    rt.insertAdjacentHTML('afterbegin', `<div class="badge">DAILY CHALLENGE</div><div>par ${fmt(cfg.dailyTarget)} · you ${player.fin == null ? 'DNF' : fmt(player.fin)}</div>` + extra);
  }
  rt.insertAdjacentHTML('afterbegin', `<div class="rtstats"><div>BEST LAP<b>${FX.best ? fmt(FX.best) : '--'}</b></div><div>TOP SPEED<b>${Math.round(FX.top)} km/h</b></div><div>LAPS DONE<b>${FX.laps.length}</b></div><div>MODE<b>${(cfg.mode || 'race').toUpperCase()}</b></div></div>`);
};

// ---- pause menu ----
function pauseGame() {
  if (state != 'race') return;
  state = 'pause';
  $f('pinfo').innerHTML = `${LOCS[cfg.loc]} · ${(cfg.mode || 'race').toUpperCase()}<br>TIME ${fmt(raceT)} · LAP ${clamp(Math.floor(player.tot / N) + 1, 1, cfg.laps)}/${cfg.laps} · BEST ${FX.best ? fmt(FX.best) : '--'}`;
  $f('pause').classList.remove('hidden');
}
$f('pb').onclick = () => state == 'pause' ? resume() : pauseGame();
$f('prestart').onclick = () => { $f('pause').classList.add('hidden'); startRace(Object.assign({}, cfg)); };
$f('pset').onclick = () => showX('settings');
addEventListener('keydown', e => {
  if (e.code == 'KeyP') { e.preventDefault(); if (state == 'race') pauseGame(); else if (state == 'pause') resume(); }
  if (e.code == 'Enter' && state == 'done') { e.preventDefault(); $f('retry').click(); }
});

// ---- quit wrapper: clear feature overlays ----
const _q3 = quit;
quit = function () { $f('dan').classList.remove('on'); $f('pause').classList.add('hidden'); $f('lapd').textContent = ''; _q3(); };
$f('quit').onclick = quit; $f('tomenu').onclick = quit;

// ---- daily challenge ----
function fxDailyStart() {
  if (!CORE) { alert('The daily challenge needs the shared rules bundle.\nRun:  cd packages/game-core  &&  npm run build'); return; }
  const d = CORE.dailyChallenge(dayKey());
  startRace({ car: d.car, loc: d.loc, num: 8, diff: d.diff, laps: d.laps, wx: d.wx, tod: d.tod, nitro: true, coll: true, mode: 'race', traffic: 1, daily: d.day, dailyTarget: d.target });
}

// ---- save export / import ----
function fxExport() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' }));
  a.download = 'velocity-x-save-' + dayKey() + '.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function fxImport(file) {
  const r = new FileReader();
  r.onload = () => {
    let d; try { d = JSON.parse(String(r.result)); } catch (e) { return alert('That file is not valid JSON.'); }
    if (!d || typeof d != 'object' || !Array.isArray(d.owned)) return alert('That file is not a VELOCITY X save.');
    ['credits', 'xp', 'wins', 'races', 'podiums', 'topSpeed', 'owned', 'up', 'cu', 'ach', 'rec', 'nm', 'dbest', 'champs', 'ghosts', 'daily'].forEach(k => { if (d[k] !== undefined) save[k] = d[k]; });
    if (CORE && CORE.migrateSave) save = Object.assign(save, CORE.migrateSave(save));
    save.set = Object.assign({ q: 3, vol: .6, mph: 0, steer: 1, fov: 62, fps: 0 }, save.set);
    persist(); applyUp(); renderMenu(); alert('Save imported · ' + save.credits + ' CR · level ' + lvl());
  };
  r.readAsText(file);
}

// ---- settings additions ----
const _sx3 = showX;
showX = function (k) {
  _sx3(k); if (k != 'settings') return;
  const panel = $f('xs').querySelector('.panel'), back = panel.lastElementChild;
  back.insertAdjacentHTML('beforebegin',
    `<h3>CAMERA &amp; DISPLAY</h3>
 <label>Field of view<input type=range min=50 max=85 step=1 value=${save.set.fov} onchange="save.set.fov=+this.value;persist()"></label>
 <label><input type=checkbox ${save.set.fps ? 'checked' : ''} onchange="save.set.fps=+this.checked;persist()"> Show FPS counter</label>
 <h3>SAVE DATA</h3>
 <button class=ghost onclick="fxExport()">EXPORT SAVE (.json)</button>
 <button class=ghost onclick="$f('impf').click()">IMPORT SAVE</button>
 <input type=file id=impf accept="application/json,.json" onchange="if(this.files[0])fxImport(this.files[0])">
 <div style="color:#5b6678;font-size:11px;margin-top:10px">Progress is stored in this browser. Export it before clearing site data.</div>`);
};

// ---- per-frame: lap timing, KO schedule, FPS ----
let fpsN = 0, fpsA = 0, fpsV = 0;
function fxTick(t) {
  requestAnimationFrame(fxTick);
  const dt = Math.min((t - (fxTick.l || t)) / 1000, .1); fxTick.l = t;
  fpsN++; fpsA += dt; if (fpsA >= .5) { fpsV = Math.round(fpsN / fpsA); fpsN = 0; fpsA = 0; }
  const ft = $f('fps'), ftx = save.set.fps && !$f('hud').classList.contains('hidden') ? fpsV + ' FPS' : '';
  if (ft.textContent != ftx) ft.textContent = ftx;
  if (!cfg || !player || !cars.length || state != 'race') return;

  FX.top = Math.max(FX.top, player.spd * 3.6);

  const li = Math.floor(player.tot / N);
  if (li > FX.lastLap && li > 0) {
    const lt = raceT - FX.lapStart; FX.lapStart = raceT; FX.lastLap = li;
    FX.delta = FX.best ? lt - FX.best : 0;
    if (!FX.best || lt < FX.best) FX.best = lt;
    FX.laps.push(lt);
    tone(760, .12, 'sine', .12);
  }
  const lapTxt = FX.laps.length
    ? `LAST ${fmt(FX.laps[FX.laps.length - 1])} · BEST ${fmt(FX.best)}`
      + (FX.delta ? ` <b class="${FX.delta > 0 ? 'up' : 'dn'}">${FX.delta > 0 ? '+' : '−'}${Math.abs(FX.delta).toFixed(2)}</b>` : '')
    : '';
  if ($f('lapd').innerHTML != lapTxt) $f('lapd').innerHTML = lapTxt;

  if (!KO.on || FX.eliminated) return;
  const alive = cars.filter(o => !o.ko && !o.fin);
  FX.koT += dt;
  $f('xhud').textContent = `KO · ${alive.length} LEFT · NEXT OUT IN ${Math.max(0, Math.ceil(FX.koNext - FX.koT))}s`;
  const trailing = alive.length > 1 && alive.reduce((a, b) => (a.tot <= b.tot ? a : b)).isP;   // you are about to go out
  $f('dan').classList.toggle('on', trailing && FX.koNext - FX.koT < 5);
  if (alive.length <= 1) { if (alive[0] && alive[0].isP) { msg('LAST CAR STANDING'); endRace(); } return; }
  if (FX.koT >= FX.koNext) {
    FX.koNext += 20;
    const dead = alive.reduce((a, b) => (a.tot <= b.tot ? a : b));
    if (dead.isP) { FX.eliminated = 1; player.ko = 1; $f('dan').classList.add('on'); endRace(); }
    else koOut(dead);
  }
}
requestAnimationFrame(fxTick);
