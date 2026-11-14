// Copies ../web into ./web, vendors three.js locally and makes sure the generated bundles exist,
// so the desktop build works offline — 3D car models and the daily-challenge rules included.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const root = path.join(__dirname, '..'), src = path.join(root, 'web'), dst = path.join(__dirname, 'web');

// The generated bundles live in web/vendor. Rebuild them when a fresh checkout has not built them yet.
const GENERATED = [['GLTFLoader.js', 'tools/build-vendor.js'], ['game-core.js', 'packages/game-core/build.js']];
for (const [file, script] of GENERATED) {
  if (fs.existsSync(path.join(src, 'vendor', file))) continue;
  const r = spawnSync(process.execPath, [path.join(root, script)], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) console.warn('[prep] could not build ' + file + ' — the game falls back to its built-in defaults');
}

fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
fs.mkdirSync(path.join(dst, 'vendor'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'node_modules', 'three', 'build', 'three.min.js'), path.join(dst, 'vendor', 'three.min.js'));

const models = fs.existsSync(path.join(dst, 'models')) ? fs.readdirSync(path.join(dst, 'models')).filter(f => f.endsWith('.glb')).length : 0;
console.log('web copied, three.js vendored, ' + models + ' car model(s) bundled');
