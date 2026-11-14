// VELOCITY X car models: loads the .glb cars from models/ and swaps them in for every car in the game
// (player, AI, traffic, ghost, online rivals and the garage showcase).
// If a file is missing, still downloading or fails to parse, the procedural carMesh() is used instead.
const VXMODELS = { ready: false, pct: 0 };

// ---- collapse a loaded car into one mesh per material ----------------
// A GLB car arrives as 15-30 meshes; every one of them is a draw call, and a 16-car grid plus traffic
// then costs hundreds of calls per frame. The bodies are static, so flatten them once at load time.
// Only position/normal/uv survive; if a model cannot be flattened safely the original group is kept.
function vxMergeProto(root) {
  try {
    root.updateMatrixWorld(true);
    const buckets = new Map();
    let uvMode = null, failed = false;
    root.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh || !o.geometry || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.length !== 1) { failed = true; return; }
      const g = o.geometry, hasUV = !!g.attributes.uv;
      if (failed || !g.attributes.position || !g.attributes.normal) { failed = true; return; }
      if (uvMode == null) uvMode = hasUV; else if (uvMode !== hasUV) { failed = true; return; }
      if (mats[0].vertexColors) { failed = true; return; }
      const m = o.matrixWorld.clone();           // already includes the vxPrep scale/centre, so the car keeps its size
      const b = buckets.get(mats[0].uuid);
      if (b) b.geos.push({ g, m }); else buckets.set(mats[0].uuid, { mat: mats[0], geos: [{ g, m }] });
    });
    if (failed || buckets.size < 2) return root;

    const out = new T.Group(), v = new T.Vector3(), n3 = new T.Matrix3();
    buckets.forEach(({ mat, geos }) => {
      const pos = [], nor = [], uv = [];
      for (const { g, m } of geos) {
        const src = g.index ? g.toNonIndexed() : g;
        const pa = src.attributes.position.array, na = src.attributes.normal.array, nm = n3.getNormalMatrix(m);
        for (let i = 0; i < pa.length; i += 3) { v.set(pa[i], pa[i + 1], pa[i + 2]).applyMatrix4(m); pos.push(v.x, v.y, v.z); }
        for (let i = 0; i < na.length; i += 3) { v.set(na[i], na[i + 1], na[i + 2]).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z); }
        if (uvMode) { const ua = src.attributes.uv.array; for (let i = 0; i < ua.length; i++) uv.push(ua[i]); }
        if (src !== g) src.dispose();
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
      if (uvMode) geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geo.computeBoundingSphere();
      out.add(new T.Mesh(geo, mat));
    });
    out.userData.vxLen = root.userData.vxLen;
    return out;
  } catch (e) { console.warn('[VX] merge skipped: ' + e.message); return root; }
}

// class of the car -> which body to use. S/X = supercar, A = sedan, B = hatch, C/D = compact.
const VX_CARSHEETS = {
  sports: { file: 'sports.glb' },
  toyota: { file: 'toyota.glb' },
  corolla: { file: 'white-corolla.glb' },
  yellow: { file: 'yellow-car.glb' }
};
const VX_BY_CLASS = { S: 'sports', X: 'sports', A: 'toyota', B: 'corolla', C: 'yellow', D: 'yellow' };
const VX_CACHE = {}, VX_BASE = new URL('models/', document.baseURI).href, VX_LEN = 4.5;
VXMODELS.cars = VX_CACHE;   // filled in as the .glb files arrive

// ---- normalise a loaded glTF: face +Z, ground at y=0, driven into the 4.5 m game scale ----
function vxPrep(gltfScene, cfg) {
  const pivot = new T.Group();
  pivot.add(gltfScene);
  const box3 = new T.Box3(), size = new T.Vector3(), centre = new T.Vector3();
  const measure = () => { pivot.updateMatrixWorld(true); box3.setFromObject(pivot); box3.getSize(size); return size; };

  if (cfg.yaw != null) pivot.rotation.y = cfg.yaw * Math.PI / 180;
  measure();
  // most models are authored along X; the game drives along +Z, so turn the long axis into Z
  if (cfg.yaw == null && size.x > size.z * 1.15) { pivot.rotation.y = Math.PI / 2; measure(); }

  pivot.scale.setScalar(VX_LEN / Math.max(size.x, size.z));           // both horizontal axes scale proportionally
  measure();
  box3.getCenter(centre);
  pivot.position.set(-centre.x, -box3.min.y, -centre.z);              // centre on the origin, wheels on the ground

  pivot.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = true;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (!m) return;
      // the game renders in linear space, so colour maps must not be decoded again
      if (m.map) m.map.encoding = T.LinearEncoding;
      // pygltflib exports put the diffuse texture in emissiveTexture with a black base colour: move it back
      if (m.emissiveMap && !m.map && m.emissive && m.emissive.getHex() === 0) {
        m.map = m.emissiveMap; m.emissiveMap = null; m.color.setHex(0xffffff);
        m.map.encoding = T.LinearEncoding;
      }
      if (m.emissiveMap) m.emissiveMap.encoding = T.LinearEncoding;
      m.needsUpdate = true;
    });
  });
  pivot.userData.vxLen = VX_LEN;
  return pivot;
}

// ---- per-car paint: only flat, bright materials are recoloured, so textures and tyres survive ----
function vxPaint(inst, hex, cu) {
  const paint = new T.Color(hex);
  inst.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map(m => {
      if (!m || m.map || m.emissiveMap || m.transparent) return m;
      if (Math.max(m.color.r, m.color.g, m.color.b) < 0.3) return m;      // tyres / glass / trim stay dark
      const n = m.clone();
      n.userData = n.userData || {};
      n.userData.vxOwn = 1;                       // tagged: this clone is ours to dispose, the proto's is not
      n.color = m.color.clone().lerp(paint, cu && cu.paint != null ? .85 : .5);
      n.metalness = cu && cu.fin == 'metal' ? .9 : m.metalness;
      n.roughness = cu && cu.fin == 'matte' ? .9 : cu && cu.fin == 'chrome' ? .08 : m.roughness;
      return n;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
}

// ---- loading starts at the bottom of this file, after vxLoaded()/vxTick exist ----
// (a synchronous vxLoaded() call from up here would hit the temporal dead zone on those bindings)
function loadSheets() {
  if (!T.GLTFLoader) { console.warn('[VX] GLTFLoader missing — using procedural cars'); return vxLoaded(); }
  const keys = Object.keys(VX_CARSHEETS), loader = new T.GLTFLoader();
  let done = 0;
  const settle = () => { VXMODELS.pct = Math.round(++done / keys.length * 100); if (done === keys.length) vxLoaded(); };
  keys.forEach(k => {
    loader.load(VX_BASE + VX_CARSHEETS[k].file,
      g => {
        try { VX_CACHE[k] = vxMergeProto(vxPrep(g.scene, VX_CARSHEETS[k])) }
        catch (e) { console.warn('[VX] model ' + k + ' failed: ' + e.message); }
        settle();
      },
      x => { if (x.total) VXMODELS.pct = Math.round((done + x.loaded / x.total) / keys.length * 100); },
      () => { console.warn('[VX] model ' + k + ' could not be loaded — using procedural cars'); settle(); });
  });
}

// block "START ENGINE" until the cars are in, so the first race never falls back to boxes.
// A click that arrives too early is remembered and honoured the moment loading finishes — swallowing
// it (the old behaviour) made a normal fast click look like the game was dead.
function vxLoaded() { VXMODELS.pct = 100; VXMODELS.ready = true; vxOnReady(); }
let vxWaiting = 0;
addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('#start');
  if (!b || VXMODELS.ready) return;
  e.stopImmediatePropagation(); e.preventDefault();
  // this is a real user gesture: create the audio context here so the engine sound is unlocked later
  try { aud = aud || new (window.AudioContext || window.webkitAudioContext)(); } catch (err) { }
  vxWaiting = 1; b.disabled = true; b.textContent = 'LOADING 3D CARS ' + VXMODELS.pct + '%';
}, true);
const vxLoadTick = setInterval(() => {
  if (!vxWaiting || VXMODELS.ready) return;
  const b = $('start'); if (b) b.textContent = 'LOADING 3D CARS ' + VXMODELS.pct + '%';
}, 150);
function vxOnReady() {
  clearInterval(vxLoadTick);
  const b = $('start');
  if (b) { b.disabled = false; b.textContent = 'START ENGINE'; }
  if (!vxWaiting) return;
  vxWaiting = 0;
  toMenu();                                  // the player already asked to start: do not ask again
}

// ---- swap the procedural body for the real model ----
const _vxCarMesh = carMesh;
carMesh = function (d, cu) {
  const key = (cu && cu.model) || (d && VX_BY_CLASS[d.cls]) || 'sports';
  const proto = VX_CACHE[key];
  if (!proto) return _vxCarMesh(d, cu);
  const g = new T.Group(), inst = proto.clone(true);
  vxPaint(inst, cu && cu.paint != null ? cu.paint : (d ? d.c : 0xcccccc), cu);
  g.add(inst);
  if (cu && cu.ug) {
    const u = new T.Mesh(new T.PlaneGeometry(3.2, 5.6), new T.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: .5 }));
    u.rotation.x = -Math.PI / 2; u.position.y = .06; g.add(u);
  }
  g.userData.model = key;
  return g;
};
window.VXMODELS = VXMODELS;
loadSheets();