// Prints size, orientation and material info for .glb files so web/js/models.js can be tuned.
// Usage: node tools/inspect-glb.js models/*.glb
const fs = require('fs'), path = require('path');

const mul = (a, b) => {           // 4x4 row-major multiply
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c]; o[r * 4 + c] = s;
  }
  return o;
};
const fromTRS = n => {            // glTF quaternion (x,y,z,w) -> matrix
  if (n.matrix) return n.matrix.slice();
  const [tx, ty, tz] = n.translation || [0, 0, 0], [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1];
};
const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

function inspect(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) return console.log(path.basename(file), '— not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  const g = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let tris = 0;
  const meshes = new Set();
  const walk = (i, parent) => {
    const n = g.nodes[i], m = mul(parent, fromTRS(n));
    if (n.mesh != null) {
      meshes.add(n.mesh);
      for (const p of g.meshes[n.mesh].primitives) {
        const a = g.accessors[p.attributes.POSITION];
        if (!a.min) continue;
        const idx = g.accessors[p.indices];
        tris += (idx ? idx.count : a.count) / 3;
        for (let c = 0; c < 8; c++) {
          const q = apply(m, [c & 1 ? a.max[0] : a.min[0], c & 2 ? a.max[1] : a.min[1], c & 4 ? a.max[2] : a.min[2]]);
          for (let k = 0; k < 3; k++) { box.min[k] = Math.min(box.min[k], q[k]); box.max[k] = Math.max(box.max[k], q[k]); }
        }
      }
    }
    (n.children || []).forEach(c => walk(c, m));
  };
  (g.scenes[g.scene || 0].nodes || []).forEach(i => walk(i, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  const size = box.max.map((v, i) => v - box.min[i]);
  const mats = (g.materials || []).map(m => {
    const p = m.pbrMetallicRoughness || {};
    return `${m.name || 'mat'}[${p.baseColorFactor ? p.baseColorFactor.slice(0, 3).map(v => v.toFixed(2)).join(',') : 'tex'}${p.baseColorTexture ? '+map' : ''}]`;
  });
  console.log(`\n${path.basename(file)}  (${(buf.length / 1048576).toFixed(2)} MB, ${(tris / 1000).toFixed(1)}k tris)`);
  console.log(`  generator : ${(g.asset || {}).generator || '?'}`);
  console.log(`  nodes ${g.nodes.length} · meshes ${meshes.size} · materials ${(g.materials || []).length} · images ${(g.images || []).length} · skins ${(g.skins || []).length || 0}`);
  console.log(`  bbox size : X ${size[0].toFixed(2)} · Y ${size[1].toFixed(2)} · Z ${size[2].toFixed(2)}   (ground at Y ${box.min[1].toFixed(2)})`);
  console.log(`  longest   : ${['X', 'Y', 'Z'][size.indexOf(Math.max(...size))]}`);
  console.log(`  materials : ${mats.join(' ')}`);
}

const files = process.argv.slice(2);
if (!files.length) console.log('usage: node tools/inspect-glb.js <file.glb> [...]');
files.forEach(f => { try { inspect(f); } catch (e) { console.log(path.basename(f), '—', e.message); } });
