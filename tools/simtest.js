// Runs every headless gameplay scenario in a fresh process and prints a summary.
// Usage: node tools/simtest.js   (or: npm run sim)
const { spawnSync } = require('child_process'), path = require('path');
const SIM = path.join(__dirname, 'sim.js');
const SCENARIOS = ['steer', 'pad', 'padfull', 'wheel', 'gyro', 'drive', 'wall', 'horn', 'horn2', 'nemesis', 'rewind', 'pit', 'nitro', 'resume', 'auto', 'autosoak'];
let failed = 0, pass = 0;
for (const sc of SCENARIOS) {
  const r = spawnSync(process.execPath, [SIM, sc], { encoding: 'utf8' });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  if (r.status === 0) {
    pass++;
    console.log('  ok   ' + sc);
  } else {
    failed++;
    console.log('  FAIL ' + sc);
    for (const line of out.split(/\r?\n/)) if (line && !/^PASS /.test(line)) console.log('       ' + line);
  }
}
console.log(`\nsim: ${pass} scenario(s) passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
