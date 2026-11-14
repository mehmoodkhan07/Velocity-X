// VELOCITY X horn system (v0.6): 4 original synthesised horns, hold = continuous, tap = short beep,
// 3D positional audio (so a traffic car 3 m away is louder than one 30 m away), per-car horn choice saved
// with the customization, traffic + rival reactions, replay recording, online sync and stat tracking.
// No sampled audio is used: every horn is generated from oscillators, so nothing is licensed/copyrighted.

// ---------------------------------------------------------------- horn definitions (original tones)
const HORN_TYPES = {
  standard: { n: 'Standard', notes: [392, 494], wave: 'square', gain: .13, hold: 1, desc: 'Two-tone factory horn' },
  sport: { n: 'Sport', notes: [523, 659, 784], wave: 'sawtooth', gain: .1, hold: 1, desc: 'Triple high trumpet' },
  air: { n: 'Air Horn', notes: [196, 247, 311], wave: 'sawtooth', gain: .16, hold: 1, vib: 5.5, desc: 'Deep train-style blast' },
  melody: { n: 'Melody', notes: [523, 659, 784, 659, 523, 440, 523], wave: 'triangle', gain: .16, hold: 1, seq: .13, desc: 'Original 7-note fanfare' }
};
const HORN_ORDER = ['standard', 'sport', 'air', 'melody'];

save.honks = save.honks || 0;
save.hornT = save.hornT || {};            // type -> times used (stat screen)

const HORN = { down: 0, t0: 0, cur: null, rep: 0, last: 0, ev: [], rt: 0, ws: null, type: 'standard' };
const hn$ = id => document.getElementById(id);
const hnClamp = (v, a, b) => Math.max(a, Math.min(b, v));

function playerHornType() {
  const cu = (save.cu && save.cu[sel]) || {};
  return HORN_TYPES[cu.horn] ? cu.horn : 'standard';
}
function hornDef(type) { return HORN_TYPES[type] || HORN_TYPES.standard; }

// ---------------------------------------------------------------- audio graph
function hornBus() {
  if (typeof AB != 'function' || typeof aud == 'undefined' || !aud) return null;
  const b = AB();
  return b ? b.s : null;                 // effects bus: the SFX slider is already applied to it
}
function setPannerPos(p, x, y, z) {
  if (!p) return;
  if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
  else if (p.setPosition) p.setPosition(x, y, z);
}
/** One sounding horn, positioned in the world. Returns null when audio is unavailable. */
function hornOut(x, z, vol) {
  const bus = hornBus();
  if (!bus) return null;
  const gain = aud.createGain();
  gain.gain.value = vol;
  let pan = null, panner = null;
  if (aud.createPanner) {
    try {
      panner = aud.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 6; panner.maxDistance = 150; panner.rolloffFactor = 1.6;
      setPannerPos(panner, x == null ? 0 : x, 1.2, z == null ? 0 : z);
      gain.connect(panner); panner.connect(bus);
    } catch (e) { panner = null; }
  }
  if (!panner) {
    if (aud.createStereoPanner) { pan = aud.createStereoPanner(); gain.connect(pan); pan.connect(bus); }
    else gain.connect(bus);
    if (x != null && player) {           // no HRTF: fake the falloff and the side
      const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz);
      gain.gain.value = vol * hnClamp(1 - d / 70, .06, 1);
      if (pan) {
        const fx = Math.sin(player.h), fz = Math.cos(player.h);
        pan.pan.value = hnClamp((dx * fz - dz * fx) / 12, -1, 1);
      }
    }
  }
  return { gain, panner, pan };
}

function hornVoice(type, x, z, volMul) {
  if (typeof aud == 'undefined' || !aud) return null;
  const def = hornDef(type);
  const vol = (volMul == null ? 1 : volMul) * (save.set.hornVol == null ? .7 : +save.set.hornVol) * 1.43;
  const out = hornOut(x, z, def.gain * vol);
  if (!out) return null;
  const t0 = aud.currentTime + .01, nodes = [];
  const osc = (f, start, stop) => {
    const o = aud.createOscillator(), g = aud.createGain();
    o.type = def.wave; o.frequency.value = f;
    g.gain.value = 1 / def.notes.length + .25;
    o.connect(g); g.connect(out.gain);
    o.start(start); if (stop) o.stop(stop);
    if (def.vib) {                      // air horn gets a fast wobble so it reads as a big horn
      const lfo = aud.createOscillator(), lg = aud.createGain();
      lfo.frequency.value = def.vib; lg.gain.value = 6;
      lfo.connect(lg); lg.connect(o.frequency); lfo.start(start); nodes.push(lfo);
    }
    nodes.push(o);
    return o;
  };
  if (def.seq) def.notes.forEach((f, i) => osc(f, t0 + i * def.seq, t0 + i * def.seq + def.seq * 1.4));
  else def.notes.forEach((f, i) => osc(f * (i === 0 ? 1 : 1.002), t0));
  return { out, nodes, t0, def, type };
}

function hornSilence(v, fade) {
  if (!v) return;
  const t = aud ? aud.currentTime : 0;
  try { v.out.gain.gain.setTargetAtTime(0, t, fade || .04); } catch (e) { }
  v.nodes.forEach(o => { try { o.stop(t + .18); } catch (e) { } });
}

/** Play one horn blast at a world position (also used for traffic, rivals, replays and remote players). */
function hornAt(type, x, z, dur, volMul) {
  const v = hornVoice(type, x, z, volMul);
  if (!v) return null;
  const ms = Math.max(90, dur || 320);
  if (hornDef(type).seq) { setTimeout(() => hornSilence(v), ms); return v; }
  setTimeout(() => hornSilence(v), ms);
  return v;
}

// ---------------------------------------------------------------- the player's own horn
function hornStop() {
  if (HORN.rep) { clearInterval(HORN.rep); HORN.rep = 0; }
  if (HORN.cur) { hornSilence(HORN.cur); HORN.cur = null; }
}
function hornStart() {
  hornStop();
  HORN.cur = hornVoice(HORN.type, player ? player.x : null, player ? player.z : null, 1);
  const def = hornDef(HORN.type);
  if (def.seq && HORN.cur) HORN.rep = setInterval(() => { if (!HORN.down) { hornStop(); return; } HORN.cur = hornVoice(HORN.type, player.x, player.z, 1); }, def.seq * def.notes.length * 1000);
}

/** Hold = continuous honk, tap = one short beep. Bound to H, controller B/Circle, R3 and the touch button. */
function vxHornHold(on) {
  if (typeof cfg == 'undefined' || !cfg) return;
  const live = typeof state != 'undefined' && (state == 'race' || state == 'count');
  if (on) {
    if (!live || HORN.down) return;
    if (performance.now() - HORN.last < 180) return;        // debounce machine-gun taps
    HORN.last = performance.now();
    HORN.down = 1; HORN.t0 = performance.now();
    HORN.type = playerHornType();
    hornStart();
    save.honks = (save.honks || 0) + 1;
    save.hornT[HORN.type] = (save.hornT[HORN.type] || 0) + 1;
    if (typeof persist == 'function') persist();
    hornReact(HORN.type);
    if (typeof vxRumble == 'function') vxRumble(.25, 130);
    hornRecord(HORN.type);
  } else {
    if (!HORN.down) return;
    HORN.down = 0;
    const held = performance.now() - HORN.t0;
    if (held < 150) setTimeout(() => { if (!HORN.down) hornStop(); }, 155 - held);   // a tap is still a beep
    else hornStop();
  }
}

// ---------------------------------------------------------------- world reaction
/** Traffic pulls aside (and sometimes honks back); rivals lift, give a side and remember it. */
function hornReact(type) {
  if (!player) return;
  const fx = Math.sin(player.h), fz = Math.cos(player.h);
  let n = 0, back = 0;
  // traffic
  if (typeof TR != 'undefined' && TR && TR.length) {
    TR.forEach(r => {
      const m = r.m; if (!m) return;
      const dx = m.position.x - player.x, dz = m.position.z - player.z;
      const fwd = dx * fx + dz * fz, lat = dx * fz - dz * fx;
      if (fwd > -6 && fwd < 34 && Math.abs(lat) < 9) {
        r.away = 1.6; r.awayDir = lat > 0 ? 1 : -1; n++;
        if (Math.random() < .32 && back < 2) {
          back++;
          setTimeout(() => hornAt(['standard', 'sport', 'air'][(Math.random() * 3) | 0], m.position.x, m.position.z, 260, .55), 260 + Math.random() * 320);
        }
      }
    });
  }
  // rival racers
  if (typeof cars != 'undefined' && cars) cars.forEach(o => {
    if (o.isP || o.ko || o.fin) return;
    const dx = o.x - player.x, dz = o.z - player.z;
    const fwd = dx * fx + dz * fz, lat = dx * fz - dz * fx;
    if (fwd > 1 && fwd < 32 && Math.abs(lat) < 8) {
      o.yield = 2.4; n++;
      if (save.rivals && save.rivals[o.name] && window.VXCORE) save.rivals[o.name] = window.VXCORE.rivalEvent(save.rivals[o.name], 'horn');
      if (Math.random() < .22 && back < 2) {
        back++;
        setTimeout(() => {
          hornAt('sport', o.x, o.z, 240, .6);
          if (typeof subtitle == 'function') subtitle(o.name.toUpperCase(), 'Get out of the way yourself!');
        }, 300);
      }
    }
  });
  if (typeof msg == 'function') msg(n ? 'HORN · ' + n + ' CAR' + (n > 1 ? 'S' : '') + ' GAVE A SIDE' : 'HORN');
  if (typeof persist == 'function') persist();
}

// ---------------------------------------------------------------- replay + online
function hornRecord(type) {
  if (typeof raceT == 'undefined' || !player) return;
  HORN.ev.push({ t: raceT, type: type, x: Math.round(player.x * 10) / 10, z: Math.round(player.z * 10) / 10 });
  if (HORN.ev.length > 200) HORN.ev.shift();
  if (typeof WS != 'undefined' && WS && WS.readyState == 1 && cfg && cfg.online)
    try { WS.send(JSON.stringify({ t: 'horn', type: type })); } catch (e) { }
}
const _srHorn = startRace;
startRace = function (c) { _srHorn(c); HORN.ev = []; HORN.rt = 0; hornStop(); };

// remote horns: attach once per socket so the online relay is audible
function hornNetTick() {
  if (typeof WS == 'undefined' || !WS) { HORN.ws = null; return; }
  if (HORN.ws === WS) return;
  HORN.ws = WS;
  try {
    WS.addEventListener('message', e => {
      let d; try { d = JSON.parse(e.data); } catch (err) { return; }
      if (d.t == 'horn') {
        const m = (typeof remote != 'undefined' && remote) ? remote[d.id] : null;
        hornAt(HORN_TYPES[d.type] ? d.type : 'standard', m ? m.position.x : null, m ? m.position.z : null, 380, .8);
      }
      if (d.t == 'taunt' && typeof subtitle == 'function') subtitle('RIVAL', String(d.text || '').slice(0, 60));
    });
  } catch (e) { }
}

// ---------------------------------------------------------------- garage: horn per car
const _gRenderHorn = gRender;
gRender = function () {
  _gRenderHorn();
  const panel = hn$('garage') && hn$('garage').querySelector('.panel');
  if (!panel) return;
  const cu = (save.cu[gi] = save.cu[gi] || {});
  const cur = HORN_TYPES[cu.horn] ? cu.horn : 'standard';
  const opts = HORN_ORDER.map(k => `<option value="${k}" ${k == cur ? 'selected' : ''}>${HORN_TYPES[k].n}</option>`).join('');
  const btn = panel.lastElementChild;
  const html = `<h3>HORN <small style="color:#5b6678">(saved with this car)</small></h3>
  <label>Horn type<select onchange="cuSet('horn',this.value)">${opts}</select></label>
  <div style="color:#5b6678;font-size:11px">${HORN_TYPES[cur].desc} · hold to honk, tap for a beep</div>
  <button class=ghost onclick="hornTest('${cur}')">TEST HORN</button>`;
  if (btn && btn.insertAdjacentHTML) btn.insertAdjacentHTML('beforebegin', html);
  else panel.insertAdjacentHTML('beforeend', html);
};
function hornTest(type) {
  HORN.type = HORN_TYPES[type] ? type : 'standard';
  const v = hornVoice(HORN.type, null, null, 1);
  setTimeout(() => hornSilence(v), 620);
}

// ---------------------------------------------------------------- settings + prompts + stats
const _showXHorn = showX;
showX = function (k) {
  _showXHorn(k);
  if (k == 'career') {
    const p = hn$('xs') && hn$('xs').querySelector('.panel');
    if (p) p.insertAdjacentHTML('beforeend', `<h3>HORN</h3><div style="color:#A5ADBA;font-size:12px">Honks total ${save.honks || 0} · ` +
      HORN_ORDER.map(t => `${HORN_TYPES[t].n} ${save.hornT[t] || 0}`).join(' · ') + '</div>');
  }
  if (k != 'settings') return;
  const panel = hn$('xs') && hn$('xs').querySelector('.panel');
  if (!panel) return;
  const back = panel.lastElementChild;
  const type = playerHornType();
  const html = `<h3>HORN</h3>
  <label>Horn of the selected car<select onchange="cuSet('horn',this.value);showX('settings')">${HORN_ORDER.map(t => `<option value="${t}" ${t == type ? 'selected' : ''}>${HORN_TYPES[t].n}</option>`).join('')}</select></label>
  <label>Volume (SFX bus)<input type=range min=0 max=1 step=.05 value=${save.set.hornVol == null ? .7 : save.set.hornVol} onchange="save.set.hornVol=+this.value;persist()"></label>
  <button class=ghost onclick="hornTest('${type}')">TEST HORN</button>
  <button class=ghost onclick="vxHornHold(true);setTimeout(function(){vxHornHold(false)},240)">HOLD TEST</button>`;
  if (back && back.insertAdjacentHTML) back.insertAdjacentHTML('beforebegin', html);
};

// ---------------------------------------------------------------- stats / achievements
if (typeof ACH != 'undefined' && Array.isArray(ACH) && !ACH.some(a => a[0] == 'horn'))
  ACH.push(['horn', 'Horn Blower (100 honks)', () => (save.honks || 0) >= 100]);

// ---------------------------------------------------------------- per-frame
function hornTick(t) {
  requestAnimationFrame(hornTick);
  const dt = Math.min(.1, (t - (hornTick.l || t)) / 1000); hornTick.l = t;
  hornNetTick();
  // keep the listener on the camera so positional horns pan with the view
  if (typeof aud != 'undefined' && aud && aud.listener && typeof camera != 'undefined' && camera) {
    const L = aud.listener, c = camera.position;
    if (L.positionX) {
      L.positionX.value = c.x; L.positionY.value = c.y; L.positionZ.value = c.z;
      const fx = Math.sin(player ? player.h : 0), fz = Math.cos(player ? player.h : 0);
      if (L.forwardX) { L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    } else if (L.setPosition) {
      L.setPosition(c.x, c.y, c.z);
      if (L.setOrientation) L.setOrientation(0, 0, -1, 0, 1, 0);
    }
  }
  // replay: play back the recorded honks at the right moment
  if (typeof state != 'undefined' && state == 'rep' && typeof rt != 'undefined') {
    for (let i = 0; i < HORN.ev.length; i++) {
      const e = HORN.ev[i];
      if (e.t > HORN.rt && e.t <= rt) hornAt(e.type, e.x, e.z, 340, .8);
    }
    HORN.rt = rt;
  } else HORN.rt = typeof raceT != 'undefined' ? raceT : 0;
  // release a stuck horn if the race ends while the button is held
  if (HORN.down && typeof state != 'undefined' && state != 'race' && state != 'count') { HORN.down = 0; hornStop(); }
}
requestAnimationFrame(hornTick);

// ---------------------------------------------------------------- public API
vxHorn = function () { vxHornHold(true); setTimeout(() => vxHornHold(false), 260); };
window.VXHORN = {
  types: HORN_TYPES, order: HORN_ORDER, hold: vxHornHold, test: hornTest, at: hornAt,
  get type() { return HORN.type; },
  react: hornReact, events: () => HORN.ev
};
